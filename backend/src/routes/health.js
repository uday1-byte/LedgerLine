const express = require('express');
const { testConnection } = require('../config/db');
const env = require('../config/env');

const router = express.Router();

/**
 * @route   GET /api/health
 * @desc    Check API server and database health status
 * @access  Public
 */
router.get('/', async (req, res) => {
  const checkDb = req.query.db === 'true';
  let dbStatus = 'untested';
  let dbDetails = null;

  if (checkDb) {
    try {
      const result = await testConnection();
      dbStatus = 'connected';
      dbDetails = {
        database: result.database,
      };
    } catch (err) {
      dbStatus = 'disconnected';
      dbDetails = {
        error: err.message,
      };
    }
  }

  const statusCode = dbStatus === 'disconnected' ? 503 : 200;

  return res.status(statusCode).json({
    status: dbStatus === 'disconnected' ? 'degraded' : 'healthy',
    service: 'LedgerLine API',
    environment: env.NODE_ENV,
    uptime: `${process.uptime().toFixed(1)}s`,
    timestamp: new Date().toISOString(),
    database: {
      status: dbStatus,
      ...(dbDetails && { details: dbDetails }),
    },
  });
});

module.exports = router;
