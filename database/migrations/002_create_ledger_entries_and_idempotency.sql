-- =============================================================================
-- Migration: 002_create_ledger_entries_and_idempotency.sql
-- Description: Phase 4 Double-Entry Ledger, Append-Only Immutability,
--              Database-Enforced Deferred Balancing, Idempotency State Machine,
--              Compensating Reversals, and System Equity Opening-Balance Cutover.
-- =============================================================================

-- ─── 1. Account Schema Extensions ─────────────────────────────────────────────

ALTER TABLE accounts
ADD COLUMN IF NOT EXISTS account_type VARCHAR(32) NOT NULL DEFAULT 'customer'
CHECK (account_type IN ('customer', 'system_equity'));

ALTER TABLE accounts
ADD COLUMN IF NOT EXISTS opening_balance_captured_at TIMESTAMPTZ;

-- ─── 2. Transfer Schema Extensions ───────────────────────────────────────────

ALTER TABLE transfers
ADD COLUMN IF NOT EXISTS transfer_type VARCHAR(32) NOT NULL DEFAULT 'customer_transfer'
CHECK (transfer_type IN ('customer_transfer', 'opening_balance', 'reversal'));

ALTER TABLE transfers
ADD COLUMN IF NOT EXISTS original_transfer_id UUID REFERENCES transfers(id) ON DELETE RESTRICT;

ALTER TABLE transfers
ADD COLUMN IF NOT EXISTS reversal_reason TEXT;

-- Enforce that a transfer can only be reversed once
CREATE UNIQUE INDEX IF NOT EXISTS idx_transfers_unique_reversal
ON transfers (original_transfer_id)
WHERE transfer_type = 'reversal';

-- ─── 3. Double-Entry Ledger Table ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ledger_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transfer_id UUID NOT NULL REFERENCES transfers(id) ON DELETE RESTRICT,
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    entry_type VARCHAR(8) NOT NULL CHECK (entry_type IN ('debit', 'credit')),
    amount_paise BIGINT NOT NULL CHECK (amount_paise > 0),
    balance_after_paise BIGINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- A transfer must never have duplicate debits or duplicate credits
    CONSTRAINT uq_transfer_entry_type UNIQUE (transfer_id, entry_type)
);

CREATE INDEX IF NOT EXISTS idx_ledger_entries_transfer_id ON ledger_entries(transfer_id);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_account_id_created ON ledger_entries(account_id, created_at DESC);

-- ─── 4. Append-Only Immutability Triggers ─────────────────────────────────────

-- Prevent UPDATE or DELETE on ledger entries unconditionally
CREATE OR REPLACE FUNCTION prevent_ledger_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
    RAISE EXCEPTION 'Ledger entries are strictly append-only: % operations are prohibited', TG_OP
        USING ERRCODE = 'LL007';
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_ledger_mutation ON ledger_entries;
CREATE TRIGGER trg_prevent_ledger_mutation
BEFORE UPDATE OR DELETE ON ledger_entries
FOR EACH ROW
EXECUTE FUNCTION prevent_ledger_mutation();

-- Prevent DELETE on transfers unconditionally, and prevent UPDATE on completed transfers
CREATE OR REPLACE FUNCTION prevent_transfer_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Transfer records cannot be deleted: transfer %', OLD.id
            USING ERRCODE = 'LL007';
    ELSIF TG_OP = 'UPDATE' THEN
        IF OLD.status = 'completed' THEN
            RAISE EXCEPTION 'Completed transfers are immutable: transfer % cannot be modified', OLD.id
                USING ERRCODE = 'LL007';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_transfer_mutation ON transfers;
CREATE TRIGGER trg_prevent_transfer_mutation
BEFORE UPDATE OR DELETE ON transfers
FOR EACH ROW
EXECUTE FUNCTION prevent_transfer_mutation();

-- ─── 5. Deferred Database-Enforced Ledger Balancing Constraint Triggers ───────

CREATE OR REPLACE FUNCTION verify_transfer_balance()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_target_transfer_id UUID;
    v_transfer RECORD;
    v_entry_count INT;
    v_debit_count INT;
    v_credit_count INT;
    v_debit_amount BIGINT;
    v_credit_amount BIGINT;
    v_debit_account UUID;
    v_credit_account UUID;
BEGIN
    IF TG_TABLE_NAME = 'transfers' THEN
        v_target_transfer_id := NEW.id;
        IF NEW.status <> 'completed' THEN
            RETURN NEW;
        END IF;
    ELSE
        v_target_transfer_id := NEW.transfer_id;
    END IF;

    SELECT id, source_account_id, destination_account_id, amount_paise, status
    INTO v_transfer
    FROM transfers
    WHERE id = v_target_transfer_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Ledger integrity violation: transfer % does not exist', v_target_transfer_id
            USING ERRCODE = 'LL007';
    END IF;

    IF v_transfer.status = 'completed' THEN
        SELECT
            COUNT(*),
            COUNT(*) FILTER (WHERE entry_type = 'debit'),
            COUNT(*) FILTER (WHERE entry_type = 'credit'),
            COALESCE(MAX(amount_paise) FILTER (WHERE entry_type = 'debit'), 0),
            COALESCE(MAX(amount_paise) FILTER (WHERE entry_type = 'credit'), 0),
            (MAX(account_id::text) FILTER (WHERE entry_type = 'debit'))::uuid,
            (MAX(account_id::text) FILTER (WHERE entry_type = 'credit'))::uuid
        INTO
            v_entry_count,
            v_debit_count,
            v_credit_count,
            v_debit_amount,
            v_credit_amount,
            v_debit_account,
            v_credit_account
        FROM ledger_entries
        WHERE transfer_id = v_target_transfer_id;

        -- Must have exactly 2 entries: 1 debit and 1 credit
        IF v_entry_count <> 2 OR v_debit_count <> 1 OR v_credit_count <> 1 THEN
            RAISE EXCEPTION 'Ledger integrity violation for transfer %: expected exactly 1 debit and 1 credit, got % entries (% debit, % credit)',
                v_target_transfer_id, v_entry_count, v_debit_count, v_credit_count
                USING ERRCODE = 'LL007';
        END IF;

        -- Debit amount must equal credit amount and equal transfer amount
        IF v_debit_amount <> v_credit_amount OR v_debit_amount <> v_transfer.amount_paise THEN
            RAISE EXCEPTION 'Ledger balance mismatch for transfer %: transfer amount %, debit %, credit %',
                v_target_transfer_id, v_transfer.amount_paise, v_debit_amount, v_credit_amount
                USING ERRCODE = 'LL007';
        END IF;

        -- Debit entry must reference source account; credit entry must reference destination account
        IF v_debit_account <> v_transfer.source_account_id OR v_credit_account <> v_transfer.destination_account_id THEN
            RAISE EXCEPTION 'Ledger account routing mismatch for transfer %: expected debit % and credit %, got debit % and credit %',
                v_target_transfer_id, v_transfer.source_account_id, v_transfer.destination_account_id, v_debit_account, v_credit_account
                USING ERRCODE = 'LL007';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_verify_transfer_balance ON transfers;
CREATE CONSTRAINT TRIGGER trg_verify_transfer_balance
AFTER INSERT OR UPDATE ON transfers
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION verify_transfer_balance();

DROP TRIGGER IF EXISTS trg_verify_ledger_entry_balance ON ledger_entries;
CREATE CONSTRAINT TRIGGER trg_verify_ledger_entry_balance
AFTER INSERT ON ledger_entries
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION verify_transfer_balance();

-- ─── 6. Idempotency Keys Storage Table ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS idempotency_keys (
    client_scope VARCHAR(128) NOT NULL,
    key VARCHAR(255) NOT NULL,
    request_hash VARCHAR(64) NOT NULL,
    status VARCHAR(16) NOT NULL CHECK (status IN ('processing', 'completed', 'failed')),
    transfer_id UUID REFERENCES transfers(id) ON DELETE SET NULL,
    response_code INTEGER,
    response_body JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (client_scope, key)
);

CREATE INDEX IF NOT EXISTS idx_idempotency_keys_created_at ON idempotency_keys(created_at);
CREATE INDEX IF NOT EXISTS idx_idempotency_keys_transfer_id ON idempotency_keys(transfer_id);

-- ─── 7. System Equity Provisioning & Opening Balance Cutover ───────────────────

DO $$
DECLARE
    v_equity_uuid CONSTANT UUID := '00000000-0000-0000-0000-000000000001';
    v_equity_num  CONSTANT VARCHAR(32) := 'SYSTEM_EQUITY_OPENING_BALANCE';
    v_acc RECORD;
    v_transfer_id UUID;
    v_transfer_amount BIGINT;
    v_running_equity BIGINT := 0;
    v_customer_total BIGINT := 0;
    v_net_system_balance BIGINT;
    v_net_ledger BIGINT;
    v_now TIMESTAMPTZ;
BEGIN
    v_now := NOW();

    -- Ensure System Equity Account exists
    INSERT INTO accounts (id, account_number, balance_paise, account_type, created_at, updated_at)
    VALUES (v_equity_uuid, v_equity_num, 0, 'system_equity', v_now, v_now)
    ON CONFLICT (id) DO UPDATE SET account_type = 'system_equity';

    -- Retrieve current balance of system equity in case of prior execution
    SELECT balance_paise INTO v_running_equity
    FROM accounts
    WHERE id = v_equity_uuid;

    -- Iterate deterministically through all uninitialized customer accounts
    FOR v_acc IN
        SELECT id, account_number, balance_paise
        FROM accounts
        WHERE id <> v_equity_uuid
          AND account_type = 'customer'
          AND opening_balance_captured_at IS NULL
        ORDER BY created_at ASC, id ASC
    LOOP
        IF v_acc.balance_paise > 0 THEN
            v_transfer_amount := v_acc.balance_paise;
            v_running_equity := v_running_equity - v_transfer_amount;

            -- System Equity funds customer account
            INSERT INTO transfers (source_account_id, destination_account_id, amount_paise, status, transfer_type, created_at)
            VALUES (v_equity_uuid, v_acc.id, v_transfer_amount, 'completed', 'opening_balance', v_now)
            RETURNING id INTO v_transfer_id;

            -- System Equity Debit Entry
            INSERT INTO ledger_entries (transfer_id, account_id, entry_type, amount_paise, balance_after_paise, created_at)
            VALUES (v_transfer_id, v_equity_uuid, 'debit', v_transfer_amount, v_running_equity, v_now);

            -- Customer Account Credit Entry (balance_after matches exact stored balance)
            INSERT INTO ledger_entries (transfer_id, account_id, entry_type, amount_paise, balance_after_paise, created_at)
            VALUES (v_transfer_id, v_acc.id, 'credit', v_transfer_amount, v_acc.balance_paise, v_now);

            UPDATE accounts
            SET opening_balance_captured_at = v_now
            WHERE id = v_acc.id;

        ELSIF v_acc.balance_paise < 0 THEN
            v_transfer_amount := ABS(v_acc.balance_paise);
            v_running_equity := v_running_equity + v_transfer_amount;

            -- Customer account overdrawn, represents system receivable
            INSERT INTO transfers (source_account_id, destination_account_id, amount_paise, status, transfer_type, created_at)
            VALUES (v_acc.id, v_equity_uuid, v_transfer_amount, 'completed', 'opening_balance', v_now)
            RETURNING id INTO v_transfer_id;

            -- Customer Account Debit Entry (balance_after matches exact stored negative balance)
            INSERT INTO ledger_entries (transfer_id, account_id, entry_type, amount_paise, balance_after_paise, created_at)
            VALUES (v_transfer_id, v_acc.id, 'debit', v_transfer_amount, v_acc.balance_paise, v_now);

            -- System Equity Credit Entry
            INSERT INTO ledger_entries (transfer_id, account_id, entry_type, amount_paise, balance_after_paise, created_at)
            VALUES (v_transfer_id, v_equity_uuid, 'credit', v_transfer_amount, v_running_equity, v_now);

            UPDATE accounts
            SET opening_balance_captured_at = v_now
            WHERE id = v_acc.id;

        ELSE
            -- Zero balance account: mark captured cleanly with zero transfers
            UPDATE accounts
            SET opening_balance_captured_at = v_now
            WHERE id = v_acc.id;
        END IF;
    END LOOP;

    -- Update System Equity Account stored balance to exact negative sum of all customer balances
    SELECT COALESCE(SUM(balance_paise), 0) INTO v_customer_total
    FROM accounts
    WHERE account_type = 'customer';

    UPDATE accounts
    SET balance_paise = -v_customer_total,
        opening_balance_captured_at = v_now,
        updated_at = v_now
    WHERE id = v_equity_uuid;

    -- ─── 8. Cutover Equilibrium Invariant Checks ─────────────────────────────
    SELECT COALESCE(SUM(balance_paise), 0) INTO v_net_system_balance FROM accounts;
    IF v_net_system_balance <> 0 THEN
        RAISE EXCEPTION 'Cutover Error: Total system balance is % (expected 0)', v_net_system_balance
            USING ERRCODE = 'LL007';
    END IF;

    SELECT COALESCE(SUM(CASE WHEN entry_type = 'credit' THEN amount_paise ELSE -amount_paise END), 0)
    INTO v_net_ledger FROM ledger_entries;
    IF v_net_ledger <> 0 THEN
        RAISE EXCEPTION 'Cutover Error: Net ledger balance is % (expected 0)', v_net_ledger
            USING ERRCODE = 'LL007';
    END IF;
END;
$$;

-- ─── 9. Runtime Application Least-Privilege Grants ────────────────────────────
-- Executed by ledgerline_owner upon completion of the migration to grant
-- the runtime application role (ledgerline_app) its required privileges.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ledgerline_app') THEN
        GRANT SELECT, INSERT, UPDATE ON TABLE public.accounts TO ledgerline_app;
        GRANT SELECT, INSERT ON TABLE public.transfers TO ledgerline_app;
        GRANT SELECT, INSERT ON TABLE public.ledger_entries TO ledgerline_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.idempotency_keys TO ledgerline_app;
    END IF;
END;
$$;
