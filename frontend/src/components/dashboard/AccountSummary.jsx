import React from 'react';
import { formatPaiseToINR } from '../../utils/currency';

export function AccountSummary({ accounts = [], role, user }) {
  // Requirement 4: Strictly calculate Total Customer Balance using BigInt and customer accounts only
  const customerAccounts = accounts.filter((a) => a.account_type === 'customer');
  const clearingAccounts = accounts.filter((a) => a.account_type === 'system_clearing');
  const equityAccounts = accounts.filter((a) => a.account_type === 'system_equity');
  const unassignedCustomerAccounts = customerAccounts.filter((a) => !a.user_id);

  // BigInt calculation with zero floating point
  const totalCustomerPaise = customerAccounts.reduce((acc, curr) => {
    try {
      return acc + BigInt(curr.balance_paise || '0');
    } catch (_) {
      return acc;
    }
  }, 0n);

  const formattedTotalCustomerBalance = formatPaiseToINR(totalCustomerPaise);

  return (
    <div style={{ marginBottom: '2rem' }}>
      {/* Auditor Read-Only Banner */}
      {role === 'auditor' && (
        <div
          data-testid="auditor-banner"
          style={{
            backgroundColor: '#fffbeb',
            border: '1px solid #fef3c7',
            borderLeft: '4px solid #d97706',
            borderRadius: '0.5rem',
            padding: '1rem 1.25rem',
            marginBottom: '1.5rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
          }}
        >
          <span style={{ fontSize: '1.5rem' }}>🛡️</span>
          <div>
            <h3 style={{ fontSize: '0.95rem', fontWeight: '700', color: '#92400e', margin: 0 }}>
              Auditor Mode — Strictly Read-Only Inspection
            </h3>
            <p style={{ fontSize: '0.85rem', color: '#b45309', margin: '0.2rem 0 0 0' }}>
              You are inspecting the financial core under compliance oversight. Financial mutations and account modifications are disabled.
            </p>
          </div>
        </div>
      )}

      {/* Admin Management Overview Banner */}
      {role === 'admin' && (
        <div
          data-testid="admin-banner"
          style={{
            backgroundColor: '#faf5ff',
            border: '1px solid #e9d5ff',
            borderLeft: '4px solid #9333ea',
            borderRadius: '0.5rem',
            padding: '1rem 1.25rem',
            marginBottom: '1.5rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
          }}
        >
          <span style={{ fontSize: '1.5rem' }}>⚙️</span>
          <div>
            <h3 style={{ fontSize: '0.95rem', fontWeight: '700', color: '#6b21a8', margin: 0 }}>
              Administrative Overview — System-Wide Ledger Accounts
            </h3>
            <p style={{ fontSize: '0.85rem', color: '#7e22ce', margin: '0.2rem 0 0 0' }}>
              Viewing all customer, unassigned, and system accounts. Ownership assignment can be managed via the Admin Portal.
            </p>
          </div>
        </div>
      )}

      {/* Summary KPI Cards Grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        gap: '1rem',
      }}>
        {/* Card 1: Account Count */}
        <div style={{
          backgroundColor: '#ffffff',
          borderRadius: '0.75rem',
          padding: '1.25rem',
          border: '1px solid #e2e8f0',
          boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
        }}>
          <span style={{ fontSize: '0.75rem', fontWeight: '600', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {role === 'account_holder' ? 'Your Accounts' : 'Total Accounts'}
          </span>
          <div data-testid="summary-account-count" style={{ fontSize: '1.75rem', fontWeight: '800', color: '#0f172a', marginTop: '0.35rem' }}>
            {accounts.length}
          </div>
          <span style={{ fontSize: '0.8rem', color: '#64748b' }}>
            {customerAccounts.length} customer {customerAccounts.length === 1 ? 'account' : 'accounts'}
          </span>
        </div>

        {/* Card 2: Total Customer Balance (strictly customer accounts via BigInt) */}
        <div style={{
          backgroundColor: '#ffffff',
          borderRadius: '0.75rem',
          padding: '1.25rem',
          border: '1px solid #e2e8f0',
          boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
        }}>
          <span style={{ fontSize: '0.75rem', fontWeight: '600', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {role === 'account_holder' ? 'Total Combined Balance' : 'Total Customer Deposits'}
          </span>
          <div data-testid="summary-customer-balance" style={{ fontSize: '1.75rem', fontWeight: '800', color: '#0284c7', marginTop: '0.35rem', wordBreak: 'break-all' }}>
            {formattedTotalCustomerBalance}
          </div>
          <span style={{ fontSize: '0.8rem', color: '#64748b' }}>
            Customer balances only (excludes system clearing & equity)
          </span>
        </div>

        {/* Card 3: Unassigned Accounts (for Admin/Auditor) or Client Status (for Account Holder) */}
        {role !== 'account_holder' ? (
          <div style={{
            backgroundColor: '#ffffff',
            borderRadius: '0.75rem',
            padding: '1.25rem',
            border: '1px solid #e2e8f0',
            boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
          }}>
            <span style={{ fontSize: '0.75rem', fontWeight: '600', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Unassigned Accounts
            </span>
            <div data-testid="summary-unassigned-count" style={{
              fontSize: '1.75rem',
              fontWeight: '800',
              color: unassignedCustomerAccounts.length > 0 ? '#d97706' : '#16a34a',
              marginTop: '0.35rem',
            }}>
              {unassignedCustomerAccounts.length}
            </div>
            <span style={{ fontSize: '0.8rem', color: '#64748b' }}>
              {unassignedCustomerAccounts.length > 0 ? 'Requires owner assignment' : 'All accounts assigned'}
            </span>
          </div>
        ) : (
          <div style={{
            backgroundColor: '#ffffff',
            borderRadius: '0.75rem',
            padding: '1.25rem',
            border: '1px solid #e2e8f0',
            boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
          }}>
            <span style={{ fontSize: '0.75rem', fontWeight: '600', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Account Holder Status
            </span>
            <div style={{ fontSize: '1.25rem', fontWeight: '700', color: '#16a34a', marginTop: '0.6rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <span>✓</span> Active & In Good Standing
            </div>
            <span style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '0.35rem', display: 'block' }}>
              Profile: {user?.username} ({user?.email})
            </span>
          </div>
        )}

        {/* Card 4: System Accounts count (Admin / Auditor only) */}
        {role !== 'account_holder' && (
          <div style={{
            backgroundColor: '#ffffff',
            borderRadius: '0.75rem',
            padding: '1.25rem',
            border: '1px solid #e2e8f0',
            boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
          }}>
            <span style={{ fontSize: '0.75rem', fontWeight: '600', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              System Accounts
            </span>
            <div data-testid="summary-system-count" style={{ fontSize: '1.75rem', fontWeight: '800', color: '#475569', marginTop: '0.35rem' }}>
              {clearingAccounts.length + equityAccounts.length}
            </div>
            <span style={{ fontSize: '0.8rem', color: '#64748b' }}>
              {clearingAccounts.length} clearing, {equityAccounts.length} equity
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

