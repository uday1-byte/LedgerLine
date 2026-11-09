const { pool } = require('../config/db');

const VALID_ACTIONS = Object.freeze(['transfer', 'deposit', 'withdrawal', 'reversal']);

/**
 * Custom error thrown when persistence of an audit record fails.
 */
class AuditPersistenceError extends Error {
  constructor(message, originalError = null, auditContext = {}) {
    super(message || 'Failed to persist required audit trail record');
    this.name = 'AuditPersistenceError';
    this.statusCode = 500;
    this.durableAudit = false;
    this.originalError = originalError;
    this.auditContext = auditContext;
  }
}

/**
 * Formats and emits a structured critical log to stderr.
 */
function logAuditPersistenceFailure(originalError, auditContext) {
  const structuredLog = {
    level: 'CRITICAL',
    error: 'AuditPersistenceError',
    message: 'Failed to persist durable audit record to audit_refused_attempts',
    durableAudit: false,
    timestamp: new Date().toISOString(),
    cause: originalError ? originalError.message : 'Unknown error',
    auditContext: {
      userId: auditContext.userId || null,
      accountId: auditContext.accountId || null,
      attemptedAccountId: auditContext.attemptedAccountId || null,
      action: auditContext.action || null,
      amountPaise: auditContext.amountPaise != null ? auditContext.amountPaise.toString() : null,
      reasonCode: auditContext.reasonCode || null,
    },
  };
  console.error(JSON.stringify(structuredLog));
}

/**
 * Sends a standardized HTTP 500 response when audit trail persistence fails.
 */
function sendAuditPersistenceFailure(res, error) {
  return res.status(500).json({
    error: 'AuditPersistenceError',
    message: 'Failed to record durable audit trail for financial refusal',
    durableAudit: false,
  });
}

/**
 * Records an authenticated refusal attempt in the append-only audit_refused_attempts table.
 *
 * Requirements:
 * - Must be an authenticated request (userId required). Anonymous 401s are never audited.
 * - Action must be one of: 'transfer', 'deposit', 'withdrawal', 'reversal'.
 * - If account does not exist (HTTP 404), account_id MUST be set to NULL to satisfy the foreign key,
 *   and the attempted account UUID must be preserved in reason_message.
 * - If audit insertion fails, logs a structured critical stderr event and throws AuditPersistenceError.
 */
async function recordRefusalAudit({
  userId,
  accountId = null,
  attemptedAccountId = null,
  accountExists = true,
  action,
  amountPaise = null,
  reasonCode,
  reasonMessage,
  idempotencyKey = null,
  clientIp = null,
}) {
  // 1. Enforce authenticated request requirement (Do not audit anonymous requests)
  if (!userId || typeof userId !== 'string' || userId.trim().length === 0) {
    throw new Error('Audit refused attempt requires an authenticated userId');
  }

  // 2. Validate action against allowed enum
  if (!VALID_ACTIONS.includes(action)) {
    throw new Error(`Invalid audit action: "${action}". Must be one of: ${VALID_ACTIONS.join(', ')}`);
  }

  // 3. Validate mandatory reason parameters
  if (!reasonCode || typeof reasonCode !== 'string') {
    throw new Error('Audit reasonCode is required');
  }
  if (!reasonMessage || typeof reasonMessage !== 'string') {
    throw new Error('Audit reasonMessage is required');
  }

  // 4. Resolve account_id and preserve attempted account UUID if nonexistent
  let dbAccountId = null;
  let finalReasonMessage = reasonMessage;

  const targetAttemptedAccount = attemptedAccountId || accountId;

  if (accountExists && accountId) {
    dbAccountId = accountId;
  } else {
    // Nonexistent account: set account_id to NULL to prevent FK violation (23503)
    dbAccountId = null;
    if (targetAttemptedAccount && !finalReasonMessage.includes(targetAttemptedAccount)) {
      finalReasonMessage = `${finalReasonMessage} (attempted account: ${targetAttemptedAccount})`;
    }
  }

  // 5. Format amount
  let formattedAmount = null;
  if (amountPaise != null) {
    const parsedAmount = BigInt(amountPaise);
    if (parsedAmount <= 0n) {
      throw new Error('attempted_amount_paise must be greater than zero');
    }
    formattedAmount = parsedAmount.toString();
  }

  // 6. Clean optional metadata
  const cleanIdempotencyKey = idempotencyKey ? String(idempotencyKey).slice(0, 255) : null;
  const cleanClientIp = clientIp ? String(clientIp).slice(0, 64) : null;

  const auditContext = {
    userId,
    accountId: dbAccountId,
    attemptedAccountId: targetAttemptedAccount,
    action,
    amountPaise: formattedAmount,
    reasonCode,
    reasonMessage: finalReasonMessage,
    idempotencyKey: cleanIdempotencyKey,
    clientIp: cleanClientIp,
  };

  try {
    const result = await pool.query(
      `INSERT INTO public.audit_refused_attempts (
         user_id,
         account_id,
         action,
         attempted_amount_paise,
         reason_code,
         reason_message,
         idempotency_key,
         client_ip,
         created_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
       RETURNING id, user_id, account_id, action, attempted_amount_paise, reason_code, reason_message, idempotency_key, client_ip, created_at`,
      [
        userId,
        dbAccountId,
        action,
        formattedAmount,
        reasonCode,
        finalReasonMessage,
        cleanIdempotencyKey,
        cleanClientIp,
      ]
    );

    return {
      success: true,
      durableAudit: true,
      auditRecord: result.rows[0],
    };
  } catch (err) {
    // Structured critical stderr log
    logAuditPersistenceFailure(err, auditContext);

    // Throw standardized AuditPersistenceError (durableAudit: false)
    throw new AuditPersistenceError(
      'Failed to persist required audit trail record',
      err,
      auditContext
    );
  }
}

module.exports = {
  recordRefusalAudit,
  sendAuditPersistenceFailure,
  AuditPersistenceError,
  VALID_ACTIONS,
};
