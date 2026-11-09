import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AuditorPortalPage } from '../pages/AuditorPortalPage';
import { AuditorOverviewCard } from '../components/auditor/AuditorOverviewCard';
import { AuditorAccountsTable } from '../components/auditor/AuditorAccountsTable';
import * as AuthContextModule from '../context/AuthContext';
import { api } from '../api/client';

describe('Auditor Portal Component & Integration Suite (Stage 6)', () => {
  const sampleAccounts = [
    {
      id: '00000000-0000-0000-0000-000000000002',
      account_number: 'SYSTEM_CASH_CLEARING',
      account_type: 'system_clearing',
      balance_paise: '-125000', // - ₹1,250.00
      user_id: null,
      created_at: '2026-01-01T00:00:00.000Z',
    },
    {
      id: '00000000-0000-0000-0000-000000000001',
      account_number: 'SYSTEM_EQUITY',
      account_type: 'system_equity',
      balance_paise: '10000000000', // ₹10,00,00,000.00
      user_id: null,
      created_at: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'acc-cust-1',
      account_number: 'ACC-CUST-001',
      account_type: 'customer',
      balance_paise: '500000', // ₹5,000.00
      user_id: 'user-alice-uuid',
      created_at: '2026-02-01T10:00:00.000Z',
    },
    {
      id: 'acc-cust-2',
      account_number: 'ACC-CUST-002',
      account_type: 'customer',
      balance_paise: '250000', // ₹2,500.00
      user_id: 'user-bob-uuid',
      created_at: '2026-02-05T10:00:00.000Z',
    },
  ];

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('1. AuditorOverviewCard Component', () => {
    it('renders exact mandated labels, BigInt-safe balances, and accounting disclaimer', () => {
      render(<AuditorOverviewCard accounts={sampleAccounts} />);

      // 1. Precise Labels
      expect(screen.getByText('Recorded cash-clearing balance')).toBeInTheDocument();
      expect(screen.getByText('Opening-balance equity')).toBeInTheDocument();
      expect(screen.getByText('Customer account balance total')).toBeInTheDocument();

      // 2. Formatted Balances
      expect(screen.getByTestId('clearing-balance')).toHaveTextContent('-₹1,250.00');
      expect(screen.getByTestId('equity-balance')).toHaveTextContent('₹10,00,00,000.00');
      // Customer total = 500000 + 250000 = 750000 paise = ₹7,500.00
      expect(screen.getByTestId('customer-total-balance')).toHaveTextContent('₹7,500.00');

      // 3. Counter-Account Disclaimer Notice
      const disclaimer = screen.getByTestId('clearing-disclaimer');
      expect(disclaimer).toHaveTextContent(/internal double-entry clearing counter-account/i);
      expect(disclaimer).toHaveTextContent(/does not prove or represent real-world physical vault cash or external bank reserves/i);
      expect(disclaimer).toHaveTextContent(/must not be interpreted as available liquidity/i);
    });
  });

  describe('2. AuditorAccountsTable Component', () => {
    it('renders statement links configured with includeRefused=true', () => {
      render(
        <MemoryRouter>
          <AuditorAccountsTable accounts={sampleAccounts} />
        </MemoryRouter>
      );

      const clearingLink = screen.getByTestId('link-audit-statement-00000000-0000-0000-0000-000000000002');
      expect(clearingLink).toHaveAttribute(
        'href',
        '/statements?accountId=00000000-0000-0000-0000-000000000002&includeRefused=true'
      );

      const custLink = screen.getByTestId('link-audit-statement-acc-cust-1');
      expect(custLink).toHaveAttribute(
        'href',
        '/statements?accountId=acc-cust-1&includeRefused=true'
      );
    });
  });

  describe('3. AuditorPortalPage Integration & Safety', () => {
    it('renders auditor portal with read-only banner and confirms zero mutation API calls', async () => {
      const postSpy = vi.spyOn(api, 'post');
      const patchSpy = vi.spyOn(api, 'patch');
      const deleteSpy = vi.spyOn(api, 'delete');

      vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
        user: { id: 'auditor-1', username: 'auditor_compliance', role: 'auditor' },
        role: 'auditor',
        isAuthenticated: true,
      });

      vi.spyOn(api, 'get').mockResolvedValue({ accounts: sampleAccounts });

      render(
        <MemoryRouter initialEntries={['/auditor']}>
          <Routes>
            <Route path="/auditor" element={<AuditorPortalPage />} />
          </Routes>
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText('Auditor Compliance Portal')).toBeInTheDocument();
      });

      expect(screen.getByTestId('auditor-oversight-banner')).toHaveTextContent(/Compliance Oversight Mode: You are signed in with an Auditor profile/);
      expect(screen.getByTestId('clearing-balance')).toHaveTextContent('-₹1,250.00');
      expect(screen.getByTestId('customer-total-balance')).toHaveTextContent('₹7,500.00');

      // Verify no mutation API calls were triggered
      expect(postSpy).not.toHaveBeenCalled();
      expect(patchSpy).not.toHaveBeenCalled();
      expect(deleteSpy).not.toHaveBeenCalled();
    });
  });
});
