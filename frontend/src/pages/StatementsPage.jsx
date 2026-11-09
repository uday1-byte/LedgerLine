import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api, ApiError } from '../api/client';
import { StatementHeader } from '../components/statements/StatementHeader';
import { StatementFilterBar } from '../components/statements/StatementFilterBar';
import { StatementTable } from '../components/statements/StatementTable';
import { RefusedAttemptsTable } from '../components/statements/RefusedAttemptsTable';
import { StatementPagination } from '../components/statements/StatementPagination';
import { Alert } from '../components/common/Alert';
import { buildStatementDateRange } from '../utils/date';

export function StatementsPage() {
  const { user, role } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  // URL Query Parameters
  const paramAccountId = searchParams.get('accountId') || '';
  const paramFromDate = searchParams.get('fromDate') || '';
  const paramToDate = searchParams.get('toDate') || '';
  const paramTimezoneMode = searchParams.get('tz') || 'UTC';
  const paramIncludeRefused = searchParams.get('includeRefused') === 'true';
  const paramLimit = parseInt(searchParams.get('limit') || '50', 10);
  const paramOffset = parseInt(searchParams.get('offset') || '0', 10);

  // Accounts List State
  const [accounts, setAccounts] = useState([]);
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [accountsError, setAccountsError] = useState(null);

  // Statement Data State
  const [statementData, setStatementData] = useState(null);
  const [loadingStatement, setLoadingStatement] = useState(false);
  const [statementError, setStatementError] = useState(null);

  // 1. Fetch available accounts on mount
  useEffect(() => {
    let isMounted = true;
    const fetchAccounts = async () => {
      setLoadingAccounts(true);
      setAccountsError(null);
      try {
        const res = await api.get('/api/accounts');
        if (isMounted) {
          if (res && Array.isArray(res.accounts)) {
            setAccounts(res.accounts);

            // If no accountId in URL, auto-select the first available customer account
            if (!paramAccountId) {
              const firstCustomer = res.accounts.find((a) => a.account_type === 'customer');
              if (firstCustomer) {
                setSearchParams((prev) => {
                  const updated = new URLSearchParams(prev);
                  updated.set('accountId', firstCustomer.id);
                  return updated;
                }, { replace: true });
              }
            }
          } else {
            setAccounts([]);
          }
        }
      } catch (err) {
        if (isMounted) {
          setAccountsError(err.message || 'Unable to load accounts');
        }
      } finally {
        if (isMounted) {
          setLoadingAccounts(false);
        }
      }
    };

    fetchAccounts();
    return () => {
      isMounted = false;
    };
  }, []); // Run once on mount

  // 2. Fetch statement whenever relevant query params change
  const fetchStatement = useCallback(async () => {
    if (!paramAccountId) {
      setStatementData(null);
      return;
    }

    setLoadingStatement(true);
    setStatementError(null);

    // Build ISO timestamps using explicit timezone interpretation
    const range = buildStatementDateRange(paramFromDate, paramToDate, paramTimezoneMode);
    if (range.error) {
      setStatementError(range.error);
      setLoadingStatement(false);
      return;
    }

    // Build query string
    const queryParts = [];
    if (paramIncludeRefused) {
      queryParts.push('include_refused=true');
    }
    if (range.fromIso) {
      queryParts.push(`from_date=${encodeURIComponent(range.fromIso)}`);
    }
    if (range.toIso) {
      queryParts.push(`to_date=${encodeURIComponent(range.toIso)}`);
    }
    queryParts.push(`limit=${paramLimit}`);
    queryParts.push(`offset=${paramOffset}`);

    const queryString = queryParts.length > 0 ? `?${queryParts.join('&')}` : '';

    try {
      const data = await api.get(`/api/accounts/${paramAccountId}/statement${queryString}`);
      setStatementData(data);
    } catch (err) {
      let msg = err.message || 'Failed to fetch statement';
      if (err.status === 403) {
        msg = 'Access Denied: You do not have authorization to view the statement for this account.';
      } else if (err.status === 404) {
        msg = 'Account Not Found: The specified account does not exist in the ledger.';
      }
      setStatementError(msg);
      setStatementData(null);
    } finally {
      setLoadingStatement(false);
    }
  }, [
    paramAccountId,
    paramFromDate,
    paramToDate,
    paramTimezoneMode,
    paramIncludeRefused,
    paramLimit,
    paramOffset,
  ]);

  useEffect(() => {
    fetchStatement();
  }, [fetchStatement]);

  // Handle filter changes from StatementFilterBar
  const handleApplyFilters = (newFilters) => {
    setSearchParams((prev) => {
      const nextParams = new URLSearchParams(prev);
      nextParams.set('accountId', newFilters.accountId);

      if (newFilters.fromDate) {
        nextParams.set('fromDate', newFilters.fromDate);
      } else {
        nextParams.delete('fromDate');
      }

      if (newFilters.toDate) {
        nextParams.set('toDate', newFilters.toDate);
      } else {
        nextParams.delete('toDate');
      }

      nextParams.set('tz', newFilters.timezoneMode);

      if (newFilters.includeRefused) {
        nextParams.set('includeRefused', 'true');
      } else {
        nextParams.delete('includeRefused');
      }

      nextParams.set('limit', String(newFilters.limit));
      nextParams.set('offset', '0'); // Reset to page 1

      return nextParams;
    });
  };

  const handleResetFilters = () => {
    setSearchParams((prev) => {
      const nextParams = new URLSearchParams();
      if (paramAccountId) {
        nextParams.set('accountId', paramAccountId);
      }
      nextParams.set('limit', '50');
      nextParams.set('offset', '0');
      return nextParams;
    });
  };

  const handlePageChange = (newOffset) => {
    setSearchParams((prev) => {
      const nextParams = new URLSearchParams(prev);
      nextParams.set('offset', String(newOffset));
      return nextParams;
    });
  };

  const dateRangeDescription = buildStatementDateRange(paramFromDate, paramToDate, paramTimezoneMode).boundaryDescription;

  return (
    <div style={{ maxWidth: '1100px', margin: '2rem auto', padding: '0 1.5rem' }}>
      {/* Page Heading (Screen Only) */}
      <div className="no-print" style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.75rem', fontWeight: '800', color: '#0f172a', margin: 0, letterSpacing: '-0.02em' }}>
          Account Statements & Audit Trail
        </h1>
        <p style={{ color: '#64748b', fontSize: '0.95rem', margin: '0.25rem 0 0 0' }}>
          Inspect running dual-regime ledger entries, cutover baselines, and rejected transaction attempts.
        </p>
      </div>

      {/* Account Loading Error */}
      {accountsError && (
        <div style={{ marginBottom: '1.5rem' }}>
          <Alert type="error" message={accountsError} />
        </div>
      )}

      {/* Filter Bar */}
      <StatementFilterBar
        accounts={accounts}
        selectedAccountId={paramAccountId}
        currentUserRole={role}
        fromDate={paramFromDate}
        toDate={paramToDate}
        timezoneMode={paramTimezoneMode}
        includeRefused={paramIncludeRefused}
        limit={paramLimit}
        onApplyFilters={handleApplyFilters}
        onResetFilters={handleResetFilters}
        isLoading={loadingAccounts || loadingStatement}
      />

      {/* Statement Fetch Error */}
      {statementError && (
        <div style={{ marginBottom: '1.5rem' }}>
          <Alert type="error" message={statementError} />
          <div style={{ marginTop: '0.75rem' }}>
            <button
              type="button"
              onClick={fetchStatement}
              data-testid="statement-retry-btn"
              style={{
                padding: '0.45rem 1rem',
                backgroundColor: '#ffffff',
                border: '1px solid #cbd5e1',
                borderRadius: '0.375rem',
                fontSize: '0.85rem',
                fontWeight: '600',
                color: '#334155',
                cursor: 'pointer',
              }}
            >
              Retry
            </button>
          </div>
        </div>
      )}

      {/* Loading Spinner */}
      {loadingStatement && (
        <div style={{ textAlign: 'center', padding: '3rem 1rem' }}>
          <span
            style={{
              display: 'inline-block',
              width: '2.5rem',
              height: '2.5rem',
              border: '3px solid #e2e8f0',
              borderTopColor: '#0284c7',
              borderRadius: '50%',
              animation: 'spin 0.8s linear infinite',
              marginBottom: '0.75rem',
            }}
          />
          <p style={{ color: '#64748b', fontSize: '0.95rem' }}>Loading account statement...</p>
        </div>
      )}

      {/* Statement Content */}
      {!loadingStatement && statementData && (
        <>
          {/* Statement Header Card */}
          <StatementHeader
            account={statementData.account}
            dateRangeDescription={dateRangeDescription}
          />

          {/* Statement Entries Table */}
          <StatementTable entries={statementData.statement?.entries} />

          {/* Pagination Controls */}
          {statementData.statement?.pagination && (
            <StatementPagination
              totalEntries={statementData.statement.pagination.totalEntries}
              limit={statementData.statement.pagination.limit}
              offset={statementData.statement.pagination.offset}
              note={statementData.statement.pagination.note}
              onPageChange={handlePageChange}
              isLoading={loadingStatement}
            />
          )}

          {/* Refused Attempts Section (when requested) */}
          {paramIncludeRefused && statementData.refusedAttempts && (
            <RefusedAttemptsTable
              refusedAttempts={statementData.refusedAttempts}
              notice={statementData.refusedAttemptsNotice}
            />
          )}
        </>
      )}
    </div>
  );
}

