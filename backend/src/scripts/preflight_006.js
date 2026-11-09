/**
 * Phase 6 Stage 2: Read-Only Preflight Verification Script
 * Intended File Location: backend/src/scripts/preflight_006.js
 * Target Database:        ledgerline_test ONLY
 * Target Role:            ledgerline_owner (or MIGRATION_DB_USER)
 *
 * Safety Invariants:
 * - Pre-connection guard enforces DB_NAME === 'ledgerline_test'.
 * - Strict backend/.env loading with conflict detection against process.env.
 * - Variables in process.env absent from backend/.env are strictly rejected.
 * - Sensitive keys (passwords) are NEVER logged.
 * - BEGIN READ ONLY starts an explicit read-only transaction that prevents writes within that transaction after identity verification.
 * - ROLLBACK and client/pool cleanup are guaranteed in finally.
 * - If ROLLBACK fails, client connection is destroyed rather than returned to pool.
 * - Check 4 enforces fail-closed matching against candidate known-safe constraint forms.
 * - No process.exit() is invoked inside the connection lifecycle.
 */

const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const { Pool } = require('pg');

// -----------------------------------------------------------------------------
// 1. Strict Environment Configuration Loading & Conflict Detection
// -----------------------------------------------------------------------------
// Resolving backend/.env relative to intended location: backend/src/scripts/preflight_006.js
const backendEnvPath = path.resolve(__dirname, '../../.env');

if (!fs.existsSync(backendEnvPath)) {
  console.error(
    `[FATAL CONFIG ERROR] Environment file not found at expected path: '${backendEnvPath}'.\n` +
    `Preflight strictly requires 'backend/.env' to exist. No fallback permitted. Aborting without connecting.`
  );
  process.exit(1);
}

// Parse backend/.env directly without mutating process.env
let fileEnv = {};
try {
  const envContent = fs.readFileSync(backendEnvPath, 'utf8');
  fileEnv = dotenv.parse(envContent);
} catch (parseErr) {
  console.error(
    `[FATAL CONFIG ERROR] Failed to read/parse '${backendEnvPath}': ${parseErr.message}. Aborting.`
  );
  process.exit(1);
}

// Audit all database configuration keys between process.env and backend/.env
const sensitiveKeys = new Set(['DB_PASSWORD', 'MIGRATION_DB_PASSWORD']);
const dbConfigKeys = [
  'DB_NAME',
  'DB_HOST',
  'DB_PORT',
  'DB_USER',
  'DB_PASSWORD',
  'MIGRATION_DB_USER',
  'MIGRATION_DB_PASSWORD',
];

for (const key of dbConfigKeys) {
  const procVal = process.env[key];
  const fileVal = fileEnv[key];

  // Condition 1: Key exists in process.env but is absent from backend/.env
  if (procVal !== undefined && fileVal === undefined) {
    console.error(
      `[FATAL CONFIG ERROR] Environment variable '${key}' is defined in process environment but absent from backend/.env.\n` +
      `Unmanaged environment variables for database configuration are prohibited. Aborting without connecting.`
    );
    process.exit(1);
  }

  // Condition 2: Key exists in both places but values differ
  if (procVal !== undefined && fileVal !== undefined && procVal !== fileVal) {
    if (sensitiveKeys.has(key)) {
      console.error(
        `[FATAL CONFIG CONFLICT] Pre-existing process environment variable '${key}' conflicts with backend/.env.\n` +
        `Process environment differs from backend/.env. Silent overrides are prohibited. Aborting without connecting.`
      );
    } else {
      console.error(
        `[FATAL CONFIG CONFLICT] Pre-existing process environment variable '${key}' conflicts with backend/.env.\n` +
        `Process value: '${procVal}' vs file value: '${fileVal}'. Silent overrides are prohibited. Aborting without connecting.`
      );
    }
    process.exit(1);
  }

  // Condition 3: Key is defined in backend/.env and unset in process.env
  if (procVal === undefined && fileVal !== undefined) {
    process.env[key] = fileVal;
  }
}

// -----------------------------------------------------------------------------
// 2. Pre-Connection Guard
// -----------------------------------------------------------------------------
const targetDb = process.env.DB_NAME;
if (!targetDb || targetDb !== 'ledgerline_test') {
  console.error(
    `[FATAL GUARD] DB_NAME must be explicitly set to 'ledgerline_test'. Received: '${targetDb}'. Aborting without connecting.`
  );
  process.exit(1);
}

// Resolve credentials matching backend/src/scripts/migrate.js (secrets are never logged)
const migrationUser = process.env.MIGRATION_DB_USER || process.env.DB_USER || 'ledgerline_owner';
const migrationPassword = process.env.MIGRATION_DB_PASSWORD !== undefined
  ? process.env.MIGRATION_DB_PASSWORD
  : (process.env.DB_PASSWORD || '');

const pool = new Pool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: 'ledgerline_test',
  user: migrationUser,
  password: migrationPassword,
  max: 1,
  connectionTimeoutMillis: 5000,
});

// -----------------------------------------------------------------------------
// Candidate Known-Safe Constraint Definitions
//
// Source DDL in Migration 002:
// - accounts:  CHECK (account_type IN ('customer', 'system_equity'))
// - transfers: CHECK (transfer_type IN ('customer_transfer', 'opening_balance', 'reversal'))
//
// NOTE: These candidate representations are derived from standard PostgreSQL deparser
// conventions and Migration 002 DDL. They have NOT yet been observed from live
// PostgreSQL 18.6 because no connection has been authorized. Check 4 is intentionally
// fail-closed: if the live engine deparses differently, preflight halts safely.
// -----------------------------------------------------------------------------
const CANDIDATE_SAFE_DEFINITIONS = {
  accounts_account_type_check: [
    // Candidate 1: PostgreSQL ruleutils deparse with element-level text cast
    "CHECK (((account_type)::text = ANY (ARRAY[('customer'::character varying)::text, ('system_equity'::character varying)::text])))",
    // Candidate 2: PostgreSQL ruleutils deparse with array-level text cast
    "CHECK (((account_type)::text = ANY ((ARRAY['customer'::character varying, 'system_equity'::character varying])::text[])))",
    // Candidate 3: Alternative text-cast deparse
    "CHECK (((account_type)::text = ANY (ARRAY['customer'::text, 'system_equity'::text])))",
    // Candidate 4: Original Migration 002 raw DDL
    "CHECK (account_type IN ('customer', 'system_equity'))",
    // Candidate 5: Parenthesized DDL
    "CHECK ((account_type IN ('customer', 'system_equity')))",
  ],
  transfers_transfer_type_check: [
    // Candidate 1: PostgreSQL ruleutils deparse with element-level text cast
    "CHECK (((transfer_type)::text = ANY (ARRAY[('customer_transfer'::character varying)::text, ('opening_balance'::character varying)::text, ('reversal'::character varying)::text])))",
    // Candidate 2: PostgreSQL ruleutils deparse with array-level text cast
    "CHECK (((transfer_type)::text = ANY ((ARRAY['customer_transfer'::character varying, 'opening_balance'::character varying, 'reversal'::character varying])::text[])))",
    // Candidate 3: Alternative text-cast deparse
    "CHECK (((transfer_type)::text = ANY (ARRAY['customer_transfer'::text, 'opening_balance'::text, 'reversal'::text])))",
    // Candidate 4: Original Migration 002 raw DDL
    "CHECK (transfer_type IN ('customer_transfer', 'opening_balance', 'reversal'))",
    // Candidate 5: Parenthesized DDL
    "CHECK ((transfer_type IN ('customer_transfer', 'opening_balance', 'reversal')))",
  ],
};

/**
 * Validates that a CHECK constraint strictly matches one of the candidate known-safe
 * definitions. Fails closed safely if the live database deparser representation diverges.
 */
function assertCandidateSafeConstraint(conname, tableName, definition) {
  const normalized = definition.replace(/\s+/g, ' ').trim();
  const candidates = CANDIDATE_SAFE_DEFINITIONS[conname];

  if (!candidates) {
    throw new Error(`Check 4 FAILED: No candidate definitions registered for constraint '${conname}'.`);
  }

  const isMatched = candidates.some(form => form === normalized);

  if (!isMatched) {
    throw new Error(
      `Check 4 FAILED: Constraint '${conname}' on table '${tableName}' did not match any pre-approved candidate definition.\n` +
      `  Actual definition from pg_get_constraintdef(): ${definition}\n` +
      `  Normalized definition:                         ${normalized}\n` +
      `  Candidate safe forms:\n` +
      candidates.map((f, i) => `    [${i + 1}] ${f}`).join('\n') + '\n' +
      `  Fail-Closed Notice: The exact PostgreSQL 18.6 pg_get_constraintdef() deparsing format for Migration 002\n` +
      `  has not yet been observed via a live connection. Preflight halts safely here.\n` +
      `  The actual deparsed string above must be manually reviewed and approved before proceeding.`
    );
  }

  console.log(`  -> Constraint '${conname}' on '${tableName}' verified: contype='c', validated=true, matches candidate known-safe definition.`);
}

async function runPreflight() {
  let client = null;
  let inTransaction = false;
  let rollbackError = null;
  let allChecksPassed = false;

  console.log('='.repeat(70));
  console.log('PHASE 6 STAGE 2: READ-ONLY PREFLIGHT CHECKS');
  console.log('Target Database: ledgerline_test');
  console.log('Configured Role: ' + migrationUser);
  console.log('='.repeat(70));

  try {
    client = await pool.connect();

    // -------------------------------------------------------------------------
    // Check 1: Target Database and Connected Role Verification
    // -------------------------------------------------------------------------
    console.log('\n[Check 1] Verifying connected database and role identity...');
    const identRes = await client.query(`
      SELECT
        current_database() AS db_name,
        current_user AS db_user,
        session_user AS sess_user,
        version() AS pg_version;
    `);
    const ident = identRes.rows[0];
    console.log(`  Connected Database: ${ident.db_name}`);
    console.log(`  Connected User:     ${ident.db_user} (session: ${ident.sess_user})`);
    console.log(`  PostgreSQL Version: ${ident.pg_version}`);

    if (ident.db_name !== 'ledgerline_test') {
      throw new Error(`CRITICAL: Connected to database '${ident.db_name}', expected 'ledgerline_test'. Aborting.`);
    }
    if (ident.db_user !== 'ledgerline_owner') {
      throw new Error(`CRITICAL: Connected as user '${ident.db_user}', expected 'ledgerline_owner'. Aborting.`);
    }
    console.log('  -> Check 1 PASSED: Target is ledgerline_test, role is ledgerline_owner.');

    // -------------------------------------------------------------------------
    // Start Explicit PostgreSQL Read-Only Transaction
    // -------------------------------------------------------------------------
    console.log('\n[Security] Initiating explicit read-only transaction (BEGIN READ ONLY)...');
    await client.query('BEGIN READ ONLY;');
    inTransaction = true;
    console.log('  -> Started read-only transaction: write operations are prohibited within this transaction.');

    // -------------------------------------------------------------------------
    // Check 2: Migration History and Sequence (schema_migrations uses 'name')
    // -------------------------------------------------------------------------
    console.log('\n[Check 2] Inspecting public.schema_migrations table and applied sequence...');
    const migRes = await client.query(`
      SELECT id, name, applied_at
      FROM public.schema_migrations
      ORDER BY id ASC;
    `);
    console.log(`  Found ${migRes.rows.length} applied migration(s):`);
    migRes.rows.forEach(r => console.log(`    [id: ${r.id}] ${r.name} (applied_at: ${r.applied_at.toISOString()})`));

    const expectedMigrations = [
      '001_create_accounts_and_transfers.sql',
      '002_create_ledger_entries_and_idempotency.sql',
      '003_fix_verify_transfer_balance_uuid_aggregation.sql',
      '004_create_users_and_authentication.sql',
      '005_fix_admin_function_column_ambiguity.sql',
    ];

    if (migRes.rows.length !== expectedMigrations.length) {
      throw new Error(
        `Check 2 FAILED: Expected exactly ${expectedMigrations.length} migrations, found ${migRes.rows.length}.`
      );
    }

    for (let i = 0; i < expectedMigrations.length; i++) {
      if (migRes.rows[i].name !== expectedMigrations[i]) {
        throw new Error(
          `Check 2 FAILED: Migration order mismatch at position ${i}. Expected '${expectedMigrations[i]}', found '${migRes.rows[i].name}'.`
        );
      }
    }
    console.log('  -> Check 2 PASSED: Exactly 5 migrations present in correct chronological order.');

    // -------------------------------------------------------------------------
    // Check 3: Clearing Account Collision Check
    // -------------------------------------------------------------------------
    console.log('\n[Check 3] Checking for clearing account collisions...');
    const clearRes = await client.query(`
      SELECT id, account_number, account_type, user_id, balance_paise, created_at
      FROM public.accounts
      WHERE id = '00000000-0000-0000-0000-000000000002'::uuid
         OR account_number = 'SYSTEM_CASH_CLEARING';
    `);

    if (clearRes.rows.length === 0) {
      console.log('  No existing account matching UUID 00000000-0000-0000-0000-000000000002 or SYSTEM_CASH_CLEARING.');
      console.log('  -> Check 3 PASSED: Clean state; Section 3 will cleanly insert the clearing account.');
    } else if (clearRes.rows.length === 1) {
      const acc = clearRes.rows[0];
      console.log('  Found existing candidate clearing account:', acc);
      const isExpectedUuid = acc.id === '00000000-0000-0000-0000-000000000002';
      const isExpectedNumber = acc.account_number === 'SYSTEM_CASH_CLEARING';
      const isExpectedType = acc.account_type === 'system_clearing';
      const isNullUser = acc.user_id === null;
      const isZeroBalance = acc.balance_paise === '0' || acc.balance_paise === 0;

      if (isExpectedUuid && isExpectedNumber && isExpectedType && isNullUser && isZeroBalance) {
        console.log('  -> Check 3 PASSED: Account exists with fully valid attributes and zero balance.');
      } else {
        throw new Error(
          `Check 3 FAILED: Existing account has conflicting attributes: id=${acc.id}, number=${acc.account_number}, type=${acc.account_type}, user_id=${acc.user_id}, balance_paise=${acc.balance_paise}.`
        );
      }
    } else {
      throw new Error(
        `Check 3 FAILED: Multiple conflicting accounts found matching clearing criteria (${clearRes.rows.length} rows).`
      );
    }

    // -------------------------------------------------------------------------
    // Check 4: Check Constraints (Exact 2, contype='c', convalidated=true, Candidate Whitelist)
    // -------------------------------------------------------------------------
    console.log('\n[Check 4] Inspecting check constraints on public.accounts and public.transfers...');
    const conRes = await client.query(`
      SELECT
        c.conname,
        rel.relname AS table_name,
        c.contype,
        c.convalidated,
        pg_get_constraintdef(c.oid) AS definition
      FROM pg_constraint c
      JOIN pg_class rel ON rel.oid = c.conrelid
      JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
      WHERE nsp.nspname = 'public'
        AND c.conname IN ('accounts_account_type_check', 'transfers_transfer_type_check')
      ORDER BY c.conname;
    `);

    console.log(`  Found ${conRes.rows.length} matching constraint(s):`);
    conRes.rows.forEach(r => console.log(`    - Table '${r.table_name}', Constraint '${r.conname}', Type: '${r.contype}', Validated: ${r.convalidated}: ${r.definition}`));

    // Assert exactly 2 matching constraints
    if (conRes.rows.length !== 2) {
      throw new Error(`Check 4 FAILED: Expected exactly 2 constraints in public, found ${conRes.rows.length}.`);
    }

    const accTypeCon = conRes.rows.find(r => r.conname === 'accounts_account_type_check' && r.table_name === 'accounts');
    const trfTypeCon = conRes.rows.find(r => r.conname === 'transfers_transfer_type_check' && r.table_name === 'transfers');

    if (!accTypeCon) {
      throw new Error("Check 4 FAILED: Missing expected constraint 'accounts_account_type_check' on public.accounts.");
    }
    if (!trfTypeCon) {
      throw new Error("Check 4 FAILED: Missing expected constraint 'transfers_transfer_type_check' on public.transfers.");
    }

    // Assert contype = 'c' (CHECK constraint) and convalidated = true on both constraints
    for (const con of [accTypeCon, trfTypeCon]) {
      if (con.contype !== 'c') {
        throw new Error(`Check 4 FAILED: Constraint '${con.conname}' has contype '${con.contype}', expected 'c' (CHECK).`);
      }
      if (con.convalidated !== true) {
        throw new Error(`Check 4 FAILED: Constraint '${con.conname}' has convalidated = ${con.convalidated}, expected true.`);
      }
    }

    // Assert strict match against candidate safe Phase 5 definitions (fail-closed if unverified representation diverges)
    assertCandidateSafeConstraint('accounts_account_type_check', 'public.accounts', accTypeCon.definition);
    assertCandidateSafeConstraint('transfers_transfer_type_check', 'public.transfers', trfTypeCon.definition);

    console.log('  -> Check 4 PASSED: Exactly 2 constraints validated against candidate Phase 5 definitions.');

    // -------------------------------------------------------------------------
    // Check 5: Verify Absence of Phase 6 Schema Additions
    // -------------------------------------------------------------------------
    console.log('\n[Check 5] Verifying absence of Phase 6 schema additions in public schema...');

    // 1. accounts columns: phase6_cutover_balance_paise, phase6_cutover_captured_at, next_entry_sequence
    const accColsRes = await client.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'accounts'
        AND column_name IN ('phase6_cutover_balance_paise', 'phase6_cutover_captured_at', 'next_entry_sequence');
    `);
    console.log(`  Phase 6 columns found on public.accounts: [${accColsRes.rows.map(r => r.column_name).join(', ')}]`);
    if (accColsRes.rows.length > 0) {
      throw new Error(`Check 5 FAILED: Phase 6 accounts columns already exist: ${accColsRes.rows.map(r => r.column_name).join(', ')}`);
    }

    // 2. transfers columns: created_by_user_id
    const trfColsRes = await client.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'transfers'
        AND column_name = 'created_by_user_id';
    `);
    console.log(`  Phase 6 columns found on public.transfers: [${trfColsRes.rows.map(r => r.column_name).join(', ')}]`);
    if (trfColsRes.rows.length > 0) {
      throw new Error("Check 5 FAILED: Phase 6 transfers column 'created_by_user_id' already exists.");
    }

    // 3. ledger_entries columns: account_entry_sequence
    const leColsRes = await client.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'ledger_entries'
        AND column_name = 'account_entry_sequence';
    `);
    console.log(`  Phase 6 columns found on public.ledger_entries: [${leColsRes.rows.map(r => r.column_name).join(', ')}]`);
    if (leColsRes.rows.length > 0) {
      throw new Error("Check 5 FAILED: Phase 6 ledger_entries column 'account_entry_sequence' already exists.");
    }

    // 4. audit_refused_attempts table
    const auditTblRes = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = 'audit_refused_attempts';
    `);
    console.log(`  Phase 6 table found: [${auditTblRes.rows.map(r => r.table_name).join(', ')}]`);
    if (auditTblRes.rows.length > 0) {
      throw new Error("Check 5 FAILED: Table 'public.audit_refused_attempts' already exists.");
    }

    console.log('  -> Check 5 PASSED: Target Phase 6 columns and tables do not exist yet.');

    // -------------------------------------------------------------------------
    // Check 6: Immutability Trigger State on public.ledger_entries
    // -------------------------------------------------------------------------
    console.log('\n[Check 6] Inspecting immutability trigger on public.ledger_entries...');
    const trigRes = await client.query(`
      SELECT
        tg.tgname AS trigger_name,
        rel.relname AS table_name,
        rel_nsp.nspname AS table_schema,
        proc.proname AS function_name,
        proc_nsp.nspname AS function_schema,
        CASE tg.tgenabled
          WHEN 'O' THEN 'enabled (origin/local)'
          WHEN 'A' THEN 'enabled (always)'
          WHEN 'R' THEN 'enabled (replica)'
          WHEN 'D' THEN 'disabled'
          ELSE 'unknown'
        END AS trigger_status,
        (NOT tg.tgisinternal) AS is_user_trigger,
        pg_get_triggerdef(tg.oid) AS trigger_definition
      FROM pg_trigger tg
      JOIN pg_class rel ON rel.oid = tg.tgrelid
      JOIN pg_namespace rel_nsp ON rel_nsp.oid = rel.relnamespace
      JOIN pg_proc proc ON proc.oid = tg.tgfoid
      JOIN pg_namespace proc_nsp ON proc_nsp.oid = proc.pronamespace
      WHERE rel_nsp.nspname = 'public'
        AND rel.relname = 'ledger_entries'
        AND tg.tgname = 'trg_prevent_ledger_mutation';
    `);

    if (trigRes.rows.length === 0) {
      throw new Error("Check 6 FAILED: Immutability trigger 'trg_prevent_ledger_mutation' not found on public.ledger_entries.");
    }

    const trg = trigRes.rows[0];
    console.log(`  Trigger Name:       ${trg.trigger_name}`);
    console.log(`  Table Name:         ${trg.table_schema}.${trg.table_name}`);
    console.log(`  Function Name:      ${trg.function_schema}.${trg.function_name}`);
    console.log(`  Status:             ${trg.trigger_status}`);
    console.log(`  Is User Trigger:    ${trg.is_user_trigger}`);
    console.log(`  Definition:         ${trg.trigger_definition}`);

    if (trg.function_schema !== 'public') {
      throw new Error(`Check 6 FAILED: Expected function schema 'public', found '${trg.function_schema}'.`);
    }
    if (trg.function_name !== 'prevent_ledger_mutation') {
      throw new Error(`Check 6 FAILED: Expected function name 'prevent_ledger_mutation', found '${trg.function_name}'.`);
    }
    if (trg.trigger_status !== 'enabled (origin/local)' && trg.trigger_status !== 'enabled (always)') {
      throw new Error(`Check 6 FAILED: Trigger 'trg_prevent_ledger_mutation' is not enabled. Status: ${trg.trigger_status}`);
    }
    if (!trg.is_user_trigger) {
      throw new Error("Check 6 FAILED: Trigger 'trg_prevent_ledger_mutation' is not recognized as a user trigger.");
    }
    const hasValidEventTiming =
      trg.trigger_definition.includes('BEFORE UPDATE OR DELETE ON public.ledger_entries') ||
      trg.trigger_definition.includes('BEFORE DELETE OR UPDATE ON public.ledger_entries') ||
      trg.trigger_definition.includes('BEFORE UPDATE OR DELETE ON ledger_entries') ||
      trg.trigger_definition.includes('BEFORE DELETE OR UPDATE ON ledger_entries');

    if (!hasValidEventTiming) {
      throw new Error(`Check 6 FAILED: Trigger event timing does not match BEFORE UPDATE OR DELETE or BEFORE DELETE OR UPDATE on public.ledger_entries: ${trg.trigger_definition}`);
    }

    console.log('  -> Check 6 PASSED: Immutability trigger public.trg_prevent_ledger_mutation is active, enabled, user-defined, and correctly mapped to public.prevent_ledger_mutation.');

    allChecksPassed = true;
  } catch (err) {
    console.error('\n' + '!'.repeat(70));
    console.error(`PREFLIGHT ERROR: ${err.message}`);
    console.error('!'.repeat(70));
  } finally {
    // -------------------------------------------------------------------------
    // Guaranteed Cleanup: Rollback read-only transaction, release/destroy client, close pool
    // -------------------------------------------------------------------------
    if (client) {
      if (inTransaction) {
        try {
          console.log('\n[Cleanup] Rolling back read-only transaction (ROLLBACK)...');
          await client.query('ROLLBACK;');
          console.log('  -> Read-only transaction rolled back successfully.');
        } catch (rbErr) {
          rollbackError = rbErr;
          console.error(`  -> Failed to roll back transaction: ${rbErr.message}`);
        }
      }
      try {
        if (rollbackError) {
          console.log('[Cleanup] Destroying failed/unrolled-back client connection to prevent pool reuse.');
          client.release(rollbackError);
        } else {
          client.release();
          console.log('[Cleanup] Client released to pool cleanly.');
        }
      } catch (relErr) {
        console.error(`[Cleanup] Failed to release/destroy client: ${relErr.message}`);
      }
    }

    if (pool) {
      try {
        await pool.end();
        console.log('[Cleanup] Connection pool closed successfully.');
      } catch (pErr) {
        console.error(`[Cleanup] Failed to close pool: ${pErr.message}`);
      }
    }

    console.log('='.repeat(70));
    if (allChecksPassed) {
      console.log('PREFLIGHT SUMMARY: ALL 6 CHECKS PASSED SUCCESSFULLY');
    } else {
      console.log('PREFLIGHT SUMMARY: PREFLIGHT FAILED - DO NOT PROCEED WITH MIGRATION');
    }
    console.log('='.repeat(70));
  }

  return allChecksPassed;
}

// Top-level execution handler guarantees process exit only after full cleanup
if (require.main === module) {
  runPreflight()
    .then((passed) => {
      process.exit(passed ? 0 : 1);
    })
    .catch((fatal) => {
      console.error('Fatal execution error:', fatal);
      process.exit(1);
    });
}

module.exports = { runPreflight };
