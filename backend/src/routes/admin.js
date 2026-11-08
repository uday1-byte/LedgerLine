const express = require('express');
const { z } = require('zod');
const { pool } = require('../config/db');
const { authenticateJWT, requireRole } = require('../middleware/auth');

const router = express.Router();

// General PostgreSQL-compatible UUID regex validator (supports RFC 4122 and special system UUIDs)
const uuidSchema = z.string().regex(
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,
  { message: 'Must be a valid UUID' }
);

// Role update schema
const updateRoleSchema = z.object({
  role: z.enum(['admin', 'account_holder', 'auditor'], {
    errorMap: () => ({ message: 'role must be one of: admin, account_holder, auditor' }),
  }),
});

// Status update schema
const updateStatusSchema = z.object({
  isActive: z.boolean({ required_error: 'isActive (boolean) is required' }),
});

// Account assignment schema
const assignOwnerSchema = z.object({
  userId: uuidSchema,
});

/**
 * @route   PATCH /api/admin/users/:id/role
 * @desc    Update a user's role.
 *          - Protected by last-admin invariant (cannot demote the last active admin).
 *          - Calls public.admin_update_user_role(UUID, VARCHAR).
 * @access  Private (Admin only)
 */
router.patch('/users/:id/role', authenticateJWT, requireRole('admin'), async (req, res, next) => {
  try {
    const idParam = uuidSchema.safeParse(req.params.id);
    if (!idParam.success) {
      return res.status(400).json({
        error: 'ValidationError',
        details: idParam.error.flatten().fieldErrors,
      });
    }

    const bodyResult = updateRoleSchema.safeParse(req.body);
    if (!bodyResult.success) {
      return res.status(400).json({
        error: 'ValidationError',
        details: bodyResult.error.flatten().fieldErrors,
      });
    }

    const targetUserId = idParam.data;
    const { role } = bodyResult.data;

    const result = await pool.query(
      'SELECT * FROM public.admin_update_user_role($1, $2)',
      [targetUserId, role]
    );

    return res.json({
      message: 'User role updated successfully',
      user: result.rows[0],
    });
  } catch (err) {
    if (err.code === 'P0002' || (err.message && err.message.includes('LL002'))) {
      return res.status(404).json({
        error: 'NotFoundError',
        message: err.message.replace(/^LL002:\s*/, ''),
      });
    }
    if (err.code === '23514' || (err.message && err.message.includes('LL007'))) {
      return res.status(422).json({
        error: 'InvariantViolationError',
        message: err.message.replace(/^LL007:\s*/, ''),
      });
    }
    next(err);
  }
});

/**
 * @route   PATCH /api/admin/users/:id/status
 * @desc    Activate or deactivate a user account.
 *          - Protected by last-admin invariant (cannot deactivate the last active admin).
 *          - Calls public.admin_set_user_status(UUID, BOOLEAN).
 * @access  Private (Admin only)
 */
router.patch('/users/:id/status', authenticateJWT, requireRole('admin'), async (req, res, next) => {
  try {
    const idParam = uuidSchema.safeParse(req.params.id);
    if (!idParam.success) {
      return res.status(400).json({
        error: 'ValidationError',
        details: idParam.error.flatten().fieldErrors,
      });
    }

    const rawActive = req.body.isActive !== undefined ? req.body.isActive : req.body.is_active;
    const bodyResult = updateStatusSchema.safeParse({ isActive: rawActive });
    if (!bodyResult.success) {
      return res.status(400).json({
        error: 'ValidationError',
        details: bodyResult.error.flatten().fieldErrors,
      });
    }

    const targetUserId = idParam.data;
    const { isActive } = bodyResult.data;

    const result = await pool.query(
      'SELECT * FROM public.admin_set_user_status($1, $2)',
      [targetUserId, isActive]
    );

    return res.json({
      message: `User ${isActive ? 'activated' : 'deactivated'} successfully`,
      user: result.rows[0],
    });
  } catch (err) {
    if (err.code === 'P0002' || (err.message && err.message.includes('LL002'))) {
      return res.status(404).json({
        error: 'NotFoundError',
        message: err.message.replace(/^LL002:\s*/, ''),
      });
    }
    if (err.code === '23514' || (err.message && err.message.includes('LL007'))) {
      return res.status(422).json({
        error: 'InvariantViolationError',
        message: err.message.replace(/^LL007:\s*/, ''),
      });
    }
    next(err);
  }
});

/**
 * @route   POST /api/admin/accounts/:id/owner
 * @desc    Assign an unassigned account to a user owner.
 *          - Account ownership is immutable once assigned.
 *          - System equity accounts cannot be assigned.
 *          - Target user must exist and be active.
 *          - Calls public.admin_assign_account_owner(UUID, UUID).
 * @access  Private (Admin only)
 */
router.post('/accounts/:id/owner', authenticateJWT, requireRole('admin'), async (req, res, next) => {
  try {
    const idParam = uuidSchema.safeParse(req.params.id);
    if (!idParam.success) {
      return res.status(400).json({
        error: 'ValidationError',
        details: idParam.error.flatten().fieldErrors,
      });
    }

    const rawUserId = req.body.userId || req.body.user_id;
    const bodyResult = assignOwnerSchema.safeParse({ userId: rawUserId });
    if (!bodyResult.success) {
      return res.status(400).json({
        error: 'ValidationError',
        details: bodyResult.error.flatten().fieldErrors,
      });
    }

    const accountId = idParam.data;
    const { userId } = bodyResult.data;

    const result = await pool.query(
      'SELECT * FROM public.admin_assign_account_owner($1, $2)',
      [accountId, userId]
    );

    return res.json({
      message: 'Account owner assigned successfully',
      account: result.rows[0],
    });
  } catch (err) {
    if (err.code === 'P0002' || (err.message && err.message.includes('LL002'))) {
      return res.status(404).json({
        error: 'NotFoundError',
        message: err.message.replace(/^LL002:\s*/, ''),
      });
    }
    if (err.code === '23514' || (err.message && err.message.includes('LL007'))) {
      return res.status(422).json({
        error: 'InvariantViolationError',
        message: err.message.replace(/^LL007:\s*/, ''),
      });
    }
    next(err);
  }
});

module.exports = router;
