const request = require('supertest');
const app = require('../src/app');
const { pool } = require('../src/config/db');
const { ownerPool, createTestUser, createTestAccount } = require('./helpers/auth');

describe('Phase 5 Step 2: Role-Based Access Control (RBAC) & Account Ownership', () => {
  let adminUser;
  let accountHolder1;
  let accountHolder2;
  let auditorUser;
  let inactiveUser;

  let account1; // Owned by accountHolder1
  let account2; // Owned by accountHolder2
  let unassignedAccount; // user_id is null
  let systemEquityAccount;

  beforeAll(async () => {
    // Create distinct test users with roles once for the entire suite
    adminUser = await createTestUser({ role: 'admin' });
    accountHolder1 = await createTestUser({ role: 'account_holder' });
    accountHolder2 = await createTestUser({ role: 'account_holder' });
    auditorUser = await createTestUser({ role: 'auditor' });
    inactiveUser = await createTestUser({ role: 'account_holder', isActive: false });

    const sysAccRes = await ownerPool.query(
      `SELECT id, account_number, account_type FROM public.accounts WHERE account_type = 'system_equity' LIMIT 1`
    );
    systemEquityAccount = sysAccRes.rows[0];
  });

  beforeEach(async () => {
    // Ensure base users retain their active roles
    await ownerPool.query(
      "UPDATE public.users SET role = 'admin', is_active = true WHERE id = $1",
      [adminUser.user.id]
    );

    // Create fresh test accounts with defined balances and ownership
    account1 = await createTestAccount({
      accountNumber: `A1_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      balancePaise: 500000, // 5000.00 INR
      userId: accountHolder1.user.id,
    });

    account2 = await createTestAccount({
      accountNumber: `A2_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      balancePaise: 200000, // 2000.00 INR
      userId: accountHolder2.user.id,
    });

    unassignedAccount = await createTestAccount({
      accountNumber: `UN_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      balancePaise: 100000,
      userId: null,
    });
  });

  afterAll(async () => {
    await pool.end();
    await ownerPool.end();
  });

  // ─── 1. Account Query Authorization ──────────────────────────────────────────

  describe('Account Inspection & Listing Authorization', () => {
    it('allows an account holder to view their own assigned account', async () => {
      const res = await request(app)
        .get(`/api/accounts/${account1.id}`)
        .set('Authorization', `Bearer ${accountHolder1.token}`);

      expect(res.status).toBe(200);
      expect(res.body.account.id).toBe(account1.id);
      expect(res.body.account.user_id).toBe(accountHolder1.user.id);
    });

    it('denies an account holder access to another user account (403 Forbidden)', async () => {
      const res = await request(app)
        .get(`/api/accounts/${account2.id}`)
        .set('Authorization', `Bearer ${accountHolder1.token}`);

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('ForbiddenError');
      expect(res.body.message).toMatch(/access denied/i);
    });

    it('denies an account holder access to an unassigned account (403 Forbidden)', async () => {
      const res = await request(app)
        .get(`/api/accounts/${unassignedAccount.id}`)
        .set('Authorization', `Bearer ${accountHolder1.token}`);

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('ForbiddenError');
    });

    it('filters account list so account holders see only their assigned accounts', async () => {
      const res = await request(app)
        .get('/api/accounts')
        .set('Authorization', `Bearer ${accountHolder1.token}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.accounts)).toBe(true);
      const returnedIds = res.body.accounts.map((a) => a.id);
      expect(returnedIds).toContain(account1.id);
      expect(returnedIds).not.toContain(account2.id);
      expect(returnedIds).not.toContain(unassignedAccount.id);
    });

    it('allows admins and auditors to inspect any account', async () => {
      // Admin inspects account1
      const adminRes = await request(app)
        .get(`/api/accounts/${account1.id}`)
        .set('Authorization', `Bearer ${adminUser.token}`);
      expect(adminRes.status).toBe(200);
      expect(adminRes.body.account.id).toBe(account1.id);

      // Auditor inspects account1
      const auditorRes = await request(app)
        .get(`/api/accounts/${account1.id}`)
        .set('Authorization', `Bearer ${auditorUser.token}`);
      expect(auditorRes.status).toBe(200);
      expect(auditorRes.body.account.id).toBe(account1.id);
    });

    it('allows admins and auditors to list all accounts', async () => {
      const res = await request(app)
        .get('/api/accounts')
        .set('Authorization', `Bearer ${auditorUser.token}`);

      expect(res.status).toBe(200);
      const returnedIds = res.body.accounts.map((a) => a.id);
      expect(returnedIds).toContain(account1.id);
      expect(returnedIds).toContain(account2.id);
      expect(returnedIds).toContain(unassignedAccount.id);
    });
  });

  // ─── 2. Transfer Authorization ───────────────────────────────────────────────

  describe('Transfer Ownership & Authorization', () => {
    it('allows an account holder to transfer funds from an account they own', async () => {
      const key = `transfer_auth_ok_${Date.now()}`;
      const res = await request(app)
        .post('/api/transfers')
        .set('Authorization', `Bearer ${accountHolder1.token}`)
        .set('Idempotency-Key', key)
        .send({
          sourceAccountId: account1.id,
          destinationAccountId: account2.id,
          amountPaise: 50000,
        });

      expect(res.status).toBe(201);
      expect(res.body.transfer.sourceAccountId).toBe(account1.id);
      expect(res.body.transfer.destinationAccountId).toBe(account2.id);
    });

    it('rejects an account holder attempting to transfer from an account owned by another user (403 Forbidden)', async () => {
      const key = `transfer_auth_denied_${Date.now()}`;

      // Capture baseline ledger-entry count for involved accounts before the unauthorized attempt
      const beforeCountRes = await ownerPool.query(
        'SELECT COUNT(*) FROM public.ledger_entries WHERE account_id IN ($1, $2)',
        [account2.id, account1.id]
      );
      const beforeLedgerCount = parseInt(beforeCountRes.rows[0].count, 10);

      const res = await request(app)
        .post('/api/transfers')
        .set('Authorization', `Bearer ${accountHolder1.token}`)
        .set('Idempotency-Key', key)
        .send({
          sourceAccountId: account2.id, // Owned by accountHolder2
          destinationAccountId: account1.id,
          amountPaise: 10000,
        });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('ForbiddenError');
      expect(res.body.message).toMatch(/not authorized to transfer funds/i);

      // Verify zero balances modified and no ledger entries created for these accounts
      const balRes = await ownerPool.query('SELECT balance_paise FROM public.accounts WHERE id = $1', [account2.id]);
      expect(balRes.rows[0].balance_paise).toBe('200000');

      const afterCountRes = await ownerPool.query(
        'SELECT COUNT(*) FROM public.ledger_entries WHERE account_id IN ($1, $2)',
        [account2.id, account1.id]
      );
      expect(parseInt(afterCountRes.rows[0].count, 10)).toBe(beforeLedgerCount);
    });

    it('rejects an account holder attempting to transfer from an unassigned account (403 Forbidden)', async () => {
      const key = `transfer_unassigned_${Date.now()}`;
      const res = await request(app)
        .post('/api/transfers')
        .set('Authorization', `Bearer ${accountHolder1.token}`)
        .set('Idempotency-Key', key)
        .send({
          sourceAccountId: unassignedAccount.id,
          destinationAccountId: account1.id,
          amountPaise: 10000,
        });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('ForbiddenError');
    });

    it('denies auditors from initiating transfers (403 Forbidden)', async () => {
      const key = `transfer_auditor_${Date.now()}`;
      const res = await request(app)
        .post('/api/transfers')
        .set('Authorization', `Bearer ${auditorUser.token}`)
        .set('Idempotency-Key', key)
        .send({
          sourceAccountId: account1.id,
          destinationAccountId: account2.id,
          amountPaise: 5000,
        });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('Forbidden');
    });

    it('allows an administrator to execute transfers on behalf of accounts', async () => {
      const key = `transfer_admin_${Date.now()}`;
      const res = await request(app)
        .post('/api/transfers')
        .set('Authorization', `Bearer ${adminUser.token}`)
        .set('Idempotency-Key', key)
        .send({
          sourceAccountId: account1.id,
          destinationAccountId: account2.id,
          amountPaise: 10000,
        });

      expect(res.status).toBe(201);
    });
  });

  // ─── 3. Reversal Authorization ───────────────────────────────────────────────

  describe('Reversal Ownership & Authorization', () => {
    let initialTransfer;

    beforeEach(async () => {
      // Execute an initial transfer: account1 -> account2 (amount: 50000 paise)
      const res = await request(app)
        .post('/api/transfers')
        .set('Authorization', `Bearer ${accountHolder1.token}`)
        .set('Idempotency-Key', `orig_tx_${Date.now()}`)
        .send({
          sourceAccountId: account1.id,
          destinationAccountId: account2.id,
          amountPaise: 50000,
        });
      expect(res.status).toBe(201);
      initialTransfer = res.body.transfer;
    });

    it('allows the debited party (accountHolder2) to execute a reversal', async () => {
      // In reversal, account2 is debited to refund account1. AccountHolder2 owns account2.
      const res = await request(app)
        .post(`/api/transfers/${initialTransfer.id}/reversal`)
        .set('Authorization', `Bearer ${accountHolder2.token}`)
        .set('Idempotency-Key', `rev_auth_ok_${Date.now()}`)
        .send({ reversalReason: 'Refund authorized by merchant' });

      expect(res.status).toBe(201);
      expect(res.body.message).toBe('Transfer reversed successfully');
    });

    it('denies accountHolder1 (the original sender) from unilaterally reversing and debiting accountHolder2 (403 Forbidden)', async () => {
      // AccountHolder1 does NOT own account2 (the account to be debited)
      const res = await request(app)
        .post(`/api/transfers/${initialTransfer.id}/reversal`)
        .set('Authorization', `Bearer ${accountHolder1.token}`)
        .set('Idempotency-Key', `rev_auth_denied_${Date.now()}`)
        .send({ reversalReason: 'Unauthorized clawback attempt' });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('ForbiddenError');
      expect(res.body.message).toMatch(/you do not own the debited account/i);
    });

    it('denies auditors from initiating reversals (403 Forbidden)', async () => {
      const res = await request(app)
        .post(`/api/transfers/${initialTransfer.id}/reversal`)
        .set('Authorization', `Bearer ${auditorUser.token}`)
        .set('Idempotency-Key', `rev_auditor_${Date.now()}`)
        .send({ reversalReason: 'Auditor attempt' });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('Forbidden');
    });
  });

  // ─── 4. Administrative Role & Status Invariants ─────────────────────────────

  describe('Administrative Role & Status Management', () => {
    it('allows an admin to update a user role', async () => {
      const targetUser = await createTestUser({ role: 'account_holder' });

      const res = await request(app)
        .patch(`/api/admin/users/${targetUser.user.id}/role`)
        .set('Authorization', `Bearer ${adminUser.token}`)
        .send({ role: 'auditor' });

      expect(res.status).toBe(200);
      expect(res.body.user.role).toBe('auditor');
    });

    it('denies non-admins from changing user roles (403 Forbidden)', async () => {
      const targetUser = await createTestUser({ role: 'account_holder' });

      const res = await request(app)
        .patch(`/api/admin/users/${targetUser.user.id}/role`)
        .set('Authorization', `Bearer ${accountHolder1.token}`)
        .send({ role: 'admin' });

      expect(res.status).toBe(403);
    });

    it('enforces last-admin protection: rejects demoting the last active administrator (422)', async () => {
      // Ensure adminUser is the ONLY active admin
      await ownerPool.query(
        "UPDATE public.users SET role = 'account_holder' WHERE role = 'admin' AND id != $1",
        [adminUser.user.id]
      );

      const res = await request(app)
        .patch(`/api/admin/users/${adminUser.user.id}/role`)
        .set('Authorization', `Bearer ${adminUser.token}`)
        .send({ role: 'account_holder' });

      expect(res.status).toBe(422);
      expect(res.body.error).toBe('InvariantViolationError');
      expect(res.body.message).toMatch(/Cannot demote the last active administrator/i);
    });

    it('enforces last-admin protection: rejects deactivating the last active administrator (422)', async () => {
      await ownerPool.query(
        "UPDATE public.users SET role = 'account_holder' WHERE role = 'admin' AND id != $1",
        [adminUser.user.id]
      );

      const res = await request(app)
        .patch(`/api/admin/users/${adminUser.user.id}/status`)
        .set('Authorization', `Bearer ${adminUser.token}`)
        .send({ isActive: false });

      expect(res.status).toBe(422);
      expect(res.body.error).toBe('InvariantViolationError');
      expect(res.body.message).toMatch(/Cannot deactivate the last active administrator/i);
    });

    it('protects against concurrent demotion races (exactly one succeeds when two admins attempt mutual demotion)', async () => {
      // Create a second active admin
      const secondAdmin = await createTestUser({ role: 'admin' });

      // Demote all other admins so exactly adminUser and secondAdmin exist
      await ownerPool.query(
        "UPDATE public.users SET role = 'account_holder' WHERE role = 'admin' AND id NOT IN ($1, $2)",
        [adminUser.user.id, secondAdmin.user.id]
      );

      // Run concurrent demotions in parallel
      const [res1, res2] = await Promise.all([
        request(app)
          .patch(`/api/admin/users/${adminUser.user.id}/role`)
          .set('Authorization', `Bearer ${adminUser.token}`)
          .send({ role: 'account_holder' }),
        request(app)
          .patch(`/api/admin/users/${secondAdmin.user.id}/role`)
          .set('Authorization', `Bearer ${secondAdmin.token}`)
          .send({ role: 'account_holder' }),
      ]);

      const statuses = [res1.status, res2.status].sort();
      // Exactly one must succeed (200) and the other must fail with 422 (last admin protection)
      expect(statuses).toEqual([200, 422]);

      // Confirm in DB that exactly 1 active admin remains
      const adminCountRes = await ownerPool.query(
        "SELECT COUNT(*) FROM public.users WHERE role = 'admin' AND is_active = true"
      );
      expect(parseInt(adminCountRes.rows[0].count, 10)).toBe(1);
    });
  });

  // ─── 5. Administrative Account Creation & Ownership Assignment ──────────────

  describe('Administrative Account Assignment & Immutability', () => {
    it('allows an admin to create a new customer account', async () => {
      const newNum = `NEWACC_${Date.now()}`;
      const res = await request(app)
        .post('/api/accounts')
        .set('Authorization', `Bearer ${adminUser.token}`)
        .send({ accountNumber: newNum });

      expect(res.status).toBe(201);
      expect(res.body.account.account_number).toBe(newNum);
      expect(res.body.account.balance_paise).toBe('0');
      expect(res.body.account.user_id).toBeNull();
    });

    it('denies non-admins from creating accounts (403 Forbidden)', async () => {
      const res = await request(app)
        .post('/api/accounts')
        .set('Authorization', `Bearer ${accountHolder1.token}`)
        .send({ accountNumber: `HACK_${Date.now()}` });

      expect(res.status).toBe(403);
    });

    it('allows an admin to assign an unassigned account to an active user', async () => {
      const res = await request(app)
        .post(`/api/admin/accounts/${unassignedAccount.id}/owner`)
        .set('Authorization', `Bearer ${adminUser.token}`)
        .send({ userId: accountHolder1.user.id });

      expect(res.status).toBe(200);
      expect(res.body.account.user_id).toBe(accountHolder1.user.id);
    });

    it('enforces account ownership immutability: rejects reassigning an already assigned account (422)', async () => {
      // account1 is already assigned to accountHolder1
      const res = await request(app)
        .post(`/api/admin/accounts/${account1.id}/owner`)
        .set('Authorization', `Bearer ${adminUser.token}`)
        .send({ userId: accountHolder2.user.id });

      expect(res.status).toBe(422);
      expect(res.body.error).toBe('InvariantViolationError');
      expect(res.body.message).toMatch(/Account ownership is immutable once assigned/i);
    });

    it('rejects assigning user ownership to the system equity account (422)', async () => {
      if (!systemEquityAccount) return;

      const res = await request(app)
        .post(`/api/admin/accounts/${systemEquityAccount.id}/owner`)
        .set('Authorization', `Bearer ${adminUser.token}`)
        .send({ userId: accountHolder1.user.id });

      expect(res.status).toBe(422);
      expect(res.body.error).toBe('InvariantViolationError');
      expect(res.body.message).toMatch(/Cannot assign user ownership to system[_ ]equity account/i);
    });

    it('rejects assigning an account to an inactive user (422)', async () => {
      const newAcc = await createTestAccount({ userId: null });

      const res = await request(app)
        .post(`/api/admin/accounts/${newAcc.id}/owner`)
        .set('Authorization', `Bearer ${adminUser.token}`)
        .send({ userId: inactiveUser.user.id });

      expect(res.status).toBe(422);
      expect(res.body.error).toBe('InvariantViolationError');
      expect(res.body.message).toMatch(/Cannot assign account to inactive user/i);
    });

    it('returns 404 for nonexistent account or user in admin assignment', async () => {
      const nonExistentId = '00000000-0000-0000-0000-000000000000';

      // Nonexistent account
      const res1 = await request(app)
        .post(`/api/admin/accounts/${nonExistentId}/owner`)
        .set('Authorization', `Bearer ${adminUser.token}`)
        .send({ userId: accountHolder1.user.id });
      expect(res1.status).toBe(404);

      // Nonexistent user
      const res2 = await request(app)
        .post(`/api/admin/accounts/${unassignedAccount.id}/owner`)
        .set('Authorization', `Bearer ${adminUser.token}`)
        .send({ userId: nonExistentId });
      expect(res2.status).toBe(404);
    });
  });
});
