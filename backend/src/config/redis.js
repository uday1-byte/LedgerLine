const Redis = require('ioredis');
const env = require('./env');

let client = null;
let isConnected = false;
let lastErrorMessage = null;
let connectPromise = null;

function buildRedisOptions() {
  const options = {
    lazyConnect: true,
    enableOfflineQueue: false,
    connectTimeout: 5000,
    disconnectTimeout: 200,
    keepAlive: 30000,
    maxRetriesPerRequest: 1,
    retryStrategy(times) {
      // Exponential backoff with a cap of 2000ms
      return Math.min(times * 50, 2000);
    },
  };

  if (env.REDIS_URL) {
    // Support both IPv4 and IPv6 DNS resolution for Render Key Value and TLS endpoints
    options.family = 0;
  }

  if (env.REDIS_PASSWORD) {
    options.password = env.REDIS_PASSWORD;
  }

  if (env.REDIS_TLS) {
    options.tls = {};
  }

  return options;
}

function attachClientListeners(redisClient) {
  redisClient.on('connect', () => {
    // TCP socket opened; remain not-ready until TLS/AUTH and 'ready' complete
    isConnected = false;
  });

  redisClient.on('ready', () => {
    isConnected = true;
    lastErrorMessage = null;
  });

  redisClient.on('reconnecting', () => {
    isConnected = false;
  });

  redisClient.on('close', () => {
    isConnected = false;
  });

  redisClient.on('end', () => {
    isConnected = false;
  });

  redisClient.on('error', (err) => {
    isConnected = false;
    lastErrorMessage = err.message || 'Redis connection error';
    // Log connection warning without exposing REDIS_URL or credentials
    if (process.env.NODE_ENV !== 'test') {
      console.warn(`[Redis] Connection warning: ${lastErrorMessage}`);
    }
  });
}

function startConnect(redisClient) {
  if (!redisClient || redisClient.isMock) return Promise.resolve();
  if (redisClient.status === 'ready') {
    isConnected = true;
    return Promise.resolve();
  }
  if (connectPromise) return connectPromise;

  if (redisClient.status === 'wait') {
    connectPromise = redisClient
      .connect()
      .catch((err) => {
        isConnected = false;
        lastErrorMessage = err.message || 'Redis connection attempt failed';
        if (process.env.NODE_ENV !== 'test') {
          console.warn(`[Redis] Initial connection attempt deferred: ${lastErrorMessage}`);
        }
      })
      .finally(() => {
        connectPromise = null;
      });
    return connectPromise;
  }

  return Promise.resolve();
}

function waitForRedisReady(redisClient, timeoutMs = 1500) {
  if (!redisClient) {
    return Promise.reject(new Error('Redis client not initialized'));
  }
  if (redisClient.isMock || redisClient.status === 'ready') {
    isConnected = true;
    return Promise.resolve();
  }
  if (redisClient.status === 'end') {
    return Promise.reject(new Error(lastErrorMessage || 'Redis connection has ended'));
  }

  // Initiate connection if client is still in lazyConnect 'wait' state
  startConnect(redisClient);

  return new Promise((resolve, reject) => {
    if (redisClient.status === 'ready') {
      isConnected = true;
      return resolve();
    }

    let settled = false;
    let timer = null;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      redisClient.removeListener('ready', onReady);
      redisClient.removeListener('end', onEnd);
    };

    const onReady = () => {
      if (settled) return;
      settled = true;
      cleanup();
      isConnected = true;
      lastErrorMessage = null;
      resolve();
    };

    const onEnd = () => {
      if (settled) return;
      settled = true;
      cleanup();
      isConnected = false;
      reject(new Error(lastErrorMessage || 'Redis connection closed before becoming ready'));
    };

    redisClient.on('ready', onReady);
    redisClient.on('end', onEnd);

    timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(
        new Error(
          lastErrorMessage || `Redis client not ready within ${timeoutMs}ms (status: ${redisClient.status})`
        )
      );
    }, timeoutMs);
  });
}

function initializeRedis() {
  if (client && client.status !== 'end') {
    return client;
  }

  const options = buildRedisOptions();
  isConnected = false;
  lastErrorMessage = null;

  try {
    const trimmedUrl = typeof env.REDIS_URL === 'string' ? env.REDIS_URL.trim() : '';
    if (trimmedUrl) {
      client = new Redis(trimmedUrl, options);
    } else {
      client = new Redis({
        host: env.REDIS_HOST,
        port: env.REDIS_PORT,
        ...options,
      });
    }

    attachClientListeners(client);
    startConnect(client);
  } catch (err) {
    isConnected = false;
    lastErrorMessage = err.message || 'Redis client initialization failed';
    if (process.env.NODE_ENV !== 'test') {
      console.warn(`[Redis] Client initialization notice: ${lastErrorMessage}`);
    }
  }

  return client;
}

// Wait for readiness when connecting/reconnecting, then verify live connectivity with PING
async function checkRedisConnection({ timeoutMs = 1500 } = {}) {
  if (!client || (!client.isMock && client.status === 'end')) {
    initializeRedis();
  }
  if (!client) {
    return { connected: false, error: lastErrorMessage || 'Redis client not initialized' };
  }

  try {
    if (!client.isMock && client.status !== 'ready') {
      await waitForRedisReady(client, timeoutMs);
    }

    const pong = await client.ping();
    if (pong === 'PONG') {
      isConnected = true;
      lastErrorMessage = null;
      return { connected: true };
    }
    isConnected = false;
    return { connected: false, error: `Unexpected PING response: ${pong}` };
  } catch (err) {
    isConnected = false;
    return { connected: false, error: err.message || 'Redis PING failed' };
  }
}

function isRedisReady() {
  if (!isConnected || !client) return false;
  if (client.isMock) return true;
  return client.status === 'ready';
}

function getRedisClient() {
  if (!client || (!client.isMock && client.status === 'end')) {
    initializeRedis();
  }
  return client;
}

async function closeRedis() {
  if (client) {
    const closingClient = client;
    client = null;
    isConnected = false;
    connectPromise = null;
    lastErrorMessage = null;
    try {
      if (closingClient.status === 'ready' || closingClient.isMock) {
        await closingClient.quit();
      } else {
        closingClient.disconnect();
        if (typeof closingClient.once === 'function' && closingClient.status !== 'end') {
          await new Promise((resolve) => {
            const timer = setTimeout(resolve, 300);
            closingClient.once('end', () => {
              clearTimeout(timer);
              resolve();
            });
          });
        }
      }
    } catch (_) {
      closingClient.disconnect();
    }
  }
}

function setRedisClientForTesting(mockClient) {
  client = mockClient;
  isConnected = Boolean(mockClient);
  connectPromise = null;
  lastErrorMessage = null;
  if (client) {
    client.isMock = true;
  }
}

module.exports = {
  buildRedisOptions,
  initializeRedis,
  getRedisClient,
  checkRedisConnection,
  isRedisReady,
  closeRedis,
  setRedisClientForTesting,
};
