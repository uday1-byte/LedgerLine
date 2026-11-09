import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';
import { AccountCard } from '../components/dashboard/AccountCard';
import { AccountSummary } from '../components/dashboard/AccountSummary';
import { EmptyAccountState } from '../components/dashboard/EmptyAccountState';
import { Alert } from '../components/common/Alert';

export function DashboardPage() {
  const { user, role } = useAuth();
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filterType, setFilterType] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  const fetchAccounts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.get('/api/accounts');
      if (response && Array.isArray(response.accounts)) {
        setAccounts(response.accounts);
      } else {
        setAccounts([]);
      }
    } catch (err) {
      setError(err.message || 'Failed to fetch accounts from banking server');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  // Filter accounts based on selected tab and search term
  const filteredAccounts = useMemo(() => {
    return accounts.filter((account) => {
      // 1. Role / Account Type Filter
      if (filterType === 'customer' && account.account_type !== 'customer') return false;
      if (filterType === 'system_clearing' && account.account_type !== 'system_clearing') return false;
      if (filterType === 'system_equity' && account.account_type !== 'system_equity') return false;
      if (filterType === 'unassigned') {
        if (account.account_type !== 'customer' || account.user_id) return false;
      }

      // 2. Search query filter
      if (searchQuery.trim()) {
        const query = searchQuery.trim().toLowerCase();
        const accNumber = (account.account_number || '').toLowerCase();
        if (!accNumber.includes(query)) return false;
      }

      return true;
    });
  }, [accounts, filterType, searchQuery]);

  return (
    <div style={{ maxWidth: '1200px', margin: '2rem auto', padding: '0 1.5rem' }}>
      {/* Header Banner */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '1.5rem',
        flexWrap: 'wrap',
        gap: '1rem',
      }}>
        <div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: '800', color: '#0f172a', margin: 0, letterSpacing: '-0.02em' }}>
            Account Dashboard
          </h1>
          <p style={{ color: '#64748b', fontSize: '0.95rem', margin: '0.25rem 0 0 0' }}>
            {role === 'account_holder' && `Welcome back, ${user?.username || 'Customer'}. View your balances and ledger activity.`}
            {role === 'admin' && 'Administrative financial overview: manage ledger balances and account allocations.'}
            {role === 'auditor' && 'Compliance inspection overview: immutable ledger accounts and balances.'}
          </p>
        </div>

        {/* Refresh Button */}
        <button
          onClick={fetchAccounts}
          disabled={loading}
          data-testid="refresh-dashboard-btn"
          style={{
            backgroundColor: '#ffffff',
            color: '#0f172a',
            border: '1px solid #cbd5e1',
            borderRadius: '0.375rem',
            padding: '0.5rem 0.9rem',
            fontSize: '0.85rem',
            fontWeight: '600',
            cursor: loading ? 'not-allowed' : 'pointer',
            opacity: loading ? 0.6 : 1,
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.4rem',
            boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
          }}
        >
          <span>↻</span> {loading ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {/* Error State with Retry Button */}
      {error && (
        <div style={{ marginBottom: '1.5rem' }}>
          <Alert type="error" message={error} />
          <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.5rem' }}>
            <button
              onClick={fetchAccounts}
              data-testid="retry-btn"
              style={{
                backgroundColor: '#0284c7',
                color: '#ffffff',
                border: 'none',
                borderRadius: '0.375rem',
                padding: '0.5rem 1rem',
                fontSize: '0.875rem',
                fontWeight: '600',
                cursor: 'pointer',
              }}
            >
              Retry Connection
            </button>
          </div>
        </div>
      )}

      {/* Loading State: Skeleton Cards */}
      {loading && !error && (
        <div data-testid="dashboard-loading" style={{ margin: '3rem auto', textAlign: 'center' }}>
          <div style={{
            display: 'inline-block',
            width: '2.5rem',
            height: '2.5rem',
            border: '3px solid #e2e8f0',
            borderTopColor: '#0284c7',
            borderRadius: '50%',
            animation: 'spin 0.8s linear infinite',
            marginBottom: '1rem',
          }} />
          <p style={{ color: '#64748b', fontSize: '0.95rem', fontWeight: '500' }}>
            Loading account balances...
          </p>
        </div>
      )}

      {/* Main Content Area */}
      {!loading && !error && (
        <>
          {/* Summary KPI Cards */}
          <AccountSummary accounts={accounts} role={role} user={user} />

          {/* Filter Bar for Admin and Auditor */}
          {role !== 'account_holder' && accounts.length > 0 && (
            <div style={{
              backgroundColor: '#ffffff',
              borderRadius: '0.75rem',
              border: '1px solid #e2e8f0',
              padding: '0.85rem 1.25rem',
              marginBottom: '1.5rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '1rem',
              flexWrap: 'wrap',
            }}>
              {/* Filter Tabs */}
              <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                {[
                  { id: 'all', label: 'All Accounts' },
                  { id: 'customer', label: 'Customer' },
                  { id: 'unassigned', label: 'Unassigned' },
                  { id: 'system_clearing', label: 'Clearing' },
                  { id: 'system_equity', label: 'Equity' },
                ].map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setFilterType(tab.id)}
                    data-testid={`filter-tab-${tab.id}`}
                    style={{
                      border: 'none',
                      backgroundColor: filterType === tab.id ? '#0284c7' : '#f1f5f9',
                      color: filterType === tab.id ? '#ffffff' : '#475569',
                      fontWeight: '600',
                      fontSize: '0.8rem',
                      padding: '0.4rem 0.75rem',
                      borderRadius: '0.375rem',
                      cursor: 'pointer',
                      transition: 'background-color 0.15s ease',
                    }}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* Search Box */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: '220px' }}>
                <input
                  type="text"
                  placeholder="Filter by account #..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  data-testid="account-search-input"
                  style={{
                    width: '100%',
                    padding: '0.4rem 0.65rem',
                    fontSize: '0.825rem',
                    border: '1px solid #cbd5e1',
                    borderRadius: '0.375rem',
                    outline: 'none',
                  }}
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    style={{
                      border: 'none',
                      background: 'none',
                      color: '#94a3b8',
                      cursor: 'pointer',
                      fontSize: '0.8rem',
                    }}
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Empty State vs Account Cards Grid */}
          {filteredAccounts.length === 0 ? (
            <EmptyAccountState role={role} filterType={filterType} />
          ) : (
            <div
              data-testid="account-grid"
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
                gap: '1.25rem',
              }}
            >
              {filteredAccounts.map((account) => (
                <AccountCard
                  key={account.id}
                  account={account}
                  currentUserRole={role}
                  currentUserId={user?.id}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

