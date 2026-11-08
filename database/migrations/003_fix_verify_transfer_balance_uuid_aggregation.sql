-- ==============================================================================
-- Migration 003: Fix verify_transfer_balance() UUID Aggregation
--
-- Defect:
-- PostgreSQL standard library does not provide built-in MAX(uuid) aggregation.
-- Prior implementation threw SQLSTATE 42883 ('function max(uuid) does not exist')
-- when evaluating deferred constraint triggers at transaction commit time.
--
-- Correction:
-- Replaces MAX(account_id) with (MAX(account_id::text) FILTER (...))::uuid.
-- This cast operates on PostgreSQL's standard MAX(text) aggregate and converts
-- the single debit and credit account strings back to UUID with zero data loss.
--
-- Safety & Idempotency:
-- - Idempotently replaces the function using CREATE OR REPLACE FUNCTION.
-- - Re-affirms DEFERRABLE INITIALLY DEFERRED constraint triggers.
-- - Modifies NO tables, drops NO schemas, and preserves all existing rows.
-- ==============================================================================

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
