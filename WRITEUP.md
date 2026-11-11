# BalanceVault (formerly LedgerLine) — Technical Write-Up

This write-up summarizes the architectural decisions, financial invariants, security controls, production topology, and known boundaries of **BalanceVault** (repository root: `LedgerLine`). For endpoint request/response contracts see [`README.md`](file:///d:/LedgerLine/README.md); for the full STRIDE matrix and baseline TOCTOU reproduction evidence see [`THREATS.md`](file:///d:/LedgerLine/THREATS.md).

---

## 1. Architecture & Technology Choices

BalanceVault separates presentation, HTTP authorization, transactional financial execution, and schema governance across clear boundaries:

- **Frontend (`React 18`, `Vite 6`, `React Router 7`):** Thin SPA calling the Express API via [`frontend/src/api/client.js`](file:///d:/LedgerLine/frontend/src/api/client.js). Money parsing/formatting (`frontend/src/utils/currency.js`) operates exclusively on decimal strings and native `BigInt` paise—never floating-point `Number`.
- **Backend (`Node.js`, `Express 5`, `Zod 4`):** Separates Express configuration ([`backend/src/app.js`](file:///d:/LedgerLine/backend/src/app.js)) from socket startup ([`backend/src/server.js`](file:///d:/LedgerLine/backend/src/server.js)) so Supertest suites run cleanly without port conflicts. Express runs with `app.set('trust proxy', 1)` for Render edge proxy IP resolution.
- **Hybrid Data Access (`pg.Pool` + `Prisma ORM 6`):**
  - **Prisma (`ledgerline_app`)** handles ordinary account reads (`GET /api/accounts`, `GET /api/accounts/:id`) and readiness checks (`$queryRaw` `SELECT 1`), giving typed field selection and zero accidental write exposure.
  - **Raw parameterized SQL (`pg.Pool`)** handles all financial mutations, pessimistic row locks (`SELECT ... FOR UPDATE`), stored procedure calls (`admin_update_user_role`, `admin_set_user_status`, `admin_assign_account_owner`), statements, admin user-directory search, and refusal audit inserts. Choosing raw SQL over an ORM transaction abstraction guarantees explicit control over lock acquisition ordering, PostgreSQL error codes (`LL007`, `P0002`), `DEFERRABLE` constraint timing, and rollback-before-audit ordering.
- **Database Role Separation (`PostgreSQL 18.6`):** Two distinct roles ([`database/provision_roles.sql`](file:///d:/LedgerLine/database/provision_roles.sql)) separate schema ownership (`ledgerline_owner`, used only by `migrate.js` and `seed-admin.js`) from application traffic (`ledgerline_app`, restricted to least-privilege DML and column-level grants with zero `TRUNCATE`, `DDL`, or trigger-modification privileges).
- **Redis (`ioredis 5` + `rate-limit-redis`):** Provides cross-instance rate limiting for authentication (`authLimiter`) and financial mutations (`financialMutationLimiter`).

---

## 2. Financial Transaction Lifecycle

All four mutating financial endpoints (`POST /api/transfers`, `/deposit`, `/withdraw`, `/:id/reversal`) follow a defensive multi-stage pipeline in [`backend/src/routes/transfers.js`](file:///d:/LedgerLine/backend/src/routes/transfers.js):

1. **Authentication, RBAC & Rate Limiting:** `authenticateJWT` validates the Bearer token and loads live user state (`role`, `is_active`) from `public.users`; `requireRole('admin', 'account_holder')` blocks auditors (`403`); `financialMutationLimiter` enforces 30 req/min/user in Redis (failing closed `503` if Redis is unavailable).
2. **Header & Schema Validation:** Enforces non-empty `Idempotency-Key` (`400`) and Zod payload validation. Money inputs use `amountPaiseSchema`, accepting positive safe JavaScript integers or canonical `/^[1-9]\d*$/` strings and transforming directly to `BigInt` up to `PG_MAX_BIGINT` (`9223372036854775807n`). An earlier `parseInt` path on `/api/transfers` was replaced with `amountPaiseSchema` to preserve exact 64-bit integer precision above `Number.MAX_SAFE_INTEGER`.
3. **Scoped Idempotency Claim:** Opens a transaction and claims `(client_scope, key)` with a SHA-256 request hash before locking accounts.
4. **Canonical Row Locking & Authorization:** Locks participating rows via `SELECT ... FOR UPDATE` ordered deterministically by `ORDER BY id` (`ASC`), then verifies account existence (`404`), account type boundaries (`deposit`/`withdraw` require customer targets), and ownership (`account_holder` restricted to accounts where `user_id === req.user.id`).
5. **Conditional Balance Mutation + Ledger Writes:** Updates balances atomically, records the parent `transfers` row, writes balanced `debit`/`credit` `ledger_entries` rows with post-mutation `balance_after_paise`, marks `idempotency_keys.status = 'completed'`, and executes `COMMIT`.
6. **Commit-Time Balancing Check:** PostgreSQL evaluates deferred constraint triggers at `COMMIT`. On any error, `ROLLBACK` aborts all balance, transfer, ledger, and idempotency-key changes cleanly. For `/deposit` and `/withdraw`, business refusals follow a strict **rollback &rarr; release pool client &rarr; insert into `audit_refused_attempts` on an independent connection** flow via [`auditService.js`](file:///d:/LedgerLine/backend/src/services/auditService.js), returning HTTP `500` with `durableAudit: false` if audit persistence fails.

---

## 3. Double-Entry Accounting & Conservation

BalanceVault represents money exclusively in integer paise (`BIGINT` / `BigInt`) and enforces double-entry conservation at the database engine level (`database/migrations/002_create_ledger_entries_and_idempotency.sql`, `003`, `006`):

- **Zero-Sum System Counterparties:**
  - `SYSTEM_EQUITY_OPENING_BALANCE` (`00000000-0000-0000-0000-000000000001`): Offset customer opening balances during Migration `002` so total system balances started at exact zero ($\text{Equity} = -\sum \text{Customers}$).
  - `SYSTEM_CASH_CLEARING` (`00000000-0000-0000-0000-000000000002`): Acts as the internal counterparty for deposits (debit clearing, credit customer) and withdrawals (debit customer, credit clearing). Both system accounts are blocked from user ownership assignment (`LL007`).
- **Deferred Balance Verification (`LL001`–`LL004`):** `CONSTRAINT TRIGGER trg_verify_transfer_balance` (`DEFERRABLE INITIALLY DEFERRED`) checks on commit that every `transfers` row has **1 debit** and **1 credit** entry totaling the exact `amount_paise` against the matching `source_account_id` and `destination_account_id`. Partial or unbalanced writes cannot commit.
- **Append-Only Immutability:** `prevent_ledger_mutation()`, `prevent_transfer_mutation()`, and `trg_prevent_audit_mutation` unconditionally reject `UPDATE`/`DELETE` with SQLSTATE `LL007`, reinforced by missing `UPDATE`/`DELETE` privileges on `ledgerline_app`. Corrections use compensating `transfer_type = 'reversal'` transactions protected by partial unique index `idx_transfers_unique_reversal` (guaranteeing at most one reversal per original transfer) and recipient solvency checks.
- **Sequenced Cutover & Statements:** Migration `006` introduced per-account `next_entry_sequence` (`account_entry_sequence` on `/deposit` and `/withdraw`) and dual-regime ordering in `GET /api/accounts/:id/statement` (legacy/unsequenced entries ordered chronologically by `created_at ASC, id ASC`, followed by contiguous sequenced entries).

---

## 4. Concurrency & Overdraft Protection

Early baseline Experiment 2B empirically demonstrated that unlocked `SELECT` + `UPDATE balance_paise - $1` allowed two barrier-synchronized ₹800 transfers from a ₹1,000 balance to commit simultaneously, leaving `-60000` paise (`deterministic-concurrency.test.js`, preserved in `THREATS.md`).

Two controls eliminate this race:
1. **Deterministic Pessimistic Locking:** Participating rows are locked with `SELECT ... FROM accounts WHERE id IN ($1, $2) ORDER BY id FOR UPDATE`. Sorting by UUID guarantees both threads in an $A \leftrightarrow B$ or dual-transfer scenario acquire locks in identical canonical order, serializing concurrent debits against the same account and reducing circular deadlock probability between transfer pairs (though not claiming system-wide deadlock impossibility across arbitrary multi-table workloads).
2. **Conditional Debit Guard:** Deductions execute `UPDATE accounts SET balance_paise = balance_paise - $1 ... WHERE id = $2 AND balance_paise >= $1 RETURNING balance_paise`, aborting with HTTP `422` if `rowCount !== 1`. Reversals also acquire `pg_advisory_xact_lock` keyed to the original transfer UUID alongside account row locks so concurrent reversal attempts serialize safely before checking prior reversals or recipient solvency.

---

## 5. Idempotency

Mutating endpoints require an `Idempotency-Key` partitioned by `client_scope` (`account:<sourceAccountId>`, `deposit:<accountId>`, `withdraw:<accountId>`, `reversal:<originalTransferId>`) and compute a SHA-256 hash over canonical stringified business fields (including `amountPaise.toString()` so 1-paise differences above `Number.MAX_SAFE_INTEGER` are still distinguished):

- **Bounded Claim Loop (3 attempts):** Executes `INSERT INTO idempotency_keys ... ON CONFLICT DO NOTHING RETURNING key`.
- **Conflict Resolution:** If the key exists, the transaction locks it with `SELECT ... FOR UPDATE`:
  - Missing row after lock (meaning the prior holder rolled back, e.g., on `422` insufficient funds) triggers a clean `ROLLBACK` and retry of the claim loop so clients can fund an account and reuse the key.
  - Mismatched `request_hash` returns `409 IdempotencyConflictError`.
  - `'completed'` returns the stored `response_code` and `response_body` with header `Idempotent-Replayed: true`.
  - Still `'processing'` returns `409 ConcurrentRequestError`.
- **Client Retry Support:** On ambiguous failures (HTTP `0`, `502`–`504`, `409 ConcurrentRequestError`), [`TransfersPage.jsx`](file:///d:/LedgerLine/frontend/src/pages/TransfersPage.jsx) persists the exact key and payload in `sessionStorage` (`ledgerline_pending_mutation`) and renders `PendingOperationBanner` so retries are safe.

---

## 6. Authentication, Authorization & Threat Mitigation

- **Authentication:** `bcryptjs` (work factor `12`) for password hashing plus `dummyVerifyPassword` against a precomputed dummy hash on unknown emails to reduce login timing side channels. Registration forces `role = 'account_holder'` regardless of request body fields and validates password complexity (8+ chars, 1+ letter, 1+ number) using Zod v4 `issues`.
- **Live Session Validation:** JWTs store only `sub: user.id` (no cached role or status). `authenticateJWT` queries `public.users` on every request, enforcing live demotions (`PATCH /api/admin/users/:id/role`) and deactivations (`403` when `is_active === false`) immediately. Tokens live in React state with tab-scoped `sessionStorage` fallback (`localStorage` avoided).
- **RBAC & Admin Invariants:**
  - `account_holder`: restricted to owned customer accounts (`user_id = req.user.id`) for viewing, transfers, deposits, withdrawals, statements, and reversals of transfers crediting their account.
  - `auditor`: strictly read-only across accounts (`GET /api/accounts`, `GET /api/accounts/:id`) and statements (`GET /api/accounts/:id/statement`), blocked (`403`) from all money mutations and `/api/admin/*`.
  - `admin`: full user directory (`GET /api/admin/users`, safe fields only—never `password_hash`), zero-balance account creation (`POST /api/accounts`), immutable ownership assignment (`POST /api/admin/accounts/:id/owner`), and role/status updates backed by `SECURITY DEFINER` advisory-locked functions (`admin_bootstrap_seed`, `admin_update_user_role`, `admin_set_user_status`, `admin_assign_account_owner`) and immutability triggers (`LL007` preventing reassignment once owned and preventing demoting/deactivating the last active admin). First-admin bootstrap runs strictly offline via `seed-admin.js` (`ledgerline_owner`), never over HTTP.
- **Distributed Rate Limiting:** Production `NODE_ENV=production` validation (`backend/src/config/env.js`) blocks unsafe default `JWT_SECRET`s, non-`ledgerline_app` or non-TLS `DATABASE_URL`s, localhost `REDIS_URL`/`CLIENT_URL`, or `RATE_LIMIT_ENABLED=false`. Both `authLimiter` (in production) and `financialMutationLimiter` (in all active environments) fail closed with HTTP `503` if Redis is disconnected.

---

## 7. Testing Strategy & Verified Results

Verification spans database migrations, trigger enforcement, HTTP API contracts, simulated/real TCP concurrency barriers, Redis lifecycle, and headless DOM integration:

- **Backend (`Jest 30` + `Supertest` against isolated `ledgerline_test` DB):** **178 tests across 16 suites**:
  - Financial engine & concurrency: `transfers.test.js`, `deterministic-concurrency.test.js` (dual TCP clients synchronized at a row-lock barrier), `concurrency.test.js`, `ledger.test.js` (trigger `LL007` vs privilege `42501` separation, cutover conservation, reversals), `deposits.test.js`, `withdrawals.test.js`, `statements.test.js` (dual-regime ordering + filtering), `audit.test.js`.
  - Security & infra: `auth.test.js`, `rbac.test.js` (IDOR & admin user directory), `env.test.js`, `health.test.js`, `migrations.test.js`, `prisma.test.js`, `ratelimit.test.js`, `redis.test.js` (deterministic mock RESP server verifying `lazyConnect` readiness, disconnect recovery, and reconnection).
- **Frontend (`Vitest 5` + `JSDOM` + `React Testing Library`):** **120 tests across 10 files**:
  - `currency.test.js` (`BigInt` formatting/bounds), `apiClient.test.js`, `authContext.test.jsx`, `protectedRoute.test.jsx`, `authScreens.test.jsx`, `dashboard.test.jsx`, `transfers.test.jsx`, `statements.test.jsx`, `admin.test.jsx`, `auditor.test.jsx`.
- **Combined Local Baseline:** **298 automated tests (0 failures)** plus Vite production bundle (`frontend/dist/`).

---

## 8. Production Architecture & Deployment

BalanceVault is deployed via [`render.yaml`](file:///d:/LedgerLine/render.yaml):

- **Frontend Static Site (`balancevault-web`):** `https://balancevault-web-25xe.onrender.com` (React SPA on Render Static Site with `/*` &rarr; `/index.html` rewrite and `VITE_API_BASE_URL` pointing to `balancevault-api`).
- **Backend Web Service (`balancevault-api`):** `https://balancevault-api-7typ.onrender.com` (Node 22 Express API configured with Render health check `/api/health/live`).
- **Managed Backing Stores:** **Neon PostgreSQL** (`neondb`, migrations `001`–`006` applied as owner; runtime traffic on `ledgerline_app` with `sslmode=require`) and **Render Key Value Redis** (`REDIS_URL` with dual-stack `family: 0` resolution and eager `initializeRedis()` boot handshake).

**What is verified live vs. not yet verified live:**
- **Verified live on Render + Neon:** Database migrations and initial admin bootstrap, `/api/health/live`, `/api/health/ready` reporting `PostgreSQL`, `Prisma`, and `Redis` healthy, plus customer registration, login, and customer dashboard load.
- **Awaiting live end-to-end verification (and deploy of uncommitted changes):** Live financial mutations (`deposit`, `withdraw`, `transfer`, `reversal`, refusal-audit inspection) have not yet been executed in production, and the latest local changes (`GET /api/admin/users` + searchable `AdminPortalPage`, `/api/transfers` `BigInt` precision fix, and `BalanceVault` frontend UI rebranding) await commit/push/deploy.

---

## 9. Known Limitations & Future Improvements

1. **Unify Transfer & Reversal Sequencing / Refusal Auditing:** Update `POST /api/transfers` and `POST /api/transfers/:id/reversal` to increment `next_entry_sequence`, populate `account_entry_sequence` and `created_by_user_id`, and log refusals via `auditService.recordRefusalAudit`, matching `/deposit` and `/withdraw`.
2. **Frontend Reversal Workflow:** Add an authorized UI trigger/confirmation flow for `POST /api/transfers/:id/reversal` (currently API-only; `StatementTable.jsx` only renders completed reversal entries).
3. **Admin User-Directory Pagination & Caching:** Add `limit`/`offset` pagination to `GET /api/admin/users`, and consider short-TTL Redis caching (with explicit invalidation on role/status updates) for `authenticateJWT` user lookups under high concurrency.
4. **Redis Free-Tier Persistence:** Upgrade from ephemeral free-tier Redis if durable rate-limit counters and AOF persistence across restarts are required.
5. **Automated Reconciliation Service & Key Archival:** Schedule periodic verification comparing `accounts.balance_paise` against $\sum (\text{credits} - \text{debits})$ from `ledger_entries` (currently a manual/operational control), and archive aged `idempotency_keys`.
6. **CSP / SRI Hardening & Real Clearing Integrations:** Enforce strict Content Security Policy headers to protect tab-scoped `sessionStorage` tokens against XSS, and integrate external payment rails if moving beyond an internal core ledger.
