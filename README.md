# ⚖️ BalanceVault — Financial Ledger Application

**BalanceVault** (repository root: `LedgerLine`) is a full-stack, double-entry financial ledger and banking client application built with **Node.js**, **Express**, **PostgreSQL 18.6**, **Prisma ORM**, **Redis**, and **React 18** with **Vite 6**.

It demonstrates core financial engineering principles: exact integer arithmetic (paise), concurrency-safe transaction serialization, append-only immutable ledgers, deferred constraint balancing, cryptographic idempotency, distributed fail-closed Redis rate limiting, least-privilege database role separation, role-based access control (RBAC), and automated refusal auditing.

> [!NOTE]
> **Verification & Production Preparation Status:** All database migrations (`001`–`006`), backend APIs, Prisma read paths, Redis-backed rate limiters, frontend client interfaces, and automated test suites (**278 automated tests: 161 backend across 15 Jest suites, 117 frontend across 10 Vitest files**) plus the Vite production build pass locally. Neon production migrations (`001`–`006`) and initial production administrator bootstrap are completed and verified; Render deployment requires provisioning a hosted Redis instance (`REDIS_URL`) and setting production environment variables via [`render.yaml`](file:///d:/LedgerLine/render.yaml).

---

## 🛠️ Technology Stack

| Layer | Technology | Version / Specification | Details |
| :--- | :--- | :--- | :--- |
| **Frontend Framework** | React | `^18.3.1` | Single Page Application (SPA) with declarative hooks and Context API |
| **Frontend Tooling** | Vite | `^6.2.0` (installed `6.4.5`) | ESM bundler with `VITE_API_BASE_URL` production routing and `/api` dev proxy |
| **Routing** | React Router DOM | `^7.18.5` | Client-side routing, protected navigation guards, and history synchronization |
| **Frontend Testing** | Vitest, JSDOM, RTL | Vitest `^5.1.0`, RTL `^16.3.3` | Headless unit and component integration tests (117 tests across 10 files) |
| **DOM Assertions** | Jest-DOM | `@testing-library/jest-dom ^7.0.1` | Custom matchers for accessible DOM element state assertions |
| **Backend Runtime** | Node.js | v22.19.0 LTS (supports v20+) | Asynchronous I/O runtime with graceful HTTP/Prisma/Redis shutdown |
| **Backend Framework** | Express | `^5.3.0` | Modular RESTful API architecture with `trust proxy` enabled for Render |
| **Validation** | Zod | `^4.6.7` | Strict runtime request payload and production environment validation |
| **Authentication** | JWT & bcryptjs | `jsonwebtoken ^9.0.3`, `bcryptjs ^3.0.3` | Stateless Bearer JWTs; bcrypt with work factor 12 and timing mitigation |
| **Database** | PostgreSQL | 18.6 (Neon in production) | Relational database with stored procedures, triggers, and row-level locking |
| **Database Access** | `pg` & Prisma ORM | `pg ^8.23.1`, `@prisma/client ^6.4.0` | `pg.Pool` raw SQL for financial mutations; Prisma (`ledgerline_app`) for ordinary reads |
| **Rate Limiting & Cache** | Redis & Rate Limiter | `ioredis ^5.6.0`, `express-rate-limit ^8.7.4`, `rate-limit-redis ^6.0.2` | Distributed IP/user rate limiting failing closed (`503`) in production |
| **Backend Testing** | Jest, Supertest | Jest `^30.5.2`, Supertest `^7.3.1` | API, Prisma, Redis, health, and concurrency tests (161 tests across 15 suites) |

---

## 📂 Repository Structure

```text
LedgerLine/
├── .env.example                               # Root template for global environment variables
├── .gitignore                                 # Git rules ignoring node_modules, *.env, logs, and build artifacts
├── package.json                               # Root workspace orchestrator scripts (dev, build, test, migrate)
├── render.yaml                                # Render Blueprint (Backend Web Service + Frontend Static Site + SPA rewrite)
├── README.md                                  # Complete architecture, operations, deployment, and API documentation
├── THREATS.md                                 # STRIDE threat model, empirical vulnerability findings, and mitigations
├── PROMPTS.md                                 # AI-assisted engineering log, prompts, error analyses, and commit references
│
├── backend/                                   # Express REST API service (BalanceVault API)
│   ├── .env.example                           # Backend configuration template (runtime, Prisma, Redis, owner roles)
│   ├── jest.config.js                         # Jest test runner configuration
│   ├── package.json                           # Backend dependencies and scripts (includes build, postinstall, prisma:generate)
│   ├── package-lock.json                      # Locked backend dependency graph
│   ├── prisma/
│   │   └── schema.prisma                      # Introspected Prisma schema matching PostgreSQL migrations 001–006
│   ├── src/
│   │   ├── app.js                             # Express setup, trust proxy, CORS, security middleware, and routes
│   │   ├── server.js                          # HTTP entry point with graceful shutdown (HTTP, Prisma, Redis)
│   │   ├── config/
│   │   │   ├── db.js                          # PostgreSQL connection pool (pg.Pool) with production TLS enforcement
│   │   │   ├── env.js                         # Zod-validated configuration with strict production fail-fast checks
│   │   │   ├── prisma.js                      # Prisma Client singleton configured with DATABASE_URL (ledgerline_app)
│   │   │   └── redis.js                       # ioredis client manager with health ping and graceful close
│   │   ├── middleware/
│   │   │   ├── auth.js                        # JWT verification, RBAC enforcement, and ownership guards
│   │   │   └── rateLimiter.js                 # Distributed Redis rate limiters (auth IP & financial user limits)
│   │   ├── routes/
│   │   │   ├── accounts.js                    # Account listing/inspection (Prisma reads) & creation
│   │   │   ├── admin.js                       # User role/status governance and account ownership assignment
│   │   │   ├── auth.js                        # User registration, login (rate-limited), and profile (/api/auth/me)
│   │   │   ├── health.js                      # Liveness (/api/health/live) & readiness (/api/health/ready, /api/health) probes
│   │   │   └── transfers.js                   # Rate-limited transfers, reversals, cash deposits, and withdrawals (raw SQL)
│   │   ├── scripts/
│   │   │   ├── migrate.js                     # Forward-only database migration runner (ledgerline_owner)
│   │   │   ├── preflight_006.js               # Phase 6 read-only schema preflight validator
│   │   │   └── seed-admin.js                  # One-time first-admin bootstrap CLI (advisory lock)
│   │   ├── services/
│   │   │   └── auditService.js                # Refused-attempt audit logging service
│   │   └── utils/
│   │       ├── jwt.js                         # JWT signing and verification helpers
│   │       └── password.js                    # Bcrypt hashing (work factor 12) and dummy timing mitigation
│   └── tests/
│       ├── helpers/
│       │   └── auth.js                        # Test user and account provisioning helpers (using ownerPool)
│       ├── audit.test.js                      # Refusal audit service tests
│       ├── auth.test.js                       # Password policy, bcrypt, and JWT auth tests
│       ├── concurrency.test.js                # Exploratory concurrent transfer test
│       ├── deposits.test.js                   # Cash deposits and double-entry clearing tests
│       ├── deterministic-concurrency.test.js  # Barrier-synchronized concurrency regression test
│       ├── env.test.js                        # Environment validation & production security invariant tests
│       ├── health.test.js                     # Liveness & readiness health probe tests
│       ├── ledger.test.js                     # Double-entry ledger, immutability, and reversal tests
│       ├── migrations.test.js                 # Migration & schema verification tests
│       ├── prisma.test.js                     # Prisma model mapping & restricted role read tests
│       ├── ratelimit.test.js                  # Redis rate limiting & fail-closed 503 behavior tests
│       ├── rbac.test.js                       # Role-based access control and IDOR prevention tests
│       ├── statements.test.js                 # Statement dual-regime ordering and pagination tests
│       ├── transfers.test.js                  # Transfer business logic and idempotency tests
│       └── withdrawals.test.js                # Cash withdrawals, solvency, and range tests
│
├── frontend/                                  # React 18 + Vite 6 client application
│   ├── .env.example                           # Frontend environment configuration template
│   ├── index.html                             # Single page HTML entry point
│   ├── package.json                           # Frontend dependencies (React, React Router, Vitest)
│   ├── package-lock.json                      # Locked frontend dependency graph
│   ├── vite.config.js                         # Vite build configuration, dev proxy, and Vitest setup
│   └── src/
│       ├── main.jsx                           # React DOM root render
│       ├── App.jsx                            # Main application layout, client router, and protected routes
│       ├── index.css                          # Accessible CSS styling, layout utilities, and print format
│       ├── api/
│       │   └── client.js                      # Centralized API fetch wrapper, token handling, error classifier
│       ├── context/
│       │   └── AuthContext.jsx                # React Authentication context, session management, and logout
│       ├── components/
│       │   ├── admin/                         # CreateAccountModal, AssignOwnerModal, UserGovernanceForm, tables
│       │   ├── auditor/                       # AuditorOverviewCard, AuditorAccountsTable
│       │   ├── common/                        # Alert, ProtectedRoute
│       │   ├── dashboard/                     # AccountCard, AccountSummary, EmptyAccountState
│       │   ├── layout/                        # Navbar
│       │   ├── statements/                    # StatementFilterBar, StatementTable, RefusedAttemptsTable, pagination
│       │   └── transfers/                     # TransferForm, DepositForm, WithdrawForm, ConfirmationModal, Receipt
│       ├── pages/
│       │   ├── AdminPortalPage.jsx            # Account creation, user role governance, status management
│       │   ├── AuditorPortalPage.jsx          # Read-only ledger registry, balance cards, direct statement links
│       │   ├── DashboardPage.jsx              # Customer account cards, balance overview, empty states
│       │   ├── LoginPage.jsx                  # Authentication form with error handling and redirect to origin
│       │   ├── RegisterPage.jsx               # Registration form enforcing password complexity rules
│       │   ├── StatementsPage.jsx             # Account statement explorer, filters, totals, pagination, print view
│       │   └── TransfersPage.jsx              # Transfer, deposit, and withdrawal forms, review modal, receipt
│       ├── utils/
│       │   ├── currency.js                    # BigInt paise string parsing and Indian Rupee formatting
│       │   └── date.js                        # ISO 8601 formatting and explicit UTC/local date range bounding
│       └── test/
│           ├── setup.js                       # Vitest DOM environment setup and test cleanup
│           ├── admin.test.jsx                 # Admin portal integration tests
│           ├── apiClient.test.js              # Centralized API client tests
│           ├── auditor.test.jsx               # Auditor read-only portal tests
│           ├── authContext.test.jsx           # Auth context and session lifecycle tests
│           ├── authScreens.test.jsx           # Login and Register form tests
│           ├── currency.test.js               # BigInt currency parsing and formatting tests
│           ├── dashboard.test.jsx             # Dashboard account cards and summary tests
│           ├── protectedRoute.test.jsx        # ProtectedRoute client authorization tests
│           ├── statements.test.jsx            # Statement filter, pagination, and print tests
│           └── transfers.test.jsx             # Transfer, deposit, and withdrawal UI tests
│
└── database/                                  # Database schema migrations and provisioning scripts
    ├── README.md                              # Migration conventions and execution instructions
    ├── provision_roles.sql                    # SQL script provisioning ledgerline_owner and ledgerline_app roles
    └── migrations/                            # Forward-only SQL migrations
        ├── 001_create_accounts_and_transfers.sql
        ├── 002_create_ledger_entries_and_idempotency.sql
        ├── 003_fix_verify_transfer_balance_uuid_aggregation.sql
        ├── 004_create_users_and_authentication.sql
        ├── 005_fix_admin_function_column_ambiguity.sql
        └── 006_complete_banking_functionality.sql
```

---

## 🚀 Getting Started

### 1. Prerequisites
- **Node.js**: v20 or v22 LTS installed (`node -v`)
- **PostgreSQL**: PostgreSQL 18.6 installed and running locally on port 5432
- **PostgreSQL Client Tools**: `psql` available in system path
- **Operating System Shell**: Standard Bash, Zsh, or Windows PowerShell

### 2. Environment Configuration
Copy the provided environment example templates:

```bash
# In the repository root
cp .env.example .env
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

*(On Windows PowerShell, use `Copy-Item .env.example .env`, `Copy-Item backend\.env.example backend\.env`, and `Copy-Item frontend\.env.example frontend\.env`).*

Configure `backend/.env` with your local PostgreSQL credentials:
```env
PORT=5000
NODE_ENV=development

DB_HOST=localhost
DB_PORT=5432
DB_NAME=ledgerline_dev

# Runtime Application User (used by Node.js server)
DB_USER=ledgerline_app
DB_PASSWORD=your_secure_app_password

# Migration Runner Role (used by migrate.js to execute DDL as schema owner)
MIGRATION_DB_USER=ledgerline_owner
MIGRATION_DB_PASSWORD=your_secure_owner_password

# Authentication & Security
# Generate a secure 32+ character key: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
JWT_SECRET=replace_with_a_secure_random_jwt_secret_at_least_32_characters
JWT_EXPIRES_IN=24h

# Admin Bootstrap CLI (used by npm run seed:admin)
ADMIN_USERNAME=admin
ADMIN_EMAIL=admin@ledgerline.internal
ADMIN_PASSWORD=your_secure_admin_password_here

# Client Application URL (For CORS configuration)
CLIENT_URL=http://localhost:5173
```

### 3. Database Provisioning & Schema Migrations

Follow this exact sequence to set up a clean, role-separated PostgreSQL database:

1. **Create the Database (as postgres administrator):**
   ```sql
   CREATE DATABASE ledgerline_dev;
   ```
2. **Provision Roles & Schema Ownership (as postgres administrator in the database):**
   ```bash
   psql -d ledgerline_dev -f database/provision_roles.sql
   ```
   *Creates `ledgerline_owner` and `ledgerline_app`, assigns `public` schema ownership to `ledgerline_owner`, and revokes default public access.*
3. **Set Role Passwords out-of-band (never committed to Git):**
   ```sql
   ALTER ROLE ledgerline_owner WITH PASSWORD 'your_secure_owner_password';
   ALTER ROLE ledgerline_app WITH PASSWORD 'your_secure_app_password';
   ```
4. **Execute Database Migrations (as `ledgerline_owner`):**
   ```bash
   npm run migrate:backend
   ```
   *Runs migrations 001 through 006, creating tables, triggers, and indices, and assigns least-privilege grants to `ledgerline_app`.*
5. **Bootstrap Initial Administrator User:**
   ```bash
   npm --prefix backend run seed:admin
   ```
   *Connects strictly as `ledgerline_owner` using advisory lock `seed_admin_bootstrap` to create the initial admin user specified in `backend/.env`.*

---

## 💻 Commands Reference

### Root Directory Commands

| Command | Action |
| :--- | :--- |
| `npm run dev:backend` | Starts Express backend server with `nodemon` live-reload on port 5000 |
| `npm run dev:frontend` | Starts Vite React frontend development server on port 5173 |
| `npm run start:backend` | Starts Express backend server in production mode |
| `npm run migrate:backend` | Runs outstanding database migrations as `ledgerline_owner` |
| `npm run test:backend` | Runs the complete Jest backend test suite (161 tests across 15 suites) |
| `npm run build:frontend` | Compiles production React bundle into `frontend/dist/` |

### Frontend-Specific Commands

```bash
# Run the complete Vitest frontend test suite (117 tests across 10 files)
npm --prefix frontend test -- --run

# Run Vitest in interactive watch mode
npm --prefix frontend test

# Run frontend production build
npm --prefix frontend run build

# Preview frontend production build locally
npm --prefix frontend run preview
```

---

## 🏛️ Frontend Client Architecture & Routes

The client is a responsive Single Page Application (SPA) built with React 18, React Router DOM 7, and vanilla CSS. It implements eight distinct routes governed by [`ProtectedRoute`](file:///d:/LedgerLine/frontend/src/components/common/ProtectedRoute.jsx):

```text
/                       -> HomePage (renders DashboardPage if authenticated; welcome page if guest)
/login                  -> LoginPage (email/password authentication with error alerts)
/register               -> RegisterPage (account creation enforcing password complexity)
/dashboard              -> DashboardPage (customer accounts, balance overview, empty states)
/transfers              -> TransfersPage (customer transfers, cash deposits, cash withdrawals)
/statements             -> StatementsPage (statement explorer, filters, totals, pagination, print view)
/admin                  -> AdminPortalPage (account creation, ownership assignment, role/status governance)
/auditor                -> AuditorPortalPage (read-only ledger overview, account registry, direct statement links)
*                       -> NotFoundPage (404 catch-all)
```

### Key Client Features:
1. **Centralized API Client ([`frontend/src/api/client.js`](file:///d:/LedgerLine/frontend/src/api/client.js)):** Resolves `VITE_API_BASE_URL` when configured for standalone production hosting while falling back to relative `/api/...` paths for the Vite local dev proxy. Automatically attaches Bearer tokens, intercepts 401s to clear session state, and classifies errors into *Definitive Business Errors* (400, 401, 403, 404, 422, 409 Conflict) and *Ambiguous Network Outcomes* (HTTP 0, 502–504, 409 ConcurrentRequestError).
2. **In-Memory & Tab-Scoped Session Storage:** Tokens are held in React state with an optional fallback to `sessionStorage` (`ledgerline_session_token`) to survive page reloads within the tab. Persistent `localStorage` is intentionally avoided.
3. **Idempotency Lifecycle & Pending Banner:** When a financial mutation experiences an ambiguous network failure, the client preserves the exact `idempotencyKey` and payload in `sessionStorage` and surfaces [`PendingOperationBanner`](file:///d:/LedgerLine/frontend/src/components/transfers/PendingOperationBanner.jsx). Retrying re-sends the identical key, preventing double-execution.
4. **Timezone-Explicit Statement Filtering:** Statements support explicit UTC bounding (`00:00:00.000Z` to `23:59:59.999Z`) or browser LOCAL timezone bounding with exact ISO offset conversion in [`frontend/src/utils/date.js`](file:///d:/LedgerLine/frontend/src/utils/date.js).

---

## 📡 Implemented API Endpoints (Specifications & Contracts)

### 1. Health & Readiness Probes
* **`GET /api/health/live`**
  * **Access:** Public
  * **Description:** Dependency-free liveness probe confirming the Express process is alive and accepting HTTP requests (configured as Render's `healthCheckPath`). Never queries PostgreSQL or Redis.
  * **Response (200 OK):**
    ```json
    {
      "status": "healthy",
      "service": "BalanceVault API",
      "probe": "liveness",
      "environment": "production",
      "uptime": "12.4s",
      "timestamp": "2026-11-11T17:00:00.000Z"
    }
    ```
* **`GET /api/health/ready`**
  * **Access:** Public
  * **Description:** Strict readiness probe verifying both PostgreSQL (`pg.Pool` + `prisma.$queryRaw`) and Redis (`PING`) connectivity before routing production traffic.
  * **Response (200 OK):**
    ```json
    {
      "status": "healthy",
      "service": "BalanceVault API",
      "probe": "readiness",
      "environment": "production",
      "uptime": "12.4s",
      "timestamp": "2026-11-11T17:00:00.000Z",
      "dependencies": {
        "database": {
          "status": "connected",
          "details": { "database": "neondb", "prisma": "connected" }
        },
        "redis": {
          "status": "connected",
          "details": { "status": "ready" }
        }
      }
    }
    ```
  * **Error Response (503 Service Unavailable):** Returned when PostgreSQL, Prisma, or Redis is unreachable (`status: "degraded"`).
* **`GET /api/health`**
  * **Access:** Public
  * **Description:** Backward-compatible health endpoint running the same PostgreSQL (`pg` + Prisma) and Redis dependency probe (`probe: "compatibility"`, returning `200` when healthy or `503` when degraded).

### 2. User Authentication
* **`POST /api/auth/register`**
  * **Access:** Public
  * **Rules:** Enforces minimum 8 characters, at least 1 letter, and at least 1 number. Ignores or rejects role escalation attempts; defaults strictly to `account_holder`. Passwords hashed with `bcryptjs` (work factor 12).
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
        "createdAt": "2026-11-09T08:05:00.000Z"
      }
    }
    ```
  * **Error Responses:**
    * `400 Bad Request`: Payload validation error (password failing complexity, invalid email).
    * `409 Conflict`: Username or email already registered.
* **`POST /api/auth/login`**
  * **Access:** Public
  * **Security:** Employs `dummyVerifyPassword` against a precomputed work-factor-12 hash for unknown emails to reduce timing discrepancy and mitigate user enumeration. Returns Bearer JWT with `sub: user.id`.
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
    * `400 Bad Request`: Missing email or password.
    * `401 Unauthorized`: Invalid credentials (safe, generic error message).
* **`GET /api/auth/me`**
  * **Access:** Private (`account_holder`, `admin`, `auditor`)
  * **Headers:** `Authorization: Bearer <jwt-token>` (Mandatory)
  * **Description:** Queries live user attributes from `public.users`. Immediately reflects database role demotion or deactivation.
  * **Error Responses:**
    * `401 Unauthorized`: Token missing, expired, or user deleted from database.
    * `403 Forbidden`: User account deactivated (`is_active = false`).

### 3. Account Inspection & Creation
* **`GET /api/accounts`**
  * **Access:** Private (`account_holder`, `admin`, `auditor`)
  * **Policy:** Account holders see only their assigned accounts (`user_id = req.user.id`). Admins and auditors see all accounts. System accounts are omitted by default unless `include_system=true` is passed by an admin or auditor.
  * **Success Response (200 OK):**
    ```json
    {
      "accounts": [
        {
          "id": "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
          "account_number": "ACC-CUSTOMER-1001",
          "balance_paise": "100000",
          "account_type": "customer",
          "user_id": "e0eebc99-9c0b-4ef8-bb6d-6bb9bd380a01",
          "created_at": "2026-11-09T08:10:00.000Z"
        }
      ]
    }
    ```
* **`GET /api/accounts/:id`**
  * **Access:** Private (`account_holder`, `admin`, `auditor`)
  * **Policy:** Account holders can only inspect accounts they own.
  * **Error Responses:**
    * `400 Bad Request`: Malformed UUID parameter.
    * `403 Forbidden`: Account not owned by requesting account holder.
    * `404 Not Found`: Account does not exist.
* **`POST /api/accounts`**
  * **Access:** Private (`admin` only)
  * **Request Body:**
    ```json
    {
      "accountNumber": "ACC-CUSTOMER-1002"
    }
    ```
  * **Success Response (201 Created):**
    ```json
    {
      "message": "Account created successfully",
      "account": {
        "id": "b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a22",
        "account_number": "ACC-CUSTOMER-1002",
        "balance_paise": "0",
        "account_type": "customer",
        "user_id": null
      }
    }
    ```
  * **Error Responses:**
    * `400 Bad Request`: Invalid or missing `accountNumber`.
    * `403 Forbidden`: Non-admin caller.
    * `409 Conflict`: Account number already exists.

### 4. Administrative Operations
All administrative endpoints require `admin` role and delegate invariant enforcement to transactional PostgreSQL `SECURITY DEFINER` functions:
* **`PATCH /api/admin/users/:id/role`**
  * **Access:** Private (`admin` only)
  * **Request Body:** `{ "role": "auditor" }`
  * **Success Response (200 OK):**
    ```json
    {
      "message": "User role updated successfully",
      "user": {
        "id": "e0eebc99-9c0b-4ef8-bb6d-6bb9bd380a01",
        "role": "auditor"
      }
    }
    ```
  * **Error Responses:**
    * `400 Bad Request`: Invalid role value or malformed user UUID.
    * `404 Not Found`: User does not exist.
    * `422 Unprocessable Entity`: Demoting the last active administrator rejected (`LL007`).
* **`PATCH /api/admin/users/:id/status`**
  * **Access:** Private (`admin` only)
  * **Request Body:** `{ "isActive": false }`
  * **Success Response (200 OK):**
    ```json
    {
      "message": "User status updated successfully",
      "user": {
        "id": "e0eebc99-9c0b-4ef8-bb6d-6bb9bd380a01",
        "isActive": false
      }
    }
    ```
  * **Error Responses:**
    * `400 Bad Request`: Missing or non-boolean `isActive`.
    * `404 Not Found`: User does not exist.
    * `422 Unprocessable Entity`: Deactivating the last active administrator rejected (`LL007`).
* **`POST /api/admin/accounts/:id/owner`**
  * **Access:** Private (`admin` only)
  * **Request Body:** `{ "userId": "e0eebc99-9c0b-4ef8-bb6d-6bb9bd380a01" }`
  * **Success Response (200 OK):**
    ```json
    {
      "message": "Account owner assigned successfully",
      "account": {
        "id": "b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a22",
        "userId": "e0eebc99-9c0b-4ef8-bb6d-6bb9bd380a01"
      }
    }
    ```
  * **Error Responses:**
    * `400 Bad Request`: Malformed UUID parameter.
    * `404 Not Found`: Target user or account does not exist.
    * `422 Unprocessable Entity`: Account already owned (immutable ownership violation `LL007`), target user inactive, or target is a system equity/clearing account.

### 5. Money Transfers & Reversals
* **`POST /api/transfers`**
  * **Access:** Private (`account_holder`, `admin`)
  * **Headers:**
    * `Authorization: Bearer <jwt-token>` (Mandatory)
    * `Idempotency-Key: <unique-key>` (Mandatory; scoped per `account:<sourceAccountId>`)
  * **Request Body:**
    ```json
    {
      "sourceAccountId": "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
      "destinationAccountId": "b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a22",
      "amountPaise": 50000
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
        "amountPaise": "50000",
        "status": "completed",
        "transferType": "customer_transfer",
        "createdAt": "2026-11-09T08:20:00.000Z"
      },
      "updatedBalances": {
        "sourceAccountId": "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
        "sourceBalancePaise": "50000",
        "destinationAccountId": "b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a22",
        "destinationBalancePaise": "50000"
      }
    }
    ```
  * **Idempotent Replay (201 Created):** Returns identical response body with response header `Idempotent-Replayed: true`.
  * **Error Responses:**
    * `400 Bad Request`: Missing `Idempotency-Key` header, negative amount, or identical source/destination.
    * `401 Unauthorized`: Token missing or invalid.
    * `403 Forbidden`: Account holder does not own source account; or caller is an auditor.
    * `404 Not Found`: Source or destination account not found.
    * `409 Conflict`: Re-sending same key with different payload parameters (`IdempotencyConflictError`).
    * `422 Unprocessable Entity`: Sender has insufficient balance. Uncommitted idempotency reservation is released, allowing retry once funded.
* **`POST /api/transfers/:id/reversal`**
  * **Access:** Private (`account_holder`, `admin`)
  * **Headers:**
    * `Authorization: Bearer <jwt-token>` (Mandatory)
    * `Idempotency-Key: <unique-key>` (Mandatory; scoped per `reversal:<originalTransferId>`)
  * **Request Body:** `{ "reversalReason": "Disputed transaction" }`
  * **Success Response (201 Created):**
    ```json
    {
      "message": "Transfer reversed successfully",
      "reversal": {
        "id": "d3eebc99-9c0b-4ef8-bb6d-6bb9bd380a44",
        "originalTransferId": "c2eebc99-9c0b-4ef8-bb6d-6bb9bd380a33",
        "sourceAccountId": "b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a22",
        "destinationAccountId": "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
        "amountPaise": "50000",
        "status": "completed",
        "transferType": "reversal",
        "reversalReason": "Disputed transaction",
        "createdAt": "2026-11-09T08:25:00.000Z"
      },
      "restoredBalances": {
        "sourceAccountId": "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
        "sourceBalancePaise": "100000",
        "destinationAccountId": "b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a22",
        "destinationBalancePaise": "0"
      }
    }
    ```
  * **Error Responses:**
    * `400 Bad Request`: Missing `Idempotency-Key` header.
    * `403 Forbidden`: Account holder does not own the debited (destination) account; or caller is an auditor.
    * `404 Not Found`: Original transfer not found.
    * `409 Conflict`: Transfer has already been reversed (enforced by partial unique index `idx_transfers_unique_reversal`).
    * `422 Unprocessable Entity`: Debited account has insufficient balance to reverse the transfer.

### 6. Cash Operations (Deposits & Withdrawals)
* **`POST /api/transfers/deposit`**
  * **Access:** Private (`account_holder`, `admin`)
  * **Headers:**
    * `Authorization: Bearer <jwt-token>` (Mandatory)
    * `Idempotency-Key: <unique-key>` (Mandatory; scoped per `deposit:<accountId>`)
  * **Request Body:** `{ "accountId": "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11", "amountPaise": 50000 }`
  * **Success Response (201 Created):**
    ```json
    {
      "message": "Deposit completed successfully",
      "transfer": {
        "id": "e4eebc99-9c0b-4ef8-bb6d-6bb9bd380a55",
        "transferType": "deposit",
        "sourceAccountId": "00000000-0000-0000-0000-000000000002",
        "destinationAccountId": "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
        "amountPaise": "50000",
        "status": "completed",
        "createdByUserId": "e0eebc99-9c0b-4ef8-bb6d-6bb9bd380a01",
        "createdAt": "2026-11-09T08:30:00.000Z"
      },
      "account": {
        "id": "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
        "balancePaise": "150000",
        "accountEntrySequence": "1"
      }
    }
    ```
  * **Error Responses:**
    * `400 Bad Request`: Invalid amount or missing idempotency key.
    * `403 Forbidden`: Account holder does not own target account; or caller is an auditor.
    * `404 Not Found`: Account does not exist.
    * `409 Conflict`: Re-sending same key with different payload.
* **`POST /api/transfers/withdraw`**
  * **Access:** Private (`account_holder`, `admin`)
  * **Headers:**
    * `Authorization: Bearer <jwt-token>` (Mandatory)
    * `Idempotency-Key: <unique-key>` (Mandatory; scoped per `withdraw:<accountId>`)
  * **Request Body:** `{ "accountId": "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11", "amountPaise": 20000 }`
  * **Success Response (201 Created):**
    ```json
    {
      "message": "Withdrawal completed successfully",
      "transfer": {
        "id": "a1eebc99-9c0b-4ef8-bb6d-6bb9bd380a77",
        "transferType": "withdrawal",
        "sourceAccountId": "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
        "destinationAccountId": "00000000-0000-0000-0000-000000000002",
        "amountPaise": "20000",
        "status": "completed",
        "createdByUserId": "e0eebc99-9c0b-4ef8-bb6d-6bb9bd380a01",
        "createdAt": "2026-11-09T08:35:00.000Z"
      },
      "account": {
        "id": "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
        "balancePaise": "130000",
        "accountEntrySequence": "2"
      }
    }
    ```
  * **Error Responses:**
    * `400 Bad Request`: Invalid amount, amount exceeding `PG_MAX_BIGINT`, or missing idempotency key.
    * `403 Forbidden`: Account holder does not own source account; or caller is an auditor.
    * `404 Not Found`: Account not found.
    * `409 Conflict`: Re-sending same key with different payload.
    * `422 Unprocessable Entity`: Insufficient balance. Triggers refusal audit log insertion.

### 7. Account Statements
* **`GET /api/accounts/:id/statement`**
  * **Access:** Private (`account_holder`, `admin`, `auditor`)
  * **Query Parameters (Optional):**
    * `from_date`: ISO 8601 string (e.g. `2026-01-01T00:00:00.000Z`).
    * `to_date`: ISO 8601 string (e.g. `2026-01-31T23:59:59.999Z`).
    * `limit`: Integer (1–100, default 50).
    * `offset`: Non-negative integer (default 0).
    * `include_refused`: Boolean or string `"true"`/`"false"` (default `false`).
  * **Success Response (200 OK):**
    ```json
    {
      "account": {
        "id": "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
        "accountNumber": "ACC-CUSTOMER-1001",
        "accountType": "customer",
        "currentBalancePaise": "130000",
        "phase6CutoverBalancePaise": "100000",
        "phase6CutoverCapturedAt": "2026-11-09T07:50:00.000Z",
        "nextEntrySequence": "3"
      },
      "statement": {
        "entries": [
          {
            "id": "b2eebc99-9c0b-4ef8-bb6d-6bb9bd380a88",
            "transferId": "e4eebc99-9c0b-4ef8-bb6d-6bb9bd380a55",
            "transferType": "deposit",
            "entryType": "credit",
            "amountPaise": "50000",
            "balanceAfterPaise": "150000",
            "accountEntrySequence": "1",
            "regime": "sequenced",
            "createdAt": "2026-11-09T08:30:00.000Z",
            "initiatedBy": {
              "userId": "e0eebc99-9c0b-4ef8-bb6d-6bb9bd380a01",
              "username": "alice"
            }
          }
        ],
        "pagination": {
          "totalEntries": 1,
          "limit": 50,
          "offset": 0,
          "note": "Offset pagination applies over the dual-regime total ordering. In an active ledger, offset pagination across separate requests can shift if concurrent transactions append new entries."
        }
      }
    }
    ```
  * **Error Responses:**
    * `400 Bad Request`: Malformed UUID or invalid date range (`from_date > to_date`).
    * `403 Forbidden`: Account holder does not own account.
    * `404 Not Found`: Account does not exist.

---

## 🔐 Role Permission Matrix

| Capability / Endpoint | `account_holder` | `admin` | `auditor` |
| :--- | :---: | :---: | :---: |
| View Own Assigned Accounts (`GET /api/accounts`) | ✅ | ✅ | ✅ |
| View Other / Unassigned Accounts | ❌ (403) | ✅ | ✅ |
| View System Accounts (`?include_system=true`) | ❌ (Filtered) | ✅ | ✅ |
| Create Customer Accounts (`POST /api/accounts`) | ❌ (403) | ✅ | ❌ (403) |
| Assign Account Ownership (`POST /api/admin/accounts/:id/owner`) | ❌ (403) | ✅ | ❌ (403) |
| Change User Roles & Status (`PATCH /api/admin/users/:id/*`) | ❌ (403) | ✅ | ❌ (403) |
| Initiate Transfers (`POST /api/transfers`) | ✅ (Own source only) | ✅ | ❌ (403) |
| Reverse Transfers (`POST /api/transfers/:id/reversal`) | ✅ (Own debited only) | ✅ | ❌ (403) |
| Deposit Cash (`POST /api/transfers/deposit`) | ✅ (Own account only) | ✅ | ❌ (403) |
| Withdraw Cash (`POST /api/transfers/withdraw`) | ✅ (Own account only) | ✅ | ❌ (403) |
| View Account Statements (`GET /api/accounts/:id/statement`) | ✅ (Own account only) | ✅ | ✅ |

---

## 🛡️ Financial Integrity & Security Design

### 1. Exact Integer Arithmetic
- All monetary amounts are handled strictly as integer paise ($1\text{ Rupee} = 100\text{ paise}$) represented as `BIGINT` in PostgreSQL and native `BigInt` in Node.js and React.
- IEEE 754 floating-point numbers (`Number` / `float`) are prohibited in financial pathways, eliminating rounding arbitrage.
- Currency parsing and formatting in [`frontend/src/utils/currency.js`](file:///d:/LedgerLine/frontend/src/utils/currency.js) operates exclusively via string splitting and BigInt arithmetic, with bounds enforcement against `PG_MAX_BIGINT` ($9{,}223{,}372{,}036{,}854{,}775{,}807$).

### 2. Append-Only Immutability & Double-Entry Balancing
- Every financial mutation (transfer, deposit, withdrawal, reversal, opening cutover) produces **exactly two** balanced ledger entries: one debit and one credit of equal amount.
- **Immutability Triggers:** Database triggers `prevent_ledger_mutation` and `prevent_transfer_mutation` unconditionally abort all `UPDATE` and `DELETE` statements with SQLSTATE `LL007`. There are no backdoor bypass settings.
- **Deferred Constraint Triggers:** `trg_verify_transfer_balance` is declared `DEFERRABLE INITIALLY DEFERRED`. At `COMMIT`, PostgreSQL verifies that each transfer record is balanced by its corresponding debit and credit ledger entries.

### 3. Concurrency Protection & Deadlock Mitigation
- Competing transfer and withdrawal transactions lock participating accounts using:
  ```sql
  SELECT id, balance_paise FROM accounts WHERE id IN ($1, $2) ORDER BY id ASC FOR UPDATE
  ```
- Deterministic lock acquisition ordering (`ORDER BY id ASC`) eliminates circular lock waits between concurrent transfers swapping identical account pairs, significantly reducing deadlock risk.
- Conditional balance deductions (`WHERE id = $1 AND balance_paise >= $2`) provide defense-in-depth against overdrafts.

### 4. Idempotency & Duplicate Request Protection
- Mutating endpoints require an `Idempotency-Key` HTTP header.
- Scoped keys (`account:<sourceAccountId>`, `deposit:<accountId>`, `withdraw:<accountId>`, `reversal:<originalTransferId>`) prevent cross-account collisions.
- The backend stores a SHA-256 hash of canonical business parameters. Replaying identical parameters for the same key and scope returns the cached response with `Idempotent-Replayed: true`. Replaying the same key with altered parameters returns HTTP `409 Conflict`.
- Solvency rejections (HTTP 422) roll back the uncommitted key reservation, allowing the client to retry once funded.

### 5. Audit Logging of Refused Attempts
- Refused attempts due to business failures (such as insufficient funds or nonexistent accounts) are persisted to `public.audit_refused_attempts`.
- **Rollback-Release-Audit Ordering:** The financial transaction is explicitly rolled back and its database client released to the pool *before* the refusal audit record is inserted on an independent connection.
- Nonexistent account attempts preserve the attempted UUID in `reason_message` while setting `account_id = NULL` to prevent foreign-key violations.
- If audit insertion fails, the endpoint returns HTTP 500 with `durableAudit: false` and emits structured critical `stderr` logs.

### 6. Prisma ORM Read Separation & Redis Distributed Rate Limiting
- **Hybrid Data Access (`pg` + Prisma):** Prisma Client ([`backend/src/config/prisma.js`](file:///d:/LedgerLine/backend/src/config/prisma.js)) connects strictly using the restricted `ledgerline_app` role (`DATABASE_URL`) for ordinary read queries (`GET /api/accounts`, `GET /api/accounts/:id`) and readiness validation (`SELECT 1`). Financial writes, pessimistic row locks (`FOR UPDATE`), double-entry ledger insertions, stored functions, and refusal audits execute exclusively through raw parameterized SQL in `pg.Pool`.
- **Distributed Rate Limiting ([`backend/src/middleware/rateLimiter.js`](file:///d:/LedgerLine/backend/src/middleware/rateLimiter.js)):** Backed by Redis (`ioredis` + `rate-limit-redis` + `express-rate-limit`):
  - **Authentication Limiter (`authLimiter`):** 10 requests per 15 minutes per IP on `POST /api/auth/register` and `POST /api/auth/login`. Fails closed with HTTP `503` in production if Redis is unavailable (local in-memory fallback is permitted only in development/test).
  - **Financial Mutation Limiter (`financialMutationLimiter`):** 30 requests per minute per authenticated user (falling back to IP key if unauthenticated) on `POST /api/transfers`, `POST /api/transfers/deposit`, `POST /api/transfers/withdraw`, and `POST /api/transfers/:id/reversal`. Always fails closed with HTTP `503` in all environments if Redis is unavailable.
- **Production Environment Guardrails ([`backend/src/config/env.js`](file:///d:/LedgerLine/backend/src/config/env.js)):** When `NODE_ENV=production`, startup fails immediately with non-sensitive diagnostics if `JWT_SECRET` (minimum 32 chars, non-default), `DATABASE_URL` (`ledgerline_app` + TLS enforced), `REDIS_URL` (non-localhost), or `CLIENT_URL` (non-localhost) is missing or invalid, or if `RATE_LIMIT_ENABLED=false`.

---

## ☁️ Render Deployment Guide

BalanceVault includes a multi-service Render Blueprint at [`render.yaml`](file:///d:/LedgerLine/render.yaml):

1. **Prerequisites (Database & Cache):**
   - **Neon PostgreSQL (`neondb`):** Migrations `001`–`006` and the initial production administrator bootstrap have **already been executed and verified**. Runtime services must connect strictly with the restricted `ledgerline_app` role and TLS (`sslmode=require`).
   - **Hosted Redis:** Provision a managed Redis service (e.g., Render Key Value or Upstash `rediss://...`). Without a reachable `REDIS_URL`, backend startup fails in production and rate-limited endpoints + `/api/health/ready` return HTTP `503`.
2. **Backend Web Service (`balancevault-api`):**
   - **Root Directory:** `backend` | **Runtime:** Node | **Build Command:** `npm run build` | **Start Command:** `npm start`
   - **Health Check Path:** `/api/health/live` (use `/api/health/ready` post-deploy to verify live PostgreSQL + Prisma + Redis connectivity)
   - **Required Secrets (`sync: false` in `render.yaml`):** Set `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, and `CLIENT_URL` (matching the deployed frontend Static Site URL) in the Render dashboard.
3. **Frontend Static Site (`balancevault-web`):**
   - **Root Directory:** `frontend` | **Runtime:** Static | **Build Command:** `npm install && npm run build` | **Publish Directory:** `dist`
   - **SPA Routing:** Configured in `render.yaml` with `/*` &rarr; `/index.html` rewrite so deep React Router links do not return `404`.
   - **API Origin:** Set `VITE_API_BASE_URL` in Render to the deployed backend Web Service origin (`https://<your-backend>.onrender.com`) before building.

---

## ⚠️ Known Limitations & Operational Boundaries

1. **Deployment Status:** BalanceVault's Neon PostgreSQL migrations (`001`–`006`) and initial administrator bootstrap are verified; Render web/static services and hosted Redis provisioning remain to be wired using [`render.yaml`](file:///d:/LedgerLine/render.yaml).
2. **Real Bank Rails:** BalanceVault does not integrate with real-world payment networks (UPI, IMPS, NEFT, RTGS, SWIFT, ACH). It operates as an isolated core ledger engine.
3. **Cash Clearing Accounting:** `SYSTEM_CASH_CLEARING` is strictly an internal zero-sum accounting counter-account. It is not legal proof of physical currency, cash vaults, or central bank reserves.
4. **Historical Sequence Gaps & Ordering:** Ledger entries created prior to Phase 6 maintain `account_entry_sequence = NULL`. In statements, legacy entries are displayed chronologically using `created_at ASC, id ASC` (with entry ID serving as a deterministic tie-breaker for identical timestamps), but they do not possess authoritative Phase 6 contiguous per-account sequence numbers.
5. **Statement Offset Pagination:** Statements use SQL `LIMIT / OFFSET` over a total-ordered result set. In an active banking environment, concurrent transactions committed between page requests may cause entries to shift across page boundaries.
6. **Nonexistent Account Refusals:** Refused attempts targeting a nonexistent account UUID have `account_id = NULL` in the database and cannot appear on any specific account statement.
7. **Security Boundary Distinction:** Express JWT middleware (`authenticateJWT` and `requireRole`) is the sole authentication and authorization boundary for HTTP users. PostgreSQL `SECURITY DEFINER` functions enforce internal database invariants, but do not independently authenticate HTTP requests.
8. **Client Session Storage:** The React frontend stores authentication tokens in-memory with a tab-scoped fallback in `sessionStorage` (`ledgerline_session_token`) to survive page reloads. Same-origin scripts within the tab lifecycle can access `sessionStorage`; persistent `localStorage` is intentionally avoided.

---

## 🧪 Verification & Test Metrics

- **Backend Automated Tests:** **161 passed, 161 total** across 15 Jest suites (`npm run test:backend`).
- **Frontend Automated Tests:** **117 passed, 117 total** across 10 Vitest files (`npm --prefix frontend test -- --run`).
- **Combined Project Test Suite:** **278 passed, 278 total (0 failures)**.
- **Frontend Production Build:** **Compiled cleanly** (`npm --prefix frontend run build`, 73 modules transformed into `frontend/dist/`).

---

## 🗺️ Roadmap & Phase Completion

- [x] **Phase 1: Initial Foundation & Workspace Setup**
- [x] **Phase 2 Baseline: Initial Migration & Basic Money Transfer (Experiment 1)**
- [x] **Phase 2 Hardening & Phase 3: Concurrency Protection (`SELECT ... FOR UPDATE`), Row-Level Serialization & Regression Proof**
- [x] **Phase 4: Full Double-Entry Balanced Ledger Engine, Append-Only Triggers, Idempotency & Reversals**
- [x] **Phase 5: User Authentication & Role-Based Authorization**
- [x] **Phase 6: Banking Functionality, Cash Invariants, Refusal Auditing & Account Statements**
- [x] **Phase 7: Frontend Banking Client Application, Vitest Suite & Readiness Audit**
- [x] **Phase 8: Prisma ORM Read Integration, Redis Fail-Closed Rate Limiting, Production Hardening & Render Blueprint**
