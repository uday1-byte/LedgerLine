const request = require('supertest');
const RedisMock = require('ioredis-mock');
const app = require('../src/app');
const { setRedisClientForTesting, closeRedis } = require('../src/config/redis');
const { resetAllRateLimits } = require('../src/middleware/rateLimiter');
const { pool } = require('../src/config/db');
const { createTestUser, ownerPool } = require('./helpers/auth');

describe('Redis Rate Limiting Integration Tests', () => {
  let mockRedis;

  beforeAll(async () => {
    process.env.ENABLE_RATE_LIMIT_TESTS = 'true';
    mockRedis = new RedisMock();
    setRedisClientForTesting(mockRedis);
    resetAllRateLimits();
  });

  afterAll(async () => {
    delete process.env.ENABLE_RATE_LIMIT_TESTS;
    await closeRedis();
    await pool.end();
    await ownerPool.end();
  });

  beforeEach(async () => {
    // Flush mock redis and in-memory store before each test
    await mockRedis.flushall();
    resetAllRateLimits();
    setRedisClientForTesting(mockRedis);
  });

  describe('Authentication Rate Limiter', () => {
    it('allows requests within threshold and throttles with 429 after 10 requests', async () => {
      // Send 10 login requests
      for (let i = 0; i < 10; i++) {
        const res = await request(app)
          .post('/api/auth/login')
          .send({ email: 'rate_test@example.com', password: 'Password123' });
        // Can be 400 (validation) or 401 (invalid creds), but NOT 429
        expect(res.statusCode).not.toBe(429);
      }

      // 11th request must be throttled with HTTP 429
      const throttledRes = await request(app)
        .post('/api/auth/login')
        .send({ email: 'rate_test@example.com', password: 'Password123' });

      expect(throttledRes.statusCode).toBe(429);
      expect(throttledRes.body.error).toBe('TooManyRequests');
      expect(throttledRes.headers).toHaveProperty('retry-after');
    }, 15000);

    it('falls back gracefully to memory store without crashing when Redis is unavailable in non-production', async () => {
      // Disconnect redis client
      setRedisClientForTesting(null);

      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'invalid_format', password: 'Password123' });

      // Request does not crash with 500/503; handles via memory store and Zod validation returns 400
      expect(res.statusCode).toBe(400);
      expect(res.body.error).toBe('ValidationError');
    });

    it('fails closed with HTTP 503 for authentication when Redis is unavailable in production', async () => {
      const prevNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      setRedisClientForTesting(null);

      try {
        const res = await request(app)
          .post('/api/auth/login')
          .send({ email: 'invalid_format', password: 'Password123' });

        expect(res.statusCode).toBe(503);
        expect(res.body.error).toBe('ServiceUnavailable');
        expect(res.body.message).toContain('Rate limiting service is unavailable');
      } finally {
        process.env.NODE_ENV = prevNodeEnv;
      }
    });

    it('extracts client IP behind single proxy hop so distinct forwarded clients have independent rate limits', async () => {
      // Exhaust limit for client IP 203.0.113.10
      for (let i = 0; i < 10; i++) {
        await request(app)
          .post('/api/auth/login')
          .set('X-Forwarded-For', '203.0.113.10')
          .send({ email: 'invalid_format', password: 'Password123' });
      }

      const throttledFirstClient = await request(app)
        .post('/api/auth/login')
        .set('X-Forwarded-For', '203.0.113.10')
        .send({ email: 'invalid_format', password: 'Password123' });
      expect(throttledFirstClient.statusCode).toBe(429);

      // Distinct client IP 203.0.113.20 must NOT be throttled
      const secondClientRes = await request(app)
        .post('/api/auth/login')
        .set('X-Forwarded-For', '203.0.113.20')
        .send({ email: 'invalid_format', password: 'Password123' });
      expect(secondClientRes.statusCode).toBe(400);
    });
  });

  describe('Financial Mutation Rate Limiter', () => {
    it('returns controlled HTTP 503 for financial mutations if Redis is disconnected', async () => {
      // Simulate Redis unavailability
      setRedisClientForTesting(null);

      const { token } = await createTestUser();

      const res = await request(app)
        .post('/api/transfers/deposit')
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', 'DEP-FAIL-REDIS-001')
        .send({
          accountId: '00000000-0000-0000-0000-000000000001',
          amountPaise: 5000,
        });

      expect(res.statusCode).toBe(503);
      expect(res.body.error).toBe('ServiceUnavailable');
      expect(res.body.message).toContain('Rate limiting service is unavailable');
    });

    it('allows financial mutations when Redis is connected and throttles with 429 when threshold exceeded', async () => {
      setRedisClientForTesting(mockRedis);
      const { user, token } = await createTestUser();

      // Submit up to limit (30 per minute)
      // We test by directly setting counter or rapid requests
      for (let i = 0; i < 30; i++) {
        // We test with empty/invalid payload to verify limiter passes down to route without 503/429
        const res = await request(app)
          .post('/api/transfers')
          .set('Authorization', `Bearer ${token}`)
          .set('Idempotency-Key', `TRF-KEY-${i}`)
          .send({});

        expect(res.statusCode).not.toBe(503);
        expect(res.statusCode).not.toBe(429);
      }

      // 31st request exceeds threshold
      const throttledRes = await request(app)
        .post('/api/transfers')
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', 'TRF-KEY-EXCEEDED')
        .send({});

      expect(throttledRes.statusCode).toBe(429);
      expect(throttledRes.body.error).toBe('TooManyRequests');
      expect(throttledRes.headers).toHaveProperty('retry-after');
    });
  });
});
