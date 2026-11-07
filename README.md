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
│       └── deterministic-concurrency.test.js  # Deterministic barrier synchronization race condition reproduction test
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
        └── 001_create_accounts_and_transfers.sql
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

### 3. Run Database Migrations
Run the version-controlled migration script from the project root:
```powershell
npm run migrate:backend
```
*(Applies `001_create_accounts_and_transfers.sql` to set up `accounts`, `transfers`, and `schema_migrations`).*

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

### 2. Basic Money Transfers (Experiment 1 Baseline)
* **Endpoint:** `POST /api/transfers`
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
      "createdAt": "2026-11-07T11:40:00.000Z"
    },
    "updatedBalances": {
      "sourceAccountId": "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
      "sourceBalancePaise": "70000",
      "destinationAccountId": "b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a22",
      "destinationBalancePaise": "80000"
    }
  }
  ```
* **Error Responses:**
  * `400 Bad Request`: Input validation failed (negative amount, invalid UUID, same source/destination).
  * `404 Not Found`: Source or destination account not found.
  * `422 Unprocessable Entity`: Sender has insufficient funds.

---

## 🧪 Automated Testing

Automated tests are executed using **Jest** and **Supertest**:
```powershell
npm run test:backend
```

**Test Coverage Status (11 passing tests across 4 suites):**
- `tests/health.test.js` (3 tests):
  - `GET /` welcome payload (200)
  - `GET /api/health` system status (200)
  - `GET /api/unknown-route` 404 handler (404)
- `tests/transfers.test.js` (6 tests - with scoped account & transfer cleanup):
  - `POST /api/transfers` successful fund transfer & balance update (201)
  - `POST /api/transfers` rejection on insufficient funds (422)
  - `POST /api/transfers` non-existent source account (404)
  - `POST /api/transfers` non-existent destination account (404)
  - `POST /api/transfers` rejection on same source & destination (400)
  - `POST /api/transfers` rejection on non-positive amounts (400)
- `tests/concurrency.test.js` (1 test):
  - Exploratory concurrent transfer test launching two simultaneous requests of 80,000 paise against 100,000 paise available
- `tests/deterministic-concurrency.test.js` (1 test):
  - Deterministic barrier test confirming TOCTOU race condition (both transactions read 100,000 paise before either commits, reproducing source overdraft to -60,000 paise)

---

## ⚠️ Important Implementation Disclaimer

> **Baseline Notice:** The current transfer implementation represents **Experiment 1 (Initial Working Baseline)**. It verifies account existence, checks available balance, deducts from the sender, credits the receiver, and writes a transfer record inside a standard database transaction.
>
> However, it **does not yet provide production-grade financial guarantees**:
> - It does not implement pessimistic row locking (`FOR UPDATE`), making it susceptible to race conditions under concurrent requests.
> - It does not support idempotency keys (network retries could result in duplicate transfers).
> - It modifies balances directly rather than maintaining an immutable, append-only double-entry ledger.
> - Refused transfers roll back and do not record an audit trail.

---

## 🗺️ Roadmap
- [x] **Phase 1: Initial Foundation & Workspace Setup**
- [x] **Phase 2 Baseline: Initial Migration & Basic Money Transfer (Experiment 1)**
- [ ] **Phase 2 Hardening: Concurrency Protection (`SELECT ... FOR UPDATE`), Idempotency & Audit Trails**
- [ ] **Phase 3: User Authentication & Role-Based Authorization**
- [ ] **Phase 4: Full Double-Entry Balanced Ledger Engine**
- [ ] **Phase 5: Financial Reporting, Running Statements & UI Integration**
