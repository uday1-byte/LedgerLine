import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { api, ApiError } from '../api/client';
import { TransferForm } from '../components/transfers/TransferForm';
import { DepositForm } from '../components/transfers/DepositForm';
import { WithdrawForm } from '../components/transfers/WithdrawForm';
import { ConfirmationModal } from '../components/transfers/ConfirmationModal';
import { TransactionReceipt } from '../components/transfers/TransactionReceipt';
import { PendingOperationBanner } from '../components/transfers/PendingOperationBanner';
import { Alert } from '../components/common/Alert';

const PENDING_STORAGE_KEY = 'ledgerline_pending_mutation';

function createIdempotencyKey(type) {
  const prefix = {
    transfer: 'TRF',
    deposit: 'DEP',
    withdraw: 'WDR',
  }[type] || 'FIN';

  const randomPart = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;

  return `${prefix}-${randomPart}`;
}

export function TransfersPage() {
  const { user, role } = useAuth();

  // Navigation tab: 'transfer' | 'deposit' | 'withdraw'
  const [activeTab, setActiveTab] = useState('transfer');

  // Accounts state (strictly customer accounts)
  const [accounts, setAccounts] = useState([]);
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [accountsError, setAccountsError] = useState(null);

  // Active form operation key (generated fresh for new operations)
  const [currentKey, setCurrentKey] = useState(() => createIdempotencyKey('transfer'));

  // Pre-submission review modal state
  const [reviewDetails, setReviewDetails] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Definitive success receipt
  const [receipt, setReceipt] = useState(null);

  // Definitive business error
  const [businessError, setBusinessError] = useState(null);

  // Uncertain / Ambiguous pending operation state (restored from sessionStorage if present)
  const [pendingOperation, setPendingOperation] = useState(() => {
    try {
      const stored = sessionStorage.getItem(PENDING_STORAGE_KEY);
      if (stored) {
        return JSON.parse(stored);
      }
    } catch (_) {}
    return null;
  });

  const [isRetryingPending, setIsRetryingPending] = useState(false);

  // Fetch available accounts
  const fetchAccounts = useCallback(async () => {
    setLoadingAccounts(true);
    setAccountsError(null);
    try {
      const res = await api.get('/api/accounts');
      if (res && Array.isArray(res.accounts)) {
        // Strictly filter to customer accounts only — system accounts are NEVER selectable
        const customerOnly = res.accounts.filter((a) => a.account_type === 'customer');
        setAccounts(customerOnly);
      } else {
        setAccounts([]);
      }
    } catch (err) {
      setAccountsError(err.message || 'Unable to fetch eligible customer accounts');
    } finally {
      setLoadingAccounts(false);
    }
  }, []);

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  // Synchronize pending operation to sessionStorage
  useEffect(() => {
    if (pendingOperation) {
      try {
        sessionStorage.setItem(PENDING_STORAGE_KEY, JSON.stringify(pendingOperation));
      } catch (_) {}
    } else {
      try {
        sessionStorage.removeItem(PENDING_STORAGE_KEY);
      } catch (_) {}
    }
  }, [pendingOperation]);

  // When switching tabs normally, generate a new fresh idempotency key
  const handleTabChange = (tab) => {
    if (pendingOperation || isSubmitting) return; // Prevent switching while operation is unresolved
    setActiveTab(tab);
    setBusinessError(null);
    setReceipt(null);
    setCurrentKey(createIdempotencyKey(tab));
  };

  // Called by child forms when user clicks "Review ..."
  const handleInitiateReview = (operationPayload) => {
    setBusinessError(null);
    setReviewDetails({
      ...operationPayload,
      idempotencyKey: currentKey,
    });
  };

  // Dispatches a financial mutation
  const executeMutation = async (operation) => {
    const { endpoint, payload, idempotencyKey } = operation;

    setIsSubmitting(true);
    setBusinessError(null);

    // Save pre-flight pending record into sessionStorage
    const pendingRecord = {
      ...operation,
      status: 'in_flight',
      timestamp: new Date().toISOString(),
    };
    try {
      sessionStorage.setItem(PENDING_STORAGE_KEY, JSON.stringify(pendingRecord));
    } catch (_) {}

    try {
      // Execute request with response headers enabled
      const result = await api.post(endpoint, payload, {
        headers: {
          'Idempotency-Key': idempotencyKey,
        },
        withResponseHeaders: true,
      });

      // === Case 1: Definitive Success (HTTP 201) ===
      // Clear persistence and unresolved state
      setPendingOperation(null);
      try {
        sessionStorage.removeItem(PENDING_STORAGE_KEY);
      } catch (_) {}

      setReviewDetails(null);
      setReceipt({
        ...result.data,
        isReplayed: result.isReplayed,
      });

      // Refetch accounts to reflect updated balances immediately
      fetchAccounts();

      // Generate next fresh key for subsequent operations
      setCurrentKey(createIdempotencyKey(activeTab));
    } catch (err) {
      // Analyze error classification: Definitive Business Error vs Ambiguous Network Outcome
      const isDefinitiveError = (
        err.status === 400 ||
        err.status === 401 ||
        err.status === 403 ||
        err.status === 404 ||
        err.status === 422 ||
        (err.status === 409 && err.data?.error === 'IdempotencyConflictError')
      );

      if (isDefinitiveError) {
        // === Case 2: Definitive Business Error ===
        // The backend rejected the transaction and executed ROLLBACK.
        // It is safe to clear pending persistence and allow re-editing with a fresh key.
        setPendingOperation(null);
        try {
          sessionStorage.removeItem(PENDING_STORAGE_KEY);
        } catch (_) {}

        setReviewDetails(null);

        let errorMsg = err.message;
        if (err.status === 422 && err.data?.currentBalancePaise && err.data?.attemptedAmountPaise) {
          errorMsg = `${err.message}. Current balance is insufficient for this transaction.`;
        } else if (err.status === 409 && err.data?.error === 'IdempotencyConflictError') {
          errorMsg = 'Idempotency Conflict: This reference key was previously used with different parameters. Please start a new operation.';
        }

        setBusinessError(errorMsg);
        // Generate new key since previous key was rejected or conflicted
        setCurrentKey(createIdempotencyKey(activeTab));
      } else {
        // === Case 3: Ambiguous Network Failure or ConcurrentRequestError ===
        // The transaction outcome is UNRESOLVED.
        // Preserve exact key and exact payload in sessionStorage. Lock form.
        const uncertainRecord = {
          ...operation,
          status: 'uncertain_network_failure',
          errorType: err.data?.error || (err.status === 0 ? 'NetworkError' : `HttpError${err.status}`),
          timestamp: new Date().toISOString(),
        };

        setPendingOperation(uncertainRecord);
        try {
          sessionStorage.setItem(PENDING_STORAGE_KEY, JSON.stringify(uncertainRecord));
        } catch (_) {}

        setReviewDetails(null);
      }
    } finally {
      setIsSubmitting(false);
      setIsRetryingPending(false);
    }
  };

  // User confirms in review modal
  const handleConfirmReview = () => {
    if (!reviewDetails) return;
    executeMutation(reviewDetails);
  };

  // User clicks "Retry Operation (Same Key)" on the pending banner
  const handleRetryPendingOperation = () => {
    if (!pendingOperation || isRetryingPending) return;
    setIsRetryingPending(true);
    executeMutation(pendingOperation);
  };

  // User completes or resets receipt
  const handleResetReceipt = () => {
    setReceipt(null);
    setBusinessError(null);
    setCurrentKey(createIdempotencyKey(activeTab));
  };

  // If user is auditor: render read-only notice
  if (role === 'auditor') {
    return (
      <div style={{ maxWidth: '800px', margin: '3rem auto', padding: '0 1.5rem' }}>
        <div style={{
          backgroundColor: '#fffbeb',
          border: '1px solid #fef3c7',
          borderLeft: '4px solid #d97706',
          borderRadius: '0.75rem',
          padding: '2rem',
          textAlign: 'center',
        }}>
          <span style={{ fontSize: '2.5rem' }}>🛡️</span>
          <h2 style={{ fontSize: '1.25rem', fontWeight: '800', color: '#92400e', marginTop: '0.5rem' }}>
            Auditor Mode: Read-Only Oversight
          </h2>
          <p style={{ color: '#b45309', fontSize: '0.95rem', marginTop: '0.5rem', lineHeight: '1.5' }}>
            Auditors are restricted to inspection mode. Financial mutations (customer transfers, cash deposits, and withdrawals)
            cannot be initiated by auditor profiles under regulatory compliance standards.
          </p>
        </div>
      </div>
    );
  }

  const isFormLocked = Boolean(pendingOperation) || isSubmitting;

  return (
    <div style={{ maxWidth: '960px', margin: '2rem auto', padding: '0 1.5rem' }}>
      {/* Page Header */}
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.75rem', fontWeight: '800', color: '#0f172a', margin: 0, letterSpacing: '-0.02em' }}>
          Transfers & Cash Operations
        </h1>
        <p style={{ color: '#64748b', fontSize: '0.95rem', margin: '0.25rem 0 0 0' }}>
          Execute double-entry ledger transfers, cash deposits, and cash withdrawals with atomic idempotency protection.
        </p>
      </div>

      {/* Ambiguous Pending Operation Banner (Locks form if uncertain outcome occurs) */}
      {pendingOperation && (
        <PendingOperationBanner
          pendingOperation={pendingOperation}
          onRetry={handleRetryPendingOperation}
          isRetrying={isRetryingPending}
        />
      )}

      {/* Definitive Business Error Alert */}
      {businessError && !pendingOperation && (
        <div style={{ marginBottom: '1.5rem' }}>
          <Alert type="error" message={businessError} onClose={() => setBusinessError(null)} />
        </div>
      )}

      {/* Accounts Loading Error */}
      {accountsError && (
        <div style={{ marginBottom: '1.5rem' }}>
          <Alert type="error" message={accountsError} />
        </div>
      )}

      {/* Successful Transaction Receipt */}
      {receipt ? (
        <TransactionReceipt receipt={receipt} onReset={handleResetReceipt} />
      ) : (
        <div style={{
          backgroundColor: '#ffffff',
          borderRadius: '0.75rem',
          border: '1px solid #e2e8f0',
          boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)',
          overflow: 'hidden',
        }}>
          {/* Operation Navigation Tabs */}
          <div style={{
            display: 'flex',
            borderBottom: '1px solid #e2e8f0',
            backgroundColor: '#f8fafc',
            flexWrap: 'wrap',
          }}>
            {[
              { id: 'transfer', label: '⇄ Customer Transfer', desc: 'Transfer between customer accounts' },
              { id: 'deposit', label: '↓ Cash Deposit', desc: 'Deposit funds via system clearing' },
              { id: 'withdraw', label: '↑ Cash Withdrawal', desc: 'Withdraw funds via system clearing' },
            ].map((tab) => {
              const isSelected = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => handleTabChange(tab.id)}
                  disabled={isFormLocked}
                  data-testid={`tab-${tab.id}`}
                  style={{
                    flex: 1,
                    minWidth: '180px',
                    padding: '1rem',
                    border: 'none',
                    borderBottom: isSelected ? '3px solid #0284c7' : '3px solid transparent',
                    backgroundColor: isSelected ? '#ffffff' : 'transparent',
                    color: isSelected ? '#0284c7' : '#64748b',
                    fontWeight: isSelected ? '700' : '600',
                    fontSize: '0.9rem',
                    cursor: isFormLocked ? 'not-allowed' : 'pointer',
                    opacity: isFormLocked ? 0.6 : 1,
                    transition: 'all 0.15s ease',
                    textAlign: 'center',
                  }}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          {/* Form Content Area */}
          <div style={{ padding: '2rem 1.5rem' }}>
            {loadingAccounts ? (
              <div style={{ textAlign: 'center', padding: '2rem' }}>
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
                <p style={{ color: '#64748b', fontSize: '0.9rem' }}>Loading eligible accounts...</p>
              </div>
            ) : accounts.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '2rem' }}>
                <span style={{ fontSize: '2rem' }}>🏦</span>
                <h3 style={{ fontSize: '1.1rem', fontWeight: '700', color: '#0f172a', marginTop: '0.5rem' }}>
                  No Customer Accounts Available
                </h3>
                <p style={{ color: '#64748b', fontSize: '0.875rem', marginTop: '0.25rem' }}>
                  {role === 'account_holder'
                    ? 'You do not have any active customer accounts to perform financial operations. Contact an administrator to link an account.'
                    : 'There are no customer accounts provisioned in the ledger.'}
                </p>
              </div>
            ) : (
              <>
                {/* Active Tab Form */}
                {activeTab === 'transfer' && (
                  <TransferForm
                    accounts={accounts}
                    currentUserRole={role}
                    currentUserId={user?.id}
                    onInitiateReview={handleInitiateReview}
                    disabled={isFormLocked}
                  />
                )}

                {activeTab === 'deposit' && (
                  <DepositForm
                    accounts={accounts}
                    currentUserRole={role}
                    onInitiateReview={handleInitiateReview}
                    disabled={isFormLocked}
                  />
                )}

                {activeTab === 'withdraw' && (
                  <WithdrawForm
                    accounts={accounts}
                    currentUserRole={role}
                    onInitiateReview={handleInitiateReview}
                    disabled={isFormLocked}
                  />
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Confirmation Modal */}
      <ConfirmationModal
        isOpen={Boolean(reviewDetails)}
        operationDetails={reviewDetails}
        onConfirm={handleConfirmReview}
        onCancel={() => setReviewDetails(null)}
        isSubmitting={isSubmitting}
      />
    </div>
  );
}

