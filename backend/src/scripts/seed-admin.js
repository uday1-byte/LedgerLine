const { Pool } = require('pg');
const env = require('../config/env');
const { validatePasswordStrength, hashPassword } = require('../utils/password');

/**
 * Race-Safe One-Time Initial Administrator Bootstrap CLI Script
 *
 * Security & Authorization Isolation:
 * 1. Schema Owner Connection:
 *    Connects strictly as MIGRATION_DB_USER (ledgerline_owner).
 *    Ordinary runtime application role (ledgerline_app) has ZERO execute permissions
 *    on admin_bootstrap_seed and cannot invoke initial administrator creation.
 * 2. Transaction-level PostgreSQL advisory lock:
 *    Uses pg_advisory_xact_lock(hashtext('seed_admin_bootstrap')) inside admin_bootstrap_seed()
 *    to strictly serialize concurrent bootstrap attempts. Two simultaneous invocations cannot race.
 * 3. Strict one-time provisioning:
 *    Checks if an active admin user already exists. If found, rolls back and aborts.
 * 4. Zero hardcoded credentials:
 *    Credentials must be supplied via ADMIN_USERNAME, ADMIN_EMAIL, and ADMIN_PASSWORD.
 */
async function seedAdmin() {
  const username = process.env.ADMIN_USERNAME;
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;

  const ownerUser = process.env.MIGRATION_DB_USER || 'ledgerline_owner';
  const ownerPassword = process.env.MIGRATION_DB_PASSWORD;

  if (!ownerPassword) {
    console.error('Error: MIGRATION_DB_PASSWORD must be configured to run admin bootstrap.');
    process.exit(1);
  }

  if (!username || !email || !password) {
    console.error(
      'Error: ADMIN_USERNAME, ADMIN_EMAIL, and ADMIN_PASSWORD environment variables must all be set.'
    );
    process.exit(1);
  }

  const passCheck = validatePasswordStrength(password);
  if (!passCheck.valid) {
    console.error(`Error: Invalid admin password. ${passCheck.message}`);
    process.exit(1);
  }

  const ownerPool = new Pool({
    host: env.DB_HOST,
    port: env.DB_PORT,
    database: env.DB_NAME,
    user: ownerUser,
    password: ownerPassword,
    max: 1,
    connectionTimeoutMillis: 5000,
  });

  const client = await ownerPool.connect();
  try {
    await client.query('BEGIN');

    // 1. Hash password with bcrypt work factor 12
    const passwordHash = await hashPassword(password);

    // 2. Invoke restricted admin_bootstrap_seed function (executable strictly by ledgerline_owner)
    const seedRes = await client.query(
      'SELECT * FROM admin_bootstrap_seed($1, $2, $3)',
      [username.trim(), email.trim().toLowerCase(), passwordHash]
    );

    await client.query('COMMIT');

    const admin = seedRes.rows[0];
    console.log('✓ Initial administrator provisioned successfully:');
    console.log(`  ID      : ${admin.id}`);
    console.log(`  Username: ${admin.username}`);
    console.log(`  Email   : ${admin.email}`);
    console.log(`  Role    : ${admin.role}`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.message && err.message.includes('already exists')) {
      console.warn(`Notice: ${err.message}`);
      process.exit(0);
    }
    console.error('Fatal: Failed to provision initial administrator:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await ownerPool.end();
  }
}

if (require.main === module) {
  seedAdmin();
}

module.exports = { seedAdmin };
