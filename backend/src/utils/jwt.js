const jwt = require('jsonwebtoken');
const env = require('../config/env');

/**
 * Generates a signed JWT access token for a user.
 * Payload contains only immutable identity claims: sub (user UUID).
 * Role and status claims are intentionally omitted from token payload
 * to guarantee that live database checks in authentication middleware
 * reflect role changes and account deactivations immediately.
 */
function generateToken(user) {
  if (!user || !user.id) {
    throw new Error('Cannot generate token: user object with id is required');
  }

  const payload = {
    sub: user.id,
  };

  const options = {
    expiresIn: env.JWT_EXPIRES_IN || '24h',
  };

  return jwt.sign(payload, env.JWT_SECRET, options);
}

/**
 * Synchronously or asynchronously verifies a JWT access token.
 * Throws an error if the token has expired, is malformed, or was signed with an invalid key.
 */
function verifyToken(token) {
  if (!token || typeof token !== 'string') {
    throw new Error('Token is required and must be a string');
  }

  return jwt.verify(token, env.JWT_SECRET);
}

module.exports = {
  generateToken,
  verifyToken,
};
