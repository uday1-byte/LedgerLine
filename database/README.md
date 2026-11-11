# BalanceVault Database (PostgreSQL)

This directory contains version-controlled PostgreSQL SQL migrations and least-privilege role provisioning scripts for **BalanceVault** (originally initialized as LedgerLine).

## Structure

- `provision_roles.sql`: Provisions the schema-owner role (`ledgerline_owner`) and restricted runtime role (`ledgerline_app`), and revokes default `PUBLIC` privileges.
- `migrations/`: Forward-only, idempotent SQL migration scripts tracked via `public.schema_migrations`:
  - `001_create_accounts_and_transfers.sql` — Core `accounts` and `transfers` tables with integer `BIGINT` paise amounts.
  - `002_create_ledger_entries_and_idempotency.sql` — Append-only `ledger_entries`, `idempotency_keys`, immutability triggers (`LL007`), and deferred double-entry balancing trigger (`LL001`–`LL004`).
  - `003_fix_verify_transfer_balance_uuid_aggregation.sql` — UUID aggregation fix for transfer balancing verification.
  - `004_create_users_and_authentication.sql` — `users` table, role checks, ownership foreign key, and `SECURITY DEFINER` governance/bootstrap functions.
  - `005_fix_admin_function_column_ambiguity.sql` — Column qualification fix for administrative SQL functions.
  - `006_complete_banking_functionality.sql` — Cash clearing system account, deposits, withdrawals, `audit_refused_attempts`, and sequenced statement support.

## Role Separation & Data Access

- **`ledgerline_owner` (Migration & Bootstrap Role):** Owns `public` schema objects and executes forward-only migrations and one-time initial administrator bootstrap (`seed:admin`). Never used for HTTP runtime traffic.
- **`ledgerline_app` (Restricted Runtime Role):** Used exclusively by both the `node-postgres` (`pg`) pool (for financial transactions, row locking `FOR UPDATE`, stored functions, and audit writes) and **Prisma Client** (for ordinary read operations and health checks). Cannot alter schema, truncate tables, or bypass ledger immutability triggers.

## Migration & Verification Notes

- **Local Development (`ledgerline_dev` / `ledgerline_test`):**
  ```bash
  # Provision roles (as postgres superuser)
  psql -d ledgerline_dev -f database/provision_roles.sql

  # Apply pending migrations as ledgerline_owner
  npm run migrate:backend
  ```
- **Production (Neon PostgreSQL):** Migrations `001`–`006` and initial administrator bootstrap (`npm --prefix backend run seed:admin:production`) have already been applied and verified. Production connections enforce TLS (`sslmode=require`) and use `ledgerline_app` for runtime traffic.
- **Prisma Integration:** `backend/prisma/schema.prisma` mirrors the synchronized schema via read-only introspection (`DATABASE_URL` with `ledgerline_app`). Financial mutations remain in raw SQL transactions inside `pg.Pool`.
