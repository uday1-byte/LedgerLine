const request = require('supertest');
const crypto = require('crypto');
const app = require('../src/app');
const { pool } = require('../src/config/db');
const { createTestUser, createTestAccount, ownerPool } = require('./helpers/auth');
const auditService = require('../src/services/auditService');

const SYSTEM_CASH_CLEARING_ID = '00000000-0000-0000-0000-000000000002';
const PG_MAX_BIGINT_STR = '9223372036854775807';
const PG_OVERFLOW_BIGINT_STR = '9223372036854775808';

describe('POST /api/transfers/withdraw - Cash Withdrawals (Phase 6 Stage 5.3)', () => {
  let customerUser1;
  let customerUser2;
  let adminUser;
  let customerAccount1;
  let customerAccount2;
  let unassignedAccount;
  let systemEquityAccount;

  beforeAll(async () => {
    customerUser1 = await createTestUser({ role: 'account_holder' });
    customerUser2 = await createTestUser({ role: 'account_holder' });
    adminUser = await createTestUser({ role: 'admin' });

    customerAccount1 = await createTestAccount({
      accountNumber: `ACC-WDR-1-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      balancePaise: 100000, // 100,000 paise (₹1,000.00)
      userId: customerUser1.user.id,
    });

    customerAccount2 = await createTestAccount({
      accountNumber: `ACC-WDR-2-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      balancePaise: 200000, // 200,000 paise (₹2,000.00)
      userId: customerUser2.user.id,
    });

    unassignedAccount = await createTestAccount({
      accountNumber: `ACC-WDR-UN-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      balancePaise: 50000,
      userId: null,
    });

    const equityRes = await ownerPool.query(
      `SELECT id FROM public.accounts WHERE account_type = 'system_equity' LIMIT 1`
    );
    systemEquityAccount = equityRes.rows[0];
  });

  afterAll(async () => {
    await pool.end();
    await ownerPool.end();
  });

  describe('1. Successful Withdrawal Execution & Double-Entry Balancing', () => {
    it('should successfully withdraw funds from own account, debit customer, credit clearing, and sequence both', async () => {
      // Capture starting state
      const preCustomer = await ownerPool.query(
        `SELECT balance_paise, next_entry_sequence FROM public.accounts WHERE id = $1`,
        [customerAccount1.id]
      );
      const startCustomerBalance = BigInt(preCustomer.rows[0].balance_paise);
      const startCustomerSeq = BigInt(preCustomer.rows[0].next_entry_sequence);

      const preClearing = await ownerPool.query(
        `SELECT balance_paise, next_entry_sequence FROM public.accounts WHERE id = $1`,
        [SYSTEM_CASH_CLEARING_ID]
      );
      const startClearingBalance = BigInt(preClearing.rows[0].balance_paise);
      const startClearingSeq = BigInt(preClearing.rows[0].next_entry_sequence);

      const withdrawAmount = 20000n;
      const idempotencyKey = `WDR-SUCCESS-${Date.now()}-${Math.random()}`;

      const res = await request(app)
        .post('/api/transfers/withdraw')
        .set('Authorization', `Bearer ${customerUser1.token}`)
        .set('Idempotency-Key', idempotencyKey)
        .send({
          accountId: customerAccount1.id,
          amountPaise: 20000,
        });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('message', 'Withdrawal completed successfully');
      expect(res.body.transfer).toBeDefined();
      expect(res.body.transfer.transferType).toBe('withdrawal');
      expect(res.body.transfer.sourceAccountId).toBe(customerAccount1.id);
      expect(res.body.transfer.destinationAccountId).toBe(SYSTEM_CASH_CLEARING_ID);
      expect(res.body.transfer.amountPaise).toBe('20000');
      expect(res.body.transfer.status).toBe('completed');
      expect(res.body.transfer.createdByUserId).toBe(customerUser1.user.id);
      expect(res.body.account.balancePaise).toBe((startCustomerBalance - withdrawAmount).toString());
      expect(res.body.account.accountEntrySequence).toBe(startCustomerSeq.toString());

      const transferId = res.body.transfer.id;

      // Verify customer account updated in database
      const postCustomer = await ownerPool.query(
        `SELECT balance_paise, next_entry_sequence FROM public.accounts WHERE id = $1`,
        [customerAccount1.id]
      );
      expect(BigInt(postCustomer.rows[0].balance_paise)).toBe(startCustomerBalance - withdrawAmount);
      expect(BigInt(postCustomer.rows[0].next_entry_sequence)).toBe(startCustomerSeq + 1n);

      // Verify clearing account updated in database (credited)
      const postClearing = await ownerPool.query(
        `SELECT balance_paise, next_entry_sequence FROM public.accounts WHERE id = $1`,
        [SYSTEM_CASH_CLEARING_ID]
      );
      expect(BigInt(postClearing.rows[0].balance_paise)).toBe(startClearingBalance + withdrawAmount);
      expect(BigInt(postClearing.rows[0].next_entry_sequence)).toBe(startClearingSeq + 1n);

      // Verify exactly 2 ledger entries created and balanced
      const entriesRes = await ownerPool.query(
        `SELECT id, account_id, entry_type, amount_paise, balance_after_paise, account_entry_sequence
         FROM public.ledger_entries
         WHERE transfer_id = $1
         ORDER BY entry_type ASC`,
        [transferId]
      );
      expect(entriesRes.rows.length).toBe(2);

      const debitEntry = entriesRes.rows.find((e) => e.entry_type === 'debit');
      const creditEntry = entriesRes.rows.find((e) => e.entry_type === 'credit');

      // Debit entry: customer account
      expect(debitEntry.account_id).toBe(customerAccount1.id);
      expect(debitEntry.amount_paise).toBe(withdrawAmount.toString());
      expect(debitEntry.balance_after_paise).toBe((startCustomerBalance - withdrawAmount).toString());
      expect(debitEntry.account_entry_sequence).toBe(startCustomerSeq.toString());

      // Credit entry: clearing account
      expect(creditEntry.account_id).toBe(SYSTEM_CASH_CLEARING_ID);
      expect(creditEntry.amount_paise).toBe(withdrawAmount.toString());
      expect(creditEntry.balance_after_paise).toBe((startClearingBalance + withdrawAmount).toString());
      expect(creditEntry.account_entry_sequence).toBe(startClearingSeq.toString());
    });

    it('should allow an admin to withdraw from any customer account', async () => {
      const res = await request(app)
        .post('/api/transfers/withdraw')
        .set('Authorization', `Bearer ${adminUser.token}`)
        .set('Idempotency-Key', `WDR-ADMIN-${Date.now()}-${Math.random()}`)
        .send({
          accountId: customerAccount2.id,
          amountPaise: '30000',
        });

      expect(res.status).toBe(201);
      expect(res.body.transfer.sourceAccountId).toBe(customerAccount2.id);
      expect(res.body.transfer.destinationAccountId).toBe(SYSTEM_CASH_CLEARING_ID);
      expect(res.body.transfer.createdByUserId).toBe(adminUser.user.id);
    });
  });

  describe('2. BigInt Range Safety & Precision', () => {
    it('should accept amount equal to PostgreSQL BIGINT maximum without 500, failing with 422 if insufficient funds', async () => {
      const res = await request(app)
        .post('/api/transfers/withdraw')
        .set('Authorization', `Bearer ${customerUser1.token}`)
        .set('Idempotency-Key', `WDR-MAX-BIGINT-${Date.now()}`)
        .send({
          accountId: customerAccount1.id,
          amountPaise: PG_MAX_BIGINT_STR, // Exactly 9223372036854775807
        });

      // Passes validation, fails on insufficient funds cleanly
      expect(res.status).toBe(422);
      expect(res.body.error).toBe('InsufficientFundsError');
      expect(res.body.attemptedAmountPaise).toBe(PG_MAX_BIGINT_STR);
    });

    it('should reject amount exceeding PostgreSQL BIGINT maximum before database with HTTP 400', async () => {
      const res = await request(app)
        .post('/api/transfers/withdraw')
        .set('Authorization', `Bearer ${customerUser1.token}`)
        .set('Idempotency-Key', `WDR-OVERFLOW-${Date.now()}`)
        .send({
          accountId: customerAccount1.id,
          amountPaise: PG_OVERFLOW_BIGINT_STR, // 9223372036854775808 (exceeds int64)
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('ValidationError');
      expect(JSON.stringify(res.body.details)).toContain('exceeds maximum allowed value');
    });

    it('should reject non-integer / floating-point amounts', async () => {
      const res = await request(app)
        .post('/api/transfers/withdraw')
        .set('Authorization', `Bearer ${customerUser1.token}`)
        .set('Idempotency-Key', `WDR-FLOAT-${Date.now()}`)
        .send({
          accountId: customerAccount1.id,
          amountPaise: 50.75,
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('ValidationError');
    });

    it('should reject numbers exceeding MAX_SAFE_INTEGER when passed as numeric type', async () => {
      const res = await request(app)
        .post('/api/transfers/withdraw')
        .set('Authorization', `Bearer ${customerUser1.token}`)
        .set('Idempotency-Key', `WDR-UNSAFE-NUM-${Date.now()}`)
        .send({
          accountId: customerAccount1.id,
          amountPaise: 9007199254740992,
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('ValidationError');
    });

    it('should reject zero, negative amounts, leading zeroes, and non-digit strings with HTTP 400 (no audit)', async () => {
      const invalidAmounts = [0, -100, '-50', '0', '005', '10.5', 'invalid', ''];

      for (const amount of invalidAmounts) {
        const res = await request(app)
          .post('/api/transfers/withdraw')
          .set('Authorization', `Bearer ${customerUser1.token}`)
          .set('Idempotency-Key', `WDR-INV-${Date.now()}-${Math.random()}`)
          .send({
            accountId: customerAccount1.id,
            amountPaise: amount,
          });

        expect(res.status).toBe(400);
        expect(res.body.error).toBe('ValidationError');
      }

      // Confirm no refusal audits were inserted for validation errors
      const auditCheck = await ownerPool.query(
        `SELECT COUNT(*) FROM public.audit_refused_attempts WHERE user_id = $1 AND reason_code = 'VALIDATION_ERROR'`,
        [customerUser1.user.id]
      );
      expect(parseInt(auditCheck.rows[0].count, 10)).toBe(0);
    });
  });

  describe('3. Insufficient Funds & Business Rule Refusals (with Audit)', () => {
    it('should reject withdrawal exceeding balance with HTTP 422, zero balance mutation, and refusal audit', async () => {
      const preBalanceRes = await ownerPool.query(
        `SELECT balance_paise FROM public.accounts WHERE id = $1`,
        [customerAccount1.id]
      );
      const preBalance = BigInt(preBalanceRes.rows[0].balance_paise);
      const attemptedAmount = preBalance + 50000n;
      const idempotencyKey = `WDR-INSUF-${Date.now()}`;

      const res = await request(app)
        .post('/api/transfers/withdraw')
        .set('Authorization', `Bearer ${customerUser1.token}`)
        .set('Idempotency-Key', idempotencyKey)
        .send({
          accountId: customerAccount1.id,
          amountPaise: attemptedAmount.toString(),
        });

      expect(res.status).toBe(422);
      expect(res.body.error).toBe('InsufficientFundsError');
      expect(res.body.currentBalancePaise).toBe(preBalance.toString());
      expect(res.body.attemptedAmountPaise).toBe(attemptedAmount.toString());

      // Verify balance remained completely untouched
      const postBalanceRes = await ownerPool.query(
        `SELECT balance_paise FROM public.accounts WHERE id = $1`,
        [customerAccount1.id]
      );
      expect(BigInt(postBalanceRes.rows[0].balance_paise)).toBe(preBalance);

      // Verify refusal audit was created
      const auditRes = await ownerPool.query(
        `SELECT id, user_id, account_id, action, attempted_amount_paise, reason_code, idempotency_key
         FROM public.audit_refused_attempts
         WHERE idempotency_key = $1`,
        [idempotencyKey]
      );
      expect(auditRes.rows.length).toBe(1);
      expect(auditRes.rows[0].user_id).toBe(customerUser1.user.id);
      expect(auditRes.rows[0].account_id).toBe(customerAccount1.id);
      expect(auditRes.rows[0].action).toBe('withdrawal');
      expect(auditRes.rows[0].attempted_amount_paise).toBe(attemptedAmount.toString());
      expect(auditRes.rows[0].reason_code).toBe('INSUFFICIENT_FUNDS');
    });

    it('should reject account holder withdrawing from another customer account (403 + Refusal Audit)', async () => {
      const idempotencyKey = `WDR-FORBIDDEN-${Date.now()}`;

      const res = await request(app)
        .post('/api/transfers/withdraw')
        .set('Authorization', `Bearer ${customerUser1.token}`)
        .set('Idempotency-Key', idempotencyKey)
        .send({
          accountId: customerAccount2.id, // Owned by customerUser2
          amountPaise: 10000,
        });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('ForbiddenError');

      const auditRes = await ownerPool.query(
        `SELECT id, account_id, reason_code FROM public.audit_refused_attempts WHERE idempotency_key = $1`,
        [idempotencyKey]
      );
      expect(auditRes.rows.length).toBe(1);
      expect(auditRes.rows[0].account_id).toBe(customerAccount2.id);
      expect(auditRes.rows[0].reason_code).toBe('FORBIDDEN_OWNERSHIP');
    });

    it('should reject withdrawal from nonexistent account (404 + Refusal Audit with NULL account_id and preserved UUID)', async () => {
      const nonexistentId = crypto.randomUUID();
      const idempotencyKey = `WDR-404-${Date.now()}`;

      const res = await request(app)
        .post('/api/transfers/withdraw')
        .set('Authorization', `Bearer ${customerUser1.token}`)
        .set('Idempotency-Key', idempotencyKey)
        .send({
          accountId: nonexistentId,
          amountPaise: 15000,
        });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('NotFoundError');

      const auditRes = await ownerPool.query(
        `SELECT id, account_id, reason_code, reason_message
         FROM public.audit_refused_attempts
         WHERE idempotency_key = $1`,
        [idempotencyKey]
      );
      expect(auditRes.rows.length).toBe(1);
      expect(auditRes.rows[0].account_id).toBeNull();
      expect(auditRes.rows[0].reason_code).toBe('ACCOUNT_NOT_FOUND');
      expect(auditRes.rows[0].reason_message).toContain(nonexistentId);
    });

    it('should reject withdrawal from system accounts (422 + Refusal Audit)', async () => {
      if (!systemEquityAccount) return;

      const idempotencyKey = `WDR-SYSTEM-${Date.now()}`;

      const res = await request(app)
        .post('/api/transfers/withdraw')
        .set('Authorization', `Bearer ${adminUser.token}`)
        .set('Idempotency-Key', idempotencyKey)
        .send({
          accountId: systemEquityAccount.id,
          amountPaise: 5000,
        });

      expect(res.status).toBe(422);
      expect(res.body.error).toBe('InvariantViolationError');

      const auditRes = await ownerPool.query(
        `SELECT id, account_id, reason_code FROM public.audit_refused_attempts WHERE idempotency_key = $1`,
        [idempotencyKey]
      );
      expect(auditRes.rows.length).toBe(1);
      expect(auditRes.rows[0].account_id).toBe(systemEquityAccount.id);
      expect(auditRes.rows[0].reason_code).toBe('INVALID_ACCOUNT_TYPE');
    });
  });

  describe('4. Idempotency State Machine & Replay Semantics', () => {
    it('should replay completed withdrawal on identical retry with Idempotent-Replayed header', async () => {
      const idempotencyKey = `WDR-REPLAY-${Date.now()}`;

      const firstRes = await request(app)
        .post('/api/transfers/withdraw')
        .set('Authorization', `Bearer ${customerUser1.token}`)
        .set('Idempotency-Key', idempotencyKey)
        .send({
          accountId: customerAccount1.id,
          amountPaise: 5000,
        });

      expect(firstRes.status).toBe(201);
      expect(firstRes.headers['idempotent-replayed']).toBeUndefined();
      const firstTransferId = firstRes.body.transfer.id;

      // Second identical request
      const secondRes = await request(app)
        .post('/api/transfers/withdraw')
        .set('Authorization', `Bearer ${customerUser1.token}`)
        .set('Idempotency-Key', idempotencyKey)
        .send({
          accountId: customerAccount1.id,
          amountPaise: 5000,
        });

      expect(secondRes.status).toBe(201);
      expect(secondRes.headers['idempotent-replayed']).toBe('true');
      expect(secondRes.body.transfer.id).toBe(firstTransferId);

      // Verify no duplicate transfer or ledger entries were created
      const transferCount = await ownerPool.query(
        `SELECT COUNT(*) FROM public.transfers WHERE id = $1`,
        [firstTransferId]
      );
      expect(parseInt(transferCount.rows[0].count, 10)).toBe(1);

      const entryCount = await ownerPool.query(
        `SELECT COUNT(*) FROM public.ledger_entries WHERE transfer_id = $1`,
        [firstTransferId]
      );
      expect(parseInt(entryCount.rows[0].count, 10)).toBe(2);
    });

    it('should return 409 Conflict when same idempotency key is reused with different payload', async () => {
      const idempotencyKey = `WDR-CONFLICT-${Date.now()}`;

      const firstRes = await request(app)
        .post('/api/transfers/withdraw')
        .set('Authorization', `Bearer ${customerUser1.token}`)
        .set('Idempotency-Key', idempotencyKey)
        .send({
          accountId: customerAccount1.id,
          amountPaise: 3000,
        });
      expect(firstRes.status).toBe(201);

      // Same key, different amount
      const conflictRes = await request(app)
        .post('/api/transfers/withdraw')
        .set('Authorization', `Bearer ${customerUser1.token}`)
        .set('Idempotency-Key', idempotencyKey)
        .send({
          accountId: customerAccount1.id,
          amountPaise: 6000,
        });

      expect(conflictRes.status).toBe(409);
      expect(conflictRes.body.error).toBe('IdempotencyConflictError');
    });
  });

  describe('5. Concurrency & Overdraft Prevention', () => {
    it('should prevent overdraft when two concurrent withdrawals compete for the same balance', async () => {
      // Create a dedicated account with exactly 10,000 paise
      const fundedAccount = await createTestAccount({
        accountNumber: `ACC-RACE-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
        balancePaise: 10000,
        userId: customerUser1.user.id,
      });

      // Two concurrent withdrawals of 8,000 paise each (total attempted: 16,000 > 10,000)
      const req1 = request(app)
        .post('/api/transfers/withdraw')
        .set('Authorization', `Bearer ${customerUser1.token}`)
        .set('Idempotency-Key', `WDR-RACE-1-${Date.now()}`)
        .send({
          accountId: fundedAccount.id,
          amountPaise: 8000,
        });

      const req2 = request(app)
        .post('/api/transfers/withdraw')
        .set('Authorization', `Bearer ${customerUser1.token}`)
        .set('Idempotency-Key', `WDR-RACE-2-${Date.now()}`)
        .send({
          accountId: fundedAccount.id,
          amountPaise: 8000,
        });

      const [res1, res2] = await Promise.all([req1, req2]);

      const statuses = [res1.status, res2.status].sort();
      // Exactly one must succeed (201) and exactly one must fail (422 InsufficientFunds)
      expect(statuses).toEqual([201, 422]);

      // Verify final balance is exactly 2,000 paise (never negative)
      const postCheck = await ownerPool.query(
        `SELECT balance_paise FROM public.accounts WHERE id = $1`,
        [fundedAccount.id]
      );
      expect(BigInt(postCheck.rows[0].balance_paise)).toBe(2000n);
    });

    it('should verify identical concurrent requests with the SAME key produce exactly one withdrawal', async () => {
      const sharedKey = `WDR-IDENT-CONC-${Date.now()}`;

      const requests = [
        request(app)
          .post('/api/transfers/withdraw')
          .set('Authorization', `Bearer ${customerUser2.token}`)
          .set('Idempotency-Key', sharedKey)
          .send({
            accountId: customerAccount2.id,
            amountPaise: 4000,
          }),
        request(app)
          .post('/api/transfers/withdraw')
          .set('Authorization', `Bearer ${customerUser2.token}`)
          .set('Idempotency-Key', sharedKey)
          .send({
            accountId: customerAccount2.id,
            amountPaise: 4000,
          }),
      ];

      const responses = await Promise.all(requests);
      const statuses = responses.map((r) => r.status);

      expect(statuses).toContain(201);
      const successfulResponses = responses.filter((r) => r.status === 201);
      expect(successfulResponses.length).toBeGreaterThanOrEqual(1);

      const transferId = successfulResponses[0].body.transfer.id;

      // Verify in database: exactly ONE transfer was recorded
      const dbCheck = await ownerPool.query(
        `SELECT COUNT(*) FROM public.transfers WHERE id = $1`,
        [transferId]
      );
      expect(parseInt(dbCheck.rows[0].count, 10)).toBe(1);

      // Verify exactly TWO ledger entries were recorded
      const entryCheck = await ownerPool.query(
        `SELECT COUNT(*) FROM public.ledger_entries WHERE transfer_id = $1`,
        [transferId]
      );
      expect(parseInt(entryCheck.rows[0].count, 10)).toBe(2);
    });
  });

  describe('6. Refusal Audit Persistence Fallback', () => {
    it('should return HTTP 500 with durableAudit=false if audit persistence fails during refusal', async () => {
      const auditSpy = jest
        .spyOn(auditService, 'recordRefusalAudit')
        .mockRejectedValueOnce(new auditService.AuditPersistenceError('Simulated audit insert failure'));

      const res = await request(app)
        .post('/api/transfers/withdraw')
        .set('Authorization', `Bearer ${customerUser1.token}`)
        .set('Idempotency-Key', `WDR-AUDIT-FAIL-${Date.now()}`)
        .send({
          accountId: customerAccount2.id, // triggers 403 refusal
          amountPaise: 5000,
        });

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('AuditPersistenceError');
      expect(res.body.durableAudit).toBe(false);

      auditSpy.mockRestore();
    });
  });
});
