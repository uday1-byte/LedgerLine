import React, { useState } from 'react';
import { api } from '../../api/client';
import { Alert } from '../common/Alert';

const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export function AssignOwnerModal({ isOpen, account, onClose, onSuccess }) {
  const [userId, setUserId] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState(null);

  if (!isOpen || !account) return null;

  const isAlreadyAssigned = Boolean(account.user_id);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    if (isAlreadyAssigned) {
      setError('Account Ownership Immutability: This account has already been assigned an owner and cannot be reassigned.');
      return;
    }

    const trimmed = userId.trim();
    if (!trimmed) {
      setError('Target User UUID is required');
      return;
    }
    if (!UUID_REGEX.test(trimmed)) {
      setError('Must be a valid 36-character UUID format (e.g. 00000000-0000-0000-0000-000000000000)');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await api.post(`/api/admin/accounts/${account.id}/owner`, { userId: trimmed });
      onSuccess(res.account);
      handleClose();
    } catch (err) {
      let msg = err.message || 'Failed to assign account owner';
      if (err.status === 404) {
        msg = 'Target User Not Found: The specified User UUID does not exist.';
      } else if (err.status === 422) {
        msg = `Invariant Violation: ${err.message || 'Account ownership is immutable once assigned, or target user is inactive.'}`;
      }
      setError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    setUserId('');
    setError(null);
    setIsSubmitting(false);
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="assign-owner-title"
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
      <div
        style={{
          backgroundColor: '#ffffff',
          borderRadius: '0.75rem',
          maxWidth: '500px',
          width: '100%',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
          border: '1px solid #e2e8f0',
          overflow: 'hidden',
        }}
      >
        <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 id="assign-owner-title" style={{ fontSize: '1.15rem', fontWeight: '700', color: '#0f172a', margin: 0 }}>
            Assign Account Ownership
          </h3>
          <button
            onClick={handleClose}
            disabled={isSubmitting}
            style={{ background: 'none', border: 'none', fontSize: '1.25rem', cursor: 'pointer', color: '#64748b' }}
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ padding: '1.5rem' }}>
          {error && (
            <div style={{ marginBottom: '1rem' }}>
              <Alert type="error" message={error} />
            </div>
          )}

          {/* Account Details Box */}
          <div style={{ padding: '0.85rem 1rem', backgroundColor: '#f8fafc', borderRadius: '0.5rem', border: '1px solid #e2e8f0', marginBottom: '1.25rem' }}>
            <span style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase', fontWeight: '700' }}>
              Target Customer Account
            </span>
            <div style={{ fontFamily: 'monospace', fontSize: '1.1rem', fontWeight: '700', color: '#0f172a', marginTop: '0.15rem' }}>
              {account.account_number}
            </div>
            <div style={{ fontSize: '0.75rem', color: '#64748b', fontFamily: 'monospace', marginTop: '0.2rem' }}>
              ID: {account.id}
            </div>
            {isAlreadyAssigned && (
              <div style={{ marginTop: '0.4rem', fontSize: '0.8rem', color: '#dc2626', fontWeight: '600' }}>
                ⚠️ Already assigned to user {account.user_id}. Re-assignment is strictly forbidden by database immutability.
              </div>
            )}
          </div>

          {/* User UUID Input */}
          <div style={{ marginBottom: '1.25rem' }}>
            <label
              htmlFor="assign-user-uuid"
              style={{ display: 'block', fontSize: '0.85rem', fontWeight: '700', color: '#1e293b', marginBottom: '0.35rem' }}
            >
              Target User UUID <span style={{ color: '#dc2626' }}>*</span>
            </label>
            <input
              type="text"
              id="assign-user-uuid"
              data-testid="input-assign-user-id"
              placeholder="e.g. 00000000-0000-0000-0000-000000000000"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              disabled={isSubmitting || isAlreadyAssigned}
              style={{
                width: '100%',
                padding: '0.65rem 0.75rem',
                borderRadius: '0.375rem',
                border: '1px solid #cbd5e1',
                fontSize: '0.9rem',
                fontFamily: 'monospace',
                outline: 'none',
                backgroundColor: isAlreadyAssigned ? '#f1f5f9' : '#ffffff',
              }}
            />
            {/* Notice regarding absence of general user list */}
            <div style={{ marginTop: '0.5rem', padding: '0.6rem 0.75rem', backgroundColor: '#f0fdf4', borderRadius: '0.375rem', border: '1px solid #bbf7d0', fontSize: '0.75rem', color: '#166534', lineHeight: '1.4' }}>
              <strong>Architecture Notice:</strong> The backend has no general user-directory endpoint (`GET /api/users`). User UUIDs must be verified from authorized onboarding records or user session claims.
            </div>
          </div>

          <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '1.5rem' }}>
            <button
              type="button"
              onClick={handleClose}
              disabled={isSubmitting}
              style={{
                padding: '0.55rem 1.1rem',
                backgroundColor: '#ffffff',
                border: '1px solid #cbd5e1',
                borderRadius: '0.375rem',
                fontSize: '0.875rem',
                fontWeight: '600',
                color: '#475569',
                cursor: isSubmitting ? 'not-allowed' : 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || isAlreadyAssigned || !userId.trim()}
              data-testid="btn-submit-assign-owner"
              style={{
                padding: '0.55rem 1.25rem',
                backgroundColor: '#0284c7',
                color: '#ffffff',
                border: 'none',
                borderRadius: '0.375rem',
                fontSize: '0.875rem',
                fontWeight: '600',
                cursor: isSubmitting || isAlreadyAssigned || !userId.trim() ? 'not-allowed' : 'pointer',
                opacity: isSubmitting || isAlreadyAssigned || !userId.trim() ? 0.6 : 1,
              }}
            >
              {isSubmitting ? 'Assigning...' : 'Assign Owner'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

