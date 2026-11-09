import React from 'react';
import { Link } from 'react-router-dom';

export function EmptyAccountState({ role, filterType = 'all' }) {
  if (role === 'account_holder') {
    return (
      <div
        data-testid="empty-account-state"
        style={{
          backgroundColor: '#ffffff',
          borderRadius: '0.75rem',
          border: '1px dashed #cbd5e1',
          padding: '3rem 2rem',
          textAlign: 'center',
          maxWidth: '560px',
          margin: '2rem auto',
        }}
      >
        <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🏦</div>
        <h3 style={{ fontSize: '1.25rem', fontWeight: '700', color: '#0f172a', marginBottom: '0.5rem' }}>
          No Accounts Assigned Yet
        </h3>
        <p style={{ color: '#64748b', fontSize: '0.925rem', lineHeight: '1.5', marginBottom: '1.5rem' }}>
          Your profile is active, but you do not currently have any bank accounts assigned to you. Bank accounts are provisioned and assigned by a banking administrator.
        </p>
        <div style={{
          backgroundColor: '#f8fafc',
          padding: '0.85rem 1rem',
          borderRadius: '0.5rem',
          border: '1px solid #e2e8f0',
          fontSize: '0.85rem',
          color: '#475569',
        }}>
          <strong>Next Step:</strong> Contact your banking administrator to link your customer account. Once linked, your account details and live balance will automatically appear here.
        </div>
      </div>
    );
  }

  // Admin and Auditor perspectives
  return (
    <div
      data-testid="empty-account-state"
      style={{
        backgroundColor: '#ffffff',
        borderRadius: '0.75rem',
        border: '1px dashed #cbd5e1',
        padding: '3rem 2rem',
        textAlign: 'center',
        maxWidth: '560px',
        margin: '2rem auto',
      }}
    >
      <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>🔍</div>
      <h3 style={{ fontSize: '1.25rem', fontWeight: '700', color: '#0f172a', marginBottom: '0.5rem' }}>
        No Accounts Found
      </h3>
      <p style={{ color: '#64748b', fontSize: '0.925rem', lineHeight: '1.5', marginBottom: '1.5rem' }}>
        {filterType !== 'all'
          ? `There are no accounts matching the '${filterType.replace('_', ' ')}' filter.`
          : 'There are currently no accounts in the ledger system.'}
      </p>

      {role === 'admin' && (
        <Link
          to="/admin"
          style={{
            display: 'inline-block',
            backgroundColor: '#0284c7',
            color: '#ffffff',
            padding: '0.55rem 1.25rem',
            borderRadius: '0.375rem',
            textDecoration: 'none',
            fontWeight: '600',
            fontSize: '0.875rem',
          }}
        >
          Go to Admin Portal to Create Account
        </Link>
      )}
    </div>
  );
}

