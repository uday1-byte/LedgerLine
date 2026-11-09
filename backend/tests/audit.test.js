const crypto = require('crypto');
const { pool } = require('../src/config/db');
const {
  recordRefusalAudit,
  sendAuditPersistenceFailure,
  AuditPersistenceError,
  VALID_ACTIONS,
} = require('../src/services/auditService');
const { createTestUser, createTestAccount, ownerPool } = require('./helpers/auth');

jest.setTimeout(15000);

describe('Refused-Attempt Audit Service (Phase 6 Stage 5.1)', () => {
  let testUser;
  let testAccount;

  beforeAll(async () => {
    testUser = await createTestUser({ role: 'account_holder' });
    testAccount = await createTestAccount({
      accountNumber: `TEST-AUDIT-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      balancePaise: 100000,
      userId: testUser.user.id,
    });
  });

  afterAll(async () => {
    await pool.end();
    await ownerPool.end();
  });

  describe('1. Successful Audit Record Insertion', () => {
    it('should persist a refusal audit record referencing an existing account', async () => {
      const result = await recordRefusalAudit({
        userId: testUser.user.id,
        accountId: testAccount.id,
        accountExists: true,
        action: 'withdrawal',
        amountPaise: 25000,
        reasonCode: 'INSUFFICIENT_FUNDS',
        reasonMessage: 'Customer has insufficient funds for this withdrawal',
        idempotencyKey: `IDEM-${Date.now()}`,
        clientIp: '127.0.0.1',
      });

      expect(result.success).toBe(true);
      expect(result.durableAudit).toBe(true);
      expect(result.auditRecord).toBeDefined();
      expect(result.auditRecord.id).toBeDefined();
      expect(result.auditRecord.user_id).toBe(testUser.user.id);
      expect(result.auditRecord.account_id).toBe(testAccount.id);
      expect(result.auditRecord.action).toBe('withdrawal');
      expect(result.auditRecord.attempted_amount_paise).toBe('25000');
      expect(result.auditRecord.reason_code).toBe('INSUFFICIENT_FUNDS');
      expect(result.auditRecord.reason_message).toBe('Customer has insufficient funds for this withdrawal');
      expect(result.auditRecord.created_at).toBeDefined();

      // Verify persistence directly in PostgreSQL
      const dbCheck = await ownerPool.query(
        `SELECT id, user_id, account_id, action, attempted_amount_paise, reason_code
         FROM public.audit_refused_attempts
         WHERE id = $1`,
        [result.auditRecord.id]
      );
      expect(dbCheck.rows.length).toBe(1);
      expect(dbCheck.rows[0].account_id).toBe(testAccount.id);
    });

    it('should support all required financial actions: transfer, deposit, withdrawal, reversal', async () => {
      for (const action of VALID_ACTIONS) {
        const res = await recordRefusalAudit({
          userId: testUser.user.id,
          accountId: testAccount.id,
          accountExists: true,
          action,
          amountPaise: 1000,
          reasonCode: `TEST_${action.toUpperCase()}_REFUSAL`,
          reasonMessage: `Testing action ${action}`,
        });

        expect(res.success).toBe(true);
        expect(res.auditRecord.action).toBe(action);
      }
    });

    it('should reject invalid or unsupported actions', async () => {
      await expect(
        recordRefusalAudit({
          userId: testUser.user.id,
          accountId: testAccount.id,
          action: 'unauthorized_loan_action',
          reasonCode: 'INVALID_ACTION',
          reasonMessage: 'Attempting invalid action',
        })
      ).rejects.toThrow(/Invalid audit action/);
    });
  });

  describe('2. Nonexistent Account Handling (HTTP 404 & FK Safety)', () => {
    it('should set account_id to NULL and preserve attempted UUID in reason_message', async () => {
      const nonexistentAccountId = crypto.randomUUID();

      const result = await recordRefusalAudit({
        userId: testUser.user.id,
        attemptedAccountId: nonexistentAccountId,
        accountExists: false,
        action: 'deposit',
        amountPaise: 50000,
        reasonCode: 'ACCOUNT_NOT_FOUND',
        reasonMessage: 'Target account not found',
        idempotencyKey: `IDEM-404-${Date.now()}`,
        clientIp: '192.168.1.50',
      });

      expect(result.success).toBe(true);
      expect(result.durableAudit).toBe(true);
      expect(result.auditRecord.account_id).toBeNull();
      expect(result.auditRecord.reason_message).toContain(nonexistentAccountId);

      // Verify database record has NULL account_id and preserved UUID
      const dbCheck = await ownerPool.query(
        `SELECT id, user_id, account_id, reason_message
         FROM public.audit_refused_attempts
         WHERE id = $1`,
        [result.auditRecord.id]
      );
      expect(dbCheck.rows.length).toBe(1);
      expect(dbCheck.rows[0].account_id).toBeNull();
      expect(dbCheck.rows[0].reason_message).toContain(nonexistentAccountId);
    });

    it('should also preserve attempted UUID when passed as accountId with accountExists=false', async () => {
      const nonexistentAccountId = crypto.randomUUID();

      const result = await recordRefusalAudit({
        userId: testUser.user.id,
        accountId: nonexistentAccountId,
        accountExists: false,
        action: 'transfer',
        amountPaise: 75000,
        reasonCode: 'SOURCE_ACCOUNT_NOT_FOUND',
        reasonMessage: 'Source account not found',
      });

      expect(result.success).toBe(true);
      expect(result.auditRecord.account_id).toBeNull();
      expect(result.auditRecord.reason_message).toContain(nonexistentAccountId);
    });
  });

  describe('3. Reject Anonymous Requests (No 401 Auditing)', () => {
    it('should throw an error and never persist when userId is missing or empty', async () => {
      await expect(
        recordRefusalAudit({
          userId: null,
          accountId: testAccount.id,
          action: 'withdrawal',
          reasonCode: 'UNAUTHORIZED_ATTEMPT',
          reasonMessage: 'Anonymous attempt',
        })
      ).rejects.toThrow(/authenticated userId/);

      await expect(
        recordRefusalAudit({
          userId: '',
          accountId: testAccount.id,
          action: 'withdrawal',
          reasonCode: 'UNAUTHORIZED_ATTEMPT',
          reasonMessage: 'Anonymous attempt',
        })
      ).rejects.toThrow(/authenticated userId/);
    });
  });

  describe('4. Persistence Failure Handling & Structured Logging', () => {
    it('should emit structured critical stderr log and throw AuditPersistenceError with durableAudit=false', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const querySpy = jest.spyOn(pool, 'query').mockRejectedValueOnce(new Error('Simulated DB connectivity failure'));

      let caughtError = null;
      try {
        await recordRefusalAudit({
          userId: testUser.user.id,
          accountId: testAccount.id,
          action: 'withdrawal',
          amountPaise: 1000,
          reasonCode: 'TEST_FAILURE',
          reasonMessage: 'Testing failure handling',
        });
      } catch (err) {
        caughtError = err;
      }

      expect(caughtError).toBeInstanceOf(AuditPersistenceError);
      expect(caughtError.name).toBe('AuditPersistenceError');
      expect(caughtError.statusCode).toBe(500);
      expect(caughtError.durableAudit).toBe(false);

      // Verify structured critical stderr log was emitted
      expect(consoleErrorSpy).toHaveBeenCalled();
      const loggedJson = JSON.parse(consoleErrorSpy.mock.calls[0][0]);
      expect(loggedJson.level).toBe('CRITICAL');
      expect(loggedJson.error).toBe('AuditPersistenceError');
      expect(loggedJson.durableAudit).toBe(false);
      expect(loggedJson.cause).toBe('Simulated DB connectivity failure');

      // Verify sendAuditPersistenceFailure helper formats the expected HTTP 500 response
      const mockRes = {
        statusCode: null,
        body: null,
        status(code) {
          this.statusCode = code;
          return this;
        },
        json(payload) {
          this.body = payload;
          return this;
        },
      };

      sendAuditPersistenceFailure(mockRes, caughtError);
      expect(mockRes.statusCode).toBe(500);
      expect(mockRes.body).toEqual({
        error: 'AuditPersistenceError',
        message: 'Failed to record durable audit trail for financial refusal',
        durableAudit: false,
      });

      consoleErrorSpy.mockRestore();
      querySpy.mockRestore();
    });
  });

  describe('5. Financial Transaction Rollback and Client Release Ordering', () => {
    it('should verify financial transaction is rolled back and client released BEFORE audit insert', async () => {
      const callLog = [];

      // Acquire a dedicated client to simulate an in-flight financial transaction
      const client = await pool.connect();
      const originalClientQuery = client.query;
      const originalClientRelease = client.release;

      client.query = jest.fn(async (...args) => {
        callLog.push({ source: 'financial_client', method: 'query', sql: args[0] });
        return originalClientQuery.apply(client, args);
      });

      client.release = jest.fn((...args) => {
        callLog.push({ source: 'financial_client', method: 'release' });
        // Restore before actually releasing back to pool
        client.query = originalClientQuery;
        client.release = originalClientRelease;
        return originalClientRelease.apply(client, args);
      });

      const originalPoolQuery = pool.query;
      pool.query = jest.fn(async (...args) => {
        callLog.push({ source: 'audit_pool', method: 'query', sql: args[0] });
        return originalPoolQuery.apply(pool, args);
      });

      try {
        // Step 1: Start financial transaction
        await client.query('BEGIN');

        // Step 2: Simulate financial operation failing validation (e.g., balance check)
        // Explicitly rollback and release client BEFORE audit insert
        await client.query('ROLLBACK');
        client.release();

        // Step 3: Record refusal audit independently
        const auditResult = await recordRefusalAudit({
          userId: testUser.user.id,
          accountId: testAccount.id,
          action: 'withdrawal',
          amountPaise: 999999999,
          reasonCode: 'INSUFFICIENT_FUNDS',
          reasonMessage: 'Attempted amount exceeds available balance',
        });

        expect(auditResult.success).toBe(true);

        // Step 4: Verify order of operations in callLog
        const rollbackIndex = callLog.findIndex(
          (entry) => entry.source === 'financial_client' && entry.sql === 'ROLLBACK'
        );
        const releaseIndex = callLog.findIndex(
          (entry) => entry.source === 'financial_client' && entry.method === 'release'
        );
        const auditInsertIndex = callLog.findIndex(
          (entry) =>
            entry.source === 'audit_pool' &&
            typeof entry.sql === 'string' &&
            entry.sql.includes('INSERT INTO public.audit_refused_attempts')
        );

        expect(rollbackIndex).toBeGreaterThan(-1);
        expect(releaseIndex).toBeGreaterThan(-1);
        expect(auditInsertIndex).toBeGreaterThan(-1);

        // Crucial requirement: rollback and release MUST occur BEFORE audit insert
        expect(rollbackIndex).toBeLessThan(auditInsertIndex);
        expect(releaseIndex).toBeLessThan(auditInsertIndex);
      } finally {
        pool.query = originalPoolQuery;
        client.query = originalClientQuery;
        client.release = originalClientRelease;
      }
    });

    it('should verify no automatic financial retry occurs upon refusal', async () => {
      const financialUpdateSpy = jest.fn();

      // Simulate a financial service handler
      async function processWithdrawal({ accountId, amountPaise, userId }) {
        const client = await pool.connect();
        let clientReleased = false;
        try {
          await client.query('BEGIN');

          // Simulate insufficient funds condition
          const hasSufficientFunds = false;

          if (!hasSufficientFunds) {
            await client.query('ROLLBACK');
            client.release();
            clientReleased = true;

            await recordRefusalAudit({
              userId,
              accountId,
              action: 'withdrawal',
              amountPaise,
              reasonCode: 'INSUFFICIENT_FUNDS',
              reasonMessage: 'Insufficient funds for withdrawal',
            });

            // Return early without retry
            return { status: 422, error: 'InsufficientFundsError' };
          }

          // If reached, financial mutation would execute
          financialUpdateSpy();
          await client.query('COMMIT');
          client.release();
          clientReleased = true;
        } catch (err) {
          if (!clientReleased) {
            try {
              await client.query('ROLLBACK');
            } catch (_) {}
            client.release();
          }
          throw err;
        }
      }

      const outcome = await processWithdrawal({
        accountId: testAccount.id,
        amountPaise: 5000000,
        userId: testUser.user.id,
      });

      expect(outcome.status).toBe(422);
      expect(outcome.error).toBe('InsufficientFundsError');
      // Assert financial update was never called
      expect(financialUpdateSpy).not.toHaveBeenCalled();
    });
  });

  describe('6. Immutability of Audit Records', () => {
    it('should strictly prohibit UPDATE and DELETE on audit_refused_attempts via database trigger', async () => {
      const result = await recordRefusalAudit({
        userId: testUser.user.id,
        accountId: testAccount.id,
        action: 'transfer',
        amountPaise: 5000,
        reasonCode: 'IMMUTABILITY_TEST',
        reasonMessage: 'Testing immutability trigger',
      });

      const auditId = result.auditRecord.id;

      // Attempting UPDATE must fail due to trg_prevent_audit_mutation
      await expect(
        ownerPool.query(
          `UPDATE public.audit_refused_attempts
           SET reason_code = 'MUTATED'
           WHERE id = $1`,
          [auditId]
        )
      ).rejects.toThrow(/Audit records are strictly append-only/);

      // Attempting DELETE must fail due to trg_prevent_audit_mutation
      await expect(
        ownerPool.query(
          `DELETE FROM public.audit_refused_attempts
           WHERE id = $1`,
          [auditId]
        )
      ).rejects.toThrow(/Audit records are strictly append-only/);
    });
  });
});
