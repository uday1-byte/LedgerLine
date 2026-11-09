# 🛡️ LedgerLine — Threat Model & Security Architecture

This document provides a comprehensive threat analysis for the LedgerLine financial application using the **STRIDE** methodology (Spoofing, Tampering, Repudiation, Information Disclosure, Denial of Service, Elevation of Privilege) combined with banking domain-specific failure mode analysis.

Each threat is documented using a standardized five-part format:
1. **Threat & Potential Impact**
2. **Relevant Attack Scenario**
3. **Implemented Mitigation**
4. **Supporting Implementation or Test Evidence**
5. **Remaining Limitations & Residual Risk**

---

## 1. Executive Summary & Core Invariants

In a financial double-entry banking system, integrity, auditability, and immutability are paramount. A single undetected data tampering incident or calculation flaw causes monetary loss, regulatory failure, and broken trust.

LedgerLine operates under strict mathematical and database-enforced invariants:
- **Integer Paise Arithmetic:** All money is tracked in integer paise ($1\text{ INR} = 100\text{ paise}$). Floating-point arithmetic is prohibited.
- **Double-Entry Balancing (`LL001`–`LL004`):** Every financial mutation produces exactly two balanced ledger entries (one debit, one credit) matching the transfer amount.
- **Append-Only Immutability (`LL007`):** Ledger entries, completed transfers, and refusal audit logs are append-only. `ledgerline_app` cannot update or delete ledger entries through its granted application privileges, and database triggers reject normal UPDATE and DELETE operations. The privileged schema owner remains a trust boundary capable of altering schema or triggers (immutability protects against application-level operations, but is not an absolute impossibility of bypass by privileged database roles).
- **Concurrency Serialization:** Transfers lock accounts in canonical ascending UUID order (`ORDER BY id ASC FOR UPDATE`) to serialize access and reduce deadlock risk.
- **Duplicate Request Protection:** Mutating endpoints enforce scoped, hashed idempotency keys preventing duplicate execution for the same applicable key and scope.
- **Least-Privilege Separation:** The runtime application (`ledgerline_app`) cannot alter tables, disable triggers, or truncate data.

---

## 2. Baseline Vulnerability Benchmark & Concurrency Verification

### 2.1 Historical Baseline Flaw: TOCTOU Race Condition (Experiment 2B — 2026-11-07)
* **Threat & Impact:** Time-of-check to time-of-use (TOCTOU) race condition in concurrent transfer requests allows an account to be overdrawn into a negative balance without authorization.
* **Attack Scenario:**
  - A user with a balance of ₹1,000.00 (100,000 paise) simultaneously dispatches two concurrent transfer requests of ₹800.00 (80,000 paise) each to separate destinations.
  - In the unhardened baseline (`52592cb`), both requests read the source balance before either executed an `UPDATE`.
* **Empirical Reproduction Results ([`backend/tests/deterministic-concurrency.test.js`](file:///d:/LedgerLine/backend/tests/deterministic-concurrency.test.js)):**
  Using a two-party synchronization barrier holding Client #1's read open until Client #2 executed its read:
  ```text
  === DETERMINISTIC CONCURRENCY TEST RESULTS ===
  Barrier Timed Out      : NO — Both reads synchronized
  Reads Reached Barrier  : 2 of 2
  Distinct Client IDs    : 1, 2
  Observed Source Reads  : [{"clientId":1,"balance":"100000"},{"clientId":2,"balance":"100000"}]
  Request 1 HTTP Status  : 201 Created
  Request 2 HTTP Status  : 201 Created
  Initial Source Balance : 100000 paise (₹1,000.00)
  Final Source Balance   : -60000 paise (-₹600.00) ← OVERDRAWN
  Final Dest 1 Balance   : 80000 paise
  Final Dest 2 Balance   : 80000 paise
  Completed Transfers    : 2
  Is Source Overdrawn    : YES — OVERDRAFT CONFIRMED
  ```
* **Historical Root Cause:**
  1. The balance read query executed a plain non-locking `SELECT`.
  2. The balance deduction executed an unconditional `UPDATE accounts SET balance_paise = balance_paise - $1`. Both transactions committed successfully because both passed the in-process check ($100{,}000 \ge 80{,}000$).

### 2.2 Phase 3 Hardening & Concurrency Mitigation (2026-11-08)
* **Implemented Mitigation:**
  1. **Row-Level Pessimistic Locking:** Both participating accounts are locked in deterministic ascending UUID order:
     ```sql
     SELECT id, balance_paise FROM accounts WHERE id IN ($1, $2) ORDER BY id ASC FOR UPDATE
     ```
  2. **Defense-in-Depth Conditional Deduction:** The deduction query asserts available funds in SQL:
     ```sql
     UPDATE accounts
     SET balance_paise = balance_paise - $1, updated_at = NOW()
     WHERE id = $2 AND balance_paise >= $1
     RETURNING balance_paise
     ```
     If `rowCount !== 1`, the transaction immediately aborts with `ROLLBACK` and returns HTTP 422 `InsufficientFundsError`.
* **Empirical Verification Results ([`backend/tests/deterministic-concurrency.test.js`](file:///d:/LedgerLine/backend/tests/deterministic-concurrency.test.js)):**
  ```text
  === CONCURRENCY REGRESSION TEST RESULTS ===
  Barrier Timed Out      : NO — Both requests synchronized
  Second Client Dispatched: YES — Contended for row lock in PostgreSQL
  Distinct Client IDs    : 1, 2
  Observed Source Reads  : [{"clientId":1,"order":1,"balance":"100000"},{"clientId":2,"order":2,"balance":"20000"}]
  Request 1 HTTP Status  : 201 Created
  Request 2 HTTP Status  : 422 Unprocessable Entity
  Initial Source Balance : 100000 paise (₹1,000.00)
  Final Source Balance   : 20000 paise (₹200.00) ← PROTECTED
  Final Dest 1 Balance   : 80000 paise
  Final Dest 2 Balance   : 0 paise
  Total Money in System  : 100000 paise (conserved)
  Completed Transfers    : 1
  Is Source Overdrawn    : NO — PROTECTED
  ```
* **Residual Risk & Concurrency Disclaimer:**
  Deterministic row-lock ordering (`ORDER BY id ASC`) prevents circular lock wait between transactions accessing the same pair of accounts, significantly reducing deadlock probability. However, it cannot guarantee the prevention of all possible deadlocks across multi-table operations or under high database contention. The tested scenario passed.

---

## 3. Historical Risk Evolution Matrix (Experiment 1 &rarr; Full Implementation)

The table below contrasts the vulnerabilities identified during the initial baseline (Experiment 1) against the subsequent mitigations implemented across Phases 3–6, and details the remaining residual risk:

| Identified Risk Area | Baseline Flaw (Experiment 1) | Implemented Mitigation (Phases 3–6) | Remaining Residual Risk |
| :--- | :--- | :--- | :--- |
| **Concurrent Overdraft / Double-Spending** | Unlocked reads (`SELECT`) and unconditional updates allowed simultaneous debits to overdraw accounts (-60,000 paise). | `SELECT ... FOR UPDATE` with deterministic `ORDER BY id ASC` and conditional deduction `WHERE balance_paise >= $1`. Verified by regression tests. | Lock contention under high throughput; deadlocks possible if foreign queries lock tables in reverse order. |
| **Missing Idempotency Protection** | Missing `Idempotency-Key` header allowed network retries to double-execute transfers. | Mandatory `Idempotency-Key` with SHA-256 payload hashing and response caching (`idempotency_keys` table). Bounded claim-and-retry loop. | Unbounded table growth without archival; clients reusing keys with different payloads receive 409 Conflict. |
| **Mutable Balances (No Double-Entry)** | Balances were updated directly on `accounts` without an immutable transaction audit log. | Immutable append-only `ledger_entries` table with deferred balancing constraint `trg_verify_transfer_balance` (`LL001`–`LL004`). | Direct SQL updates to `accounts` executed out-of-band as `ledgerline_app` bypass ledger triggers (periodic reconciliation queries are a recommended operational control and are not currently implemented as an automated scheduled service). |
| **Silent Refusal / No Audit Trail** | Failed transactions executed `ROLLBACK` and vanished without a trace. | Append-only `audit_refused_attempts` table logging business refusals with rollback-release-audit ordering and 404 FK protection. | Anonymous 401s are unlogged to prevent DoS storage flooding; audit insertion failures trigger 500 (`durableAudit: false`). |
| **Missing Authorization & Ownership** | Any caller knowing an account UUID could transfer funds out of any account. | Strict RBAC (`authenticateJWT`, `requireRole`, `requireAccountOwnership`) and SQL isolation (`user_id = req.user.id`). | Express middleware is the sole authorization boundary; database functions do not verify HTTP JWTs. |

---

## 4. In-Depth Threat Analysis & Mitigations

### 4.1 Duplicate Requests & Idempotency Key Handling
1. **Threat & Potential Impact:** Transient network timeouts, client retry loops, or multiple clicks cause the same financial mutation to be executed multiple times, resulting in accidental double debits or duplicate credits.
2. **Relevant Attack Scenario:** A user's mobile connection drops immediately after the database commits a transfer. The banking client automatically retries the identical HTTP request, deducting another 50,000 paise from the sender.
3. **Implemented Mitigation:**
   - Mutating endpoints require an `Idempotency-Key` HTTP header.
   - Idempotency operates strictly as **protection against duplicate execution for the same applicable key and client scope** (`client_scope`), not as a universal network-layer replay prevention mechanism.
   - Keys are explicitly partitioned:
     - Transfers: `account:<sourceAccountId>`
     - Deposits: `deposit:<accountId>`
     - Withdrawals: `withdraw:<accountId>`
     - Reversals: `reversal:<originalTransferId>`
   - The backend stores a SHA-256 hash of canonical business parameters.
   - Replaying the identical key with matching parameters returns the cached result with HTTP header `Idempotent-Replayed: true`.
   - Re-sending the same key with altered parameters returns HTTP `409 Conflict` (`IdempotencyConflictError`).
   - If an in-flight request fails business solvency checks (HTTP 422), the transaction rolls back, releasing the key reservation so the client can fund the account and retry.
4. **Supporting Implementation or Test Evidence:**
   - [`backend/tests/ledger.test.js`](file:///d:/LedgerLine/backend/tests/ledger.test.js) &mdash; Tests 8, 9, 10, 15.
   - [`frontend/src/test/transfers.test.jsx`](file:///d:/LedgerLine/frontend/src/test/transfers.test.jsx) &mdash; Tests 4, 8, 9.
5. **Remaining Limitations & Residual Risk:**
   Idempotency records persist indefinitely unless archived. Idempotency does not protect against an attacker issuing fresh requests with newly generated UUID keys; application-level rate limiting and session authentication are required.

---

### 4.2 Reversal Abuse & Recipient Solvency
1. **Threat & Potential Impact:** An account holder or malicious party attempts to claw back funds without authorization, reverses the same transfer multiple times, or drives a recipient account into an unauthorized negative balance by reversing funds that have already been withdrawn.
2. **Relevant Attack Scenario:** Alice sends ₹500 to Bob. Later, Alice attempts to unilaterally reverse the transfer to take the funds back without Bob's consent. Alternatively, Eve reverses a transfer, receives the credit, and immediately issues a second reversal request for the same original transfer.
3. **Implemented Mitigation:**
   - **Debited Account Ownership Verification:** In `POST /api/transfers/:id/reversal`, reversing a transfer debits the *original recipient* and credits the *original sender*. The backend enforces that only the party being debited (`req.user.id === debitedAccount.user_id`) or an administrator can initiate the reversal. The original sender cannot unilaterally claw back funds (`403 Forbidden`).
   - **Recipient Solvency Check:** The debited recipient account is locked (`FOR UPDATE`) and checked for sufficient balance. If `balance_paise < amount_paise`, the reversal is rejected with HTTP `422 Unprocessable Entity` ("Destination account has insufficient funds to reverse this transfer").
   - **Database-Enforced Single Reversal:** A PostgreSQL partial unique index `idx_transfers_unique_reversal ON transfers (original_transfer_id) WHERE original_transfer_id IS NOT NULL AND transfer_type = 'reversal'` physically guarantees that an original transfer cannot be reversed more than once at the database engine level.
   - **Compensating Immutability:** Completed transfer records are never modified or deleted. An explicit compensating transfer record (`transfer_type = 'reversal'`) and dual compensating ledger entries are created.
4. **Supporting Implementation or Test Evidence:**
   - [`backend/tests/ledger.test.js`](file:///d:/LedgerLine/backend/tests/ledger.test.js) &mdash; Test 11 (compensating entries), Test 12 (duplicate reversal blocked), Test 14 (insufficient recipient funds rejected).
   - [`backend/tests/rbac.test.js`](file:///d:/LedgerLine/backend/tests/rbac.test.js) &mdash; Reversal ownership authorization tests.
5. **Remaining Limitations & Residual Risk:**
   If a recipient deliberately drains their account balance to zero after receiving funds, automated reversal fails and requires offline administrative dispute resolution.

---

### 4.3 Opening-Balance Cutover Integrity & Zero-Sum Accounting
1. **Threat & Potential Impact:** Introducing baseline customer balances during migration creates unbacked phantom currency, distorts balance accounting, or violates the fundamental double-entry conservation invariant $\sum \text{balances} = 0$.
2. **Relevant Attack Scenario:** An initial database migration sets customer balances to positive amounts without offsetting counter-entries, causing the total system money supply to be unbacked and mathematically unverifiable.
3. **Implemented Mitigation:**
   - **System Equity Account:** Migration `002` provisions a dedicated System Equity Account (`00000000-0000-0000-0000-000000000001`, `SYSTEM_EQUITY_OPENING_BALANCE`).
   - **Exact Negative Sum Offset:** The system equity balance is set to the exact negative sum of all customer opening balances:
     $$\text{Balance}_{\text{equity}} = -\sum_{i} \text{Balance}_{\text{customer}_i}$$
   - **Balanced Cutover Entries:** Opening transfers and balanced ledger entries are created for every pre-existing account. Positive customer balances debit System Equity and credit Customer; negative balances debit Customer and credit System Equity.
   - **Conservation Assertion:** The migration asserts $\sum \text{balance\_paise} = 0$ across all accounts in the database upon cutover completion.
4. **Supporting Implementation or Test Evidence:**
   - [`backend/tests/ledger.test.js`](file:///d:/LedgerLine/backend/tests/ledger.test.js) &mdash; Test 13.
   - [`database/migrations/002_create_ledger_entries_and_idempotency.sql`](file:///d:/LedgerLine/database/migrations/002_create_ledger_entries_and_idempotency.sql).
5. **Remaining Limitations & Residual Risk:**
   System equity is an internal accounting mechanism representing the baseline capital obligation of the platform to customer deposits; it does not represent physical cash or central bank reserves.

---

### 4.4 Database Role Separation & Least-Privilege Controls
1. **Threat & Potential Impact:** A compromised application server, malicious developer, or SQL injection vulnerability alters database schemas, disables triggers, or truncates financial tables.
2. **Relevant Attack Scenario:** An attacker exploits an application vulnerability to execute arbitrary SQL as the database user, attempting to run `TRUNCATE TABLE accounts;` or `DROP TRIGGER trg_verify_transfer_balance ON transfers;`.
3. **Implemented Mitigation:**
   - **Two-Role Architecture ([`database/provision_roles.sql`](file:///d:/LedgerLine/database/provision_roles.sql)):**
     - `ledgerline_owner`: Migration and schema owner. Executes migrations (`npm run migrate:backend`). Owns all tables, sequences, and triggers. Not used for customer HTTP traffic.
     - `ledgerline_app`: Restricted runtime application login role used by the Node.js Express server.
   - **Role Privileges Enforcement:**
     - `ledgerline_app` is granted strictly `SELECT, INSERT` on `transfers`, `ledger_entries`, and `audit_refused_attempts` (no `UPDATE`, `DELETE`, or `TRUNCATE`).
     - `ledgerline_app` has column-level `INSERT (account_number)` and column-level `UPDATE (balance_paise, updated_at, opening_balance_captured_at, next_entry_sequence)` on `accounts`. It cannot alter table schemas or disable triggers.
     - `ledgerline_app` has `REVOKE ALL` on `schema_migrations`.
   - **Engine-Level Trigger Defense:** Normal `UPDATE` and `DELETE` queries executed against ledger tables are unconditionally intercepted and aborted with SQLSTATE `LL007` by trigger functions (`prevent_ledger_mutation`, `prevent_transfer_mutation`, `trg_prevent_audit_mutation`).
4. **Supporting Implementation or Test Evidence:**
   - [`backend/tests/ledger.test.js`](file:///d:/LedgerLine/backend/tests/ledger.test.js) &mdash; Tests 6 & 7 verify both layers (SQLSTATE 42501 privilege denial for `ledgerline_app` attempting `UPDATE` or `DELETE`, and SQLSTATE LL007 trigger rejection when normal DML is attempted under `ledgerline_owner`).
5. **Remaining Limitations & Residual Risk:**
   `ledgerline_app` cannot update or delete ledger entries through its granted application privileges, and database triggers reject normal `UPDATE` and `DELETE` operations. The privileged schema owner remains a trust boundary capable of altering schema or triggers. Do not claim absolute impossibility of bypass; immutability is enforced against application-level operations, but does not represent an absolute impossibility of bypass by privileged database administrators or compromised host credentials. Database host and owner credentials must be protected through strict out-of-band operational controls.

---

### 4.5 First-Admin Bootstrap Race Conditions & Advisory Locking
1. **Threat & Potential Impact:** During initial deployment, an unauthenticated attacker races the administrator to claim initial ownership of the system, gaining total administrative privileges.
2. **Relevant Attack Scenario:** An attacker monitors public network traffic or repeatedly queries an onboarding endpoint to register as the first administrator before the legitimate operator can act.
3. **Implemented Mitigation:**
   - There is **no HTTP bootstrap endpoint**. Bootstrap cannot be invoked over the network.
   - Initial bootstrap is executed strictly via local CLI: `node backend/src/scripts/seed-admin.js` (`npm run seed:admin`).
   - The CLI connects strictly as schema owner `ledgerline_owner` using credentials from `backend/.env`.
   - The CLI acquires a PostgreSQL 64-bit transactional advisory lock (`seed_admin_bootstrap = 8273645192837461n`) and invokes stored procedure `public.admin_bootstrap_seed(...)`.
   - The procedure verifies whether any active administrator already exists in `public.users`. If an administrator exists, it aborts immediately with SQLSTATE `LL007` ("Administrator user already bootstrapped").
4. **Supporting Implementation or Test Evidence:**
   - [`backend/src/scripts/seed-admin.js`](file:///d:/LedgerLine/backend/src/scripts/seed-admin.js).
   - [`database/migrations/004_create_users_and_authentication.sql`](file:///d:/LedgerLine/database/migrations/004_create_users_and_authentication.sql) &mdash; `admin_bootstrap_seed` function.
5. **Remaining Limitations & Residual Risk:**
   The operator must protect the `backend/.env` file containing `ADMIN_PASSWORD` and delete or rotate credentials following one-time bootstrap.

---

### 4.6 Account Ownership Reassignment & Immutability Triggers
1. **Threat & Potential Impact:** A compromised or rogue administrator reassigns a high-balance customer account to an attacker-controlled user identity.
2. **Relevant Attack Scenario:** An admin submits `POST /api/admin/accounts/:id/owner` targeting an account that already belongs to Alice, setting `userId` to Eve.
3. **Implemented Mitigation:**
   - In stored procedure `public.admin_assign_account_owner`, PostgreSQL checks `a.user_id IS NOT NULL`. If already assigned, it raises error `LL007` ("Account ownership is immutable once assigned").
   - **Database Defense-in-Depth:** Trigger `trg_prevent_account_ownership_reassignment` on `public.accounts` intercepts all SQL statements: if `OLD.user_id IS NOT NULL AND NEW.user_id IS DISTINCT FROM OLD.user_id`, the trigger unconditionally raises `LL007`.
   - System accounts (`00000000-0000-0000-0000-000000000001`, `00000000-0000-0000-0000-000000000002`) cannot be assigned to user owners (`422`).
4. **Supporting Implementation or Test Evidence:**
   - [`backend/tests/rbac.test.js`](file:///d:/LedgerLine/backend/tests/rbac.test.js) &mdash; Account ownership immutability tests.
   - [`frontend/src/test/admin.test.jsx`](file:///d:/LedgerLine/frontend/src/test/admin.test.jsx) &mdash; Assignment disabled for owned accounts in UI.
5. **Remaining Limitations & Residual Risk:**
   Legitimate legal transfers of ownership (e.g. court-ordered probate) cannot be accomplished by modifying the account record; a new account must be opened and funds transferred via an audited ledger transaction.

---

### 4.7 Insecure Direct Object References (IDOR) & Account-Level Authorization
1. **Threat & Potential Impact:** An account holder views or drains another customer's account by guessing or manipulating UUID parameters in HTTP paths.
2. **Relevant Attack Scenario:** Alice (`account_holder`) discovers Bob's account UUID and issues `GET /api/accounts/:id`, `GET /api/accounts/:id/statement`, or `POST /api/transfers` with Bob's account as `sourceAccountId`.
3. **Implemented Mitigation:**
   - Every protected route enforces `authenticateJWT` and extracts `req.user.id`.
   - `GET /api/accounts` filters rows strictly to `user_id = req.user.id`.
   - `GET /api/accounts/:id` and `GET /api/accounts/:id/statement` check `account.user_id === req.user.id`. If non-owned or unassigned, returns HTTP `403 Forbidden`.
   - `POST /api/transfers` locks the source account inside the transaction and enforces `sourceAccount.user_id === req.user.id`.
   - Auditors are strictly read-only; attempting any mutating transfer, reversal, or account creation returns HTTP `403 Forbidden`.
4. **Supporting Implementation or Test Evidence:**
   - [`backend/tests/rbac.test.js`](file:///d:/LedgerLine/backend/tests/rbac.test.js) &mdash; 26 tests verifying IDOR prevention across listing, inspection, transfers, and reversals.
5. **Remaining Limitations & Residual Risk:**
   Express middleware is the sole authorization authority. PostgreSQL `SECURITY DEFINER` functions enforce table invariants, but do not independently verify HTTP caller identity or JWT claims.

---

### 4.8 Role Escalation, Registration Restrictions & Live User Status
1. **Threat & Potential Impact:** An attacker registers with `role: 'admin'`, modifies their role in profile updates, or continues executing transactions using a valid JWT after administrative deactivation.
2. **Relevant Attack Scenario:**
   - An attacker submits `POST /api/auth/register` with `{ "username": "eve", "role": "admin" }`.
   - An employee dismissed for fraud continues using a JWT that has 24 hours of remaining validity.
3. **Implemented Mitigation:**
   - **Registration Role Protection:** Registration ignores any client-supplied `role` parameter; all registrations default strictly to `account_holder`.
   - **Stateless Minimal JWT:** Issued tokens contain only immutable identity claim `sub: user.id`. They do **not** bake dynamic roles or active status into the JWT payload.
   - **Dynamic Profile Resolution:** On every authenticated request, `authenticateJWT` queries `public.users` live. If the user no longer exists, it returns HTTP `401 Unauthorized`. If `is_active === false`, it immediately returns HTTP `403 Forbidden`.
   - Role demotions and account deactivations take effect immediately on the very next HTTP call.
4. **Supporting Implementation or Test Evidence:**
   - [`backend/tests/auth.test.js`](file:///d:/LedgerLine/backend/tests/auth.test.js) &mdash; Registration role escalation rejection, deactivated user rejection, dynamic database role reflection.
5. **Remaining Limitations & Residual Risk:**
   Querying `public.users` on every request introduces database load. In high-throughput production environments, this lookup requires an in-memory cache (e.g. Redis) with explicit cache eviction upon administrative mutation.

---

### 4.9 Password Handling, JWT Secrets & Frontend Token Storage
1. **Threat & Potential Impact:** Password database compromise, brute-force enumeration, token forgery via weak secrets, or persistent token theft via browser local storage.
2. **Relevant Attack Scenario:**
   - An attacker attempts timing attacks during login to enumerate registered email addresses.
   - An attacker extracts long-lived authentication tokens from browser `localStorage` via persistent XSS.
3. **Implemented Mitigation:**
   - **Bcrypt Work Factor 12:** Passwords hashed with `bcryptjs` using 12 salt rounds. Passwords require a minimum of 8 characters, at least 1 letter, and at least 1 number.
   - **Timing Mitigation (`dummyVerifyPassword`):** When an email is not found in `public.users`, `auth.js` runs `dummyVerifyPassword` against a precomputed work-factor-12 dummy hash, equalizing response latency and mitigating user enumeration.
   - **Token Storage Policy:** The React frontend stores JWT tokens in-memory in React state, with tab-scoped fallback to `sessionStorage` (`ledgerline_session_token`) to survive page reloads within an active tab. Persistent `localStorage` is intentionally avoided so tokens are wiped when the browser tab closes.
4. **Supporting Implementation or Test Evidence:**
   - [`backend/src/utils/password.js`](file:///d:/LedgerLine/backend/src/utils/password.js) &mdash; `hashPassword`, `verifyPassword`, `dummyVerifyPassword`.
   - [`frontend/src/api/client.js`](file:///d:/LedgerLine/frontend/src/api/client.js) &mdash; In-memory and `sessionStorage` token management.
5. **Remaining Limitations & Residual Risk:**
   Same-origin scripts running within the active tab lifecycle could access `sessionStorage` if an XSS vulnerability existed. Subresource integrity (SRI) and Content Security Policy (CSP) headers must be enforced in production deployments.

---

### 4.10 Refused-Attempt Audit Persistence Failures & Foreign-Key Safety
1. **Threat & Potential Impact:** Financial refusal auditing leaks database locks, fails on foreign-key errors, or silently conceals financial denial-of-service attempts.
2. **Relevant Attack Scenario:** An attacker repeatedly attempts transactions against nonexistent account UUIDs or with insufficient funds, hoping to crash the audit service.
3. **Implemented Mitigation:**
   - **Rollback-Release-Audit Ordering:** The financial transaction is explicitly rolled back (`ROLLBACK`) and its database client released to the pool *before* the refusal audit record is inserted on an independent connection.
   - **Foreign-Key Safety on 404s:** For nonexistent account UUIDs, `account_id` is set to `NULL` and the attempted UUID is preserved in `reason_message`, preventing foreign-key constraint violations on `audit_refused_attempts`.
   - **Transparency & Durability:** If audit insertion fails, the service returns HTTP 500 with `durableAudit: false`, emits structured critical `stderr` logs, and never retries the financial operation.
   - Table `audit_refused_attempts` is append-only and protected by trigger `trg_prevent_audit_mutation`.
4. **Supporting Implementation or Test Evidence:**
   - [`backend/tests/audit.test.js`](file:///d:/LedgerLine/backend/tests/audit.test.js) &mdash; 10 tests verifying action support, rollback ordering, 404 safety, and immutability triggers.
5. **Remaining Limitations & Residual Risk:**
   Anonymous (unauthenticated) 401 requests are not audited to prevent denial-of-service database flooding from unauthenticated attackers.

---

### 4.11 Cash Clearing Account Manipulation & Accounting Boundary
1. **Threat & Potential Impact:** Single-legged deposits or withdrawals create unbacked currency or break double-entry balance conservation.
2. **Relevant Attack Scenario:** An operator attempts to deposit funds into a customer account without debiting a counterparty account, creating unbacked money out of thin air.
3. **Implemented Mitigation:**
   - Dedicated internal clearing account: `SYSTEM_CASH_CLEARING` (`00000000-0000-0000-0000-000000000002`).
   - Cash deposits debit `SYSTEM_CASH_CLEARING` and credit the customer account.
   - Cash withdrawals debit the customer account and credit `SYSTEM_CASH_CLEARING`.
   - Deferred constraint trigger `trg_verify_transfer_balance` verifies that two balanced ledger entries (one debit, one credit) match the transfer amount before transaction commit.
   - `SYSTEM_CASH_CLEARING` is protected by `trg_prevent_account_ownership_reassignment` and cannot be owned by any user.
4. **Supporting Implementation or Test Evidence:**
   - [`backend/tests/deposits.test.js`](file:///d:/LedgerLine/backend/tests/deposits.test.js) (15 tests).
   - [`backend/tests/withdrawals.test.js`](file:///d:/LedgerLine/backend/tests/withdrawals.test.js) (16 tests).
5. **Remaining Limitations & Residual Risk:**
   `SYSTEM_CASH_CLEARING` is strictly an internal zero-sum accounting counter-account. It is not legal proof of physical currency, cash vaults, or central bank reserves.

---

### 4.12 Operational & Deployment Script Preflight Guards
1. **Threat & Potential Impact:** Accidental execution of tests or administrative scripts against a live production database, polluting or mutating real financial records.
2. **Relevant Attack Scenario:** An operator executes a verification script or test suite while their environment is configured to a production database.
3. **Implemented Mitigation (Verified Against Actual Scripts):**
   - **Test Connection Pool Isolation:** Backend test helpers ([`backend/tests/helpers/auth.js`](file:///d:/LedgerLine/backend/tests/helpers/auth.js)) explicitly specify `database: 'ledgerline_test'` for all test connections, preventing test fixtures from targeting the development database.
   - **Preflight Strict Pre-Connection Guard:** In [`backend/src/scripts/preflight_006.js`](file:///d:/LedgerLine/backend/src/scripts/preflight_006.js), lines 62–95 verify that `backend/.env` exists, audit all database configuration keys for conflicts with `process.env`, and enforce a strict pre-connection guard:
     ```javascript
     if (!targetDb || targetDb !== 'ledgerline_test') {
       console.error(`[FATAL GUARD] DB_NAME must be explicitly set to 'ledgerline_test'. Received: '${targetDb}'. Aborting without connecting.`);
       process.exit(1);
     }
     ```
   - **Forward-Only Migrations:** In [`backend/src/scripts/migrate.js`](file:///d:/LedgerLine/backend/src/scripts/migrate.js), migrations are applied in forward-only transactions recorded in `schema_migrations`; they contain zero `DROP TABLE` or `TRUNCATE` statements.
   - **Deployment Status:** Production deployment is currently **Pending Deployment**; no production databases are connected.
4. **Supporting Implementation or Test Evidence:**
   - [`backend/src/scripts/preflight_006.js`](file:///d:/LedgerLine/backend/src/scripts/preflight_006.js) lines 1–120.
   - [`backend/src/scripts/migrate.js`](file:///d:/LedgerLine/backend/src/scripts/migrate.js).
   - [`backend/tests/helpers/auth.js`](file:///d:/LedgerLine/backend/tests/helpers/auth.js).
5. **Remaining Limitations & Residual Risk:**
   The migration runner `migrate.js` connects to whatever `DB_NAME` is configured in `backend/.env` without a hardcoded database name guard. Operators must verify environment variables before running migrations on production hosts.

---

### 4.13 Trusted Application Boundary & Direct SQL Balance Access
1. **Threat & Potential Impact:** A script or direct SQL injection vulnerability executing directly as `ledgerline_app` runs `UPDATE accounts SET balance_paise = ...` without writing corresponding double-entry ledger entries.
2. **Architecture & Boundary Analysis:**
   - `ledgerline_app` requires column-level `UPDATE (balance_paise, updated_at, next_entry_sequence)` on `public.accounts` to process legitimate transfers, deposits, and withdrawals coordinated by the Express backend.
   - The deferred constraint trigger `trg_verify_transfer_balance` verifies that transfer records are balanced by ledger entries; it does not intercept direct `accounts` table balance updates if executed outside of a transfer.
3. **Implemented Mitigation & Trust Boundary:**
   - The **Express application is the authoritative boundary** responsible for coupling account balance mutations with immutable ledger entries inside atomic database transactions.
4. **Compensating Control:**
   - Discrepancies between stored balances and balances reconstructed from ledger entries can be detected by periodic audit reconciliation queries comparing `accounts.balance_paise` against $\sum (\text{credits} - \text{debits})$ from `ledger_entries`. Periodic reconciliation queries are a recommended operational control and are not currently implemented as an automated scheduled service.
5. **Remaining Limitations & Residual Risk:**
   Direct SQL updates executed outside the Express application bypass ledger coupling. Periodic reconciliation queries are a recommended operational control and are not currently implemented as an automated scheduled service; balance drift caused by rogue direct SQL access must be verified through manual or external batch operational queries.

---

## 5. STRIDE Threat Mapping Matrix

| Category | Component | Specific Risk | Implemented Mitigation | Residual Risk |
| :--- | :--- | :--- | :--- | :--- |
| **Spoofing** | Auth / HTTP | Token forgery or stolen credentials | Bcrypt work factor 12, timing mitigation, stateless Bearer JWT with live database validation | Token theft via active tab XSS before tab close |
| **Tampering** | Ledger / DB | Altering historical ledger rows or balances | Append-only triggers (`LL007`), deferred constraint balancing (`LL001`–`LL004`), least-privilege role grants | Direct balance updates outside Express require operational reconciliation (periodic reconciliation queries are a recommended operational control and are not currently implemented as an automated scheduled service) |
| **Repudiation** | Mutating APIs | Denying a transfer or withdrawal | Append-only `ledger_entries`, `audit_refused_attempts`, and unique idempotency keys | Refusals for anonymous 401s are unlogged |
| **Information Disclosure** | API / DB | Balance leakage or customer enumeration | Strict ownership isolation (IDOR checks), dummy bcrypt verification, `.gitignore` of `*.env` | Errors during development should be sanitized in production |
| **Denial of Service** | Transfers / Locking | Deadlocks or connection exhaustion | Deterministic lock ordering (`ORDER BY id ASC`), connection pool bounds (20), bounded idempotency retries | Complex multi-table foreign locks under extreme concurrent load |
| **Elevation of Privilege** | RBAC / Admin | Regular user escalating to admin | Registration role defaulting, advisory-locked admin functions, last-active-admin protection (`LL007`) | Compromised host system administrator |
