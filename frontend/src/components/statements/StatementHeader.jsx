import React from 'react';
import { formatPaiseToINR } from '../../utils/currency';
import { formatDateTime } from '../../utils/date';

export function StatementHeader({
  account,
  dateRangeDescription,
  onPrint,
}) {
  if (!account) return null;

  const isCustomer = account.accountType === 'customer';
  const isClearing = account.accountType === 'system_clearing';
  const isEquity = account.accountType === 'system_equity';

  const typeConfig = {
    customer: { label: 'Customer Account', color: '#0369a1', bg: '#e0f2fe', border: '#bae6fd' },
    system_clearing: { label: 'Cash Clearing (System)', color: '#92400e', bg: '#fef3c7', border: '#fde68a' },
    system_equity: { label: 'System Equity', color: '#6b21a8', bg: '#f3e8ff', border: '#d8b4fe' },
  }[account.accountType] || { label: account.accountType || 'Account', color: '#475569', bg: '#f1f5f9', border: '#cbd5e1' };

  const hasCutover = account.phase6CutoverBalancePaise != null;

  return (
    <div
      role="region"
      aria-label="Account Statement Header"
      className="statement-container"
      style={{
        backgroundColor: '#ffffff',
        borderRadius: '0.75rem',
        border: '1px solid #e2e8f0',
        padding: '1.75rem',
        marginBottom: '1.5rem',
        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)',
      }}
    >
      {/* Neutral Print Header */}
      <div className="print-only" style={{ marginBottom: '1.25rem', borderBottom: '2px solid #0f172a', paddingBottom: '0.75rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: '800', color: '#0f172a', margin: 0 }}>
          LedgerLine Account Statement
        </h1>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: '#475569', marginTop: '0.35rem' }}>
          <span>Generated: {formatDateTime(new Date())}</span>
          <span>Period: {dateRangeDescription || 'All Time'}</span>
        </div>
      </div>

      {/* Screen Header Content */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.8rem', color: '#64748b', textTransform: 'uppercase', fontWeight: '700', letterSpacing: '0.05em' }}>
              Account Number
            </span>
            <span
              style={{
                fontSize: '0.75rem',
                fontWeight: '700',
                padding: '0.15rem 0.5rem',
                borderRadius: '9999px',
                backgroundColor: typeConfig.bg,
                color: typeConfig.color,
                border: `1px solid ${typeConfig.border}`,
              }}
            >
              {typeConfig.label}
            </span>
          </div>

          <h2
            data-testid="statement-account-number"
            style={{
              fontFamily: 'monospace',
              fontSize: '1.6rem',
              fontWeight: '800',
              color: '#0f172a',
              marginTop: '0.25rem',
              letterSpacing: '-0.02em',
            }}
          >
            {account.accountNumber}
          </h2>
        </div>

        {/* Action Controls (Screen Only) */}
        <div className="no-print" style={{ display: 'flex', gap: '0.75rem' }}>
          <button
            type="button"
            onClick={onPrint || (() => window.print())}
            data-testid="print-statement-btn"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.4rem',
              backgroundColor: '#ffffff',
              border: '1px solid #cbd5e1',
              padding: '0.5rem 0.9rem',
              borderRadius: '0.375rem',
              fontSize: '0.85rem',
              fontWeight: '600',
              color: '#334155',
              cursor: 'pointer',
              transition: 'background-color 0.15s ease',
            }}
          >
            <span>🖨️</span> Print Statement
          </button>
        </div>
      </div>

      {/* Balance & Metadata Grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '1rem',
          marginTop: '1.25rem',
          paddingTop: '1.25rem',
          borderTop: '1px solid #f1f5f9',
        }}
      >
        {/* Current Balance */}
        <div style={{ padding: '0.75rem 1rem', backgroundColor: '#f8fafc', borderRadius: '0.5rem', border: '1px solid #e2e8f0' }}>
          <span style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase', fontWeight: '700' }}>
            Current Balance
          </span>
          <div
            data-testid="statement-current-balance"
            style={{
              fontSize: '1.35rem',
              fontWeight: '800',
              color: '#0f172a',
              marginTop: '0.2rem',
            }}
          >
            {formatPaiseToINR(account.currentBalancePaise)}
          </div>
        </div>

        {/* Phase 6 Cutover Baseline (when available) */}
        {hasCutover && (
          <div
            data-testid="cutover-metadata-card"
            style={{
              padding: '0.75rem 1rem',
              backgroundColor: '#f0fdf4',
              borderRadius: '0.5rem',
              border: '1px solid #bbf7d0',
            }}
          >
            <span style={{ fontSize: '0.75rem', color: '#166534', textTransform: 'uppercase', fontWeight: '700' }}>
              Phase 6 Cutover Baseline
            </span>
            <div style={{ fontSize: '1.15rem', fontWeight: '700', color: '#15803d', marginTop: '0.2rem' }}>
              {formatPaiseToINR(account.phase6CutoverBalancePaise)}
            </div>
            {account.phase6CutoverCapturedAt && (
              <span style={{ fontSize: '0.75rem', color: '#166534', display: 'block', marginTop: '0.15rem' }}>
                Captured: {formatDateTime(account.phase6CutoverCapturedAt)}
              </span>
            )}
          </div>
        )}

        {/* Next Sequence Indicator */}
        <div style={{ padding: '0.75rem 1rem', backgroundColor: '#f8fafc', borderRadius: '0.5rem', border: '1px solid #e2e8f0' }}>
          <span style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase', fontWeight: '700' }}>
            Next Sequence Index
          </span>
          <div
            data-testid="statement-next-sequence"
            style={{
              fontFamily: 'monospace',
              fontSize: '1.15rem',
              fontWeight: '700',
              color: '#334155',
              marginTop: '0.2rem',
            }}
          >
            {account.nextEntrySequence != null ? `#${account.nextEntrySequence}` : 'None'}
          </div>
          <span style={{ fontSize: '0.725rem', color: '#64748b', display: 'block', marginTop: '0.15rem' }}>
            Strict monotonically increasing sequence
          </span>
        </div>
      </div>
    </div>
  );
}

