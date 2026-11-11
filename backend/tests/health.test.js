const request = require('supertest');
const RedisMock = require('ioredis-mock');
const app = require('../src/app');
const { setRedisClientForTesting, closeRedis } = require('../src/config/redis');
const { pool } = require('../src/config/db');
const prisma = require('../src/config/prisma');

describe('Health & Readiness Endpoints', () => {
  let mockRedis;

  beforeAll(async () => {
    mockRedis = new RedisMock();
    setRedisClientForTesting(mockRedis);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await closeRedis();
    await pool.end();
    await prisma.$disconnect();
  });

  describe('GET / (Root Welcome)', () => {
    it('should return 200 OK and welcome payload', async () => {
      const res = await request(app).get('/');

      expect(res.statusCode).toBe(200);
      expect(res.body).toHaveProperty('message');
      expect(res.body.message).toContain('LedgerLine');
    });
  });

  describe('GET /api/health/live (Liveness Probe)', () => {
    it('should return 200 OK without dependencies even if Redis is disconnected', async () => {
      setRedisClientForTesting(null);

      const res = await request(app).get('/api/health/live');

      expect(res.statusCode).toBe(200);
      expect(res.body).toHaveProperty('status', 'healthy');
      expect(res.body).toHaveProperty('probe', 'liveness');
      expect(res.body).toHaveProperty('uptime');
      expect(res.body).toHaveProperty('timestamp');
    });

    it('should return 200 OK without querying PostgreSQL or Prisma', async () => {
      setRedisClientForTesting(null);
      const poolSpy = jest.spyOn(pool, 'connect').mockRejectedValue(new Error('DB down'));
      const prismaSpy = jest.spyOn(prisma, '$queryRaw').mockRejectedValue(new Error('Prisma down'));

      const res = await request(app).get('/api/health/live');

      expect(res.statusCode).toBe(200);
      expect(res.body).toHaveProperty('status', 'healthy');
      expect(res.body).toHaveProperty('probe', 'liveness');
      expect(poolSpy).not.toHaveBeenCalled();
      expect(prismaSpy).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/health/ready (Readiness Probe)', () => {
    it('should return 200 OK when PostgreSQL, Prisma, and Redis are connected', async () => {
      setRedisClientForTesting(mockRedis);

      const res = await request(app).get('/api/health/ready');

      expect(res.statusCode).toBe(200);
      expect(res.body).toHaveProperty('status', 'healthy');
      expect(res.body).toHaveProperty('probe', 'readiness');
      expect(res.body.dependencies.database.status).toBe('connected');
      expect(res.body.dependencies.database.details.prisma).toBe('connected');
      expect(res.body.dependencies.redis.status).toBe('connected');
      expect(res.body.dependencies.redis.details.status).toBe('ready');
    });

    it('should return 503 Service Unavailable when Redis is disconnected', async () => {
      setRedisClientForTesting(null);

      const res = await request(app).get('/api/health/ready');

      expect(res.statusCode).toBe(503);
      expect(res.body).toHaveProperty('status', 'degraded');
      expect(res.body.dependencies.redis.status).toBe('disconnected');
    });

    it('should return 503 Service Unavailable when PostgreSQL is unavailable', async () => {
      setRedisClientForTesting(mockRedis);
      jest.spyOn(pool, 'connect').mockRejectedValueOnce(new Error('PostgreSQL unavailable'));

      const res = await request(app).get('/api/health/ready');

      expect(res.statusCode).toBe(503);
      expect(res.body).toHaveProperty('status', 'degraded');
      expect(res.body).toHaveProperty('probe', 'readiness');
      expect(res.body.dependencies.database.status).toBe('disconnected');
      expect(res.body.dependencies.redis.status).toBe('connected');
    });

    it('should return 503 Service Unavailable when Prisma check fails', async () => {
      setRedisClientForTesting(mockRedis);
      jest.spyOn(prisma, '$queryRaw').mockRejectedValueOnce(new Error('Prisma query failed'));

      const res = await request(app).get('/api/health/ready');

      expect(res.statusCode).toBe(503);
      expect(res.body).toHaveProperty('status', 'degraded');
      expect(res.body).toHaveProperty('probe', 'readiness');
      expect(res.body.dependencies.database.status).toBe('disconnected');
      expect(res.body.dependencies.redis.status).toBe('connected');
    });
  });

  describe('GET /api/health (Backward Compatibility Endpoint)', () => {
    it('should return health payload with dependency details', async () => {
      setRedisClientForTesting(mockRedis);

      const res = await request(app).get('/api/health');

      expect(res.statusCode).toBe(200);
      expect(res.body).toHaveProperty('status', 'healthy');
      expect(res.body.dependencies).toBeDefined();
    });
  });

  describe('GET /api/unknown-route', () => {
    it('should return 404 for undefined routes', async () => {
      const res = await request(app).get('/api/unknown-route');

      expect(res.statusCode).toBe(404);
      expect(res.body).toHaveProperty('error', 'NotFound');
    });
  });
});
