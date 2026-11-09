import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { TransfersPage } from '../pages/TransfersPage';
import { ConfirmationModal } from '../components/transfers/ConfirmationModal';
import { TransactionReceipt } from '../components/transfers/TransactionReceipt';
import { PendingOperationBanner } from '../components/transfers/PendingOperationBanner';
import * as AuthContextModule from '../context/AuthContext';
import { api, ApiError } from '../api/client';

const PENDING_STORAGE_KEY = 'ledgerline_pending_mutation';

describe('ConfirmationModal Component', () => {
  const sampleDetails = {
    operationType: 'transfer',
    fromAccountLabel: 'ACC-001 (₹5,000.00)',
    toAccountLabel: 'ACC-002 (Customer)',
    displayAmountINR: '₹1,250.50',
    amountPaise: '125050',
    idempotencyKey: 'TRF-TEST-KEY-123',
  };

  it('renders operation details and idempotency reference cleanly', () => {
    render(
      <ConfirmationModal
        isOpen={true}
        operationDetails={sampleDetails}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        isSubmitting={false}
      />
    );

    expect(screen.getByText('Confirm Customer Transfer')).toBeInTheDocument();
    expect(screen.getByText('₹1,250.50')).toBeInTheDocument();
    expect(screen.getByText('(125050 integer paise)')).toBeInTheDocument();
    expect(screen.getByText(/TRF-TEST-KEY-123/)).toBeInTheDocument();
    expect(screen.getByText('Confirm & Execute')).toBeInTheDocument();
  });

  it('disables buttons and shows spinner when isSubmitting is true', () => {
    render(
      <ConfirmationModal
        isOpen={true}
        operationDetails={sampleDetails}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        isSubmitting={true}
      />
    );

    const confirmBtn = screen.getByTestId('modal-confirm-btn');
    const cancelBtn = screen.getByTestId('modal-cancel-btn');

    expect(confirmBtn).toBeDisabled();
    expect(cancelBtn).toBeDisabled();
    expect(confirmBtn).toHaveTextContent('Processing...');
  });
});

describe('TransactionReceipt Component', () => {
  it('renders successful transfer receipt and updated balances', () => {
    const receipt = {
      message: 'Transfer completed successfully',
      transfer: {
        id: 'tx-12345',
        amountPaise: '50000',
        status: 'completed',
        createdAt: '2026-01-20T12:00:00Z',
      },
      updatedBalances: {
        sourceBalancePaise: '450000',
        destinationBalancePaise: '550000',
      },
      isReplayed: false,
    };

    render(
      <MemoryRouter>
        <TransactionReceipt receipt={receipt} onReset={vi.fn()} />
      </MemoryRouter>
    );

    expect(screen.getByText('Transfer completed successfully')).toBeInTheDocument();
    expect(screen.getByText('₹500.00')).toBeInTheDocument();
    expect(screen.getByText('tx-12345')).toBeInTheDocument();
    expect(screen.getByText('₹4,500.00')).toBeInTheDocument();
    expect(screen.getByText('₹5,500.00')).toBeInTheDocument();
    expect(screen.queryByTestId('replay-badge')).not.toBeInTheDocument();
  });

  it('renders replay badge when transaction was an idempotent replay', () => {
    const receipt = {
      message: 'Transfer completed successfully',
      transfer: { id: 'tx-replayed', amountPaise: '10000' },
      isReplayed: true,
    };

    render(
      <MemoryRouter>
        <TransactionReceipt receipt={receipt} onReset={vi.fn()} />
      </MemoryRouter>
    );

    expect(screen.getByTestId('replay-badge')).toBeInTheDocument();
    expect(screen.getByText(/Idempotent Replay/i)).toBeInTheDocument();
  });
});

describe('TransfersPage Component Integration', () => {
  const customerUser = { id: 'usr-1', username: 'alice', role: 'account_holder' };

  const customerAccountsFixture = [
    { id: '11111111-1111-1111-1111-111111111111', account_number: 'ACC-ALICE-1', balance_paise: '500000', account_type: 'customer', user_id: 'usr-1' },
    { id: '22222222-2222-2222-2222-222222222222', account_number: 'ACC-ALICE-2', balance_paise: '200000', account_type: 'customer', user_id: 'usr-1' },
    { id: '00000000-0000-0000-0000-000000000002', account_number: 'SYSTEM_CASH_CLEARING', balance_paise: '-10000', account_type: 'system_clearing', user_id: null },
  ];

  beforeEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  it('strictly excludes system accounts from customer selectors', async () => {
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
      user: customerUser,
      role: 'account_holder',
      isAuthenticated: true,
    });

    vi.spyOn(api, 'get').mockResolvedValue({ accounts: customerAccountsFixture });

    render(
      <MemoryRouter>
        <TransfersPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/ACC-ALICE-1/)).toBeInTheDocument();
    });

    // SYSTEM_CASH_CLEARING must NEVER be listed in selectable options
    expect(screen.queryByText(/SYSTEM_CASH_CLEARING/)).not.toBeInTheDocument();
  });

  it('executes a customer-to-customer transfer with confirmation and fresh idempotency key', async () => {
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
      user: customerUser,
      role: 'account_holder',
      isAuthenticated: true,
    });

    vi.spyOn(api, 'get').mockResolvedValue({ accounts: customerAccountsFixture });

    const postSpy = vi.spyOn(api, 'post').mockResolvedValue({
      data: {
        message: 'Transfer completed successfully',
        transfer: {
          id: 'trf-999',
          amountPaise: '100000',
          status: 'completed',
          createdAt: '2026-01-20T10:00:00Z',
        },
        updatedBalances: {
          sourceBalancePaise: '400000',
          destinationBalancePaise: '300000',
        },
      },
      isReplayed: false,
    });

    render(
      <MemoryRouter>
        <TransfersPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('transfer-source-select')).toBeInTheDocument();
    });

    // Select destination account
    const destSelect = screen.getByTestId('transfer-dest-select');
    fireEvent.change(destSelect, { target: { value: '22222222-2222-2222-2222-222222222222' } });

    // Enter Rupee amount: ₹1,000.00
    const amountInput = screen.getByTestId('transfer-amount-input');
    fireEvent.change(amountInput, { target: { value: '1000' } });

    // Click Review
    const submitBtn = screen.getByTestId('transfer-submit-btn');
    fireEvent.click(submitBtn);

    // Modal should open
    await waitFor(() => {
      expect(screen.getByText('Confirm Customer Transfer')).toBeInTheDocument();
    });

    expect(screen.getByText('₹1,000.00')).toBeInTheDocument();
    expect(screen.getByText('(100000 integer paise)')).toBeInTheDocument();

    // Confirm in modal
    const confirmBtn = screen.getByTestId('modal-confirm-btn');
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(screen.getByTestId('transaction-receipt')).toBeInTheDocument();
    });

    // Verify API called with Idempotency-Key starting with TRF-
    expect(postSpy).toHaveBeenCalledTimes(1);
    const [endpoint, payload, options] = postSpy.mock.calls[0];
    expect(endpoint).toBe('/api/transfers');
    expect(payload).toEqual({
      sourceAccountId: '11111111-1111-1111-1111-111111111111',
      destinationAccountId: '22222222-2222-2222-2222-222222222222',
      amountPaise: '100000',
    });
    expect(options.headers['Idempotency-Key']).toMatch(/^TRF-/);
    expect(options.withResponseHeaders).toBe(true);

    // Confirm sessionStorage was cleared after definitive success
    expect(sessionStorage.getItem(PENDING_STORAGE_KEY)).toBeNull();
  });

  it('rejects transfer exceeding balance with client-side error before network call', async () => {
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
      user: customerUser,
      role: 'account_holder',
      isAuthenticated: true,
    });

    vi.spyOn(api, 'get').mockResolvedValue({ accounts: customerAccountsFixture });
    const postSpy = vi.spyOn(api, 'post');

    render(
      <MemoryRouter>
        <TransfersPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('transfer-source-select')).toBeInTheDocument();
    });

    // Select destination
    fireEvent.change(screen.getByTestId('transfer-dest-select'), {
      target: { value: '22222222-2222-2222-2222-222222222222' },
    });

    // Enter amount exceeding balance (balance is ₹5,000.00; enter ₹9,999.00)
    fireEvent.change(screen.getByTestId('transfer-amount-input'), {
      target: { value: '9999' },
    });

    fireEvent.click(screen.getByTestId('transfer-submit-btn'));

    // Error displayed client-side
    expect(screen.getByRole('alert')).toHaveTextContent(/Insufficient funds/i);
    // Modal never opened and API never called
    expect(postSpy).not.toHaveBeenCalled();
    expect(screen.queryByText('Confirm Customer Transfer')).not.toBeInTheDocument();
  });

  it('displays backend 422 InsufficientFundsError and clears pending sessionStorage', async () => {
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
      user: customerUser,
      role: 'account_holder',
      isAuthenticated: true,
    });

    vi.spyOn(api, 'get').mockResolvedValue({ accounts: customerAccountsFixture });

    const insufficientErr = new ApiError(422, {
      error: 'InsufficientFundsError',
      message: 'Sender has insufficient funds for this transfer',
      currentBalancePaise: '500000',
      attemptedAmountPaise: '1000000',
    }, 'Sender has insufficient funds for this transfer');

    vi.spyOn(api, 'post').mockRejectedValue(insufficientErr);

    render(
      <MemoryRouter>
        <TransfersPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('transfer-source-select')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId('transfer-dest-select'), {
      target: { value: '22222222-2222-2222-2222-222222222222' },
    });
    fireEvent.change(screen.getByTestId('transfer-amount-input'), { target: { value: '500' } });
    fireEvent.click(screen.getByTestId('transfer-submit-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('modal-confirm-btn')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('modal-confirm-btn'));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/insufficient funds/i);
    });

    // Because this was a definitive 422 rejection, pending sessionStorage must be cleared
    expect(sessionStorage.getItem(PENDING_STORAGE_KEY)).toBeNull();
    // Modal closed
    expect(screen.queryByText('Confirm Customer Transfer')).not.toBeInTheDocument();
  });

  it('preserves exact idempotency key and locks form on ambiguous network failure', async () => {
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
      user: customerUser,
      role: 'account_holder',
      isAuthenticated: true,
    });

    vi.spyOn(api, 'get').mockResolvedValue({ accounts: customerAccountsFixture });

    // Network timeout / connection dropped (status 0)
    const netErr = new ApiError(0, null, 'Network connection failed. Please ensure the backend server is running.');

    const postSpy = vi.spyOn(api, 'post')
      .mockRejectedValueOnce(netErr)
      .mockResolvedValueOnce({
        data: {
          message: 'Transfer completed successfully',
          transfer: { id: 'trf-resolved', amountPaise: '50000', status: 'completed' },
        },
        isReplayed: true,
      });

    render(
      <MemoryRouter>
        <TransfersPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('transfer-source-select')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId('transfer-dest-select'), {
      target: { value: '22222222-2222-2222-2222-222222222222' },
    });
    fireEvent.change(screen.getByTestId('transfer-amount-input'), { target: { value: '500' } });
    fireEvent.click(screen.getByTestId('transfer-submit-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('modal-confirm-btn')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('modal-confirm-btn'));

    // Uncertain outcome banner must appear
    await waitFor(() => {
      expect(screen.getByTestId('pending-operation-banner')).toBeInTheDocument();
    });

    expect(screen.getByText(/Uncertain Transaction Outcome/i)).toBeInTheDocument();

    // Verify pending record was persisted in sessionStorage
    const stored = JSON.parse(sessionStorage.getItem(PENDING_STORAGE_KEY));
    expect(stored).not.toBeNull();
    expect(stored.status).toBe('uncertain_network_failure');
    const firstKey = stored.idempotencyKey;
    expect(firstKey).toMatch(/^TRF-/);

    // Form inputs and tab switches must be locked
    expect(screen.getByTestId('transfer-source-select')).toBeDisabled();
    expect(screen.getByTestId('transfer-amount-input')).toBeDisabled();
    expect(screen.getByTestId('tab-deposit')).toBeDisabled();

    // Click "Retry Operation (Same Key)"
    const retryBtn = screen.getByTestId('retry-same-key-btn');
    fireEvent.click(retryBtn);

    await waitFor(() => {
      expect(screen.getByTestId('transaction-receipt')).toBeInTheDocument();
    });

    // Verify retry used the EXACT SAME idempotency key and payload
    expect(postSpy).toHaveBeenCalledTimes(2);
    const secondCallKey = postSpy.mock.calls[1][2].headers['Idempotency-Key'];
    expect(secondCallKey).toBe(firstKey);

    // After definitive resolution, sessionStorage must be cleared
    expect(sessionStorage.getItem(PENDING_STORAGE_KEY)).toBeNull();
  });

  it('restores pending operation after simulated page reload and keeps fields locked', async () => {
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
      user: customerUser,
      role: 'account_holder',
      isAuthenticated: true,
    });

    vi.spyOn(api, 'get').mockResolvedValue({ accounts: customerAccountsFixture });

    // Seed sessionStorage as if page refreshed during an ambiguous failure
    const pendingOp = {
      operationType: 'deposit',
      endpoint: '/api/transfers/deposit',
      idempotencyKey: 'DEP-SAVED-KEY-777',
      payload: {
        accountId: '11111111-1111-1111-1111-111111111111',
        amountPaise: '25000',
      },
      displayAmountINR: '₹250.00',
      status: 'uncertain_network_failure',
      timestamp: new Date().toISOString(),
    };
    sessionStorage.setItem(PENDING_STORAGE_KEY, JSON.stringify(pendingOp));

    render(
      <MemoryRouter>
        <TransfersPage />
      </MemoryRouter>
    );

    // Should immediately display the pending banner on reload
    await waitFor(() => {
      expect(screen.getByTestId('pending-operation-banner')).toBeInTheDocument();
    });

    expect(screen.getByText(/DEP-SAVED-KEY-777/)).toBeInTheDocument();
    expect(screen.getByText('₹250.00')).toBeInTheDocument();

    // Tabs and inputs must be locked
    expect(screen.getByTestId('tab-transfer')).toBeDisabled();
    expect(screen.getByTestId('tab-withdraw')).toBeDisabled();

    // Statement link must be present, but statement inspection note clarifies it does not prove failure
    expect(screen.getByText(/Checking your account statement does not prove non-commitment/i)).toBeInTheDocument();
  });

  it('differentiates 409 ConcurrentRequestError from 409 IdempotencyConflictError', async () => {
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
      user: customerUser,
      role: 'account_holder',
      isAuthenticated: true,
    });

    vi.spyOn(api, 'get').mockResolvedValue({ accounts: customerAccountsFixture });

    // 409 ConcurrentRequestError: unresolved outcome, preserves pending key
    const concurrentErr = new ApiError(409, {
      error: 'ConcurrentRequestError',
      message: 'A concurrent request with this idempotency key is already in progress',
    }, 'A concurrent request with this idempotency key is already in progress');

    vi.spyOn(api, 'post').mockRejectedValueOnce(concurrentErr);

    render(
      <MemoryRouter>
        <TransfersPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('transfer-source-select')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId('transfer-dest-select'), {
      target: { value: '22222222-2222-2222-2222-222222222222' },
    });
    fireEvent.change(screen.getByTestId('transfer-amount-input'), { target: { value: '100' } });
    fireEvent.click(screen.getByTestId('transfer-submit-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('modal-confirm-btn')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('modal-confirm-btn'));

    // Because it's concurrent, it is treated as unresolved
    await waitFor(() => {
      expect(screen.getByTestId('pending-operation-banner')).toBeInTheDocument();
    });

    expect(screen.getByText(/Transaction In Progress — Outcome Unresolved/i)).toBeInTheDocument();
    // Preserved in sessionStorage
    expect(sessionStorage.getItem(PENDING_STORAGE_KEY)).not.toBeNull();
  });

  it('blocks auditor profile from accessing or submitting mutations', async () => {
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
      user: { id: 'aud-1', username: 'auditor', role: 'auditor' },
      role: 'auditor',
      isAuthenticated: true,
    });
    vi.spyOn(api, 'get').mockResolvedValue({ accounts: [] });

    render(
      <MemoryRouter>
        <TransfersPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Auditor Mode: Read-Only Oversight/i)).toBeInTheDocument();
    });
    expect(screen.queryByTestId('tab-transfer')).not.toBeInTheDocument();
    expect(screen.queryByTestId('transfer-submit-btn')).not.toBeInTheDocument();
  });
});

