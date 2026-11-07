# LedgerLine - Prompt & Engineering Log

This document records the user prompts, agent decisions, design rationales, and execution history across the development lifecycle of LedgerLine.

---

## Phase 1: Initial Foundation & Workspace Setup

### User Request
> "I am a beginner building a project called LedgerLine for a financial application hiring challenge.
> Technology stack:
> - Frontend: React with Vite
> - Backend: Node.js with Express
> - Database: PostgreSQL (PostgreSQL 18.6 installed, database `ledgerline_dev` on port 5432)
> - Database access: node-postgres (pg)
> - Authentication: JWT and bcrypt
> - Validation: Zod
> - Testing: Jest and Supertest
> 
> Perform ONLY the initial project setup:
> 1. Inspect the workspace and confirm location.
> 2. Propose a clean folder structure for frontend, backend, database, tests.
> 3. Set up basic React/Vite frontend and Express backend.
> 4. Add a simple backend health-check endpoint.
> 5. Prepare PostgreSQL connection configuration using environment variables.
> 6. Create `.env.example` file with placeholder values.
> 7. Add `.gitignore`.
> 8. Create initial README.md, PROMPTS.md, and THREATS.md files.
> 9. Explain every important file and the commands needed to run the project.
> 10. Use compatible stable package versions and keep package-lock files.
> 
> Rules: Do not implement financial transactions yet. Do not create tables or modify database yet. Do not deploy anything. Do not expose passwords or secrets. Explain in beginner-friendly language. Ask for approval before moving to next phase."

### Decisions & Implementation Details

1. **Workspace Inspection:**
   - Workspace verified at `d:\LedgerLine`.
   - Node.js v22.19.0 and npm 10.9.3 detected.
   - Identified Windows PowerShell execution policy for npm scripts; standardized on `npm.cmd` invocations.

2. **Clean Monorepo / Multi-Folder Architecture:**
   - Organized into distinct directories:
     - `backend/`: API server, configuration, routes, tests.
     - `frontend/`: React + Vite single page application with API proxy.
     - `database/`: Dedicated area for SQL migration scripts and schema documentation.
   - Added root `package.json` with helper scripts to run both ends conveniently from the root directory.

3. **Separation of Concerns for Testing (`app.js` vs `server.js`):**
   - Separated Express application setup (`app.js`) from network socket binding (`server.js`).
   - Benefit: Jest and Supertest can import `app.js` and execute fast HTTP assertions in-memory without conflicting with live server ports.

4. **Robust Configuration with Zod:**
   - Implemented `backend/src/config/env.js` which validates environment variables using Zod schemas and provides clear defaults for local development.

5. **Safe Database Pool Configuration:**
   - Implemented `backend/src/config/db.js` using `pg.Pool`.
   - All connection credentials read from environment variables; no credentials hardcoded.
   - Guarded query helpers and a lightweight `testConnection()` function that does not alter any database state.

6. **Health Check Endpoint (`GET /api/health`):**
   - Returns JSON status containing uptime, service name, environment, and server timestamp.
   - Optionally tests database connectivity when requested (`?db=true`), safely handling offline database scenarios.

7. **Security & Threat Model:**
   - Authored `THREATS.md` addressing financial-specific threats (double-spending, floating-point rounding errors, transaction immutability, STRIDE model).

---

## Next Planned Prompts (Pending Approval)

- **Phase 2 (Proposed):** Database Schema Design & Migration Scripts
  - Define user accounts, ledger accounts, transactions, and transaction entry (double-entry) tables.
  - Implement migration runner using pure SQL / `pg`.
  - Validate schema against financial integrity rules (integer currency minor units, immutable audit logs).
