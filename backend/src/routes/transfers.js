const express = require('express');
const { z } = require('zod');
const { pool } = require('../config/db');

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

/**
 * @route   POST /api/transfers
 * @desc    Execute a money transfer between two accounts with pessimistic row locking
 * @access  Public
 */
router.post('/', async (req, res, next) => {
  // 1. Validate request body
  const parseResult = transferSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({
      error: 'ValidationError',
      details: parseResult.error.flatten().fieldErrors,
    });
  }

  const { sourceAccountId, destinationAccountId, amountPaise } = parseResult.data;

  const client = await pool.connect();
  try {
    // 2. Begin database transaction
    await client.query('BEGIN');

    // 3. Lock both accounts in deterministic order (ORDER BY id) with SELECT ... FOR UPDATE
    const accountsResult = await client.query(
      `SELECT id, account_number, balance_paise
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

    // 4. Check whether the sender has sufficient funds using the locked balance
    if (sourceBalance < transferAmount) {
      await client.query('ROLLBACK');
      return res.status(422).json({
        error: 'InsufficientFundsError',
        message: 'Sender has insufficient funds for this transfer',
        currentBalancePaise: sourceBalance.toString(),
        attemptedAmountPaise: transferAmount.toString(),
      });
    }

    // 5. Deduct the amount from the sender with defense-in-depth conditional check
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

    // 6. Credit the receiver
    const updatedDest = await client.query(
      `UPDATE accounts
       SET balance_paise = balance_paise + $1, updated_at = NOW()
       WHERE id = $2
       RETURNING balance_paise`,
      [transferAmount.toString(), destinationAccountId]
    );

    // 7. Record the transfer record
    const transferRecord = await client.query(
      `INSERT INTO transfers (source_account_id, destination_account_id, amount_paise, status)
       VALUES ($1, $2, $3, 'completed')
       RETURNING id, source_account_id, destination_account_id, amount_paise, status, created_at`,
      [sourceAccountId, destinationAccountId, transferAmount.toString()]
    );

    await client.query('COMMIT');

    const createdTransfer = transferRecord.rows[0];

    // 8. Return transfer confirmation
    return res.status(201).json({
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
    });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

module.exports = router;
