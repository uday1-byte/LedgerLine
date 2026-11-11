const net = require('net');
const Redis = require('ioredis');
const env = require('../src/config/env');
const redisConfig = require('../src/config/redis');

/**
 * Helper to start a lightweight TCP RESP server implementing INFO, PING, and QUIT
 * for deterministic ioredis connection, disconnect, and reconnection tests.
 */
function createMockRespServer(listenPort = 0) {
  const sockets = new Set();

  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));

    socket.on('data', (chunk) => {
      const upper = chunk.toString('utf8').toUpperCase();
      if (upper.includes('PING')) {
        socket.write('+PONG\r\n');
      } else if (upper.includes('INFO')) {
        socket.write('$0\r\n\r\n');
      } else if (upper.includes('QUIT')) {
        socket.write('+OK\r\n');
        socket.end();
      } else {
        socket.write('+OK\r\n');
      }
    });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(listenPort, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        port: address.port,
        closeAllSockets() {
          for (const sock of sockets) {
            sock.destroy();
          }
          sockets.clear();
        },
        close() {
          this.closeAllSockets();
          return new Promise((res) => server.close(() => res()));
        },
      });
    });
  });
}

function getUnusedEphemeralPort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

describe('Redis Connection Lifecycle & Resilience', () => {
  const originalHost = env.REDIS_HOST;
  const originalPort = env.REDIS_PORT;
  const originalUrl = env.REDIS_URL;
  const originalPassword = env.REDIS_PASSWORD;
  const originalTls = env.REDIS_TLS;
  let activeServer = null;

  afterEach(async () => {
    await redisConfig.closeRedis();
    if (activeServer) {
      await activeServer.close();
      activeServer = null;
    }
    env.REDIS_HOST = originalHost;
    env.REDIS_PORT = originalPort;
    env.REDIS_URL = originalUrl;
    env.REDIS_PASSWORD = originalPassword;
    env.REDIS_TLS = originalTls;
  });

  it('waits for lazyConnect handshake to reach ready state on checkRedisConnection() without stream-not-writeable errors', async () => {
    activeServer = await createMockRespServer(0);
    env.REDIS_URL = undefined;
    env.REDIS_HOST = '127.0.0.1';
    env.REDIS_PORT = activeServer.port;
    env.REDIS_PASSWORD = '';
    env.REDIS_TLS = false;

    const result = await redisConfig.checkRedisConnection({ timeoutMs: 2000 });

    expect(result).toEqual({ connected: true });
    expect(redisConfig.isRedisReady()).toBe(true);
  });

  it('does not mark client ready on raw TCP connect before ready state', async () => {
    activeServer = await createMockRespServer(0);
    env.REDIS_URL = undefined;
    env.REDIS_HOST = '127.0.0.1';
    env.REDIS_PORT = activeServer.port;
    env.REDIS_PASSWORD = '';
    env.REDIS_TLS = false;

    const client = redisConfig.initializeRedis();
    expect(client).toBeTruthy();

    // Immediately after initializeRedis(), socket is not ready yet
    if (client.status !== 'ready') {
      expect(redisConfig.isRedisReady()).toBe(false);
    }

    const result = await redisConfig.checkRedisConnection({ timeoutMs: 2000 });
    expect(result).toEqual({ connected: true });
    expect(redisConfig.isRedisReady()).toBe(true);
  });

  it('reports unavailable Redis cleanly when server is unreachable', async () => {
    const closedPort = await getUnusedEphemeralPort();
    env.REDIS_URL = undefined;
    env.REDIS_HOST = '127.0.0.1';
    env.REDIS_PORT = closedPort;
    env.REDIS_PASSWORD = '';
    env.REDIS_TLS = false;

    const result = await redisConfig.checkRedisConnection({ timeoutMs: 300 });

    expect(result.connected).toBe(false);
    expect(typeof result.error).toBe('string');
    expect(result.error.length).toBeGreaterThan(0);
    expect(redisConfig.isRedisReady()).toBe(false);
  });

  it('marks Redis disconnected on socket drop and recovers to ready upon reconnection', async () => {
    activeServer = await createMockRespServer(0);
    const fixedPort = activeServer.port;

    env.REDIS_URL = `redis://127.0.0.1:${fixedPort}`;
    env.REDIS_PASSWORD = '';
    env.REDIS_TLS = false;

    const firstCheck = await redisConfig.checkRedisConnection({ timeoutMs: 2000 });
    expect(firstCheck).toEqual({ connected: true });
    expect(redisConfig.isRedisReady()).toBe(true);

    // Simulate Redis outage / connection drop
    await activeServer.close();
    activeServer = null;

    // Wait briefly for close event to propagate
    await new Promise((res) => setTimeout(res, 50));
    expect(redisConfig.isRedisReady()).toBe(false);

    // Restart mock Redis server on the same port and verify automatic reconnection
    activeServer = await createMockRespServer(fixedPort);

    const recoveredCheck = await redisConfig.checkRedisConnection({ timeoutMs: 2500 });
    expect(recoveredCheck).toEqual({ connected: true });
    expect(redisConfig.isRedisReady()).toBe(true);
  });

  it('supports both plain internal redis:// and TLS external rediss:// connection URLs without exposing credentials', () => {
    env.REDIS_URL = 'redis://red-internal-host:6379';
    env.REDIS_PASSWORD = '';
    env.REDIS_TLS = false;

    const internalClient = new Redis(env.REDIS_URL, redisConfig.buildRedisOptions());
    expect(internalClient.options.host).toBe('red-internal-host');
    expect(internalClient.options.port).toBe(6379);
    expect(Boolean(internalClient.options.tls)).toBe(false);
    expect(internalClient.options.enableOfflineQueue).toBe(false);
    expect(internalClient.options.family).toBe(0);
    internalClient.disconnect();

    env.REDIS_URL = 'rediss://default:example_pass@red-external-host.render.com:6379';
    const tlsClient = new Redis(env.REDIS_URL, redisConfig.buildRedisOptions());
    expect(tlsClient.options.host).toBe('red-external-host.render.com');
    expect(tlsClient.options.port).toBe(6379);
    expect(Boolean(tlsClient.options.tls)).toBe(true);
    expect(tlsClient.options.enableOfflineQueue).toBe(false);
    expect(tlsClient.options.family).toBe(0);
    tlsClient.disconnect();
  });
});
