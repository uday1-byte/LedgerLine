import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';
import { AuditorOverviewCard } from '../components/auditor/AuditorOverviewCard';
import { AuditorAccountsTable } from '../components/auditor/AuditorAccountsTable';
import { Alert } from '../components/common/Alert';

export function AuditorPortalPage() {
  const { user, role } = useAuth();

  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchAccounts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get('/api/accounts');
      if (res && Array.isArray(res.accounts)) {
        setAccounts(res.accounts);
      } else {
        setAccounts([]);
      }
    } catch (err) {
      setError(err.message || 'Failed to fetch accounts for compliance audit');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  return (
    <div style={{ maxWidth: '1100px', margin: '2rem auto', padding: '0 1.5rem' }}>
      {/* Page Header */}
      <div style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <span style={{ fontSize: '1.75rem' }}>🛡️</span>
          <div>
            <h1 style={{ fontSize: '1.75rem', fontWeight: '800', color: '#0f172a', margin: 0, letterSpacing: '-0.02em' }}>
              Auditor Compliance Portal
            </h1>
            <p style={{ color: '#64748b', fontSize: '0.95rem', margin: '0.25rem 0 0 0' }}>
              Read-only regulatory oversight, double-entry counter-account verification, and refused transaction audit trails.
            </p>
          </div>
        </div>
      </div>

      {/* Read-Only Mode Banner */}
      <div
        data-testid="auditor-oversight-banner"
        style={{
          backgroundColor: '#fffbeb',
          border: '1px solid #fef3c7',
          borderLeft: '4px solid #d97706',
          borderRadius: '0.5rem',
          padding: '0.85rem 1rem',
          marginBottom: '1.5rem',
          fontSize: '0.85rem',
          color: '#92400e',
          lineHeight: '1.4',
        }}
      >
        <strong>Compliance Oversight Mode:</strong> You are signed in with an Auditor profile. Financial mutations, account provisioning, user role allocation, and status modifications are strictly prohibited and disabled across this portal.
      </div>

      {/* Error Alert */}
      {error && (
        <div style={{ marginBottom: '1.5rem' }}>
          <Alert type="error" message={error} />
        </div>
      )}

      {/* Loading Spinner */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '3rem' }}>
          <span
            style={{
              display: 'inline-block',
              width: '2rem',
              height: '2rem',
              border: '3px solid #e2e8f0',
              borderTopColor: '#0284c7',
              borderRadius: '50%',
              animation: 'spin 0.8s linear infinite',
              marginBottom: '0.5rem',
            }}
          />
          <p style={{ color: '#64748b', fontSize: '0.9rem' }}>Loading compliance ledger data...</p>
        </div>
      ) : (
        <>
          {/* Summary Overview Card */}
          <AuditorOverviewCard accounts={accounts} />

          {/* Accounts Table with Refusal Statement Links */}
          <AuditorAccountsTable accounts={accounts} />
        </>
      )}
    </div>
  );
}
