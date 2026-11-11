import React, { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { Alert } from '../common/Alert';
import { UserSelectField } from './UserSelectField';

const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export function UserGovernanceForm({
  currentAdminUserId,
  users = [],
  selectedUser = null,
  onUserUpdated,
}) {
  // 1. Role Update State
  const [roleUserId, setRoleUserId] = useState('');
  const [selectedRole, setSelectedRole] = useState('account_holder');
  const [roleConfirmationOpen, setRoleConfirmationOpen] = useState(false);
  const [isUpdatingRole, setIsUpdatingRole] = useState(false);
  const [roleMessage, setRoleMessage] = useState(null);
  const [roleError, setRoleError] = useState(null);

  // 2. Status Update State
  const [statusUserId, setStatusUserId] = useState('');
  const [selectedStatus, setSelectedStatus] = useState(true); // true = active, false = inactive
  const [statusConfirmationOpen, setStatusConfirmationOpen] = useState(false);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const [statusMessage, setStatusMessage] = useState(null);
  const [statusError, setStatusError] = useState(null);

  // Sync both cards when an admin selects a user row from the Registered Users table
  useEffect(() => {
    if (!selectedUser) return;
    setRoleUserId(selectedUser.id);
    setSelectedRole(selectedUser.role || 'account_holder');
    setRoleError(null);
    setRoleMessage(null);

    setStatusUserId(selectedUser.id);
    setSelectedStatus(!selectedUser.is_active);
    setStatusError(null);
    setStatusMessage(null);
  }, [selectedUser]);

  // === Handlers for Role ===
  const handleInitiateRoleUpdate = (e) => {
    e.preventDefault();
    setRoleError(null);
    setRoleMessage(null);

    const trimmed = roleUserId.trim();
    if (!trimmed) {
      setRoleError('Target User UUID is required');
      return;
    }
    if (!UUID_REGEX.test(trimmed)) {
      setRoleError('Must be a valid 36-character UUID format');
      return;
    }

    setRoleConfirmationOpen(true);
  };

  const handleConfirmRoleUpdate = async () => {
    setIsUpdatingRole(true);
    setRoleError(null);
    setRoleMessage(null);

    try {
      const res = await api.patch(`/api/admin/users/${roleUserId.trim()}/role`, {
        role: selectedRole,
      });

      // Non-optimistic: Update only after backend response
      setRoleMessage(`Successfully updated user ${res.user.id} role to ${res.user.role}.`);
      setRoleConfirmationOpen(false);
      onUserUpdated?.();
    } catch (err) {
      let msg = err.message || 'Failed to update user role';
      if (err.status === 404) {
        msg = 'Target User Not Found: The specified User UUID does not exist.';
      } else if (err.status === 422) {
        msg = `Last-Admin Protection Violation: ${err.message || 'Cannot demote the last active administrator.'}`;
      }
      setRoleError(msg);
      setRoleConfirmationOpen(false);
    } finally {
      setIsUpdatingRole(false);
    }
  };

  // === Handlers for Status ===
  const handleInitiateStatusUpdate = (e) => {
    e.preventDefault();
    setStatusError(null);
    setStatusMessage(null);

    const trimmed = statusUserId.trim();
    if (!trimmed) {
      setStatusError('Target User UUID is required');
      return;
    }
    if (!UUID_REGEX.test(trimmed)) {
      setStatusError('Must be a valid 36-character UUID format');
      return;
    }

    setStatusConfirmationOpen(true);
  };

  const handleConfirmStatusUpdate = async () => {
    setIsUpdatingStatus(true);
    setStatusError(null);
    setStatusMessage(null);

    try {
      const res = await api.patch(`/api/admin/users/${statusUserId.trim()}/status`, {
        isActive: selectedStatus,
      });

      // Non-optimistic: Update only after backend response
      setStatusMessage(`Successfully set user ${res.user.id} active status to ${res.user.is_active}.`);
      setStatusConfirmationOpen(false);
      onUserUpdated?.();
    } catch (err) {
      let msg = err.message || 'Failed to update user status';
      if (err.status === 404) {
        msg = 'Target User Not Found: The specified User UUID does not exist.';
      } else if (err.status === 422) {
        msg = `Last-Admin Protection Violation: ${err.message || 'Cannot deactivate the last active administrator.'}`;
      }
      setStatusError(msg);
      setStatusConfirmationOpen(false);
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  const isRoleDemotingSelf = currentAdminUserId && roleUserId.trim() === currentAdminUserId && selectedRole !== 'admin';
  const isStatusDeactivatingSelf = currentAdminUserId && statusUserId.trim() === currentAdminUserId && !selectedStatus;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '1.5rem' }}>
      {/* 1. Role Management Card */}
      <div
        role="region"
        aria-label="User Role Management"
        style={{
          backgroundColor: '#ffffff',
          borderRadius: '0.75rem',
          border: '1px solid #e2e8f0',
          padding: '1.5rem',
          boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)',
        }}
      >
        <h3 style={{ fontSize: '1.1rem', fontWeight: '700', color: '#0f172a', margin: '0 0 0.5rem 0' }}>
          User Role Assignment
        </h3>
        <p style={{ fontSize: '0.825rem', color: '#64748b', margin: '0 0 1.25rem 0' }}>
          Assign system roles: <code style={{ fontWeight: '700' }}>admin</code>, <code style={{ fontWeight: '700' }}>account_holder</code>, or <code style={{ fontWeight: '700' }}>auditor</code>. Protected by PostgreSQL last-admin invariant.
        </p>

        {roleMessage && (
          <div style={{ marginBottom: '1rem' }}>
            <Alert type="success" message={roleMessage} />
          </div>
        )}
        {roleError && (
          <div style={{ marginBottom: '1rem' }}>
            <Alert type="error" message={roleError} />
          </div>
        )}

        <form onSubmit={handleInitiateRoleUpdate}>
          <UserSelectField
            label="Select Registered User"
            users={users}
            selectedUserId={roleUserId.trim()}
            onSelectUser={(nextId, userObj) => {
              setRoleUserId(nextId);
              if (userObj) setSelectedRole(userObj.role);
            }}
            disabled={isUpdatingRole}
            searchTestId="input-role-user-search"
            selectTestId="select-role-user"
            idPrefix="role-user"
          />
          <div style={{ marginBottom: '1rem' }}>
            <label
              htmlFor="role-target-uuid"
              style={{ display: 'block', fontSize: '0.85rem', fontWeight: '700', color: '#1e293b', marginBottom: '0.35rem' }}
            >
              Target User UUID <span style={{ fontWeight: '500', color: '#64748b' }}>(or manual fallback)</span> <span style={{ color: '#dc2626' }}>*</span>
            </label>
            <input
              type="text"
              id="role-target-uuid"
              data-testid="input-role-user-id"
              placeholder="e.g. 00000000-0000-0000-0000-000000000000"
              value={roleUserId}
              onChange={(e) => setRoleUserId(e.target.value)}
              disabled={isUpdatingRole}
              style={{
                width: '100%',
                padding: '0.6rem 0.75rem',
                borderRadius: '0.375rem',
                border: '1px solid #cbd5e1',
                fontSize: '0.875rem',
                fontFamily: 'monospace',
                outline: 'none',
              }}
            />
          </div>

          <div style={{ marginBottom: '1.25rem' }}>
            <label
              htmlFor="select-target-role"
              style={{ display: 'block', fontSize: '0.85rem', fontWeight: '700', color: '#1e293b', marginBottom: '0.35rem' }}
            >
              New Assigned Role <span style={{ color: '#dc2626' }}>*</span>
            </label>
            <select
              id="select-target-role"
              data-testid="select-target-role"
              value={selectedRole}
              onChange={(e) => setSelectedRole(e.target.value)}
              disabled={isUpdatingRole}
              style={{
                width: '100%',
                padding: '0.6rem 0.75rem',
                borderRadius: '0.375rem',
                border: '1px solid #cbd5e1',
                fontSize: '0.875rem',
                outline: 'none',
                backgroundColor: '#ffffff',
              }}
            >
              <option value="account_holder">Account Holder (Customer)</option>
              <option value="auditor">Auditor (Compliance Oversight)</option>
              <option value="admin">Administrator (Full Governance)</option>
            </select>
          </div>

          <button
            type="submit"
            disabled={isUpdatingRole || !roleUserId.trim()}
            data-testid="btn-initiate-role-update"
            style={{
              width: '100%',
              padding: '0.6rem 1rem',
              backgroundColor: '#0284c7',
              color: '#ffffff',
              border: 'none',
              borderRadius: '0.375rem',
              fontSize: '0.875rem',
              fontWeight: '600',
              cursor: isUpdatingRole || !roleUserId.trim() ? 'not-allowed' : 'pointer',
              opacity: isUpdatingRole || !roleUserId.trim() ? 0.6 : 1,
            }}
          >
            Review Role Change &rarr;
          </button>
        </form>

        {/* Role Confirmation Modal */}
        {roleConfirmationOpen && (
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-role-title"
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: 'rgba(15, 23, 42, 0.65)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 50,
              padding: '1rem',
            }}
          >
            <div style={{ backgroundColor: '#ffffff', borderRadius: '0.75rem', maxWidth: '440px', width: '100%', padding: '1.5rem', border: '1px solid #e2e8f0', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)' }}>
              <h3 id="confirm-role-title" style={{ fontSize: '1.1rem', fontWeight: '700', color: '#0f172a', margin: '0 0 0.75rem 0' }}>
                Confirm User Role Change
              </h3>
              <p style={{ fontSize: '0.875rem', color: '#475569', lineHeight: '1.5', margin: 0 }}>
                Are you sure you want to change the role of user <code style={{ fontFamily: 'monospace', fontWeight: '700' }}>{roleUserId.trim()}</code> to <strong style={{ textTransform: 'capitalize' }}>{selectedRole}</strong>?
              </p>

              {isRoleDemotingSelf && (
                <div style={{ marginTop: '0.75rem', padding: '0.75rem', backgroundColor: '#fef2f2', borderRadius: '0.375rem', border: '1px solid #fecaca', color: '#991b1b', fontSize: '0.8rem', lineHeight: '1.4' }}>
                  ⚠️ <strong>Self-Demotion Warning:</strong> You are changing your own administrative role. If you are the last active administrator, the database will reject this transaction.
                </div>
              )}

              <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '1.25rem' }}>
                <button
                  type="button"
                  onClick={() => setRoleConfirmationOpen(false)}
                  disabled={isUpdatingRole}
                  style={{ padding: '0.5rem 1rem', backgroundColor: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '0.375rem', fontSize: '0.85rem', fontWeight: '600', color: '#475569', cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirmRoleUpdate}
                  disabled={isUpdatingRole}
                  data-testid="btn-confirm-role-update"
                  style={{ padding: '0.5rem 1rem', backgroundColor: '#0284c7', color: '#ffffff', border: 'none', borderRadius: '0.375rem', fontSize: '0.85rem', fontWeight: '600', cursor: isUpdatingRole ? 'not-allowed' : 'pointer' }}
                >
                  {isUpdatingRole ? 'Updating...' : 'Confirm Role Update'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 2. Status Management Card */}
      <div
        role="region"
        aria-label="User Status Management"
        style={{
          backgroundColor: '#ffffff',
          borderRadius: '0.75rem',
          border: '1px solid #e2e8f0',
          padding: '1.5rem',
          boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)',
        }}
      >
        <h3 style={{ fontSize: '1.1rem', fontWeight: '700', color: '#0f172a', margin: '0 0 0.5rem 0' }}>
          User Account Activation & Deactivation
        </h3>
        <p style={{ fontSize: '0.825rem', color: '#64748b', margin: '0 0 1.25rem 0' }}>
          Deactivated users are blocked from logging in or initiating transactions. Protected by PostgreSQL last-admin invariant.
        </p>

        {statusMessage && (
          <div style={{ marginBottom: '1rem' }}>
            <Alert type="success" message={statusMessage} />
          </div>
        )}
        {statusError && (
          <div style={{ marginBottom: '1rem' }}>
            <Alert type="error" message={statusError} />
          </div>
        )}

        <form onSubmit={handleInitiateStatusUpdate}>
          <UserSelectField
            label="Select Registered User"
            users={users}
            selectedUserId={statusUserId.trim()}
            onSelectUser={(nextId, userObj) => {
              setStatusUserId(nextId);
              if (userObj) setSelectedStatus(!userObj.is_active);
            }}
            disabled={isUpdatingStatus}
            searchTestId="input-status-user-search"
            selectTestId="select-status-user"
            idPrefix="status-user"
          />
          <div style={{ marginBottom: '1rem' }}>
            <label
              htmlFor="status-target-uuid"
              style={{ display: 'block', fontSize: '0.85rem', fontWeight: '700', color: '#1e293b', marginBottom: '0.35rem' }}
            >
              Target User UUID <span style={{ fontWeight: '500', color: '#64748b' }}>(or manual fallback)</span> <span style={{ color: '#dc2626' }}>*</span>
            </label>
            <input
              type="text"
              id="status-target-uuid"
              data-testid="input-status-user-id"
              placeholder="e.g. 00000000-0000-0000-0000-000000000000"
              value={statusUserId}
              onChange={(e) => setStatusUserId(e.target.value)}
              disabled={isUpdatingStatus}
              style={{
                width: '100%',
                padding: '0.6rem 0.75rem',
                borderRadius: '0.375rem',
                border: '1px solid #cbd5e1',
                fontSize: '0.875rem',
                fontFamily: 'monospace',
                outline: 'none',
              }}
            />
          </div>

          <div style={{ marginBottom: '1.25rem' }}>
            <label
              htmlFor="select-target-status"
              style={{ display: 'block', fontSize: '0.85rem', fontWeight: '700', color: '#1e293b', marginBottom: '0.35rem' }}
            >
              Account Status <span style={{ color: '#dc2626' }}>*</span>
            </label>
            <select
              id="select-target-status"
              data-testid="select-target-status"
              value={selectedStatus ? 'active' : 'deactivated'}
              onChange={(e) => setSelectedStatus(e.target.value === 'active')}
              disabled={isUpdatingStatus}
              style={{
                width: '100%',
                padding: '0.6rem 0.75rem',
                borderRadius: '0.375rem',
                border: '1px solid #cbd5e1',
                fontSize: '0.875rem',
                outline: 'none',
                backgroundColor: '#ffffff',
              }}
            >
              <option value="active">Active (Permitted to Log In)</option>
              <option value="deactivated">Deactivated (Access Revoked)</option>
            </select>
          </div>

          <button
            type="submit"
            disabled={isUpdatingStatus || !statusUserId.trim()}
            data-testid="btn-initiate-status-update"
            style={{
              width: '100%',
              padding: '0.6rem 1rem',
              backgroundColor: '#0284c7',
              color: '#ffffff',
              border: 'none',
              borderRadius: '0.375rem',
              fontSize: '0.875rem',
              fontWeight: '600',
              cursor: isUpdatingStatus || !statusUserId.trim() ? 'not-allowed' : 'pointer',
              opacity: isUpdatingStatus || !statusUserId.trim() ? 0.6 : 1,
            }}
          >
            Review Status Change &rarr;
          </button>
        </form>

        {/* Status Confirmation Modal */}
        {statusConfirmationOpen && (
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-status-title"
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: 'rgba(15, 23, 42, 0.65)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 50,
              padding: '1rem',
            }}
          >
            <div style={{ backgroundColor: '#ffffff', borderRadius: '0.75rem', maxWidth: '440px', width: '100%', padding: '1.5rem', border: '1px solid #e2e8f0', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)' }}>
              <h3 id="confirm-status-title" style={{ fontSize: '1.1rem', fontWeight: '700', color: '#0f172a', margin: '0 0 0.75rem 0' }}>
                Confirm User Status Change
              </h3>
              <p style={{ fontSize: '0.875rem', color: '#475569', lineHeight: '1.5', margin: 0 }}>
                Are you sure you want to set the status of user <code style={{ fontFamily: 'monospace', fontWeight: '700' }}>{statusUserId.trim()}</code> to <strong>{selectedStatus ? 'Active' : 'Deactivated'}</strong>?
              </p>

              {isStatusDeactivatingSelf && (
                <div style={{ marginTop: '0.75rem', padding: '0.75rem', backgroundColor: '#fef2f2', borderRadius: '0.375rem', border: '1px solid #fecaca', color: '#991b1b', fontSize: '0.8rem', lineHeight: '1.4' }}>
                  ⚠️ <strong>Self-Deactivation Warning:</strong> You are deactivating your own administrative session. If you are the last active administrator, the database will reject this transaction.
                </div>
              )}

              <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '1.25rem' }}>
                <button
                  type="button"
                  onClick={() => setStatusConfirmationOpen(false)}
                  disabled={isUpdatingStatus}
                  style={{ padding: '0.5rem 1rem', backgroundColor: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '0.375rem', fontSize: '0.85rem', fontWeight: '600', color: '#475569', cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirmStatusUpdate}
                  disabled={isUpdatingStatus}
                  data-testid="btn-confirm-status-update"
                  style={{
                    padding: '0.5rem 1rem',
                    backgroundColor: selectedStatus ? '#16a34a' : '#dc2626',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '0.375rem',
                    fontSize: '0.85rem',
                    fontWeight: '600',
                    cursor: isUpdatingStatus ? 'not-allowed' : 'pointer',
                  }}
                >
                  {isUpdatingStatus ? 'Updating...' : selectedStatus ? 'Activate User' : 'Deactivate User'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

