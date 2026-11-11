const express = require('express');
const { z } = require('zod');
const { pool } = require('../config/db');
const {
  validatePasswordStrength,
  hashPassword,
  verifyPassword,
  dummyVerifyPassword,
} = require('../utils/password');
const { generateToken } = require('../utils/jwt');
const { authenticateJWT } = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimiter');

const router = express.Router();

// ─── Input Validation Schemas ────────────────────────────────────────────────

const registerSchema = z.object({
  username: z
    .string({ required_error: 'Username is required' })
    .trim()
    .min(3, 'Username must be at least 3 characters long')
    .max(64, 'Username must not exceed 64 characters')
    .regex(
      /^[a-zA-Z0-9_-]+$/,
      'Username can only contain alphanumeric characters, underscores, and hyphens'
    ),
  email: z
    .string({ required_error: 'Email is required' })
    .trim()
    .toLowerCase()
    .email('Invalid email address format')
    .max(255, 'Email must not exceed 255 characters'),
  password: z
    .string({ required_error: 'Password is required' }),
});

const loginSchema = z.object({
  email: z
    .string({ required_error: 'Email is required' })
    .trim()
    .toLowerCase()
    .email('Invalid email address format'),
  password: z
    .string({ required_error: 'Password is required' }),
});

// ─── 1. POST /api/auth/register ──────────────────────────────────────────────

router.post('/register', authLimiter, async (req, res, next) => {
  try {
    const parseResult = registerSchema.safeParse(req.body);
    if (!parseResult.success) {
      const message = parseResult.error.issues
        ? parseResult.error.issues.map((e) => e.message).join('; ')
        : 'Validation failed';
      return res.status(400).json({
        error: 'ValidationError',
        message,
      });
    }

    const { username, email, password } = parseResult.data;

    // Validate password complexity rules
    const passCheck = validatePasswordStrength(password);
    if (!passCheck.valid) {
      return res.status(400).json({
        error: 'ValidationError',
        message: passCheck.message,
      });
    }

    // Check for existing username or email
    const existing = await pool.query(
      `SELECT username, email FROM public.users WHERE username = $1 OR email = $2`,
      [username, email]
    );

    if (existing.rows.length > 0) {
      const isUsernameTaken = existing.rows.some(
        (r) => r.username.toLowerCase() === username.toLowerCase()
      );
      return res.status(409).json({
        error: 'ConflictError',
        message: isUsernameTaken
          ? 'Username is already taken'
          : 'Email is already registered',
      });
    }

    // Hash password with bcrypt work factor 12
    const passwordHash = await hashPassword(password);

    // Insert user: role defaults to 'account_holder' and is_active defaults to TRUE.
    // Notice: Any role or is_active supplied by caller in req.body was excluded by Zod parsing.
    const insertResult = await pool.query(
      `INSERT INTO public.users (username, email, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, username, email, role, is_active, created_at, updated_at`,
      [username, email, passwordHash]
    );

    const newUser = insertResult.rows[0];

    return res.status(201).json({
      message: 'User registered successfully',
      user: {
        id: newUser.id,
        username: newUser.username,
        email: newUser.email,
        role: newUser.role,
        is_active: newUser.is_active,
        created_at: newUser.created_at,
        updated_at: newUser.updated_at,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ─── 2. POST /api/auth/login ─────────────────────────────────────────────────

router.post('/login', authLimiter, async (req, res, next) => {
  try {
    const parseResult = loginSchema.safeParse(req.body);
    if (!parseResult.success) {
      const message = parseResult.error.issues
        ? parseResult.error.issues.map((e) => e.message).join('; ')
        : 'Validation failed';
      return res.status(400).json({
        error: 'ValidationError',
        message,
      });
    }

    const { email, password } = parseResult.data;

    // Look up user by email
    const userResult = await pool.query(
      `SELECT id, username, email, password_hash, role, is_active
       FROM public.users
       WHERE email = $1`,
      [email]
    );

    // Timing-attack defense: If user does not exist, execute dummy bcrypt comparison
    // against a precomputed work-factor-12 hash so response latency is indistinguishable
    // from a real password check.
    if (userResult.rows.length === 0) {
      await dummyVerifyPassword(password);
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid email or password',
      });
    }

    const user = userResult.rows[0];

    // Verify plaintext password against stored bcrypt hash
    const isPasswordValid = await verifyPassword(password, user.password_hash);
    if (!isPasswordValid) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid email or password',
      });
    }

    // Check account active status
    if (!user.is_active) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'User account is deactivated',
      });
    }

    // Generate signed JWT (payload contains only sub: user.id)
    const token = generateToken(user);

    return res.status(200).json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        is_active: user.is_active,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ─── 3. GET /api/auth/me ─────────────────────────────────────────────────────

router.get('/me', authenticateJWT, (req, res) => {
  return res.status(200).json({
    user: {
      id: req.user.id,
      username: req.user.username,
      email: req.user.email,
      role: req.user.role,
      is_active: req.user.is_active,
      created_at: req.user.created_at,
      updated_at: req.user.updated_at,
    },
  });
});

module.exports = router;
