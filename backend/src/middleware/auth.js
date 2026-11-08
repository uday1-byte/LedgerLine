const { verifyToken } = require('../utils/jwt');
const { pool } = require('../config/db');

/**
 * Authentication Middleware: authenticateJWT
 *
 * Security Guarantees:
 * 1. Extracts and cryptographically verifies the bearer token from the Authorization header.
 * 2. Rejects invalid, malformed, or expired tokens with HTTP 401.
 * 3. Extracts user UUID strictly from token subject (`sub`).
 * 4. Queries the database directly to confirm the user exists and is active (`is_active = TRUE`).
 * 5. Uses the current live database role (`user.role`), never trusting static claims in the token.
 * 6. Immediately revokes access if the user has been deactivated or deleted in the database.
 */
async function authenticateJWT(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Authentication required: missing or malformed Authorization header',
    });
  }

  const token = authHeader.slice(7).trim();

  let decoded;
  try {
    decoded = verifyToken(token);
  } catch (err) {
    const isExpired = err.name === 'TokenExpiredError';
    return res.status(401).json({
      error: 'Unauthorized',
      message: isExpired ? 'Token has expired' : 'Invalid token',
    });
  }

  if (!decoded || !decoded.sub) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid token payload: missing subject claim',
    });
  }

  try {
    // Query live database user state
    const result = await pool.query(
      `SELECT id, username, email, role, is_active, created_at, updated_at
       FROM public.users
       WHERE id = $1`,
      [decoded.sub]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'User no longer exists',
      });
    }

    const user = result.rows[0];

    // Check active status in database
    if (!user.is_active) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'User account is deactivated',
      });
    }

    // Attach verified user with live database role
    req.user = user;
    next();
  } catch (err) {
    return next(err);
  }
}

/**
 * Role-Based Access Control Middleware: requireRole(...allowedRoles)
 *
 * Enforces that the authenticated user possesses one of the specified roles.
 * Must be preceded by authenticateJWT in the middleware chain.
 */
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Authentication required before role verification',
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Insufficient role privileges to perform this action',
      });
    }

    next();
  };
}

module.exports = {
  authenticateJWT,
  requireRole,
};
