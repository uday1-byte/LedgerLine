const { Pool } = require('pg');
const env = require('./env');

/**
 * Configure PostgreSQL connection pool.
 * Connection configuration is loaded strictly from environment variables.
 * Sensitive credentials like DB_PASSWORD are never hardcoded.
 */
const useSsl = env.DB_SSL || env.NODE_ENV === 'production';

const poolConfig = env.DATABASE_URL
  ? {
      connectionString: env.DATABASE_URL,
      ...(useSsl && { ssl: { rejectUnauthorized: true } }),
      max: 20, // Maximum number of clients in the pool
      idleTimeoutMillis: 30000, // Close idle clients after 30s
      connectionTimeoutMillis: 5000, // Return an error after 5s if connection cannot be established
    }
  : {
      host: env.DB_HOST,
      port: env.DB_PORT,
      database: env.DB_NAME,
      user: env.DB_USER,
      password: env.DB_PASSWORD,
      ssl: useSsl ? { rejectUnauthorized: true } : false,
      // Pool sizing and connection timeout
      max: 20, // Maximum number of clients in the pool
      idleTimeoutMillis: 30000, // Close idle clients after 30s
      connectionTimeoutMillis: 5000, // Return an error after 5s if connection cannot be established
    };

const pool = new Pool(poolConfig);

// Handle unexpected errors on idle pool clients
pool.on('error', (err) => {
  console.error('Unexpected error on idle PostgreSQL client:', err);
});

/**
 * Helper to execute queries safely.
 * Usage: const result = await query('SELECT $1::text as message', ['Hello']);
 */
const query = (text, params) => pool.query(text, params);

/**
 * Helper to verify database connectivity without modifying any tables.
 */
const testConnection = async () => {
  const client = await pool.connect();
  try {
    const res = await client.query('SELECT NOW() as current_time, current_database() as database');
    return {
      connected: true,
      database: res.rows[0].database,
      currentTime: res.rows[0].current_time,
    };
  } finally {
    client.release();
  }
};

module.exports = {
  pool,
  query,
  testConnection,
};
