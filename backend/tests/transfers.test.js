const request = require('supertest');
const { Pool } = require('pg');
const app = require('../src/app');
const { pool } = require('../src/config/db');
const env = require('../src/config/env');
const { createTestUser } = require('./helpers/auth');

const ownerPool = new Pool({
  host: env.DB_HOST,
  port: env.DB_PORT,
  database: 'ledgerline_test',
  user: process.env.MIGRATION_DB_USER || 'ledgerline_owner',
  password: process.env.MIGRATION_DB_PASSWORD || env.DB_PASSWORD,
  max: 2,
});

describe('POST /api/transfers - Basic Transfers (Experiment 1 & Phase 4)', () => {
  let sourceAccountId;
  let destinationAccountId;
  let authToken;

  beforeEach(async () => {
    // Create an authenticated test user
    const testUser = await createTestUser({ role: 'admin' });
    authToken = testUser.token;

    // Create fresh test accounts using ownerPool (test fixture setup requires initial balances)
    const sourceRes = await ownerPool.query(
      `INSERT INTO accounts (account_number, balance_paise)
       VALUES ($1, $2)
       RETURNING id, balance_paise`,
      [`TEST-SRC-${Date.now()}-${Math.floor(Math.random() * 10000)}`, 100000] // Initial balance: 100,000 paise (₹1,000.00)
    );
    sourceAccountId = sourceRes.rows[0].id;

    const destRes = await ownerPool.query(
      `INSERT INTO accounts (account_number, balance_paise)
       VALUES ($1, $2)
       RETURNING id, balance_paise`,
      [`TEST-DST-${Date.now()}-${Math.floor(Math.random() * 10000)}`, 50000] // Initial balance: 50,000 paise (₹500.00)
    );
    destinationAccountId = destRes.rows[0].id;
  });

  afterEach(async () => {
    // In an append-only ledger, test accounts and transfers persist in the isolated test database
    // and are reset between runs via test database recreation or truncation by the test runner.
  });

  afterAll(async () => {
    await pool.end();
    await ownerPool.end();
  });

  describe('Mandatory Idempotency-Key Header', () => {
    it('should return 400 when Idempotency-Key header is missing', async () => {
      const res = await request(app)
        .post('/api/transfers')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          sourceAccountId,
          destinationAccountId,
          amountPaise: 10000,
        });

      expect(res.statusCode).toBe(400);
      expect(res.body).toHaveProperty('error', 'ValidationError');
      expect(res.body.message).toContain('Idempotency-Key header is required');
    });
  });

  describe('Successful Transfer', () => {
    it('should transfer funds between existing accounts and update balances', async () => {
      const transferPayload = {
        sourceAccountId,
        destinationAccountId,
        amountPaise: 30000, // 30,000 paise (₹300.00)
      };

      const res = await request(app)
        .post('/api/transfers')
        .set('Authorization', `Bearer ${authToken}`)
        .set('Idempotency-Key', `TX-KEY-${Date.now()}-${Math.random()}`)
        .send(transferPayload);

      expect(res.statusCode).toBe(201);
      expect(res.body).toHaveProperty('message', 'Transfer completed successfully');
      expect(res.body.transfer).toMatchObject({
        sourceAccountId,
        destinationAccountId,
        amountPaise: '30000',
        status: 'completed',
      });
      expect(res.body.updatedBalances).toMatchObject({
        sourceAccountId,
        sourceBalancePaise: '70000', // 100,000 - 30,000 = 70,000
        destinationAccountId,
        destinationBalancePaise: '80000', // 50,000 + 30,000 = 80,000
      });

      // Verify balances directly in PostgreSQL
      const sourceDb = await pool.query('SELECT balance_paise FROM accounts WHERE id = $1', [sourceAccountId]);
      expect(sourceDb.rows[0].balance_paise).toBe('70000');

      const destDb = await pool.query('SELECT balance_paise FROM accounts WHERE id = $1', [destinationAccountId]);
      expect(destDb.rows[0].balance_paise).toBe('80000');

      // Verify transfer record in PostgreSQL
      const transferDb = await pool.query('SELECT * FROM transfers WHERE id = $1', [res.body.transfer.id]);
      expect(transferDb.rows.length).toBe(1);
      expect(transferDb.rows[0].amount_paise).toBe('30000');

      // Verify exactly two ledger entries created in PostgreSQL
      const ledgerDb = await pool.query(
        'SELECT * FROM ledger_entries WHERE transfer_id = $1 ORDER BY entry_type ASC',
        [res.body.transfer.id]
      );
      expect(ledgerDb.rows.length).toBe(2);
      // Credit entry (destination)
      expect(ledgerDb.rows[0].entry_type).toBe('credit');
      expect(ledgerDb.rows[0].account_id).toBe(destinationAccountId);
      expect(ledgerDb.rows[0].amount_paise).toBe('30000');
      expect(ledgerDb.rows[0].balance_after_paise).toBe('80000');
      // Debit entry (source)
      expect(ledgerDb.rows[1].entry_type).toBe('debit');
      expect(ledgerDb.rows[1].account_id).toBe(sourceAccountId);
      expect(ledgerDb.rows[1].amount_paise).toBe('30000');
      expect(ledgerDb.rows[1].balance_after_paise).toBe('70000');
    });
  });

  describe('Insufficient Funds', () => {
    it('should reject transfer when sender has insufficient funds', async () => {
      const transferPayload = {
        sourceAccountId,
        destinationAccountId,
        amountPaise: 150000, // 150,000 paise > 100,000 available
      };

      const res = await request(app)
        .post('/api/transfers')
        .set('Authorization', `Bearer ${authToken}`)
        .set('Idempotency-Key', `TX-KEY-${Date.now()}-${Math.random()}`)
        .send(transferPayload);

      expect(res.statusCode).toBe(422);
      expect(res.body).toHaveProperty('error', 'InsufficientFundsError');
      expect(res.body).toHaveProperty('message', 'Sender has insufficient funds for this transfer');

      // Verify balances remained untouched
      const sourceDb = await pool.query('SELECT balance_paise FROM accounts WHERE id = $1', [sourceAccountId]);
      expect(sourceDb.rows[0].balance_paise).toBe('100000');

      const destDb = await pool.query('SELECT balance_paise FROM accounts WHERE id = $1', [destinationAccountId]);
      expect(destDb.rows[0].balance_paise).toBe('50000');

      // Verify no transfer record was inserted for these accounts
      const transferDb = await pool.query(
        `SELECT * FROM transfers
         WHERE source_account_id IN ($1, $2)
            OR destination_account_id IN ($1, $2)`,
        [sourceAccountId, destinationAccountId]
      );
      expect(transferDb.rows.length).toBe(0);
    });
  });

  describe('Validation & Not Found Scenarios', () => {
    it('should return 404 when source account does not exist', async () => {
      const randomUuid = '00000000-0000-0000-0000-000000000000';
      const res = await request(app)
        .post('/api/transfers')
        .set('Authorization', `Bearer ${authToken}`)
        .set('Idempotency-Key', `TX-KEY-${Date.now()}-${Math.random()}`)
        .send({
          sourceAccountId: randomUuid,
          destinationAccountId,
          amountPaise: 1000,
        });

      expect(res.statusCode).toBe(404);
      expect(res.body).toHaveProperty('error', 'NotFoundError');
      expect(res.body.message).toContain('Source account');
    });

    it('should return 404 when destination account does not exist', async () => {
      const randomUuid = '00000000-0000-0000-0000-000000000000';
      const res = await request(app)
        .post('/api/transfers')
        .set('Authorization', `Bearer ${authToken}`)
        .set('Idempotency-Key', `TX-KEY-${Date.now()}-${Math.random()}`)
        .send({
          sourceAccountId,
          destinationAccountId: randomUuid,
          amountPaise: 1000,
        });

      expect(res.statusCode).toBe(404);
      expect(res.body).toHaveProperty('error', 'NotFoundError');
      expect(res.body.message).toContain('Destination account');
    });

    it('should return 400 when transferring to the same account', async () => {
      const res = await request(app)
        .post('/api/transfers')
        .set('Authorization', `Bearer ${authToken}`)
        .set('Idempotency-Key', `TX-KEY-${Date.now()}-${Math.random()}`)
        .send({
          sourceAccountId,
          destinationAccountId: sourceAccountId,
          amountPaise: 1000,
        });

      expect(res.statusCode).toBe(400);
      expect(res.body).toHaveProperty('error', 'ValidationError');
    });

    it('should return 400 when amount is zero or negative', async () => {
      const res = await request(app)
        .post('/api/transfers')
        .set('Authorization', `Bearer ${authToken}`)
        .set('Idempotency-Key', `TX-KEY-${Date.now()}-${Math.random()}`)
        .send({
          sourceAccountId,
          destinationAccountId,
          amountPaise: -500,
        });

      expect(res.statusCode).toBe(400);
      expect(res.body).toHaveProperty('error', 'ValidationError');
    });
  });

  describe('Transfer Amount Precision, BigInt Safety & Concurrency Regression', () => {
    it('accepts valid positive decimal digit strings for normal transfer amounts', async () => {
      const res = await request(app)
        .post('/api/transfers')
        .set('Authorization', `Bearer ${authToken}`)
        .set('Idempotency-Key', `TX-STR-${Date.now()}-${Math.random()}`)
        .send({
          sourceAccountId,
          destinationAccountId,
          amountPaise: '25000',
        });

      expect(res.statusCode).toBe(201);
      expect(res.body.transfer.amountPaise).toBe('25000');
      expect(res.body.updatedBalances.sourceBalancePaise).toBe('75000');
      expect(res.body.updatedBalances.destinationBalancePaise).toBe('75000');
    });

    it('rejects missing, zero, negative, decimal, leading-zero, unsafe numeric, and malformed amounts with 400', async () => {
      const invalidAmounts = [
        undefined,
        null,
        0,
        '0',
        -1,
        '-100',
        '0100',
        12.5,
        '12.5',
        '10.0',
        'abc',
        '1e5',
        '100abc',
        '',
        '   ',
        9007199254740992, // Number.MAX_SAFE_INTEGER + 1 passed as JS number
        '9223372036854775808', // Exceeds PostgreSQL BIGINT max
      ];

      for (const badAmount of invalidAmounts) {
        const body = { sourceAccountId, destinationAccountId };
        if (badAmount !== undefined) {
          body.amountPaise = badAmount;
        }

        const res = await request(app)
          .post('/api/transfers')
          .set('Authorization', `Bearer ${authToken}`)
          .set('Idempotency-Key', `TX-BAD-${Date.now()}-${Math.random()}`)
          .send(body);

        expect(res.statusCode).toBe(400);
        expect(res.body).toHaveProperty('error', 'ValidationError');
      }

      const transferDb = await pool.query(
        'SELECT id FROM transfers WHERE source_account_id = $1 OR destination_account_id = $2',
        [sourceAccountId, destinationAccountId]
      );
      expect(transferDb.rows.length).toBe(0);
    });

    it('accepts exact PostgreSQL BIGINT maximum string and rejects cleanly on insufficient funds (422) without 500', async () => {
      const pgMax = '9223372036854775807';
      const res = await request(app)
        .post('/api/transfers')
        .set('Authorization', `Bearer ${authToken}`)
        .set('Idempotency-Key', `TX-PGMAX-${Date.now()}`)
        .send({
          sourceAccountId,
          destinationAccountId,
          amountPaise: pgMax,
        });

      expect(res.statusCode).toBe(422);
      expect(res.body.error).toBe('InsufficientFundsError');
      expect(res.body.attemptedAmountPaise).toBe(pgMax);
    });

    it('preserves exact precision beyond Number.MAX_SAFE_INTEGER across API, accounts, transfers, and ledger_entries', async () => {
      const initialSourceBalance = '9007199254741993'; // 9007199254740993 + 1000
      const transferAmountStr = '9007199254740993'; // Beyond MAX_SAFE_INTEGER (would lose precision under Number/parseInt)

      const hugeSrc = await ownerPool.query(
        'INSERT INTO accounts (account_number, balance_paise) VALUES ($1, $2) RETURNING id',
        [`TEST-HSRC-${Date.now()}-${Math.floor(Math.random() * 1000)}`, initialSourceBalance]
      );
      const hugeDst = await ownerPool.query(
        'INSERT INTO accounts (account_number, balance_paise) VALUES ($1, $2) RETURNING id',
        [`TEST-HDST-${Date.now()}-${Math.floor(Math.random() * 1000)}`, '0']
      );

      const res = await request(app)
        .post('/api/transfers')
        .set('Authorization', `Bearer ${authToken}`)
        .set('Idempotency-Key', `TX-HUGE-${Date.now()}`)
        .send({
          sourceAccountId: hugeSrc.rows[0].id,
          destinationAccountId: hugeDst.rows[0].id,
          amountPaise: transferAmountStr,
        });

      expect(res.statusCode).toBe(201);
      expect(res.body.transfer.amountPaise).toBe(transferAmountStr);
      expect(res.body.updatedBalances.sourceBalancePaise).toBe('1000');
      expect(res.body.updatedBalances.destinationBalancePaise).toBe(transferAmountStr);

      const srcDb = await pool.query('SELECT balance_paise FROM accounts WHERE id = $1', [hugeSrc.rows[0].id]);
      const dstDb = await pool.query('SELECT balance_paise FROM accounts WHERE id = $1', [hugeDst.rows[0].id]);
      expect(srcDb.rows[0].balance_paise).toBe('1000');
      expect(dstDb.rows[0].balance_paise).toBe(transferAmountStr);

      const transferDb = await pool.query('SELECT amount_paise FROM transfers WHERE id = $1', [res.body.transfer.id]);
      expect(transferDb.rows[0].amount_paise).toBe(transferAmountStr);

      const ledgerDb = await pool.query(
        'SELECT entry_type, amount_paise, balance_after_paise FROM ledger_entries WHERE transfer_id = $1 ORDER BY entry_type ASC',
        [res.body.transfer.id]
      );
      expect(ledgerDb.rows).toEqual([
        { entry_type: 'credit', amount_paise: transferAmountStr, balance_after_paise: transferAmountStr },
        { entry_type: 'debit', amount_paise: transferAmountStr, balance_after_paise: '1000' },
      ]);
    });

    it('preserves BigInt idempotency replay, detects 1-paise payload conflicts beyond MAX_SAFE_INTEGER, and serializes concurrent transfers', async () => {
      const amountA = '9007199254740993';
      const amountB = '9007199254740992'; // Distinct by 1 paise (identical if cast to JS Number!)

      const srcRes = await ownerPool.query(
        'INSERT INTO accounts (account_number, balance_paise) VALUES ($1, $2) RETURNING id',
        [`TEST-CSRC-${Date.now()}-${Math.floor(Math.random() * 1000)}`, amountA]
      );
      const dstRes = await ownerPool.query(
        'INSERT INTO accounts (account_number, balance_paise) VALUES ($1, $2) RETURNING id',
        [`TEST-CDST-${Date.now()}-${Math.floor(Math.random() * 1000)}`, '0']
      );
      const cSrcId = srcRes.rows[0].id;
      const cDstId = dstRes.rows[0].id;

      const idemKey = `TX-HUGE-IDEM-${Date.now()}`;
      const firstRes = await request(app)
        .post('/api/transfers')
        .set('Authorization', `Bearer ${authToken}`)
        .set('Idempotency-Key', idemKey)
        .send({ sourceAccountId: cSrcId, destinationAccountId: cDstId, amountPaise: amountA });

      expect(firstRes.statusCode).toBe(201);

      // Exact replay returns cached 201 with Idempotent-Replayed header
      const replayRes = await request(app)
        .post('/api/transfers')
        .set('Authorization', `Bearer ${authToken}`)
        .set('Idempotency-Key', idemKey)
        .send({ sourceAccountId: cSrcId, destinationAccountId: cDstId, amountPaise: amountA });

      expect(replayRes.statusCode).toBe(201);
      expect(replayRes.headers['idempotent-replayed']).toBe('true');
      expect(replayRes.body.transfer.id).toBe(firstRes.body.transfer.id);

      // Reusing same key with 1-paise difference beyond MAX_SAFE_INTEGER must trigger 409 conflict
      const conflictRes = await request(app)
        .post('/api/transfers')
        .set('Authorization', `Bearer ${authToken}`)
        .set('Idempotency-Key', idemKey)
        .send({ sourceAccountId: cSrcId, destinationAccountId: cDstId, amountPaise: amountB });

      expect(conflictRes.statusCode).toBe(409);
      expect(conflictRes.body.error).toBe('IdempotencyConflictError');

      // Concurrent race: replenish exactly amountA on another account pair and fire two concurrent requests
      const raceSrc = await ownerPool.query(
        'INSERT INTO accounts (account_number, balance_paise) VALUES ($1, $2) RETURNING id',
        [`TEST-RSRC-${Date.now()}-${Math.floor(Math.random() * 1000)}`, amountA]
      );
      const raceDst = await ownerPool.query(
        'INSERT INTO accounts (account_number, balance_paise) VALUES ($1, $2) RETURNING id',
        [`TEST-RDST-${Date.now()}-${Math.floor(Math.random() * 1000)}`, '0']
      );

      const [race1, race2] = await Promise.all([
        request(app)
          .post('/api/transfers')
          .set('Authorization', `Bearer ${authToken}`)
          .set('Idempotency-Key', `TX-RACE-1-${Date.now()}`)
          .send({ sourceAccountId: raceSrc.rows[0].id, destinationAccountId: raceDst.rows[0].id, amountPaise: amountA }),
        request(app)
          .post('/api/transfers')
          .set('Authorization', `Bearer ${authToken}`)
          .set('Idempotency-Key', `TX-RACE-2-${Date.now()}`)
          .send({ sourceAccountId: raceSrc.rows[0].id, destinationAccountId: raceDst.rows[0].id, amountPaise: amountA }),
      ]);

      const statuses = [race1.statusCode, race2.statusCode].sort((a, b) => a - b);
      expect(statuses).toEqual([201, 422]);

      const postSrc = await pool.query('SELECT balance_paise FROM accounts WHERE id = $1', [raceSrc.rows[0].id]);
      const postDst = await pool.query('SELECT balance_paise FROM accounts WHERE id = $1', [raceDst.rows[0].id]);
      expect(postSrc.rows[0].balance_paise).toBe('0');
      expect(postDst.rows[0].balance_paise).toBe(amountA);
    });
  });
});
