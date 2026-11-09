import React from 'react';

export function ConfirmationModal({
  isOpen,
  onConfirm,
  onCancel,
  operationDetails,
  isSubmitting,
}) {
  if (!isOpen || !operationDetails) return null;

  const {
    operationType,
    fromAccountLabel,
    toAccountLabel,
    displayAmountINR,
    amountPaise,
    idempotencyKey,
  } = operationDetails;

  const titles = {
    transfer: 'Confirm Customer Transfer',
    deposit: 'Confirm Cash Deposit',
    withdraw: 'Confirm Cash Withdrawal',
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirmation-modal-title"
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
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
          border: '1px solid #e2e8f0',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{
          padding: '1.25rem 1.5rem',
          borderBottom: '1px solid #e2e8f0',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <h3
            id="confirmation-modal-title"
            style={{ fontSize: '1.15rem', fontWeight: '700', color: '#0f172a', margin: 0 }}
          >
            {titles[operationType] || 'Confirm Transaction'}
          </h3>
          <span style={{ fontSize: '1.25rem' }}>⚖️</span>
        </div>

        {/* Content */}
        <div style={{ padding: '1.5rem' }}>
          <div style={{
            backgroundColor: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: '0.5rem',
            padding: '1rem',
            marginBottom: '1.25rem',
          }}>
            <div style={{ marginBottom: '0.85rem' }}>
              <span style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase', fontWeight: '600' }}>
                Amount to Transact
              </span>
              <div style={{ fontSize: '1.75rem', fontWeight: '800', color: '#0f172a', marginTop: '0.15rem' }}>
                {displayAmountINR}
              </div>
              <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
                ({amountPaise} integer paise)
              </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', borderTop: '1px solid #e2e8f0', paddingTop: '0.75rem' }}>
              <div>
                <span style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase', fontWeight: '600' }}>
                  Source (From)
                </span>
                <div style={{ fontSize: '0.9rem', fontWeight: '600', color: '#1e293b', marginTop: '0.1rem', wordBreak: 'break-all' }}>
                  {fromAccountLabel}
                </div>
              </div>
              <div>
                <span style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase', fontWeight: '600' }}>
                  Destination (To)
                </span>
                <div style={{ fontSize: '0.9rem', fontWeight: '600', color: '#1e293b', marginTop: '0.1rem', wordBreak: 'break-all' }}>
                  {toAccountLabel}
                </div>
              </div>
            </div>
          </div>

          {/* Reference Key Info */}
          <div style={{
            fontSize: '0.75rem',
            color: '#64748b',
            backgroundColor: '#f1f5f9',
            padding: '0.5rem 0.75rem',
            borderRadius: '0.375rem',
            marginBottom: '1rem',
            fontFamily: 'monospace',
            wordBreak: 'break-all',
          }}>
            <strong style={{ fontFamily: 'sans-serif' }}>Idempotency Reference:</strong> {idempotencyKey}
          </div>

          <p style={{ fontSize: '0.825rem', color: '#dc2626', margin: 0 }}>
            ⚠️ <strong>Notice:</strong> Financial double-entry transactions are committed immutably once confirmed. Please verify the accounts and amount carefully.
          </p>
        </div>

        {/* Action Buttons */}
        <div style={{
          padding: '1rem 1.5rem',
          backgroundColor: '#f8fafc',
          borderTop: '1px solid #e2e8f0',
          display: 'flex',
          justifyContent: 'flex-end',
          gap: '0.75rem',
        }}>
          <button
            type="button"
            onClick={onCancel}
            disabled={isSubmitting}
            data-testid="modal-cancel-btn"
            style={{
              padding: '0.55rem 1rem',
              borderRadius: '0.375rem',
              border: '1px solid #cbd5e1',
              backgroundColor: '#ffffff',
              color: '#475569',
              fontWeight: '600',
              fontSize: '0.875rem',
              cursor: isSubmitting ? 'not-allowed' : 'pointer',
              opacity: isSubmitting ? 0.6 : 1,
            }}
          >
            Back to Edit
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isSubmitting}
            data-testid="modal-confirm-btn"
            style={{
              padding: '0.55rem 1.25rem',
              borderRadius: '0.375rem',
              border: 'none',
              backgroundColor: '#0284c7',
              color: '#ffffff',
              fontWeight: '600',
              fontSize: '0.875rem',
              cursor: isSubmitting ? 'not-allowed' : 'pointer',
              opacity: isSubmitting ? 0.6 : 1,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.4rem',
            }}
          >
            {isSubmitting ? (
              <>
                <span
                  style={{
                    display: 'inline-block',
                    width: '1rem',
                    height: '1rem',
                    border: '2px solid #ffffff',
                    borderTopColor: 'transparent',
                    borderRadius: '50%',
                    animation: 'spin 0.8s linear infinite',
                  }}
                />
                Processing...
              </>
            ) : (
              'Confirm & Execute'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

