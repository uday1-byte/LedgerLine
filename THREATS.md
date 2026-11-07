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
| **Concurrent Overdraft / Double-Spending** | **⚠️ EMPIRICALLY CONFIRMED VULNERABILITY** (Reproduced in Experiment 2B on 2026-11-07; deterministic barrier test; overdraft of -60,000 paise confirmed in PostgreSQL; both requests returned HTTP 201) | Read query uses `SELECT ... FROM accounts WHERE id = $1` without pessimistic locking (`FOR UPDATE`) and `UPDATE` lacks `AND balance_paise >= $1`. Two simultaneous transactions both read balance = 100,000, both passed the in-process check (100,000 ≥ 80,000), and both committed `UPDATE balance_paise = balance_paise - 80000`. The source account reached -60,000 paise. | A source account with ₹1,000.00 was depleted to -₹600.00, losing ₹600.00 of institutional funds. At scale, an attacker with control over request timing could drain accounts below zero. |
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

* **Fix Required (not yet implemented — awaiting user approval):**
  - Add `SELECT ... FOR UPDATE` to the source-account query to serialize concurrent transactions at the row lock level.
  - Optionally add `AND balance_paise >= $1` to the UPDATE as a defence-in-depth guard.
