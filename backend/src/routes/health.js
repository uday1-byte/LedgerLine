const express = require('express');
const { testConnection } = require('../config/db');
const { checkRedisConnection } = require('../config/redis');
const prisma = require('../config/prisma');
const env = require('../config/env');

const router = express.Router();

/**
 * @route   GET /api/health/live
 * @desc    Liveness probe: verifies process is alive and accepting HTTP traffic without dependency checks
 * @access  Public
 */
router.get('/live', (req, res) => {
  return res.status(200).json({
    status: 'healthy',
    service: 'BalanceVault API',
    probe: 'liveness',
    environment: env.NODE_ENV,
    uptime: `${process.uptime().toFixed(1)}s`,
    timestamp: new Date().toISOString(),
  });
});

/**
 * Helper to probe all backing dependencies (PostgreSQL and Redis)
 */
async function probeDependencies() {
  let dbStatus = 'disconnected';
  let dbDetails = null;
  let redisStatus = 'disconnected';
  let redisDetails = null;

  // 1. Check PostgreSQL (via pg.Pool test connection)
  try {
    const dbResult = await testConnection();
    // Also verify Prisma connection
    await prisma.$queryRaw`SELECT 1 as health_check`;
    dbStatus = 'connected';
    dbDetails = {
      database: dbResult.database,
      prisma: 'connected',
    };
  } catch (err) {
    dbStatus = 'disconnected';
    dbDetails = {
      error: err.message,
    };
  }

  // 2. Check Redis
  const redisResult = await checkRedisConnection();
  if (redisResult.connected) {
    redisStatus = 'connected';
    redisDetails = {
      status: 'ready',
    };
  } else {
    redisStatus = 'disconnected';
    redisDetails = {
      error: redisResult.error || 'Redis unreachable',
    };
  }

  const isDegraded = dbStatus === 'disconnected' || redisStatus === 'disconnected';

  return {
    isDegraded,
    data: {
      status: isDegraded ? 'degraded' : 'healthy',
      service: 'BalanceVault API',
      environment: env.NODE_ENV,
      uptime: `${process.uptime().toFixed(1)}s`,
      timestamp: new Date().toISOString(),
      dependencies: {
        database: {
          status: dbStatus,
          ...(dbDetails && { details: dbDetails }),
        },
        redis: {
          status: redisStatus,
          ...(redisDetails && { details: redisDetails }),
        },
      },
    },
  };
}

/**
 * @route   GET /api/health/ready
 * @desc    Readiness probe: strictly verifies PostgreSQL and Redis connectivity before routing traffic
 * @access  Public
 */
router.get('/ready', async (req, res) => {
  const { isDegraded, data } = await probeDependencies();
  const statusCode = isDegraded ? 503 : 200;
  return res.status(statusCode).json({
    ...data,
    probe: 'readiness',
  });
});

/**
 * @route   GET /api/health
 * @desc    Backward compatibility health endpoint
 * @access  Public
 */
router.get('/', async (req, res) => {
  const { isDegraded, data } = await probeDependencies();
  const statusCode = isDegraded ? 503 : 200;
  return res.status(statusCode).json({
    ...data,
    probe: 'compatibility',
  });
});

module.exports = router;
