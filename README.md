# ⚖️ LedgerLine - Financial Ledger Application

LedgerLine is a financial ledger application built with Node.js, Express, PostgreSQL, and React with Vite.

---

## 🛠️ Technology Stack

| Layer | Technology | Details |
| :--- | :--- | :--- |
| **Frontend** | React 18, Vite | Single page application with `/api` dev proxy |
| **Backend** | Node.js (v22+), Express | RESTful API with Zod validation and centralized error handling |
| **Database** | PostgreSQL 18.6 | Relational database (`ledgerline_dev` on port 5432) |
| **Database Access** | `node-postgres` (`pg`) | Connection pool (`pg.Pool`) with parameterized SQL queries |
| **Validation** | Zod | Runtime schema validation for request payloads and environment variables |
| **Testing** | Jest, Supertest | Automated API integration and route testing |

---

## 📂 Project Structure

```text
LedgerLine/
├── .env.example              # Template for root/global environment variables
├── .gitignore                # Protects node_modules, .env secrets, logs, build outputs
├── package.json              # Root workspace scripts (dev, test, migrate, build)
├── README.md                 # Complete project documentation and guide
├── PROMPTS.md                # Development prompt history and architectural decisions
├── THREATS.md                # STRIDE threat model & financial risk mitigations
│
├── backend/                  # Node.js + Express backend service
│   ├── .env.example          # Backend-specific environment variables template
│   ├── jest.config.js        # Jest configuration for backend tests
│   ├── package.json          # Backend dependencies and scripts
│   ├── package-lock.json     # Locked dependency graph
│   ├── src/
│   │   ├── app.js            # Express application setup, middlewares, and route mounting
│   │   ├── server.js         # HTTP server entrypoint (listens on PORT)
│   │   ├── config/
│   │   │   ├── db.js         # PostgreSQL connection pool (pg.Pool) configuration
│   │   │   └── env.js        # Environment variable loader & Zod validation schema
│   │   ├── routes/
│   │   │   ├── health.js     # Health check endpoint (GET /api/health)
│   │   │   └── transfers.js  # Basic money transfer endpoint (POST /api/transfers)
│   │   └── scripts/
│   │       └── migrate.js    # Database migration runner script
│   └── tests/
│       ├── health.test.js                     # Supertest integration tests for health endpoints
│       ├── transfers.test.js                  # Supertest tests for basic money transfer endpoint
│       ├── concurrency.test.js                # Exploratory concurrent transfer test
│       ├── deterministic-concurrency.test.js  # Deterministic barrier synchronization race condition reproduction test
│       └── ledger.test.js                     # Phase 4 automated financial integrity & double-entry ledger tests
│
├── frontend/                 # React 18 + Vite frontend client
│   ├── .env.example          # Frontend-specific environment variables template
│   ├── index.html            # Vite HTML entry point
│   ├── package.json          # Frontend dependencies and scripts
│   ├── package-lock.json     # Locked dependency graph
│   ├── vite.config.js        # Vite configuration with /api reverse proxy to port 5000
│   └── src/
│       ├── main.jsx          # React DOM root render
│       ├── App.jsx           # Dashboard component with live health check card
│       └── index.css         # Modern typography and layout styling
│
└── database/                 # Database schema and migration management
    ├── README.md             # Migration documentation and conventions
    └── migrations/           # Versioned SQL migration scripts (.sql)
        ├── 001_create_accounts_and_transfers.sql
        ├── 002_create_ledger_entries_and_idempotency.sql
        └── 003_fix_verify_transfer_balance_uuid_aggregation.sql
```

---

## 🚀 Getting Started

### 1. Prerequisites
- **Node.js**: v20 or v22 installed (`node -v`)
- **PostgreSQL**: PostgreSQL 18.6 installed and running locally on port 5432
- **Database**: Database named `ledgerline_dev` created in PostgreSQL

### 2. Environment Configuration
Create `backend/.env` from the provided example template:

```powershell
Copy-Item backend\.env.example backend\.env
```

Open `backend\.env` and configure your credentials:
```env
PORT=5000
NODE_ENV=development

DB_HOST=localhost
DB_PORT=5432
DB_NAME=ledgerline_dev
DB_USER=postgres
DB_PASSWORD=your_actual_postgres_password_here

# Generate a secure 32+ character key: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
JWT_SECRET=replace_with_a_secure_random_jwt_secret_at_least_32_characters
JWT_EXPIRES_IN=24h
CLIENT_URL=http://localhost:5173
```

### 3. Fresh Database Provisioning & Migrations Setup Sequence

To set up a fresh database (e.g. `ledgerline_dev` or an isolated test database `ledgerline_test`) reliably:

1. **Create the Database (as postgres administrator):**
   ```sql
   CREATE DATABASE ledgerline_dev;
   ```
2. **Provision Roles & Schema Ownership (as postgres administrator in the database):**
   ```powershell
   psql -d ledgerline_dev -f database/provision_roles.sql
   ```
   *(Creates `ledgerline_owner` and `ledgerline_app`, assigns `public` schema ownership to `ledgerline_owner`, and revokes default public access).*
3. **Provision Role Passwords out-of-band (never committed to Git):**
   ```sql
   ALTER ROLE ledgerline_owner WITH PASSWORD 'your_owner_password_here';
   ALTER ROLE ledgerline_app WITH PASSWORD 'your_app_password_here';
   ```
4. **Run Database Migrations (as `ledgerline_owner`):**
   ```powershell
   npm run migrate:backend
   ```
   *(Executes migrations via `migrate.js` using `MIGRATION_DB_USER=ledgerline_owner`, creating tables and assigning runtime least-privilege grants to `ledgerline_app`).*
5. **Start Runtime Application (as `ledgerline_app`):**
   ```powershell
   npm run dev:backend
   ```

---

## 💻 Commands to Run the Project

### From Root Directory:

| Command | Action |
| :--- | :--- |
| `npm run dev:backend` | Starts the Express API server with live reload (`nodemon`) on port 5000 |
| `npm run dev:frontend` | Starts the Vite React dev server on port 5173 |
| `npm run test:backend` | Executes the Jest and Supertest test suite |
| `npm run migrate:backend` | Runs outstanding database migrations |
| `npm run build:frontend` | Compiles the production React bundle into `frontend/dist` |

---

## 📡 Verified API Endpoints

### 1. Health Check
* **Endpoint:** `GET /api/health`
* **Response Status:** `200 OK`
* **Response:**
  ```json
  {
    "status": "healthy",
    "service": "LedgerLine API",
    "environment": "development",
    "uptime": "4.2s",
    "timestamp": "2026-11-07T11:40:00.000Z",
    "database": { "status": "untested" }
  }
  ```

### 2. User Authentication (Phase 5 Step 1)

#### A. User Registration
* **Endpoint:** `POST /api/auth/register`
* **Access:** Public
* **Security Standards:** Passwords hashed with `bcryptjs` (work factor 12). Passwords must be at least 8 characters long and contain at least one letter and one number. Attempted role escalation is ignored or rejected; all registered users default strictly to `account_holder`.
* **Request Body:**
  ```json
  {
    "username": "alice",
    "email": "alice@example.com",
    "password": "SecurePassword123"
  }
  ```
* **Success Response (201 Created):**
  ```json
  {
    "message": "User registered successfully",
    "user": {
      "id": "e0eebc99-9c0b-4ef8-bb6d-6bb9bd380a01",
      "username": "alice",
      "email": "alice@example.com",
      "role": "account_holder",
      "isActive": true,
      "createdAt": "2026-11-08T14:00:00.000Z"
    }
  }
  ```
* **Error Responses:**
  * `400 Bad Request`: Validation failure (weak password, invalid email format, missing fields).
  * `409 Conflict`: Username or email already registered.

#### B. User Login
* **Endpoint:** `POST /api/auth/login`
* **Access:** Public
* **Timing Mitigation:** Unknown emails trigger dummy bcrypt verification (`dummyVerifyPassword`) against a precomputed work-factor-12 hash, reducing timing differences and helping mitigate email enumeration.
* **Stateless Minimal JWT:** Issued tokens contain only immutable identity claims (`sub: user.id`). Dynamic attributes (role, active status) are queried live from `public.users` on every authenticated request, ensuring immediate revocation upon role demotion or account deactivation.
* **Request Body:**
  ```json
  {
    "email": "alice@example.com",
    "password": "SecurePassword123"
  }
  ```
* **Success Response (200 OK):**
  ```json
  {
    "message": "Login successful",
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "id": "e0eebc99-9c0b-4ef8-bb6d-6bb9bd380a01",
      "username": "alice",
      "email": "alice@example.com",
      "role": "account_holder",
      "isActive": true
    }
  }
  ```
* **Error Responses:**
  * `401 Unauthorized`: Invalid email or password (safe, generic error message).

#### C. Current User Profile
* **Endpoint:** `GET /api/auth/me`
* **Access:** Private (`account_holder`, `admin`, `auditor`)
* **Headers:** `Authorization: Bearer <jwt-token>` (Mandatory)
* **Success Response (200 OK):** Returns the live database user profile. Deleted users are rejected with `401 Unauthorized` (`User no longer exists`), while deactivated users (`is_active = false`) are rejected with `403 Forbidden` (`User account is deactivated`).

---

### 3. Account Inspection & Provisioning (Phase 5 Step 2)

#### A. List Accounts
* **Endpoint:** `GET /api/accounts`
* **Access:** Private (`account_holder`, `admin`, `auditor`)
* **Headers:** `Authorization: Bearer <jwt-token>` (Mandatory)
* **Ownership Isolation:**
  * `account_holder`: Filters rows strictly to accounts assigned to their own user identity (`WHERE user_id = req.user.id AND account_type = 'customer'`). Accounts belonging to other users or unassigned accounts are never returned.
  * `admin` and `auditor`: Can inspect all system and customer accounts.

#### B. Inspect Single Account
* **Endpoint:** `GET /api/accounts/:id`
* **Access:** Private (`account_holder`, `admin`, `auditor`)
* **Headers:** `Authorization: Bearer <jwt-token>` (Mandatory)
* **Authorization Policy:**
  * `account_holder`: Can only view their own assigned account. Accessing an unassigned account or an account owned by another user returns `403 Forbidden`.
  * `admin` and `auditor`: Can view any account.
* **Error Responses:**
  * `400 Bad Request`: Malformed UUID parameter.
  * `403 Forbidden`: Access denied (account not owned by caller).
  * `404 Not Found`: Account does not exist.

#### C. Create Customer Account
* **Endpoint:** `POST /api/accounts`
* **Access:** Private (`admin` only)
* **Headers:** `Authorization: Bearer <jwt-token>` (Mandatory)
* **Least-Privilege Enforcement:** Created strictly unassigned (`user_id = NULL`) with zero initial balance (`balance_paise = 0`), complying with the runtime role's column-level grant: `INSERT (account_number)`.
* **Request Body:**
  ```json
  {
    "accountNumber": "ACC_CUSTOMER_1001"
  }
  ```
* **Success Response (201 Created):** Returns created account object.

---

### 4. Administrative Operations (Phase 5 Step 2)

All administrative endpoints require `admin` role and delegate invariant enforcement to transactional PostgreSQL administrative functions (`SECURITY DEFINER`):

#### A. Update User Role
* **Endpoint:** `PATCH /api/admin/users/:id/role`
* **Access:** Private (`admin` only)
* **Headers:** `Authorization: Bearer <jwt-token>` (Mandatory)
* **Function:** `public.admin_update_user_role(target_user_id, new_role)`
* **Last-Admin Protection:** Serialized via PostgreSQL advisory lock (`admin_membership_lock`). Rejects demoting the last active administrator with HTTP `422 Unprocessable Entity` (`LL007`).
* **Request Body:** `{ "role": "auditor" }`

#### B. Set User Active Status
* **Endpoint:** `PATCH /api/admin/users/:id/status`
* **Access:** Private (`admin` only)
* **Headers:** `Authorization: Bearer <jwt-token>` (Mandatory)
* **Function:** `public.admin_set_user_status(target_user_id, is_active)`
* **Last-Admin Protection:** Rejects deactivating the last active administrator with HTTP `422 Unprocessable Entity` (`LL007`).
* **Request Body:** `{ "isActive": false }`

#### C. Assign Account Owner
* **Endpoint:** `POST /api/admin/accounts/:id/owner`
* **Access:** Private (`admin` only)
* **Headers:** `Authorization: Bearer <jwt-token>` (Mandatory)
* **Function:** `public.admin_assign_account_owner(account_id, target_user_id)`
* **Invariants Enforced:**
  * Account ownership is **immutable once assigned** (reassigning returns `422`).
  * System equity accounts (`00000000-0000-0000-0000-000000000001`) cannot be assigned to user owners (returns `422`).
  * Target user must exist and be active (`is_active = true`, returns `422` if inactive).
  * Missing user or missing account returns HTTP `404 Not Found` (`P0002` / `LL002`).
* **Request Body:** `{ "userId": "e0eebc99-9c0b-4ef8-bb6d-6bb9bd380a01" }`

---

### 5. Money Transfers (Phase 4 Double-Entry, Idempotent & RBAC-Protected)
* **Endpoint:** `POST /api/transfers`
* **Access:** Private (`account_holder`, `admin`)
* **Headers:**
  * `Authorization: Bearer <jwt-token>` (Mandatory)
  * `Idempotency-Key: <unique-client-key>` (Mandatory)
* **Authorization Policy:**
  * `account_holder`: Enforced inside the database transaction after pessimistic row locking (`SELECT ... FOR UPDATE`). Verifies `sourceAccount.user_id === req.user.id`. Transferring out of unassigned accounts or accounts owned by other users returns `403 Forbidden`.
  * `admin`: Permitted to execute transfers between accounts.
  * `auditor`: Strictly read-only compliance role; blocked from initiating transfers (`403 Forbidden`).
* **Context:** In this example, the source account has an initial balance of 100,000 paise (₹1,000.00) and the destination account has an initial balance of 50,000 paise (₹500.00).
* **Request Body:**
  ```json
  {
    "sourceAccountId": "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
    "destinationAccountId": "b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a22",
    "amountPaise": 30000
  }
  ```
* **Success Response (201 Created):**
  ```json
  {
    "message": "Transfer completed successfully",
    "transfer": {
      "id": "c2eebc99-9c0b-4ef8-bb6d-6bb9bd380a33",
      "sourceAccountId": "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
      "destinationAccountId": "b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a22",
      "amountPaise": "30000",
      "status": "completed",
      "transferType": "customer_transfer",
      "createdAt": "2026-11-08T12:00:00.000Z"
    },
    "updatedBalances": {
      "sourceAccountId": "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
      "sourceBalancePaise": "70000",
      "destinationAccountId": "b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a22",
      "destinationBalancePaise": "80000"
    }
  }
  ```
* **Idempotent Replay Response (201 Created):**
  Returns identical body with HTTP response header `Idempotent-Replayed: true`.
* **Error Responses:**
  * `400 Bad Request`: Missing `Idempotency-Key` header or input validation failed.
  * `401 Unauthorized`: Missing, expired, or invalid Bearer token.
  * `403 Forbidden`: Account holder does not own the funding source account, or caller is an auditor.
  * `404 Not Found`: Source or destination account not found.
  * `409 Conflict`: Re-sending same idempotency key with conflicting request payload parameters.
  * `422 Unprocessable Entity`: Sender has insufficient funds (rolls back transaction and idempotency reservation, allowing retry with same key once funded).

### 6. Transfer Reversals (Phase 4 Compensating Ledger Reversal & RBAC-Protected)
* **Endpoint:** `POST /api/transfers/:id/reversal`
* **Access:** Private (`account_holder`, `admin`)
* **Headers:**
  * `Authorization: Bearer <jwt-token>` (Mandatory)
  * `Idempotency-Key: <unique-client-key>` (Mandatory)
* **Authorization Policy:**
  * A reversal debits funds from the original recipient and returns them to the original sender.
  * `account_holder`: Enforced inside the database transaction after pessimistic row locking. Verifies that the caller owns the *debited* account (`debitedAccount.user_id === req.user.id`). An account holder cannot unilaterally claw back money they previously sent to another user (`403 Forbidden`).
  * `admin`: Permitted to execute reversals.
  * `auditor`: Strictly read-only compliance role; blocked from initiating reversals (`403 Forbidden`).
* **Audit & Immutability Guarantee:** The original completed transfer record is **never modified or updated**. Instead, an explicit compensating transfer record (`transfer_type = 'reversal'`) and dual compensating ledger entries are created.
* **Reversal Lookup Pattern:** To verify whether a completed transfer has been reversed, applications and auditors query:
  ```sql
  SELECT * FROM transfers
  WHERE original_transfer_id = :originalTransferId
    AND transfer_type = 'reversal';
  ```
* **Request Body:**
  ```json
  {
    "reversalReason": "Customer dispute resolved"
  }
  ```
* **Success Response (201 Created):**
  ```json
  {
    "message": "Transfer reversed successfully",
    "reversal": {
      "id": "d3eebc99-9c0b-4ef8-bb6d-6bb9bd380a44",
      "originalTransferId": "c2eebc99-9c0b-4ef8-bb6d-6bb9bd380a33",
      "sourceAccountId": "b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a22",
      "destinationAccountId": "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
      "amountPaise": "30000",
      "status": "completed",
      "transferType": "reversal",
      "reversalReason": "Customer dispute resolved",
      "createdAt": "2026-11-08T12:05:00.000Z"
    },
    "restoredBalances": {
      "sourceAccountId": "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
      "sourceBalancePaise": "100000",
      "destinationAccountId": "b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a22",
      "destinationBalancePaise": "50000"
    }
  }
  ```
* **Error Responses:**
  * `400 Bad Request`: Missing `Idempotency-Key` header.
  * `401 Unauthorized`: Missing, expired, or invalid Bearer token.
  * `403 Forbidden`: Account holder does not own the debited destination account, or caller is an auditor.
  * `404 Not Found`: Original transfer not found.
  * `409 Conflict`: Transfer has already been reversed (enforced by partial unique index `idx_transfers_unique_reversal`).
  * `422 Unprocessable Entity`: Debited account has insufficient funds to reverse the transfer.

---

## 🔒 Database Roles & Security Architecture

### A. Database Roles (Least Privilege)
LedgerLine uses a simplified, least-privilege two-role architecture (`database/provision_roles.sql`):

1. **`ledgerline_owner` (Migration & Schema Owner):**
   - Owns the `public` schema and all tables (`users`, `accounts`, `transfers`, `ledger_entries`, `idempotency_keys`, `schema_migrations`).
   - Owns all `SECURITY DEFINER` administrative functions.
   - Used exclusively to run migrations (`npm run migrate:backend`) and initial admin bootstrap (`npm run seed:admin`).
   - Not used to handle normal application HTTP traffic.
2. **`ledgerline_app` (Restricted Runtime Application Role):**
   - Used by the Node.js Express server to handle application traffic.
   - **No Table Ownership:** Cannot alter schemas or disable database triggers.
   - **No Truncate Privileges:** Cannot truncate any financial tables.
   - **Strict Append-Only Enforcement:** Granted only `SELECT, INSERT` on `transfers` and `ledger_entries` (no UPDATE or DELETE privileges).
   - **Column-Level Privileges on Accounts:** Granted `SELECT`, column-level `INSERT (account_number)`, and column-level `UPDATE (balance_paise, updated_at, opening_balance_captured_at)`. Cannot directly alter account ownership (`user_id`).
   - **Column-Level Privileges on Users:** Granted `SELECT`, column-level `INSERT (username, email, password_hash)`, and column-level `UPDATE (password_hash, updated_at)`. Cannot directly alter user roles (`role`) or active status (`is_active`).
   - **Accounts Privileges & Trust Boundary:** The Express application coordinates balance updates and ledger entries within atomic transactions. Note that while the deferred database constraint trigger validates that ledger entries associated with transfer records are balanced, direct SQL balance updates are not blocked by an accounts-level trigger.
   - Attempted UPDATE or DELETE operations on ledger entries are blocked both by permission grants and by database triggers (`LL007`). There are no session-level backdoors.

### B. Application Identity & Access Roles (RBAC)
LedgerLine defines three distinct application roles stored in `public.users(role)`:
1. **`admin`:** Full administrative control. Can create unassigned customer accounts, assign account owners, update user roles, and activate/deactivate users via transactional `SECURITY DEFINER` functions. Can also initiate transfers and reversals across accounts. Protected against demoting or deactivating the last active administrator.
2. **`account_holder`:** Standard banking client. Can list and inspect only their own assigned accounts. Can transfer funds only from accounts they personally own. Can initiate reversals only when they own the debited account. Unassigned or non-owned account operations are rejected with `403 Forbidden`.
3. **`auditor`:** Compliance and audit officer. Strictly read-only access. Can list and inspect all accounts across the system, but is blocked from executing any mutating transfer, reversal, or account provisioning endpoint (`403 Forbidden`). (There is currently no user-inspection endpoint implemented).

---

## 🧪 Automated Testing

Automated tests are executed using **Jest** and **Supertest**:
```powershell
npm run test:backend
```

**Test Safety & Isolation:**
- Tests run against an isolated test database (e.g. `ledgerline_test`) and never against the development database (`ledgerline_dev`).
- Each test generates uniquely keyed account records (`TEST-SRC-...`, `CONC-SRC-...`, `DET-SRC-...`, `LEDGER-SRC-...`, `RBAC-...`).
- The database contains no test cleanup bypasses. Real application requests connect through `ledgerline_app`. Privileged fixtures strictly use `ownerPool` (`ledgerline_owner`) for test setup.

**Test Suites (66 automated tests across 7 suites):**
1. `tests/health.test.js` (3 tests): Health check endpoints and 404 routing.
2. `tests/transfers.test.js` (7 tests): Mandatory idempotency key validation, balance updates, debit/credit ledger verification, insufficient funds rejection, and input validations.
3. `tests/concurrency.test.js` (1 test): Live race condition test demonstrating overdraft prevention under concurrent requests.
4. `tests/deterministic-concurrency.test.js` (1 test): Deterministic concurrency test verifying that two distinct PostgreSQL clients execute competing account-lock queries, the second query is submitted before the first transaction is released, and the second client subsequently observes the updated balance.
5. `tests/ledger.test.js` (15 tests): Full double-entry balanced ledger verification, immutability triggers, opening balance zero-sum cutover, and compensating reversals.
6. `tests/auth.test.js` (13 tests): Authentication foundation, bcrypt work factor 12 hashing, timing-attack prevention, JWT issuance and verification, dynamic database role reflection, and user deactivation enforcement.
7. `tests/rbac.test.js` (26 tests): Account ownership isolation, IDOR prevention, auditor read-only restrictions, admin creation/assignment/role/status operations, last-active-admin protection, concurrent mutual demotion race protection, ownership immutability, and system equity protection.

---

## 🗺️ Roadmap
- [x] **Phase 1: Initial Foundation & Workspace Setup**
- [x] **Phase 2 Baseline: Initial Migration & Basic Money Transfer (Experiment 1)**
- [x] **Phase 2 Hardening & Phase 3: Concurrency Protection (`SELECT ... FOR UPDATE`), Row-Level Serialization & Regression Proof**
- [x] **Phase 4: Full Double-Entry Balanced Ledger Engine, Append-Only Triggers, Idempotency & Reversals**
- [x] **Phase 5: User Authentication & Role-Based Authorization**
- [ ] **Phase 6: Financial Reporting, Running Statements & UI Integration**
