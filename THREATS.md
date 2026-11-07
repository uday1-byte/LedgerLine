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
  - Store monetary values in PostgreSQL as `BIGINT` (representing minor currency units, e.g., integer cents) or `NUMERIC(18, 4)`.
  - Perform strict integer arithmetic in backend services or use dedicated arbitrary-precision libraries.

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
