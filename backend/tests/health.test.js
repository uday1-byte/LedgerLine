const request = require('supertest');
const app = require('../src/app');

describe('Health & Root Endpoints', () => {
  describe('GET /', () => {
    it('should return 200 OK and welcome payload', async () => {
      const res = await request(app).get('/');

      expect(res.statusCode).toBe(200);
      expect(res.body).toHaveProperty('message');
      expect(res.body.message).toContain('LedgerLine');
    });
  });

  describe('GET /api/health', () => {
    it('should return 200 OK with healthy status and metadata', async () => {
      const res = await request(app).get('/api/health');

      expect(res.statusCode).toBe(200);
      expect(res.body).toHaveProperty('status', 'healthy');
      expect(res.body).toHaveProperty('service', 'LedgerLine API');
      expect(res.body).toHaveProperty('environment');
      expect(res.body).toHaveProperty('uptime');
      expect(res.body).toHaveProperty('timestamp');
      expect(res.body.database).toHaveProperty('status', 'untested');
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
