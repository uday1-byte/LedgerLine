-- =============================================================================
-- Migration: 005_fix_admin_function_column_ambiguity.sql
-- Description: Correct PL/pgSQL column reference ambiguity (SQLSTATE 42702)
--              in administrative functions by qualifying all table column
--              references with explicit table aliases (u., a.).
--
-- Defect:
-- In migration 004, administrative functions declared RETURNS TABLE (id UUID, ...)
-- which defined PL/pgSQL output variables named 'id', 'role', 'is_active', etc.
-- Unqualified column references in WHERE clauses caused PostgreSQL to raise
-- error 42702 ('column reference "id" is ambiguous') before reaching invariant logic.
--
-- Safety & Invariant Guarantees:
-- - Uses CREATE OR REPLACE FUNCTION (preserves function OIDs, ownership, and grants).
-- - Explicitly schema-qualifies all function names (public.*).
-- - Signatures, parameter types, and return table shapes are 100% identical.
-- - Retains SECURITY DEFINER and search_path = pg_catalog, public, pg_temp.
-- - Preserves advisory lock serialization (seed_admin_bootstrap, admin_membership_lock).
-- - Preserves all invariant checks and LL002/LL007 error codes.
-- - Idempotently reaffirms least-privilege EXECUTE grants on public.* functions.
-- =============================================================================

-- ─── 1. Fix admin_bootstrap_seed ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_bootstrap_seed(
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
    -- Qualify u.role and u.is_active to avoid collision with output parameters
    SELECT COUNT(*) INTO v_existing_admins
    FROM public.users u
    WHERE u.role = 'admin' AND u.is_active = TRUE;

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

-- ─── 2. Fix admin_update_user_role ───────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_update_user_role(
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

    -- Lock target user row using alias u.id
    SELECT * INTO v_target
    FROM public.users u
    WHERE u.id = p_target_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'LL002: User not found: %', p_target_user_id
            USING ERRCODE = 'no_data_found';
    END IF;

    -- Invariant: Cannot demote the last active administrator
    -- Qualify u.role, u.is_active, and u.id to prevent collision with output table columns
    IF v_target.role = 'admin' AND v_target.is_active = TRUE AND p_new_role != 'admin' THEN
        SELECT COUNT(*) INTO v_remaining_admins
        FROM public.users u
        WHERE u.role = 'admin' AND u.is_active = TRUE AND u.id != p_target_user_id;

        IF v_remaining_admins = 0 THEN
            RAISE EXCEPTION 'LL007: Cannot demote the last active administrator'
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;

    UPDATE public.users u
    SET role = p_new_role, updated_at = NOW()
    WHERE u.id = p_target_user_id
    RETURNING * INTO v_target;

    RETURN QUERY
    SELECT v_target.id, v_target.username, v_target.email, v_target.role, v_target.is_active, v_target.updated_at;
END;
$$;

-- ─── 3. Fix admin_set_user_status ───────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_set_user_status(
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

    -- Lock target user row using alias u.id
    SELECT * INTO v_target
    FROM public.users u
    WHERE u.id = p_target_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'LL002: User not found: %', p_target_user_id
            USING ERRCODE = 'no_data_found';
    END IF;

    -- Invariant: Cannot deactivate the last active administrator
    -- Qualify u.role, u.is_active, and u.id
    IF v_target.role = 'admin' AND v_target.is_active = TRUE AND p_is_active = FALSE THEN
        SELECT COUNT(*) INTO v_remaining_admins
        FROM public.users u
        WHERE u.role = 'admin' AND u.is_active = TRUE AND u.id != p_target_user_id;

        IF v_remaining_admins = 0 THEN
            RAISE EXCEPTION 'LL007: Cannot deactivate the last active administrator'
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;

    UPDATE public.users u
    SET is_active = p_is_active, updated_at = NOW()
    WHERE u.id = p_target_user_id
    RETURNING * INTO v_target;

    RETURN QUERY
    SELECT v_target.id, v_target.username, v_target.email, v_target.role, v_target.is_active, v_target.updated_at;
END;
$$;

-- ─── 4. Fix admin_assign_account_owner ───────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_assign_account_owner(
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
    -- Lock target account row using alias a.id
    SELECT * INTO v_account
    FROM public.accounts a
    WHERE a.id = p_account_id
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

    -- Verify target user exists and is active using alias u.id
    SELECT * INTO v_user
    FROM public.users u
    WHERE u.id = p_target_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'LL002: User not found: %', p_target_user_id
            USING ERRCODE = 'no_data_found';
    END IF;

    IF v_user.is_active = FALSE THEN
        RAISE EXCEPTION 'LL007: Cannot assign account to inactive user'
            USING ERRCODE = 'check_violation';
    END IF;

    UPDATE public.accounts a
    SET user_id = p_target_user_id, updated_at = NOW()
    WHERE a.id = p_account_id
    RETURNING * INTO v_account;

    RETURN QUERY
    SELECT v_account.id, v_account.account_number, v_account.account_type, v_account.user_id, v_account.updated_at;
END;
$$;

-- ─── 5. Re-affirm Least-Privilege Grants ─────────────────────────────────────

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ledgerline_app') THEN
        REVOKE ALL ON FUNCTION public.admin_bootstrap_seed(VARCHAR, VARCHAR, VARCHAR) FROM PUBLIC, ledgerline_app;
        GRANT EXECUTE ON FUNCTION public.admin_bootstrap_seed(VARCHAR, VARCHAR, VARCHAR) TO ledgerline_owner;

        REVOKE ALL ON FUNCTION public.admin_update_user_role(UUID, VARCHAR) FROM PUBLIC;
        REVOKE ALL ON FUNCTION public.admin_set_user_status(UUID, BOOLEAN) FROM PUBLIC;
        REVOKE ALL ON FUNCTION public.admin_assign_account_owner(UUID, UUID) FROM PUBLIC;

        GRANT EXECUTE ON FUNCTION public.admin_update_user_role(UUID, VARCHAR) TO ledgerline_app;
        GRANT EXECUTE ON FUNCTION public.admin_set_user_status(UUID, BOOLEAN) TO ledgerline_app;
        GRANT EXECUTE ON FUNCTION public.admin_assign_account_owner(UUID, UUID) TO ledgerline_app;
    END IF;
END;
$$;
