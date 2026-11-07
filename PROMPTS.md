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
