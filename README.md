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

### 2. Money Transfers (Phase 4 Double-Entry & Idempotent)
* **Endpoint:** `POST /api/transfers`
* **Headers:** `Idempotency-Key: <unique-client-key>` (Mandatory)
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
      "transferType": "transfer",
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
  * `404 Not Found`: Source or destination account not found.
  * `409 Conflict`: Re-sending same idempotency key with conflicting request payload parameters.
  * `422 Unprocessable Entity`: Sender has insufficient funds (rolls back transaction and idempotency reservation, allowing retry with same key once funded).

### 3. Transfer Reversals (Phase 4 Compensating Ledger Reversal)
* **Endpoint:** `POST /api/transfers/:id/reversal`
* **Headers:** `Idempotency-Key: <unique-client-key>` (Mandatory)
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
  * `404 Not Found`: Original transfer not found.
  * `409 Conflict`: Transfer has already been reversed (enforced by partial unique index `idx_transfers_unique_reversal`).
  * `422 Unprocessable Entity`: Destination account has insufficient funds to reverse the transfer.

---

## 🔒 Database Roles & Security Architecture

LedgerLine uses a simplified, least-privilege two-role architecture (`database/provision_roles.sql`):

1. **`ledgerline_owner` (Migration & Schema Owner):**
   - Owns the `public` schema and all tables (`accounts`, `transfers`, `ledger_entries`, `idempotency_keys`, `schema_migrations`).
   - Used exclusively to run migrations (`npm run migrate:backend`).
   - Not used to handle normal application HTTP traffic.
2. **`ledgerline_app` (Restricted Application Role):**
   - Used by the Node.js Express server to handle application traffic.
   - **No Table Ownership:** Cannot alter schemas or disable database triggers.
   - **No Truncate Privileges:** Cannot truncate any financial tables.
   - **Strict Append-Only Enforcement:** Granted only `SELECT, INSERT` on `transfers` and `ledger_entries` (no UPDATE or DELETE privileges).
   - Attempted UPDATE or DELETE operations are blocked both by permission grants and by database triggers (`LL007`). There are no session-level backdoors.

---

## 🧪 Automated Testing

Automated tests are executed using **Jest** and **Supertest**:
```powershell
npm run test:backend
```

**Test Safety & Isolation:**
- Tests run against an isolated test database (e.g. `ledgerline_test`) and never against the development database (`ledgerline_dev`).
- Each test generates uniquely keyed account records (`TEST-SRC-...`, `CONC-SRC-...`, `DET-SRC-...`, `LEDGER-SRC-...`).
- The database contains no test cleanup bypasses. Between complete test suite runs, test databases are reset via test runner schema recreation or test-level truncation.

**Test Suites:**
- `tests/health.test.js`: Health check endpoints and 404 routing.
- `tests/transfers.test.js`: Mandatory idempotency key validation, balance updates, debit/credit ledger verification, insufficient funds rejection, and input validations.
- `tests/concurrency.test.js`: Concurrency transfer tests.
- `tests/deterministic-concurrency.test.js`: Barrier synchronization race condition tests proving pessimistic row-locking serialization.
- `tests/ledger.test.js`: 15 comprehensive automated financial integrity proofs:
  1. Exactly two ledger entries per transfer (1 debit, 1 credit).
  2. Debit and credit amounts equal transfer amount.
  3. Correct account references and running balances.
  4. Incomplete ledger transactions cannot commit (constraint trigger blocks).
  5. Unbalanced ledger transactions cannot commit (constraint trigger blocks).
  6. Direct `UPDATE` on `ledger_entries` rejected by immutability trigger (`LL007`).
  7. Direct `DELETE` on `ledger_entries` rejected by immutability trigger (`LL007`).
  8. Idempotent re-sending returns cached response with `Idempotent-Replayed: true`.
  9. Conflicting payloads with same idempotency key return HTTP 409 Conflict.
  10. Concurrent requests with same key create only one transfer.
  11. Compensating reversals restore balances and generate dual compensating ledger entries.
  12. Duplicate reversals rejected (partial unique index & business checks).
  13. Opening balances preserve customer balances and satisfy zero-sum equilibrium.
  14. Reversal rejected with HTTP 422 if recipient spent funds.
  15. Missing `Idempotency-Key` header rejected with HTTP 400.

---

## 🗺️ Roadmap
- [x] **Phase 1: Initial Foundation & Workspace Setup**
- [x] **Phase 2 Baseline: Initial Migration & Basic Money Transfer (Experiment 1)**
- [x] **Phase 2 Hardening & Phase 3: Concurrency Protection (`SELECT ... FOR UPDATE`), Row-Level Serialization & Regression Proof**
- [x] **Phase 4: Full Double-Entry Balanced Ledger Engine, Append-Only Triggers, Idempotency & Reversals**
- [ ] **Phase 5: User Authentication & Role-Based Authorization**
- [ ] **Phase 6: Financial Reporting, Running Statements & UI Integration**
