const Redis = require('ioredis');
const env = require('./env');

let client = null;
let isConnected = false;

function buildRedisOptions() {
  const options = {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    retryStrategy(times) {
      // Exponential backoff with a cap of 2000ms
      const delay = Math.min(times * 50, 2000);
      return delay;
    },
  };

  if (env.REDIS_PASSWORD) {
    options.password = env.REDIS_PASSWORD;
  }

  if (env.REDIS_TLS) {
    options.tls = {};
  }

  return options;
}

function initializeRedis() {
  if (client) return client;

  const options = buildRedisOptions();

  try {
    if (env.REDIS_URL) {
      client = new Redis(env.REDIS_URL, options);
    } else {
      client = new Redis({
        host: env.REDIS_HOST,
        port: env.REDIS_PORT,
        ...options,
      });
    }

    client.on('connect', () => {
      isConnected = true;
    });

    client.on('ready', () => {
      isConnected = true;
    });

    client.on('close', () => {
      isConnected = false;
    });

    client.on('error', (err) => {
      isConnected = false;
      // Log connection error without crashing the process
      if (process.env.NODE_ENV !== 'test') {
        console.warn(`[Redis] Connection warning: ${err.message}`);
      }
    });

    // Attempt initial background connection
    client.connect().catch((err) => {
      isConnected = false;
      if (process.env.NODE_ENV !== 'test') {
        console.warn(`[Redis] Initial connection attempt deferred: ${err.message}`);
      }
    });
  } catch (err) {
    isConnected = false;
    if (process.env.NODE_ENV !== 'test') {
      console.warn(`[Redis] Client initialization notice: ${err.message}`);
    }
  }

  return client;
}

// Check live connection status with PING
async function checkRedisConnection() {
  if (!client) {
    initializeRedis();
  }
  if (!client) return { connected: false, error: 'Redis client not initialized' };

  try {
    const pong = await client.ping();
    if (pong === 'PONG') {
      isConnected = true;
      return { connected: true };
    }
    return { connected: false, error: `Unexpected PING response: ${pong}` };
  } catch (err) {
    isConnected = false;
    return { connected: false, error: err.message || 'Redis PING failed' };
  }
}

function isRedisReady() {
  if (!isConnected || !client) return false;
  if (client.isMock) return true;
  return client.status === 'ready' || client.status === 'connect';
}

function getRedisClient() {
  if (!client) {
    initializeRedis();
  }
  return client;
}

async function closeRedis() {
  if (client) {
    try {
      await client.quit();
    } catch (_) {
      client.disconnect();
    } finally {
      client = null;
      isConnected = false;
    }
  }
}

function setRedisClientForTesting(mockClient) {
  client = mockClient;
  isConnected = Boolean(mockClient);
  if (client) {
    client.isMock = true;
  }
}

module.exports = {
  getRedisClient,
  checkRedisConnection,
  isRedisReady,
  closeRedis,
  setRedisClientForTesting,
};
