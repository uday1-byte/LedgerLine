-- =============================================================================
-- Migration: 004_create_users_and_authentication.sql
-- Description: Phase 5 Authentication & Role-Based Access Control (RBAC)
--              - Creates users table with bcrypt password hashing support
--              - Enforces three distinct roles: admin, account_holder, auditor
--              - Adds user_id foreign key to accounts for strict account ownership
--              - Enforces least-privilege column grants for ledgerline_app on users & accounts
--              - Implements concurrency-safe invariant functions for admin operations
--              - Secures one-time initial admin bootstrap (restricted to ledgerline_owner)
--
-- Security Architecture & Trust Boundary Documentation:
-- -----------------------------------------------------------------------------
-- 1. Trust Boundary:
--    PostgreSQL connects via a shared connection pool under the runtime role 'ledgerline_app'.
--    PostgreSQL CANNOT independently identify the authenticated HTTP end-user on pooled sessions.
--    The application layer (Express: authenticateJWT + live DB lookup + requireRole('admin'))
--    is the authoritative security boundary for HTTP caller identity and RBAC authorization.
-- 2. Database Invariant Enforcement:
--    The SECURITY DEFINER administrative functions below do NOT authenticate the HTTP caller.
--    Instead, they enforce critical database-level invariants, transactional advisory locks,
--    and least-privilege boundary rules:
--      - Last-admin protection: An active admin cannot be demoted or deactivated if it would
--        leave zero active administrators.
--      - System equity isolation: The system equity account can never be owned by a user.
--      - Ownership immutability: An assigned account user_id cannot be reassigned or stolen.
--      - Admin bootstrap isolation: The initial admin bootstrap is strictly executable by
--        'ledgerline_owner' only, with transactional advisory locking against race conditions.
-- =============================================================================

-- ─── 1. Users Table ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username VARCHAR(64) NOT NULL UNIQUE,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(32) NOT NULL DEFAULT 'account_holder'
        CHECK (role IN ('admin', 'account_holder', 'auditor')),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Lookup and query indexes
CREATE INDEX IF NOT EXISTS idx_users_username ON public.users(username);
CREATE INDEX IF NOT EXISTS idx_users_email ON public.users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON public.users(role);

-- ─── 2. Link Accounts to Users (Account Ownership) ───────────────────────────

-- Add nullable user_id to accounts (nullable to accommodate System Equity Account and system-owned accounts)
ALTER TABLE public.accounts
ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES public.users(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_accounts_user_id ON public.accounts(user_id);

-- ─── 3. Account Ownership Immutability Trigger ───────────────────────────────

CREATE OR REPLACE FUNCTION prevent_account_ownership_reassignment()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
    -- System equity account can never have a user owner (enforced on both INSERT and UPDATE)
    IF NEW.account_type = 'system_equity' AND NEW.user_id IS NOT NULL THEN
        RAISE EXCEPTION 'LL007: System equity account cannot have a user owner'
            USING ERRCODE = 'check_violation';
    END IF;

    -- Once assigned, account ownership cannot be changed to another user or cleared (UPDATE only)
    IF TG_OP = 'UPDATE' THEN
        IF OLD.user_id IS NOT NULL AND NEW.user_id IS DISTINCT FROM OLD.user_id THEN
            RAISE EXCEPTION 'LL007: Account ownership is immutable once assigned'
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_account_ownership_reassignment ON public.accounts;
CREATE TRIGGER trg_prevent_account_ownership_reassignment
    BEFORE INSERT OR UPDATE OF user_id, account_type ON public.accounts
    FOR EACH ROW
    EXECUTE FUNCTION prevent_account_ownership_reassignment();

-- ─── 4. Race-Safe One-Time Initial Administrator Bootstrap ───────────────────

CREATE OR REPLACE FUNCTION admin_bootstrap_seed(
    p_username VARCHAR,
    p_email VARCHAR,
    p_password_hash VARCHAR
)
RETURNS TABLE (
    id UUID,
    username VARCHAR,
    email VARCHAR,
    role VARCHAR,
    is_active BOOLEAN,
    created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_existing_admins INT;
    v_user public.users%ROWTYPE;
BEGIN
    -- Acquire transaction-level advisory lock to serialize concurrent bootstrap executions
    PERFORM pg_advisory_xact_lock(hashtext('seed_admin_bootstrap'));

    -- Invariant: Bootstrap only succeeds if zero active administrators exist
    SELECT COUNT(*) INTO v_existing_admins
    FROM public.users
    WHERE role = 'admin' AND is_active = TRUE;

    IF v_existing_admins > 0 THEN
        RAISE EXCEPTION 'LL007: Initial administrator already exists'
            USING ERRCODE = 'check_violation';
    END IF;

    -- Insert first administrator
    INSERT INTO public.users (username, email, password_hash, role, is_active)
    VALUES (p_username, p_email, p_password_hash, 'admin', TRUE)
    RETURNING * INTO v_user;

    RETURN QUERY
    SELECT v_user.id, v_user.username, v_user.email, v_user.role, v_user.is_active, v_user.created_at;
END;
$$;

-- ─── 5. Administrative Invariant Enforcement Functions ──────────────────────

-- 5.1 Admin Role Update (with Last-Admin Protection & Advisory Lock Serialization)
CREATE OR REPLACE FUNCTION admin_update_user_role(
    p_target_user_id UUID,
    p_new_role VARCHAR
)
RETURNS TABLE (
    id UUID,
    username VARCHAR,
    email VARCHAR,
    role VARCHAR,
    is_active BOOLEAN,
    updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_target public.users%ROWTYPE;
    v_remaining_admins INT;
BEGIN
    IF p_new_role NOT IN ('admin', 'account_holder', 'auditor') THEN
        RAISE EXCEPTION 'LL007: Invalid user role: %', p_new_role
            USING ERRCODE = 'check_violation';
    END IF;

    -- Serialize admin membership mutations across concurrent transactions
    PERFORM pg_advisory_xact_lock(hashtext('admin_membership_lock'));

    -- Lock target user row
    SELECT * INTO v_target
    FROM public.users
    WHERE id = p_target_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'LL002: User not found: %', p_target_user_id
            USING ERRCODE = 'no_data_found';
    END IF;

    -- Invariant: Cannot demote the last active administrator
    IF v_target.role = 'admin' AND v_target.is_active = TRUE AND p_new_role != 'admin' THEN
        SELECT COUNT(*) INTO v_remaining_admins
        FROM public.users
        WHERE role = 'admin' AND is_active = TRUE AND id != p_target_user_id;

        IF v_remaining_admins = 0 THEN
            RAISE EXCEPTION 'LL007: Cannot demote the last active administrator'
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;

    UPDATE public.users
    SET role = p_new_role, updated_at = NOW()
    WHERE id = p_target_user_id
    RETURNING * INTO v_target;

    RETURN QUERY
    SELECT v_target.id, v_target.username, v_target.email, v_target.role, v_target.is_active, v_target.updated_at;
END;
$$;

-- 5.2 Admin User Status Update (with Last-Admin Protection & Advisory Lock Serialization)
CREATE OR REPLACE FUNCTION admin_set_user_status(
    p_target_user_id UUID,
    p_is_active BOOLEAN
)
RETURNS TABLE (
    id UUID,
    username VARCHAR,
    email VARCHAR,
    role VARCHAR,
    is_active BOOLEAN,
    updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_target public.users%ROWTYPE;
    v_remaining_admins INT;
BEGIN
    -- Serialize admin membership mutations across concurrent transactions
    PERFORM pg_advisory_xact_lock(hashtext('admin_membership_lock'));

    -- Lock target user row
    SELECT * INTO v_target
    FROM public.users
    WHERE id = p_target_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'LL002: User not found: %', p_target_user_id
            USING ERRCODE = 'no_data_found';
    END IF;

    -- Invariant: Cannot deactivate the last active administrator
    IF v_target.role = 'admin' AND v_target.is_active = TRUE AND p_is_active = FALSE THEN
        SELECT COUNT(*) INTO v_remaining_admins
        FROM public.users
        WHERE role = 'admin' AND is_active = TRUE AND id != p_target_user_id;

        IF v_remaining_admins = 0 THEN
            RAISE EXCEPTION 'LL007: Cannot deactivate the last active administrator'
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;

    UPDATE public.users
    SET is_active = p_is_active, updated_at = NOW()
    WHERE id = p_target_user_id
    RETURNING * INTO v_target;

    RETURN QUERY
    SELECT v_target.id, v_target.username, v_target.email, v_target.role, v_target.is_active, v_target.updated_at;
END;
$$;

-- 5.3 Admin Account Ownership Assignment
CREATE OR REPLACE FUNCTION admin_assign_account_owner(
    p_account_id UUID,
    p_target_user_id UUID
)
RETURNS TABLE (
    id UUID,
    account_number VARCHAR,
    account_type VARCHAR,
    user_id UUID,
    updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_account public.accounts%ROWTYPE;
    v_user public.users%ROWTYPE;
BEGIN
    -- Lock target account row
    SELECT * INTO v_account
    FROM public.accounts
    WHERE id = p_account_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'LL002: Account not found: %', p_account_id
            USING ERRCODE = 'no_data_found';
    END IF;

    -- Invariant: Cannot assign user ownership to system accounts (matches existing account_type column)
    IF v_account.account_type = 'system_equity' THEN
        RAISE EXCEPTION 'LL007: Cannot assign user ownership to system equity account'
            USING ERRCODE = 'check_violation';
    END IF;

    -- Invariant: Account ownership is immutable once assigned
    IF v_account.user_id IS NOT NULL AND v_account.user_id != p_target_user_id THEN
        RAISE EXCEPTION 'LL007: Account ownership is immutable once assigned'
            USING ERRCODE = 'check_violation';
    END IF;

    -- Verify target user exists and is active
    SELECT * INTO v_user
    FROM public.users
    WHERE id = p_target_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'LL002: User not found: %', p_target_user_id
            USING ERRCODE = 'no_data_found';
    END IF;

    IF v_user.is_active = FALSE THEN
        RAISE EXCEPTION 'LL007: Cannot assign account to inactive user'
            USING ERRCODE = 'check_violation';
    END IF;

    UPDATE public.accounts
    SET user_id = p_target_user_id, updated_at = NOW()
    WHERE id = p_account_id
    RETURNING * INTO v_account;

    RETURN QUERY
    SELECT v_account.id, v_account.account_number, v_account.account_type, v_account.user_id, v_account.updated_at;
END;
$$;

-- ─── 6. Least-Privilege Grants & Access Control ──────────────────────────────

-- 6.1 Schema-level privilege hardening:
-- Prevent PUBLIC and untrusted roles from creating objects in schema public (protects against search_path hijack)
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ledgerline_app') THEN
        -- Ensure ledgerline_app can resolve schema public objects but cannot create new objects
        REVOKE CREATE ON SCHEMA public FROM ledgerline_app;
        GRANT USAGE ON SCHEMA public TO ledgerline_app;

        -- 6.2 Users Table:
        -- Read access for authentication, profile queries, and live role lookups
        REVOKE ALL ON TABLE public.users FROM PUBLIC;
        GRANT SELECT ON TABLE public.users TO ledgerline_app;

        -- Column-level INSERT: ledgerline_app can ONLY insert username, email, and password_hash.
        -- role (default 'account_holder'), is_active (default TRUE), id, created_at, and updated_at
        -- are populated exclusively via database column defaults.
        -- Direct SQL cannot explicitly specify role='admin', role='auditor', or set is_active.
        REVOKE INSERT ON TABLE public.users FROM PUBLIC, ledgerline_app;
        GRANT INSERT (username, email, password_hash) ON TABLE public.users TO ledgerline_app;

        -- Explicitly restrict UPDATE: ledgerline_app CANNOT update role or is_active directly.
        -- Only password_hash and updated_at can be updated directly by runtime role.
        REVOKE UPDATE, DELETE, TRUNCATE ON TABLE public.users FROM PUBLIC, ledgerline_app;
        GRANT UPDATE (password_hash, updated_at) ON TABLE public.users TO ledgerline_app;

        -- 6.3 Accounts Table:
        -- Strict least-privilege INSERT: ledgerline_app can ONLY insert account_number.
        -- All other columns (id, balance_paise, account_type, created_at, updated_at, user_id)
        -- rely strictly on database defaults: balance_paise=0, account_type='customer', user_id=NULL.
        -- Direct SQL cannot insert arbitrary initial balances, assign user ownership, or create system accounts.
        REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.accounts FROM PUBLIC, ledgerline_app;
        GRANT INSERT (account_number) ON TABLE public.accounts TO ledgerline_app;

        -- Column-level UPDATE: Prevent direct UPDATE on accounts.user_id by ledgerline_app.
        -- Ownership assignment must go through admin_assign_account_owner().
        GRANT UPDATE (balance_paise, updated_at, opening_balance_captured_at)
            ON TABLE public.accounts TO ledgerline_app;

        -- 6.4 Administrative Functions:
        -- Bootstrap function is strictly RESTRICTED to ledgerline_owner. ledgerline_app has ZERO execute access.
        REVOKE ALL ON FUNCTION admin_bootstrap_seed(VARCHAR, VARCHAR, VARCHAR) FROM PUBLIC, ledgerline_app;
        GRANT EXECUTE ON FUNCTION admin_bootstrap_seed(VARCHAR, VARCHAR, VARCHAR) TO ledgerline_owner;

        -- Admin invariant functions are granted to ledgerline_app (invoked by Express admin routes after requireRole('admin'))
        REVOKE ALL ON FUNCTION admin_update_user_role(UUID, VARCHAR) FROM PUBLIC;
        REVOKE ALL ON FUNCTION admin_set_user_status(UUID, BOOLEAN) FROM PUBLIC;
        REVOKE ALL ON FUNCTION admin_assign_account_owner(UUID, UUID) FROM PUBLIC;

        GRANT EXECUTE ON FUNCTION admin_update_user_role(UUID, VARCHAR) TO ledgerline_app;
        GRANT EXECUTE ON FUNCTION admin_set_user_status(UUID, BOOLEAN) TO ledgerline_app;
        GRANT EXECUTE ON FUNCTION admin_assign_account_owner(UUID, UUID) TO ledgerline_app;
    END IF;
END;
$$;
