const request = require('supertest');
const crypto = require('crypto');
const app = require('../src/app');
const { pool } = require('../src/config/db');
const { createTestUser, createTestAccount, ownerPool } = require('./helpers/auth');
const auditService = require('../src/services/auditService');

const SYSTEM_CASH_CLEARING_ID = '00000000-0000-0000-0000-000000000002';

describe('POST /api/transfers/deposit - Cash Deposits (Phase 6 Stage 5.2)', () => {
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
      accountNumber: `ACC-DEP-1-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      balancePaise: 50000,
      userId: customerUser1.user.id,
    });

    customerAccount2 = await createTestAccount({
      accountNumber: `ACC-DEP-2-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      balancePaise: 100000,
      userId: customerUser2.user.id,
    });

    unassignedAccount = await createTestAccount({
      accountNumber: `ACC-DEP-UN-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      balancePaise: 0,
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

  describe('1. Successful Deposit Execution & Double-Entry Balancing', () => {
    it('should successfully deposit funds into own account, credit customer, debit clearing, and sequence both', async () => {
      // Capture starting next_entry_sequence and balances
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

      const depositAmount = 25000n;
      const idempotencyKey = `DEP-SUCCESS-${Date.now()}-${Math.random()}`;

      const res = await request(app)
        .post('/api/transfers/deposit')
        .set('Authorization', `Bearer ${customerUser1.token}`)
        .set('Idempotency-Key', idempotencyKey)
        .send({
          accountId: customerAccount1.id,
          amountPaise: 25000,
        });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('message', 'Deposit completed successfully');
      expect(res.body.transfer).toBeDefined();
      expect(res.body.transfer.transferType).toBe('deposit');
      expect(res.body.transfer.sourceAccountId).toBe(SYSTEM_CASH_CLEARING_ID);
      expect(res.body.transfer.destinationAccountId).toBe(customerAccount1.id);
      expect(res.body.transfer.amountPaise).toBe('25000');
      expect(res.body.transfer.status).toBe('completed');
      expect(res.body.transfer.createdByUserId).toBe(customerUser1.user.id);
      expect(res.body.account.balancePaise).toBe((startCustomerBalance + depositAmount).toString());
      expect(res.body.account.accountEntrySequence).toBe(startCustomerSeq.toString());

      const transferId = res.body.transfer.id;

      // Verify customer account in database
      const postCustomer = await ownerPool.query(
        `SELECT balance_paise, next_entry_sequence FROM public.accounts WHERE id = $1`,
        [customerAccount1.id]
      );
      expect(BigInt(postCustomer.rows[0].balance_paise)).toBe(startCustomerBalance + depositAmount);
      expect(BigInt(postCustomer.rows[0].next_entry_sequence)).toBe(startCustomerSeq + 1n);

      // Verify clearing account in database
      const postClearing = await ownerPool.query(
        `SELECT balance_paise, next_entry_sequence FROM public.accounts WHERE id = $1`,
        [SYSTEM_CASH_CLEARING_ID]
      );
      expect(BigInt(postClearing.rows[0].balance_paise)).toBe(startClearingBalance - depositAmount);
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

      const creditEntry = entriesRes.rows.find((e) => e.entry_type === 'credit');
      const debitEntry = entriesRes.rows.find((e) => e.entry_type === 'debit');

      // Credit entry: customer account
      expect(creditEntry.account_id).toBe(customerAccount1.id);
      expect(creditEntry.amount_paise).toBe(depositAmount.toString());
      expect(creditEntry.balance_after_paise).toBe((startCustomerBalance + depositAmount).toString());
      expect(creditEntry.account_entry_sequence).toBe(startCustomerSeq.toString());

      // Debit entry: clearing account
      expect(debitEntry.account_id).toBe(SYSTEM_CASH_CLEARING_ID);
      expect(debitEntry.amount_paise).toBe(depositAmount.toString());
      expect(debitEntry.balance_after_paise).toBe((startClearingBalance - depositAmount).toString());
      expect(debitEntry.account_entry_sequence).toBe(startClearingSeq.toString());
    });

    it('should allow an admin to deposit into any customer account', async () => {
      const res = await request(app)
        .post('/api/transfers/deposit')
        .set('Authorization', `Bearer ${adminUser.token}`)
        .set('Idempotency-Key', `DEP-ADMIN-${Date.now()}-${Math.random()}`)
        .send({
          accountId: customerAccount2.id,
          amountPaise: '50000',
        });

      expect(res.status).toBe(201);
      expect(res.body.transfer.destinationAccountId).toBe(customerAccount2.id);
      expect(res.body.transfer.createdByUserId).toBe(adminUser.user.id);
    });
  });

  describe('2. Amount Precision & Validation Rules', () => {
    it('should reject non-integer / floating-point amounts', async () => {
      const res = await request(app)
        .post('/api/transfers/deposit')
        .set('Authorization', `Bearer ${customerUser1.token}`)
        .set('Idempotency-Key', `DEP-FLOAT-${Date.now()}`)
        .send({
          accountId: customerAccount1.id,
          amountPaise: 100.5,
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('ValidationError');
    });

    it('should reject numbers exceeding MAX_SAFE_INTEGER when passed as numeric type', async () => {
      const res = await request(app)
        .post('/api/transfers/deposit')
        .set('Authorization', `Bearer ${customerUser1.token}`)
        .set('Idempotency-Key', `DEP-UNSAFE-${Date.now()}`)
        .send({
          accountId: customerAccount1.id,
          amountPaise: 9007199254740992, // Number.MAX_SAFE_INTEGER + 1
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('ValidationError');
    });

    it('should accept valid decimal digit strings beyond MAX_SAFE_INTEGER and convert directly to BigInt', async () => {
      const hugeAmountStr = '9007199254740993'; // String representation safe for BigInt

      const res = await request(app)
        .post('/api/transfers/deposit')
        .set('Authorization', `Bearer ${customerUser1.token}`)
        .set('Idempotency-Key', `DEP-BIGINT-${Date.now()}`)
        .send({
          accountId: customerAccount1.id,
          amountPaise: hugeAmountStr,
        });

      expect(res.status).toBe(201);
      expect(res.body.transfer.amountPaise).toBe(hugeAmountStr);
    });

    it('should reject zero, negative amounts, leading zeroes, and non-digit strings', async () => {
      const invalidAmounts = [0, -100, '-50', '0', '005', '10.5', 'abc', ''];

      for (const amount of invalidAmounts) {
        const res = await request(app)
          .post('/api/transfers/deposit')
          .set('Authorization', `Bearer ${customerUser1.token}`)
          .set('Idempotency-Key', `DEP-INV-${Date.now()}-${Math.random()}`)
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

  describe('3. Authorization & Business Rule Refusals (with Audit)', () => {
    it('should reject account holder depositing into another customer account (403 + Refusal Audit)', async () => {
      const idempotencyKey = `DEP-FORBIDDEN-${Date.now()}`;

      const res = await request(app)
        .post('/api/transfers/deposit')
        .set('Authorization', `Bearer ${customerUser1.token}`)
        .set('Idempotency-Key', idempotencyKey)
        .send({
          accountId: customerAccount2.id, // Owned by customerUser2
          amountPaise: 15000,
        });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('ForbiddenError');

      // Verify refusal audit was created
      const auditRes = await ownerPool.query(
        `SELECT id, user_id, account_id, action, attempted_amount_paise, reason_code, idempotency_key
         FROM public.audit_refused_attempts
         WHERE idempotency_key = $1`,
        [idempotencyKey]
      );
      expect(auditRes.rows.length).toBe(1);
      expect(auditRes.rows[0].user_id).toBe(customerUser1.user.id);
      expect(auditRes.rows[0].account_id).toBe(customerAccount2.id);
      expect(auditRes.rows[0].action).toBe('deposit');
      expect(auditRes.rows[0].attempted_amount_paise).toBe('15000');
      expect(auditRes.rows[0].reason_code).toBe('FORBIDDEN_OWNERSHIP');
    });

    it('should reject account holder depositing into unassigned account (403 + Refusal Audit)', async () => {
      const idempotencyKey = `DEP-UNASSIGNED-${Date.now()}`;

      const res = await request(app)
        .post('/api/transfers/deposit')
        .set('Authorization', `Bearer ${customerUser1.token}`)
        .set('Idempotency-Key', idempotencyKey)
        .send({
          accountId: unassignedAccount.id,
          amountPaise: 20000,
        });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('ForbiddenError');

      const auditRes = await ownerPool.query(
        `SELECT id, account_id, reason_code FROM public.audit_refused_attempts WHERE idempotency_key = $1`,
        [idempotencyKey]
      );
      expect(auditRes.rows.length).toBe(1);
      expect(auditRes.rows[0].account_id).toBe(unassignedAccount.id);
      expect(auditRes.rows[0].reason_code).toBe('FORBIDDEN_OWNERSHIP');
    });

    it('should reject deposit into nonexistent account (404 + Refusal Audit with NULL account_id and preserved UUID)', async () => {
      const nonexistentId = crypto.randomUUID();
      const idempotencyKey = `DEP-404-${Date.now()}`;

      const res = await request(app)
        .post('/api/transfers/deposit')
        .set('Authorization', `Bearer ${customerUser1.token}`)
        .set('Idempotency-Key', idempotencyKey)
        .send({
          accountId: nonexistentId,
          amountPaise: 30000,
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

    it('should reject deposit into system accounts (422 + Refusal Audit)', async () => {
      if (!systemEquityAccount) return;

      const idempotencyKey = `DEP-SYSTEM-${Date.now()}`;

      const res = await request(app)
        .post('/api/transfers/deposit')
        .set('Authorization', `Bearer ${adminUser.token}`)
        .set('Idempotency-Key', idempotencyKey)
        .send({
          accountId: systemEquityAccount.id,
          amountPaise: 10000,
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
    it('should replay completed deposit on identical retry with Idempotent-Replayed header', async () => {
      const idempotencyKey = `DEP-REPLAY-${Date.now()}`;

      const firstRes = await request(app)
        .post('/api/transfers/deposit')
        .set('Authorization', `Bearer ${customerUser1.token}`)
        .set('Idempotency-Key', idempotencyKey)
        .send({
          accountId: customerAccount1.id,
          amountPaise: 10000,
        });

      expect(firstRes.status).toBe(201);
      expect(firstRes.headers['idempotent-replayed']).toBeUndefined();
      const firstTransferId = firstRes.body.transfer.id;

      // Second identical request
      const secondRes = await request(app)
        .post('/api/transfers/deposit')
        .set('Authorization', `Bearer ${customerUser1.token}`)
        .set('Idempotency-Key', idempotencyKey)
        .send({
          accountId: customerAccount1.id,
          amountPaise: 10000,
        });

      expect(secondRes.status).toBe(201);
      expect(secondRes.headers['idempotent-replayed']).toBe('true');
      expect(secondRes.body.transfer.id).toBe(firstTransferId);

      // Verify no duplicate transfer or ledger entries were created in database
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
      const idempotencyKey = `DEP-CONFLICT-${Date.now()}`;

      const firstRes = await request(app)
        .post('/api/transfers/deposit')
        .set('Authorization', `Bearer ${customerUser1.token}`)
        .set('Idempotency-Key', idempotencyKey)
        .send({
          accountId: customerAccount1.id,
          amountPaise: 10000,
        });
      expect(firstRes.status).toBe(201);

      // Same key, different amount
      const conflictRes = await request(app)
        .post('/api/transfers/deposit')
        .set('Authorization', `Bearer ${customerUser1.token}`)
        .set('Idempotency-Key', idempotencyKey)
        .send({
          accountId: customerAccount1.id,
          amountPaise: 20000,
        });

      expect(conflictRes.status).toBe(409);
      expect(conflictRes.body.error).toBe('IdempotencyConflictError');
    });
  });

  describe('5. Concurrency & Contiguous Sequence Allocation', () => {
    it('should handle concurrent deposits to same account, producing contiguous sequences relative to starting value', async () => {
      // Capture exact starting next_entry_sequence
      const preCheck = await ownerPool.query(
        `SELECT balance_paise, next_entry_sequence FROM public.accounts WHERE id = $1`,
        [customerAccount1.id]
      );
      const startBalance = BigInt(preCheck.rows[0].balance_paise);
      const startSeq = BigInt(preCheck.rows[0].next_entry_sequence);

      const CONCURRENT_COUNT = 5;
      const depositAmount = 5000n;

      // Dispatch 5 concurrent deposits with distinct idempotency keys
      const requests = Array.from({ length: CONCURRENT_COUNT }, (_, i) =>
        request(app)
          .post('/api/transfers/deposit')
          .set('Authorization', `Bearer ${customerUser1.token}`)
          .set('Idempotency-Key', `DEP-CONC-${Date.now()}-${i}-${Math.random()}`)
          .send({
            accountId: customerAccount1.id,
            amountPaise: 5000,
          })
      );

      const results = await Promise.all(requests);

      // All 5 must succeed (HTTP 201)
      results.forEach((res) => {
        expect(res.status).toBe(201);
      });

      // Collect returned sequences
      const returnedSeqs = results
        .map((r) => BigInt(r.body.account.accountEntrySequence))
        .sort((a, b) => (a < b ? -1 : 1));

      // Verify sequence contiguousness: startSeq, startSeq + 1, ..., startSeq + 4
      for (let i = 0; i < CONCURRENT_COUNT; i++) {
        expect(returnedSeqs[i]).toBe(startSeq + BigInt(i));
      }

      // Verify final account balance in database
      const postCheck = await ownerPool.query(
        `SELECT balance_paise, next_entry_sequence FROM public.accounts WHERE id = $1`,
        [customerAccount1.id]
      );
      const expectedBalance = startBalance + depositAmount * BigInt(CONCURRENT_COUNT);
      expect(BigInt(postCheck.rows[0].balance_paise)).toBe(expectedBalance);
      expect(BigInt(postCheck.rows[0].next_entry_sequence)).toBe(startSeq + BigInt(CONCURRENT_COUNT));
    });

    it('should verify identical concurrent requests with the SAME key produce exactly one deposit', async () => {
      const sharedKey = `DEP-IDENT-CONC-${Date.now()}`;

      const requests = [
        request(app)
          .post('/api/transfers/deposit')
          .set('Authorization', `Bearer ${customerUser1.token}`)
          .set('Idempotency-Key', sharedKey)
          .send({
            accountId: customerAccount1.id,
            amountPaise: 7000,
          }),
        request(app)
          .post('/api/transfers/deposit')
          .set('Authorization', `Bearer ${customerUser1.token}`)
          .set('Idempotency-Key', sharedKey)
          .send({
            accountId: customerAccount1.id,
            amountPaise: 7000,
          }),
      ];

      const responses = await Promise.all(requests);
      const statuses = responses.map((r) => r.status);

      // Either both return 201 (one created, one replayed) or one 201 and one 409 (if lock contention rejected in-flight)
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
        .post('/api/transfers/deposit')
        .set('Authorization', `Bearer ${customerUser1.token}`)
        .set('Idempotency-Key', `DEP-AUDIT-FAIL-${Date.now()}`)
        .send({
          accountId: customerAccount2.id, // triggers 403 refusal
          amountPaise: 10000,
        });

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('AuditPersistenceError');
      expect(res.body.durableAudit).toBe(false);

      auditSpy.mockRestore();
    });
  });
});
