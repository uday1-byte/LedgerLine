const crypto = require('crypto');
const { rateLimit, MemoryStore, ipKeyGenerator } = require('express-rate-limit');
const { RedisStore } = require('rate-limit-redis');
const { getRedisClient, isRedisReady } = require('../config/redis');
const env = require('../config/env');

/**
 * Authentication Fallback Behaviour & Limitations:
 * - In PRODUCTION (NODE_ENV=production): Authentication endpoints (login and register) fail closed
 *   with HTTP 503 Service Unavailable if Redis is unavailable, never falling back silently to memory.
 * - In DEVELOPMENT / TEST ONLY: Authentication endpoints degrade gracefully to a process-local
 *   in-memory store (MemoryStore) so local workflows function without requiring a live Redis server.
 *
 * Financial Mutation Endpoints:
 * Always fail closed with HTTP 503 Service Unavailable in all environments if Redis is unavailable.
 */

const authMemoryStore = new MemoryStore();

function createRedisStore(prefix) {
  return new RedisStore({
    prefix,
    sendCommand: async (...args) => {
      const client = getRedisClient();
      if (!client) {
        throw new Error('Redis client not available');
      }

      // If live ioredis client with raw command execution
      if (typeof client.call === 'function' && !client.isMock) {
        return client.call(...args);
      }

      // Mock/testing fallback for ioredis-mock (which lacks SCRIPT LOAD / EVALSHA natively)
      const cmd = String(args[0]).toUpperCase();
      if (cmd === 'SCRIPT' && String(args[1]).toUpperCase() === 'LOAD') {
        return crypto.createHash('sha1').update(args[2] || '').digest('hex');
      }

      if (cmd === 'EVALSHA') {
        const key = args[3];
        // If called for get operation (length <= 4)
        if (args.length <= 4) {
          const val = await client.get(key);
          const ttl = await client.pttl(key);
          return [val ? Number(val) : 0, ttl > 0 ? ttl : 0];
        }
        // If called for increment operation (length >= 5)
        const windowMs = Number(args[4]) || 60000;
        const ttl = await client.pttl(key);
        if (ttl <= 0) {
          await client.set(key, 1, 'PX', windowMs);
          return [1, windowMs];
        }
        const hits = await client.incr(key);
        return [hits, ttl];
      }

      const method = cmd.toLowerCase();
      if (typeof client[method] === 'function') {
        return client[method](...args.slice(1));
      }

      throw new Error(`Command ${cmd} not supported on Redis client`);
    },
  });
}

let authRedisLimiterInstance = null;
let authRedisClientRef = null;

function getAuthRedisLimiter() {
  const client = getRedisClient();
  if (!authRedisLimiterInstance || authRedisClientRef !== client) {
    authRedisClientRef = client;
    authRedisLimiterInstance = rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      limit: 10, // 10 attempts per window
      standardHeaders: true,
      legacyHeaders: false,
      store: createRedisStore('rl:auth:'),
      keyGenerator: (req) => ipKeyGenerator(req.ip),
      validate: { creationStack: false, default: true },
      passOnStoreError: false,
      handler: (req, res) => {
        const retryAfter = Math.ceil((req.rateLimit.resetTime - Date.now()) / 1000) || 60;
        res.setHeader('Retry-After', retryAfter);
        return res.status(429).json({
          error: 'TooManyRequests',
          message: 'Too many authentication attempts. Please try again later.',
          retryAfter,
        });
      },
    });
  }
  return authRedisLimiterInstance;
}

const authMemoryLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  store: authMemoryStore,
  keyGenerator: (req) => ipKeyGenerator(req.ip),
  validate: { default: true },
  handler: (req, res) => {
    const retryAfter = Math.ceil((req.rateLimit.resetTime - Date.now()) / 1000) || 60;
    res.setHeader('Retry-After', retryAfter);
    return res.status(429).json({
      error: 'TooManyRequests',
      message: 'Too many authentication attempts. Please try again later.',
      retryAfter,
    });
  },
});

function isProductionMode() {
  return env.NODE_ENV === 'production' || process.env.NODE_ENV === 'production';
}

function isRateLimitActive() {
  if (isProductionMode()) {
    return true;
  }
  if (!env.RATE_LIMIT_ENABLED) return false;
  if (process.env.NODE_ENV === 'test') {
    return process.env.ENABLE_RATE_LIMIT_TESTS === 'true';
  }
  return true;
}

/**
 * Auth Limiter: Protects login and registration against brute-force & credential stuffing.
 * 10 attempts per 15 minutes per IP.
 *
 * In production, fails closed with HTTP 503 if Redis is unavailable (no memory fallback).
 */
const authLimiter = (req, res, next) => {
  if (!isRateLimitActive()) {
    return next();
  }

  const inProduction = isProductionMode();

  if (isRedisReady()) {
    const limiter = getAuthRedisLimiter();
    return limiter(req, res, (err) => {
      if (err) {
        if (inProduction) {
          return res.status(503).json({
            error: 'ServiceUnavailable',
            message: 'Rate limiting service error. Authentication requests cannot be safely processed without distributed rate limiting.',
          });
        }
        // Fall back gracefully to local memory limiter in non-production environments
        return authMemoryLimiter(req, res, next);
      }
      next();
    });
  }

  if (inProduction) {
    return res.status(503).json({
      error: 'ServiceUnavailable',
      message: 'Rate limiting service is unavailable. Authentication requests cannot be safely processed without distributed rate limiting.',
    });
  }

  return authMemoryLimiter(req, res, next);
};

let financialRedisLimiterInstance = null;
let financialRedisClientRef = null;

function getFinancialRedisLimiter() {
  const client = getRedisClient();
  if (!financialRedisLimiterInstance || financialRedisClientRef !== client) {
    financialRedisClientRef = client;
    financialRedisLimiterInstance = rateLimit({
      windowMs: 60 * 1000, // 1 minute
      limit: 30, // 30 transactions per minute
      standardHeaders: true,
      legacyHeaders: false,
      store: createRedisStore('rl:txn:'),
      keyGenerator: (req) => {
        if (req.user && req.user.id) {
          return `user:${req.user.id}`;
        }
        return `ip:${ipKeyGenerator(req.ip)}`;
      },
      validate: { keyGeneratorIpFallback: false, creationStack: false },
      passOnStoreError: false,
      handler: (req, res) => {
        const retryAfter = Math.ceil((req.rateLimit.resetTime - Date.now()) / 1000) || 60;
        res.setHeader('Retry-After', retryAfter);
        return res.status(429).json({
          error: 'TooManyRequests',
          message: 'Transaction rate limit exceeded. Please wait before submitting further transactions.',
          retryAfter,
        });
      },
    });
  }
  return financialRedisLimiterInstance;
}

/**
 * Financial Mutation Limiter: Protects transfers, deposits, withdrawals, and reversals.
 * Strictly enforced against Redis to ensure multi-instance consensus.
 *
 * Strict Requirement:
 * If Redis is unavailable, financial mutations MUST NOT proceed with unlimited or uncoordinated requests.
 * It immediately returns controlled HTTP 503 Service Unavailable.
 */
const financialMutationLimiter = (req, res, next) => {
  if (!isRateLimitActive()) {
    return next();
  }

  // Strict check: if Redis is not ready, reject financial mutation with HTTP 503
  if (!isRedisReady()) {
    return res.status(503).json({
      error: 'ServiceUnavailable',
      message: 'Rate limiting service is unavailable. Financial transactions cannot be safely processed without distributed rate limiting.',
    });
  }

  const limiter = getFinancialRedisLimiter();
  return limiter(req, res, (err) => {
    if (err) {
      // Store failure during evaluation: return controlled HTTP 503
      return res.status(503).json({
        error: 'ServiceUnavailable',
        message: 'Rate limiting service error. Financial transactions cannot be safely processed without distributed rate limiting.',
      });
    }
    next();
  });
};

function resetAllRateLimits() {
  authMemoryStore.resetAll();
  authRedisLimiterInstance = null;
  authRedisClientRef = null;
  financialRedisLimiterInstance = null;
  financialRedisClientRef = null;
}

module.exports = {
  authLimiter,
  financialMutationLimiter,
  resetAllRateLimits,
};
