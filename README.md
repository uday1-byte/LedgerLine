# ⚖️ BalanceVault (formerly LedgerLine) — Financial Ledger Application

**BalanceVault** (formerly **LedgerLine**; repository root: `LedgerLine`) is a full-stack, double-entry financial ledger and banking client application built with **Node.js**, **Express**, **PostgreSQL 18.6**, **Prisma ORM**, **Redis**, and **React 18** with **Vite 6**. Historical internal identifiers (`ledgerline_dev`, `ledgerline_test`, `ledgerline_owner`, `ledgerline_app`, package identifiers, and `sessionStorage` keys such as `ledgerline_session_token`) are preserved for migration, role, and client compatibility.

It demonstrates core financial engineering principles: exact integer arithmetic (paise via `BigInt` and PostgreSQL `BIGINT`), concurrency-safe transaction serialization, append-only immutable ledgers, deferred constraint balancing, cryptographic idempotency, distributed fail-closed Redis rate limiting, least-privilege database role separation, role-based access control (RBAC), and automated refusal auditing.

> [!NOTE]
> **Verification & Production Deployment Status:**
> - **Live Render Deployments:** Frontend [`https://balancevault-web-25xe.onrender.com`](https://balancevault-web-25xe.onrender.com) &nbsp;|&nbsp; Backend [`https://balancevault-api-7typ.onrender.com`](https://balancevault-api-7typ.onrender.com)
> - **Verified Live in Production:** Neon PostgreSQL migrations (`001`–`006`), initial administrator bootstrap, `GET /api/health/live`, `GET /api/health/ready` (`PostgreSQL`, `Prisma`, and Render Key Value `Redis` all reporting connected/healthy), user registration, user login, and customer `/dashboard` loading.
> - **Not Yet Tested Live in Production:** End-to-end live financial workflows (`POST /api/transfers/deposit`, `POST /api/transfers/withdraw`, `POST /api/transfers`, `POST /api/transfers/:id/reversal`, and live refusal-audit inspection). Additionally, the newest local enhancements (Admin User Directory `GET /api/admin/users` + searchable Admin Portal UI, transfer `BigInt` validation fix, complete frontend `BalanceVault` rebranding, and updated documentation) currently reside in the uncommitted local working tree and require commit, push, and Render redeploy to go live.
> - **Local Automated Verification:** **298 automated tests pass locally (178 backend tests across 16 Jest suites, 120 frontend tests across 10 Vitest files)** alongside a clean Vite production build.

---

## 🛠️ Technology Stack

| Layer | Technology | Version / Specification | Details |
| :--- | :--- | :--- | :--- |
| **Frontend Framework** | React | `^18.3.1` | Single Page Application (SPA) with declarative hooks and Context API |
| **Frontend Tooling** | Vite | `^6.2.0` (installed `6.4.5`) | ESM bundler with `VITE_API_BASE_URL` production routing and `/api` dev proxy |
| **Routing** | React Router DOM | `^7.18.5` | Client-side routing, protected navigation guards, and history synchronization |
| **Frontend Testing** | Vitest, JSDOM, RTL | Vitest `^5.1.0`, RTL `^16.3.3` | Headless unit and component integration tests (120 tests across 10 files) |
| **DOM Assertions** | Jest-DOM | `@testing-library/jest-dom ^7.0.1` | Custom matchers for accessible DOM element state assertions |
| **Backend Runtime** | Node.js | v22.19.0 LTS (supports v20+) | Asynchronous I/O runtime with graceful HTTP/Prisma/Redis shutdown |
| **Backend Framework** | Express | `^5.3.0` | Modular RESTful API architecture with `trust proxy` enabled (`1` hop) for Render |
| **Validation** | Zod | `^4.6.7` | Strict runtime request payload and production environment validation |
| **Authentication** | JWT & bcryptjs | `jsonwebtoken ^9.0.3`, `bcryptjs ^3.0.3` | Stateless Bearer JWTs; bcrypt with work factor 12 and timing mitigation |
| **Database** | PostgreSQL | 18.6 (Neon in production) | Relational database with stored procedures, triggers, and row-level locking |
| **Database Access** | `pg` & Prisma ORM | `pg ^8.23.1`, `@prisma/client ^6.4.0` | `pg.Pool` raw SQL for financial mutations; Prisma (`ledgerline_app`) for ordinary reads |
| **Rate Limiting & Cache** | Redis & Rate Limiter | `ioredis ^5.6.0`, `express-rate-limit ^8.7.4`, `rate-limit-redis ^6.0.2` | Distributed IP/user rate limiting failing closed (`503`) in production |
| **Backend Testing** | Jest, Supertest | Jest `^30.5.2`, Supertest `^7.3.1` | API, Prisma, Redis, health, and concurrency tests (178 tests across 16 suites) |

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
├── WRITEUP.md                                 # Technical architecture and financial-engineering submission write-up
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
│   │   │   ├── admin.js                       # Admin user directory (GET /api/admin/users), governance, ownership
│   │   │   ├── auth.js                        # User registration, login (rate-limited), and profile (/api/auth/me)
│   │   │   ├── health.js                      # Liveness (/api/health/live) & readiness (/api/health/ready, /api/health) probes
│   │   │   └── transfers.js                   # Rate-limited transfers, reversals, deposits, and withdrawals (BigInt + SQL)
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
│       ├── rbac.test.js                       # Role-based access control, IDOR prevention, and user directory tests
│       ├── redis.test.js                      # Redis connection lifecycle, readiness, and reconnection tests
│       ├── statements.test.js                 # Statement dual-regime ordering and pagination tests
│       ├── transfers.test.js                  # Transfer business logic, BigInt precision, and idempotency tests
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
│       │   ├── admin/                         # CreateAccountModal, AssignOwnerModal, RegisteredUsersTable, UserGovernanceForm, UserSelectField, UnassignedAccountsTable
│       │   ├── auditor/                       # AuditorOverviewCard, AuditorAccountsTable
│       │   ├── common/                        # Alert, ProtectedRoute
│       │   ├── dashboard/                     # AccountCard, AccountSummary, EmptyAccountState
│       │   ├── layout/                        # Navbar
│       │   ├── statements/                    # StatementFilterBar, StatementTable, RefusedAttemptsTable, pagination
│       │   └── transfers/                     # TransferForm, DepositForm, WithdrawForm, ConfirmationModal, Receipt
│       ├── pages/
│       │   ├── AdminPortalPage.jsx            # Account creation, searchable ownership assignment, user directory, governance
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
- **Redis**: Local or hosted Redis instance for financial mutation rate limiting (`RATE_LIMIT_ENABLED=true`; in non-production environments `authLimiter` falls back to `MemoryStore`, whereas `financialMutationLimiter` requires Redis when active and Jest disables rate limiters unless `ENABLE_RATE_LIMIT_TESTS=true`)
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

# Redis Rate Limiting Configuration
# Optional: Full connection URI (e.g. redis://localhost:6379 or rediss://... for TLS)
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_TLS=false
RATE_LIMIT_ENABLED=true
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
| `npm run test:backend` | Runs the complete Jest backend test suite (178 tests across 16 suites) |
| `npm run build:frontend` | Compiles production React bundle into `frontend/dist/` |

### Frontend-Specific Commands

```bash
# Run the complete Vitest frontend test suite (120 tests across 10 files)
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
/admin                  -> AdminPortalPage (account creation, searchable ownership assignment, Registered Users directory, role/status governance)
/auditor                -> AuditorPortalPage (read-only ledger overview, account registry, direct statement links)
*                       -> NotFoundPage (404 catch-all)
```

### Key Client Features:
1. **BalanceVault UI Branding:** All user-facing pages, titles, navigation headings, print statement headers, and authentication prompts display **BalanceVault** while keeping internal storage keys intact.
2. **Centralized API Client ([`frontend/src/api/client.js`](file:///d:/LedgerLine/frontend/src/api/client.js)):** Resolves `VITE_API_BASE_URL` when configured for standalone production hosting while falling back to relative `/api/...` paths for the Vite local dev proxy. Automatically attaches Bearer tokens, intercepts 401s to clear session state, and classifies errors into *Definitive Business Errors* (400, 401, 403, 404, 422, 409 Conflict) and *Ambiguous Network Outcomes* (HTTP 0, 502–504, 409 ConcurrentRequestError).
3. **In-Memory & Tab-Scoped Session Storage:** Tokens are held in React state with an optional fallback to `sessionStorage` (`ledgerline_session_token`) to survive page reloads within the tab. Persistent `localStorage` is intentionally avoided.
4. **Admin Directory & Searchable Assignment:** [`AdminPortalPage.jsx`](file:///d:/LedgerLine/frontend/src/pages/AdminPortalPage.jsx) fetches `GET /api/admin/users` alongside `GET /api/accounts`, rendering [`RegisteredUsersTable`](file:///d:/LedgerLine/frontend/src/components/admin/RegisteredUsersTable.jsx) (with username/email/UUID search, role/status filters, and click-to-manage pre-fill) and [`AssignOwnerModal`](file:///d:/LedgerLine/frontend/src/components/admin/AssignOwnerModal.jsx) (searchable registered-customer dropdown via [`UserSelectField`](file:///d:/LedgerLine/frontend/src/components/admin/UserSelectField.jsx) with an optional non-customer toggle and manual UUID fallback).
5. **Idempotency Lifecycle & Pending Banner:** When a financial mutation experiences an ambiguous network failure, the client preserves the exact `idempotencyKey` and payload in `sessionStorage` (`ledgerline_pending_mutation`) and surfaces [`PendingOperationBanner`](file:///d:/LedgerLine/frontend/src/components/transfers/PendingOperationBanner.jsx). Retrying re-sends the identical key, preventing double-execution.
6. **Timezone-Explicit Statement Filtering:** Statements support explicit UTC bounding (`00:00:00.000Z` to `23:59:59.999Z`) or browser LOCAL timezone bounding with exact ISO offset conversion in [`frontend/src/utils/date.js`](file:///d:/LedgerLine/frontend/src/utils/date.js).

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
  * **Access:** Public (`authLimiter`: 10 requests / 15 min per IP; fails closed `503` in production if Redis is unavailable)
  * **Rules:** Enforces minimum 8 characters, at least 1 letter, and at least 1 number. Ignores or rejects role escalation attempts; defaults strictly to `account_holder`. Passwords hashed with `bcryptjs` (work factor 12). Validation uses Zod v4 `.issues`.
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
        "is_active": true,
        "created_at": "2026-11-09T08:05:00.000Z",
        "updated_at": "2026-11-09T08:05:00.000Z"
      }
    }
    ```
  * **Error Responses:**
    * `400 Bad Request`: Payload validation error (password failing complexity, invalid email/username).
    * `409 Conflict`: Username or email already registered.
    * `429 Too Many Requests` / `503 Service Unavailable`: IP rate limit exceeded or production Redis unavailable.
* **`POST /api/auth/login`**
  * **Access:** Public (`authLimiter`: 10 requests / 15 min per IP; fails closed `503` in production if Redis is unavailable)
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
        "is_active": true
      }
    }
    ```
  * **Error Responses:**
    * `400 Bad Request`: Missing or invalid email/password format.
    * `401 Unauthorized`: Invalid credentials (safe, generic error message).
    * `403 Forbidden`: User account deactivated (`is_active = false`).
    * `429 Too Many Requests` / `503 Service Unavailable`: IP rate limit exceeded or production Redis unavailable.
* **`GET /api/auth/me`**
  * **Access:** Private (`account_holder`, `admin`, `auditor`)
  * **Headers:** `Authorization: Bearer <jwt-token>` (Mandatory)
  * **Description:** Queries live user attributes from `public.users`. Immediately reflects database role demotion or deactivation.
  * **Success Response (200 OK):** Returns `{ "user": { "id", "username", "email", "role", "is_active", "created_at", "updated_at" } }` without `password_hash`.
  * **Error Responses:**
    * `401 Unauthorized`: Token missing, expired, or user deleted from database.
    * `403 Forbidden`: User account deactivated (`is_active = false`).

### 3. Account Inspection & Creation
* **`GET /api/accounts`**
  * **Access:** Private (`account_holder`, `admin`, `auditor`)
  * **Policy:** Executed via Prisma (`ledgerline_app`). Account holders see only their assigned customer accounts (`user_id = req.user.id` and `account_type = 'customer'`). Admins and auditors see all accounts (customer accounts as well as `system_equity` and `system_cash_clearing` accounts). Supports no query parameters.
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
All administrative endpoints require `admin` role (`requireRole('admin')`). Role, status, and ownership mutations delegate invariant enforcement to transactional PostgreSQL `SECURITY DEFINER` functions:
* **`GET /api/admin/users`**
  * **Access:** Private (`admin` only)
  * **Description:** Lists registered users ordered by `created_at DESC, id ASC`, returning strictly safe user fields (`password_hash` is never selected or serialized). Does not implement pagination (`limit`/`offset`).
  * **Query Parameters (Optional):**
    * `search`: Case-insensitive substring filter (`ILIKE`) matched against `username` or `email` (up to 255 characters; SQL wildcards escaped).
    * `role`: Exact filter (`admin`, `account_holder`, or `auditor`).
    * `is_active` (also accepts `isActive`): Boolean string (`"true"` or `"false"`).
  * **Success Response (200 OK):**
    ```json
    {
      "users": [
        {
          "id": "e0eebc99-9c0b-4ef8-bb6d-6bb9bd380a01",
          "username": "alice",
          "email": "alice@example.com",
          "role": "account_holder",
          "is_active": true,
          "created_at": "2026-11-09T08:05:00.000Z",
          "updated_at": "2026-11-09T08:05:00.000Z"
        }
      ]
    }
    ```
  * **Error Responses:**
    * `400 Bad Request`: Invalid filter parameter (e.g., unsupported `role` or non-boolean `is_active`).
    * `401 Unauthorized`: Missing or invalid JWT.
    * `403 Forbidden`: Non-admin or inactive caller.
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
  * **Access:** Private (`account_holder`, `admin`; protected by `financialMutationLimiter`: 30 req/min per user, failing closed `503` if Redis is unavailable)
  * **Headers:**
    * `Authorization: Bearer <jwt-token>` (Mandatory)
    * `Idempotency-Key: <unique-key>` (Mandatory; scoped per `account:<sourceAccountId>`)
  * **Amount Validation (`amountPaise`):** Validated via `amountPaiseSchema` into native JavaScript `BigInt` (shared with `/deposit` and `/withdraw`). Accepts a positive safe JS integer or canonical positive decimal digit string (`/^[1-9]\d*$/`) up to PostgreSQL `BIGINT` max (`9223372036854775807`). Rejects decimals, leading zeros, zero, negative values, malformed strings, and unsafe JavaScript numbers > `Number.MAX_SAFE_INTEGER`.
  * **Request Body:**
    ```json
    {
      "sourceAccountId": "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
      "destinationAccountId": "b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a22",
      "amountPaise": "50000"
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
    * `400 Bad Request`: Missing `Idempotency-Key` header, invalid/non-positive/unsafe `amountPaise`, `amountPaise` exceeding `PG_MAX_BIGINT`, or identical source/destination.
    * `401 Unauthorized`: Token missing or invalid.
    * `403 Forbidden`: Account holder does not own source account; or caller is an auditor.
    * `404 Not Found`: Source or destination account not found.
    * `409 Conflict`: Re-sending same key with different payload parameters (`IdempotencyConflictError`) or concurrent in-flight duplicate key (`ConcurrentRequestError`).
    * `422 Unprocessable Entity`: Sender has insufficient balance. Uncommitted idempotency reservation is released, allowing retry once funded.
    * `429 Too Many Requests` / `503 Service Unavailable`: Financial mutation rate limit exceeded or Redis unavailable (fail-closed).
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
| View Own Assigned Customer Accounts (`GET /api/accounts`) | ✅ | ✅ | ✅ |
| View All Accounts Including System Accounts (`GET /api/accounts`) | ❌ (Filtered) | ✅ | ✅ |
| Inspect Any Account by ID (`GET /api/accounts/:id`) | ❌ (403 unless owner) | ✅ | ✅ |
| List & Filter Registered Users (`GET /api/admin/users`) | ❌ (403) | ✅ | ❌ (403) |
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
- IEEE 754 floating-point numbers (`Number` / `float`) and `parseInt` conversions on arbitrary monetary amounts are prohibited in financial pathways, eliminating rounding arbitrage and 53-bit precision loss above `Number.MAX_SAFE_INTEGER`.
- Shared Zod schema `amountPaiseSchema` validates all three money-movement endpoints (`POST /api/transfers`, `POST /api/transfers/deposit`, `POST /api/transfers/withdraw`) against safe integers or canonical decimal digit strings (`/^[1-9]\d*$/`) up to `PG_MAX_BIGINT` ($9{,}223{,}372{,}036{,}854{,}775{,}807$).
- Currency parsing and formatting in [`frontend/src/utils/currency.js`](file:///d:/LedgerLine/frontend/src/utils/currency.js) operates exclusively via string splitting and BigInt arithmetic, with bounds enforcement against `PG_MAX_BIGINT`.

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

### 6. Prisma ORM Read Separation, Redis Lifecycle & Fail-Closed Rate Limiting
- **Hybrid Data Access (`pg` + Prisma):** Prisma Client ([`backend/src/config/prisma.js`](file:///d:/LedgerLine/backend/src/config/prisma.js)) connects strictly using the restricted `ledgerline_app` role (`DATABASE_URL`) for ordinary read queries (`GET /api/accounts`, `GET /api/accounts/:id`) and readiness validation (`SELECT 1`). Financial writes, pessimistic row locks (`FOR UPDATE`), double-entry ledger insertions, stored functions, admin user-directory queries, and refusal audits execute exclusively through raw parameterized SQL in `pg.Pool`.
- **Redis Startup & Readiness Lifecycle ([`backend/src/config/redis.js`](file:///d:/LedgerLine/backend/src/config/redis.js)):** Server startup calls `initializeRedis()` immediately in [`backend/src/server.js`](file:///d:/LedgerLine/backend/src/server.js) with dual-stack DNS support (`family: 0`) for Render Key Value hostnames. Only the `ioredis` `'ready'` event marks the client ready (not raw TCP `'connect'`), preventing `"Stream isn't writeable and enableOfflineQueue options is false"` races during TLS/AUTH handshakes; `checkRedisConnection()` waits up to `1500ms` via `waitForRedisReady()` before issuing `PING`.
- **Distributed Rate Limiting ([`backend/src/middleware/rateLimiter.js`](file:///d:/LedgerLine/backend/src/middleware/rateLimiter.js)):** Backed by Redis (`ioredis` + `rate-limit-redis` + `express-rate-limit`):
  - **Authentication Limiter (`authLimiter`):** 10 requests per 15 minutes per IP on `POST /api/auth/register` and `POST /api/auth/login`. Fails closed with HTTP `503` in production if Redis is unavailable (local `MemoryStore` fallback is permitted only in development/test).
  - **Financial Mutation Limiter (`financialMutationLimiter`):** 30 requests per minute per authenticated user (falling back to IP key if unauthenticated) on `POST /api/transfers`, `POST /api/transfers/deposit`, `POST /api/transfers/withdraw`, and `POST /api/transfers/:id/reversal`. Always fails closed with HTTP `503` in all environments if Redis is unavailable.
- **Production Environment Guardrails ([`backend/src/config/env.js`](file:///d:/LedgerLine/backend/src/config/env.js)):** When `NODE_ENV=production`, startup fails immediately with non-sensitive diagnostics if `JWT_SECRET` (minimum 32 chars, non-default), `DATABASE_URL` (`ledgerline_app` + TLS enforced), `REDIS_URL` (non-localhost), or `CLIENT_URL` (non-localhost) is missing or invalid, or if `RATE_LIMIT_ENABLED=false`.

---

## ☁️ Production Architecture & Render Deployment

BalanceVault is deployed across **Render** + **Neon PostgreSQL** using the multi-service Render Blueprint at [`render.yaml`](file:///d:/LedgerLine/render.yaml):

- **Live Frontend Static Site (`balancevault-web`):** [`https://balancevault-web-25xe.onrender.com`](https://balancevault-web-25xe.onrender.com)
- **Live Backend Web Service (`balancevault-api`):** [`https://balancevault-api-7typ.onrender.com`](https://balancevault-api-7typ.onrender.com)

1. **Backing Infrastructure (Neon PostgreSQL + Render Key Value Redis):**
   - **Neon PostgreSQL (`neondb`):** Migrations `001`–`006` and initial production administrator bootstrap via `seed-admin.js` (advisory-locked CLI using `ledgerline_owner`) are completed. Runtime traffic uses `DATABASE_URL` with the restricted `ledgerline_app` role and SSL (`sslmode=require`).
   - **Render Key Value (`REDIS_URL`):** Managed Redis wired to `balancevault-api` for distributed auth and financial mutation rate limiting.
2. **Backend Web Service (`balancevault-api`):**
   - **Root Directory:** `backend` | **Runtime:** Node | **Build Command:** `npm run build` | **Start Command:** `npm start`
   - **Health Check Path:** `/api/health/live` (`200 OK` process liveness without external calls); `/api/health/ready` (`200 OK` / `503 Service Unavailable`) checks live PostgreSQL (`pg.Pool`), Prisma (`$queryRaw`), and Redis (`PING`).
   - **Required Secrets (`sync: false` in `render.yaml`):** `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, and `CLIENT_URL` (`https://balancevault-web-25xe.onrender.com`).
3. **Frontend Static Site (`balancevault-web`):**
   - **Root Directory:** `frontend` | **Runtime:** Static | **Build Command:** `npm install && npm run build` | **Publish Directory:** `dist`
   - **SPA Routing:** `/*` &rarr; `/index.html` rewrite rule in `render.yaml` so client routes resolve without `404`.
   - **API Origin:** `VITE_API_BASE_URL` set to `https://balancevault-api-7typ.onrender.com`.

### Production Verification vs. Pending Live Tests
- **Verified Live:** `/api/health/live`, `/api/health/ready` confirming live **PostgreSQL + Prisma + Redis** health, customer registration, customer login, and customer dashboard load (showing zero accounts prior to admin provisioning).
- **Not Yet Tested Live:** End-to-end financial transaction flows (**cash deposit, cash withdrawal, customer transfer, compensating reversal, and live statement/refusal-audit inspection**) have not yet been executed in production.
- **Uncommitted Local Updates Pending Deploy:** The admin user-directory (`GET /api/admin/users` + searchable `AdminPortalPage`), transfer `BigInt` validation fix, complete `BalanceVault` frontend UI rebranding, and updated documentation currently exist locally and will go live only after review, commit, push, and Render rebuild.

---

## ⚠️ Known Limitations & Operational Boundaries

1. **Production Financial Workflow Coverage & Uncommitted Local Changes:** Live Render checks have verified health/readiness (`PostgreSQL`, `Prisma`, `Redis`), registration, login, and customer dashboard loading; live end-to-end money-movement workflows (`deposit`, `withdraw`, `transfer`, `reversal`) have not yet been exercised in production, and the latest local changes (admin user directory, transfer `BigInt` precision fix, UI rebrand to `BalanceVault`) await Git push/deploy.
2. **Redis Free-Tier Persistence & Counter Resets:** Managed free-tier Redis instances (such as Render Key Value free tier) are volatile/ephemeral across restarts or evictions, which can reset active rate-limit window counters. In production, if Redis becomes unavailable or unreachable, both authentication and financial mutation endpoints intentionally fail closed with HTTP `503`.
3. **Transfer & Reversal Sequencing / Refusal-Audit Differences:** While `POST /api/transfers/deposit` and `POST /api/transfers/withdraw` assign contiguous per-account `account_entry_sequence` numbers, populate `created_by_user_id`, and log business refusals via `auditService.recordRefusalAudit`, `POST /api/transfers` and `POST /api/transfers/:id/reversal` leave `account_entry_sequence = NULL` (appearing in statements with `regime: "legacy_unsequenced"`), leave `created_by_user_id = NULL`, and do not write refused attempts to `audit_refused_attempts`.
4. **Reversal Frontend Support:** Compensating reversals (`POST /api/transfers/:id/reversal`) are implemented and tested on the backend API, and reversal entries render in [`StatementTable.jsx`](file:///d:/LedgerLine/frontend/src/components/statements/StatementTable.jsx) (`Transfer Reversal`), but there is no interactive button or modal in the React frontend to initiate a reversal from the UI.
5. **Admin User-Directory Pagination:** `GET /api/admin/users` returns all matching registered users sorted by `created_at DESC, id ASC` without server-side `limit`/`offset` pagination, which should be added if the user table scales significantly.
6. **Real Bank Rails:** BalanceVault does not integrate with real-world payment networks (UPI, IMPS, NEFT, RTGS, SWIFT, ACH). It operates as an isolated core ledger engine.
7. **Cash Clearing Accounting:** `SYSTEM_CASH_CLEARING` is strictly an internal zero-sum accounting counter-account. It is not legal proof of physical currency, cash vaults, or central bank reserves.
8. **Historical Sequence Gaps & Ordering:** Ledger entries created prior to Phase 6 (and entries from `/api/transfers` and `/api/transfers/:id/reversal`) have `account_entry_sequence = NULL`. Statements order legacy/unsequenced entries chronologically by `created_at ASC, id ASC` before sequenced entries ordered by `account_entry_sequence ASC`.
9. **Statement Offset Pagination:** Statements use SQL `LIMIT / OFFSET` over a total-ordered result set. In an active banking environment, concurrent transactions committed between page requests may cause entries to shift across page boundaries.
10. **Nonexistent Account Refusals & Audit Scope:** Refused attempts targeting a nonexistent account UUID have `account_id = NULL` in `audit_refused_attempts` and cannot appear on any specific account statement; anonymous `401` requests are not audited to prevent unauthenticated DB flooding.
11. **Security Boundary & Scheduled Reconciliation:** Express JWT middleware (`authenticateJWT` and `requireRole`) is the sole authentication/authorization boundary for HTTP users; PostgreSQL `SECURITY DEFINER` functions enforce internal database invariants only. Periodic ledger reconciliation queries comparing `accounts.balance_paise` against $\sum (\text{credits} - \text{debits})$ are a recommended operational control and are not implemented as an automated scheduled service (see [`THREATS.md`](file:///d:/LedgerLine/THREATS.md)).
12. **Client Session Storage:** The React frontend stores authentication tokens in-memory with a tab-scoped fallback in `sessionStorage` (`ledgerline_session_token`) to survive page reloads. Same-origin scripts within the tab lifecycle can access `sessionStorage`; persistent `localStorage` is intentionally avoided.

---

## 🧪 Verification & Test Metrics

- **Backend Automated Tests:** **178 passed, 178 total** across 16 Jest suites (`npm --prefix backend test`).
- **Frontend Automated Tests:** **120 passed, 120 total** across 10 Vitest files (`npm --prefix frontend test -- --run`).
- **Combined Project Test Suite:** **298 passed, 298 total (0 failures)**.
- **Frontend Production Build:** **Compiled cleanly** (`npm --prefix frontend run build`, 75 modules transformed into `frontend/dist/`).

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
- [x] **Phase 9: Render Live Deployment, Redis Lifecycle Fix, Admin User Directory, Transfer BigInt Precision & BalanceVault Rebranding** *(verified locally; Render deployment of post-`0511130` local enhancements and live production transaction testing pending push)*
