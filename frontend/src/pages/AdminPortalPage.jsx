import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';
import { CreateAccountModal } from '../components/admin/CreateAccountModal';
import { AssignOwnerModal } from '../components/admin/AssignOwnerModal';
import { UserGovernanceForm } from '../components/admin/UserGovernanceForm';
import { UnassignedAccountsTable } from '../components/admin/UnassignedAccountsTable';
import { Alert } from '../components/common/Alert';
import { formatPaiseToINR } from '../utils/currency';
import { formatDateTime } from '../utils/date';

export function AdminPortalPage() {
  const { user, role } = useAuth();

  const [activeTab, setActiveTab] = useState('accounts'); // 'accounts' | 'users'
  const [accounts, setAccounts] = useState([]);
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [accountsError, setAccountsError] = useState(null);
  const [successBanner, setSuccessBanner] = useState(null);

  // Modals state
  const [createAccountModalOpen, setCreateAccountModalOpen] = useState(false);
  const [assigningAccount, setAssigningAccount] = useState(null);

  const fetchAccounts = useCallback(async () => {
    setLoadingAccounts(true);
    setAccountsError(null);
    try {
      const res = await api.get('/api/accounts');
      if (res && Array.isArray(res.accounts)) {
        setAccounts(res.accounts);
      } else {
        setAccounts([]);
      }
    } catch (err) {
      setAccountsError(err.message || 'Failed to fetch accounts list');
    } finally {
      setLoadingAccounts(false);
    }
  }, []);

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  const handleCreateSuccess = (newAccount) => {
    setSuccessBanner(`Customer account ${newAccount.account_number} created successfully.`);
    fetchAccounts();
  };

  const handleAssignSuccess = (updatedAccount) => {
    setSuccessBanner(`Account ${updatedAccount.account_number} assigned to user ${updatedAccount.user_id} successfully.`);
    fetchAccounts();
  };

  return (
    <div style={{ maxWidth: '1100px', margin: '2rem auto', padding: '0 1.5rem' }}>
      {/* Page Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.5rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ fontSize: '1.5rem' }}>⚙️</span>
            <h1 style={{ fontSize: '1.75rem', fontWeight: '800', color: '#0f172a', margin: 0, letterSpacing: '-0.02em' }}>
              Administrative Portal
            </h1>
          </div>
          <p style={{ color: '#64748b', fontSize: '0.95rem', margin: '0.25rem 0 0 0' }}>
            Account provisioning, ownership assignment, role allocation, and status management.
          </p>
        </div>

        <div>
          <button
            type="button"
            data-testid="btn-open-create-account-modal"
            onClick={() => setCreateAccountModalOpen(true)}
            style={{
              padding: '0.6rem 1.15rem',
              backgroundColor: '#0284c7',
              color: '#ffffff',
              border: 'none',
              borderRadius: '0.375rem',
              fontSize: '0.875rem',
              fontWeight: '600',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.35rem',
            }}
          >
            <span>+</span> Provision Customer Account
          </button>
        </div>
      </div>

      {/* Global Success / Error Banners */}
      {successBanner && (
        <div style={{ marginBottom: '1.5rem' }}>
          <Alert type="success" message={successBanner} onClose={() => setSuccessBanner(null)} />
        </div>
      )}
      {accountsError && (
        <div style={{ marginBottom: '1.5rem' }}>
          <Alert type="error" message={accountsError} />
        </div>
      )}

      {/* Navigation Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid #e2e8f0', marginBottom: '1.5rem', backgroundColor: '#f8fafc', borderRadius: '0.5rem 0.5rem 0 0' }}>
        <button
          type="button"
          data-testid="admin-tab-accounts"
          onClick={() => setActiveTab('accounts')}
          style={{
            padding: '0.85rem 1.25rem',
            border: 'none',
            borderBottom: activeTab === 'accounts' ? '3px solid #0284c7' : '3px solid transparent',
            backgroundColor: activeTab === 'accounts' ? '#ffffff' : 'transparent',
            color: activeTab === 'accounts' ? '#0284c7' : '#64748b',
            fontWeight: activeTab === 'accounts' ? '700' : '600',
            fontSize: '0.9rem',
            cursor: 'pointer',
          }}
        >
          🏦 Account Provisioning & Ownership
        </button>
        <button
          type="button"
          data-testid="admin-tab-users"
          onClick={() => setActiveTab('users')}
          style={{
            padding: '0.85rem 1.25rem',
            border: 'none',
            borderBottom: activeTab === 'users' ? '3px solid #0284c7' : '3px solid transparent',
            backgroundColor: activeTab === 'users' ? '#ffffff' : 'transparent',
            color: activeTab === 'users' ? '#0284c7' : '#64748b',
            fontWeight: activeTab === 'users' ? '700' : '600',
            fontSize: '0.9rem',
            cursor: 'pointer',
          }}
        >
          👥 User Governance (Role & Status)
        </button>
      </div>

      {/* Tab 1: Accounts & Ownership */}
      {activeTab === 'accounts' && (
        <>
          {/* Unassigned Triage Table */}
          <UnassignedAccountsTable
            accounts={accounts}
            onInitiateAssign={(acc) => setAssigningAccount(acc)}
          />

          {/* All Accounts Registry */}
          <div
            role="region"
            aria-label="All Accounts Registry"
            style={{
              backgroundColor: '#ffffff',
              borderRadius: '0.75rem',
              border: '1px solid #e2e8f0',
              overflow: 'hidden',
              boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)',
            }}
          >
            <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid #e2e8f0' }}>
              <h3 style={{ fontSize: '1.1rem', fontWeight: '700', color: '#0f172a', margin: 0 }}>
                Ledger Account Registry ({accounts.length})
              </h3>
              <p style={{ color: '#64748b', fontSize: '0.8rem', margin: '0.2rem 0 0 0' }}>
                Full account roster including customer, system clearing, and equity accounts.
              </p>
            </div>

            {loadingAccounts ? (
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
                <p style={{ color: '#64748b', fontSize: '0.9rem' }}>Loading accounts registry...</p>
              </div>
            ) : accounts.length === 0 ? (
              <div style={{ padding: '2.5rem', textAlign: 'center', color: '#64748b' }}>
                No accounts found in ledger.
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }}>
                  <thead>
                    <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      <th style={{ padding: '0.75rem 1rem' }}>Account Number</th>
                      <th style={{ padding: '0.75rem 1rem' }}>Account Type</th>
                      <th style={{ padding: '0.75rem 1rem' }}>Ownership Status</th>
                      <th style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>Current Balance</th>
                      <th style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {accounts.map((acc, idx) => {
                      const isCustomer = acc.account_type === 'customer';
                      const isAssigned = Boolean(acc.user_id);

                      return (
                        <tr
                          key={acc.id}
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
                                backgroundColor: isCustomer ? '#e0f2fe' : acc.account_type === 'system_clearing' ? '#fef3c7' : '#f3e8ff',
                                color: isCustomer ? '#0369a1' : acc.account_type === 'system_clearing' ? '#92400e' : '#6b21a8',
                              }}
                            >
                              {acc.account_type.replace('_', ' ')}
                            </span>
                          </td>
                          <td style={{ padding: '0.85rem 1rem', color: '#475569' }}>
                            {isAssigned ? (
                              <span style={{ color: '#166534', fontWeight: '600', fontSize: '0.8rem' }}>
                                Assigned ({acc.user_id.slice(0, 8)}...)
                              </span>
                            ) : isCustomer ? (
                              <span style={{ color: '#b45309', fontWeight: '600', fontSize: '0.8rem' }}>
                                Unassigned
                              </span>
                            ) : (
                              <span style={{ color: '#64748b', fontSize: '0.8rem' }}>
                                System Controlled
                              </span>
                            )}
                          </td>
                          <td style={{ padding: '0.85rem 1rem', textAlign: 'right', fontWeight: '700', color: '#0f172a' }}>
                            {formatPaiseToINR(acc.balance_paise)}
                          </td>
                          <td style={{ padding: '0.85rem 1rem', textAlign: 'right', whiteSpace: 'nowrap' }}>
                            <div style={{ display: 'inline-flex', gap: '0.5rem', alignItems: 'center' }}>
                              {isCustomer && !isAssigned && (
                                <button
                                  type="button"
                                  onClick={() => setAssigningAccount(acc)}
                                  style={{
                                    padding: '0.3rem 0.65rem',
                                    backgroundColor: '#0284c7',
                                    color: '#ffffff',
                                    border: 'none',
                                    borderRadius: '0.25rem',
                                    fontSize: '0.75rem',
                                    fontWeight: '600',
                                    cursor: 'pointer',
                                  }}
                                >
                                  Assign
                                </button>
                              )}
                              <Link
                                to={`/statements?accountId=${acc.id}`}
                                style={{
                                  color: '#0284c7',
                                  textDecoration: 'none',
                                  fontWeight: '600',
                                  fontSize: '0.8rem',
                                }}
                              >
                                Statement &rarr;
                              </Link>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* Tab 2: User Governance */}
      {activeTab === 'users' && (
        <UserGovernanceForm currentAdminUserId={user?.id} />
      )}

      {/* Modals */}
      <CreateAccountModal
        isOpen={createAccountModalOpen}
        onClose={() => setCreateAccountModalOpen(false)}
        onSuccess={handleCreateSuccess}
      />

      <AssignOwnerModal
        isOpen={Boolean(assigningAccount)}
        account={assigningAccount}
        onClose={() => setAssigningAccount(null)}
        onSuccess={handleAssignSuccess}
      />
    </div>
  );
}

