const request = require('supertest');
const app = require('../src/app');
const { pool } = require('../src/config/db');
const { createTestUser, createTestAccount, ownerPool } = require('./helpers/auth');
const auditService = require('../src/services/auditService');

const SYSTEM_CASH_CLEARING_ID = '00000000-0000-0000-0000-000000000002';

describe('GET /api/accounts/:id/statement - Account Statements (Phase 6 Stage 5.4)', () => {
  let customerUser1;
  let customerUser2;
  let adminUser;
  let auditorUser;
  let customerAccount1;
  let customerAccount2;
  let unassignedAccount;
  let emptyAccount;

  beforeAll(async () => {
    customerUser1 = await createTestUser({ role: 'account_holder' });
    customerUser2 = await createTestUser({ role: 'account_holder' });
    adminUser = await createTestUser({ role: 'admin' });
    auditorUser = await createTestUser({ role: 'auditor' });

    customerAccount1 = await createTestAccount({
      accountNumber: `ST-1-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      balancePaise: 100000,
      userId: customerUser1.user.id,
    });

    customerAccount2 = await createTestAccount({
      accountNumber: `ST-2-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      balancePaise: 200000,
      userId: customerUser2.user.id,
    });

    unassignedAccount = await createTestAccount({
      accountNumber: `ST-UN-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      balancePaise: 50000,
      userId: null,
    });

    emptyAccount = await createTestAccount({
      accountNumber: `ST-EMP-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      balancePaise: 0,
      userId: customerUser1.user.id,
    });
  });

  afterAll(async () => {
    await pool.end();
    await ownerPool.end();
  });

  describe('1. Authentication & Role-Based Access Control (RBAC)', () => {
    it('should reject unauthenticated request with 401', async () => {
      const res = await request(app).get(`/api/accounts/${customerAccount1.id}/statement`);
      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('error', 'Unauthorized');
    });

    it('should allow an account holder to view their own account statement', async () => {
      const res = await request(app)
        .get(`/api/accounts/${customerAccount1.id}/statement`)
        .set('Authorization', `Bearer ${customerUser1.token}`);

      expect(res.status).toBe(200);
      expect(res.body.account).toBeDefined();
      expect(res.body.account.id).toBe(customerAccount1.id);
      expect(res.body.statement).toBeDefined();
      expect(Array.isArray(res.body.statement.entries)).toBe(true);
    });

    it('should forbid an account holder from viewing another user\'s account statement', async () => {
      const res = await request(app)
        .get(`/api/accounts/${customerAccount2.id}/statement`)
        .set('Authorization', `Bearer ${customerUser1.token}`);

      expect(res.status).toBe(403);
      expect(res.body).toHaveProperty('error', 'ForbiddenError');
      expect(res.body.message).toMatch(/do not own this account/i);
    });

    it('should forbid an account holder from viewing an unassigned account statement', async () => {
      const res = await request(app)
        .get(`/api/accounts/${unassignedAccount.id}/statement`)
        .set('Authorization', `Bearer ${customerUser1.token}`);

      expect(res.status).toBe(403);
      expect(res.body).toHaveProperty('error', 'ForbiddenError');
      expect(res.body.message).toMatch(/do not own this account/i);
    });

    it('should allow an admin to view any customer account statement', async () => {
      const res = await request(app)
        .get(`/api/accounts/${customerAccount1.id}/statement`)
        .set('Authorization', `Bearer ${adminUser.token}`);

      expect(res.status).toBe(200);
      expect(res.body.account.id).toBe(customerAccount1.id);
    });

    it('should allow an admin to view an unassigned account statement', async () => {
      const res = await request(app)
        .get(`/api/accounts/${unassignedAccount.id}/statement`)
        .set('Authorization', `Bearer ${adminUser.token}`);

      expect(res.status).toBe(200);
      expect(res.body.account.id).toBe(unassignedAccount.id);
    });

    it('should allow an admin to view system clearing account statement', async () => {
      const res = await request(app)
        .get(`/api/accounts/${SYSTEM_CASH_CLEARING_ID}/statement`)
        .set('Authorization', `Bearer ${adminUser.token}`);

      expect(res.status).toBe(200);
      expect(res.body.account.id).toBe(SYSTEM_CASH_CLEARING_ID);
      expect(res.body.account.accountType).toBe('system_clearing');
    });

    it('should allow an auditor to view customer account statement', async () => {
      const res = await request(app)
        .get(`/api/accounts/${customerAccount1.id}/statement`)
        .set('Authorization', `Bearer ${auditorUser.token}`);

      expect(res.status).toBe(200);
      expect(res.body.account.id).toBe(customerAccount1.id);
    });

    it('should return 404 for a nonexistent account UUID', async () => {
      const nonexistentId = '11111111-2222-3333-4444-555555555555';
      const res = await request(app)
        .get(`/api/accounts/${nonexistentId}/statement`)
        .set('Authorization', `Bearer ${adminUser.token}`);

      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('error', 'NotFoundError');
    });

    it('should return 400 for an invalid UUID format in the URL path', async () => {
      const res = await request(app)
        .get('/api/accounts/not-a-valid-uuid/statement')
        .set('Authorization', `Bearer ${adminUser.token}`);

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error', 'ValidationError');
    });
  });

  describe('2. Account Metadata Verification', () => {
    it('should return complete account metadata including cutover snapshot and sequence fields', async () => {
      const res = await request(app)
        .get(`/api/accounts/${customerAccount1.id}/statement`)
        .set('Authorization', `Bearer ${customerUser1.token}`);

      expect(res.status).toBe(200);
      const { account } = res.body;

      expect(account.id).toBe(customerAccount1.id);
      expect(account.accountNumber).toBe(customerAccount1.account_number);
      expect(account.accountType).toBe('customer');
      expect(typeof account.currentBalancePaise).toBe('string');
      expect(account.currentBalancePaise).toBe('100000');
      // For accounts created post-cutover trigger, cutover balance is snapshot of initial balance
      expect(account.phase6CutoverBalancePaise).toBeDefined();
      expect(typeof account.phase6CutoverBalancePaise).toBe('string');
      expect(account.phase6CutoverCapturedAt).toBeDefined();
      expect(account.nextEntrySequence).toBeDefined();
      expect(typeof account.nextEntrySequence).toBe('string');
    });
  });

  describe('3. Dual-Regime Total Ordering (Legacy vs Sequenced Entries)', () => {
    let orderedAccount;
    let counterpartyAccount;
    let legacyEntry1;
    let legacyEntry2;
    let sequencedEntry1;
    let sequencedEntry2;

    beforeAll(async () => {
      // Create dedicated ephemeral accounts for ordering verification
      orderedAccount = await createTestAccount({
        accountNumber: `ORD-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        balancePaise: 500000,
        userId: customerUser1.user.id,
      });

      counterpartyAccount = await createTestAccount({
        accountNumber: `ORD-CP-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        balancePaise: 500000,
        userId: customerUser2.user.id,
      });

      const client = await ownerPool.connect();
      try {
        await client.query('BEGIN');

        // Insert legacy transfer 1 (unsequenced: sequence = NULL) at timestamp T1
        const t1Res = await client.query(
          `INSERT INTO public.transfers (source_account_id, destination_account_id, amount_paise, status, transfer_type, created_by_user_id, created_at)
           VALUES ($1, $2, $3, 'completed', 'customer_transfer', $4, '2026-01-01T10:00:00Z')
           RETURNING id`,
          [orderedAccount.id, counterpartyAccount.id, 5000n, customerUser1.user.id]
        );
        const t1Id = t1Res.rows[0].id;
        const le1Res = await client.query(
          `INSERT INTO public.ledger_entries (transfer_id, account_id, entry_type, amount_paise, balance_after_paise, account_entry_sequence, created_at)
           VALUES ($1, $2, 'debit', $3, $4, NULL, '2026-01-01T10:00:00Z')
           RETURNING id`,
          [t1Id, orderedAccount.id, 5000n, 495000n]
        );
        legacyEntry1 = le1Res.rows[0];
        await client.query(
          `INSERT INTO public.ledger_entries (transfer_id, account_id, entry_type, amount_paise, balance_after_paise, account_entry_sequence, created_at)
           VALUES ($1, $2, 'credit', $3, $4, NULL, '2026-01-01T10:00:00Z')`,
          [t1Id, counterpartyAccount.id, 5000n, 505000n]
        );

        // Insert legacy transfer 2 (unsequenced: sequence = NULL) at timestamp T2
        const t2Res = await client.query(
          `INSERT INTO public.transfers (source_account_id, destination_account_id, amount_paise, status, transfer_type, created_by_user_id, created_at)
           VALUES ($1, $2, $3, 'completed', 'customer_transfer', $4, '2026-01-02T10:00:00Z')
           RETURNING id`,
          [orderedAccount.id, counterpartyAccount.id, 3000n, customerUser1.user.id]
        );
        const t2Id = t2Res.rows[0].id;
        const le2Res = await client.query(
          `INSERT INTO public.ledger_entries (transfer_id, account_id, entry_type, amount_paise, balance_after_paise, account_entry_sequence, created_at)
           VALUES ($1, $2, 'debit', $3, $4, NULL, '2026-01-02T10:00:00Z')
           RETURNING id`,
          [t2Id, orderedAccount.id, 3000n, 492000n]
        );
        legacyEntry2 = le2Res.rows[0];
        await client.query(
          `INSERT INTO public.ledger_entries (transfer_id, account_id, entry_type, amount_paise, balance_after_paise, account_entry_sequence, created_at)
           VALUES ($1, $2, 'credit', $3, $4, NULL, '2026-01-02T10:00:00Z')`,
          [t2Id, counterpartyAccount.id, 3000n, 508000n]
        );

        // Insert sequenced transfer 1 (sequenced: sequence = 1 on orderedAccount) at timestamp T3
        const t3Res = await client.query(
          `INSERT INTO public.transfers (source_account_id, destination_account_id, amount_paise, status, transfer_type, created_by_user_id, created_at)
           VALUES ($1, $2, $3, 'completed', 'customer_transfer', $4, '2026-01-03T10:00:00Z')
           RETURNING id`,
          [counterpartyAccount.id, orderedAccount.id, 10000n, adminUser.user.id]
        );
        const t3Id = t3Res.rows[0].id;
        await client.query(
          `INSERT INTO public.ledger_entries (transfer_id, account_id, entry_type, amount_paise, balance_after_paise, account_entry_sequence, created_at)
           VALUES ($1, $2, 'debit', $3, $4, 1, '2026-01-03T10:00:00Z')`,
          [t3Id, counterpartyAccount.id, 10000n, 498000n]
        );
        const le3Res = await client.query(
          `INSERT INTO public.ledger_entries (transfer_id, account_id, entry_type, amount_paise, balance_after_paise, account_entry_sequence, created_at)
           VALUES ($1, $2, 'credit', $3, $4, 1, '2026-01-03T10:00:00Z')
           RETURNING id`,
          [t3Id, orderedAccount.id, 10000n, 502000n]
        );
        sequencedEntry1 = le3Res.rows[0];

        // Insert sequenced transfer 2 (sequenced: sequence = 2 on orderedAccount) at timestamp T4
        const t4Res = await client.query(
          `INSERT INTO public.transfers (source_account_id, destination_account_id, amount_paise, status, transfer_type, created_by_user_id, created_at)
           VALUES ($1, $2, $3, 'completed', 'customer_transfer', $4, '2026-01-04T10:00:00Z')
           RETURNING id`,
          [orderedAccount.id, counterpartyAccount.id, 2000n, customerUser1.user.id]
        );
        const t4Id = t4Res.rows[0].id;
        const le4Res = await client.query(
          `INSERT INTO public.ledger_entries (transfer_id, account_id, entry_type, amount_paise, balance_after_paise, account_entry_sequence, created_at)
           VALUES ($1, $2, 'debit', $3, $4, 2, '2026-01-04T10:00:00Z')
           RETURNING id`,
          [t4Id, orderedAccount.id, 2000n, 500000n]
        );
        sequencedEntry2 = le4Res.rows[0];
        await client.query(
          `INSERT INTO public.ledger_entries (transfer_id, account_id, entry_type, amount_paise, balance_after_paise, account_entry_sequence, created_at)
           VALUES ($1, $2, 'credit', $3, $4, 2, '2026-01-04T10:00:00Z')`,
          [t4Id, counterpartyAccount.id, 2000n, 500000n]
        );

        // Update orderedAccount balance and sequence to match
        await client.query(
          `UPDATE public.accounts SET balance_paise = 500000, next_entry_sequence = 3 WHERE id = $1`,
          [orderedAccount.id]
        );

        // Update counterpartyAccount balance and sequence to match
        await client.query(
          `UPDATE public.accounts SET balance_paise = 500000, next_entry_sequence = 3 WHERE id = $1`,
          [counterpartyAccount.id]
        );

        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    });

    it('should order legacy unsequenced entries first chronologically, followed strictly by sequenced entries', async () => {
      const res = await request(app)
        .get(`/api/accounts/${orderedAccount.id}/statement`)
        .set('Authorization', `Bearer ${customerUser1.token}`);

      expect(res.status).toBe(200);
      const { entries } = res.body.statement;
      expect(entries).toHaveLength(4);

      // Entry 0: legacy entry 1
      expect(entries[0].id).toBe(legacyEntry1.id);
      expect(entries[0].regime).toBe('legacy_unsequenced');
      expect(entries[0].accountEntrySequence).toBeNull();
      expect(entries[0].historicalNote).toMatch(/Legacy Phase 1-5 unsequenced entry/i);
      expect(entries[0].entryType).toBe('debit');
      expect(entries[0].amountPaise).toBe('5000');
      expect(entries[0].balanceAfterPaise).toBe('495000');
      expect(entries[0].initiatedBy).toBeDefined();
      expect(entries[0].initiatedBy.userId).toBe(customerUser1.user.id);

      // Entry 1: legacy entry 2
      expect(entries[1].id).toBe(legacyEntry2.id);
      expect(entries[1].regime).toBe('legacy_unsequenced');
      expect(entries[1].accountEntrySequence).toBeNull();
      expect(entries[1].historicalNote).toMatch(/Legacy Phase 1-5 unsequenced entry/i);
      expect(entries[1].amountPaise).toBe('3000');

      // Entry 2: sequenced entry 1
      expect(entries[2].id).toBe(sequencedEntry1.id);
      expect(entries[2].regime).toBe('sequenced');
      expect(entries[2].accountEntrySequence).toBe('1');
      expect(entries[2].historicalNote).toBeUndefined();
      expect(entries[2].entryType).toBe('credit');
      expect(entries[2].amountPaise).toBe('10000');
      expect(entries[2].transferType).toBe('customer_transfer');
      expect(entries[2].initiatedBy.userId).toBe(adminUser.user.id);

      // Entry 3: sequenced entry 2
      expect(entries[3].id).toBe(sequencedEntry2.id);
      expect(entries[3].regime).toBe('sequenced');
      expect(entries[3].accountEntrySequence).toBe('2');
      expect(entries[3].historicalNote).toBeUndefined();
      expect(entries[3].entryType).toBe('debit');
      expect(entries[3].amountPaise).toBe('2000');
      expect(entries[3].transferType).toBe('customer_transfer');
      expect(entries[3].initiatedBy.userId).toBe(customerUser1.user.id);
    });
  });

  describe('4. Refused Attempts Separation & 404 Limitation Handling', () => {
    let auditedAccount;
    let refusal1;

    beforeAll(async () => {
      auditedAccount = await createTestAccount({
        accountNumber: `REF-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        balancePaise: 50000,
        userId: customerUser1.user.id,
      });

      // 1. Record an audit refusal associated with auditedAccount
      const res1 = await auditService.recordRefusalAudit({
        userId: customerUser1.user.id,
        accountId: auditedAccount.id,
        accountExists: true,
        action: 'withdrawal',
        amountPaise: 999999,
        reasonCode: 'INSUFFICIENT_FUNDS',
        reasonMessage: 'Requested withdrawal exceeds balance',
        idempotencyKey: `IDEM-REF-1-${Date.now()}`,
        clientIp: '127.0.0.1',
      });
      refusal1 = res1.auditRecord;

      // 2. Record an audit refusal associated with another account (customerAccount2)
      await auditService.recordRefusalAudit({
        userId: customerUser2.user.id,
        accountId: customerAccount2.id,
        accountExists: true,
        action: 'withdrawal',
        amountPaise: 999999,
        reasonCode: 'INSUFFICIENT_FUNDS',
        reasonMessage: 'Other account insufficient funds',
        idempotencyKey: `IDEM-REF-OTHER-${Date.now()}`,
        clientIp: '127.0.0.1',
      });

      // 3. Record an audit refusal on a nonexistent account (account_id = NULL)
      await auditService.recordRefusalAudit({
        userId: customerUser1.user.id,
        accountId: '99999999-9999-9999-9999-999999999999',
        accountExists: false,
        action: 'deposit',
        amountPaise: 10000,
        reasonCode: 'ACCOUNT_NOT_FOUND',
        reasonMessage: 'Target account 99999999-9999-9999-9999-999999999999 not found',
        idempotencyKey: `IDEM-REF-404-${Date.now()}`,
        clientIp: '127.0.0.1',
      });
    });

    it('should omit refused attempts by default when include_refused is omitted or false', async () => {
      const res = await request(app)
        .get(`/api/accounts/${auditedAccount.id}/statement`)
        .set('Authorization', `Bearer ${customerUser1.token}`);

      expect(res.status).toBe(200);
      expect(res.body.statement).toBeDefined();
      expect(res.body.refusedAttempts).toBeUndefined();
      expect(res.body.refusedAttemptsNotice).toBeUndefined();
    });

    it('should separate completed entries and refused attempts when include_refused=true', async () => {
      const res = await request(app)
        .get(`/api/accounts/${auditedAccount.id}/statement?include_refused=true`)
        .set('Authorization', `Bearer ${customerUser1.token}`);

      expect(res.status).toBe(200);
      expect(res.body.statement).toBeDefined();
      expect(res.body.statement.entries).toBeDefined();
      expect(res.body.refusedAttempts).toBeDefined();
      expect(Array.isArray(res.body.refusedAttempts)).toBe(true);

      // Verify refusedAttempts contains only auditedAccount's refusal
      expect(res.body.refusedAttempts).toHaveLength(1);
      const ref = res.body.refusedAttempts[0];
      expect(ref.id).toBe(refusal1.id);
      expect(ref.action).toBe('withdrawal');
      expect(ref.attemptedAmountPaise).toBe('999999');
      expect(ref.reasonCode).toBe('INSUFFICIENT_FUNDS');
      expect(ref.reasonMessage).toBe('Requested withdrawal exceeds balance');
      expect(ref.initiatedBy.userId).toBe(customerUser1.user.id);

      // Verify the mandatory 404 limitation notice is surfaced
      expect(res.body.refusedAttemptsNotice).toBeDefined();
      expect(res.body.refusedAttemptsNotice).toMatch(/Refusals on nonexistent accounts .* stored with account_id=NULL/i);
    });

    it('should confirm that nonexistent 404 refusals (account_id = NULL) are never surfaced in any account statement', async () => {
      // Neither auditedAccount nor customerAccount1 nor customerAccount2 should surface the NULL account_id refusal
      const res = await request(app)
        .get(`/api/accounts/${customerAccount1.id}/statement?include_refused=true`)
        .set('Authorization', `Bearer ${customerUser1.token}`);

      expect(res.status).toBe(200);
      const nullRefusals = (res.body.refusedAttempts || []).filter(
        (r) => r.reasonCode === 'ACCOUNT_NOT_FOUND'
      );
      expect(nullRefusals).toHaveLength(0);
    });
  });

  describe('5. Date Range Filtering & Validation', () => {
    let dateFilterAccount;

    beforeAll(async () => {
      dateFilterAccount = await createTestAccount({
        accountNumber: `DT-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        balancePaise: 300000,
        userId: customerUser1.user.id,
      });

      const client = await ownerPool.connect();
      try {
        await client.query('BEGIN');

        // Entry at 2026-03-01
        const t1 = await client.query(
          `INSERT INTO public.transfers (source_account_id, destination_account_id, amount_paise, status, transfer_type, created_by_user_id, created_at)
           VALUES ($1, $2, 1000, 'completed', 'customer_transfer', $3, '2026-03-01T12:00:00Z')
           RETURNING id`,
          [dateFilterAccount.id, customerAccount2.id, customerUser1.user.id]
        );
        await client.query(
          `INSERT INTO public.ledger_entries (transfer_id, account_id, entry_type, amount_paise, balance_after_paise, account_entry_sequence, created_at)
           VALUES ($1, $2, 'debit', 1000, 299000, 1, '2026-03-01T12:00:00Z')`,
          [t1.rows[0].id, dateFilterAccount.id]
        );
        await client.query(
          `INSERT INTO public.ledger_entries (transfer_id, account_id, entry_type, amount_paise, balance_after_paise, account_entry_sequence, created_at)
           VALUES ($1, $2, 'credit', 1000, 201000, 201, '2026-03-01T12:00:00Z')`,
          [t1.rows[0].id, customerAccount2.id]
        );

        // Entry at 2026-03-15
        const t2 = await client.query(
          `INSERT INTO public.transfers (source_account_id, destination_account_id, amount_paise, status, transfer_type, created_by_user_id, created_at)
           VALUES ($1, $2, 2000, 'completed', 'customer_transfer', $3, '2026-03-15T12:00:00Z')
           RETURNING id`,
          [dateFilterAccount.id, customerAccount2.id, customerUser1.user.id]
        );
        await client.query(
          `INSERT INTO public.ledger_entries (transfer_id, account_id, entry_type, amount_paise, balance_after_paise, account_entry_sequence, created_at)
           VALUES ($1, $2, 'debit', 2000, 297000, 2, '2026-03-15T12:00:00Z')`,
          [t2.rows[0].id, dateFilterAccount.id]
        );
        await client.query(
          `INSERT INTO public.ledger_entries (transfer_id, account_id, entry_type, amount_paise, balance_after_paise, account_entry_sequence, created_at)
           VALUES ($1, $2, 'credit', 2000, 203000, 202, '2026-03-15T12:00:00Z')`,
          [t2.rows[0].id, customerAccount2.id]
        );

        // Entry at 2026-03-30
        const t3 = await client.query(
          `INSERT INTO public.transfers (source_account_id, destination_account_id, amount_paise, status, transfer_type, created_by_user_id, created_at)
           VALUES ($1, $2, 3000, 'completed', 'customer_transfer', $3, '2026-03-30T12:00:00Z')
           RETURNING id`,
          [dateFilterAccount.id, customerAccount2.id, customerUser1.user.id]
        );
        await client.query(
          `INSERT INTO public.ledger_entries (transfer_id, account_id, entry_type, amount_paise, balance_after_paise, account_entry_sequence, created_at)
           VALUES ($1, $2, 'debit', 3000, 294000, 3, '2026-03-30T12:00:00Z')`,
          [t3.rows[0].id, dateFilterAccount.id]
        );
        await client.query(
          `INSERT INTO public.ledger_entries (transfer_id, account_id, entry_type, amount_paise, balance_after_paise, account_entry_sequence, created_at)
           VALUES ($1, $2, 'credit', 3000, 206000, 203, '2026-03-30T12:00:00Z')`,
          [t3.rows[0].id, customerAccount2.id]
        );

        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    });

    it('should reject request when from_date is after to_date with HTTP 400', async () => {
      const res = await request(app)
        .get(`/api/accounts/${dateFilterAccount.id}/statement?from_date=2026-03-31T00:00:00Z&to_date=2026-03-01T00:00:00Z`)
        .set('Authorization', `Bearer ${customerUser1.token}`);

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error', 'ValidationError');
      expect(res.body.details).toBeDefined();
      expect(res.body.details.from_date).toEqual(
        expect.arrayContaining([expect.stringMatching(/from_date cannot be after to_date/i)])
      );
    });

    it('should reject non-ISO 8601 date strings with HTTP 400', async () => {
      const res = await request(app)
        .get(`/api/accounts/${dateFilterAccount.id}/statement?from_date=2026-03-01`)
        .set('Authorization', `Bearer ${customerUser1.token}`);

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error', 'ValidationError');
    });

    it('should filter entries within from_date and to_date correctly before ordering and pagination', async () => {
      const res = await request(app)
        .get(`/api/accounts/${dateFilterAccount.id}/statement?from_date=2026-03-10T00:00:00.000Z&to_date=2026-03-20T00:00:00.000Z`)
        .set('Authorization', `Bearer ${customerUser1.token}`);

      expect(res.status).toBe(200);
      expect(res.body.statement.pagination.totalEntries).toBe(1);
      expect(res.body.statement.entries).toHaveLength(1);
      expect(res.body.statement.entries[0].amountPaise).toBe('2000');
    });
  });

  describe('6. Pagination & Determinism', () => {
    let pagedAccount;

    beforeAll(async () => {
      pagedAccount = await createTestAccount({
        accountNumber: `PG-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        balancePaise: 500000,
        userId: customerUser1.user.id,
      });

      const client = await ownerPool.connect();
      try {
        await client.query('BEGIN');
        for (let i = 1; i <= 5; i++) {
          const amt = BigInt(i) * 1000n;
          const t = await client.query(
            `INSERT INTO public.transfers (source_account_id, destination_account_id, amount_paise, status, transfer_type, created_by_user_id)
             VALUES ($1, $2, $3, 'completed', 'customer_transfer', $4)
             RETURNING id`,
            [pagedAccount.id, customerAccount2.id, amt, customerUser1.user.id]
          );
          await client.query(
            `INSERT INTO public.ledger_entries (transfer_id, account_id, entry_type, amount_paise, balance_after_paise, account_entry_sequence)
             VALUES ($1, $2, 'debit', $3, $4, $5)`,
            [t.rows[0].id, pagedAccount.id, amt, 500000n - amt, i]
          );
          await client.query(
            `INSERT INTO public.ledger_entries (transfer_id, account_id, entry_type, amount_paise, balance_after_paise, account_entry_sequence)
             VALUES ($1, $2, 'credit', $3, $4, $5)`,
            [t.rows[0].id, customerAccount2.id, amt, 200000n + amt, 300 + i]
          );
        }
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    });

    it('should paginate results with limit and offset deterministically', async () => {
      // Page 1: limit 2, offset 0
      const resPage1 = await request(app)
        .get(`/api/accounts/${pagedAccount.id}/statement?limit=2&offset=0`)
        .set('Authorization', `Bearer ${customerUser1.token}`);

      expect(resPage1.status).toBe(200);
      expect(resPage1.body.statement.pagination.totalEntries).toBe(5);
      expect(resPage1.body.statement.pagination.limit).toBe(2);
      expect(resPage1.body.statement.pagination.offset).toBe(0);
      expect(resPage1.body.statement.entries).toHaveLength(2);
      expect(resPage1.body.statement.entries[0].accountEntrySequence).toBe('1');
      expect(resPage1.body.statement.entries[1].accountEntrySequence).toBe('2');

      // Page 2: limit 2, offset 2
      const resPage2 = await request(app)
        .get(`/api/accounts/${pagedAccount.id}/statement?limit=2&offset=2`)
        .set('Authorization', `Bearer ${customerUser1.token}`);

      expect(resPage2.status).toBe(200);
      expect(resPage2.body.statement.pagination.offset).toBe(2);
      expect(resPage2.body.statement.entries).toHaveLength(2);
      expect(resPage2.body.statement.entries[0].accountEntrySequence).toBe('3');
      expect(resPage2.body.statement.entries[1].accountEntrySequence).toBe('4');

      // Pagination note included
      expect(resPage1.body.statement.pagination.note).toMatch(/Offset pagination applies over the dual-regime total ordering/i);
    });

    it('should reject invalid limit (<1 or >100) and invalid offset (<0)', async () => {
      const res1 = await request(app)
        .get(`/api/accounts/${pagedAccount.id}/statement?limit=0`)
        .set('Authorization', `Bearer ${customerUser1.token}`);
      expect(res1.status).toBe(400);

      const res2 = await request(app)
        .get(`/api/accounts/${pagedAccount.id}/statement?limit=101`)
        .set('Authorization', `Bearer ${customerUser1.token}`);
      expect(res2.status).toBe(400);

      const res3 = await request(app)
        .get(`/api/accounts/${pagedAccount.id}/statement?offset=-1`)
        .set('Authorization', `Bearer ${customerUser1.token}`);
      expect(res3.status).toBe(400);
    });
  });

  describe('7. Zero Mutation & Empty Statement Guarantees', () => {
    it('should return empty entries array and 0 totalEntries for an account with no transactions', async () => {
      const res = await request(app)
        .get(`/api/accounts/${emptyAccount.id}/statement`)
        .set('Authorization', `Bearer ${customerUser1.token}`);

      expect(res.status).toBe(200);
      expect(res.body.account.id).toBe(emptyAccount.id);
      expect(res.body.statement.entries).toEqual([]);
      expect(res.body.statement.pagination.totalEntries).toBe(0);
    });

    it('should guarantee zero database mutations across repeated statement invocations', async () => {
      // Snapshot DB counts
      const countsBefore = await ownerPool.query(`
        SELECT
          (SELECT COUNT(*) FROM public.accounts) AS account_count,
          (SELECT COUNT(*) FROM public.transfers) AS transfer_count,
          (SELECT COUNT(*) FROM public.ledger_entries) AS entry_count,
          (SELECT COUNT(*) FROM public.audit_refused_attempts) AS audit_count
      `);

      const accBefore = await ownerPool.query(
        `SELECT balance_paise, next_entry_sequence FROM public.accounts WHERE id = $1`,
        [customerAccount1.id]
      );

      // Call statement endpoint multiple times
      await request(app)
        .get(`/api/accounts/${customerAccount1.id}/statement?include_refused=true`)
        .set('Authorization', `Bearer ${customerUser1.token}`);

      await request(app)
        .get(`/api/accounts/${customerAccount1.id}/statement?limit=10&offset=5`)
        .set('Authorization', `Bearer ${customerUser1.token}`);

      // Snapshot DB counts again
      const countsAfter = await ownerPool.query(`
        SELECT
          (SELECT COUNT(*) FROM public.accounts) AS account_count,
          (SELECT COUNT(*) FROM public.transfers) AS transfer_count,
          (SELECT COUNT(*) FROM public.ledger_entries) AS entry_count,
          (SELECT COUNT(*) FROM public.audit_refused_attempts) AS audit_count
      `);

      const accAfter = await ownerPool.query(
        `SELECT balance_paise, next_entry_sequence FROM public.accounts WHERE id = $1`,
        [customerAccount1.id]
      );

      expect(countsAfter.rows[0].account_count).toBe(countsBefore.rows[0].account_count);
      expect(countsAfter.rows[0].transfer_count).toBe(countsBefore.rows[0].transfer_count);
      expect(countsAfter.rows[0].entry_count).toBe(countsBefore.rows[0].entry_count);
      expect(countsAfter.rows[0].audit_count).toBe(countsBefore.rows[0].audit_count);

      expect(accAfter.rows[0].balance_paise).toBe(accBefore.rows[0].balance_paise);
      expect(accAfter.rows[0].next_entry_sequence).toBe(accBefore.rows[0].next_entry_sequence);
    });
  });
});
