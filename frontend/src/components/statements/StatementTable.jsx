import React from 'react';
import { formatPaiseToINR } from '../../utils/currency';
import { formatDateTime } from '../../utils/date';

export function StatementTable({ entries = [] }) {
  if (!entries || entries.length === 0) {
    return (
      <div
        role="region"
        aria-label="Empty Statement"
        style={{
          backgroundColor: '#ffffff',
          borderRadius: '0.75rem',
          border: '1px solid #e2e8f0',
          padding: '3rem 1.5rem',
          textAlign: 'center',
          boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)',
        }}
      >
        <span style={{ fontSize: '2.5rem' }}>📄</span>
        <h3 style={{ fontSize: '1.15rem', fontWeight: '700', color: '#0f172a', marginTop: '0.75rem' }}>
          No Completed Ledger Entries
        </h3>
        <p style={{ color: '#64748b', fontSize: '0.9rem', marginTop: '0.25rem', maxWidth: '480px', margin: '0.25rem auto 0 auto' }}>
          There are no ledger entries matching your query parameters for this account. If you applied date filters, try expanding your date range.
        </p>
      </div>
    );
  }

  const formatTransferType = (type) => {
    switch (type) {
      case 'customer_transfer':
        return 'Customer Transfer';
      case 'deposit':
        return 'Cash Deposit';
      case 'withdrawal':
        return 'Cash Withdrawal';
      case 'reversal':
        return 'Transfer Reversal';
      default:
        return type || 'Transfer';
    }
  };

  return (
    <div
      role="region"
      aria-label="Completed Ledger Entries"
      className="statement-container"
      style={{
        backgroundColor: '#ffffff',
        borderRadius: '0.75rem',
        border: '1px solid #e2e8f0',
        overflow: 'hidden',
        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)',
        marginBottom: '1.5rem',
      }}
    >
      <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ fontSize: '1.1rem', fontWeight: '700', color: '#0f172a', margin: 0 }}>
          Ledger Transactions ({entries.length})
        </h3>
        <span style={{ fontSize: '0.8rem', color: '#64748b' }}>
          Dual-Regime Total Ordering (Legacy Chronological &rarr; Sequenced Total Order)
        </span>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table
          data-testid="statement-table"
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            textAlign: 'left',
            fontSize: '0.875rem',
          }}
        >
          <thead>
            <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              <th style={{ padding: '0.75rem 1rem' }}>Date & Time</th>
              <th style={{ padding: '0.75rem 1rem' }}>Regime & Sequence</th>
              <th style={{ padding: '0.75rem 1rem' }}>Transfer Reference</th>
              <th style={{ padding: '0.75rem 1rem' }}>Initiated By</th>
              <th style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>Amount (INR)</th>
              <th style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>Balance After</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry, idx) => {
              const isDebit = entry.entryType === 'debit';
              const isLegacy = entry.accountEntrySequence == null || entry.regime === 'legacy_unsequenced';
              const formattedAmt = formatPaiseToINR(entry.amountPaise);
              const formattedBalanceAfter = formatPaiseToINR(entry.balanceAfterPaise);

              return (
                <tr
                  key={entry.id || idx}
                  data-testid="statement-row"
                  style={{
                    borderBottom: '1px solid #f1f5f9',
                    backgroundColor: idx % 2 === 0 ? '#ffffff' : '#fafafa',
                  }}
                >
                  {/* 1. Date & Time */}
                  <td style={{ padding: '0.85rem 1rem', whiteSpace: 'nowrap', color: '#334155' }}>
                    <div style={{ fontWeight: '600' }}>{formatDateTime(entry.createdAt)}</div>
                  </td>

                  {/* 2. Regime & Sequence */}
                  <td style={{ padding: '0.85rem 1rem', whiteSpace: 'nowrap' }}>
                    {isLegacy ? (
                      <div>
                        <span
                          data-testid="legacy-badge"
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.25rem',
                            fontSize: '0.725rem',
                            fontWeight: '700',
                            backgroundColor: '#fef3c7',
                            color: '#92400e',
                            border: '1px solid #fde68a',
                            borderRadius: '0.25rem',
                            padding: '0.15rem 0.45rem',
                          }}
                        >
                          ⚠️ Legacy (Unsequenced)
                        </span>
                        <div
                          style={{
                            fontSize: '0.7rem',
                            color: '#b45309',
                            marginTop: '0.2rem',
                            maxWidth: '220px',
                            lineHeight: '1.2',
                          }}
                        >
                          Legacy Phase 1–5 entry. Ordered by creation timestamp; sequence order is not authoritative.
                        </div>
                      </div>
                    ) : (
                      <span
                        data-testid="sequenced-badge"
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.25rem',
                          fontSize: '0.75rem',
                          fontWeight: '700',
                          fontFamily: 'monospace',
                          backgroundColor: '#e0f2fe',
                          color: '#0369a1',
                          border: '1px solid #bae6fd',
                          borderRadius: '0.25rem',
                          padding: '0.15rem 0.45rem',
                        }}
                      >
                        Seq #{entry.accountEntrySequence}
                      </span>
                    )}
                  </td>

                  {/* 3. Transfer Reference & Type */}
                  <td style={{ padding: '0.85rem 1rem' }}>
                    <div style={{ fontWeight: '600', color: '#0f172a' }}>
                      {formatTransferType(entry.transferType)}
                    </div>
                    <div style={{ fontFamily: 'monospace', fontSize: '0.75rem', color: '#64748b', marginTop: '0.15rem' }}>
                      {entry.transferId ? `${entry.transferId.slice(0, 8)}...${entry.transferId.slice(-4)}` : 'N/A'}
                    </div>
                  </td>

                  {/* 4. Initiated By */}
                  <td style={{ padding: '0.85rem 1rem', color: '#475569' }}>
                    {entry.initiatedBy?.username || (
                      <span style={{ color: '#94a3b8', fontStyle: 'italic' }}>System / Automated</span>
                    )}
                  </td>

                  {/* 5. Amount (Debit / Credit) */}
                  <td style={{ padding: '0.85rem 1rem', textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <div
                      data-testid="entry-amount"
                      style={{
                        fontWeight: '700',
                        fontSize: '0.95rem',
                        color: isDebit ? '#dc2626' : '#16a34a',
                      }}
                    >
                      {isDebit ? `- ${formattedAmt}` : `+ ${formattedAmt}`}
                    </div>
                    <span
                      style={{
                        display: 'inline-block',
                        fontSize: '0.675rem',
                        fontWeight: '700',
                        textTransform: 'uppercase',
                        padding: '0.1rem 0.35rem',
                        borderRadius: '0.2rem',
                        marginTop: '0.2rem',
                        backgroundColor: isDebit ? '#fef2f2' : '#f0fdf4',
                        color: isDebit ? '#991b1b' : '#166534',
                        border: isDebit ? '1px solid #fecaca' : '1px solid #bbf7d0',
                      }}
                    >
                      {isDebit ? 'Debit (Outflow)' : 'Credit (Inflow)'}
                    </span>
                  </td>

                  {/* 6. Running Balance After */}
                  <td style={{ padding: '0.85rem 1rem', textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <div
                      data-testid="entry-balance-after"
                      style={{
                        fontWeight: '700',
                        fontFamily: 'monospace',
                        fontSize: '0.95rem',
                        color: '#0f172a',
                      }}
                    >
                      {formattedBalanceAfter}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

