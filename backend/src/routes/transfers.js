const express = require('express');
const crypto = require('crypto');
const { z } = require('zod');
const { pool } = require('../config/db');
const { authenticateJWT, requireRole } = require('../middleware/auth');
const { financialMutationLimiter } = require('../middleware/rateLimiter');
const auditService = require('../services/auditService');

const SYSTEM_CASH_CLEARING_ID = '00000000-0000-0000-0000-000000000002';

const router = express.Router();

// Input validation schema for basic transfer
const transferSchema = z.object({
  sourceAccountId: z.string().uuid({ message: 'sourceAccountId must be a valid UUID' }),
  destinationAccountId: z.string().uuid({ message: 'destinationAccountId must be a valid UUID' }),
  amountPaise: z.union([
    z.number().int().positive({ message: 'amountPaise must be a positive integer' }),
    z.string().regex(/^\d+$/, { message: 'amountPaise must be a positive integer string' }).transform((val) => parseInt(val, 10))
  ]),
}).refine((data) => data.sourceAccountId !== data.destinationAccountId, {
  message: 'sourceAccountId and destinationAccountId must be different accounts',
  path: ['destinationAccountId'],
});

// Input validation schema for transfer reversal
const reversalSchema = z.object({
  reversalReason: z.string().trim().min(1, { message: 'reversalReason cannot be empty' }).max(255).optional().default('Customer requested reversal'),
});

const PG_MAX_BIGINT = 9223372036854775807n;

// Reusable amount validation: safe integer or decimal string <= PG_MAX_BIGINT
const amountPaiseSchema = z.union([
  z.number()
    .refine((val) => Number.isSafeInteger(val) && val > 0, {
      message: 'amountPaise must be a positive safe integer',
    })
    .transform((val) => BigInt(val)),
  z.string()
    .regex(/^[1-9]\d*$/, { message: 'amountPaise must be a positive decimal digit string' })
    .transform((val) => BigInt(val)),
]).refine((val) => val <= PG_MAX_BIGINT, {
  message: `amountPaise exceeds maximum allowed value (${PG_MAX_BIGINT.toString()})`,
});

// Input validation schema for customer deposits
const depositSchema = z.object({
  accountId: z.string().regex(
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,
    { message: 'accountId must be a valid UUID' }
  ),
  amountPaise: amountPaiseSchema,
});

// Input validation schema for customer withdrawals
const withdrawalSchema = z.object({
  accountId: z.string().regex(
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,
    { message: 'accountId must be a valid UUID' }
  ),
  amountPaise: amountPaiseSchema,
});

/**
 * @route   POST /api/transfers
 * @desc    Execute an idempotent money transfer between two accounts with double-entry ledger entries
 * @access  Private (account_holder, admin)
 */
router.post('/', authenticateJWT, requireRole('admin', 'account_holder'), financialMutationLimiter, async (req, res, next) => {
  // 1. Validate mandatory Idempotency-Key header
  const idempotencyKey = req.header('Idempotency-Key');
  if (!idempotencyKey || typeof idempotencyKey !== 'string' || idempotencyKey.trim().length === 0) {
    return res.status(400).json({
      error: 'ValidationError',
      message: 'Idempotency-Key header is required for financial transactions',
    });
  }

  const cleanKey = idempotencyKey.trim();

  // 2. Validate request body
  const parseResult = transferSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({
      error: 'ValidationError',
      details: parseResult.error.flatten().fieldErrors,
    });
  }

  const { sourceAccountId, destinationAccountId, amountPaise } = parseResult.data;

  // 3. Compute deterministic request hash and partition client_scope per funding account
  const canonicalPayload = JSON.stringify({
    sourceAccountId,
    destinationAccountId,
    amountPaise: amountPaise.toString(),
  });
  const requestHash = crypto.createHash('sha256').update(canonicalPayload).digest('hex');
  const clientScope = `account:${sourceAccountId}`;

  const client = await pool.connect();
  try {
    // 4. Bounded, transaction-safe idempotency claim-and-resolve loop
    const MAX_IDEMPOTENCY_ATTEMPTS = 3;
    let idempotencyClaimed = false;

    for (let attempt = 1; attempt <= MAX_IDEMPOTENCY_ATTEMPTS; attempt++) {
      await client.query('BEGIN');

      // Attempt to claim the key atomically
      const insertKeyResult = await client.query(
        `INSERT INTO idempotency_keys (client_scope, key, request_hash, status, created_at, updated_at)
         VALUES ($1, $2, $3, 'processing', NOW(), NOW())
         ON CONFLICT (client_scope, key) DO NOTHING
         RETURNING key`,
        [clientScope, cleanKey, requestHash]
      );

      if (insertKeyResult.rowCount === 1) {
        // Key successfully claimed in active transaction; proceed with transfer execution
        idempotencyClaimed = true;
        break;
      }

      // Key exists; wait for in-flight transaction using SELECT ... FOR UPDATE
      const existingKeyResult = await client.query(
        `SELECT client_scope, key, request_hash, status, response_code, response_body
         FROM idempotency_keys
         WHERE client_scope = $1 AND key = $2
         FOR UPDATE`,
        [clientScope, cleanKey]
      );

      const existing = existingKeyResult.rows[0];

      if (!existing) {
        // Prior transaction that held the key rolled back; rollback this attempt and re-claim cleanly
        await client.query('ROLLBACK');
        continue;
      }

      // Payload validation: same key cannot be used with different logical parameters
      if (existing.request_hash !== requestHash) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: 'IdempotencyConflictError',
          message: 'Idempotency key has already been used with a different request payload',
        });
      }

      // Replay committed result
      if (existing.status === 'completed') {
        await client.query('COMMIT');
        res.setHeader('Idempotent-Replayed', 'true');
        return res.status(existing.response_code || 200).json(existing.response_body);
      }

      // If status is still processing after lock acquisition, another request is actively executing
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'ConcurrentRequestError',
        message: 'A concurrent request with this idempotency key is already in progress',
      });
    }

    if (!idempotencyClaimed) {
      return res.status(503).json({
        error: 'ConcurrencyConflictError',
        message: 'Unable to acquire idempotency lock after multiple attempts; please retry',
      });
    }

    // 5. Lock both accounts in deterministic order (ORDER BY id) with SELECT ... FOR UPDATE
    // Note: Deterministic row locking (ORDER BY id) reduces deadlock risk for transactions locking
    // the same pair of accounts, but does not guarantee complete system-wide deadlock freedom.
    const accountsResult = await client.query(
      `SELECT id, account_number, balance_paise, user_id
       FROM accounts
       WHERE id IN ($1, $2)
       ORDER BY id
       FOR UPDATE`,
      [sourceAccountId, destinationAccountId]
    );

    // Verify source account exists
    const sourceAccount = accountsResult.rows.find((r) => r.id === sourceAccountId);
    if (!sourceAccount) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        error: 'NotFoundError',
        message: 'Source account not found',
      });
    }

    // Authorization: Account holders can ONLY transfer from accounts they own.
    // Unassigned accounts or accounts owned by others return 403 Forbidden.
    if (req.user.role === 'account_holder') {
      if (!sourceAccount.user_id || sourceAccount.user_id !== req.user.id) {
        await client.query('ROLLBACK');
        return res.status(403).json({
          error: 'ForbiddenError',
          message: 'Access denied: You are not authorized to transfer funds from this account',
        });
      }
    }

    // Verify destination account exists
    const destAccount = accountsResult.rows.find((r) => r.id === destinationAccountId);
    if (!destAccount) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        error: 'NotFoundError',
        message: 'Destination account not found',
      });
    }

    const sourceBalance = BigInt(sourceAccount.balance_paise);
    const transferAmount = BigInt(amountPaise);

    // 7. Check whether the sender has sufficient funds using the locked balance
    if (sourceBalance < transferAmount) {
      await client.query('ROLLBACK');
      return res.status(422).json({
        error: 'InsufficientFundsError',
        message: 'Sender has insufficient funds for this transfer',
        currentBalancePaise: sourceBalance.toString(),
        attemptedAmountPaise: transferAmount.toString(),
      });
    }

    // 8. Deduct the amount from the sender with defense-in-depth conditional check
    const updatedSource = await client.query(
      `UPDATE accounts
       SET balance_paise = balance_paise - $1, updated_at = NOW()
       WHERE id = $2 AND balance_paise >= $1
       RETURNING balance_paise`,
      [transferAmount.toString(), sourceAccountId]
    );

    if (updatedSource.rowCount !== 1) {
      await client.query('ROLLBACK');
      return res.status(422).json({
        error: 'InsufficientFundsError',
        message: 'Sender has insufficient funds for this transfer',
        currentBalancePaise: sourceBalance.toString(),
        attemptedAmountPaise: transferAmount.toString(),
      });
    }

    // 9. Credit the receiver
    const updatedDest = await client.query(
      `UPDATE accounts
       SET balance_paise = balance_paise + $1, updated_at = NOW()
       WHERE id = $2
       RETURNING balance_paise`,
      [transferAmount.toString(), destinationAccountId]
    );

    // 10. Record the transfer record
    const transferRecord = await client.query(
      `INSERT INTO transfers (source_account_id, destination_account_id, amount_paise, status, transfer_type)
       VALUES ($1, $2, $3, 'completed', 'customer_transfer')
       RETURNING id, source_account_id, destination_account_id, amount_paise, status, created_at`,
      [sourceAccountId, destinationAccountId, transferAmount.toString()]
    );

    const createdTransfer = transferRecord.rows[0];

    // 11. Generate exactly two double-entry ledger entries (1 debit for sender, 1 credit for receiver)
    // Sender Debit Entry
    await client.query(
      `INSERT INTO ledger_entries (transfer_id, account_id, entry_type, amount_paise, balance_after_paise)
       VALUES ($1, $2, 'debit', $3, $4)`,
      [
        createdTransfer.id,
        sourceAccountId,
        transferAmount.toString(),
        updatedSource.rows[0].balance_paise,
      ]
    );

    // Receiver Credit Entry
    await client.query(
      `INSERT INTO ledger_entries (transfer_id, account_id, entry_type, amount_paise, balance_after_paise)
       VALUES ($1, $2, 'credit', $3, $4)`,
      [
        createdTransfer.id,
        destinationAccountId,
        transferAmount.toString(),
        updatedDest.rows[0].balance_paise,
      ]
    );

    const responseBody = {
      message: 'Transfer completed successfully',
      transfer: {
        id: createdTransfer.id,
        sourceAccountId: createdTransfer.source_account_id,
        destinationAccountId: createdTransfer.destination_account_id,
        amountPaise: createdTransfer.amount_paise.toString(),
        status: createdTransfer.status,
        createdAt: createdTransfer.created_at,
      },
      updatedBalances: {
        sourceAccountId,
        sourceBalancePaise: updatedSource.rows[0].balance_paise.toString(),
        destinationAccountId,
        destinationBalancePaise: updatedDest.rows[0].balance_paise.toString(),
      },
    };

    // 12. Update Idempotency Key to completed status
    await client.query(
      `UPDATE idempotency_keys
       SET status = 'completed',
           response_code = 201,
           response_body = $1,
           transfer_id = $2,
           updated_at = NOW()
       WHERE client_scope = $3 AND key = $4`,
      [responseBody, createdTransfer.id, clientScope, cleanKey]
    );

    // 13. Commit database transaction (evaluates deferred constraint triggers)
    await client.query('COMMIT');

    // 14. Return transfer confirmation
    return res.status(201).json(responseBody);
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

/**
 * @route   POST /api/transfers/deposit
 * @desc    Execute an idempotent cash deposit crediting customer account and debiting SYSTEM_CASH_CLEARING
 * @access  Private (account_holder, admin)
 */
router.post('/deposit', authenticateJWT, requireRole('admin', 'account_holder'), financialMutationLimiter, async (req, res, next) => {
  // 1. Validate mandatory Idempotency-Key header
  const idempotencyKey = req.header('Idempotency-Key');
  if (!idempotencyKey || typeof idempotencyKey !== 'string' || idempotencyKey.trim().length === 0) {
    return res.status(400).json({
      error: 'ValidationError',
      message: 'Idempotency-Key header is required for financial transactions',
    });
  }

  const cleanKey = idempotencyKey.trim();

  // 2. Validate request body
  const parseResult = depositSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({
      error: 'ValidationError',
      details: parseResult.error.flatten().fieldErrors,
    });
  }

  const { accountId, amountPaise } = parseResult.data;

  // 3. Compute deterministic request hash and client_scope per target account
  const canonicalPayload = JSON.stringify({
    accountId,
    amountPaise: amountPaise.toString(),
    action: 'deposit',
  });
  const requestHash = crypto.createHash('sha256').update(canonicalPayload).digest('hex');
  const clientScope = `deposit:${accountId}`;

  const client = await pool.connect();
  let clientReleased = false;

  try {
    // 4. Bounded, transaction-safe idempotency claim-and-resolve loop
    const MAX_IDEMPOTENCY_ATTEMPTS = 3;
    let idempotencyClaimed = false;

    for (let attempt = 1; attempt <= MAX_IDEMPOTENCY_ATTEMPTS; attempt++) {
      await client.query('BEGIN');

      const insertKeyResult = await client.query(
        `INSERT INTO idempotency_keys (client_scope, key, request_hash, status, created_at, updated_at)
         VALUES ($1, $2, $3, 'processing', NOW(), NOW())
         ON CONFLICT (client_scope, key) DO NOTHING
         RETURNING key`,
        [clientScope, cleanKey, requestHash]
      );

      if (insertKeyResult.rowCount === 1) {
        idempotencyClaimed = true;
        break;
      }

      const existingKeyResult = await client.query(
        `SELECT client_scope, key, request_hash, status, response_code, response_body
         FROM idempotency_keys
         WHERE client_scope = $1 AND key = $2
         FOR UPDATE`,
        [clientScope, cleanKey]
      );

      const existing = existingKeyResult.rows[0];

      if (!existing) {
        await client.query('ROLLBACK');
        continue;
      }

      if (existing.request_hash !== requestHash) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: 'IdempotencyConflictError',
          message: 'Idempotency key has already been used with a different request payload',
        });
      }

      if (existing.status === 'completed') {
        await client.query('COMMIT');
        res.setHeader('Idempotent-Replayed', 'true');
        return res.status(existing.response_code || 201).json(existing.response_body);
      }

      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'ConcurrentRequestError',
        message: 'A concurrent request with this idempotency key is already in progress',
      });
    }

    if (!idempotencyClaimed) {
      return res.status(503).json({
        error: 'ConcurrencyConflictError',
        message: 'Unable to acquire idempotency lock after multiple attempts; please retry',
      });
    }

    // 5. Lock both accounts in deterministic order (ORDER BY id ASC) with SELECT ... FOR UPDATE
    const accountsResult = await client.query(
      `SELECT id, account_number, balance_paise, account_type, user_id, next_entry_sequence
       FROM accounts
       WHERE id IN ($1, $2)
       ORDER BY id ASC
       FOR UPDATE`,
      [SYSTEM_CASH_CLEARING_ID, accountId]
    );

    const clearingAccount = accountsResult.rows.find((r) => r.id === SYSTEM_CASH_CLEARING_ID);
    if (!clearingAccount) {
      await client.query('ROLLBACK');
      client.release();
      clientReleased = true;
      return res.status(500).json({
        error: 'ConfigurationError',
        message: 'System cash clearing account is not provisioned',
      });
    }

    const customerAccount = accountsResult.rows.find((r) => r.id === accountId);
    if (!customerAccount) {
      await client.query('ROLLBACK');
      client.release();
      clientReleased = true;

      try {
        await auditService.recordRefusalAudit({
          userId: req.user.id,
          attemptedAccountId: accountId,
          accountExists: false,
          action: 'deposit',
          amountPaise,
          reasonCode: 'ACCOUNT_NOT_FOUND',
          reasonMessage: `Target account not found: ${accountId}`,
          idempotencyKey: cleanKey,
          clientIp: req.ip,
        });
      } catch (auditErr) {
        return auditService.sendAuditPersistenceFailure(res, auditErr);
      }

      return res.status(404).json({
        error: 'NotFoundError',
        message: 'Target account not found',
      });
    }

    // 6. Verify target account is a customer account (cannot deposit into system accounts)
    if (customerAccount.account_type !== 'customer') {
      await client.query('ROLLBACK');
      client.release();
      clientReleased = true;

      try {
        await auditService.recordRefusalAudit({
          userId: req.user.id,
          accountId: customerAccount.id,
          accountExists: true,
          action: 'deposit',
          amountPaise,
          reasonCode: 'INVALID_ACCOUNT_TYPE',
          reasonMessage: `Cannot deposit into system account of type '${customerAccount.account_type}'`,
          idempotencyKey: cleanKey,
          clientIp: req.ip,
        });
      } catch (auditErr) {
        return auditService.sendAuditPersistenceFailure(res, auditErr);
      }

      return res.status(422).json({
        error: 'InvariantViolationError',
        message: 'Cannot deposit into system accounts',
      });
    }

    // 7. Authorization: Account holders can ONLY deposit into accounts they own
    if (req.user.role === 'account_holder') {
      if (!customerAccount.user_id || customerAccount.user_id !== req.user.id) {
        await client.query('ROLLBACK');
        client.release();
        clientReleased = true;

        try {
          await auditService.recordRefusalAudit({
            userId: req.user.id,
            accountId: customerAccount.id,
            accountExists: true,
            action: 'deposit',
            amountPaise,
            reasonCode: 'FORBIDDEN_OWNERSHIP',
            reasonMessage: 'Access denied: You are not authorized to deposit into this account',
            idempotencyKey: cleanKey,
            clientIp: req.ip,
          });
        } catch (auditErr) {
          return auditService.sendAuditPersistenceFailure(res, auditErr);
        }

        return res.status(403).json({
          error: 'ForbiddenError',
          message: 'Access denied: You are not authorized to deposit into this account',
        });
      }
    }

    // 8. Capture sequences and update account balances atomically
    const clearingSeq = BigInt(clearingAccount.next_entry_sequence);
    const customerSeq = BigInt(customerAccount.next_entry_sequence);

    // Debit clearing account: balance_paise = balance_paise - amountPaise
    const updatedClearing = await client.query(
      `UPDATE accounts
       SET balance_paise = balance_paise - $1,
           next_entry_sequence = next_entry_sequence + 1,
           updated_at = NOW()
       WHERE id = $2
       RETURNING balance_paise, next_entry_sequence`,
      [amountPaise.toString(), SYSTEM_CASH_CLEARING_ID]
    );

    // Credit customer account: balance_paise = balance_paise + amountPaise
    const updatedCustomer = await client.query(
      `UPDATE accounts
       SET balance_paise = balance_paise + $1,
           next_entry_sequence = next_entry_sequence + 1,
           updated_at = NOW()
       WHERE id = $2
       RETURNING balance_paise, next_entry_sequence`,
      [amountPaise.toString(), accountId]
    );

    // 9. Record transfer record (transfer_type='deposit')
    const transferRecord = await client.query(
      `INSERT INTO transfers (
         source_account_id, destination_account_id, amount_paise, status, transfer_type, created_by_user_id
       )
       VALUES ($1, $2, $3, 'completed', 'deposit', $4)
       RETURNING id, source_account_id, destination_account_id, amount_paise, status, transfer_type, created_by_user_id, created_at`,
      [SYSTEM_CASH_CLEARING_ID, accountId, amountPaise.toString(), req.user.id]
    );

    const createdTransfer = transferRecord.rows[0];

    // 10. Record double-entry ledger entries
    // Clearing account debit entry
    await client.query(
      `INSERT INTO ledger_entries (
         transfer_id, account_id, entry_type, amount_paise, balance_after_paise, account_entry_sequence
       )
       VALUES ($1, $2, 'debit', $3, $4, $5)`,
      [
        createdTransfer.id,
        SYSTEM_CASH_CLEARING_ID,
        amountPaise.toString(),
        updatedClearing.rows[0].balance_paise,
        clearingSeq.toString(),
      ]
    );

    // Customer account credit entry
    await client.query(
      `INSERT INTO ledger_entries (
         transfer_id, account_id, entry_type, amount_paise, balance_after_paise, account_entry_sequence
       )
       VALUES ($1, $2, 'credit', $3, $4, $5)`,
      [
        createdTransfer.id,
        accountId,
        amountPaise.toString(),
        updatedCustomer.rows[0].balance_paise,
        customerSeq.toString(),
      ]
    );

    // 11. Prepare response body
    const responseBody = {
      message: 'Deposit completed successfully',
      transfer: {
        id: createdTransfer.id,
        transferType: createdTransfer.transfer_type,
        sourceAccountId: createdTransfer.source_account_id,
        destinationAccountId: createdTransfer.destination_account_id,
        amountPaise: createdTransfer.amount_paise.toString(),
        status: createdTransfer.status,
        createdByUserId: createdTransfer.created_by_user_id,
        createdAt: createdTransfer.created_at,
      },
      account: {
        id: accountId,
        balancePaise: updatedCustomer.rows[0].balance_paise.toString(),
        accountEntrySequence: customerSeq.toString(),
      },
    };

    // 12. Update Idempotency Key to completed status
    await client.query(
      `UPDATE idempotency_keys
       SET status = 'completed',
           response_code = 201,
           response_body = $1,
           transfer_id = $2,
           updated_at = NOW()
       WHERE client_scope = $3 AND key = $4`,
      [responseBody, createdTransfer.id, clientScope, cleanKey]
    );

    // 13. Commit transaction (evaluates deferred balancing trigger)
    await client.query('COMMIT');

    // 14. Return deposit confirmation
    return res.status(201).json(responseBody);
  } catch (err) {
    if (!clientReleased) {
      try {
        await client.query('ROLLBACK');
      } catch (_) {}
    }
    next(err);
  } finally {
    if (!clientReleased) {
      client.release();
    }
  }
});

/**
 * @route   POST /api/transfers/withdraw
 * @desc    Execute an idempotent cash withdrawal debiting customer account and crediting SYSTEM_CASH_CLEARING
 * @access  Private (account_holder, admin)
 */
router.post('/withdraw', authenticateJWT, requireRole('admin', 'account_holder'), financialMutationLimiter, async (req, res, next) => {
  // 1. Validate mandatory Idempotency-Key header
  const idempotencyKey = req.header('Idempotency-Key');
  if (!idempotencyKey || typeof idempotencyKey !== 'string' || idempotencyKey.trim().length === 0) {
    return res.status(400).json({
      error: 'ValidationError',
      message: 'Idempotency-Key header is required for financial transactions',
    });
  }

  const cleanKey = idempotencyKey.trim();

  // 2. Validate request body (including BigInt range safety <= PG_MAX_BIGINT)
  const parseResult = withdrawalSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({
      error: 'ValidationError',
      details: parseResult.error.flatten().fieldErrors,
    });
  }

  const { accountId, amountPaise } = parseResult.data;

  // 3. Compute deterministic request hash and client_scope per source account
  const canonicalPayload = JSON.stringify({
    accountId,
    amountPaise: amountPaise.toString(),
    action: 'withdraw',
  });
  const requestHash = crypto.createHash('sha256').update(canonicalPayload).digest('hex');
  const clientScope = `withdraw:${accountId}`;

  const client = await pool.connect();
  let clientReleased = false;

  try {
    // 4. Bounded, transaction-safe idempotency claim-and-resolve loop
    const MAX_IDEMPOTENCY_ATTEMPTS = 3;
    let idempotencyClaimed = false;

    for (let attempt = 1; attempt <= MAX_IDEMPOTENCY_ATTEMPTS; attempt++) {
      await client.query('BEGIN');

      const insertKeyResult = await client.query(
        `INSERT INTO idempotency_keys (client_scope, key, request_hash, status, created_at, updated_at)
         VALUES ($1, $2, $3, 'processing', NOW(), NOW())
         ON CONFLICT (client_scope, key) DO NOTHING
         RETURNING key`,
        [clientScope, cleanKey, requestHash]
      );

      if (insertKeyResult.rowCount === 1) {
        idempotencyClaimed = true;
        break;
      }

      const existingKeyResult = await client.query(
        `SELECT client_scope, key, request_hash, status, response_code, response_body
         FROM idempotency_keys
         WHERE client_scope = $1 AND key = $2
         FOR UPDATE`,
        [clientScope, cleanKey]
      );

      const existing = existingKeyResult.rows[0];

      if (!existing) {
        await client.query('ROLLBACK');
        continue;
      }

      if (existing.request_hash !== requestHash) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: 'IdempotencyConflictError',
          message: 'Idempotency key has already been used with a different request payload',
        });
      }

      if (existing.status === 'completed') {
        await client.query('COMMIT');
        res.setHeader('Idempotent-Replayed', 'true');
        return res.status(existing.response_code || 201).json(existing.response_body);
      }

      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'ConcurrentRequestError',
        message: 'A concurrent request with this idempotency key is already in progress',
      });
    }

    if (!idempotencyClaimed) {
      return res.status(503).json({
        error: 'ConcurrencyConflictError',
        message: 'Unable to acquire idempotency lock after multiple attempts; please retry',
      });
    }

    // 5. Lock both accounts in deterministic order (ORDER BY id ASC) with SELECT ... FOR UPDATE
    const accountsResult = await client.query(
      `SELECT id, account_number, balance_paise, account_type, user_id, next_entry_sequence
       FROM accounts
       WHERE id IN ($1, $2)
       ORDER BY id ASC
       FOR UPDATE`,
      [SYSTEM_CASH_CLEARING_ID, accountId]
    );

    const clearingAccount = accountsResult.rows.find((r) => r.id === SYSTEM_CASH_CLEARING_ID);
    if (!clearingAccount) {
      await client.query('ROLLBACK');
      client.release();
      clientReleased = true;
      return res.status(500).json({
        error: 'ConfigurationError',
        message: 'System cash clearing account is not provisioned',
      });
    }

    const customerAccount = accountsResult.rows.find((r) => r.id === accountId);
    if (!customerAccount) {
      await client.query('ROLLBACK');
      client.release();
      clientReleased = true;

      try {
        await auditService.recordRefusalAudit({
          userId: req.user.id,
          attemptedAccountId: accountId,
          accountExists: false,
          action: 'withdrawal',
          amountPaise,
          reasonCode: 'ACCOUNT_NOT_FOUND',
          reasonMessage: `Target account not found: ${accountId}`,
          idempotencyKey: cleanKey,
          clientIp: req.ip,
        });
      } catch (auditErr) {
        return auditService.sendAuditPersistenceFailure(res, auditErr);
      }

      return res.status(404).json({
        error: 'NotFoundError',
        message: 'Target account not found',
      });
    }

    // 6. Verify target account is a customer account (cannot withdraw from system accounts)
    if (customerAccount.account_type !== 'customer') {
      await client.query('ROLLBACK');
      client.release();
      clientReleased = true;

      try {
        await auditService.recordRefusalAudit({
          userId: req.user.id,
          accountId: customerAccount.id,
          accountExists: true,
          action: 'withdrawal',
          amountPaise,
          reasonCode: 'INVALID_ACCOUNT_TYPE',
          reasonMessage: `Cannot withdraw from system account of type '${customerAccount.account_type}'`,
          idempotencyKey: cleanKey,
          clientIp: req.ip,
        });
      } catch (auditErr) {
        return auditService.sendAuditPersistenceFailure(res, auditErr);
      }

      return res.status(422).json({
        error: 'InvariantViolationError',
        message: 'Cannot withdraw from system accounts',
      });
    }

    // 7. Authorization: Account holders can ONLY withdraw from accounts they own
    if (req.user.role === 'account_holder') {
      if (!customerAccount.user_id || customerAccount.user_id !== req.user.id) {
        await client.query('ROLLBACK');
        client.release();
        clientReleased = true;

        try {
          await auditService.recordRefusalAudit({
            userId: req.user.id,
            accountId: customerAccount.id,
            accountExists: true,
            action: 'withdrawal',
            amountPaise,
            reasonCode: 'FORBIDDEN_OWNERSHIP',
            reasonMessage: 'Access denied: You are not authorized to withdraw from this account',
            idempotencyKey: cleanKey,
            clientIp: req.ip,
          });
        } catch (auditErr) {
          return auditService.sendAuditPersistenceFailure(res, auditErr);
        }

        return res.status(403).json({
          error: 'ForbiddenError',
          message: 'Access denied: You are not authorized to withdraw from this account',
        });
      }
    }

    // 8. Balance check: verify sender has sufficient funds using locked balance
    const customerBalance = BigInt(customerAccount.balance_paise);
    if (customerBalance < amountPaise) {
      await client.query('ROLLBACK');
      client.release();
      clientReleased = true;

      try {
        await auditService.recordRefusalAudit({
          userId: req.user.id,
          accountId: customerAccount.id,
          accountExists: true,
          action: 'withdrawal',
          amountPaise,
          reasonCode: 'INSUFFICIENT_FUNDS',
          reasonMessage: 'Sender has insufficient funds for this withdrawal',
          idempotencyKey: cleanKey,
          clientIp: req.ip,
        });
      } catch (auditErr) {
        return auditService.sendAuditPersistenceFailure(res, auditErr);
      }

      return res.status(422).json({
        error: 'InsufficientFundsError',
        message: 'Sender has insufficient funds for this withdrawal',
        currentBalancePaise: customerBalance.toString(),
        attemptedAmountPaise: amountPaise.toString(),
      });
    }

    // 9. Capture sequences and update account balances atomically
    const customerSeq = BigInt(customerAccount.next_entry_sequence);
    const clearingSeq = BigInt(clearingAccount.next_entry_sequence);

    // Debit customer account with defense-in-depth conditional check (balance_paise >= $1)
    const updatedCustomer = await client.query(
      `UPDATE accounts
       SET balance_paise = balance_paise - $1,
           next_entry_sequence = next_entry_sequence + 1,
           updated_at = NOW()
       WHERE id = $2 AND balance_paise >= $1
       RETURNING balance_paise, next_entry_sequence`,
      [amountPaise.toString(), accountId]
    );

    if (updatedCustomer.rowCount !== 1) {
      await client.query('ROLLBACK');
      client.release();
      clientReleased = true;

      try {
        await auditService.recordRefusalAudit({
          userId: req.user.id,
          accountId: customerAccount.id,
          accountExists: true,
          action: 'withdrawal',
          amountPaise,
          reasonCode: 'INSUFFICIENT_FUNDS',
          reasonMessage: 'Sender has insufficient funds for this withdrawal',
          idempotencyKey: cleanKey,
          clientIp: req.ip,
        });
      } catch (auditErr) {
        return auditService.sendAuditPersistenceFailure(res, auditErr);
      }

      return res.status(422).json({
        error: 'InsufficientFundsError',
        message: 'Sender has insufficient funds for this withdrawal',
        currentBalancePaise: customerBalance.toString(),
        attemptedAmountPaise: amountPaise.toString(),
      });
    }

    // Credit clearing account: balance_paise = balance_paise + amountPaise
    const updatedClearing = await client.query(
      `UPDATE accounts
       SET balance_paise = balance_paise + $1,
           next_entry_sequence = next_entry_sequence + 1,
           updated_at = NOW()
       WHERE id = $2
       RETURNING balance_paise, next_entry_sequence`,
      [amountPaise.toString(), SYSTEM_CASH_CLEARING_ID]
    );

    // 10. Record transfer record (transfer_type='withdrawal')
    const transferRecord = await client.query(
      `INSERT INTO transfers (
         source_account_id, destination_account_id, amount_paise, status, transfer_type, created_by_user_id
       )
       VALUES ($1, $2, $3, 'completed', 'withdrawal', $4)
       RETURNING id, source_account_id, destination_account_id, amount_paise, status, transfer_type, created_by_user_id, created_at`,
      [accountId, SYSTEM_CASH_CLEARING_ID, amountPaise.toString(), req.user.id]
    );

    const createdTransfer = transferRecord.rows[0];

    // 11. Record double-entry ledger entries
    // Customer account debit entry
    await client.query(
      `INSERT INTO ledger_entries (
         transfer_id, account_id, entry_type, amount_paise, balance_after_paise, account_entry_sequence
       )
       VALUES ($1, $2, 'debit', $3, $4, $5)`,
      [
        createdTransfer.id,
        accountId,
        amountPaise.toString(),
        updatedCustomer.rows[0].balance_paise,
        customerSeq.toString(),
      ]
    );

    // Clearing account credit entry
    await client.query(
      `INSERT INTO ledger_entries (
         transfer_id, account_id, entry_type, amount_paise, balance_after_paise, account_entry_sequence
       )
       VALUES ($1, $2, 'credit', $3, $4, $5)`,
      [
        createdTransfer.id,
        SYSTEM_CASH_CLEARING_ID,
        amountPaise.toString(),
        updatedClearing.rows[0].balance_paise,
        clearingSeq.toString(),
      ]
    );

    // 12. Prepare response body
    const responseBody = {
      message: 'Withdrawal completed successfully',
      transfer: {
        id: createdTransfer.id,
        transferType: createdTransfer.transfer_type,
        sourceAccountId: createdTransfer.source_account_id,
        destinationAccountId: createdTransfer.destination_account_id,
        amountPaise: createdTransfer.amount_paise.toString(),
        status: createdTransfer.status,
        createdByUserId: createdTransfer.created_by_user_id,
        createdAt: createdTransfer.created_at,
      },
      account: {
        id: accountId,
        balancePaise: updatedCustomer.rows[0].balance_paise.toString(),
        accountEntrySequence: customerSeq.toString(),
      },
    };

    // 13. Update Idempotency Key to completed status
    await client.query(
      `UPDATE idempotency_keys
       SET status = 'completed',
           response_code = 201,
           response_body = $1,
           transfer_id = $2,
           updated_at = NOW()
       WHERE client_scope = $3 AND key = $4`,
      [responseBody, createdTransfer.id, clientScope, cleanKey]
    );

    // 14. Commit transaction (evaluates deferred balancing trigger)
    await client.query('COMMIT');

    // 15. Return withdrawal confirmation
    return res.status(201).json(responseBody);
  } catch (err) {
    if (!clientReleased) {
      try {
        await client.query('ROLLBACK');
      } catch (_) {}
    }
    next(err);
  } finally {
    if (!clientReleased) {
      client.release();
    }
  }
});

/**
 * @route   POST /api/transfers/:id/reversal
 * @desc    Execute a compensating reversal for an existing customer transfer with double-entry ledger entries
 * @access  Private (account_holder, admin)
 */
router.post('/:id/reversal', authenticateJWT, requireRole('admin', 'account_holder'), financialMutationLimiter, async (req, res, next) => {
  // 1. Validate mandatory Idempotency-Key header
  const idempotencyKey = req.header('Idempotency-Key');
  if (!idempotencyKey || typeof idempotencyKey !== 'string' || idempotencyKey.trim().length === 0) {
    return res.status(400).json({
      error: 'ValidationError',
      message: 'Idempotency-Key header is required for financial transactions',
    });
  }

  const cleanKey = idempotencyKey.trim();

  // 2. Validate route parameter
  const idParamResult = z.string().uuid({ message: 'Transfer ID must be a valid UUID' }).safeParse(req.params.id);
  if (!idParamResult.success) {
    return res.status(400).json({
      error: 'ValidationError',
      details: idParamResult.error.flatten().fieldErrors,
    });
  }
  const originalTransferId = idParamResult.data;

  // 3. Validate optional reversal reason
  const bodyResult = reversalSchema.safeParse(req.body || {});
  if (!bodyResult.success) {
    return res.status(400).json({
      error: 'ValidationError',
      details: bodyResult.error.flatten().fieldErrors,
    });
  }
  const { reversalReason } = bodyResult.data;

  // 4. Compute deterministic reversal request hash and scope per original transfer
  const canonicalPayload = JSON.stringify({
    originalTransferId,
    reversalReason,
  });
  const requestHash = crypto.createHash('sha256').update(canonicalPayload).digest('hex');
  const clientScope = `reversal:${originalTransferId}`;

  const client = await pool.connect();
  try {
    // 5. Bounded, transaction-safe idempotency claim-and-resolve loop
    const MAX_IDEMPOTENCY_ATTEMPTS = 3;
    let idempotencyClaimed = false;

    for (let attempt = 1; attempt <= MAX_IDEMPOTENCY_ATTEMPTS; attempt++) {
      await client.query('BEGIN');

      // Attempt to claim the key atomically
      const insertKeyResult = await client.query(
        `INSERT INTO idempotency_keys (client_scope, key, request_hash, status, created_at, updated_at)
         VALUES ($1, $2, $3, 'processing', NOW(), NOW())
         ON CONFLICT (client_scope, key) DO NOTHING
         RETURNING key`,
        [clientScope, cleanKey, requestHash]
      );

      if (insertKeyResult.rowCount === 1) {
        // Key successfully claimed in active transaction; proceed with reversal execution
        idempotencyClaimed = true;
        break;
      }

      // Key exists; wait for in-flight transaction using SELECT ... FOR UPDATE
      const existingKeyResult = await client.query(
        `SELECT client_scope, key, request_hash, status, response_code, response_body
         FROM idempotency_keys
         WHERE client_scope = $1 AND key = $2
         FOR UPDATE`,
        [clientScope, cleanKey]
      );

      const existing = existingKeyResult.rows[0];

      if (!existing) {
        // Prior transaction that held the key rolled back; rollback this attempt and re-claim cleanly
        await client.query('ROLLBACK');
        continue;
      }

      // Payload validation: same key cannot be used with different logical parameters
      if (existing.request_hash !== requestHash) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: 'IdempotencyConflictError',
          message: 'Idempotency key has already been used with a different request payload',
        });
      }

      // Replay committed result
      if (existing.status === 'completed') {
        await client.query('COMMIT');
        res.setHeader('Idempotent-Replayed', 'true');
        return res.status(existing.response_code || 200).json(existing.response_body);
      }

      // If status is still processing after lock acquisition, another request is actively executing
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'ConcurrentRequestError',
        message: 'A concurrent request with this idempotency key is already in progress',
      });
    }

    if (!idempotencyClaimed) {
      return res.status(503).json({
        error: 'ConcurrencyConflictError',
        message: 'Unable to acquire idempotency lock after multiple attempts; please retry',
      });
    }

    // 6. Serialize concurrent reversal attempts for this original transfer
    // Acquire a PostgreSQL transaction-level advisory lock deterministically keyed to the transfer UUID
    const cleanUuidHex = originalTransferId.replace(/-/g, '');
    const lockKey1 = parseInt(cleanUuidHex.slice(0, 8), 16) | 0;
    const lockKey2 = parseInt(cleanUuidHex.slice(8, 16), 16) | 0;
    await client.query('SELECT pg_advisory_xact_lock($1, $2)', [lockKey1, lockKey2]);

    // 7. Fetch original transfer record with standard SELECT (serialized by advisory lock)
    const origResult = await client.query(
      `SELECT * FROM transfers WHERE id = $1`,
      [originalTransferId]
    );

    if (origResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        error: 'NotFoundError',
        message: 'Original transfer not found',
      });
    }

    const originalTransfer = origResult.rows[0];

    // Reversals only permitted on completed customer transfers
    if (originalTransfer.status !== 'completed' || originalTransfer.transfer_type !== 'customer_transfer') {
      await client.query('ROLLBACK');
      return res.status(422).json({
        error: 'InvalidTransferStateError',
        message: `Only completed customer transfers can be reversed (status: ${originalTransfer.status}, type: ${originalTransfer.transfer_type})`,
      });
    }

    // 8. Verify transfer has not already been reversed (protected by advisory lock and unique constraint)
    const existingReversal = await client.query(
      `SELECT id FROM transfers WHERE original_transfer_id = $1 AND transfer_type = 'reversal'`,
      [originalTransferId]
    );

    if (existingReversal.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'ConflictError',
        message: 'This transfer has already been reversed',
        reversalTransferId: existingReversal.rows[0].id,
      });
    }

    // Inverted accounts: debited party is original destination; credited party is original source
    const debitedAccountId = originalTransfer.destination_account_id;
    const creditedAccountId = originalTransfer.source_account_id;
    const refundAmount = BigInt(originalTransfer.amount_paise);

    // 8. Lock both accounts in deterministic order (ORDER BY id)
    // Note: Deterministic row locking (ORDER BY id) reduces deadlock risk for transactions locking
    // the same pair of accounts, but does not guarantee complete system-wide deadlock freedom.
    const accountsResult = await client.query(
      `SELECT id, balance_paise, user_id
       FROM accounts
       WHERE id IN ($1, $2)
       ORDER BY id
       FOR UPDATE`,
      [debitedAccountId, creditedAccountId]
    );

    const debitedAccount = accountsResult.rows.find((r) => r.id === debitedAccountId);
    const creditedAccount = accountsResult.rows.find((r) => r.id === creditedAccountId);

    if (!debitedAccount || !creditedAccount) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        error: 'NotFoundError',
        message: 'One or both accounts associated with the transfer no longer exist',
      });
    }

    // Authorization: In a reversal, funds are debited from the original destination account.
    // Account holders can ONLY reverse a transfer if they own the debited account.
    // Unassigned accounts or accounts owned by others return 403 Forbidden.
    if (req.user.role === 'account_holder') {
      if (!debitedAccount.user_id || debitedAccount.user_id !== req.user.id) {
        await client.query('ROLLBACK');
        return res.status(403).json({
          error: 'ForbiddenError',
          message: 'Access denied: You are not authorized to reverse this transfer: you do not own the debited account',
        });
      }
    }

    // 9. Solvency Check: The original destination must have sufficient balance to refund the money
    const debitedBalance = BigInt(debitedAccount.balance_paise);
    if (debitedBalance < refundAmount) {
      await client.query('ROLLBACK');
      return res.status(422).json({
        error: 'InsufficientFundsError',
        message: 'Destination account has insufficient funds to reverse this transfer',
        currentBalancePaise: debitedBalance.toString(),
        requiredAmountPaise: refundAmount.toString(),
      });
    }

    // 10. Deduct from original destination
    const updatedDebited = await client.query(
      `UPDATE accounts
       SET balance_paise = balance_paise - $1, updated_at = NOW()
       WHERE id = $2 AND balance_paise >= $1
       RETURNING balance_paise`,
      [refundAmount.toString(), debitedAccountId]
    );

    if (updatedDebited.rowCount !== 1) {
      await client.query('ROLLBACK');
      return res.status(422).json({
        error: 'InsufficientFundsError',
        message: 'Destination account has insufficient funds to reverse this transfer',
        currentBalancePaise: debitedBalance.toString(),
        requiredAmountPaise: refundAmount.toString(),
      });
    }

    // 11. Credit original source
    const updatedCredited = await client.query(
      `UPDATE accounts
       SET balance_paise = balance_paise + $1, updated_at = NOW()
       WHERE id = $2
       RETURNING balance_paise`,
      [refundAmount.toString(), creditedAccountId]
    );

    // 12. Insert compensating reversal transfer record
    const reversalRecord = await client.query(
      `INSERT INTO transfers (source_account_id, destination_account_id, amount_paise, status, transfer_type, original_transfer_id, reversal_reason)
       VALUES ($1, $2, $3, 'completed', 'reversal', $4, $5)
       RETURNING id, source_account_id, destination_account_id, amount_paise, status, transfer_type, original_transfer_id, reversal_reason, created_at`,
      [debitedAccountId, creditedAccountId, refundAmount.toString(), originalTransferId, reversalReason]
    );

    const createdReversal = reversalRecord.rows[0];

    // 13. Insert dual compensating ledger entries
    // Debit Entry on original recipient
    await client.query(
      `INSERT INTO ledger_entries (transfer_id, account_id, entry_type, amount_paise, balance_after_paise)
       VALUES ($1, $2, 'debit', $3, $4)`,
      [
        createdReversal.id,
        debitedAccountId,
        refundAmount.toString(),
        updatedDebited.rows[0].balance_paise,
      ]
    );

    // Credit Entry on original sender
    await client.query(
      `INSERT INTO ledger_entries (transfer_id, account_id, entry_type, amount_paise, balance_after_paise)
       VALUES ($1, $2, 'credit', $3, $4)`,
      [
        createdReversal.id,
        creditedAccountId,
        refundAmount.toString(),
        updatedCredited.rows[0].balance_paise,
      ]
    );

    const responseBody = {
      message: 'Transfer reversed successfully',
      reversal: {
        id: createdReversal.id,
        originalTransferId: createdReversal.original_transfer_id,
        sourceAccountId: createdReversal.source_account_id,
        destinationAccountId: createdReversal.destination_account_id,
        amountPaise: createdReversal.amount_paise.toString(),
        status: createdReversal.status,
        transferType: createdReversal.transfer_type,
        reversalReason: createdReversal.reversal_reason,
        createdAt: createdReversal.created_at,
      },
      reversalTransfer: {
        id: createdReversal.id,
        originalTransferId: createdReversal.original_transfer_id,
        sourceAccountId: createdReversal.source_account_id,
        destinationAccountId: createdReversal.destination_account_id,
        amountPaise: createdReversal.amount_paise.toString(),
        status: createdReversal.status,
        transferType: createdReversal.transfer_type,
        reversalReason: createdReversal.reversal_reason,
        createdAt: createdReversal.created_at,
      },
      restoredBalances: {
        sourceAccountId: creditedAccountId,
        sourceBalancePaise: updatedCredited.rows[0].balance_paise.toString(),
        destinationAccountId: debitedAccountId,
        destinationBalancePaise: updatedDebited.rows[0].balance_paise.toString(),
      },
      updatedBalances: {
        debitedAccountId,
        debitedBalancePaise: updatedDebited.rows[0].balance_paise.toString(),
        creditedAccountId,
        creditedBalancePaise: updatedCredited.rows[0].balance_paise.toString(),
      },
    };

    // 14. Update Idempotency Key to completed status
    await client.query(
      `UPDATE idempotency_keys
       SET status = 'completed',
           response_code = 201,
           response_body = $1,
           transfer_id = $2,
           updated_at = NOW()
       WHERE client_scope = $3 AND key = $4`,
      [responseBody, createdReversal.id, clientScope, cleanKey]
    );

    await client.query('COMMIT');

    return res.status(201).json(responseBody);
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

module.exports = router;
