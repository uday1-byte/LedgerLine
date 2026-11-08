const bcrypt = require('bcryptjs');

const BCRYPT_ROUNDS = 12;

// Precomputed valid bcrypt hash with work factor 12 for constant-time dummy verification
const DUMMY_HASH = '$2b$12$hrAsyj1Oz9Co8fwCVkUrYOJ4mQx9Pq/XsIBHqUj7nZML/XGBJmy0G';

/**
 * Validates password strength according to security standards:
 * - Minimum 8 characters
 * - At least one letter (uppercase or lowercase)
 * - At least one numeric digit
 */
function validatePasswordStrength(password) {
  if (typeof password !== 'string' || password.length < 8) {
    return {
      valid: false,
      message: 'Password must be at least 8 characters long',
    };
  }

  const hasLetter = /[a-zA-Z]/.test(password);
  const hasNumber = /[0-9]/.test(password);

  if (!hasLetter || !hasNumber) {
    return {
      valid: false,
      message: 'Password must contain at least one letter and one number',
    };
  }

  return { valid: true };
}

/**
 * Asynchronously hashes a plaintext password using bcrypt with work factor 12.
 */
async function hashPassword(plaintextPassword) {
  return bcrypt.hash(plaintextPassword, BCRYPT_ROUNDS);
}

/**
 * Asynchronously verifies a plaintext password against a stored bcrypt hash.
 */
async function verifyPassword(plaintextPassword, passwordHash) {
  if (!plaintextPassword || !passwordHash) {
    return false;
  }
  return bcrypt.compare(plaintextPassword, passwordHash);
}

/**
 * Performs a dummy bcrypt comparison against a precomputed work-factor-12 hash
 * when a non-existent email/user attempts to log in.
 * Eliminates timing differences to prevent account-enumeration attacks.
 */
async function dummyVerifyPassword(plaintextPassword) {
  return bcrypt.compare(plaintextPassword || 'dummy_password', DUMMY_HASH);
}

module.exports = {
  validatePasswordStrength,
  hashPassword,
  verifyPassword,
  dummyVerifyPassword,
};
