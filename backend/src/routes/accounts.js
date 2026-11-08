const express = require('express');
const { z } = require('zod');
const { pool } = require('../config/db');
const { authenticateJWT, requireRole } = require('../middleware/auth');

const router = express.Router();

// General PostgreSQL-compatible UUID regex validator (supports RFC 4122 and special system UUIDs)
const uuidSchema = z.string().regex(
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,
  { message: 'Must be a valid UUID' }
);

// Schema for creating an account (Admin only)
const createAccountSchema = z.object({
  accountNumber: z.string().trim().min(1, 'Account number cannot be empty').max(32, 'Account number cannot exceed 32 characters'),
});

/**
 * @route   GET /api/accounts
 * @desc    List accounts.
 *          - Account holders: can ONLY see accounts assigned to their own user_id.
 *          - Admins and Auditors: can see all accounts.
 * @access  Private (account_holder, admin, auditor)
 */
router.get('/', authenticateJWT, async (req, res, next) => {
  try {
    let query;
    let params = [];

    if (req.user.role === 'account_holder') {
      // Strict ownership isolation: only return accounts assigned to this user
      query = `
        SELECT id, account_number, balance_paise, account_type, user_id, created_at, updated_at
        FROM public.accounts
        WHERE user_id = $1 AND account_type = 'customer'
        ORDER BY created_at ASC
      `;
      params = [req.user.id];
    } else {
      // Admins and Auditors can view all accounts
      query = `
        SELECT id, account_number, balance_paise, account_type, user_id, created_at, updated_at
        FROM public.accounts
        ORDER BY created_at ASC
      `;
    }

    const result = await pool.query(query, params);
    return res.json({ accounts: result.rows });
  } catch (err) {
    next(err);
  }
});

/**
 * @route   GET /api/accounts/:id
 * @desc    Get account details by ID.
 *          - Account holders: can only view their own assigned account. Unassigned or other accounts return 403.
 *          - Admins and Auditors: can inspect any account.
 * @access  Private (account_holder, admin, auditor)
 */
router.get('/:id', authenticateJWT, async (req, res, next) => {
  try {
    const idParam = uuidSchema.safeParse(req.params.id);
    if (!idParam.success) {
      return res.status(400).json({
        error: 'ValidationError',
        details: idParam.error.flatten().fieldErrors,
      });
    }

    const accountId = idParam.data;
    const result = await pool.query(
      `SELECT id, account_number, balance_paise, account_type, user_id, created_at, updated_at
       FROM public.accounts
       WHERE id = $1`,
      [accountId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'NotFoundError',
        message: 'Account not found',
      });
    }

    const account = result.rows[0];

    // Ownership check for account_holder:
    if (req.user.role === 'account_holder') {
      if (!account.user_id || account.user_id !== req.user.id) {
        return res.status(403).json({
          error: 'ForbiddenError',
          message: 'Access denied: you do not own this account',
        });
      }
    }

    return res.json({ account });
  } catch (err) {
    next(err);
  }
});

/**
 * @route   POST /api/accounts
 * @desc    Create a new customer account.
 *          - Strictly Admin only.
 *          - Account is created unassigned (user_id NULL) with zero balance.
 *          - Complies with column-level grant: INSERT (account_number) for ledgerline_app.
 * @access  Private (Admin only)
 */
router.post('/', authenticateJWT, requireRole('admin'), async (req, res, next) => {
  try {
    const rawNumber = req.body.accountNumber || req.body.account_number;
    const parseResult = createAccountSchema.safeParse({ accountNumber: rawNumber });

    if (!parseResult.success) {
      return res.status(400).json({
        error: 'ValidationError',
        details: parseResult.error.flatten().fieldErrors,
      });
    }

    const { accountNumber } = parseResult.data;

    // runtime role ledgerline_app has column-level INSERT only on (account_number)
    const result = await pool.query(
      `INSERT INTO public.accounts (account_number)
       VALUES ($1)
       RETURNING id, account_number, balance_paise, account_type, user_id, created_at, updated_at`,
      [accountNumber]
    );

    return res.status(201).json({
      message: 'Account created successfully',
      account: result.rows[0],
    });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({
        error: 'ConflictError',
        message: 'An account with this account number already exists',
      });
    }
    next(err);
  }
});

module.exports = router;
