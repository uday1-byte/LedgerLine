import React from 'react';
import { Link } from 'react-router-dom';
import { formatPaiseToINR } from '../../utils/currency';
import { formatDateTime } from '../../utils/date';

export function AuditorAccountsTable({ accounts = [] }) {
  return (
    <div
      role="region"
      aria-label="Auditor Accounts Registry"
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
        <div>
          <h3 style={{ fontSize: '1.1rem', fontWeight: '700', color: '#0f172a', margin: 0 }}>
            Audit Inspection Registry ({accounts.length})
          </h3>
          <p style={{ color: '#64748b', fontSize: '0.8rem', margin: '0.2rem 0 0 0' }}>
            Full double-entry ledger accounts viewable in strictly read-only oversight mode.
          </p>
        </div>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table
          data-testid="auditor-accounts-table"
          style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }}
        >
          <thead>
            <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              <th style={{ padding: '0.75rem 1rem' }}>Account Number</th>
              <th style={{ padding: '0.75rem 1rem' }}>Account Type</th>
              <th style={{ padding: '0.75rem 1rem' }}>Assigned Owner</th>
              <th style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>Recorded Balance</th>
              <th style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>Audit Trail Action</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((acc, idx) => {
              const isCustomer = acc.account_type === 'customer';
              const isClearing = acc.account_type === 'system_clearing';
              const isEquity = acc.account_type === 'system_equity';

              return (
                <tr
                  key={acc.id}
                  data-testid="auditor-account-row"
                  style={{ borderBottom: '1px solid #f1f5f9', backgroundColor: idx % 2 === 0 ? '#ffffff' : '#fafafa' }}
                >
                  <td style={{ padding: '0.85rem 1rem', fontFamily: 'monospace', fontWeight: '700', color: '#0f172a' }}>
                    {acc.account_number}
                  </td>
                  <td style={{ padding: '0.85rem 1rem' }}>
                    <span
                      style={{
                        display: 'inline-block',
                        fontSize: '0.725rem',
                        fontWeight: '700',
                        padding: '0.15rem 0.45rem',
                        borderRadius: '9999px',
                        textTransform: 'capitalize',
                        backgroundColor: isCustomer ? '#e0f2fe' : isClearing ? '#fef3c7' : '#f3e8ff',
                        color: isCustomer ? '#0369a1' : isClearing ? '#92400e' : '#6b21a8',
                      }}
                    >
                      {acc.account_type.replace('_', ' ')}
                    </span>
                  </td>
                  <td style={{ padding: '0.85rem 1rem', color: '#475569' }}>
                    {acc.user_id ? (
                      <span style={{ fontFamily: 'monospace', fontSize: '0.775rem' }}>
                        User ({acc.user_id.slice(0, 8)}...{acc.user_id.slice(-4)})
                      </span>
                    ) : isCustomer ? (
                      <span style={{ color: '#b45309', fontWeight: '600', fontSize: '0.8rem' }}>
                        Unassigned
                      </span>
                    ) : (
                      <span style={{ color: '#64748b', fontSize: '0.8rem' }}>
                        Internal Core System
                      </span>
                    )}
                  </td>
                  <td style={{ padding: '0.85rem 1rem', textAlign: 'right', fontWeight: '700', color: '#0f172a' }}>
                    {formatPaiseToINR(acc.balance_paise)}
                  </td>
                  <td style={{ padding: '0.85rem 1rem', textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <Link
                      to={`/statements?accountId=${acc.id}&includeRefused=true`}
                      data-testid={`link-audit-statement-${acc.id}`}
                      style={{
                        color: '#0284c7',
                        textDecoration: 'none',
                        fontWeight: '600',
                        fontSize: '0.8rem',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.25rem',
                      }}
                    >
                      Audit Statement (Inc. Refusals) &rarr;
                    </Link>
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

