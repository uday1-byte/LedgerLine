const { Pool } = require('pg');
const { pool } = require('../../src/config/db');
const env = require('../../src/config/env');
const { hashPassword } = require('../../src/utils/password');
const { generateToken } = require('../../src/utils/jwt');

// Dedicated owner pool for test fixture setup (bypasses least privilege runtime restrictions)
const ownerPool = new Pool({
  host: env.DB_HOST,
  port: env.DB_PORT,
  database: 'ledgerline_test',
  user: process.env.MIGRATION_DB_USER || 'ledgerline_owner',
  password: process.env.MIGRATION_DB_PASSWORD || env.DB_PASSWORD,
  max: 2,
});

/**
 * Creates a unique test user in ledgerline_test for test fixtures.
 */
async function createTestUser({
  username = `user_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
  email = `user_${Date.now()}_${Math.floor(Math.random() * 10000)}@test.com`,
  password = 'ValidPassword123',
  role = 'account_holder',
  isActive = true,
} = {}) {
  const passwordHash = await hashPassword(password);

  // Normal users can be inserted directly; if privileged role or active status
  // is specified, set it directly via ownerPool for test fixture setup
  const res = await pool.query(
    `INSERT INTO public.users (username, email, password_hash)
     VALUES ($1, $2, $3)
     RETURNING id, username, email, role, is_active`,
    [username, email, passwordHash]
  );

  let user = res.rows[0];

  if (role !== 'account_holder' || isActive !== true) {
    const updateRes = await ownerPool.query(
      `UPDATE public.users
       SET role = $1, is_active = $2, updated_at = NOW()
       WHERE id = $3
       RETURNING id, username, email, role, is_active`,
      [role, isActive, user.id]
    );
    user = updateRes.rows[0];
  }

  const token = generateToken(user);

  return {
    user,
    token,
    rawPassword: password,
  };
}

/**
 * Creates a test account directly via ownerPool with optional balance and owner assignment.
 */
async function createTestAccount({
  accountNumber = `ACC_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
  balancePaise = 0,
  userId = null,
} = {}) {
  const res = await ownerPool.query(
    `INSERT INTO public.accounts (account_number, balance_paise, user_id)
     VALUES ($1, $2, $3)
     RETURNING id, account_number, balance_paise, account_type, user_id, created_at`,
    [accountNumber, balancePaise, userId]
  );
  return res.rows[0];
}

module.exports = {
  createTestUser,
  createTestAccount,
  ownerPool,
};
