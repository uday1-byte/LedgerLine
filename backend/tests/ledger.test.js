const request = require('supertest');
const { Pool } = require('pg');
const app = require('../src/app');
const { pool } = require('../src/config/db');
const env = require('../src/config/env');

// Privileged migration/table owner pool used strictly to verify that database-level
// append-only triggers reject mutations even when executed by table owners with UPDATE/DELETE grants.
const ownerUser = process.env.MIGRATION_DB_USER || 'ledgerline_owner';
const ownerPassword = process.env.MIGRATION_DB_PASSWORD;

if (!ownerPassword) {
  throw new Error(
    'MIGRATION_DB_PASSWORD environment variable must be explicitly configured to run ledger integration tests.'
  );
}

const ownerPool = new Pool({
  host: env.DB_HOST,
  port: env.DB_PORT,
  database: env.DB_NAME,
  user: ownerUser,
  password: ownerPassword,
  max: 2,
  connectionTimeoutMillis: 5000,
});

describe('Phase 4: Double-Entry Ledger, Idempotency & Financial Integrity Tests', () => {
  let sourceAccountId;
  let destinationAccountId;
  let thirdAccountId;

  beforeEach(async () => {
    // Create isolated test accounts
    const srcRes = await pool.query(
      `INSERT INTO accounts (account_number, balance_paise)
       VALUES ($1, $2)
       RETURNING id, balance_paise`,
      [`LEDGER-SRC-${Date.now()}-${Math.floor(Math.random() * 100000)}`, 100000] // ₹1,000.00
    );
    sourceAccountId = srcRes.rows[0].id;

    const dstRes = await pool.query(
      `INSERT INTO accounts (account_number, balance_paise)
       VALUES ($1, $2)
       RETURNING id, balance_paise`,
      [`LEDGER-DST-${Date.now()}-${Math.floor(Math.random() * 100000)}`, 50000] // ₹500.00
    );
    destinationAccountId = dstRes.rows[0].id;

    const thirdRes = await pool.query(
      `INSERT INTO accounts (account_number, balance_paise)
       VALUES ($1, $2)
       RETURNING id, balance_paise`,
      [`LEDGER-THD-${Date.now()}-${Math.floor(Math.random() * 100000)}`, 10000] // ₹100.00
    );
    thirdAccountId = thirdRes.rows[0].id;
  });

  afterEach(async () => {
    // In an append-only ledger, test accounts and transfers persist in the isolated test database
    // and are reset between runs via test database recreation or truncation by the test runner.
  });

  afterAll(async () => {
    await pool.end();
    if (ownerPool) {
      await ownerPool.end();
    }
  });

  // ─── Test 1: Exactly two ledger entries per transfer ────────────────────────
  it('1. every successful transfer produces exactly two ledger entries (one debit, one credit)', async () => {
    const key = `KEY-1-${Date.now()}-${Math.random()}`;
    const res = await request(app)
      .post('/api/transfers')
      .set('Idempotency-Key', key)
      .send({
        sourceAccountId,
        destinationAccountId,
        amountPaise: 25000,
      });

    expect(res.statusCode).toBe(201);
    const transferId = res.body.transfer.id;

    const entriesRes = await pool.query(
      `SELECT * FROM ledger_entries WHERE transfer_id = $1 ORDER BY entry_type ASC`,
      [transferId]
    );

    expect(entriesRes.rows.length).toBe(2);
    const types = entriesRes.rows.map((r) => r.entry_type).sort();
    expect(types).toEqual(['credit', 'debit']);
  });

  // ─── Test 2: Debit and credit amounts match transfer amount ──────────────────
  it('2. the debit and credit amounts match the transfer amount', async () => {
    const amount = 35000;
    const key = `KEY-2-${Date.now()}-${Math.random()}`;
    const res = await request(app)
      .post('/api/transfers')
      .set('Idempotency-Key', key)
      .send({
        sourceAccountId,
        destinationAccountId,
        amountPaise: amount,
      });

    expect(res.statusCode).toBe(201);
    const transferId = res.body.transfer.id;

    const entriesRes = await pool.query(
      `SELECT entry_type, amount_paise FROM ledger_entries WHERE transfer_id = $1`,
      [transferId]
    );

    expect(entriesRes.rows.length).toBe(2);
    for (const entry of entriesRes.rows) {
      expect(entry.amount_paise).toBe(amount.toString());
    }
  });

  // ─── Test 3: Correct accounts and running balances ──────────────────────────
  it('3. both ledger entries reference the correct accounts and record correct running balances', async () => {
    const amount = 20000;
    const key = `KEY-3-${Date.now()}-${Math.random()}`;
    const res = await request(app)
      .post('/api/transfers')
      .set('Idempotency-Key', key)
      .send({
        sourceAccountId,
        destinationAccountId,
        amountPaise: amount,
      });

    expect(res.statusCode).toBe(201);
    const transferId = res.body.transfer.id;

    const entriesRes = await pool.query(
      `SELECT * FROM ledger_entries WHERE transfer_id = $1`,
      [transferId]
    );

    const debitEntry = entriesRes.rows.find((r) => r.entry_type === 'debit');
    const creditEntry = entriesRes.rows.find((r) => r.entry_type === 'credit');

    expect(debitEntry).toBeDefined();
    expect(debitEntry.account_id).toBe(sourceAccountId);
    expect(debitEntry.balance_after_paise).toBe('80000'); // 100,000 - 20,000

    expect(creditEntry).toBeDefined();
    expect(creditEntry.account_id).toBe(destinationAccountId);
    expect(creditEntry.balance_after_paise).toBe('70000'); // 50,000 + 20,000
  });

  // ─── Test 4: Incomplete ledger transaction cannot commit ─────────────────────
  it('4. an incomplete ledger transaction (e.g. credit omitted) cannot be committed to the database', async () => {
    const client = await pool.connect();
    let commitFailed = false;

    try {
      await client.query('BEGIN');
      const transferRes = await client.query(
        `INSERT INTO transfers (source_account_id, destination_account_id, amount_paise, status, transfer_type)
         VALUES ($1, $2, $3, 'completed', 'customer_transfer')
         RETURNING id`,
        [sourceAccountId, destinationAccountId, 10000]
      );
      const transferId = transferRes.rows[0].id;

      // Insert only debit entry, omit credit
      await client.query(
        `INSERT INTO ledger_entries (transfer_id, account_id, entry_type, amount_paise, balance_after_paise)
         VALUES ($1, $2, 'debit', 10000, 90000)`,
        [transferId, sourceAccountId]
      );

      // Attempt to commit incomplete transaction
      await client.query('COMMIT');
    } catch (err) {
      commitFailed = true;
      await client.query('ROLLBACK').catch(() => {});
      expect(err.message).toMatch(/LL007|expected exactly 1 debit and 1 credit|ledger integrity violation/i);
    } finally {
      client.release();
    }

    expect(commitFailed).toBe(true);
  });

  // ─── Test 5: Unbalanced ledger transaction cannot commit ────────────────────
  it('5. an unbalanced ledger transaction (debit != credit) cannot be committed to the database', async () => {
    const client = await pool.connect();
    let commitFailed = false;

    try {
      await client.query('BEGIN');
      const transferRes = await client.query(
        `INSERT INTO transfers (source_account_id, destination_account_id, amount_paise, status, transfer_type)
         VALUES ($1, $2, $3, 'completed', 'customer_transfer')
         RETURNING id`,
        [sourceAccountId, destinationAccountId, 10000]
      );
      const transferId = transferRes.rows[0].id;

      // Insert debit of 10000
      await client.query(
        `INSERT INTO ledger_entries (transfer_id, account_id, entry_type, amount_paise, balance_after_paise)
         VALUES ($1, $2, 'debit', 10000, 90000)`,
        [transferId, sourceAccountId]
      );

      // Insert credit of 8000 (unbalanced!)
      await client.query(
        `INSERT INTO ledger_entries (transfer_id, account_id, entry_type, amount_paise, balance_after_paise)
         VALUES ($1, $2, 'credit', 8000, 58000)`,
        [transferId, destinationAccountId]
      );

      // Attempt to commit unbalanced transaction
      await client.query('COMMIT');
    } catch (err) {
      commitFailed = true;
      await client.query('ROLLBACK').catch(() => {});
      expect(err.message).toMatch(/LL007|ledger balance mismatch/i);
    } finally {
      client.release();
    }

    expect(commitFailed).toBe(true);
  });

  // ─── Test 6: Direct UPDATE on ledger_entries is rejected ────────────────────
  it('6. direct UPDATE on ledger_entries is rejected by the database immutability trigger and role permissions', async () => {
    // First create a legitimate transfer
    const key = `KEY-6-${Date.now()}-${Math.random()}`;
    const res = await request(app)
      .post('/api/transfers')
      .set('Idempotency-Key', key)
      .send({
        sourceAccountId,
        destinationAccountId,
        amountPaise: 5000,
      });

    expect(res.statusCode).toBe(201);
    const transferId = res.body.transfer.id;

    // Layer 1 (Least Privilege): Application role (ledgerline_app) lacks UPDATE privilege -> SQLSTATE 42501
    let appUpdateFailed = false;
    try {
      await pool.query(
        `UPDATE ledger_entries SET amount_paise = 99999 WHERE transfer_id = $1`,
        [transferId]
      );
    } catch (err) {
      appUpdateFailed = true;
      expect(err.code).toBe('42501');
    }
    expect(appUpdateFailed).toBe(true);

    // Layer 2 (Database Trigger): Privileged table owner (ledgerline_owner) is blocked by append-only trigger -> SQLSTATE LL007
    let ownerUpdateFailed = false;
    try {
      await ownerPool.query(
        `UPDATE ledger_entries SET amount_paise = 99999 WHERE transfer_id = $1`,
        [transferId]
      );
    } catch (err) {
      ownerUpdateFailed = true;
      expect(err.code).toBe('LL007');
      expect(err.message).toMatch(/append-only/i);
    }
    expect(ownerUpdateFailed).toBe(true);
  });

  // ─── Test 7: Direct DELETE on ledger_entries is rejected ────────────────────
  it('7. direct DELETE on ledger_entries is rejected by the database immutability trigger and role permissions', async () => {
    const key = `KEY-7-${Date.now()}-${Math.random()}`;
    const res = await request(app)
      .post('/api/transfers')
      .set('Idempotency-Key', key)
      .send({
        sourceAccountId,
        destinationAccountId,
        amountPaise: 5000,
      });

    expect(res.statusCode).toBe(201);
    const transferId = res.body.transfer.id;

    // Layer 1 (Least Privilege): Application role (ledgerline_app) lacks DELETE privilege -> SQLSTATE 42501
    let appDeleteFailed = false;
    try {
      await pool.query(
        `DELETE FROM ledger_entries WHERE transfer_id = $1`,
        [transferId]
      );
    } catch (err) {
      appDeleteFailed = true;
      expect(err.code).toBe('42501');
    }
    expect(appDeleteFailed).toBe(true);

    // Layer 2 (Database Trigger): Privileged table owner (ledgerline_owner) is blocked by append-only trigger -> SQLSTATE LL007
    let ownerDeleteFailed = false;
    try {
      await ownerPool.query(
        `DELETE FROM ledger_entries WHERE transfer_id = $1`,
        [transferId]
      );
    } catch (err) {
      ownerDeleteFailed = true;
      expect(err.code).toBe('LL007');
      expect(err.message).toMatch(/append-only/i);
    }
    expect(ownerDeleteFailed).toBe(true);
  });

  // ─── Test 8: Re-sending with same idempotency key replays result ────────────
  it('8. re-sending a completed transfer with the same idempotency key returns the original result without duplicate execution', async () => {
    const key = `KEY-8-${Date.now()}-${Math.random()}`;
    const payload = {
      sourceAccountId,
      destinationAccountId,
      amountPaise: 15000,
    };

    // First request
    const res1 = await request(app)
      .post('/api/transfers')
      .set('Idempotency-Key', key)
      .send(payload);

    expect(res1.statusCode).toBe(201);
    expect(res1.headers['idempotent-replayed']).toBeUndefined();
    const originalTransferId = res1.body.transfer.id;

    // Second request with identical payload and key
    const res2 = await request(app)
      .post('/api/transfers')
      .set('Idempotency-Key', key)
      .send(payload);

    expect(res2.statusCode).toBe(201);
    expect(res2.headers['idempotent-replayed']).toBe('true');
    expect(res2.body.transfer.id).toBe(originalTransferId);

    // Verify only ONE transfer exists in the database
    const transfersDb = await pool.query(
      `SELECT * FROM transfers WHERE source_account_id = $1 AND destination_account_id = $2`,
      [sourceAccountId, destinationAccountId]
    );
    expect(transfersDb.rows.length).toBe(1);

    // Verify balances were deducted only once (100000 - 15000 = 85000)
    const srcDb = await pool.query('SELECT balance_paise FROM accounts WHERE id = $1', [sourceAccountId]);
    expect(srcDb.rows[0].balance_paise).toBe('85000');
  });

  // ─── Test 9: Same idempotency key with conflicting payload returns 409 ──────
  it('9. re-sending an idempotency key with a different payload returns HTTP 409 Conflict', async () => {
    const key = `KEY-9-${Date.now()}-${Math.random()}`;

    // Initial request
    const res1 = await request(app)
      .post('/api/transfers')
      .set('Idempotency-Key', key)
      .send({
        sourceAccountId,
        destinationAccountId,
        amountPaise: 10000,
      });

    expect(res1.statusCode).toBe(201);

    // Conflicting request: same key, different amount
    const res2 = await request(app)
      .post('/api/transfers')
      .set('Idempotency-Key', key)
      .send({
        sourceAccountId,
        destinationAccountId,
        amountPaise: 20000,
      });

    expect(res2.statusCode).toBe(409);
    expect(res2.body).toHaveProperty('error', 'IdempotencyConflictError');
    expect(res2.body.message).toMatch(/idempotency key.*different request/i);
  });

  // ─── Test 10: Concurrent requests with same key produce only one transfer ───
  it('10. concurrent requests with the same idempotency key produce only one transfer', async () => {
    const key = `KEY-10-${Date.now()}-${Math.random()}`;
    const payload = {
      sourceAccountId,
      destinationAccountId,
      amountPaise: 12000,
    };

    // Dispatch two identical requests concurrently
    const [res1, res2] = await Promise.all([
      request(app).post('/api/transfers').set('Idempotency-Key', key).send(payload),
      request(app).post('/api/transfers').set('Idempotency-Key', key).send(payload),
    ]);

    // Both should succeed (one initial 201, one replayed 201)
    expect(res1.statusCode).toBe(201);
    expect(res2.statusCode).toBe(201);

    // One must have Idempotent-Replayed header or both reference identical transfer ID
    expect(res1.body.transfer.id).toBe(res2.body.transfer.id);

    // Exactly one transfer in DB
    const txDb = await pool.query(
      `SELECT * FROM transfers WHERE source_account_id = $1 AND destination_account_id = $2`,
      [sourceAccountId, destinationAccountId]
    );
    expect(txDb.rows.length).toBe(1);

    // Exactly 2 ledger entries
    const ledgerDb = await pool.query(
      `SELECT * FROM ledger_entries WHERE transfer_id = $1`,
      [res1.body.transfer.id]
    );
    expect(ledgerDb.rows.length).toBe(2);

    // Source balance deducted exactly once
    const srcDb = await pool.query('SELECT balance_paise FROM accounts WHERE id = $1', [sourceAccountId]);
    expect(srcDb.rows[0].balance_paise).toBe('88000');
  });

  // ─── Test 11: Transfer reversal creates compensating ledger entries ─────────
  it('11. a successful transfer reversal creates compensating ledger entries that restore account balances', async () => {
    // 1. Complete an initial transfer of 30,000 paise
    const txKey = `KEY-11-TX-${Date.now()}-${Math.random()}`;
    const transferRes = await request(app)
      .post('/api/transfers')
      .set('Idempotency-Key', txKey)
      .send({
        sourceAccountId,
        destinationAccountId,
        amountPaise: 30000,
      });

    expect(transferRes.statusCode).toBe(201);
    const originalTransferId = transferRes.body.transfer.id;

    // Balances after transfer: source = 70,000, destination = 80,000
    // 2. Request a reversal
    const revKey = `KEY-11-REV-${Date.now()}-${Math.random()}`;
    const revRes = await request(app)
      .post(`/api/transfers/${originalTransferId}/reversal`)
      .set('Idempotency-Key', revKey)
      .send({
        reversalReason: 'Customer dispute resolved',
      });

    expect(revRes.statusCode).toBe(201);
    expect(revRes.body).toHaveProperty('message', 'Transfer reversed successfully');
    expect(revRes.body.reversal).toMatchObject({
      originalTransferId,
      sourceAccountId: destinationAccountId, // recipient debited
      destinationAccountId: sourceAccountId, // sender credited
      amountPaise: '30000',
      transferType: 'reversal',
      reversalReason: 'Customer dispute resolved',
    });

    // Verify restored balances
    expect(revRes.body.restoredBalances).toMatchObject({
      sourceAccountId,
      sourceBalancePaise: '100000', // restored to 100,000
      destinationAccountId,
      destinationBalancePaise: '50000', // restored to 50,000
    });

    // Verify DB balances
    const srcDb = await pool.query('SELECT balance_paise FROM accounts WHERE id = $1', [sourceAccountId]);
    expect(srcDb.rows[0].balance_paise).toBe('100000');

    const dstDb = await pool.query('SELECT balance_paise FROM accounts WHERE id = $1', [destinationAccountId]);
    expect(dstDb.rows[0].balance_paise).toBe('50000');

    // Verify reversal ledger entries
    const revEntriesRes = await pool.query(
      `SELECT * FROM ledger_entries WHERE transfer_id = $1 ORDER BY entry_type ASC`,
      [revRes.body.reversal.id]
    );
    expect(revEntriesRes.rows.length).toBe(2);

    const creditEntry = revEntriesRes.rows.find((r) => r.entry_type === 'credit');
    const debitEntry = revEntriesRes.rows.find((r) => r.entry_type === 'debit');

    // Credit should be to original source (sourceAccountId)
    expect(creditEntry.account_id).toBe(sourceAccountId);
    expect(creditEntry.balance_after_paise).toBe('100000');

    // Debit should be from original destination (destinationAccountId)
    expect(debitEntry.account_id).toBe(destinationAccountId);
    expect(debitEntry.balance_after_paise).toBe('50000');
  });

  // ─── Test 12: Same transfer cannot be reversed twice ───────────────────────
  it('12. the same transfer cannot be reversed twice', async () => {
    // 1. Initial transfer
    const txKey = `KEY-12-TX-${Date.now()}-${Math.random()}`;
    const transferRes = await request(app)
      .post('/api/transfers')
      .set('Idempotency-Key', txKey)
      .send({
        sourceAccountId,
        destinationAccountId,
        amountPaise: 15000,
      });

    expect(transferRes.statusCode).toBe(201);
    const originalTransferId = transferRes.body.transfer.id;

    // 2. First reversal succeeds
    const revKey1 = `KEY-12-REV1-${Date.now()}-${Math.random()}`;
    const revRes1 = await request(app)
      .post(`/api/transfers/${originalTransferId}/reversal`)
      .set('Idempotency-Key', revKey1)
      .send({ reversalReason: 'First reversal' });

    expect(revRes1.statusCode).toBe(201);

    // 3. Second reversal attempt fails with 409
    const revKey2 = `KEY-12-REV2-${Date.now()}-${Math.random()}`;
    const revRes2 = await request(app)
      .post(`/api/transfers/${originalTransferId}/reversal`)
      .set('Idempotency-Key', revKey2)
      .send({ reversalReason: 'Duplicate reversal attempt' });

    expect(revRes2.statusCode).toBe(409);
    expect(revRes2.body).toHaveProperty('error', 'ConflictError');
    expect(revRes2.body.message).toMatch(/already.*reversed/i);
  });

  // ─── Test 13: Opening balances preserve customer balances & system balance ──
  it('13. opening balances preserve existing customer balances and create correct zero-sum ledger history', async () => {
    const equityUuid = '00000000-0000-0000-0000-000000000001';

    // 1. Verify system equity account exists with system_equity account type
    const equityRes = await pool.query(
      `SELECT * FROM accounts WHERE id = $1`,
      [equityUuid]
    );
    expect(equityRes.rows.length).toBe(1);
    expect(equityRes.rows[0].account_type).toBe('system_equity');

    // 2. Cutover equilibrium invariant:
    // System equity balance + all cutover-captured customer accounts sum to exactly zero
    const cutoverSumRes = await pool.query(
      `SELECT COALESCE(SUM(balance_paise), 0) AS total_paise
       FROM accounts
       WHERE id = $1
          OR opening_balance_captured_at IS NOT NULL`,
      [equityUuid]
    );
    expect(BigInt(cutoverSumRes.rows[0].total_paise)).toBe(0n);

    // 3. Double-entry conservation invariant:
    // Net sum of all ledger credits minus debits across the entire system is exactly zero
    const ledgerNetRes = await pool.query(
      `SELECT COALESCE(SUM(CASE WHEN entry_type = 'credit' THEN amount_paise ELSE -amount_paise END), 0) AS net_ledger
       FROM ledger_entries`
    );
    expect(BigInt(ledgerNetRes.rows[0].net_ledger)).toBe(0n);

    // 4. Verify existing cutover opening_balance transfers in the database (if any exist)
    const obTransfers = await pool.query(
      `SELECT t.id, t.amount_paise, t.source_account_id, t.destination_account_id
       FROM transfers t
       WHERE t.transfer_type = 'opening_balance'`
    );

    for (const ob of obTransfers.rows) {
      const obEntries = await pool.query(
        `SELECT account_id, entry_type, amount_paise, balance_after_paise
         FROM ledger_entries
         WHERE transfer_id = $1`,
        [ob.id]
      );
      expect(obEntries.rows.length).toBe(2);

      const customerEntry = obEntries.rows.find((e) => e.account_id !== equityUuid);
      const equityEntry = obEntries.rows.find((e) => e.account_id === equityUuid);

      expect(customerEntry).toBeDefined();
      expect(equityEntry).toBeDefined();
      expect(customerEntry.amount_paise).toBe(ob.amount_paise);
      expect(equityEntry.amount_paise).toBe(ob.amount_paise);

      // Verify routing and direction according to original balance sign:
      if (ob.destination_account_id === customerEntry.account_id) {
        // Positive opening balance: funded by equity (credit customer, debit equity)
        expect(ob.source_account_id).toBe(equityUuid);
        expect(customerEntry.entry_type).toBe('credit');
        expect(equityEntry.entry_type).toBe('debit');
        expect(BigInt(customerEntry.balance_after_paise)).toBe(BigInt(ob.amount_paise));
      } else {
        // Negative opening balance: customer receivable (debit customer, credit equity)
        expect(ob.source_account_id).toBe(customerEntry.account_id);
        expect(ob.destination_account_id).toBe(equityUuid);
        expect(customerEntry.entry_type).toBe('debit');
        expect(equityEntry.entry_type).toBe('credit');
        expect(BigInt(customerEntry.balance_after_paise)).toBe(-BigInt(ob.amount_paise));
      }
    }

    // 5. Transactional Cutover Proof: Empirically prove that the cutover mechanism preserves
    // customer balances and models system equity balance faithfully without altering existing database records
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Read current system equity balance inside the transaction
      const currentEquityRes = await client.query(
        `SELECT balance_paise FROM accounts WHERE id = $1 FOR UPDATE`,
        [equityUuid]
      );
      const currentEquityBalance = BigInt(currentEquityRes.rows[0].balance_paise);

      const initialPreCutoverBalance = 75000n; // ₹750.00
      const resultingEquityBalance = currentEquityBalance - initialPreCutoverBalance;

      // Create pre-cutover customer account with initial balance
      const testAccountRes = await client.query(
        `INSERT INTO accounts (account_number, balance_paise, account_type)
         VALUES ($1, $2, 'customer')
         RETURNING id, balance_paise`,
        [`CUTOVER-PROOF-${Date.now()}`, initialPreCutoverBalance.toString()]
      );
      const testAccountId = testAccountRes.rows[0].id;

      // Execute opening balance cutover transition for this account
      const cutoverTxRes = await client.query(
        `INSERT INTO transfers (source_account_id, destination_account_id, amount_paise, status, transfer_type)
         VALUES ($1, $2, $3, 'completed', 'opening_balance')
         RETURNING id`,
        [equityUuid, testAccountId, initialPreCutoverBalance.toString()]
      );
      const cutoverTxId = cutoverTxRes.rows[0].id;

      // System Equity debit entry (records resultingEquityBalance in balance_after_paise)
      await client.query(
        `INSERT INTO ledger_entries (transfer_id, account_id, entry_type, amount_paise, balance_after_paise)
         VALUES ($1, $2, 'debit', $3, $4)`,
        [cutoverTxId, equityUuid, initialPreCutoverBalance.toString(), resultingEquityBalance.toString()]
      );

      // Customer credit entry (records preserved customer balance in balance_after_paise)
      await client.query(
        `INSERT INTO ledger_entries (transfer_id, account_id, entry_type, amount_paise, balance_after_paise)
         VALUES ($1, $2, 'credit', $3, $4)`,
        [cutoverTxId, testAccountId, initialPreCutoverBalance.toString(), initialPreCutoverBalance.toString()]
      );

      // Mark customer account opening balance as captured
      await client.query(
        `UPDATE accounts SET opening_balance_captured_at = NOW() WHERE id = $1`,
        [testAccountId]
      );

      // Update System Equity account balance to resulting equity balance
      await client.query(
        `UPDATE accounts SET balance_paise = $1 WHERE id = $2`,
        [resultingEquityBalance.toString(), equityUuid]
      );

      // Assert that customer balance was completely preserved (unchanged at initialPreCutoverBalance)
      const verifiedAcc = await client.query('SELECT balance_paise FROM accounts WHERE id = $1', [testAccountId]);
      expect(BigInt(verifiedAcc.rows[0].balance_paise)).toBe(initialPreCutoverBalance);

      // Assert that customer opening ledger entry matches preserved customer balance
      const verifiedCustomerEntry = await client.query(
        `SELECT entry_type, amount_paise, balance_after_paise
         FROM ledger_entries
         WHERE transfer_id = $1 AND account_id = $2`,
        [cutoverTxId, testAccountId]
      );
      expect(verifiedCustomerEntry.rows[0].entry_type).toBe('credit');
      expect(verifiedCustomerEntry.rows[0].amount_paise).toBe(initialPreCutoverBalance.toString());
      expect(verifiedCustomerEntry.rows[0].balance_after_paise).toBe(initialPreCutoverBalance.toString());

      // Assert that System Equity balance reflects the resulting equity balance
      const verifiedEquity = await client.query('SELECT balance_paise FROM accounts WHERE id = $1', [equityUuid]);
      expect(BigInt(verifiedEquity.rows[0].balance_paise)).toBe(resultingEquityBalance);

      // Assert that System Equity ledger entry recorded the resulting equity balance
      const verifiedEquityEntry = await client.query(
        `SELECT entry_type, amount_paise, balance_after_paise
         FROM ledger_entries
         WHERE transfer_id = $1 AND account_id = $2`,
        [cutoverTxId, equityUuid]
      );
      expect(verifiedEquityEntry.rows[0].entry_type).toBe('debit');
      expect(verifiedEquityEntry.rows[0].amount_paise).toBe(initialPreCutoverBalance.toString());
      expect(verifiedEquityEntry.rows[0].balance_after_paise).toBe(resultingEquityBalance.toString());

      // Evaluate deferred constraint triggers immediately to verify integrity
      await client.query('SET CONSTRAINTS ALL IMMEDIATE');
    } finally {
      // Rollback to guarantee zero modification to existing records
      await client.query('ROLLBACK').catch(() => {});
      client.release();
    }
  });

  // ─── Test 14: Reversal rejected if recipient subsequently spent funds ───────
  it('14. a reversal is rejected if the recipient has subsequently spent the funds (insufficient balance)', async () => {
    // 1. Initial transfer: source -> destination of 40,000 paise
    // Initial balances: source = 100,000, destination = 50,000
    // After transfer: source = 60,000, destination = 90,000
    const txKey1 = `KEY-14-TX1-${Date.now()}-${Math.random()}`;
    const tx1Res = await request(app)
      .post('/api/transfers')
      .set('Idempotency-Key', txKey1)
      .send({
        sourceAccountId,
        destinationAccountId,
        amountPaise: 40000,
      });

    expect(tx1Res.statusCode).toBe(201);
    const originalTransferId = tx1Res.body.transfer.id;

    // 2. Destination account spends 85,000 paise to thirdAccount
    // Destination balance becomes: 90,000 - 85,000 = 5,000 paise
    const txKey2 = `KEY-14-TX2-${Date.now()}-${Math.random()}`;
    const tx2Res = await request(app)
      .post('/api/transfers')
      .set('Idempotency-Key', txKey2)
      .send({
        sourceAccountId: destinationAccountId,
        destinationAccountId: thirdAccountId,
        amountPaise: 85000,
      });

    expect(tx2Res.statusCode).toBe(201);

    // 3. Attempt reversal of original transfer (requires 40,000 from destination, but only 5,000 available)
    const revKey = `KEY-14-REV-${Date.now()}-${Math.random()}`;
    const revRes = await request(app)
      .post(`/api/transfers/${originalTransferId}/reversal`)
      .set('Idempotency-Key', revKey)
      .send({
        reversalReason: 'Attempted reversal on spent funds',
      });

    expect(revRes.statusCode).toBe(422);
    expect(revRes.body).toHaveProperty('error', 'InsufficientFundsError');
    expect(revRes.body.message).toMatch(/insufficient funds to reverse/i);

    // Verify balances remained untouched by the failed reversal
    const dstDb = await pool.query('SELECT balance_paise FROM accounts WHERE id = $1', [destinationAccountId]);
    expect(dstDb.rows[0].balance_paise).toBe('5000');

    const srcDb = await pool.query('SELECT balance_paise FROM accounts WHERE id = $1', [sourceAccountId]);
    expect(srcDb.rows[0].balance_paise).toBe('60000');
  });

  // ─── Test 15: Transfers without an idempotency key are rejected (HTTP 400) ───
  it('15. transfers without an idempotency key are rejected with HTTP 400', async () => {
    const res = await request(app)
      .post('/api/transfers')
      .send({
        sourceAccountId,
        destinationAccountId,
        amountPaise: 10000,
      });

    expect(res.statusCode).toBe(400);
    expect(res.body).toHaveProperty('error', 'ValidationError');
    expect(res.body.message).toMatch(/Idempotency-Key header is required/i);
  });
});
