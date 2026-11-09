import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DashboardPage } from '../pages/DashboardPage';
import { AccountCard } from '../components/dashboard/AccountCard';
import { AccountSummary } from '../components/dashboard/AccountSummary';
import { EmptyAccountState } from '../components/dashboard/EmptyAccountState';
import * as AuthContextModule from '../context/AuthContext';
import { api } from '../api/client';

describe('AccountCard Component', () => {
  const sampleCustomerAccount = {
    id: '11111111-1111-1111-1111-111111111111',
    account_number: 'ACC-CUST-001',
    balance_paise: '500000', // ₹5,000.00
    account_type: 'customer',
    user_id: 'user-123',
    created_at: '2026-01-15T10:00:00Z',
  };

  it('renders account number, account type, and formatted INR balance', () => {
    render(
      <MemoryRouter>
        <AccountCard
          account={sampleCustomerAccount}
          currentUserRole="account_holder"
          currentUserId="user-123"
        />
      </MemoryRouter>
    );

    expect(screen.getByText('ACC-CUST-001')).toBeInTheDocument();
    expect(screen.getByText('Customer Account')).toBeInTheDocument();
    expect(screen.getByTestId('account-balance')).toHaveTextContent('₹5,000.00');
    expect(screen.getByText('Your Account')).toBeInTheDocument();
  });

  it('renders "Assigned" badge for admin when user_id is not current user without exposing UUID', () => {
    render(
      <MemoryRouter>
        <AccountCard
          account={sampleCustomerAccount}
          currentUserRole="admin"
          currentUserId="admin-999"
        />
      </MemoryRouter>
    );

    expect(screen.getByText('Assigned')).toBeInTheDocument();
    // Raw UUID must never be exposed
    expect(screen.queryByText('user-123')).not.toBeInTheDocument();
  });

  it('renders "Unassigned" badge for admin when customer account has user_id = null', () => {
    const unassignedAccount = {
      ...sampleCustomerAccount,
      account_number: 'ACC-UNASSIGNED-01',
      user_id: null,
    };

    render(
      <MemoryRouter>
        <AccountCard
          account={unassignedAccount}
          currentUserRole="admin"
          currentUserId="admin-999"
        />
      </MemoryRouter>
    );

    expect(screen.getByText('Unassigned')).toBeInTheDocument();
  });

  it('renders system accounts with distinct badge and system controlled indicator', () => {
    const clearingAccount = {
      id: '00000000-0000-0000-0000-000000000002',
      account_number: 'SYSTEM_CASH_CLEARING',
      balance_paise: '-10000',
      account_type: 'system_clearing',
      user_id: null,
    };

    render(
      <MemoryRouter>
        <AccountCard
          account={clearingAccount}
          currentUserRole="auditor"
          currentUserId="auditor-1"
        />
      </MemoryRouter>
    );

    expect(screen.getByText('Cash Clearing')).toBeInTheDocument();
    expect(screen.getByText('System Controlled')).toBeInTheDocument();
    expect(screen.getByTestId('account-balance')).toHaveTextContent('-₹100.00');
  });

  it('safely formats large BigInt balances exceeding MAX_SAFE_INTEGER', () => {
    const hugeBalanceAccount = {
      ...sampleCustomerAccount,
      balance_paise: '9007199254740993', // MAX_SAFE_INTEGER + 2
    };

    render(
      <MemoryRouter>
        <AccountCard
          account={hugeBalanceAccount}
          currentUserRole="account_holder"
          currentUserId="user-123"
        />
      </MemoryRouter>
    );

    // 90,071,992,547,409.93 Rupees formatted in Indian grouping
    expect(screen.getByTestId('account-balance')).toHaveTextContent('₹9,00,71,99,25,47,409.93');
  });

  it('renders cutover metadata only when present and omits cleanly when absent', () => {
    const { rerender } = render(
      <MemoryRouter>
        <AccountCard
          account={sampleCustomerAccount}
          currentUserRole="account_holder"
          currentUserId="user-123"
        />
      </MemoryRouter>
    );

    expect(screen.queryByText(/Cutover Baseline/i)).not.toBeInTheDocument();

    const accountWithCutover = {
      ...sampleCustomerAccount,
      phase6_cutover_balance_paise: '250000',
      phase6_cutover_captured_at: '2026-01-01T00:00:00Z',
    };

    rerender(
      <MemoryRouter>
        <AccountCard
          account={accountWithCutover}
          currentUserRole="account_holder"
          currentUserId="user-123"
        />
      </MemoryRouter>
    );

    expect(screen.getByText(/Cutover Baseline:/i)).toBeInTheDocument();
    expect(screen.getByText(/₹2,500.00/i)).toBeInTheDocument();
  });
});

describe('AccountSummary Component', () => {
  const accountsFixture = [
    { id: '1', account_number: 'ACC-01', balance_paise: '300000', account_type: 'customer', user_id: 'u1' }, // ₹3,000.00
    { id: '2', account_number: 'ACC-02', balance_paise: '200000', account_type: 'customer', user_id: 'u2' }, // ₹2,000.00
    { id: '3', account_number: 'ACC-03', balance_paise: '100000', account_type: 'customer', user_id: null }, // ₹1,000.00 (Unassigned)
    { id: '4', account_number: 'SYS-CLR', balance_paise: '-999999999', account_type: 'system_clearing', user_id: null }, // MUST NOT be included
    { id: '5', account_number: 'SYS-EQU', balance_paise: '500000000', account_type: 'system_equity', user_id: null },  // MUST NOT be included
  ];

  it('calculates Total Customer Balance using BigInt and customer accounts ONLY', () => {
    render(
      <AccountSummary
        accounts={accountsFixture}
        role="admin"
        user={{ username: 'admin', email: 'admin@ledgerline.com' }}
      />
    );

    // Sum of customer accounts: 300,000 + 200,000 + 100,000 = 600,000 paise = ₹6,000.00
    // Clearing (-999,999,999) and Equity (500,000,000) are strictly excluded
    expect(screen.getByTestId('summary-customer-balance')).toHaveTextContent('₹6,000.00');
    expect(screen.getByTestId('summary-account-count')).toHaveTextContent('5');
    expect(screen.getByTestId('summary-unassigned-count')).toHaveTextContent('1');
    expect(screen.getByTestId('summary-system-count')).toHaveTextContent('2');
  });

  it('displays Auditor Mode banner when role is auditor', () => {
    render(
      <AccountSummary
        accounts={accountsFixture}
        role="auditor"
        user={{ username: 'auditor1', email: 'auditor@ledgerline.com' }}
      />
    );

    expect(screen.getByTestId('auditor-banner')).toBeInTheDocument();
    expect(screen.getByText(/Auditor Mode — Strictly Read-Only Inspection/i)).toBeInTheDocument();
  });

  it('displays Admin Overview banner when role is admin', () => {
    render(
      <AccountSummary
        accounts={accountsFixture}
        role="admin"
        user={{ username: 'admin1', email: 'admin@ledgerline.com' }}
      />
    );

    expect(screen.getByTestId('admin-banner')).toBeInTheDocument();
    expect(screen.getByText(/Administrative Overview — System-Wide Ledger Accounts/i)).toBeInTheDocument();
  });
});

describe('EmptyAccountState Component', () => {
  it('renders actionable guidance for account_holder with no accounts', () => {
    render(
      <MemoryRouter>
        <EmptyAccountState role="account_holder" />
      </MemoryRouter>
    );

    expect(screen.getByText('No Accounts Assigned Yet')).toBeInTheDocument();
    expect(screen.getByText(/Contact your banking administrator to link your customer account/i)).toBeInTheDocument();
  });

  it('renders link to Admin Portal for admin when no accounts are found', () => {
    render(
      <MemoryRouter>
        <EmptyAccountState role="admin" filterType="customer" />
      </MemoryRouter>
    );

    expect(screen.getByText('No Accounts Found')).toBeInTheDocument();
    expect(screen.getByText(/Go to Admin Portal to Create Account/i)).toBeInTheDocument();
  });
});

describe('DashboardPage Component Integration', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('displays loading indicator initially while fetching accounts', () => {
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
      user: { username: 'testuser', id: 'u1' },
      role: 'account_holder',
      isAuthenticated: true,
    });
    vi.spyOn(api, 'get').mockReturnValue(new Promise(() => {})); // pending promise

    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    );

    expect(screen.getByTestId('dashboard-loading')).toBeInTheDocument();
    expect(screen.getByText('Loading account balances...')).toBeInTheDocument();
  });

  it('renders accounts successfully for account_holder', async () => {
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
      user: { username: 'alice', id: 'user-alice' },
      role: 'account_holder',
      isAuthenticated: true,
    });

    vi.spyOn(api, 'get').mockResolvedValue({
      accounts: [
        {
          id: 'acc-1',
          account_number: 'ALICE-001',
          balance_paise: '150000', // ₹1,500.00
          account_type: 'customer',
          user_id: 'user-alice',
          created_at: '2026-01-10T10:00:00Z',
        },
      ],
    });

    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('ALICE-001')).toBeInTheDocument();
    });

    expect(screen.getByTestId('account-balance')).toHaveTextContent('₹1,500.00');
    expect(screen.getByText('Your Account')).toBeInTheDocument();
    expect(screen.queryByTestId('auditor-banner')).not.toBeInTheDocument();
    expect(screen.queryByTestId('admin-banner')).not.toBeInTheDocument();
  });

  it('renders empty account state for account_holder when accounts array is empty', async () => {
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
      user: { username: 'newuser', id: 'user-new' },
      role: 'account_holder',
      isAuthenticated: true,
    });

    vi.spyOn(api, 'get').mockResolvedValue({ accounts: [] });

    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('empty-account-state')).toBeInTheDocument();
    });

    expect(screen.getByText('No Accounts Assigned Yet')).toBeInTheDocument();
  });

  it('handles error state and allows successful retry', async () => {
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
      user: { username: 'alice', id: 'user-alice' },
      role: 'account_holder',
      isAuthenticated: true,
    });

    const mockApiGet = vi.spyOn(api, 'get')
      .mockRejectedValueOnce(new Error('Network connection timeout'))
      .mockResolvedValueOnce({
        accounts: [
          {
            id: 'acc-1',
            account_number: 'ALICE-RETRY-001',
            balance_paise: '200000',
            account_type: 'customer',
            user_id: 'user-alice',
          },
        ],
      });

    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Network connection timeout');
    });

    const retryBtn = screen.getByTestId('retry-btn');
    expect(retryBtn).toBeInTheDocument();

    fireEvent.click(retryBtn);

    await waitFor(() => {
      expect(screen.getByText('ALICE-RETRY-001')).toBeInTheDocument();
    });

    expect(mockApiGet).toHaveBeenCalledTimes(2);
  });

  it('allows admin to filter accounts by account type and search by account number', async () => {
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
      user: { username: 'admin', id: 'admin-id' },
      role: 'admin',
      isAuthenticated: true,
    });

    vi.spyOn(api, 'get').mockResolvedValue({
      accounts: [
        { id: '1', account_number: 'ACC-CUST-100', balance_paise: '100000', account_type: 'customer', user_id: 'u1' },
        { id: '2', account_number: 'ACC-UNASSIGNED-200', balance_paise: '0', account_type: 'customer', user_id: null },
        { id: '3', account_number: 'SYSTEM_CASH_CLEARING', balance_paise: '-50000', account_type: 'system_clearing', user_id: null },
      ],
    });

    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('ACC-CUST-100')).toBeInTheDocument();
    });

    expect(screen.getByText('ACC-UNASSIGNED-200')).toBeInTheDocument();
    expect(screen.getByText('SYSTEM_CASH_CLEARING')).toBeInTheDocument();

    // Click "Unassigned" filter tab
    const unassignedTab = screen.getByTestId('filter-tab-unassigned');
    fireEvent.click(unassignedTab);

    expect(screen.getByText('ACC-UNASSIGNED-200')).toBeInTheDocument();
    expect(screen.queryByText('ACC-CUST-100')).not.toBeInTheDocument();
    expect(screen.queryByText('SYSTEM_CASH_CLEARING')).not.toBeInTheDocument();

    // Click "Clearing" filter tab
    const clearingTab = screen.getByTestId('filter-tab-system_clearing');
    fireEvent.click(clearingTab);

    expect(screen.getByText('SYSTEM_CASH_CLEARING')).toBeInTheDocument();
    expect(screen.queryByText('ACC-UNASSIGNED-200')).not.toBeInTheDocument();

    // Click "All Accounts" tab
    fireEvent.click(screen.getByTestId('filter-tab-all'));
    expect(screen.getByText('ACC-CUST-100')).toBeInTheDocument();

    // Test Search input
    const searchInput = screen.getByTestId('account-search-input');
    fireEvent.change(searchInput, { target: { value: '100' } });

    expect(screen.getByText('ACC-CUST-100')).toBeInTheDocument();
    expect(screen.queryByText('ACC-UNASSIGNED-200')).not.toBeInTheDocument();
    expect(screen.queryByText('SYSTEM_CASH_CLEARING')).not.toBeInTheDocument();
  });

  it('auditor dashboard renders compliance read-only indicator and has zero mutation buttons', async () => {
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
      user: { username: 'auditor_compliance', id: 'aud-1' },
      role: 'auditor',
      isAuthenticated: true,
    });

    vi.spyOn(api, 'get').mockResolvedValue({
      accounts: [
        { id: '1', account_number: 'AUDIT-001', balance_paise: '500000', account_type: 'customer', user_id: 'u1' },
      ],
    });

    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('auditor-banner')).toBeInTheDocument();
    });

    // Zero financial mutation controls in Stage 3
    expect(screen.queryByRole('button', { name: /deposit/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /withdraw/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /transfer/i })).not.toBeInTheDocument();
  });
});
