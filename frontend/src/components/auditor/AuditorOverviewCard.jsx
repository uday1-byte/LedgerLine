import React, { useMemo } from 'react';
import { formatPaiseToINR } from '../../utils/currency';

export function AuditorOverviewCard({ accounts = [] }) {
  // 1. Locate system accounts
  const clearingAccount = accounts.find((a) => a.account_type === 'system_clearing');
  const equityAccount = accounts.find((a) => a.account_type === 'system_equity');

  // 2. Compute customer account balance total using BigInt arithmetic
  const customerTotalPaise = useMemo(() => {
    return accounts
      .filter((a) => a.account_type === 'customer')
      .reduce((sum, acc) => {
        try {
          return sum + BigInt(acc.balance_paise || '0');
        } catch (_) {
          return sum;
        }
      }, 0n);
  }, [accounts]);

  const customerCount = accounts.filter((a) => a.account_type === 'customer').length;

  return (
    <div
      role="region"
      aria-label="Auditor Compliance Summary"
      style={{
        backgroundColor: '#ffffff',
        borderRadius: '0.75rem',
        border: '1px solid #e2e8f0',
        padding: '1.75rem',
        marginBottom: '1.5rem',
        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '1.25rem' }}>
        <span style={{ fontSize: '1.75rem' }}>⚖️</span>
        <div>
          <h2 style={{ fontSize: '1.25rem', fontWeight: '800', color: '#0f172a', margin: 0 }}>
            Regulatory & Ledger Compliance Overview
          </h2>
          <p style={{ color: '#64748b', fontSize: '0.85rem', margin: '0.15rem 0 0 0' }}>
            System invariants, counter-account balances, and total customer obligations.
          </p>
        </div>
      </div>

      {/* Grid of Exact Mandated Labels */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1rem' }}>
        {/* 1. Recorded cash-clearing balance */}
        <div style={{ padding: '1rem', backgroundColor: '#fffbeb', borderRadius: '0.5rem', border: '1px solid #fef3c7' }}>
          <span style={{ fontSize: '0.75rem', color: '#92400e', textTransform: 'uppercase', fontWeight: '700', letterSpacing: '0.04em' }}>
            Recorded cash-clearing balance
          </span>
          <div
            data-testid="clearing-balance"
            style={{ fontSize: '1.35rem', fontWeight: '800', color: '#92400e', marginTop: '0.25rem' }}
          >
            {clearingAccount ? formatPaiseToINR(clearingAccount.balance_paise) : '₹0.00'}
          </div>
          <span style={{ fontSize: '0.725rem', color: '#b45309', display: 'block', marginTop: '0.2rem' }}>
            Account ID: {clearingAccount?.id || 'SYSTEM_CASH_CLEARING'}
          </span>
        </div>

        {/* 2. Opening-balance equity */}
        <div style={{ padding: '1rem', backgroundColor: '#f3e8ff', borderRadius: '0.5rem', border: '1px solid #e9d5ff' }}>
          <span style={{ fontSize: '0.75rem', color: '#6b21a8', textTransform: 'uppercase', fontWeight: '700', letterSpacing: '0.04em' }}>
            Opening-balance equity
          </span>
          <div
            data-testid="equity-balance"
            style={{ fontSize: '1.35rem', fontWeight: '800', color: '#6b21a8', marginTop: '0.25rem' }}
          >
            {equityAccount ? formatPaiseToINR(equityAccount.balance_paise) : '₹0.00'}
          </div>
          <span style={{ fontSize: '0.725rem', color: '#7e22ce', display: 'block', marginTop: '0.2rem' }}>
            Account ID: {equityAccount?.id || 'SYSTEM_EQUITY'}
          </span>
        </div>

        {/* 3. Customer account balance total */}
        <div style={{ padding: '1rem', backgroundColor: '#f0fdf4', borderRadius: '0.5rem', border: '1px solid #bbf7d0' }}>
          <span style={{ fontSize: '0.75rem', color: '#166534', textTransform: 'uppercase', fontWeight: '700', letterSpacing: '0.04em' }}>
            Customer account balance total
          </span>
          <div
            data-testid="customer-total-balance"
            style={{ fontSize: '1.35rem', fontWeight: '800', color: '#15803d', marginTop: '0.25rem' }}
          >
            {formatPaiseToINR(customerTotalPaise)}
          </div>
          <span style={{ fontSize: '0.725rem', color: '#166534', display: 'block', marginTop: '0.2rem' }}>
            Across {customerCount} customer account{customerCount === 1 ? '' : 's'}
          </span>
        </div>
      </div>

      {/* Mandatory Accounting Counter-Account Disclaimer */}
      <div
        data-testid="clearing-disclaimer"
        style={{
          marginTop: '1.25rem',
          padding: '0.85rem 1rem',
          backgroundColor: '#f8fafc',
          borderRadius: '0.5rem',
          border: '1px solid #e2e8f0',
          borderLeft: '4px solid #0284c7',
          fontSize: '0.8rem',
          color: '#334155',
          lineHeight: '1.5',
        }}
      >
        <strong>Accounting Counter-Account Notice:</strong> The recorded cash-clearing balance is an internal double-entry clearing counter-account used to balance cash operations across the ledger. <strong>It does not prove or represent real-world physical vault cash or external bank reserves, and must not be interpreted as available liquidity.</strong>
      </div>
    </div>
  );
}

