import React from 'react';
import { Link } from 'react-router-dom';
import { formatPaiseToINR } from '../../utils/currency';

export function AccountCard({ account, currentUserRole, currentUserId }) {
  if (!account) return null;

  const isCustomer = account.account_type === 'customer';
  const isClearing = account.account_type === 'system_clearing';
  const isEquity = account.account_type === 'system_equity';

  const typeConfig = {
    customer: {
      label: 'Customer Account',
      badgeBg: '#e0f2fe',
      badgeColor: '#0369a1',
      badgeBorder: '#bae6fd',
    },
    system_clearing: {
      label: 'Cash Clearing',
      badgeBg: '#fef3c7',
      badgeColor: '#92400e',
      badgeBorder: '#fde68a',
    },
    system_equity: {
      label: 'System Equity',
      badgeBg: '#f3e8ff',
      badgeColor: '#6b21a8',
      badgeBorder: '#d8b4fe',
    },
  }[account.account_type] || {
    label: account.account_type || 'Unknown Type',
    badgeBg: '#f1f5f9',
    badgeColor: '#475569',
    badgeBorder: '#cbd5e1',
  };

  // Ownership indicator without exposing raw UUIDs
  let ownershipLabel = null;
  let ownershipStyle = { bg: '#f1f5f9', text: '#475569', border: '#cbd5e1' };

  if (currentUserRole === 'account_holder') {
    ownershipLabel = 'Your Account';
    ownershipStyle = { bg: '#dcfce7', text: '#15803d', border: '#bbf7d0' };
  } else {
    // Admin and Auditor perspectives
    if (account.user_id) {
      if (currentUserId && account.user_id === currentUserId) {
        ownershipLabel = 'Your Account';
        ownershipStyle = { bg: '#dcfce7', text: '#15803d', border: '#bbf7d0' };
      } else {
        ownershipLabel = 'Assigned';
        ownershipStyle = { bg: '#e0f2fe', text: '#0369a1', border: '#bae6fd' };
      }
    } else {
      if (isCustomer) {
        ownershipLabel = 'Unassigned';
        ownershipStyle = { bg: '#fef3c7', text: '#b45309', border: '#fde68a' };
      } else {
        ownershipLabel = 'System Controlled';
        ownershipStyle = { bg: '#f8fafc', text: '#64748b', border: '#e2e8f0' };
      }
    }
  }

  // Safe formatting of balance
  const formattedBalance = formatPaiseToINR(account.balance_paise);
  const isNegative = typeof account.balance_paise === 'string'
    ? account.balance_paise.startsWith('-')
    : BigInt(account.balance_paise || 0) < 0n;

  return (
    <div
      role="article"
      aria-label={`Account ${account.account_number}`}
      style={{
        backgroundColor: '#ffffff',
        borderRadius: '0.75rem',
        border: '1px solid #e2e8f0',
        padding: '1.5rem',
        boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        transition: 'transform 0.15s ease, box-shadow 0.15s ease',
      }}
    >
      <div>
        {/* Top Header: Account Number & Badges */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
          <div>
            <span style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: '600' }}>
              Account Number
            </span>
            <div style={{ fontFamily: 'monospace', fontSize: '1.15rem', fontWeight: '700', color: '#0f172a', marginTop: '0.15rem' }}>
              {account.account_number}
            </div>
          </div>

          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
            {/* Account Type Badge */}
            <span
              style={{
                fontSize: '0.75rem',
                fontWeight: '600',
                backgroundColor: typeConfig.badgeBg,
                color: typeConfig.badgeColor,
                border: `1px solid ${typeConfig.badgeBorder}`,
                padding: '0.2rem 0.55rem',
                borderRadius: '9999px',
              }}
            >
              {typeConfig.label}
            </span>

            {/* Ownership Badge */}
            {ownershipLabel && (
              <span
                style={{
                  fontSize: '0.75rem',
                  fontWeight: '600',
                  backgroundColor: ownershipStyle.bg,
                  color: ownershipStyle.text,
                  border: `1px solid ${ownershipStyle.border}`,
                  padding: '0.2rem 0.55rem',
                  borderRadius: '9999px',
                }}
              >
                {ownershipLabel}
              </span>
            )}
          </div>
        </div>

        {/* Current Balance */}
        <div style={{
          backgroundColor: '#f8fafc',
          borderRadius: '0.5rem',
          padding: '1rem',
          border: '1px solid #f1f5f9',
          marginBottom: '1rem',
        }}>
          <span style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: '600' }}>
            Current Balance
          </span>
          <div
            data-testid="account-balance"
            style={{
              fontSize: '1.75rem',
              fontWeight: '800',
              color: isNegative ? '#dc2626' : '#0f172a',
              letterSpacing: '-0.02em',
              marginTop: '0.25rem',
              wordBreak: 'break-all',
            }}
          >
            {formattedBalance}
          </div>
        </div>

        {/* Optional Cutover Metadata - only displayed if returned by API */}
        {account.phase6_cutover_balance_paise != null && (
          <div style={{
            fontSize: '0.8rem',
            color: '#475569',
            backgroundColor: '#f1f5f9',
            padding: '0.5rem 0.75rem',
            borderRadius: '0.375rem',
            marginBottom: '1rem',
            border: '1px solid #e2e8f0',
          }}>
            <span style={{ fontWeight: '600' }}>Cutover Baseline: </span>
            {formatPaiseToINR(account.phase6_cutover_balance_paise)}
            {account.phase6_cutover_captured_at && (
              <span style={{ color: '#64748b', marginLeft: '0.35rem' }}>
                ({new Date(account.phase6_cutover_captured_at).toLocaleDateString()})
              </span>
            )}
          </div>
        )}
      </div>

      {/* Footer Info & Read-Only Action */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingTop: '0.75rem',
        borderTop: '1px solid #f1f5f9',
        fontSize: '0.8rem',
        color: '#64748b',
        gap: '0.5rem',
        flexWrap: 'wrap',
      }}>
        <span>
          Created: {account.created_at ? new Date(account.created_at).toLocaleDateString() : 'N/A'}
        </span>

        <Link
          to={`/statements?accountId=${account.id}`}
          style={{
            color: '#0284c7',
            fontWeight: '600',
            textDecoration: 'none',
            fontSize: '0.825rem',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.25rem',
          }}
        >
          View Statement &rarr;
        </Link>
      </div>
    </div>
  );
}

