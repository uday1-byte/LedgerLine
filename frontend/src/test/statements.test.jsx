import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { StatementsPage } from '../pages/StatementsPage';
import { StatementHeader } from '../components/statements/StatementHeader';
import { StatementFilterBar } from '../components/statements/StatementFilterBar';
import { StatementTable } from '../components/statements/StatementTable';
import { RefusedAttemptsTable } from '../components/statements/RefusedAttemptsTable';
import { StatementPagination } from '../components/statements/StatementPagination';
import * as AuthContextModule from '../context/AuthContext';
import { api, ApiError } from '../api/client';
import { buildStatementDateRange } from '../utils/date';

describe('Statements UI - Component & Integration Test Suite', () => {
  const mockCustomerAccounts = [
    {
      id: '00000000-0000-0000-0000-000000000010',
      account_number: 'ACC-CUST-10',
      account_type: 'customer',
      balance_paise: '500000',
    },
    {
      id: '00000000-0000-0000-0000-000000000020',
      account_number: 'ACC-CUST-20',
      account_type: 'customer',
      balance_paise: '250000',
    },
  ];

  const mockSystemAccounts = [
    {
      id: '00000000-0000-0000-0000-000000000002',
      account_number: 'SYSTEM_CASH_CLEARING',
      account_type: 'system_clearing',
      balance_paise: '-100000',
    },
    {
      id: '00000000-0000-0000-0000-000000000001',
      account_number: 'SYSTEM_EQUITY',
      account_type: 'system_equity',
      balance_paise: '1000000000',
    },
  ];

  const mockStatementPayload = {
    account: {
      id: '00000000-0000-0000-0000-000000000010',
      accountNumber: 'ACC-CUST-10',
      accountType: 'customer',
      currentBalancePaise: '500000',
      phase6CutoverBalancePaise: '500000',
      phase6CutoverCapturedAt: '2026-01-01T10:00:00.000Z',
      nextEntrySequence: '3',
    },
    statement: {
      entries: [
        {
          id: 'ent-legacy-1',
          transferId: 'trf-legacy-1',
          transferType: 'deposit',
          entryType: 'credit',
          amountPaise: '100000',
          balanceAfterPaise: '100000',
          accountEntrySequence: null,
          regime: 'legacy_unsequenced',
          historicalNote: 'Legacy Phase 1-5 unsequenced entry. Ordered by transaction creation timestamp; sequence order is not authoritative.',
          createdAt: '2026-01-01T10:00:00.000Z',
          initiatedBy: { userId: 'u-1', username: 'admin' },
        },
        {
          id: 'ent-seq-1',
          transferId: 'trf-seq-1',
          transferType: 'customer_transfer',
          entryType: 'debit',
          amountPaise: '25000',
          balanceAfterPaise: '75000',
          accountEntrySequence: '1',
          regime: 'sequenced',
          createdAt: '2026-01-02T15:30:00.000Z',
          initiatedBy: { userId: 'u-2', username: 'customer_alice' },
        },
      ],
      pagination: {
        totalEntries: 2,
        limit: 50,
        offset: 0,
        note: 'Offset pagination applies over the dual-regime total ordering. In an active ledger, offset pagination across separate requests can shift if concurrent transactions append new entries.',
      },
    },
    refusedAttempts: [
      {
        id: 'ref-1',
        action: 'withdrawal',
        attemptedAmountPaise: '999999',
        reasonCode: 'INSUFFICIENT_FUNDS',
        reasonMessage: 'Requested withdrawal exceeds available balance',
        idempotencyKey: 'WDR-TEST-REF-1',
        createdAt: '2026-01-03T18:45:00.000Z',
        initiatedBy: { userId: 'u-2', username: 'customer_alice' },
      },
    ],
    refusedAttemptsNotice:
      'Includes refused attempts recorded for this account. Note: Refusals on nonexistent accounts (HTTP 404) are stored with account_id=NULL in the audit table to maintain database foreign key constraints and cannot be associated with any specific account statement.',
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('1. Date & Timezone Utilities (buildStatementDateRange)', () => {
    it('returns undefined ISO strings for empty date inputs', () => {
      const res = buildStatementDateRange('', '', 'UTC');
      expect(res.fromIso).toBeUndefined();
      expect(res.toIso).toBeUndefined();
      expect(res.error).toBeUndefined();
    });

    it('formats UTC boundary with strict start and end of day', () => {
      const res = buildStatementDateRange('2026-03-01', '2026-03-05', 'UTC');
      expect(res.fromIso).toBe('2026-03-01T00:00:00.000Z');
      expect(res.toIso).toBe('2026-03-05T23:59:59.999Z');
      expect(res.error).toBeUndefined();
    });

    it('converts local calendar midnight and end-of-day to UTC ISO timestamps without naive Z appending', () => {
      const fromDate = '2026-03-01';
      const toDate = '2026-03-05';
      const res = buildStatementDateRange(fromDate, toDate, 'LOCAL');

      // Deterministically derive expected UTC points in time from the host environment's actual timezone
      const expectedStartIso = new Date(2026, 2, 1, 0, 0, 0, 0).toISOString();
      const expectedEndIso = new Date(2026, 2, 5, 23, 59, 59, 999).toISOString();

      expect(res.fromIso).toBe(expectedStartIso);
      expect(res.toIso).toBe(expectedEndIso);
      expect(res.error).toBeUndefined();

      // Ensure both timestamps end in 'Z' as required by Zod backend validation
      expect(res.fromIso).toMatch(/Z$/);
      expect(res.toIso).toMatch(/Z$/);

      // Verify that in non-UTC timezones (e.g. IST +05:30), the converter does NOT simply append 'Z' to the local date string
      const offsetMinutes = new Date().getTimezoneOffset();
      if (offsetMinutes !== 0) {
        expect(res.fromIso).not.toBe('2026-03-01T00:00:00.000Z');
        expect(res.toIso).not.toBe('2026-03-05T23:59:59.999Z');
      }
    });

    it('verifies that boundary timestamps at 00:00:00.000 and 23:59:59.999 fall inclusively within the generated range', () => {
      const res = buildStatementDateRange('2026-04-10', '2026-04-10', 'UTC');
      const startBoundary = '2026-04-10T00:00:00.000Z';
      const endBoundary = '2026-04-10T23:59:59.999Z';
      const justBeforeStart = '2026-04-09T23:59:59.999Z';
      const justAfterEnd = '2026-04-11T00:00:00.000Z';

      expect(res.fromIso).toBe(startBoundary);
      expect(res.toIso).toBe(endBoundary);

      // Inclusivity comparison matching backend SQL: created_at >= fromIso && created_at <= toIso
      const isIncluded = (ts) => ts >= res.fromIso && ts <= res.toIso;

      expect(isIncluded(startBoundary)).toBe(true);
      expect(isIncluded(endBoundary)).toBe(true);
      expect(isIncluded(justBeforeStart)).toBe(false);
      expect(isIncluded(justAfterEnd)).toBe(false);
    });

    it('generates a descriptive boundary string reflecting the chosen timezone basis', () => {
      const utcRes = buildStatementDateRange('2026-06-01', '2026-06-01', 'UTC');
      expect(utcRes.boundaryDescription).toContain('Filtering in UTC');
      expect(utcRes.boundaryDescription).toContain('2026-06-01T00:00:00.000Z');

      const localRes = buildStatementDateRange('2026-06-01', '2026-06-01', 'LOCAL');
      expect(localRes.boundaryDescription).toMatch(/Filtering in .+: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/);
    });

    it('rejects when from_date is later than to_date', () => {
      const res = buildStatementDateRange('2026-03-10', '2026-03-01', 'UTC');
      expect(res.error).toMatch(/Start date cannot be later than end date/i);
    });

    it('rejects invalid date formats', () => {
      const res = buildStatementDateRange('invalid-date', '2026-03-05', 'UTC');
      expect(res.error).toMatch(/must be in YYYY-MM-DD format/i);
    });
  });

  describe('2. StatementHeader Component', () => {
    it('renders account details, current balance, cutover snapshot, and print header', () => {
      render(
        <StatementHeader
          account={mockStatementPayload.account}
          dateRangeDescription="Filtering in UTC: All time"
        />
      );

      expect(screen.getByTestId('statement-account-number')).toHaveTextContent('ACC-CUST-10');
      expect(screen.getByTestId('statement-current-balance')).toHaveTextContent('₹5,000.00');
      expect(screen.getByTestId('cutover-metadata-card')).toBeInTheDocument();
      expect(screen.getByTestId('cutover-metadata-card')).toHaveTextContent('₹5,000.00');
      expect(screen.getByTestId('statement-next-sequence')).toHaveTextContent('#3');
      expect(screen.getByTestId('print-statement-btn')).toBeInTheDocument();
    });

    it('cleanly hides cutover snapshot when phase6CutoverBalancePaise is null', () => {
      const noCutoverAcc = {
        ...mockStatementPayload.account,
        phase6CutoverBalancePaise: null,
      };

      render(<StatementHeader account={noCutoverAcc} />);
      expect(screen.queryByTestId('cutover-metadata-card')).not.toBeInTheDocument();
    });
  });

  describe('3. StatementTable Component', () => {
    it('renders dual-regime entries with distinct legacy vs sequenced badges', () => {
      render(<StatementTable entries={mockStatementPayload.statement.entries} />);

      const rows = screen.getAllByTestId('statement-row');
      expect(rows).toHaveLength(2);

      // Entry 1: Legacy
      expect(screen.getByTestId('legacy-badge')).toHaveTextContent('Legacy (Unsequenced)');
      expect(screen.getByText(/Legacy Phase 1–5 entry/)).toBeInTheDocument();

      // Entry 2: Sequenced
      expect(screen.getByTestId('sequenced-badge')).toHaveTextContent('Seq #1');
    });

    it('renders debit and credit styling and running balances cleanly', () => {
      render(<StatementTable entries={mockStatementPayload.statement.entries} />);

      const amounts = screen.getAllByTestId('entry-amount');
      const balances = screen.getAllByTestId('entry-balance-after');

      // Entry 1: Credit + ₹1,000.00, balance ₹1,000.00
      expect(amounts[0]).toHaveTextContent('+ ₹1,000.00');
      expect(balances[0]).toHaveTextContent('₹1,000.00');

      // Entry 2: Debit - ₹250.00, balance ₹750.00
      expect(amounts[1]).toHaveTextContent('- ₹250.00');
      expect(balances[1]).toHaveTextContent('₹750.00');
    });

    it('renders empty message when no entries are provided', () => {
      render(<StatementTable entries={[]} />);
      expect(screen.getByText('No Completed Ledger Entries')).toBeInTheDocument();
    });
  });

  describe('4. RefusedAttemptsTable Component', () => {
    it('renders refused attempts with non-mutating disclaimer and 404 notice', () => {
      render(
        <RefusedAttemptsTable
          refusedAttempts={mockStatementPayload.refusedAttempts}
          notice={mockStatementPayload.refusedAttemptsNotice}
        />
      );

      expect(screen.getByTestId('refused-attempts-section')).toBeInTheDocument();
      expect(screen.getByText(/Rejected Transaction Attempts \(Audit Record — Non-Mutating\)/)).toBeInTheDocument();
      expect(screen.getByText(/They did not modify, debit, or credit the account balance/)).toBeInTheDocument();
      expect(screen.getByTestId('refused-notice')).toHaveTextContent(mockStatementPayload.refusedAttemptsNotice);

      const rows = screen.getAllByTestId('refused-row');
      expect(rows).toHaveLength(1);
      expect(screen.getByText('INSUFFICIENT_FUNDS')).toBeInTheDocument();
      expect(screen.getByText(/₹9,999.99/)).toBeInTheDocument();
      expect(screen.getByText('(NOT DEDUCTED)')).toBeInTheDocument();
    });
  });

  describe('5. StatementFilterBar Component', () => {
    it('shows only customer accounts by default and excludes system accounts', () => {
      render(
        <StatementFilterBar
          accounts={[...mockCustomerAccounts, ...mockSystemAccounts]}
          selectedAccountId={mockCustomerAccounts[0].id}
          currentUserRole="account_holder"
          onApplyFilters={vi.fn()}
          onResetFilters={vi.fn()}
        />
      );

      const select = screen.getByTestId('statement-account-select');
      expect(select).toHaveTextContent('ACC-CUST-10');
      expect(select).toHaveTextContent('ACC-CUST-20');
      expect(select).not.toHaveTextContent('SYSTEM_CASH_CLEARING');
      expect(screen.queryByTestId('toggle-system-accounts')).not.toBeInTheDocument();
    });

    it('allows admin/auditor to opt-in to system accounts in a distinct group', async () => {
      render(
        <StatementFilterBar
          accounts={[...mockCustomerAccounts, ...mockSystemAccounts]}
          selectedAccountId={mockCustomerAccounts[0].id}
          currentUserRole="admin"
          onApplyFilters={vi.fn()}
          onResetFilters={vi.fn()}
        />
      );

      const toggle = screen.getByTestId('toggle-system-accounts');
      expect(toggle).toBeInTheDocument();

      // Before toggle: system accounts not visible
      expect(screen.getByTestId('statement-account-select')).not.toHaveTextContent('SYSTEM_CASH_CLEARING');

      // Check toggle
      fireEvent.click(toggle);

      // After toggle: system accounts visible in optgroup
      expect(screen.getByTestId('statement-account-select')).toHaveTextContent('SYSTEM_CASH_CLEARING');
    });

    it('validates client-side that start date cannot be later than end date', () => {
      const applyMock = vi.fn();
      render(
        <StatementFilterBar
          accounts={mockCustomerAccounts}
          selectedAccountId={mockCustomerAccounts[0].id}
          currentUserRole="account_holder"
          onApplyFilters={applyMock}
          onResetFilters={vi.fn()}
        />
      );

      const fromInput = screen.getByTestId('filter-from-date');
      const toInput = screen.getByTestId('filter-to-date');

      fireEvent.change(fromInput, { target: { value: '2026-03-15' } });
      fireEvent.change(toInput, { target: { value: '2026-03-01' } });

      fireEvent.click(screen.getByTestId('filter-submit-btn'));

      expect(screen.getByText('Start date cannot be later than end date')).toBeInTheDocument();
      expect(applyMock).not.toHaveBeenCalled();
    });
  });

  describe('6. StatementPagination Component', () => {
    it('renders pagination counts, previous/next buttons, and concurrency note', () => {
      const pageChangeMock = vi.fn();
      render(
        <StatementPagination
          totalEntries={120}
          limit={50}
          offset={50}
          note="Offset pagination applies over the dual-regime total ordering."
          onPageChange={pageChangeMock}
        />
      );

      expect(screen.getByTestId('pagination-info')).toHaveTextContent('Showing 51–100 of 120 entries');
      expect(screen.getByText(/(Page 2 of 3)/)).toBeInTheDocument();
      expect(screen.getByTestId('pagination-concurrency-note')).toHaveTextContent(
        'Offset pagination applies over the dual-regime total ordering.'
      );

      // Click Next
      fireEvent.click(screen.getByTestId('pagination-next-btn'));
      expect(pageChangeMock).toHaveBeenCalledWith(100);

      // Click Previous
      fireEvent.click(screen.getByTestId('pagination-prev-btn'));
      expect(pageChangeMock).toHaveBeenCalledWith(0);
    });
  });

  describe('7. StatementsPage Integration', () => {
    it('fetches and renders full statement successfully for an authorized account', async () => {
      vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
        user: { id: 'user-cust-1', username: 'alice', role: 'account_holder' },
        role: 'account_holder',
        isAuthenticated: true,
      });

      vi.spyOn(api, 'get').mockImplementation(async (url) => {
        if (url === '/api/accounts') {
          return { accounts: mockCustomerAccounts };
        }
        if (url.startsWith('/api/accounts/00000000-0000-0000-0000-000000000010/statement')) {
          return mockStatementPayload;
        }
        throw new Error(`Unexpected endpoint: ${url}`);
      });

      render(
        <MemoryRouter initialEntries={['/statements?accountId=00000000-0000-0000-0000-000000000010']}>
          <Routes>
            <Route path="/statements" element={<StatementsPage />} />
          </Routes>
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByTestId('statement-account-number')).toHaveTextContent('ACC-CUST-10');
      });

      expect(screen.getByTestId('statement-current-balance')).toHaveTextContent('₹5,000.00');
      expect(screen.getByTestId('statement-table')).toBeInTheDocument();
      expect(screen.getAllByTestId('statement-row')).toHaveLength(2);
    });

    it('handles backend 403 Forbidden with clear access denied alert without leaking data', async () => {
      vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
        user: { id: 'user-cust-1', username: 'alice', role: 'account_holder' },
        role: 'account_holder',
        isAuthenticated: true,
      });

      vi.spyOn(api, 'get').mockImplementation(async (url) => {
        if (url === '/api/accounts') {
          return { accounts: mockCustomerAccounts };
        }
        if (url.startsWith('/api/accounts/unauthorized-id/statement')) {
          throw new ApiError(403, { error: 'ForbiddenError', message: 'Access denied: you do not own this account' });
        }
        throw new Error(`Unexpected endpoint: ${url}`);
      });

      render(
        <MemoryRouter initialEntries={['/statements?accountId=unauthorized-id']}>
          <Routes>
            <Route path="/statements" element={<StatementsPage />} />
          </Routes>
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText('Access Denied: You do not have authorization to view the statement for this account.')).toBeInTheDocument();
      });

      // Confirm no statement table or balance is displayed
      expect(screen.queryByTestId('statement-table')).not.toBeInTheDocument();
      expect(screen.queryByTestId('statement-current-balance')).not.toBeInTheDocument();
    });

    it('confirms zero mutation API calls are ever triggered from statements page', async () => {
      const postSpy = vi.spyOn(api, 'post');
      const patchSpy = vi.spyOn(api, 'patch');
      const deleteSpy = vi.spyOn(api, 'delete');

      vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
        user: { id: 'user-auditor', username: 'auditor', role: 'auditor' },
        role: 'auditor',
        isAuthenticated: true,
      });

      vi.spyOn(api, 'get').mockImplementation(async (url) => {
        if (url === '/api/accounts') return { accounts: mockCustomerAccounts };
        return mockStatementPayload;
      });

      render(
        <MemoryRouter initialEntries={['/statements?accountId=00000000-0000-0000-0000-000000000010']}>
          <Routes>
            <Route path="/statements" element={<StatementsPage />} />
          </Routes>
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByTestId('statement-account-number')).toBeInTheDocument();
      });

      expect(postSpy).not.toHaveBeenCalled();
      expect(patchSpy).not.toHaveBeenCalled();
      expect(deleteSpy).not.toHaveBeenCalled();
    });
  });
});
