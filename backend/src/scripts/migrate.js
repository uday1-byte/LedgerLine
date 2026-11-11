const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const env = require('../config/env');

// Configure migration runner pool: supports dedicated migration owner credentials (MIGRATION_DB_USER),
// falling back to standard application database credentials (DB_USER).
const migrationUser = process.env.MIGRATION_DB_USER || env.DB_USER;
const migrationPassword = process.env.MIGRATION_DB_PASSWORD !== undefined
  ? process.env.MIGRATION_DB_PASSWORD
  : env.DB_PASSWORD;

  // Production migration safety checks
if (env.NODE_ENV === 'production') {
  if (env.DB_NAME !== 'neondb') {
    throw new Error('Production migrations must target the Neon database "neondb".');
  }

  if (!env.DB_SSL) {
    throw new Error('Production migrations require DB_SSL=true.');
  }

  if (migrationUser !== 'ledgerline_owner') {
    throw new Error('Production migrations must use ledgerline_owner.');
  }

  if (env.DB_HOST === 'localhost' || env.DB_HOST === '127.0.0.1') {
    throw new Error('Production migrations cannot target localhost.');
  }
}

const migrationPool = new Pool({
  host: env.DB_HOST,
  port: env.DB_PORT,
  database: env.DB_NAME,
  user: migrationUser,
  password: migrationPassword,
  ssl: env.DB_SSL ? { rejectUnauthorized: true } : false,
  max: 2,
  connectionTimeoutMillis: 10000,
});

async function runMigrations() {
  const client = await migrationPool.connect();
  try {
    console.log(`Running database migrations (connected as role: ${migrationUser})...`);

    // Ensure migrations table exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // Fetch applied migrations
    const { rows: appliedRows } = await client.query('SELECT name FROM schema_migrations');
    const appliedSet = new Set(appliedRows.map((r) => r.name));

    // Read migration files
    const migrationsDir = path.resolve(__dirname, '../../../database/migrations');
    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      if (!appliedSet.has(file)) {
        console.log(`Applying migration: ${file}`);
        let sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
        if (sql.charCodeAt(0) === 0xFEFF) {
          sql = sql.slice(1);
        }

        await client.query('BEGIN');
        try {
          await client.query(sql);
          await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
          await client.query('COMMIT');
          console.log(`✓ Migration ${file} applied successfully.`);
        } catch (err) {
          await client.query('ROLLBACK');
          console.error(`✗ Error applying migration ${file}:`, err);
          throw err;
        }
      } else {
        console.log(`- Migration ${file} already applied.`);
      }
    }

    console.log('All migrations completed successfully.');
  } finally {
    client.release();
    await migrationPool.end();
  }
}

if (require.main === module) {
  runMigrations().catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
  });
}

module.exports = { runMigrations };
