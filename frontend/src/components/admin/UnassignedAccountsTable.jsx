import React from 'react';
import { formatPaiseToINR } from '../../utils/currency';
import { formatDateTime } from '../../utils/date';

export function UnassignedAccountsTable({
  accounts = [],
  onInitiateAssign,
}) {
  const unassignedCustomerAccounts = accounts.filter(
    (a) => a.account_type === 'customer' && !a.user_id
  );

  return (
    <div
      role="region"
      aria-label="Unassigned Customer Accounts"
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
            Unassigned Customer Accounts ({unassignedCustomerAccounts.length})
          </h3>
          <p style={{ color: '#64748b', fontSize: '0.8rem', margin: '0.2rem 0 0 0' }}>
            Newly provisioned customer accounts requiring user ownership assignment. Ownership is immutable once assigned.
          </p>
        </div>
      </div>

      {unassignedCustomerAccounts.length === 0 ? (
        <div style={{ padding: '2.5rem 1.5rem', textAlign: 'center', color: '#64748b' }}>
          <span style={{ fontSize: '2rem' }}>✅</span>
          <p style={{ fontSize: '0.9rem', marginTop: '0.5rem', fontWeight: '600', color: '#1e293b' }}>
            No Unassigned Accounts
          </p>
          <p style={{ fontSize: '0.825rem', marginTop: '0.2rem' }}>
            All customer accounts in the ledger have been assigned to active user owners.
          </p>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table
            data-testid="unassigned-accounts-table"
            style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.875rem' }}
          >
            <thead>
              <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                <th style={{ padding: '0.75rem 1rem' }}>Account Number</th>
                <th style={{ padding: '0.75rem 1rem' }}>Account ID</th>
                <th style={{ padding: '0.75rem 1rem' }}>Current Balance</th>
                <th style={{ padding: '0.75rem 1rem' }}>Provisioned Date</th>
                <th style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {unassignedCustomerAccounts.map((acc, idx) => (
                <tr
                  key={acc.id}
                  data-testid="unassigned-account-row"
                  style={{ borderBottom: '1px solid #f1f5f9', backgroundColor: idx % 2 === 0 ? '#ffffff' : '#fafafa' }}
                >
                  <td style={{ padding: '0.85rem 1rem', fontFamily: 'monospace', fontWeight: '700', color: '#0f172a' }}>
                    {acc.account_number}
                  </td>
                  <td style={{ padding: '0.85rem 1rem', fontFamily: 'monospace', fontSize: '0.75rem', color: '#64748b' }}>
                    {acc.id}
                  </td>
                  <td style={{ padding: '0.85rem 1rem', fontWeight: '600', color: '#334155' }}>
                    {formatPaiseToINR(acc.balance_paise)}
                  </td>
                  <td style={{ padding: '0.85rem 1rem', color: '#64748b', fontSize: '0.8rem' }}>
                    {formatDateTime(acc.created_at)}
                  </td>
                  <td style={{ padding: '0.85rem 1rem', textAlign: 'right' }}>
                    <button
                      type="button"
                      data-testid={`btn-assign-${acc.id}`}
                      onClick={() => onInitiateAssign(acc)}
                      style={{
                        padding: '0.4rem 0.85rem',
                        backgroundColor: '#0284c7',
                        color: '#ffffff',
                        border: 'none',
                        borderRadius: '0.375rem',
                        fontSize: '0.8rem',
                        fontWeight: '600',
                        cursor: 'pointer',
                      }}
                    >
                      Assign Owner &rarr;
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

