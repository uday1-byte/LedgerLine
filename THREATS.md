# LedgerLine - Threat Model & Security Architecture

## 1. Executive Summary
LedgerLine is a financial ledger application. In financial systems, integrity, auditability, and immutability are paramount. A single undetected data tampering incident or calculation flaw can cause significant monetary loss, compliance breaches, or loss of customer trust.

This document uses the **STRIDE** methodology (Spoofing, Tampering, Repudiation, Information Disclosure, Denial of Service, Elevation of Privilege) to identify security risks and define mitigation strategies for LedgerLine.

---

## 2. Financial Domain Specific Threats & Mitigations

### 2.1 Double-Spending & Race Conditions
* **Threat:** A user submits two concurrent transfer requests against the same account before balance checks complete, resulting in an overdraft or balance inconsistency.
* **Mitigation:**
  - Enforce atomic database transactions (`BEGIN ... COMMIT / ROLLBACK`) with strict isolation levels.
  - Use pessimistic row-level locking (`SELECT ... FOR UPDATE`) on account balance records during transaction processing.
  - Implement client idempotency keys (`Idempotency-Key` HTTP header) stored in an idempotency table to ensure identical requests cannot be processed more than once.

### 2.2 Floating-Point Arithmetic Rounding Errors
* **Threat:** Standard JavaScript numbers (`Number`) are IEEE 754 double-precision floats, leading to inaccuracies such as `0.1 + 0.2 === 0.30000000000000004`. Over time or across high volumes, this leads to ledger imbalances and rounding arbitrage.
* **Mitigation:**
  - Never store or calculate monetary amounts as floating-point numbers.
  - Store monetary values in PostgreSQL as `BIGINT` (representing minor currency units, e.g., integer paise).
  - Perform strict integer arithmetic in backend services using native `BigInt`.

### 2.3 Record Tampering & Non-Immutability
* **Threat:** A compromised admin or internal attacker alters historical transaction rows to conceal theft or adjust balances.
* **Mitigation:**
  - Ledger entries must be **append-only**.
  - No `UPDATE` or `DELETE` permissions should be granted to application users on transaction tables.
  - Adjustments and reversals must be handled strictly by creating compensatory offsetting entries (e.g., reversal transactions).
  - Include cryptographic hash chaining or tamper-evident audit logs for ledger verification.

---

## 3. STRIDE Threat Analysis

| Threat Category | Description | Specific Risk in LedgerLine | Mitigation Strategy |
| :--- | :--- | :--- | :--- |
| **Spoofing** | Pretending to be someone else | Unauthorized user forging JWT tokens or replaying credentials | Use strong JWT secrets (`HS256`/`RS256`), short token expiration (e.g., 15-60 min), refresh token rotation, and bcrypt password hashing (work factor >= 12). |
| **Tampering** | Altering data in transit or at rest | Modifying transfer amounts, account IDs, or SQL injection | Parameterized queries with `node-postgres` ($1, $2), strict input validation via `Zod` schemas before data reaches business logic, HTTPS enforcement. |
| **Repudiation** | Denying an action took place | A user claims they never initiated a high-value transfer | Comprehensive append-only audit log capturing `user_id`, `ip_address`, `timestamp`, `action`, and cryptographic request hash. |
| **Information Disclosure** | Exposing private financial data | Leaking account balances, customer PII, or database credentials | Environment variable isolation (`.env` omitted from git), strict CORS policies, stripped error stack traces in production, role-based data projection. |
| **Denial of Service (DoS)** | Overwhelming services to block legitimate transactions | Connection pool exhaustion or API flooding | Rate limiting on public and auth endpoints (`express-rate-limit`), connection pool bounds (`pg.Pool` max 20), request body payload limits. |
| **Elevation of Privilege** | Gaining unauthorized access to capabilities | A regular user approving their own transaction or viewing another user's ledger | Role-Based Access Control (RBAC) middleware verifying user permissions and ownership checks on every protected route. |

---

## 4. Secret Management & Secure Development Lifecycle
- **No Hardcoded Secrets:** Passwords, database connection strings, and JWT signing keys must be loaded exclusively from environment variables.
- **Git Protection:** `.gitignore` excludes all `.env*` files except `.env.example`.
- **Security Audits:** Regular `npm audit` scans and dependency updates.
- **Strict Error Handling:** Error responses to clients must not reveal internal database structure, table names, or raw SQL queries.

---

## 5. Experiment 1: Risk Assessment & Status of Baseline Protections

The current implementation of `POST /api/transfers` provides an initial working functional baseline. Below is a status breakdown distinguishing verified protections from known unverified vulnerabilities.

### 5.1 Verified Protections (Tested & Confirmed)
1. **Integer Arithmetic Protection:** Money is stored as `BIGINT` in PostgreSQL and manipulated using JavaScript `BigInt`, eliminating floating-point rounding errors.
2. **SQL Injection Defense:** All queries in `transfers.js` strictly use parameterized queries (`$1, $2`).
3. **Payload Sanitization:** Zod schema rejects malformed UUIDs, non-integer amounts, negative amounts, zero amounts, and transfers where `sourceAccountId === destinationAccountId`.
4. **Basic Transaction Rollback:** Balance deduction and credit run within a database transaction (`BEGIN ... COMMIT / ROLLBACK`), ensuring that if either update fails, neither takes effect.

### 5.2 Identified Security Risks & Unverified Behaviors (Under Investigation)

| Risk Area | Current Status | Technical Root Cause (Code Review) | Potential Financial Consequence |
| :--- | :--- | :--- | :--- |
| **Concurrent Overdraft / Double-Spending** | **✅ MITIGATED & VERIFIED (2026-11-08)** (Historically confirmed in Experiment 2B with -60,000 paise overdraft; mitigated via `SELECT ... FOR UPDATE` with deterministic lock ordering `ORDER BY id` and conditional deduction guard `AND balance_paise >= $1`. Verified by deterministic regression test: HTTP [201, 422], final source balance 20,000 paise, zero overdraft). | **Historical root cause (fixed):** Read query previously used non-locking `SELECT` and unconditional `UPDATE`. **Mitigation applied:** Both accounts are locked in canonical order (`WHERE id IN ($1, $2) ORDER BY id FOR UPDATE`), serializing concurrent transactions at the database engine level. The deduction uses conditional `WHERE id = $2 AND balance_paise >= $1` with `rowCount` check. | **Historical Risk:** Source account was depleted to -₹600.00 (-60,000 paise). **Current Status:** Overdraft is physically prevented; the second concurrent transfer is blocked by PostgreSQL until the first commits, reads the updated balance (20,000 paise), fails the balance check, and is rejected with HTTP 422. |
| **Missing Idempotency Protection** | **Unconfirmed Risk Under Investigation** (Design gap: no idempotency key support) | `POST /api/transfers` does not accept or track an `Idempotency-Key` header. | If an HTTP response drops due to network timeout and the client retries, the transfer executes twice, deducting double the funds. |
| **Mutable Balances (No Double-Entry Ledger)** | **Architectural Risk (Design Gap)** | Balances are directly updated on the `accounts` table via `UPDATE accounts SET balance_paise = ...` rather than derived from an append-only ledger of debit and credit entries. | A failure or database discrepancy cannot be mathematically audited or reconstructed from historical entries. |
| **Silent Refusal / No Audit Trail** | **Identified Feature Gap** | Insufficient funds errors return HTTP 422 and execute `ROLLBACK`. No record of the refused attempt is written. | Fraudulent transfer attempts or unauthorized brute-force attempts leave no trace for compliance or security monitoring. |
| **Missing Authorization & Ownership** | **Identified Security Gap (Known)** | The endpoint accepts any `sourceAccountId` without verifying that the requesting user owns or has authority over that account. | Any authenticated or unauthenticated client can drain any account if they know its UUID. |

---

## 6. Experiment 2: Concurrency Empirical Findings (2026-11-07)

### 6.1 Exploratory Run (concurrency.test.js)
* **Test Executed:** Single exploratory execution of `backend/tests/concurrency.test.js` launching two simultaneous requests of 80,000 paise against an account with 100,000 paise.
* **Empirical Observations:**
  - Request 1 returned HTTP `201 Created`.
  - Request 2 returned HTTP `422 Unprocessable Entity`.
  - Final Source Balance: `20000` paise (not negative).
  - Completed transfers recorded: `1`.
* **Evidence Interpretation:**
  - **Empirical Status:** The race condition was **not reproduced** in this single exploratory run. The operations happened to serialize sequentially on local loopback.
  - **Code Review Finding:** Code inspection confirms that `SELECT` lacks `FOR UPDATE` and `UPDATE` lacks a conditional balance check. Thus, while unproven by this single test, the structural mechanism that could allow double-spending under concurrent interleaving remains present in the code.
  - **Test Assertion Flaw Identified:** The exploratory assertion `expect([201, 422]).toContain(...)` was identified as insufficiently strict, as it would not fail even if both requests returned 201.

### 6.2 Deterministic Barrier Reproduction (deterministic-concurrency.test.js) — 2026-11-07

* **Test Executed:** `npx.cmd jest tests/deterministic-concurrency.test.js --runInBand --forceExit`
* **Test Mechanism:** A pre-started TCP server received both HTTP requests simultaneously via `Promise.all`. The `pool.connect` method was instrumented to intercept each client's source-account balance SELECT. A two-party barrier held Request 1 at its SELECT until Request 2 also completed its SELECT — guaranteeing both reads observed the same pre-commit balance before either UPDATE executed.
* **Empirical Observations:**
  - Barrier Timed Out: **NO — Both reads synchronized**
  - Reads Reached Barrier: **2 of 2**
  - Distinct PostgreSQL Client IDs: **1, 2** (two separate transactions confirmed)
  - Observed Source Reads: `[{clientId:1, balance:"100000"}, {clientId:2, balance:"100000"}]`
  - Request 1 HTTP Status: **201 Created**
  - Request 2 HTTP Status: **201 Created**
  - Final Source Balance: **-60000 paise** ← OVERDRAWN
  - Final Dest 1 Balance: `80000 paise`
  - Final Dest 2 Balance: `80000 paise`
  - Total Money in System: `100000 paise` (conservation holds — funds were not created, the account went negative)
  - Completed Transfers: **2**
  - Is Source Overdrawn: **YES — OVERDRAFT CONFIRMED**
  - Jest result: **PASS** (1 test passed, 431 ms)

* **Exact Transaction Sequence Confirmed:**
  ```
  Tx 1 (client #1):  BEGIN
  Tx 1 (client #1):  SELECT balance_paise = 100000  ← read under barrier
  Tx 1 (client #1):  [HELD at barrier — waiting for Tx 2]
  Tx 2 (client #2):  BEGIN
  Tx 2 (client #2):  SELECT balance_paise = 100000  ← same stale value read
  Tx 2 (client #2):  [RELEASES barrier]
  Tx 2 (client #2):  UPDATE balance_paise = 100000 - 80000 = 20000; COMMIT → HTTP 201
  Tx 1 (client #1):  UPDATE balance_paise = 20000  - 80000 = -60000; COMMIT → HTTP 201
  ```

* **Vulnerability Status: EMPIRICALLY CONFIRMED**
  - Both HTTP responses were `201 Created`.
  - PostgreSQL on disk shows `balance_paise = -60000` for the source account.
  - The in-process balance check (`if (sourceBalance < transferAmount)`) passed for both requests because both read `100000` before either committed.
  - The absence of `SELECT ... FOR UPDATE` allowed both transactions to read the same row concurrently without blocking.
  - The absence of a conditional `WHERE balance_paise >= $1` on the UPDATE allowed both deductions to commit regardless of intermediate state.

* **Fix Implemented & Empirically Verified (2026-11-08):**
  - Added `SELECT ... FOR UPDATE` with canonical lock ordering (`ORDER BY id`) on both accounts.
  - Added conditional deduction guard `AND balance_paise >= $1` with strict `rowCount` check.
  - Verified by deterministic regression test (Section 6.3).

### 6.3 Phase 3 Hardening & Concurrency Mitigation (2026-11-08)

* **Test Executed:** `npx.cmd jest backend/tests/deterministic-concurrency.test.js --runInBand --verbose`
* **Test Synchronization Strategy:**
  - Client #1 acquires the row lock via `SELECT ... FOR UPDATE` on `sourceAccountId`.
  - Client #1 pauses inside its transaction, holding the lock open.
  - Client #2 dispatches its concurrent `SELECT ... FOR UPDATE`, contending for the same locked row.
  - PostgreSQL automatically blocks Client #2 at the database engine level until Client #1 commits.
  - Client #1 executes deduction (80,000 paise), credits destination 1, and commits.
  - Upon Client #1's commit, PostgreSQL unblocks Client #2, which re-evaluates the updated committed row, reads the new balance (`20,000` paise), finds `20,000 < 80,000`, rolls back, and returns HTTP 422 `InsufficientFundsError`.
* **Empirical Observations:**
  - Barrier Timed Out: **NO — Both requests synchronized**
  - Second Client Dispatched: **YES — Contended for row lock in PostgreSQL**
  - Distinct PostgreSQL Client IDs: **1, 2** (two separate connections verified)
  - Observed Source Reads: `[{"clientId":1,"order":1,"balance":"100000"},{"clientId":2,"order":2,"balance":"20000"}]`
  - Request 1 HTTP Status: **201 Created**
  - Request 2 HTTP Status: **422 Unprocessable Entity**
  - Final Source Balance: **20000 paise** (₹200.00 — strictly positive, zero overdraft)
  - Final Dest 1 Balance: **80000 paise** (received funds)
  - Final Dest 2 Balance: **0 paise** (rejected, untouched)
  - Total Money in System: **100000 paise** (exact conservation preserved)
  - Completed Transfers: **1**
  - Is Source Overdrawn: **NO — PROTECTED**
  - Jest result: **PASS** (1 test passed, 520 ms)

* **Exact Transaction Sequence Confirmed Under Fix:**
  ```
  Tx 1 (client #1):  BEGIN
  Tx 1 (client #1):  SELECT ... WHERE id IN ($1, $2) ORDER BY id FOR UPDATE  ← acquires row lock, reads 100000
  Tx 1 (client #1):  [HELD at barrier holding lock — waiting for Tx 2 to dispatch]
  Tx 2 (client #2):  BEGIN
  Tx 2 (client #2):  SELECT ... WHERE id IN ($1, $2) ORDER BY id FOR UPDATE  ← BLOCKED by PostgreSQL engine!
  Tx 1 (client #1):  [UNPAUSED upon Tx 2 dispatch]
  Tx 1 (client #1):  UPDATE accounts SET balance_paise = balance_paise - 80000 WHERE id = :sourceId AND balance_paise >= 80000
  Tx 1 (client #1):  UPDATE accounts SET balance_paise = balance_paise + 80000 WHERE id = :dest1Id
  Tx 1 (client #1):  INSERT INTO transfers ...
  Tx 1 (client #1):  COMMIT → HTTP 201 Created
  -------------------------------------------------------------------------------------------------------
  Tx 2 (client #2):  [UNBLOCKED by PostgreSQL engine upon Tx 1 COMMIT]
  Tx 2 (client #2):  SELECT re-evaluates committed row → reads balance_paise = 20000
  Tx 2 (client #2):  Check: 20000 < 80000 → Insufficient funds
  Tx 2 (client #2):  ROLLBACK → HTTP 422 Unprocessable Entity
  ```

* **Mitigation Status: VERIFIED AND MITIGATED**
  - Overdraft is physically prevented by database row-level locking.
  - The second concurrent transfer cannot read stale balance data.
  - Deadlock risk is reduced by deterministic UUID sorting (`ORDER BY id`) for transactions locking the same accounts in a consistent order.
  - Total money in the system is conserved without leakage or double-spending.
