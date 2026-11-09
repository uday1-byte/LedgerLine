import React, { useState, useMemo } from 'react';
import { getLocalTimeZone, getLocalTimeZoneOffset, buildStatementDateRange } from '../../utils/date';
import { Alert } from '../common/Alert';

export function StatementFilterBar({
  accounts = [],
  selectedAccountId,
  currentUserRole,
  fromDate,
  toDate,
  timezoneMode = 'UTC',
  includeRefused = false,
  limit = 50,
  onApplyFilters,
  onResetFilters,
  isLoading = false,
}) {
  // Local state for form controls before applying
  const [internalAccountId, setInternalAccountId] = useState(selectedAccountId || '');
  const [internalFromDate, setInternalFromDate] = useState(fromDate || '');
  const [internalToDate, setInternalToDate] = useState(toDate || '');
  const [internalTimezoneMode, setInternalTimezoneMode] = useState(timezoneMode);
  const [internalIncludeRefused, setInternalIncludeRefused] = useState(includeRefused);
  const [internalLimit, setInternalLimit] = useState(limit);
  const [showSystemAccounts, setShowSystemAccounts] = useState(false);
  const [filterError, setFilterError] = useState(null);

  const isPrivileged = currentUserRole === 'admin' || currentUserRole === 'auditor';

  // Customer accounts list
  const customerAccounts = useMemo(() => {
    return accounts.filter((a) => a.account_type === 'customer');
  }, [accounts]);

  // System accounts list (strictly for admin/auditor opt-in)
  const systemAccounts = useMemo(() => {
    if (!isPrivileged) return [];
    return accounts.filter((a) => a.account_type === 'system_clearing' || a.account_type === 'system_equity');
  }, [accounts, isPrivileged]);

  // Sync internalAccountId when selectedAccountId changes externally
  React.useEffect(() => {
    if (selectedAccountId) {
      setInternalAccountId(selectedAccountId);
    }
  }, [selectedAccountId]);

  // Compute live boundary preview
  const previewRange = useMemo(() => {
    return buildStatementDateRange(internalFromDate, internalToDate, internalTimezoneMode);
  }, [internalFromDate, internalToDate, internalTimezoneMode]);

  const handleSubmit = (e) => {
    e.preventDefault();
    setFilterError(null);

    if (!internalAccountId) {
      setFilterError('Please select an account to inspect statement');
      return;
    }

    const rangeResult = buildStatementDateRange(internalFromDate, internalToDate, internalTimezoneMode);
    if (rangeResult.error) {
      setFilterError(rangeResult.error);
      return;
    }

    onApplyFilters({
      accountId: internalAccountId,
      fromDate: internalFromDate,
      toDate: internalToDate,
      fromIso: rangeResult.fromIso,
      toIso: rangeResult.toIso,
      timezoneMode: internalTimezoneMode,
      includeRefused: internalIncludeRefused,
      limit: Number(internalLimit),
      offset: 0, // Reset to page 1 on new filter apply
    });
  };

  const handleReset = () => {
    setFilterError(null);
    setInternalFromDate('');
    setInternalToDate('');
    setInternalTimezoneMode('UTC');
    setInternalIncludeRefused(false);
    setInternalLimit(50);

    onResetFilters();
  };

  const localTzName = getLocalTimeZone();
  const localTzOffset = getLocalTimeZoneOffset();

  return (
    <div
      role="search"
      aria-label="Statement Filters"
      className="no-print"
      style={{
        backgroundColor: '#ffffff',
        borderRadius: '0.75rem',
        border: '1px solid #e2e8f0',
        padding: '1.5rem',
        marginBottom: '1.5rem',
        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)',
      }}
    >
      <form onSubmit={handleSubmit}>
        {filterError && (
          <div style={{ marginBottom: '1rem' }}>
            <Alert type="error" message={filterError} />
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem', alignItems: 'flex-end' }}>
          {/* 1. Account Selection */}
          <div style={{ gridColumn: 'span 2' }}>
            <label
              htmlFor="filter-account"
              style={{ display: 'block', fontSize: '0.85rem', fontWeight: '700', color: '#1e293b', marginBottom: '0.35rem' }}
            >
              Select Account <span style={{ color: '#dc2626' }}>*</span>
            </label>
            <select
              id="filter-account"
              data-testid="statement-account-select"
              value={internalAccountId}
              onChange={(e) => setInternalAccountId(e.target.value)}
              disabled={isLoading || accounts.length === 0}
              style={{
                width: '100%',
                padding: '0.6rem 0.75rem',
                borderRadius: '0.375rem',
                border: '1px solid #cbd5e1',
                backgroundColor: '#ffffff',
                fontSize: '0.9rem',
                outline: 'none',
              }}
            >
              <option value="">-- Choose Account --</option>
              {customerAccounts.map((acc) => (
                <option key={acc.id} value={acc.id}>
                  {acc.account_number} (Customer Account)
                </option>
              ))}

              {/* Opt-in System Accounts Group (Admin & Auditor only) */}
              {isPrivileged && showSystemAccounts && systemAccounts.length > 0 && (
                <optgroup label="System Ledger Accounts (Clearing & Equity)">
                  {systemAccounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.account_number} ({acc.account_type === 'system_clearing' ? 'Cash Clearing' : 'System Equity'})
                    </option>
                  ))}
                </optgroup>
              )}
            </select>

            {/* Privileged Opt-in Toggle */}
            {isPrivileged && systemAccounts.length > 0 && (
              <label
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  marginTop: '0.4rem',
                  fontSize: '0.8rem',
                  color: '#475569',
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  data-testid="toggle-system-accounts"
                  checked={showSystemAccounts}
                  onChange={(e) => setShowSystemAccounts(e.target.checked)}
                />
                <span>Include System Accounts in list (Cash Clearing & Equity)</span>
              </label>
            )}
          </div>

          {/* 2. From Date */}
          <div>
            <label
              htmlFor="filter-from-date"
              style={{ display: 'block', fontSize: '0.85rem', fontWeight: '700', color: '#1e293b', marginBottom: '0.35rem' }}
            >
              Start Date
            </label>
            <input
              type="date"
              id="filter-from-date"
              data-testid="filter-from-date"
              value={internalFromDate}
              onChange={(e) => setInternalFromDate(e.target.value)}
              disabled={isLoading}
              style={{
                width: '100%',
                padding: '0.55rem 0.75rem',
                borderRadius: '0.375rem',
                border: '1px solid #cbd5e1',
                fontSize: '0.9rem',
                outline: 'none',
              }}
            />
          </div>

          {/* 3. To Date */}
          <div>
            <label
              htmlFor="filter-to-date"
              style={{ display: 'block', fontSize: '0.85rem', fontWeight: '700', color: '#1e293b', marginBottom: '0.35rem' }}
            >
              End Date
            </label>
            <input
              type="date"
              id="filter-to-date"
              data-testid="filter-to-date"
              value={internalToDate}
              onChange={(e) => setInternalToDate(e.target.value)}
              disabled={isLoading}
              style={{
                width: '100%',
                padding: '0.55rem 0.75rem',
                borderRadius: '0.375rem',
                border: '1px solid #cbd5e1',
                fontSize: '0.9rem',
                outline: 'none',
              }}
            />
          </div>

          {/* 4. Timezone Interpretation Mode */}
          <div>
            <label
              htmlFor="filter-timezone-mode"
              style={{ display: 'block', fontSize: '0.85rem', fontWeight: '700', color: '#1e293b', marginBottom: '0.35rem' }}
            >
              Timezone Basis
            </label>
            <select
              id="filter-timezone-mode"
              data-testid="filter-timezone-mode"
              value={internalTimezoneMode}
              onChange={(e) => setInternalTimezoneMode(e.target.value)}
              disabled={isLoading}
              style={{
                width: '100%',
                padding: '0.6rem 0.75rem',
                borderRadius: '0.375rem',
                border: '1px solid #cbd5e1',
                fontSize: '0.85rem',
                outline: 'none',
              }}
            >
              <option value="UTC">UTC (Universal Coordinated Time)</option>
              <option value="LOCAL">Local ({localTzName} · {localTzOffset})</option>
            </select>
          </div>

          {/* 5. Limit (Page Size) */}
          <div>
            <label
              htmlFor="filter-limit"
              style={{ display: 'block', fontSize: '0.85rem', fontWeight: '700', color: '#1e293b', marginBottom: '0.35rem' }}
            >
              Page Size
            </label>
            <select
              id="filter-limit"
              data-testid="filter-limit"
              value={internalLimit}
              onChange={(e) => setInternalLimit(Number(e.target.value))}
              disabled={isLoading}
              style={{
                width: '100%',
                padding: '0.6rem 0.75rem',
                borderRadius: '0.375rem',
                border: '1px solid #cbd5e1',
                fontSize: '0.85rem',
                outline: 'none',
              }}
            >
              <option value={10}>10 per page</option>
              <option value={25}>25 per page</option>
              <option value={50}>50 per page</option>
              <option value={100}>100 per page</option>
            </select>
          </div>
        </div>

        {/* Audit Refusals Checkbox & Live Boundary Hint */}
        <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', fontWeight: '600', color: '#334155', cursor: 'pointer' }}>
            <input
              type="checkbox"
              data-testid="filter-include-refused"
              checked={internalIncludeRefused}
              onChange={(e) => setInternalIncludeRefused(e.target.checked)}
              disabled={isLoading}
            />
            <span>Include Refusal Audit Log (Rejected Attempts)</span>
          </label>

          {/* Filter Range Description Banner */}
          <span
            data-testid="filter-boundary-hint"
            style={{ fontSize: '0.75rem', color: '#64748b', fontStyle: 'italic' }}
          >
            {previewRange.boundaryDescription}
          </span>
        </div>

        {/* Buttons */}
        <div style={{ marginTop: '1.25rem', display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={handleReset}
            disabled={isLoading}
            data-testid="filter-reset-btn"
            style={{
              padding: '0.55rem 1.1rem',
              backgroundColor: '#ffffff',
              border: '1px solid #cbd5e1',
              borderRadius: '0.375rem',
              fontSize: '0.875rem',
              fontWeight: '600',
              color: '#475569',
              cursor: isLoading ? 'not-allowed' : 'pointer',
            }}
          >
            Reset
          </button>
          <button
            type="submit"
            disabled={isLoading || !internalAccountId}
            data-testid="filter-submit-btn"
            style={{
              padding: '0.55rem 1.25rem',
              backgroundColor: '#0284c7',
              color: '#ffffff',
              border: 'none',
              borderRadius: '0.375rem',
              fontSize: '0.875rem',
              fontWeight: '600',
              cursor: isLoading || !internalAccountId ? 'not-allowed' : 'pointer',
              opacity: isLoading || !internalAccountId ? 0.6 : 1,
            }}
          >
            {isLoading ? 'Loading...' : 'Apply Filters'}
          </button>
        </div>
      </form>
    </div>
  );
}

