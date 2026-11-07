const fs = require('fs');
const path = require('path');
const { pool } = require('../config/db');

async function runMigrations() {
  const client = await pool.connect();
  try {
    console.log('Running database migrations...');

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
        const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');

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
    await pool.end();
  }
}

if (require.main === module) {
  runMigrations().catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
  });
}

module.exports = { runMigrations };
