-- =============================================================================
-- File: database/provision_roles.sql
-- Description: Reliable Fresh-Database Role Provisioning for LedgerLine
--
-- Roles:
--   1. ledgerline_owner : Migration runner & schema owner (DDL, table ownership).
--   2. ledgerline_app   : Restricted runtime application role (least privilege).
--
-- Fresh-Database Compatibility:
--   - Role creation, attribute hardening, schema ownership, and default privileges
--     execute unconditionally and succeed on an empty fresh database.
--   - Table-level grants are guarded conditionally (IF EXISTS), allowing this script
--     to run before application tables exist, and safely rerun after migrations.
--   - Production passwords are NEVER hardcoded in SQL source code (PASSWORD NULL).
-- =============================================================================

-- ─── 1. Provision Roles Idempotently (Without Overwriting Existing Passwords) ─
DO $$
BEGIN
    -- Migration & Schema Owner
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ledgerline_owner') THEN
        CREATE ROLE ledgerline_owner WITH LOGIN PASSWORD NULL;
    END IF;

    -- Runtime Application User
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ledgerline_app') THEN
        CREATE ROLE ledgerline_app WITH LOGIN PASSWORD NULL;
    END IF;
END;
$$;

-- ─── 2. Harden Role Attributes ────────────────────────────────────────────────
ALTER ROLE ledgerline_owner WITH
    NOSUPERUSER
    NOCREATEDB
    NOCREATEROLE
    NOINHERIT
    NOBYPASSRLS;

ALTER ROLE ledgerline_app WITH
    NOSUPERUSER
    NOCREATEDB
    NOCREATEROLE
    NOINHERIT
    NOBYPASSRLS;

-- ─── 3. Schema Ownership & Usage Grants ───────────────────────────────────────
ALTER SCHEMA public OWNER TO ledgerline_owner;
GRANT USAGE, CREATE ON SCHEMA public TO ledgerline_owner;

-- Allow application to resolve objects in public schema, but NOT create new objects
GRANT USAGE ON SCHEMA public TO ledgerline_app;
REVOKE CREATE ON SCHEMA public FROM ledgerline_app;

-- Revoke all implicit default privileges from the PUBLIC pseudo-role
REVOKE ALL ON SCHEMA public FROM PUBLIC;

-- ─── 4. Default Privileges for Future Migrations ──────────────────────────────
-- Ensure future tables, sequences, and functions created by ledgerline_owner
-- do NOT expose permissions to the PUBLIC pseudo-role.
ALTER DEFAULT PRIVILEGES FOR ROLE ledgerline_owner IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE ledgerline_owner IN SCHEMA public REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE ledgerline_owner IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM PUBLIC;

-- ─── 5. Conditional Table Grants (For Reruns & Post-Migration Verification) ──
-- On a fresh database, this block safely skips non-existent tables without error.
-- After migrations run, or when rerun by the DBA, it ensures proper ownership and grants.
DO $$
BEGIN
    -- accounts
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'accounts') THEN
        ALTER TABLE public.accounts OWNER TO ledgerline_owner;
        REVOKE ALL ON TABLE public.accounts FROM PUBLIC;
        REVOKE ALL ON TABLE public.accounts FROM ledgerline_app;
        GRANT SELECT ON TABLE public.accounts TO ledgerline_app;
        GRANT INSERT (account_number) ON TABLE public.accounts TO ledgerline_app;
        GRANT UPDATE (balance_paise, updated_at, opening_balance_captured_at) ON TABLE public.accounts TO ledgerline_app;
    END IF;

    -- users
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'users') THEN
        ALTER TABLE public.users OWNER TO ledgerline_owner;
        REVOKE ALL ON TABLE public.users FROM PUBLIC;
        REVOKE ALL ON TABLE public.users FROM ledgerline_app;
        GRANT SELECT ON TABLE public.users TO ledgerline_app;
        GRANT INSERT (username, email, password_hash) ON TABLE public.users TO ledgerline_app;
        GRANT UPDATE (password_hash, updated_at) ON TABLE public.users TO ledgerline_app;
    END IF;

    -- transfers
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'transfers') THEN
        ALTER TABLE public.transfers OWNER TO ledgerline_owner;
        REVOKE ALL ON TABLE public.transfers FROM PUBLIC;
        GRANT SELECT, INSERT ON TABLE public.transfers TO ledgerline_app;
    END IF;

    -- ledger_entries
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'ledger_entries') THEN
        ALTER TABLE public.ledger_entries OWNER TO ledgerline_owner;
        REVOKE ALL ON TABLE public.ledger_entries FROM PUBLIC;
        GRANT SELECT, INSERT ON TABLE public.ledger_entries TO ledgerline_app;
    END IF;

    -- idempotency_keys
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'idempotency_keys') THEN
        ALTER TABLE public.idempotency_keys OWNER TO ledgerline_owner;
        REVOKE ALL ON TABLE public.idempotency_keys FROM PUBLIC;
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.idempotency_keys TO ledgerline_app;
    END IF;

    -- schema_migrations
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'schema_migrations') THEN
        ALTER TABLE public.schema_migrations OWNER TO ledgerline_owner;
        REVOKE ALL ON TABLE public.schema_migrations FROM PUBLIC;
        REVOKE ALL ON TABLE public.schema_migrations FROM ledgerline_app;
    END IF;
END;
$$;
