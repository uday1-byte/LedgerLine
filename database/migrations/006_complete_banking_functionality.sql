-- =============================================================================
-- Migration: 006_complete_banking_functionality.sql
-- Description: Phase 6 Complete Banking Functionality Schema Migration
--              - Expands account_type CHECK constraint ('system_clearing')
--              - Expands transfer_type CHECK constraint ('deposit', 'withdrawal')
--              - Adds created_by_user_id to transfers for initiator attribution
--              - Provisions & validates SYSTEM_CASH_CLEARING account
--              - Adds phase6_cutover_balance_paise and phase6_cutover_captured_at snapshot
--              - Implements database-level cutover initialization trigger for new accounts
--              - Adds next_entry_sequence to accounts for atomic per-account sequencing
--              - Adds nullable account_entry_sequence to ledger_entries (preserving legacy records)
--              - Enforces unique index on account_entry_sequence (non-null entries)
--              - Creates append-only audit_refused_attempts table with ON DELETE RESTRICT
--              - Recreates trg_prevent_account_ownership_reassignment (BEFORE INSERT OR UPDATE)
--              - Updates SECURITY DEFINER admin_assign_account_owner function
--              - Reaffirms least-privilege grants for ledgerline_app
--
-- Migration Nature:
--   FORWARD-ONLY. Once Phase 6 deposits, withdrawals, or audit records are recorded,
--   this migration must not be rolled back, as doing so would destroy financial audit
--   records and drop columns referenced by active ledger transactions.
-- =============================================================================

-- ─── 1. Account & Transfer Constraint Expansions ─────────────────────────────

ALTER TABLE public.accounts
  DROP CONSTRAINT IF EXISTS accounts_account_type_check;

ALTER TABLE public.accounts
  ADD CONSTRAINT accounts_account_type_check
  CHECK (account_type IN ('customer', 'system_equity', 'system_clearing'));

ALTER TABLE public.transfers
  DROP CONSTRAINT IF EXISTS transfers_transfer_type_check;

ALTER TABLE public.transfers
  ADD CONSTRAINT transfers_transfer_type_check
  CHECK (transfer_type IN ('customer_transfer', 'opening_balance', 'reversal', 'deposit', 'withdrawal'));

-- ─── 2. Initiator Attribution on Transfers ───────────────────────────────────

ALTER TABLE public.transfers
  ADD COLUMN IF NOT EXISTS created_by_user_id UUID REFERENCES public.users(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_transfers_created_by_user ON public.transfers(created_by_user_id);

-- ─── 3. Provision & Verify Internal Clearing Account ─────────────────────────

INSERT INTO public.accounts (
    id,
    account_number,
    balance_paise,
    account_type,
    created_at,
    updated_at
)
VALUES (
    '00000000-0000-0000-0000-000000000002',
    'SYSTEM_CASH_CLEARING',
    0,
    'system_clearing',
    NOW(),
    NOW()
)
ON CONFLICT (id) DO NOTHING;

-- Verification: Ensure the clearing account exists and matches expected configuration exactly
DO $$
DECLARE
    v_clearing public.accounts%ROWTYPE;
BEGIN
    SELECT * INTO v_clearing
    FROM public.accounts
    WHERE id = '00000000-0000-0000-0000-000000000002';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'LL007: Failed to provision SYSTEM_CASH_CLEARING account'
            USING ERRCODE = 'check_violation';
    END IF;

    IF v_clearing.account_number <> 'SYSTEM_CASH_CLEARING' THEN
        RAISE EXCEPTION 'LL007: System clearing account UUID collision: expected account_number SYSTEM_CASH_CLEARING, found %', v_clearing.account_number
            USING ERRCODE = 'check_violation';
    END IF;

    IF v_clearing.account_type <> 'system_clearing' THEN
        RAISE EXCEPTION 'LL007: Invalid account_type for SYSTEM_CASH_CLEARING: expected system_clearing, found %', v_clearing.account_type
            USING ERRCODE = 'check_violation';
    END IF;

    IF v_clearing.user_id IS NOT NULL THEN
        RAISE EXCEPTION 'LL007: SYSTEM_CASH_CLEARING must not have a user owner (found user_id: %)', v_clearing.user_id
            USING ERRCODE = 'check_violation';
    END IF;
END;
$$;

-- ─── 4. Non-Destructive Per-Account Ledger Sequencing & Cutover Snapshot ─────

-- Record explicit cutover balance snapshot columns on accounts
ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS phase6_cutover_balance_paise BIGINT,
  ADD COLUMN IF NOT EXISTS phase6_cutover_captured_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS next_entry_sequence BIGINT NOT NULL DEFAULT 1;

-- Capture immutable cutover baseline balance for all pre-existing accounts
UPDATE public.accounts
SET phase6_cutover_balance_paise = balance_paise,
    phase6_cutover_captured_at = statement_timestamp()
WHERE phase6_cutover_captured_at IS NULL;

-- Database-level trigger to initialize cutover snapshot for accounts created after Migration 006
CREATE OR REPLACE FUNCTION public.initialize_account_cutover_snapshot()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
    -- For newly created accounts, initialize cutover baseline to initial balance and creation timestamp
    IF NEW.phase6_cutover_balance_paise IS NULL THEN
        NEW.phase6_cutover_balance_paise := COALESCE(NEW.balance_paise, 0);
    END IF;

    IF NEW.phase6_cutover_captured_at IS NULL THEN
        NEW.phase6_cutover_captured_at := statement_timestamp();
    END IF;

    IF NEW.next_entry_sequence IS NULL THEN
        NEW.next_entry_sequence := 1;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_initialize_account_cutover_snapshot ON public.accounts;
CREATE TRIGGER trg_initialize_account_cutover_snapshot
BEFORE INSERT ON public.accounts
FOR EACH ROW
EXECUTE FUNCTION public.initialize_account_cutover_snapshot();

-- Add nullable sequence column to ledger_entries (legacy Phase 1-5 entries remain NULL)
ALTER TABLE public.ledger_entries
  ADD COLUMN IF NOT EXISTS account_entry_sequence BIGINT;

-- Enforce uniqueness strictly for sequenced entries (preserves legacy unsequenced rows without mutation)
CREATE UNIQUE INDEX IF NOT EXISTS uq_ledger_entries_account_seq
  ON public.ledger_entries (account_id, account_entry_sequence)
  WHERE account_entry_sequence IS NOT NULL;

-- ─── 5. Refused-Attempt Audit Trail Table (ON DELETE RESTRICT) ────────────────

CREATE TABLE IF NOT EXISTS public.audit_refused_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.users(id) ON DELETE RESTRICT,
    account_id UUID REFERENCES public.accounts(id) ON DELETE RESTRICT,
    action VARCHAR(32) NOT NULL CHECK (action IN ('transfer', 'deposit', 'withdrawal', 'reversal')),
    attempted_amount_paise BIGINT CHECK (attempted_amount_paise > 0),
    reason_code VARCHAR(64) NOT NULL,
    reason_message TEXT NOT NULL,
    idempotency_key VARCHAR(255),
    client_ip VARCHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_refused_account ON public.audit_refused_attempts(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_refused_user ON public.audit_refused_attempts(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_refused_idempotency ON public.audit_refused_attempts(idempotency_key);

-- Set ownership to schema owner
ALTER TABLE public.audit_refused_attempts OWNER TO ledgerline_owner;

-- Immutability trigger on audit records
CREATE OR REPLACE FUNCTION public.prevent_audit_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
    RAISE EXCEPTION 'LL007: Audit records are strictly append-only: % operations are prohibited', TG_OP
        USING ERRCODE = 'check_violation';
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_audit_mutation ON public.audit_refused_attempts;
CREATE TRIGGER trg_prevent_audit_mutation
BEFORE UPDATE OR DELETE ON public.audit_refused_attempts
FOR EACH ROW
EXECUTE FUNCTION public.prevent_audit_mutation();

-- ─── 6. Protect All Non-Customer Accounts from User Ownership ────────────────

CREATE OR REPLACE FUNCTION public.prevent_account_ownership_reassignment()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
    -- No system account can ever have a user owner (enforced on both INSERT and UPDATE)
    IF NEW.account_type <> 'customer' AND NEW.user_id IS NOT NULL THEN
        RAISE EXCEPTION 'LL007: System accounts cannot have a user owner'
            USING ERRCODE = 'check_violation';
    END IF;

    -- Once assigned, customer account ownership cannot be altered or cleared (enforced on UPDATE only)
    IF TG_OP = 'UPDATE' THEN
        IF OLD.user_id IS NOT NULL AND NEW.user_id IS DISTINCT FROM OLD.user_id THEN
            RAISE EXCEPTION 'LL007: Account ownership is immutable once assigned'
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

-- Recreate trigger explicitly with BEFORE INSERT OR UPDATE event coverage
DROP TRIGGER IF EXISTS trg_prevent_account_ownership_reassignment ON public.accounts;
CREATE TRIGGER trg_prevent_account_ownership_reassignment
BEFORE INSERT OR UPDATE ON public.accounts
FOR EACH ROW
EXECUTE FUNCTION public.prevent_account_ownership_reassignment();

-- ─── 7. Security Definer Function Update: admin_assign_account_owner ──────────

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
    SELECT * INTO v_account
    FROM public.accounts a
    WHERE a.id = p_account_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'LL002: Account not found: %', p_account_id
            USING ERRCODE = 'no_data_found';
    END IF;

    -- Reject ownership assignment on ALL system accounts
    IF v_account.account_type <> 'customer' THEN
        RAISE EXCEPTION 'LL007: Cannot assign user ownership to % account', v_account.account_type
            USING ERRCODE = 'check_violation';
    END IF;

    IF v_account.user_id IS NOT NULL AND v_account.user_id != p_target_user_id THEN
        RAISE EXCEPTION 'LL007: Account ownership is immutable once assigned'
            USING ERRCODE = 'check_violation';
    END IF;

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

-- ─── 8. Least-Privilege Grants for ledgerline_app ─────────────────────────────

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ledgerline_app') THEN
        -- Allow updating next_entry_sequence alongside balance
        GRANT UPDATE (balance_paise, updated_at, opening_balance_captured_at, next_entry_sequence)
          ON TABLE public.accounts TO ledgerline_app;

        -- Grant append-only access to audit trail (no UPDATE, DELETE, or TRUNCATE)
        REVOKE ALL ON TABLE public.audit_refused_attempts FROM PUBLIC;
        REVOKE ALL ON TABLE public.audit_refused_attempts FROM ledgerline_app;
        GRANT SELECT, INSERT ON TABLE public.audit_refused_attempts TO ledgerline_app;

        -- Reaffirm EXECUTE permissions on updated admin function
        REVOKE ALL ON FUNCTION public.admin_assign_account_owner(UUID, UUID) FROM PUBLIC;
        GRANT EXECUTE ON FUNCTION public.admin_assign_account_owner(UUID, UUID) TO ledgerline_app;
    END IF;
END;
$$;
