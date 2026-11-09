import React from 'react';
import { formatPaiseToINR } from '../../utils/currency';
import { formatDateTime } from '../../utils/date';

export function RefusedAttemptsTable({
  refusedAttempts = [],
  notice,
}) {
  return (
    <div
      role="region"
      aria-label="Refused Attempts Audit Log"
      className="statement-container"
      data-testid="refused-attempts-section"
      style={{
        backgroundColor: '#fffbeb',
        borderRadius: '0.75rem',
        border: '1px solid #fef3c7',
        borderLeft: '5px solid #d97706',
        overflow: 'hidden',
        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)',
        marginBottom: '1.5rem',
      }}
    >
      {/* Header */}
      <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid #fde68a' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ fontSize: '1.25rem' }}>🛡️</span>
          <h3 style={{ fontSize: '1.1rem', fontWeight: '800', color: '#92400e', margin: 0 }}>
            Rejected Transaction Attempts (Audit Record — Non-Mutating)
          </h3>
        </div>
        <p style={{ color: '#b45309', fontSize: '0.85rem', marginTop: '0.35rem', lineHeight: '1.4' }}>
          These events represent pre-flight validation or invariant failures rejected before double-entry commitment.
          <strong> They did not modify, debit, or credit the account balance.</strong>
        </p>

        {/* Backend 404 Nonexistent Account Disclaimer */}
        {notice && (
          <div
            data-testid="refused-notice"
            style={{
              marginTop: '0.75rem',
              padding: '0.65rem 0.85rem',
              backgroundColor: '#ffffff',
              borderRadius: '0.375rem',
              border: '1px solid #fde68a',
              fontSize: '0.775rem',
              color: '#78350f',
              lineHeight: '1.4',
            }}
          >
            <strong>Compliance Note:</strong> {notice}
          </div>
        )}
      </div>

      {refusedAttempts.length === 0 ? (
        <div style={{ padding: '2rem 1.5rem', textAlign: 'center', color: '#92400e', fontSize: '0.875rem' }}>
          No refused transaction attempts recorded for this account during the selected period.
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table
            data-testid="refused-attempts-table"
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              textAlign: 'left',
              fontSize: '0.85rem',
              backgroundColor: '#ffffff',
            }}
          >
            <thead>
              <tr style={{ backgroundColor: '#fef3c7', borderBottom: '1px solid #fde68a', color: '#78350f', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                <th style={{ padding: '0.75rem 1rem' }}>Date & Time</th>
                <th style={{ padding: '0.75rem 1rem' }}>Attempted Action</th>
                <th style={{ padding: '0.75rem 1rem' }}>Refusal Code</th>
                <th style={{ padding: '0.75rem 1rem' }}>Reason & Message</th>
                <th style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>Attempted Amount</th>
                <th style={{ padding: '0.75rem 1rem' }}>Idempotency Ref</th>
                <th style={{ padding: '0.75rem 1rem' }}>Initiator</th>
              </tr>
            </thead>
            <tbody>
              {refusedAttempts.map((ref, idx) => {
                const formattedAttemptedAmt = ref.attemptedAmountPaise != null
                  ? formatPaiseToINR(ref.attemptedAmountPaise)
                  : 'N/A';

                return (
                  <tr
                    key={ref.id || idx}
                    data-testid="refused-row"
                    style={{
                      borderBottom: '1px solid #fef3c7',
                      backgroundColor: idx % 2 === 0 ? '#ffffff' : '#fffdfa',
                    }}
                  >
                    <td style={{ padding: '0.75rem 1rem', whiteSpace: 'nowrap', color: '#334155', fontWeight: '600' }}>
                      {formatDateTime(ref.createdAt)}
                    </td>
                    <td style={{ padding: '0.75rem 1rem', fontWeight: '700', textTransform: 'capitalize', color: '#b45309' }}>
                      {ref.action}
                    </td>
                    <td style={{ padding: '0.75rem 1rem' }}>
                      <span
                        style={{
                          display: 'inline-block',
                          fontFamily: 'monospace',
                          fontSize: '0.725rem',
                          fontWeight: '700',
                          backgroundColor: '#fee2e2',
                          color: '#991b1b',
                          padding: '0.15rem 0.4rem',
                          borderRadius: '0.25rem',
                          border: '1px solid #fecaca',
                        }}
                      >
                        {ref.reasonCode}
                      </span>
                    </td>
                    <td style={{ padding: '0.75rem 1rem', color: '#451a03', maxWidth: '280px' }}>
                      {ref.reasonMessage}
                    </td>
                    <td style={{ padding: '0.75rem 1rem', textAlign: 'right', fontWeight: '600', color: '#78350f', whiteSpace: 'nowrap' }}>
                      {formattedAttemptedAmt}
                      <span style={{ fontSize: '0.675rem', display: 'block', color: '#dc2626' }}>
                        (NOT DEDUCTED)
                      </span>
                    </td>
                    <td style={{ padding: '0.75rem 1rem', fontFamily: 'monospace', fontSize: '0.75rem', color: '#64748b' }}>
                      {ref.idempotencyKey ? `${ref.idempotencyKey.slice(0, 12)}...` : 'N/A'}
                    </td>
                    <td style={{ padding: '0.75rem 1rem', color: '#64748b' }}>
                      {ref.initiatedBy?.username || 'Unknown'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

