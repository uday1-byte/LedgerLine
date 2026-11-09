import React from 'react';
import { Link } from 'react-router-dom';
import { formatPaiseToINR } from '../../utils/currency';

export function TransactionReceipt({ receipt, onReset }) {
  if (!receipt) return null;

  const {
    message,
    transfer,
    updatedBalances,
    account,
    isReplayed,
  } = receipt;

  const formattedAmount = transfer?.amountPaise
    ? formatPaiseToINR(transfer.amountPaise)
    : '₹0.00';

  return (
    <div
      role="region"
      aria-label="Transaction Receipt"
      data-testid="transaction-receipt"
      style={{
        backgroundColor: '#ffffff',
        borderRadius: '0.75rem',
        border: '1px solid #e2e8f0',
        padding: '2rem',
        maxWidth: '600px',
        margin: '1.5rem auto',
        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)',
      }}
    >
      {/* Top Icon & Status */}
      <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
        <div style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '3.5rem',
          height: '3.5rem',
          borderRadius: '50%',
          backgroundColor: '#dcfce7',
          color: '#15803d',
          fontSize: '1.75rem',
          marginBottom: '0.75rem',
        }}>
          ✓
        </div>
        <h2 style={{ fontSize: '1.5rem', fontWeight: '800', color: '#0f172a', margin: 0 }}>
          {message || 'Transaction Completed Successfully'}
        </h2>
        {isReplayed && (
          <div
            data-testid="replay-badge"
            style={{
              display: 'inline-block',
              marginTop: '0.5rem',
              backgroundColor: '#fef3c7',
              color: '#92400e',
              border: '1px solid #fde68a',
              borderRadius: '9999px',
              padding: '0.2rem 0.75rem',
              fontSize: '0.75rem',
              fontWeight: '700',
            }}
          >
            ↻ Idempotent Replay (Previously Processed)
          </div>
        )}
      </div>

      {/* Summary Box */}
      <div style={{
        backgroundColor: '#f8fafc',
        borderRadius: '0.5rem',
        border: '1px solid #e2e8f0',
        padding: '1.25rem',
        marginBottom: '1.5rem',
      }}>
        <div style={{ textAlign: 'center', marginBottom: '1rem', borderBottom: '1px solid #e2e8f0', paddingBottom: '0.75rem' }}>
          <span style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase', fontWeight: '600' }}>
            Amount Transacted
          </span>
          <div style={{ fontSize: '2rem', fontWeight: '800', color: '#0f172a', marginTop: '0.2rem' }}>
            {formattedAmount}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '0.6rem', fontSize: '0.85rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: '#64748b' }}>Transfer ID:</span>
            <span style={{ fontWeight: '600', fontFamily: 'monospace', color: '#1e293b' }}>
              {transfer?.id}
            </span>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: '#64748b' }}>Status:</span>
            <span style={{ fontWeight: '700', color: '#15803d', textTransform: 'uppercase' }}>
              {transfer?.status || 'completed'}
            </span>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: '#64748b' }}>Timestamp:</span>
            <span style={{ fontWeight: '600', color: '#1e293b' }}>
              {transfer?.createdAt ? new Date(transfer.createdAt).toLocaleString() : 'Just now'}
            </span>
          </div>

          {/* Balance for Deposit/Withdrawal */}
          {account?.balancePaise && (
            <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #e2e8f0', paddingTop: '0.5rem' }}>
              <span style={{ color: '#64748b' }}>Updated Account Balance:</span>
              <span style={{ fontWeight: '700', color: '#0284c7' }}>
                {formatPaiseToINR(account.balancePaise)}
              </span>
            </div>
          )}

          {/* Balances for Customer-to-Customer Transfer */}
          {updatedBalances && (
            <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: '0.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                <span style={{ color: '#64748b' }}>Source Balance:</span>
                <span style={{ fontWeight: '700', color: '#0284c7' }}>
                  {formatPaiseToINR(updatedBalances.sourceBalancePaise)}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#64748b' }}>Destination Balance:</span>
                <span style={{ fontWeight: '700', color: '#0284c7' }}>
                  {formatPaiseToINR(updatedBalances.destinationBalancePaise)}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Action Buttons */}
      <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center', flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={onReset}
          data-testid="receipt-new-op-btn"
          style={{
            backgroundColor: '#0284c7',
            color: '#ffffff',
            border: 'none',
            borderRadius: '0.375rem',
            padding: '0.6rem 1.25rem',
            fontWeight: '600',
            fontSize: '0.875rem',
            cursor: 'pointer',
          }}
        >
          Execute Another Operation
        </button>
        <Link
          to="/statements"
          style={{
            backgroundColor: '#ffffff',
            color: '#475569',
            border: '1px solid #cbd5e1',
            borderRadius: '0.375rem',
            padding: '0.6rem 1.25rem',
            fontWeight: '600',
            fontSize: '0.875rem',
            textDecoration: 'none',
            display: 'inline-flex',
            alignItems: 'center',
          }}
        >
          View Statements
        </Link>
      </div>
    </div>
  );
}

