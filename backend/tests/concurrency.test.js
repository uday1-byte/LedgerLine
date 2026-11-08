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

describe('Experiment 2: Concurrent Transfers Security Test', () => {
  let sourceAccountId;
  let dest1AccountId;
  let dest2AccountId;
  let authToken;

  beforeEach(async () => {
    // Authenticated test user
    const testUser = await createTestUser({ role: 'admin' });
    authToken = testUser.token;

    // 1. Create a source account with exactly 100,000 paise (₹1,000.00) using ownerPool
    const srcRes = await ownerPool.query(
      `INSERT INTO accounts (account_number, balance_paise)
       VALUES ($1, $2)
       RETURNING id, balance_paise`,
      [`CONC-SRC-${Date.now()}`, 100000]
    );
    sourceAccountId = srcRes.rows[0].id;

    // 2. Create destination account 1 (initial balance: 0) using ownerPool
    const dst1Res = await ownerPool.query(
      `INSERT INTO accounts (account_number, balance_paise)
       VALUES ($1, $2)
       RETURNING id, balance_paise`,
      [`CONC-DST1-${Date.now()}`, 0]
    );
    dest1AccountId = dst1Res.rows[0].id;

    // 3. Create destination account 2 (initial balance: 0) using ownerPool
    const dst2Res = await ownerPool.query(
      `INSERT INTO accounts (account_number, balance_paise)
       VALUES ($1, $2)
       RETURNING id, balance_paise`,
      [`CONC-DST2-${Date.now()}`, 0]
    );
    dest2AccountId = dst2Res.rows[0].id;
  });

  afterEach(async () => {
    // In an append-only ledger, test accounts and transfers persist in the isolated test database
    // and are reset between runs via test database recreation or truncation by the test runner.
  });

  afterAll(async () => {
    await pool.end();
    await ownerPool.end();
  });

  it('investigates whether concurrent transfers can overdraw an account', async () => {
    // Two simultaneous transfers of 80,000 paise each from an account with only 100,000 paise
    // Combined requested: 160,000 paise > 100,000 paise available
    const req1 = request(app)
      .post('/api/transfers')
      .set('Authorization', `Bearer ${authToken}`)
      .set('Idempotency-Key', `CONC-KEY-1-${Date.now()}-${Math.random()}`)
      .send({
        sourceAccountId,
        destinationAccountId: dest1AccountId,
        amountPaise: 80000,
      });

    const req2 = request(app)
      .post('/api/transfers')
      .set('Authorization', `Bearer ${authToken}`)
      .set('Idempotency-Key', `CONC-KEY-2-${Date.now()}-${Math.random()}`)
      .send({
        sourceAccountId,
        destinationAccountId: dest2AccountId,
        amountPaise: 80000,
      });

    // Launch both requests simultaneously via Promise.all
    const [res1, res2] = await Promise.all([req1, req2]);

    // Query actual balances directly from PostgreSQL
    const srcDb = await pool.query('SELECT balance_paise FROM accounts WHERE id = $1', [sourceAccountId]);
    const dst1Db = await pool.query('SELECT balance_paise FROM accounts WHERE id = $1', [dest1AccountId]);
    const dst2Db = await pool.query('SELECT balance_paise FROM accounts WHERE id = $1', [dest2AccountId]);
    const transfersDb = await pool.query(
      `SELECT id, amount_paise
       FROM transfers
       WHERE source_account_id = $1`,
      [sourceAccountId]
    );

    const finalSourceBalance = BigInt(srcDb.rows[0].balance_paise);
    const finalDest1Balance = BigInt(dst1Db.rows[0].balance_paise);
    const finalDest2Balance = BigInt(dst2Db.rows[0].balance_paise);

    console.log('=== CONCURRENCY TEST EXECUTION RESULTS ===');
    console.log(`Request 1 HTTP Status : ${res1.statusCode}`);
    console.log(`Request 2 HTTP Status : ${res2.statusCode}`);
    console.log(`Initial Source Balance: 100000 paise (₹1,000.00)`);
    console.log(`Final Source Balance  : ${finalSourceBalance.toString()} paise`);
    console.log(`Final Dest 1 Balance  : ${finalDest1Balance.toString()} paise`);
    console.log(`Final Dest 2 Balance  : ${finalDest2Balance.toString()} paise`);
    console.log(`Completed Transfers   : ${transfersDb.rows.length}`);
    console.log(`Is Source Overdrawn   : ${finalSourceBalance < 0n ? 'YES (RACE CONDITION REPRODUCED)' : 'NO'}`);
    console.log('==========================================');

    // Assert that the test recorded the outcome without crashing
    expect([201, 422]).toContain(res1.statusCode);
    expect([201, 422]).toContain(res2.statusCode);
  });
});
