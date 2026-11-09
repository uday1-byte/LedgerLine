# LedgerLine - Prompt & Engineering Log

This document records the user prompts, agent decisions, design rationales, and execution history across the development lifecycle of LedgerLine.

---

## Phase 1: Initial Foundation & Workspace Setup (2026-11-07)

### User Request
> "I am a beginner building a project called LedgerLine for a financial application hiring challenge.
> Technology stack:
> - Frontend: React with Vite
> - Backend: Node.js with Express
> - Database: PostgreSQL (PostgreSQL 18.6 installed, database `ledgerline_dev` on port 5432)
> - Database access: node-postgres (pg)
> - Authentication: JWT and bcrypt
> - Validation: Zod
> - Testing: Jest and Supertest
>
> Perform ONLY the initial project setup:
> 1. Inspect the workspace and confirm location.
> 2. Propose a clean folder structure for frontend, backend, database, tests.
> 3. Set up basic React/Vite frontend and Express backend.
> 4. Add a simple backend health-check endpoint.
> 5. Prepare PostgreSQL connection configuration using environment variables.
> 6. Create `.env.example` file with placeholder values.
> 7. Add `.gitignore`.
> 8. Create initial README.md, PROMPTS.md, and THREATS.md files.
> 9. Explain every important file and the commands needed to run the project.
> 10. Use compatible stable package versions and keep package-lock files.
>
> Rules: Do not implement financial transactions yet. Do not create tables or modify database yet. Do not deploy anything. Do not expose passwords or secrets. Explain in beginner-friendly language. Ask for approval before moving to next phase."

### Decisions & Implementation Details

1. **Workspace Inspection:**
   - Workspace verified at `d:\LedgerLine`.
   - Node.js v22.19.0 and npm 10.9.3 detected.
   - Identified Windows PowerShell execution policy for npm scripts; standardized on `npm.cmd` invocations.

2. **Clean Monorepo / Multi-Folder Architecture:**
   - Organized into distinct directories:
     - `backend/`: API server, configuration, routes, tests.
     - `frontend/`: React + Vite single page application with API proxy.
     - `database/`: Dedicated area for SQL migration scripts and schema documentation.
   - Added root `package.json` with helper scripts to run both ends conveniently from the root directory.

3. **Separation of Concerns for Testing (`app.js` vs `server.js`):**
   - Separated Express application setup (`app.js`) from network socket binding (`server.js`).
   - Benefit: Jest and Supertest can import `app.js` and execute fast HTTP assertions in-memory without conflicting with live server ports.

4. **Robust Configuration with Zod:**
   - Implemented `backend/src/config/env.js` which validates environment variables using Zod schemas and provides clear defaults for local development.

5. **Safe Database Pool Configuration:**
   - Implemented `backend/src/config/db.js` using `pg.Pool`.
   - All connection credentials read from environment variables; no credentials hardcoded.
   - Guarded query helpers and a lightweight `testConnection()` function that does not alter any database state.

6. **Health Check Endpoint (`GET /api/health`):**
   - Returns JSON status containing uptime, service name, environment, and server timestamp.
   - Optionally tests database connectivity when requested (`?db=true`), safely handling offline database scenarios.

7. **Security & Threat Model:**
   - Authored `THREATS.md` addressing financial-specific threats (double-spending, floating-point rounding errors, transaction immutability, STRIDE model).

---

## Experiment 1: Baseline Money Transfers & Initial Migration (2026-11-07)

### User Request
> "The initial database migration has succeeded, and I have verified the three expected tables.
> I approve proceeding with Experiment 1: Basic Money Transfers.
> Implement the baseline transfer feature using the existing database schema.
> Requirements:
> 1. Create POST /api/transfers.
> 2. Accept sourceAccountId, destinationAccountId and amountPaise.
> 3. Check that both accounts exist.
> 4. Check that the sender has sufficient balance.
> 5. Deduct the amount from the sender.
> 6. Credit the receiver.
> 7. Record the transfer.
> 8. Return a transfer confirmation.
> 9. Add automated tests for successful transfers and insufficient balance.
> Prioritize basic functionality. Do not claim production-grade financial security.
> Update README.md, THREATS.md, and PROMPTS.md."

### Decisions & Implementation Details

1. **Database Migration Execution:**
   - Created `database/migrations/001_create_accounts_and_transfers.sql` containing minimal baseline tables: `accounts` and `transfers`.
   - Implemented migration runner `backend/src/scripts/migrate.js` with transaction isolation (`BEGIN ... COMMIT / ROLLBACK`) and a `schema_migrations` tracking table.
   - Presented migration code, table definitions, constraints, indexes, and zero-destructive-statement verification for user review.
   - Upon user approval, executed migration successfully. Confirmed presence of `schema_migrations`, `accounts`, and `transfers`.

2. **Basic Transfer Endpoint (`POST /api/transfers`):**
   - Created `backend/src/routes/transfers.js` using Zod validation:
     - `sourceAccountId`: valid UUID string
     - `destinationAccountId`: valid UUID string
     - `amountPaise`: positive integer
     - Refinement: `sourceAccountId !== destinationAccountId`
   - Business Logic:
     - Connects client and begins transaction (`BEGIN`).
     - Queries source account existence; returns 404 if missing.
     - Queries destination account existence; returns 404 if missing.
     - Compares available balance against transfer amount using native JavaScript `BigInt`; returns 422 with `InsufficientFundsError` if insufficient.
     - Updates sender balance: `UPDATE accounts SET balance_paise = balance_paise - $1 WHERE id = $2`.
     - Updates receiver balance: `UPDATE accounts SET balance_paise = balance_paise + $1 WHERE id = $2`.
     - Records transfer: `INSERT INTO transfers (source_account_id, destination_account_id, amount_paise, status) VALUES (...)`.
     - Commits transaction (`COMMIT`) and returns HTTP 201 with transfer details and updated balances.
     - On error, catches exception, executes `ROLLBACK`, and delegates to centralized error handling.
   - Mounted route in `backend/src/app.js` under `/api/transfers`.

3. **Automated Integration Tests:**
   - Authored `backend/tests/transfers.test.js` covering:
     - Successful transfer (201) with database balance and transfer record verification.
     - Insufficient balance rejection (422) with verification that balances remained unchanged and no transfer record was created.
     - Non-existent source account (404).
     - Non-existent destination account (404).
     - Same source and destination validation error (400).
     - Non-positive or zero amount validation error (400).
   - Test Results: All 9 tests passed across 2 test suites (`transfers.test.js` and `health.test.js`).

4. **Identified Limitations of Experiment 1 Baseline:**
   - **No Pessimistic Row Locking (`FOR UPDATE`):** Susceptible to race conditions if concurrent transfers execute against the same sender account.
   - **No Idempotency Keys:** Network retries from clients will result in duplicate transfer executions.
   - **No Append-Only Double-Entry Ledger:** Balances are directly mutated on the accounts table rather than derived from balanced debit/credit entries.
   - **No Refused Attempt Logging:** Rejected transfers roll back without persisting an audit record of the attempt.
   - **No Authorization / Ownership Verification:** Any client can transfer from any account if the UUID is known.

---

## Experiment 2: Exploratory Concurrent Withdrawal Investigation (2026-11-07)

### User Request
> "Continue Experiment 2: Concurrent Withdrawal Investigation.
> The concurrency test has been reviewed. I approve one exploratory execution of the existing test.
> Instructions:
> 1. Run: npx jest backend/tests/concurrency.test.js --runInBand
> 2. Do not modify the existing transfer implementation.
> 3. Do not apply migration 002 or create additional migrations.
> 4. Do not modify the database schema.
> 5. Capture the exact HTTP status codes of both requests.
> 6. Capture the actual final PostgreSQL balances of the source and both destination accounts.
> 7. Report the number of completed transfers.
> 8. Check whether the source account became negative.
> 9. Report whether the test passed or failed and explain what that result actually proves.
> Important:
> - Do not claim that a race condition was reproduced unless the database evidence demonstrates it.
> - Do not claim that concurrency is safe just because this exploratory test passes.
> - Identify any weaknesses in the test assertions.
> - Do not implement any fixes yet.
> Documentation: Append actual experiment date, prompt, output and findings to PROMPTS.md. Update THREATS.md only with findings supported by evidence."

### Execution & Actual Test Output
Command executed: `npx.cmd jest backend/tests/concurrency.test.js --runInBand`

```text
=== CONCURRENCY TEST EXECUTION RESULTS ===
Request 1 HTTP Status : 201
Request 2 HTTP Status : 422
Initial Source Balance: 100000 paise (₹1,000.00)
Final Source Balance  : 20000 paise
Final Dest 1 Balance  : 80000 paise
Final Dest 2 Balance  : 0 paise
Completed Transfers   : 1
Is Source Overdrawn   : NO
==========================================

PASS backend/tests/concurrency.test.js
  Experiment 2: Concurrent Transfers Security Test
    √ investigates whether concurrent transfers can overdraw an account (678 ms)

Test Suites: 1 passed, 1 total
Tests:       1 passed, 1 total
Snapshots:   0 total
Time:        3.44 s
```

### Analysis & Findings
1. **Observed Outcome in this Run:**
   - Request 1 succeeded (HTTP 201), transferring 80,000 paise.
   - Request 2 was rejected with insufficient funds (HTTP 422).
   - Final balances: Source = 20,000 paise, Dest 1 = 80,000 paise, Dest 2 = 0 paise.
   - Exactly 1 transfer completed; source account did not become negative.
   - Test passed.

2. **What this Result Actually Proves:**
   - In this single specific execution, Request 1 committed its update before Request 2 read the sender's balance.
   - Because Request 2 read the balance *after* Request 1 committed, it saw 20,000 paise, correctly found 20,000 < 80,000, and rejected the transfer.

3. **What this Result Does NOT Prove (Crucial Finding):**
   - This exploratory run **does NOT prove that the endpoint is safe from race conditions or double-spending**.
   - The application code still uses `SELECT ... FROM accounts WHERE id = $1` without pessimistic row locking (`FOR UPDATE`).
   - If two concurrent requests arrive such that both execute their `SELECT` before either commits an `UPDATE` (e.g. under multiple client connections or network latency), both will read 100,000 paise and both will execute deductions.

4. **Weaknesses in Test Assertions:**
   - `expect([201, 422]).toContain(res1.statusCode)`: Accepts `[201, 201]` as passing, meaning it would pass even if a double-spend occurred!
   - Single-iteration test: A single pair of requests on local loopback may serialize due to Node microtask scheduling.
   - Lacks an explicit negative balance assertion (`expect(finalSourceBalance).toBeGreaterThanOrEqual(0n)`).


---

## Experiment 2B: Deterministic Concurrency Barrier Test (2026-11-07)

### User Request (summarised)
> Design and execute a deterministic test that reproduces the TOCTOU race condition in `POST /api/transfers`. Use a two-party barrier to guarantee both requests read the source balance before either executes its UPDATE. Apply three cleanup improvements: (1) guarantee barrier timeout is cleared on all exit paths, (2) guarantee `pool.connect` is restored even if the test fails, (3) verify exactly two distinct PostgreSQL clients participated. Execute: `npx.cmd jest tests/deterministic-concurrency.test.js --runInBand`. Do not modify the production transfer implementation.

### Key Engineering Decisions

1. **Supertest replaced with real TCP server:** Early iterations used `supertest(app)` to send concurrent requests. Under load, `supertest` serialized requests on the same loopback connection; the barrier held Request 1 open and Request 2 never reached `pool.connect`, causing the test to hang for 20 seconds and time out. Replaced with a pre-started `http.createServer(app)` listening on `0.0.0.0:0` (random port). Both `httpPost()` calls go to that port as fully independent TCP connections.

2. **Client query wrapper lifetime:** The `pool.connect` instrumentation patched each client's `query()` method. When a client is released back to the pool via `client.release()`, its wrapped `query()` method persists on the client object. Subsequent `pool.query()` calls that hit the same recycled client then intercepted the post-experiment balance SELECTs, re-triggering the barrier and hanging the test. Fixed by: (a) setting a `barrierReleased` flag, (b) in `releaseBarrier()` and the `finally` block, restoring `client.query = originalQuery` on every client in `wrappedClients[]`.

3. **Three cleanup guarantees implemented:**
   - **Barrier timeout:** `clearTimeout(barrierTimeoutHandle)` is called inside `releaseBarrier()` (normal path) and inside the `try/finally` block (error path). `barrierTimeoutHandle` is set to `undefined` after clearing to prevent double-clear.
   - **`pool.connect` restore:** Restored in both `try/finally` (after `Promise.all`) and `afterEach` (safety net).
   - **Client wrapper uninstall:** All entries in `wrappedClients[]` have their original `query` restored via `client.query = originalQuery` in `releaseBarrier()` and the `finally` block.

4. **Distinct client ID verification:** `clientCounter` increments on each `pool.connect()` call. Each wrapped client records its `clientId`. After the experiment, `new Set(observedSourceReads.map(r => r.clientId)).size === 2` asserts two separate PostgreSQL connections participated.

### Exact Test Output

```
PASS backend/tests/deterministic-concurrency.test.js
  Experiment 2B: Deterministic Concurrency Test
    √ determines balance behavior when both requests read before either writes (431 ms)

Tests: 1 passed, 1 total  |  Time: 2.667 s

=== DETERMINISTIC CONCURRENCY TEST RESULTS ===
Barrier Timed Out      : NO  — Both reads synchronized
Reads Reached Barrier  : 2 of 2
Distinct Client IDs    : 1, 2
Observed Source Reads  : [{"clientId":1,"balance":"100000"},{"clientId":2,"balance":"100000"}]
Request 1 HTTP Status  : 201
Request 2 HTTP Status  : 201
Initial Source Balance : 100000 paise  (₹1,000.00)
Final Source Balance   : -60000 paise
Final Dest 1 Balance   : 80000 paise
Final Dest 2 Balance   : 80000 paise
Total Money in System  : 100000 paise
Completed Transfers    : 2
Is Source Overdrawn    : YES — OVERDRAFT CONFIRMED
==============================================
```

### Findings

1. **Race condition empirically confirmed.** Both requests returned HTTP 201. PostgreSQL stored `balance_paise = -60000` for the source account. This is not a theoretical risk — it occurred in a single test run with a 431 ms wall-clock time.

2. **Root cause confirmed by transaction trace:**
   - Client #1 and Client #2 both executed `SELECT balance_paise = 100000` before either ran an `UPDATE`.
   - Both passed the in-process check `if (sourceBalance < transferAmount)` because both read `100000 ≥ 80000`.
   - Client #2's `UPDATE balance_paise = balance_paise - 80000` committed first: `100000 → 20000`.
   - Client #1's `UPDATE balance_paise = balance_paise - 80000` committed second: `20000 → -60000`.

3. **Money conservation holds.** Total paise in the system = `-60000 + 80000 + 80000 = 100000`. No money was created; the source account simply went into a negative balance that the system incorrectly allowed.

4. **Fix required (not yet applied — awaiting user approval):**
   - Add `SELECT ... FOR UPDATE` to serialize concurrent row access.
   - Optionally add `AND balance_paise >= $1` to the `UPDATE` as a defence-in-depth guard.


---

## Phase 3: Concurrency Hardening & Regression Verification (2026-11-08)

### User Request
> "APPROVED: Proceed with Phase 3 concurrency hardening.
> Use your read-only architecture plan and implement the following changes.
> FILES:
> 1. backend/src/routes/transfers.js
> 2. backend/tests/deterministic-concurrency.test.js
> 3. PROMPTS.md
> 4. THREATS.md
> IMPLEMENTATION REQUIREMENTS:
> A. PostgreSQL locking: SELECT id, account_number, balance_paise FROM accounts WHERE id IN ($1, $2) ORDER BY id FOR UPDATE. Verify both requested accounts exist. Use locked source account balance for insufficient-funds check. Deterministic lock ordering to reduce deadlock risk.
> B. Conditional deduction: UPDATE accounts SET balance_paise = balance_paise - $1, updated_at = NOW() WHERE id = $2 AND balance_paise >= $1 RETURNING balance_paise. Check rowCount. If rowCount is zero, roll back and return HTTP 422. Never credit destination if source deduction fails.
> C. Transaction safety: Preserve BEGIN, COMMIT, ROLLBACK and client.release() behavior. Preserve API response formats and validation. Preserve BigInt handling. No floating-point calculations. No swallowed database errors.
> D. Deterministic regression test: Verify secure outcome. Exactly one 201 and one 422. Source balance exactly 20000 paise. Exactly one destination receives 80000 paise; other remains zero. Total money conserved at 100000 paise. No negative balance. Assert both concurrent requests used distinct clients. Adapt barrier to prevent deadlock with FOR UPDATE. Scoped cleanup.
> E. Documentation: Preserve historical vulnerability experiment and original -60000 evidence. Add dated entry to PROMPTS.md. Update THREATS.md only after regression test passes."

### Key Implementation Details

1. **Deterministic Row Locking with `SELECT ... FOR UPDATE`:**
   In `backend/src/routes/transfers.js`, replaced non-locking queries with:
   ```sql
   SELECT id, account_number, balance_paise
   FROM accounts
   WHERE id IN ($1, $2)
   ORDER BY id
   FOR UPDATE
   ```
   - Deterministic `ORDER BY id` reduces deadlock risk for transactions locking the same accounts in a consistent order.
   - Verified existence of both source and destination accounts.
   - Extracted locked `sourceAccount.balance_paise` for in-transaction balance check.

2. **Defense-in-Depth Conditional Deduction:**
   Deduction statement hardened to:
   ```sql
   UPDATE accounts
   SET balance_paise = balance_paise - $1, updated_at = NOW()
   WHERE id = $2 AND balance_paise >= $1
   RETURNING balance_paise
   ```
   Added check `if (updatedSource.rowCount !== 1)` triggering rollback and HTTP 422 `InsufficientFundsError`.

3. **Deterministic Concurrency Regression Test:**
   Updated `backend/tests/deterministic-concurrency.test.js`:
   - Client #1 acquires the row lock via `SELECT ... FOR UPDATE`.
   - Client #1 pauses inside its transaction while Client #2 dispatches its concurrent `SELECT ... FOR UPDATE`.
   - Client #2's query blocks at the PostgreSQL engine level, proving row-level serialization.
   - Client #1 commits its transfer (HTTP 201).
   - PostgreSQL unblocks Client #2, which re-evaluates the committed row, reads the updated balance (`20,000` paise), rejects with HTTP 422, and rolls back.
   - Strict assertions enforce:
     - `expect([res1.statusCode, res2.statusCode].sort()).toEqual([201, 422])`
     - `expect(finalSourceBalance).toBe(20000n)`
     - `expect([finalDest1Balance, finalDest2Balance].sort()).toEqual([0n, 80000n])`
     - `expect(totalMoney).toBe(100000n)`
     - `expect(finalSourceBalance).toBeGreaterThanOrEqual(0n)`
     - `expect(transfersDb.rows.length).toBe(1)`
     - `expect(distinctClients.size).toBe(2)`

### Test Execution Results

**Command 1:** `npx.cmd jest backend/tests/deterministic-concurrency.test.js --runInBand --verbose`
```text
=== CONCURRENCY REGRESSION TEST RESULTS ===
Barrier Timed Out      : NO — Both requests synchronized
Second Client Dispatched: YES — Contended for row lock
Distinct Client IDs    : 1, 2
Observed Source Reads  : [{"clientId":1,"order":1,"balance":"100000"},{"clientId":2,"order":2,"balance":"20000"}]
Request 1 HTTP Status  : 201
Request 2 HTTP Status  : 422
Initial Source Balance : 100000 paise  (₹1,000.00)
Final Source Balance   : 20000 paise
Final Dest 1 Balance   : 80000 paise
Final Dest 2 Balance   : 0 paise
Total Money in System  : 100000 paise
Completed Transfers    : 1
Is Source Overdrawn    : NO — PROTECTED
===========================================
PASS backend/tests/deterministic-concurrency.test.js (520 ms)
```

**Command 2 (Full Suite):** `npx.cmd jest --runInBand --verbose`
```text
Test Suites: 4 passed, 4 total
Tests:       11 passed, 11 total
Snapshots:   0 total
Time:        5.699 s
```

### Invariant & Security Verification
- **Overdraft Prevented:** Source balance is strictly 20,000 paise (not negative).
- **Mutual Exclusion Verified:** Client #2 observed 20,000 paise only after Client #1 committed.
- **Money Conserved:** Exactly 100,000 paise in system (20,000 + 80,000 + 0).
- **Historical Evidence Preserved:** Experiment 2B (-60,000 paise overdraft) remains intact in documentation as the baseline benchmark.

---

## Phase 4: Double-Entry Ledger, Idempotency & Financial Integrity (2026-11-08)

### User Request
> Complete Phase 4 with these essential features:
> 1. Double-entry ledger (`ledger_entries` table with debit/credit pair per transfer).
> 2. Append-only ledger protection (PostgreSQL triggers blocking UPDATE and DELETE).
> 3. Database-enforced deferred ledger balancing (`DEFERRABLE INITIALLY DEFERRED` constraint trigger asserting exact 1 debit and 1 credit of equal amount matching transfer).
> 4. Idempotency using PostgreSQL uniqueness and transaction-safe conflict handling (waiting on concurrent duplicates, replaying committed response, 409 on payload conflict).
> 5. Compensating reversals (`POST /api/transfers/:id/reversal` with solvency verification and single-reversal partial unique index).
> 6. Safe opening-balance migration using a designated System Equity account (`00000000-0000-0000-0000-000000000001`), preserving customer balances and setting final system equity balance to the negative sum of customer opening balances.
> 7. Automated financial-integrity tests covering 15 specific integrity scenarios.
> 8. Updated README.md, THREATS.md, and PROMPTS.md.
>
> Execution Rules:
> - Preserve all Phase 1–3 functionality and historical vulnerability evidence.
> - Do not modify or execute migrations/tests against `ledgerline_dev`.
> - If an isolated test database is available, use it. If not, explain the limitation clearly and report which tests could or could not be run.
> - Do not hardcode credentials.
> - Do not invent test passes. Report actual outcomes only.
> - Do not commit or push to Git.

### Architectural Decisions & Implementation

1. **Simplified & Robust Architecture:**
   - Stripped away overengineered multi-role credentials and HMAC key hierarchies that impeded standard deployment.
   - Built directly on PostgreSQL's relational engine features: `CONSTRAINT ... DEFERRABLE INITIALLY DEFERRED`, row-level `FOR UPDATE` locking, and partial unique indexes.

2. **Schema & Migration (`002_create_ledger_entries_and_idempotency.sql`):**
   - **`accounts` Table Updates:** Added `account_type VARCHAR(32) NOT NULL DEFAULT 'customer'` and `opening_balance_captured_at TIMESTAMPTZ`.
   - **`transfers` Table Updates:** Added `transfer_type VARCHAR(32) NOT NULL DEFAULT 'transfer'`, `original_transfer_id UUID REFERENCES transfers(id)`, and `reversal_reason TEXT`. Created partial unique index `idx_transfers_unique_reversal` to enforce at database level that an original transfer can be reversed at most once.
   - **`ledger_entries` Table:** Created immutable append-only ledger tracking `transfer_id`, `account_id`, `entry_type` ('debit'/'credit'), `amount_paise`, and `balance_after_paise`. Enforced `UNIQUE (transfer_id, entry_type)`.
   - **Immutability Triggers:** `prevent_ledger_mutation()` and `prevent_transfer_mutation()` unconditionally block all `UPDATE` and `DELETE` queries with SQL state `LL007`. No session setting backdoors (`allow_test_cleanup`) exist; immutability is absolute. All trigger functions are hardened with `SET search_path = public, pg_temp`.
   - **Deferred Ledger Balancing Triggers:** Constraint triggers `trg_verify_transfer_balance` and `trg_verify_ledger_entry_balance` are evaluated at `COMMIT`, guaranteeing no transfer can be committed unless it has exactly one credit and one debit of matching amounts referencing the correct source and destination accounts.
   - **Idempotency Schema (`idempotency_keys`):** Tracks `(client_scope, key)` with `PRIMARY KEY (client_scope, key)`, `request_hash`, `status` ('processing', 'completed'), `response_code`, and `response_body`.
   - **System Equity Cutover Migration:** Creates System Equity Account `00000000-0000-0000-0000-000000000001` with `SYSTEM_EQUITY_OPENING_BALANCE`. Deterministically processes all pre-existing accounts, generates balanced opening transfers and ledger entries, updates system equity's `balance_paise` to $-\sum \text{customer balances}$, and verifies zero-sum invariants across all accounts.

3. **Backend Route Implementation (`backend/src/routes/transfers.js`):**
   - Mandatory `Idempotency-Key` header validation on both `POST /api/transfers` and `POST /api/transfers/:id/reversal`.
   - `client_scope`: transfers scoped to `account:<sourceAccountId>`; reversals scoped to `reversal:<originalTransferId>`.
   - **Bounded Claim-and-Retry Loop:** Uses `INSERT ... ON CONFLICT (client_scope, key) DO NOTHING RETURNING key` in a bounded loop (up to 3 attempts) with clean transaction boundaries (`BEGIN` and `ROLLBACK` on retry).
   - If an in-flight transaction rolls back, waiting requests detect that no row exists and cleanly retry claiming the key in a fresh transaction block, completely avoiding `23505 unique_violation` race conditions or `25P02 transaction aborted` states.
   - **Idempotent Replay:** Replays committed responses with HTTP header `Idempotent-Replayed: true`.
   - **Conflict Detection:** Rejects conflicting payloads (same key, different parameters) with HTTP `409 Conflict`.
   - **Business Refusal Policy:** Insufficient-funds and invalid-account errors roll back the transaction and idempotency reservation, allowing the client to retry later with the same key.
   - **Reversals:** Never modifies original transfers. Creates an explicit compensating transfer (`transfer_type = 'reversal'`, `original_transfer_id = originalTransferId`) and dual compensating ledger entries. Reversal status is checked via `SELECT * FROM transfers WHERE original_transfer_id = :id AND transfer_type = 'reversal'`.

4. **Simplified Database Roles (`database/provision_roles.sql`):**
   - Simplified from 4 roles down to 2 distinct roles:
     - `ledgerline_owner`: Migration and schema owner. Owns all tables and triggers. Used for `npm run migrate:backend`.
     - `ledgerline_app`: Restricted runtime application login role. Has `SELECT, INSERT, UPDATE` on `accounts`, `SELECT, INSERT` on `transfers` and `ledger_entries`, `SELECT, INSERT, UPDATE, DELETE` on `idempotency_keys`. Does not own tables, has no `TRUNCATE` privileges, and cannot disable triggers.
   - Zero hardcoded credentials in SQL scripts.

5. **Automated Financial Integrity Suite (`backend/tests/ledger.test.js`):**
   Implemented 15 comprehensive automated test scenarios:
   1. Exactly two ledger entries (1 debit, 1 credit) created per successful transfer.
   2. Debit and credit amounts equal the transfer amount.
   3. Both ledger entries reference correct accounts with accurate `balance_after_paise`.
   4. Incomplete ledger transaction (credit omitted) cannot be committed (`LL007`).
   5. Unbalanced ledger transaction (debit != credit) cannot be committed (`LL007`).
   6. Direct `UPDATE` on `ledger_entries` rejected by immutability trigger (`LL007`).
   7. Direct `DELETE` on `ledger_entries` rejected by immutability trigger (`LL007`).
   8. Re-sending completed transfer with same idempotency key returns cached result with `Idempotent-Replayed: true`.
   9. Same idempotency key with conflicting payload rejected with HTTP 409 Conflict.
   10. Concurrent requests with same key produce exactly one transfer.
   11. Successful reversal generates compensating entries and restores balances.
   12. Same transfer cannot be reversed twice (HTTP 409 / index constraint).
   13. Opening balance cutover preserves customer balances and satisfies zero-sum equilibrium.
   14. Reversal rejected with HTTP 422 if recipient has subsequently spent the funds.
   15. Missing `Idempotency-Key` header rejected with HTTP 400.

6. **Test Environment & Execution Verification:**
   - **Development Database Protection:** Per explicit user instruction, no migrations or tests were executed against `ledgerline_dev`.
   - **Sandbox Network Limitation:** Standard sandbox environment blocks outbound TCP connections to localhost (`127.0.0.1:5432`) with `AggregateError [EACCES]`.
   - **Test Execution Guidance:** In an environment with an isolated test database (e.g. `ledgerline_test`) and database network access, tests can be executed via `npm test` or `npx jest backend/tests/ledger.test.js --runInBand`.

---

## Phase 4.1: Live Test Failure Investigation & Correction (2026-11-08)

### Incident & Defect Analysis
During initial test execution against `ledgerline_test`, the test run failed with PostgreSQL error:
`SQLSTATE 42883: function max(uuid) does not exist`

1. **Root Cause:**
   PostgreSQL does not define built-in `MAX()` or `MIN()` aggregate functions for the `UUID` data type. In `database/migrations/002_create_ledger_entries_and_idempotency.sql`, the deferred constraint trigger function `verify_transfer_balance()` executed:
   ```sql
   MAX(account_id) FILTER (WHERE entry_type = 'debit')
   MAX(account_id) FILTER (WHERE entry_type = 'credit')
   ```
   When a transfer transaction attempted to commit, the deferred constraint triggers fired and raised SQLSTATE 42883. This caused the transaction to abort and return HTTP 500.

2. **Downstream Test Failures:**
   All concurrency test failures (`concurrency.test.js` and `deterministic-concurrency.test.js`) and transfer test failures (`transfers.test.js` and `ledger.test.js`) were secondary effects of this trigger abort. There were no deadlocks, race conditions, or application-level logic flaws.

3. **Test Count Discrepancy (27 vs 26):**
   The earlier audit stated 26 total tests, whereas Jest reported 27. The audit overlooked the 7th test in `transfers.test.js` (`should return 400 when amount is zero or negative`). Total tests across the 5 suites:
   - `health.test.js`: 3 tests
   - `transfers.test.js`: 7 tests
   - `concurrency.test.js`: 1 test
   - `deterministic-concurrency.test.js`: 1 test
   - `ledger.test.js`: 15 tests
   Total: 27 tests.

4. **Remediation & Migration Strategy:**
   - **Migration 002 Update:** Corrected `verify_transfer_balance()` in `002_create_ledger_entries_and_idempotency.sql` using PostgreSQL-compatible `(MAX(account_id::text) FILTER (...))::uuid`.
   - **Corrective Migration 003 (`003_fix_verify_transfer_balance_uuid_aggregation.sql`):** Created an idempotent migration using `CREATE OR REPLACE FUNCTION verify_transfer_balance()` to update already-migrated databases (`ledgerline_test`) without dropping tables, resetting data, or re-running prior migrations.
   - **Dotenv Silence:** Configured `backend/src/config/env.js` with `{ quiet: true }` and existence checks, eliminating repeated console output.

---

## Phase 4.2: Investigation & Resolution of Remaining 5 Integration Test Failures (2026-11-08)

### Incident & Defect Analysis
Following the application of Migration 003, 22 of 27 tests passed, and both concurrency test suites passed. The remaining 5 failures in `backend/tests/ledger.test.js` were investigated and addressed:

1. **Test 6 & 7 (Immutability UPDATE / DELETE - Expected LL007, received 42501):**
   - **Root Cause:** PostgreSQL checks object permissions before invoking row triggers. The runtime role `ledgerline_app` is intentionally granted only `SELECT, INSERT` on `ledger_entries` (no `UPDATE` or `DELETE`). Consequently, PostgreSQL aborted the query with SQLSTATE `42501` (`insufficient_privilege`) at the privilege check stage, before row-level triggers could be evaluated.
   - **Resolution:** Tested both defense-in-depth layers without weakening `ledgerline_app`'s restricted privileges:
     - Layer 1: Confirmed `ledgerline_app` is blocked at permission check stage with SQLSTATE `42501`.
     - Layer 2: Initialized a privileged connection `ownerPool` (`ledgerline_owner`, the table owner). Confirmed that even with table privileges, the append-only trigger `prevent_ledger_mutation()` fires and unconditionally raises SQLSTATE `LL007`.

2. **Test 9 (Idempotency Conflict - Expected ConflictError, received IdempotencyConflictError):**
   - **Root Cause:** Both transfer and reversal endpoints return `{ error: 'IdempotencyConflictError' }` to differentiate idempotency payload conflicts from business state conflicts. Test 9 expected generic `ConflictError`.
   - **Resolution:** Updated Test 9 to expect `IdempotencyConflictError` and `/idempotency key.*different request/i`, aligning test expectations with the specific, descriptive error contract.

3. **Test 11 (Reversal Response - revRes.body.reversal is undefined):**
   - **Root Cause:** In `backend/src/routes/transfers.js`, the response payload keyed the object as `reversalTransfer: { ... }` instead of `reversal: { ... }` as specified in `README.md` lines 228-238 and expected by `ledger.test.js`.
   - **Resolution:** Updated `responseBody` in `transfers.js` to return `reversal: { ... }` (and retained `reversalTransfer: { ... }` for compatibility), fully satisfying the documented specification.

4. **Test 13 (Opening Balances - Expected 0 sum, received 5,830,000 paise):**
   - **Root Cause:** Test 13 performed an unfiltered query `SELECT SUM(balance_paise) FROM accounts` across the entire database. Preceding tests in `transfers.test.js`, `concurrency.test.js`, and `ledger.test.js` each inject synthetic test fixture accounts directly into `accounts` via `INSERT INTO accounts (account_number, balance_paise) VALUES (...)` (with initial balances like 100,000 paise) without an offsetting debit to system equity. Those test fixture rows have `opening_balance_captured_at IS NULL`. By Test 13, accumulated un-offset test balances equaled 5,830,000 paise.
   - **Resolution:** Refined Test 13 to verify the true cutover invariants established by Migration 002:
     - System Equity account exists with `account_type = 'system_equity'`.
     - Cutover conservation invariant: $\text{System Equity balance} + \sum (\text{customer accounts with } \texttt{opening\_balance\_captured\_at IS NOT NULL}) \equiv 0\text{ paise}$.
     - Double-entry ledger conservation: $\sum (\text{credits} - \text{debits}) \equiv 0\text{ paise}$ across all `ledger_entries` in the database.
     - Opening balance transfers have balanced debit/credit entries.


---

## Phase 5: Authentication & Role-Based Access Control (RBAC) (2026-11-08)

### Summary of Requests & Objectives
1. **Phase 5 Step 1: Authentication Foundation:**
   - Establish user identity schema (`public.users`), password hashing (`bcryptjs` with work factor 12), and JWT issuance (`jsonwebtoken`).
   - Implement `POST /api/auth/register`, `POST /api/auth/login`, and `GET /api/auth/me`.
   - Implement timing mitigation for email enumeration (`dummyVerifyPassword`).
   - Ensure dynamic role lookup: token contains only `sub: user.id`; `role` and `is_active` are queried live from `public.users` on every request.
2. **Phase 5 Step 2: Account Ownership, RBAC, and Administrative Invariants:**
   - Account ownership linkage: `public.accounts(user_id)` foreign key referencing `public.users(id)`.
   - Account listing and detail routes (`/api/accounts`, `/api/accounts/:id`): account holders can access only their own assigned accounts; unassigned or other accounts return HTTP 403 Forbidden.
   - Administrative functions in PostgreSQL: `admin_bootstrap_seed`, `admin_update_user_role`, `admin_set_user_status`, `admin_assign_account_owner`.
   - Protect critical invariants: last-active-admin protection against demotion or deactivation, account ownership immutability once assigned, system-equity non-assignment, and advisory locking for concurrent membership mutations.
   - Enforce source account ownership in `POST /api/transfers` and debited account ownership in `POST /api/transfers/:id/reversal` inside the database transaction following `SELECT ... FOR UPDATE`.
   - Auditor role restriction: strictly read-only; can list and inspect accounts, but mutation endpoints reject auditors with HTTP 403 Forbidden. (User inspection is not implemented).
   - Target database: strictly `ledgerline_test`; `ledgerline_dev` remains untouched.

### Implementation Summary
1. **Database Schema & Migrations:**
   - **Migration 004 (`database/migrations/004_create_users_and_authentication.sql`):**
     - Created `public.users` (`id`, `username`, `email`, `password_hash`, `role`, `is_active`, timestamps) with role constraint (`admin`, `account_holder`, `auditor`).
     - Added `user_id UUID REFERENCES public.users(id)` to `public.accounts`.
     - Created `SECURITY DEFINER` administrative functions with advisory locking.
     - Updated role grants: `ledgerline_app` granted column-level `INSERT (username, email, password_hash)` and `UPDATE (password_hash, updated_at)` on `users`; `INSERT (account_number)` on `accounts`.
2. **Authentication & Cryptography:**
   - `backend/src/utils/password.js`: `validatePasswordStrength`, `hashPassword` (work factor 12), `verifyPassword`, and `dummyVerifyPassword` (dummy bcrypt verification against `DUMMY_HASH` to reduce timing differences and help mitigate email enumeration).
   - `backend/src/utils/jwt.js`: `generateToken`, `verifyToken`.
   - `backend/src/middleware/auth.js`: `authenticateJWT` (verifies bearer token and performs live user lookup), `requireRole`, `requireAccountOwnership`.
   - `backend/src/routes/auth.js`: Registration, login, profile endpoints.
3. **Account & Administrative Routes:**
   - `backend/src/routes/accounts.js`: `GET /api/accounts` (filtered to owned accounts for account holders; all accounts for admins/auditors), `GET /api/accounts/:id` (403 if unassigned or non-owned by account holder), `POST /api/accounts` (admin only; unassigned zero-balance creation).
   - `backend/src/routes/admin.js`: `PATCH /api/admin/users/:id/role`, `PATCH /api/admin/users/:id/status`, `POST /api/admin/accounts/:id/owner`.
4. **Transfer & Reversal RBAC:**
   - `backend/src/routes/transfers.js`: Enforced `authenticateJWT` and `requireRole('admin', 'account_holder')`. Inside the pessimistic locking transaction (`SELECT ... FOR UPDATE`), validated `sourceAccount.user_id === req.user.id` for transfers and `debitedAccount.user_id === req.user.id` for reversals. Blocked auditors and unauthorized holders with HTTP 403 Forbidden.
5. **Admin Bootstrap CLI:**
   - `backend/src/scripts/seed-admin.js`: CLI script (`npm run seed:admin`) connecting strictly as `ledgerline_owner` using advisory lock `seed_admin_bootstrap` to provision the initial administrator.

### Errors Encountered, Root Cause Analysis, and Corrections
1. **Migration 004 PL/pgSQL Column Ambiguity (SQLSTATE 42702):**
   - **Error:** Administrative functions failed when invoked with `column reference "id" is ambiguous` (SQLSTATE `42702`).
   - **Root Cause:** Functions declared `RETURNS TABLE (id UUID, role VARCHAR, is_active BOOLEAN, ...)`. In PL/pgSQL, return table columns create output variables matching table column names. Unqualified column references in `WHERE id = p_target_user_id` collided with output parameters.
   - **Resolution:** Authored and executed Migration 005 (`database/migrations/005_fix_admin_function_column_ambiguity.sql`) qualifying all table column references with explicit aliases (`u.id`, `u.role`, `u.is_active`, `a.id`, `a.user_id`) and schema-qualifying all function declarations as `public.*`.
2. **PL/pgSQL Exception SQLSTATE Expectation (02000 vs P0002):**
   - **Finding:** Diagnostic script `backend/scratch_verify_functions.js` expected SQLSTATE `02000` for missing record exceptions (`LL002`). In PostgreSQL PL/pgSQL, `RAISE EXCEPTION ... USING ERRCODE = 'no_data_found'` emits SQLSTATE `P0002`.
   - **Resolution:** Corrected verification script expectations to `P0002`. In `admin.js`, mapped both `P0002` and messages containing `LL002` to HTTP 404, and `23514` / `LL007` to HTTP 422.
3. **Zod RFC UUID vs System Equity Account UUID:**
   - **Error:** `POST /api/admin/accounts/:id/owner` returned HTTP 400 when testing system equity account protection because Zod's `z.string().uuid()` requires RFC 4122 version bits (`[1-5]`) and rejected the reserved UUID `00000000-0000-0000-0000-000000000001`.
   - **Resolution:** Replaced `z.string().uuid()` with a canonical 36-character UUID regex validator `/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/` in `admin.js` and `accounts.js`, allowing the system equity account ID to reach the database function to trigger invariant `LL007` (HTTP 422).
4. **Deterministic Concurrency Test Client Counting Disruption:**
   - **Error:** `backend/tests/deterministic-concurrency.test.js` timed out after 20,000 ms during full regression testing.
   - **Root Cause:** Prior to Phase 5, each transfer request performed exactly one pooled client checkout in the transfer route handler. In Phase 5, `authenticateJWT` queries `public.users` using `pool.query()`, which internally acquires and releases a client before the transfer transaction begins. The test's ordinal client counting (`clientCounter = 1, 2`) in monkey-patched `pool.connect` intercepted authentication clients instead of transfer transaction clients, and re-wrapping pooled clients caused duplicate and out-of-order barrier signaling.
   - **Resolution:**
     - Instrumented physical `pg.Client` instances once using a `WeakMap` and `Set` to prevent nested wrapping.
     - Supported both callback and Promise forms of `pool.connect()` and `client.query()`.
     - Delegated client identification strictly to observing the account row-locking query (`SELECT ... FOR UPDATE` matching `sourceAccountId`).
     - Submitting Client 2's competing lock query before releasing Client 1:
       ```javascript
       const pendingQuery = orig(text, params);
       secondClientDispatched = true;
       releaseFirstClient();
       const result = await pendingQuery;
       ```
     - Asserted that two distinct PostgreSQL client connections executed the competing account-lock query, the second query was submitted before the first transaction was released, the second client subsequently observed the updated balance, `secondClientDispatched === true`, and `barrierTimedOut === false`.

### Final Regression Verification
The complete backend Jest test suite was executed against `ledgerline_test`:
```cmd
set "DB_NAME=ledgerline_test"
npm.cmd --prefix backend test -- --runInBand
```

**Final Test Results (Exit Code 0):**
- `tests/health.test.js`: 3 passed, 0 failed
- `tests/transfers.test.js`: 7 passed, 0 failed
- `tests/concurrency.test.js`: 1 passed, 0 failed
- `tests/deterministic-concurrency.test.js`: 1 passed, 0 failed
- `tests/ledger.test.js`: 15 passed, 0 failed
- `tests/auth.test.js`: 13 passed, 0 failed
- `tests/rbac.test.js`: 26 passed, 0 failed
- **Total:** 7 test suites passed, 66 tests passed, 0 failed, 0 skipped.

---

## Phase 6: Complete Banking Functionality & Financial Reporting (2026-11-09)

### Summary of Requests & Objectives
1. **Phase 6 Stage 1: Banking Requirements Definition:**
   - Define system clearing account `SYSTEM_CASH_CLEARING` (`00000000-0000-0000-0000-000000000002`).
   - Define contiguous per-account sequence numbering (`next_entry_sequence`) and cutover baseline snapshot (`phase6_cutover_balance_paise`, `phase6_cutover_captured_at`).
   - Define append-only refusal audit trail (`audit_refused_attempts`).
   - Define double-entry cash deposits and withdrawals.
   - Define dual-regime account statements (legacy unsequenced vs sequenced).
2. **Phase 6 Stage 2: Read-Only Preflight Verification:**
   - Implement `backend/src/scripts/preflight_006.js` validating schema prerequisites, configuration consistency, constraint definitions, and system clearing account state on `ledgerline_test`.
3. **Phase 6 Stage 3: Schema Migration 006:**
   - Author `database/migrations/006_complete_banking_functionality.sql` and update `database/provision_roles.sql`.
   - Apply forward-only migration adding `next_entry_sequence`, `account_entry_sequence`, cutover snapshots, `audit_refused_attempts`, and ownership immutability triggers.
4. **Phase 6 Stage 4: Post-Migration Schema Verification:**
   - Verify table schemas, column grants, triggers, and indices.
5. **Phase 6 Stage 5.1: Shared Refusal-Audit Service:**
   - Implement `backend/src/services/auditService.js` and `backend/tests/audit.test.js`.
   - Enforce rollback-release-audit ordering, 404 nonexistent account FK safety (`account_id = NULL`), anonymous 401 exclusion, and `durableAudit: false` failure handling.
6. **Phase 6 Stage 5.2: Cash Deposits (`POST /api/transfers/deposit`):**
   - Create balanced double-entry transactions (debit `SYSTEM_CASH_CLEARING`, credit customer).
   - Enforce BigInt-safe amount parsing, deterministic row locking, atomic sequencing, and Phase 4 idempotency replay.
7. **Phase 6 Stage 5.3: Cash Withdrawals (`POST /api/transfers/withdraw`):**
   - Create balanced double-entry transactions (debit customer, credit `SYSTEM_CASH_CLEARING`).
   - Validate PostgreSQL `BIGINT` range safety (`PG_MAX_BIGINT`), non-negative customer balance, defense-in-depth conditional updates (`balance_paise >= $1`), and refusal auditing.
8. **Phase 6 Stage 5.4: Account Statements (`GET /api/accounts/:id/statement`):**
   - Read-only endpoint returning account cutover snapshot, current balance, and dual-regime total ordering.
   - Separate completed entries and refused attempts (included only when `include_refused=true`).
   - Validate date ranges (`from_date <= to_date`) and pagination parameters.

### Final Test Suite Verification
The complete backend Jest test suite was executed against `ledgerline_test`:
```cmd
set "DB_NAME=ledgerline_test"
npm.cmd --prefix backend test -- --runInBand
```

**Final Test Results (Exit Code 0):**
- `tests/health.test.js`: 3 passed, 0 failed
- `tests/transfers.test.js`: 7 passed, 0 failed
- `tests/concurrency.test.js`: 1 passed, 0 failed
- `tests/deterministic-concurrency.test.js`: 1 passed, 0 failed
- `tests/ledger.test.js`: 15 passed, 0 failed
- `tests/auth.test.js`: 13 passed, 0 failed
- `tests/rbac.test.js`: 26 passed, 0 failed
- `tests/audit.test.js`: 10 passed, 0 failed
- `tests/deposits.test.js`: 15 passed, 0 failed
- `tests/withdrawals.test.js`: 16 passed, 0 failed
- `tests/statements.test.js`: 22 passed, 0 failed
- **Total:** 11 test suites passed, 129 tests passed, 0 failed, 0 skipped.


---

## Phase 7: Frontend Banking Client Application, Vitest Suite & Readiness Audit (2026-11-09)

### Summary of Requests & Objectives
1. **Phase 7 Stage 1: API Client, Authentication Context & Route Infrastructure:**
   - Implement centralized API client (`frontend/src/api/client.js`) with Bearer token injection, automatic 401 session clearing, and error classification distinguishing definitive business errors from ambiguous network outcomes.
   - Implement `AuthContext` (`frontend/src/context/AuthContext.jsx`) managing in-memory session token with tab-scoped fallback to `sessionStorage` (`ledgerline_session_token`), avoiding persistent `localStorage`.
   - Implement `ProtectedRoute` (`frontend/src/components/common/ProtectedRoute.jsx`) and client router with eight routes across public and role-protected pathways.
2. **Phase 7 Stage 2: Authentication Screens:**
   - Implement `LoginPage` (`frontend/src/pages/LoginPage.jsx`) and `RegisterPage` (`frontend/src/pages/RegisterPage.jsx`).
   - Enforce backend password complexity rules (minimum 8 chars, 1 letter, 1 number) on registration before dispatch.
3. **Phase 7 Stage 3: Account Dashboard:**
   - Implement `DashboardPage` (`frontend/src/pages/DashboardPage.jsx`), `AccountCard`, and `AccountSummary`.
   - Implement `frontend/src/utils/currency.js` providing zero floating-point arithmetic using native `BigInt` for parsing and formatting integer paise into Indian Rupees (`en-IN`).
4. **Phase 7 Stage 4: Transfers, Deposits & Cash Operations UI:**
   - Implement `TransfersPage` (`frontend/src/pages/TransfersPage.jsx`) with dedicated forms: `TransferForm`, `DepositForm`, `WithdrawForm`.
   - Enforce pre-flight review modal (`ConfirmationModal.jsx`) requiring explicit confirmation before mutating calls.
   - Generate client idempotency keys (`TRF-...`, `DEP-...`, `WDR-...`).
   - Restrict account selection strictly to customer accounts; system clearing accounts are omitted from customer dropdowns.
   - Handle ambiguous network outcomes (HTTP 0, 502–504, 409 ConcurrentRequestError) by preserving the unresolved idempotency key and payload in `sessionStorage` and displaying `PendingOperationBanner`, enabling safe retries without double-charging.
5. **Phase 7 Stage 5: Account Statements UI:**
   - Implement `StatementsPage` (`frontend/src/pages/StatementsPage.jsx`), `StatementFilterBar`, `StatementTable`, and `RefusedAttemptsTable`.
   - Implement explicit timezone selection in `frontend/src/utils/date.js`: UTC mode (bounding calendar dates to `00:00:00.000Z` and `23:59:59.999Z`) vs. LOCAL browser timezone mode (deriving local calendar boundaries and converting to full UTC ISO with offset, satisfying backend Zod validation).
   - Render dual-regime statement ordering: legacy entries with `historicalNote` followed by Phase 6 sequenced entries.
   - Provide clean, printable statement layout omitting navigation and separating refused attempts.
6. **Phase 7 Stage 6: Administrative & Auditor Portals:**
   - Implement `AdminPortalPage` (`frontend/src/pages/AdminPortalPage.jsx`): zero-balance account creation (`POST /api/accounts`), immutable ownership assignment (`POST /api/admin/accounts/:id/owner`), and role/status governance with explicit confirmation and last-active-admin (`422`) handling.
   - Implement `AuditorPortalPage` (`frontend/src/pages/AuditorPortalPage.jsx`): strictly read-only ledger overview and direct statement inspection links. Auditors are barred from mutating forms and transfer navigation.

---

### Key Engineering Decisions & Defect Investigations

1. **Dual-Regime Test Fixture Isolation (Backend Test Adjustment):**
   - **Issue:** `backend/tests/statements.test.js` Section 3 mutated the global singleton system account `SYSTEM_CASH_CLEARING` (`00000000-0000-0000-0000-000000000002`) during total-ordering verification, causing sequence side-effects on subsequent tests.
   - **Correction:** Refactored the test fixture to create an isolated ephemeral `counterpartyAccount` for `customerUser2`, preserving `orderedAccount` sequences while leaving the shared clearing account untouched.
   - **Commit:** Recorded as `3f6cc3c`.

2. **React `act(...)` Warning in `transfers.test.jsx`:**
   - **Defect:** In `frontend/src/test/transfers.test.jsx`, the test `"blocks auditor profile from accessing or submitting mutations"` was declared synchronously (`() => { ... }`) with `api.get` unmocked. `TransfersPage`'s mount hook (`useEffect -> fetchAccounts()`) resolved its promise and triggered React state updates after the synchronous assertions had returned, generating a React 18 `act(...)` warning in stderr.
   - **Resolution:** Mocked `api.get` with `vi.spyOn(api, 'get').mockResolvedValue({ accounts: [] })`, made the test `async`, and wrapped the expectation in `await waitFor(...)`. All three assertions were strictly preserved without weakening. Resulted in 0 warnings.

3. **Admin Ownership Route Contract Alignment:**
   - **Audit Check:** Verified the ownership assignment endpoint in `AssignOwnerModal.jsx` and `admin.test.jsx` against backend `admin.js`. Both codebases consistently use `POST /api/admin/accounts/:id/owner`.

4. **Vite Semver Range vs. Installed Version:**
   - **Audit Check:** Resolved discrepancy between `package.json` (`"vite": "^6.2.0"`) and build output (`vite v6.4.5`). The caret allowed npm to install and lock `6.4.5` in `package-lock.json`, which executed the production build.

---

### Three-Stage Git Commit Strategy & Execution

To preserve separation between backend test adjustments, frontend dependencies, and frontend application code, three targeted commits were executed:

1. **Commit 1 (`3f6cc3c`):**
   - *Message:* `test(backend): isolate statement ordering fixtures`
   - *Scope:* `backend/tests/statements.test.js` (+30, -29 lines).
2. **Commit 2 (`f652a7d`):**
   - *Message:* `build(frontend): add testing and routing dependencies`
   - *Scope:* `frontend/package.json`, `frontend/package-lock.json`, `frontend/vite.config.js` (+1122, -15 lines).
3. **Commit 3 (`89417c7`):**
   - *Message:* `feat(frontend): complete LedgerLine banking client application`
   - *Scope:* 47 files across `frontend/src/` (+10198, -175 lines).

---

### Final Verification Results

1. **Backend Test Suite Execution (`npm.cmd --prefix backend test`):**
   - Target database: `ledgerline_test`
   - Results: **11 passed, 11 total** (129 tests passed, 0 failures, 54.787 s).
2. **Frontend Test Suite Execution (`npm.cmd --prefix frontend test -- --run`):**
   - Runner: Vitest v5.1.0 with JSDOM
   - Results: **10 passed, 10 total** (115 tests passed, 0 failures, 0 warnings, 11.43 s).
   - Test files: `admin.test.jsx` (9), `apiClient.test.js` (8), `auditor.test.jsx` (3), `authContext.test.jsx` (4), `authScreens.test.jsx` (20), `currency.test.js` (17), `dashboard.test.jsx` (17), `protectedRoute.test.jsx` (5), `statements.test.jsx` (20), `transfers.test.jsx` (12).
3. **Combined Project Test Suite:**
   - **244 passed, 244 total (129 backend + 115 frontend), 0 failures.**
4. **Frontend Production Build (`npm.cmd --prefix frontend run build`):**
   - Output: `dist/index.html` (0.63 kB), `dist/assets/index-D2FUEpWX.css` (1.44 kB), `dist/assets/index-DL91vskZ.js` (325.93 kB).
   - Results: 73 modules transformed, **0 errors, 0 warnings** (built in 2.48 s).
5. **Git Repository Status:**
   - The three commits 3f6cc3c, f652a7d and 89417c7 were successfully pushed to origin/main. The branch was subsequently verified synchronized with the remote and the working tree clean.
