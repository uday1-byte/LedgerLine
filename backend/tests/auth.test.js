const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../src/app');
const { pool } = require('../src/config/db');
const env = require('../src/config/env');
const { createTestUser, ownerPool } = require('./helpers/auth');

describe('Authentication Foundation & RBAC Middleware Tests (Phase 5 Step 1)', () => {
  afterAll(async () => {
    await pool.end();
    await ownerPool.end();
  });

  describe('POST /api/auth/register', () => {
    it('should register a new user successfully with account_holder role', async () => {
      const username = `reg_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
      const email = `${username}@test.com`;

      const res = await request(app)
        .post('/api/auth/register')
        .send({
          username,
          email,
          password: 'SecurePassword123',
        });

      expect(res.statusCode).toBe(201);
      expect(res.body).toHaveProperty('user');
      expect(res.body.user).toHaveProperty('id');
      expect(res.body.user.username).toBe(username);
      expect(res.body.user.email).toBe(email);
      expect(res.body.user.role).toBe('account_holder');
      expect(res.body.user.is_active).toBe(true);

      // Verify password_hash is NEVER exposed in API response
      expect(res.body.user).not.toHaveProperty('password_hash');
      expect(res.body.user).not.toHaveProperty('password');

      // Verify database record
      const dbRes = await pool.query('SELECT role, is_active FROM public.users WHERE id = $1', [
        res.body.user.id,
      ]);
      expect(dbRes.rows[0].role).toBe('account_holder');
      expect(dbRes.rows[0].is_active).toBe(true);
    });

    it('should ignore or reject attempted role escalation to admin or auditor', async () => {
      const username = `esc_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
      const email = `${username}@test.com`;

      const res = await request(app)
        .post('/api/auth/register')
        .send({
          username,
          email,
          password: 'SecurePassword123',
          role: 'admin', // Attempted escalation
          is_active: false, // Attempted status override
        });

      expect(res.statusCode).toBe(201);
      // The user must remain account_holder regardless of caller input
      expect(res.body.user.role).toBe('account_holder');
      expect(res.body.user.is_active).toBe(true);

      const dbRes = await pool.query('SELECT role FROM public.users WHERE id = $1', [
        res.body.user.id,
      ]);
      expect(dbRes.rows[0].role).toBe('account_holder');
    });

    it('should reject invalid passwords failing complexity or length rules', async () => {
      // 1. Too short (<8 chars)
      const resShort = await request(app)
        .post('/api/auth/register')
        .send({
          username: `short_${Date.now()}`,
          email: `short_${Date.now()}@test.com`,
          password: 'Pass1',
        });
      expect(resShort.statusCode).toBe(400);
      expect(resShort.body.message).toContain('at least 8 characters long');

      // 2. Letters only (no numbers)
      const resLettersOnly = await request(app)
        .post('/api/auth/register')
        .send({
          username: `let_${Date.now()}`,
          email: `let_${Date.now()}@test.com`,
          password: 'JustLettersPassword',
        });
      expect(resLettersOnly.statusCode).toBe(400);
      expect(resLettersOnly.body.message).toContain('at least one letter and one number');

      // 3. Numbers only (no letters)
      const resNumbersOnly = await request(app)
        .post('/api/auth/register')
        .send({
          username: `num_${Date.now()}`,
          email: `num_${Date.now()}@test.com`,
          password: '123456789012',
        });
      expect(resNumbersOnly.statusCode).toBe(400);
      expect(resNumbersOnly.body.message).toContain('at least one letter and one number');
    });

    it('should reject duplicate username or email with 409 Conflict', async () => {
      const username = `dup_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
      const email = `${username}@test.com`;

      const firstRes = await request(app)
        .post('/api/auth/register')
        .send({ username, email, password: 'Password123' });
      expect(firstRes.statusCode).toBe(201);

      // Attempt duplicate registration
      const dupRes = await request(app)
        .post('/api/auth/register')
        .send({ username, email, password: 'Password123' });
      expect(dupRes.statusCode).toBe(409);
      expect(dupRes.body.error).toBe('ConflictError');
    });

    it('should reject empty registration payload with 400 and clear validation message (not 500)', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({});

      expect(res.statusCode).toBe(400);
      expect(res.body.error).toBe('ValidationError');
      expect(typeof res.body.message).toBe('string');
      expect(res.body.message).not.toContain('Cannot read properties');
    });
  });

  describe('POST /api/auth/login', () => {
    it('should succeed with valid email and password, returning JWT token', async () => {
      const { user, rawPassword } = await createTestUser();

      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: user.email,
          password: rawPassword,
        });

      expect(res.statusCode).toBe(200);
      expect(res.body).toHaveProperty('token');
      expect(typeof res.body.token).toBe('string');
      expect(res.body).toHaveProperty('user');
      expect(res.body.user.id).toBe(user.id);
      expect(res.body.user.email).toBe(user.email);
      expect(res.body.user).not.toHaveProperty('password_hash');
    });

    it('should fail with 401 when password is incorrect', async () => {
      const { user } = await createTestUser();

      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: user.email,
          password: 'WrongPassword999',
        });

      expect(res.statusCode).toBe(401);
      expect(res.body.message).toBe('Invalid email or password');
      expect(res.body).not.toHaveProperty('token');
    });

    it('should fail safely with 401 for unknown email without leaking existence', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: `unknown_${Date.now()}@doesnotexist.com`,
          password: 'AnyPassword123',
        });

      expect(res.statusCode).toBe(401);
      expect(res.body.message).toBe('Invalid email or password');
      expect(res.body).not.toHaveProperty('token');
    });

    it('should reject invalid login email format with 400 and clear validation message (not 500)', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'invalid_email_format',
          password: 'AnyPassword123',
        });

      expect(res.statusCode).toBe(400);
      expect(res.body.error).toBe('ValidationError');
      expect(res.body.message).toContain('Invalid email address format');
      expect(res.body.message).not.toContain('Cannot read properties');
    });

    it('should reject empty login payload with 400 and clear validation message (not 500)', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({});

      expect(res.statusCode).toBe(400);
      expect(res.body.error).toBe('ValidationError');
      expect(typeof res.body.message).toBe('string');
      expect(res.body.message).not.toContain('Cannot read properties');
    });
  });

  describe('JWT Verification & authenticateJWT Middleware (GET /api/auth/me)', () => {
    it('should return 200 OK and current user profile with valid JWT', async () => {
      const { user, token } = await createTestUser();

      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.user.id).toBe(user.id);
      expect(res.body.user.email).toBe(user.email);
      expect(res.body.user.role).toBe('account_holder');
      expect(res.body.user.is_active).toBe(true);
      expect(res.body.user).not.toHaveProperty('password_hash');
    });

    it('should reject requests with missing Authorization header', async () => {
      const res = await request(app).get('/api/auth/me');

      expect(res.statusCode).toBe(401);
      expect(res.body.message).toContain('missing or malformed');
    });

    it('should reject tampered JWT tokens', async () => {
      const { token } = await createTestUser();
      const tamperedToken = token.slice(0, -6) + 'abcdef';

      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${tamperedToken}`);

      expect(res.statusCode).toBe(401);
      expect(res.body.message).toContain('Invalid token');
    });

    it('should reject expired JWT tokens', async () => {
      const { user } = await createTestUser();
      // Generate an expired token with 0s lifetime
      const expiredToken = jwt.sign({ sub: user.id }, env.JWT_SECRET, { expiresIn: '0s' });

      // Small pause to guarantee expiration timestamp
      await new Promise((r) => setTimeout(r, 50));

      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${expiredToken}`);

      expect(res.statusCode).toBe(401);
      expect(res.body.message).toContain('Token has expired');
    });

    it('should reject deactivated users even if token signature is valid', async () => {
      const { user, token } = await createTestUser({ isActive: true });

      // Verify active user can access endpoint
      const activeRes = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token}`);
      expect(activeRes.statusCode).toBe(200);

      // Deactivate user in database via owner pool
      await ownerPool.query('UPDATE public.users SET is_active = FALSE WHERE id = $1', [user.id]);

      // Subsequent request with the same token must be immediately rejected
      const deactivatedRes = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token}`);

      expect(deactivatedRes.statusCode).toBe(403);
      expect(deactivatedRes.body.message).toContain('deactivated');
    });

    it('should immediately reflect database role changes on subsequent requests', async () => {
      const { user, token } = await createTestUser({ role: 'account_holder' });

      // First request: role is account_holder
      const firstRes = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token}`);
      expect(firstRes.statusCode).toBe(200);
      expect(firstRes.body.user.role).toBe('account_holder');

      // Promote user to admin directly in database via owner pool
      await ownerPool.query("UPDATE public.users SET role = 'admin' WHERE id = $1", [user.id]);

      // Next request using the same token observes the updated role from the database
      const secondRes = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token}`);
      expect(secondRes.statusCode).toBe(200);
      expect(secondRes.body.user.role).toBe('admin');
    });
  });
});
