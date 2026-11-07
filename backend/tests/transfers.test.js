const request = require('supertest');
const app = require('../src/app');
const { pool } = require('../src/config/db');

describe('POST /api/transfers - Basic Transfers (Experiment 1)', () => {
  let sourceAccountId;
  let destinationAccountId;

  beforeEach(async () => {
    // Create fresh test accounts
    const sourceRes = await pool.query(
      `INSERT INTO accounts (account_number, balance_paise)
       VALUES ($1, $2)
       RETURNING id, balance_paise`,
      [`TEST-SRC-${Date.now()}-${Math.floor(Math.random() * 10000)}`, 100000] // Initial balance: 100,000 paise (₹1,000.00)
    );
    sourceAccountId = sourceRes.rows[0].id;

    const destRes = await pool.query(
      `INSERT INTO accounts (account_number, balance_paise)
       VALUES ($1, $2)
       RETURNING id, balance_paise`,
      [`TEST-DST-${Date.now()}-${Math.floor(Math.random() * 10000)}`, 50000] // Initial balance: 50,000 paise (₹500.00)
    );
    destinationAccountId = destRes.rows[0].id;
  });

  afterEach(async () => {
    // Scoped cleanup: delete only the specific transfers and accounts created by this test
    if (sourceAccountId && destinationAccountId) {
      await pool.query(
        `DELETE FROM transfers
         WHERE source_account_id IN ($1, $2)
            OR destination_account_id IN ($1, $2)`,
        [sourceAccountId, destinationAccountId]
      );
      await pool.query(
        `DELETE FROM accounts
         WHERE id IN ($1, $2)`,
        [sourceAccountId, destinationAccountId]
      );
    }
  });

  afterAll(async () => {
    await pool.end();
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
        .send({
          sourceAccountId,
          destinationAccountId,
          amountPaise: -500,
        });

      expect(res.statusCode).toBe(400);
      expect(res.body).toHaveProperty('error', 'ValidationError');
    });
  });
});
