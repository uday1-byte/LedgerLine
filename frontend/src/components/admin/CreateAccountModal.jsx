import React, { useState } from 'react';
import { api } from '../../api/client';
import { Alert } from '../common/Alert';

export function CreateAccountModal({ isOpen, onClose, onSuccess }) {
  const [accountNumber, setAccountNumber] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState(null);

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    const trimmed = accountNumber.trim();
    if (!trimmed) {
      setError('Account number cannot be empty');
      return;
    }
    if (trimmed.length > 32) {
      setError('Account number cannot exceed 32 characters');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await api.post('/api/accounts', { accountNumber: trimmed });
      // Only refresh/succeed on confirmed backend response
      onSuccess(res.account);
      handleClose();
    } catch (err) {
      if (err.status === 409) {
        setError('Duplicate Account: An account with this account number already exists.');
      } else {
        setError(err.message || 'Failed to create customer account');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    setAccountNumber('');
    setError(null);
    setIsSubmitting(false);
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-account-title"
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
          maxWidth: '460px',
          width: '100%',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
          border: '1px solid #e2e8f0',
          overflow: 'hidden',
        }}
      >
        <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 id="create-account-title" style={{ fontSize: '1.15rem', fontWeight: '700', color: '#0f172a', margin: 0 }}>
            Provision Customer Account
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

          <div style={{ marginBottom: '1.25rem' }}>
            <label
              htmlFor="new-account-number"
              style={{ display: 'block', fontSize: '0.85rem', fontWeight: '700', color: '#1e293b', marginBottom: '0.35rem' }}
            >
              Account Number <span style={{ color: '#dc2626' }}>*</span>
            </label>
            <input
              type="text"
              id="new-account-number"
              data-testid="input-new-account-number"
              placeholder="e.g. ACC-2026-001"
              value={accountNumber}
              onChange={(e) => setAccountNumber(e.target.value)}
              disabled={isSubmitting}
              maxLength={32}
              style={{
                width: '100%',
                padding: '0.65rem 0.75rem',
                borderRadius: '0.375rem',
                border: '1px solid #cbd5e1',
                fontSize: '0.9rem',
                fontFamily: 'monospace',
                outline: 'none',
              }}
            />
            <span style={{ fontSize: '0.75rem', color: '#64748b', display: 'block', marginTop: '0.3rem' }}>
              Account will be created as an unassigned customer account with initial balance of ₹0.00.
            </span>
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
              disabled={isSubmitting || !accountNumber.trim()}
              data-testid="btn-submit-create-account"
              style={{
                padding: '0.55rem 1.25rem',
                backgroundColor: '#0284c7',
                color: '#ffffff',
                border: 'none',
                borderRadius: '0.375rem',
                fontSize: '0.875rem',
                fontWeight: '600',
                cursor: isSubmitting || !accountNumber.trim() ? 'not-allowed' : 'pointer',
                opacity: isSubmitting || !accountNumber.trim() ? 0.6 : 1,
              }}
            >
              {isSubmitting ? 'Provisioning...' : 'Provision Account'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

