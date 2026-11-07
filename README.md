# ⚖️ LedgerLine - Financial Ledger Application

LedgerLine is a secure, double-entry financial ledger application engineered for high-integrity financial transactions, immutability, and compliance.

This repository is organized as a clean full-stack workspace featuring an Express REST API backend, a React/Vite frontend, and a PostgreSQL relational database.

---

## 🛠️ Technology Stack

| Layer | Technology | Details |
| :--- | :--- | :--- |
| **Frontend** | React 18, Vite | High-performance single page application with modern component architecture |
| **Backend** | Node.js (v22+), Express | RESTful API server with centralized middleware, error handling, and routing |
| **Database** | PostgreSQL 18.6 | Relational database (`ledgerline_dev` on port 5432) |
| **Database Access** | `node-postgres` (`pg`) | High-performance connection pool (`pg.Pool`) with parameterized queries |
| **Validation** | Zod | Runtime schema validation for environment variables and API payloads |
| **Authentication** | JWT (`jsonwebtoken`), `bcryptjs` | Stateless session tokens and salted password hashing |
| **Testing** | Jest, Supertest | Comprehensive unit and API integration testing suite |

---

## 📂 Project Structure

```text
LedgerLine/
├── .env.example              # Template for root/global environment variables
├── .gitignore                # Git ignore rules for node_modules, .env, build outputs
├── package.json              # Root workspace scripts (dev, test, start)
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
│   │   └── routes/
│   │       └── health.js     # Health check endpoint (GET /api/health)
│   └── tests/
│       └── health.test.js    # Supertest integration tests for health endpoints
│
├── frontend/                 # React 18 + Vite frontend client
│   ├── .env.example          # Frontend-specific environment variables template
│   ├── index.html            # Vite HTML entry point
│   ├── package.json          # Frontend dependencies and scripts
│   ├── package-lock.json     # Locked dependency graph
│   ├── vite.config.js        # Vite configuration with /api reverse proxy to port 5000
│   └── src/
│       ├── main.jsx          # React DOM root render
│       ├── App.jsx           # Main dashboard component with live health check card
│       └── index.css         # Modern typography and layout styling
│
└── database/                 # Database schema and migration management
    ├── README.md             # Migration documentation and conventions
    └── migrations/           # Versioned SQL migration scripts (.sql)
```

---

## 🚀 Getting Started (Beginner-Friendly Guide)

### 1. Prerequisites
- **Node.js**: v20 or v22 installed (Confirm with `node -v`)
- **PostgreSQL**: PostgreSQL 18.6 installed and running locally on port 5432
- **Database**: Database named `ledgerline_dev` created in PostgreSQL

### 2. Environment Configuration
Copy the provided `.env.example` into a new `.env` file inside the `backend` directory:

```bash
# On Windows PowerShell:
Copy-Item backend\.env.example backend\.env
```

Open `backend\.env` in your editor and set your PostgreSQL password:
```env
PORT=5000
NODE_ENV=development

DB_HOST=localhost
DB_PORT=5432
DB_NAME=ledgerline_dev
DB_USER=postgres
DB_PASSWORD=your_actual_postgres_password_here

JWT_SECRET=your_super_secret_jwt_key_at_least_32_characters
JWT_EXPIRES_IN=24h
CLIENT_URL=http://localhost:5173
```
> **Security Reminder:** Never commit the `.env` file to git. It is protected by `.gitignore`.

---

## 💻 Commands to Run the Project

You can run commands directly from the root workspace or from within each subdirectory.

### From Root Directory:

| Command | Action |
| :--- | :--- |
| `npm run dev:backend` | Starts the Express API server with live reload (`nodemon`) on port 5000 |
| `npm run dev:frontend` | Starts the Vite React dev server with Hot Module Reloading on port 5173 |
| `npm run test:backend` | Executes the Jest and Supertest test suites |
| `npm run build:frontend` | Compiles the production React bundle into `frontend/dist` |

### Or Individually:

#### Backend
```bash
cd backend
npm run dev      # Run backend with nodemon live reload
npm test         # Run backend test suite
npm start        # Run backend production server
```

#### Frontend
```bash
cd frontend
npm run dev      # Start React development server at http://localhost:5173
npm run build    # Build for production
```

---

## 🩺 Health Check Endpoint

The API includes a health check endpoint:

- **Endpoint:** `GET /api/health`
- **Optional Parameter:** `GET /api/health?db=true` (tests live database connection)
- **Response Format:**
```json
{
  "status": "healthy",
  "service": "LedgerLine API",
  "environment": "development",
  "uptime": "4.2s",
  "timestamp": "2026-11-07T10:15:00.000Z",
  "database": {
    "status": "untested"
  }
}
```

---

## 🧪 Testing

Automated testing is configured using **Jest** and **Supertest**. Tests run without needing to launch a standalone server because `app.js` is isolated from `server.js`.

To run backend tests:
```bash
npm run test:backend
```

---

## 🔒 Security Principles
- **No Hardcoded Secrets:** All credentials are loaded via validated environment variables.
- **Threat Modeling:** Read [THREATS.md](file:///d:/LedgerLine/THREATS.md) for domain-specific security rules (double-spending, floating-point rounding, immutability).
- **Parameterized SQL:** All database interactions in subsequent phases will use `$1, $2` parameterized queries to eliminate SQL injection.
- **Append-Only Ledger:** Historical financial transactions will never be updated or deleted; adjustments are handled via offsetting entries.

---

## 🗺️ Roadmap
- [x] **Phase 1: Initial Foundation & Workspace Setup** (Current)
- [ ] **Phase 2: Database Schema & Migration Runner** (Awaiting approval)
- [ ] **Phase 3: User Authentication & Account Management**
- [ ] **Phase 4: Double-Entry Transaction Engine & Invariants**
- [ ] **Phase 5: Financial Reporting, Audit Logs & Frontend Integration**
