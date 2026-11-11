const express = require('express');
const { z } = require('zod');
const { pool } = require('../config/db');
const prisma = require('../config/prisma');
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
    const where = req.user.role === 'account_holder'
      ? { user_id: req.user.id, account_type: 'customer' }
      : {};

    const rows = await prisma.accounts.findMany({
      where,
      orderBy: { created_at: 'asc' },
      select: {
        id: true,
        account_number: true,
        balance_paise: true,
        account_type: true,
        user_id: true,
        created_at: true,
        updated_at: true,
      },
    });

    const accounts = rows.map((r) => ({
      ...r,
      balance_paise: r.balance_paise.toString(),
    }));

    return res.json({ accounts });
  } catch (err) {
    next(err);
  }
});

// Schema for account statement query parameters
const statementQuerySchema = z.object({
  include_refused: z.union([
    z.boolean(),
    z.enum(['true', 'false']).transform((val) => val === 'true'),
  ]).optional().default(false),
  from_date: z.string().datetime({ message: 'from_date must be a valid ISO 8601 timestamp' }).optional(),
  to_date: z.string().datetime({ message: 'to_date must be a valid ISO 8601 timestamp' }).optional(),
  limit: z.union([
    z.number().int().min(1).max(100),
    z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(1).max(100)),
  ]).optional().default(50),
  offset: z.union([
    z.number().int().min(0),
    z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(0)),
  ]).optional().default(0),
}).refine((data) => {
  if (data.from_date && data.to_date) {
    return new Date(data.from_date).getTime() <= new Date(data.to_date).getTime();
  }
  return true;
}, {
  message: 'from_date cannot be after to_date',
  path: ['from_date'],
});

/**
 * @route   GET /api/accounts/:id/statement
 * @desc    Get account statement with dual-regime ordering (legacy vs sequenced),
 *          running balances, account cutover metadata, and optional refused attempts.
 *          - Account holders: can only view statement for their own assigned account.
 *          - Admins and Auditors: can inspect any account statement.
 *          - Purely read-only: never mutates balances, ledger entries, or audit records.
 * @access  Private (account_holder, admin, auditor)
 */
router.get('/:id/statement', authenticateJWT, async (req, res, next) => {
  try {
    const idParam = uuidSchema.safeParse(req.params.id);
    if (!idParam.success) {
      return res.status(400).json({
        error: 'ValidationError',
        details: idParam.error.flatten().fieldErrors,
      });
    }

    const queryParsed = statementQuerySchema.safeParse(req.query);
    if (!queryParsed.success) {
      return res.status(400).json({
        error: 'ValidationError',
        details: queryParsed.error.flatten().fieldErrors,
      });
    }

    const accountId = idParam.data;
    const { include_refused, from_date, to_date, limit, offset } = queryParsed.data;

    // 1. Fetch account metadata
    const accountResult = await pool.query(
      `SELECT
         id,
         account_number,
         balance_paise,
         account_type,
         user_id,
         phase6_cutover_balance_paise,
         phase6_cutover_captured_at,
         next_entry_sequence,
         created_at,
         updated_at
       FROM public.accounts
       WHERE id = $1`,
      [accountId]
    );

    if (accountResult.rows.length === 0) {
      return res.status(404).json({
        error: 'NotFoundError',
        message: 'Account not found',
      });
    }

    const account = accountResult.rows[0];

    // 2. Ownership check: Account holders can only view their own assigned account
    if (req.user.role === 'account_holder') {
      if (!account.user_id || account.user_id !== req.user.id) {
        return res.status(403).json({
          error: 'ForbiddenError',
          message: 'Access denied: you do not own this account',
        });
      }
    }

    // 3. Count total matching entries for pagination
    const countResult = await pool.query(
      `SELECT COUNT(*) AS total_count
       FROM public.ledger_entries le
       WHERE le.account_id = $1
         AND ($2::timestamptz IS NULL OR le.created_at >= $2)
         AND ($3::timestamptz IS NULL OR le.created_at <= $3)`,
      [accountId, from_date || null, to_date || null]
    );
    const totalEntries = parseInt(countResult.rows[0].total_count, 10);

    // 4. Fetch completed ledger entries using the approved dual-regime ordering:
    //    - Legacy entries (sequence IS NULL) first, ordered chronologically by created_at ASC
    //    - Phase 6 sequenced entries second, ordered strictly by account_entry_sequence ASC
    const entriesResult = await pool.query(
      `SELECT
         le.id AS entry_id,
         le.transfer_id,
         le.entry_type,
         le.amount_paise,
         le.balance_after_paise,
         le.account_entry_sequence,
         le.created_at,
         t.transfer_type,
         t.created_by_user_id,
         u.username AS created_by_username
       FROM public.ledger_entries le
       JOIN public.transfers t ON t.id = le.transfer_id
       LEFT JOIN public.users u ON u.id = t.created_by_user_id
       WHERE le.account_id = $1
         AND ($2::timestamptz IS NULL OR le.created_at >= $2)
         AND ($3::timestamptz IS NULL OR le.created_at <= $3)
       ORDER BY
         CASE WHEN le.account_entry_sequence IS NULL THEN 0 ELSE 1 END ASC,
         CASE WHEN le.account_entry_sequence IS NULL THEN le.created_at END ASC,
         le.account_entry_sequence ASC,
         le.id ASC
       LIMIT $4 OFFSET $5`,
      [accountId, from_date || null, to_date || null, limit, offset]
    );

    const formattedEntries = entriesResult.rows.map((row) => {
      const isLegacy = row.account_entry_sequence == null;
      return {
        id: row.entry_id,
        transferId: row.transfer_id,
        transferType: row.transfer_type,
        entryType: row.entry_type,
        amountPaise: row.amount_paise.toString(),
        balanceAfterPaise: row.balance_after_paise.toString(),
        accountEntrySequence: isLegacy ? null : row.account_entry_sequence.toString(),
        regime: isLegacy ? 'legacy_unsequenced' : 'sequenced',
        ...(isLegacy && {
          historicalNote: 'Legacy Phase 1-5 unsequenced entry. Ordered by transaction creation timestamp; sequence order is not authoritative.',
        }),
        createdAt: row.created_at,
        initiatedBy: row.created_by_user_id
          ? {
              userId: row.created_by_user_id,
              username: row.created_by_username,
            }
          : null,
      };
    });

    const responsePayload = {
      account: {
        id: account.id,
        accountNumber: account.account_number,
        accountType: account.account_type,
        currentBalancePaise: account.balance_paise.toString(),
        phase6CutoverBalancePaise:
          account.phase6_cutover_balance_paise != null
            ? account.phase6_cutover_balance_paise.toString()
            : null,
        phase6CutoverCapturedAt: account.phase6_cutover_captured_at,
        nextEntrySequence:
          account.next_entry_sequence != null
            ? account.next_entry_sequence.toString()
            : null,
      },
      statement: {
        entries: formattedEntries,
        pagination: {
          totalEntries,
          limit,
          offset,
          note: 'Offset pagination applies over the dual-regime total ordering. In an active ledger, offset pagination across separate requests can shift if concurrent transactions append new entries.',
        },
      },
    };

    // 5. Fetch refused attempts only when explicitly requested (include_refused=true)
    if (include_refused) {
      const refusedResult = await pool.query(
        `SELECT
           ara.id AS audit_id,
           ara.action,
           ara.attempted_amount_paise,
           ara.reason_code,
           ara.reason_message,
           ara.idempotency_key,
           ara.created_at,
           ara.user_id,
           u.username AS initiated_by_username
         FROM public.audit_refused_attempts ara
         LEFT JOIN public.users u ON u.id = ara.user_id
         WHERE ara.account_id = $1
           AND ($2::timestamptz IS NULL OR ara.created_at >= $2)
           AND ($3::timestamptz IS NULL OR ara.created_at <= $3)
         ORDER BY ara.created_at ASC, ara.id ASC`,
        [accountId, from_date || null, to_date || null]
      );

      responsePayload.refusedAttempts = refusedResult.rows.map((row) => ({
        id: row.audit_id,
        action: row.action,
        attemptedAmountPaise:
          row.attempted_amount_paise != null
            ? row.attempted_amount_paise.toString()
            : null,
        reasonCode: row.reason_code,
        reasonMessage: row.reason_message,
        idempotencyKey: row.idempotency_key,
        createdAt: row.created_at,
        initiatedBy: row.user_id
          ? {
              userId: row.user_id,
              username: row.initiated_by_username,
            }
          : null,
      }));

      responsePayload.refusedAttemptsNotice =
        'Includes refused attempts recorded for this account. Note: Refusals on nonexistent accounts (HTTP 404) are stored with account_id=NULL in the audit table to maintain database foreign key constraints and cannot be associated with any specific account statement.';
    }

    return res.json(responsePayload);
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
    const row = await prisma.accounts.findUnique({
      where: { id: accountId },
      select: {
        id: true,
        account_number: true,
        balance_paise: true,
        account_type: true,
        user_id: true,
        created_at: true,
        updated_at: true,
      },
    });

    if (!row) {
      return res.status(404).json({
        error: 'NotFoundError',
        message: 'Account not found',
      });
    }

    const account = {
      ...row,
      balance_paise: row.balance_paise.toString(),
    };

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
