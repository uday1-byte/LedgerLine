import React from 'react';
import { Link } from 'react-router-dom';

export function PendingOperationBanner({
  pendingOperation,
  onRetry,
  isRetrying,
}) {
  if (!pendingOperation) return null;

  const isConcurrent = pendingOperation.errorType === 'ConcurrentRequestError';

  return (
    <div
      role="alert"
      data-testid="pending-operation-banner"
      style={{
        backgroundColor: '#fffbeb',
        border: '1px solid #fef3c7',
        borderLeft: '5px solid #d97706',
        borderRadius: '0.5rem',
        padding: '1.25rem',
        marginBottom: '1.5rem',
        boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
        <span style={{ fontSize: '1.5rem', lineHeight: '1' }}>⚠️</span>
        <div style={{ flex: 1 }}>
          <h3 style={{ fontSize: '1rem', fontWeight: '700', color: '#92400e', margin: 0 }}>
            {isConcurrent
              ? 'Transaction In Progress — Outcome Unresolved'
              : 'Uncertain Transaction Outcome — Action Required'}
          </h3>

          <p style={{ fontSize: '0.875rem', color: '#b45309', margin: '0.4rem 0 0.75rem 0', lineHeight: '1.5' }}>
            {isConcurrent ? (
              <>
                A previous request with reference{' '}
                <code style={{ fontFamily: 'monospace', fontWeight: '700', backgroundColor: '#fef3c7', padding: '0.1rem 0.3rem', borderRadius: '0.25rem' }}>
                  {pendingOperation.idempotencyKey}
                </code>{' '}
                is currently being processed by the backend. The outcome remains unresolved. To prevent duplicate charges,
                you may safely retry this exact request after a brief moment using the exact same reference.
              </>
            ) : (
              <>
                The network connection was interrupted before a definitive confirmation was received for reference{' '}
                <code style={{ fontFamily: 'monospace', fontWeight: '700', backgroundColor: '#fef3c7', padding: '0.1rem 0.3rem', borderRadius: '0.25rem' }}>
                  {pendingOperation.idempotencyKey}
                </code>
                . The server may or may not have committed this ledger transaction.
              </>
            )}
          </p>

          <div style={{
            backgroundColor: '#ffffff',
            border: '1px solid #fde68a',
            borderRadius: '0.375rem',
            padding: '0.75rem',
            marginBottom: '0.85rem',
            fontSize: '0.825rem',
            color: '#78350f',
          }}>
            <strong>Pending Transaction Details:</strong>
            <div style={{ marginTop: '0.25rem', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
              <span>Type: <strong>{pendingOperation.operationType}</strong></span>
              <span>Amount: <strong>{pendingOperation.displayAmountINR}</strong></span>
              <span>Timestamp: <strong>{new Date(pendingOperation.timestamp).toLocaleTimeString()}</strong></span>
            </div>
            <div style={{ marginTop: '0.4rem', fontSize: '0.775rem', color: '#92400e' }}>
              ℹ️ <em>Important: Checking your account statement does not prove non-commitment. Fields remain locked until a definitive server response resolves this operation.</em>
            </div>
          </div>

          {/* Action Buttons */}
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={onRetry}
              disabled={isRetrying}
              data-testid="retry-same-key-btn"
              style={{
                backgroundColor: '#d97706',
                color: '#ffffff',
                border: 'none',
                borderRadius: '0.375rem',
                padding: '0.5rem 1rem',
                fontSize: '0.85rem',
                fontWeight: '700',
                cursor: isRetrying ? 'not-allowed' : 'pointer',
                opacity: isRetrying ? 0.7 : 1,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.4rem',
              }}
            >
              {isRetrying ? (
                <>
                  <span
                    style={{
                      display: 'inline-block',
                      width: '0.85rem',
                      height: '0.85rem',
                      border: '2px solid #ffffff',
                      borderTopColor: 'transparent',
                      borderRadius: '50%',
                      animation: 'spin 0.8s linear infinite',
                    }}
                  />
                  Re-verifying with Server...
                </>
              ) : (
                'Retry Operation (Same Key)'
              )}
            </button>

            <Link
              to="/statements"
              style={{
                fontSize: '0.85rem',
                color: '#92400e',
                textDecoration: 'underline',
                fontWeight: '600',
              }}
            >
              Inspect Account Statement
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

