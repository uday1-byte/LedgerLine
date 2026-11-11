import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AdminPortalPage } from '../pages/AdminPortalPage';
import { CreateAccountModal } from '../components/admin/CreateAccountModal';
import { AssignOwnerModal } from '../components/admin/AssignOwnerModal';
import { UserGovernanceForm } from '../components/admin/UserGovernanceForm';
import { UnassignedAccountsTable } from '../components/admin/UnassignedAccountsTable';
import { RegisteredUsersTable } from '../components/admin/RegisteredUsersTable';
import * as AuthContextModule from '../context/AuthContext';
import { api, ApiError } from '../api/client';

describe('Admin Portal Component & Integration Suite (Stage 6)', () => {
  const sampleUsers = [
    {
      id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      username: 'alice_customer',
      email: 'alice@example.com',
      role: 'account_holder',
      is_active: true,
      created_at: '2026-03-01T09:00:00.000Z',
      updated_at: '2026-03-01T09:00:00.000Z',
    },
    {
      id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      username: 'bob_auditor',
      email: 'bob.audit@example.com',
      role: 'auditor',
      is_active: true,
      created_at: '2026-02-20T09:00:00.000Z',
      updated_at: '2026-02-20T09:00:00.000Z',
    },
    {
      id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
      username: 'carol_inactive',
      email: 'carol@example.com',
      role: 'account_holder',
      is_active: false,
      created_at: '2026-02-10T09:00:00.000Z',
      updated_at: '2026-02-15T09:00:00.000Z',
    },
    {
      id: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
      username: 'admin_root',
      email: 'admin@example.com',
      role: 'admin',
      is_active: true,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    },
  ];

  const sampleAccounts = [
    {
      id: 'acc-unassigned-1',
      account_number: 'ACC-NEW-001',
      account_type: 'customer',
      balance_paise: '0',
      user_id: null,
      created_at: '2026-03-01T10:00:00.000Z',
    },
    {
      id: 'acc-assigned-1',
      account_number: 'ACC-ASSIGNED-002',
      account_type: 'customer',
      balance_paise: '500000',
      user_id: 'user-uuid-1111-1111-1111-111111111111',
      created_at: '2026-02-15T10:00:00.000Z',
    },
    {
      id: '00000000-0000-0000-0000-000000000002',
      account_number: 'SYSTEM_CASH_CLEARING',
      account_type: 'system_clearing',
      balance_paise: '-100000',
      user_id: null,
      created_at: '2026-01-01T00:00:00.000Z',
    },
  ];

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('1. CreateAccountModal Component', () => {
    it('submits account creation payload and triggers onSuccess on 201 response', async () => {
      const successMock = vi.fn();
      const closeMock = vi.fn();
      const postSpy = vi.spyOn(api, 'post').mockResolvedValue({
        message: 'Account created successfully',
        account: { id: 'acc-new-1', account_number: 'ACC-2026-NEW', balance_paise: '0', user_id: null },
      });

      render(
        <CreateAccountModal isOpen={true} onClose={closeMock} onSuccess={successMock} />
      );

      const input = screen.getByTestId('input-new-account-number');
      fireEvent.change(input, { target: { value: 'ACC-2026-NEW' } });

      fireEvent.click(screen.getByTestId('btn-submit-create-account'));

      await waitFor(() => {
        expect(postSpy).toHaveBeenCalledWith('/api/accounts', { accountNumber: 'ACC-2026-NEW' });
      });

      expect(successMock).toHaveBeenCalledWith(expect.objectContaining({ account_number: 'ACC-2026-NEW' }));
      expect(closeMock).toHaveBeenCalled();
    });

    it('handles duplicate account number HTTP 409 response cleanly', async () => {
      vi.spyOn(api, 'post').mockRejectedValue(
        new ApiError(409, { error: 'ConflictError', message: 'An account with this account number already exists' })
      );

      render(
        <CreateAccountModal isOpen={true} onClose={vi.fn()} onSuccess={vi.fn()} />
      );

      fireEvent.change(screen.getByTestId('input-new-account-number'), { target: { value: 'ACC-DUPLICATE' } });
      fireEvent.click(screen.getByTestId('btn-submit-create-account'));

      await waitFor(() => {
        expect(screen.getByText(/Duplicate Account: An account with this account number already exists/)).toBeInTheDocument();
      });
    });
  });

  describe('2. AssignOwnerModal Component', () => {
    it('submits valid User UUID to POST /api/admin/accounts/:id/owner', async () => {
      const successMock = vi.fn();
      const postSpy = vi.spyOn(api, 'post').mockResolvedValue({
        message: 'Account owner assigned successfully',
        account: { id: 'acc-unassigned-1', user_id: '00000000-0000-0000-0000-000000000099' },
      });

      render(
        <AssignOwnerModal
          isOpen={true}
          account={sampleAccounts[0]}
          onClose={vi.fn()}
          onSuccess={successMock}
        />
      );

      const input = screen.getByTestId('input-assign-user-id');
      fireEvent.change(input, { target: { value: '00000000-0000-0000-0000-000000000099' } });

      fireEvent.click(screen.getByTestId('btn-submit-assign-owner'));

      await waitFor(() => {
        expect(postSpy).toHaveBeenCalledWith(
          '/api/admin/accounts/acc-unassigned-1/owner',
          { userId: '00000000-0000-0000-0000-000000000099' }
        );
      });

      expect(successMock).toHaveBeenCalled();
    });

    it('disables assignment and warns when account is already assigned (immutability)', () => {
      render(
        <AssignOwnerModal
          isOpen={true}
          account={sampleAccounts[1]} // Already assigned
          onClose={vi.fn()}
          onSuccess={vi.fn()}
        />
      );

      expect(screen.getByText(/Already assigned to user/)).toBeInTheDocument();
      expect(screen.getByTestId('input-assign-user-id')).toBeDisabled();
      expect(screen.getByTestId('btn-submit-assign-owner')).toBeDisabled();
    });

    it('handles backend 404 target user not found and 422 invariant errors cleanly', async () => {
      vi.spyOn(api, 'post').mockRejectedValue(
        new ApiError(404, { error: 'NotFoundError', message: 'User not found' })
      );

      render(
        <AssignOwnerModal
          isOpen={true}
          account={sampleAccounts[0]}
          onClose={vi.fn()}
          onSuccess={vi.fn()}
        />
      );

      fireEvent.change(screen.getByTestId('input-assign-user-id'), {
        target: { value: '11111111-2222-3333-4444-555555555555' },
      });
      fireEvent.click(screen.getByTestId('btn-submit-assign-owner'));

      await waitFor(() => {
        expect(screen.getByText('Target User Not Found: The specified User UUID does not exist.')).toBeInTheDocument();
      });
    });

    it('provides searchable customer dropdown defaulting to account_holder users and populates UUID on selection', async () => {
      const successMock = vi.fn();
      const postSpy = vi.spyOn(api, 'post').mockResolvedValue({
        message: 'Account owner assigned successfully',
        account: { id: 'acc-unassigned-1', user_id: sampleUsers[0].id },
      });

      render(
        <AssignOwnerModal
          isOpen={true}
          account={sampleAccounts[0]}
          users={sampleUsers}
          onClose={vi.fn()}
          onSuccess={successMock}
        />
      );

      const dropdown = screen.getByTestId('select-assign-user');
      // Only account_holder users appear by default (alice_customer & carol_inactive)
      expect(dropdown.textContent).toContain('alice_customer');
      expect(dropdown.textContent).toContain('carol_inactive');
      expect(dropdown.textContent).not.toContain('bob_auditor');

      // Search narrows dropdown by username/email
      fireEvent.change(screen.getByTestId('input-assign-user-search'), {
        target: { value: 'alice@example' },
      });
      expect(dropdown.textContent).toContain('alice_customer');
      expect(dropdown.textContent).not.toContain('carol_inactive');

      // Selecting customer fills the manual UUID fallback input and enables submission
      fireEvent.change(dropdown, { target: { value: sampleUsers[0].id } });
      expect(screen.getByTestId('input-assign-user-id')).toHaveValue(sampleUsers[0].id);

      fireEvent.click(screen.getByTestId('btn-submit-assign-owner'));
      await waitFor(() => {
        expect(postSpy).toHaveBeenCalledWith(
          '/api/admin/accounts/acc-unassigned-1/owner',
          { userId: sampleUsers[0].id }
        );
      });
      expect(successMock).toHaveBeenCalled();

      // Toggle include non-customer roles reveals auditor/admin
      fireEvent.change(screen.getByTestId('input-assign-user-search'), { target: { value: '' } });
      fireEvent.click(screen.getByTestId('checkbox-include-all-roles'));
      expect(screen.getByTestId('select-assign-user').textContent).toContain('bob_auditor');
    });
  });

  describe('3. UserGovernanceForm Component (Role & Status)', () => {
    it('requires confirmation modal before executing role change', async () => {
      render(<UserGovernanceForm currentAdminUserId="admin-self-uuid" />);

      fireEvent.change(screen.getByTestId('input-role-user-id'), {
        target: { value: '22222222-2222-2222-2222-222222222222' },
      });
      fireEvent.change(screen.getByTestId('select-target-role'), {
        target: { value: 'auditor' },
      });

      // Click Review -> Modal opens
      fireEvent.click(screen.getByTestId('btn-initiate-role-update'));
      expect(screen.getByText('Confirm User Role Change')).toBeInTheDocument();

      const patchSpy = vi.spyOn(api, 'patch').mockResolvedValue({
        user: { id: '22222222-2222-2222-2222-222222222222', role: 'auditor' },
      });

      // Confirm inside modal
      fireEvent.click(screen.getByTestId('btn-confirm-role-update'));

      await waitFor(() => {
        expect(patchSpy).toHaveBeenCalledWith(
          '/api/admin/users/22222222-2222-2222-2222-222222222222/role',
          { role: 'auditor' }
        );
      });

      expect(screen.getByText(/Successfully updated user 22222222-2222-2222-2222-222222222222 role to auditor/)).toBeInTheDocument();
    });

    it('displays last-active-admin 422 protection error clearly on demotion failure', async () => {
      vi.spyOn(api, 'patch').mockRejectedValue(
        new ApiError(422, {
          error: 'InvariantViolationError',
          message: 'Cannot demote the last active administrator',
        })
      );

      render(<UserGovernanceForm currentAdminUserId="00000000-0000-0000-0000-000000000001" />);

      fireEvent.change(screen.getByTestId('input-role-user-id'), {
        target: { value: '00000000-0000-0000-0000-000000000001' },
      });
      fireEvent.change(screen.getByTestId('select-target-role'), {
        target: { value: 'account_holder' },
      });

      fireEvent.click(screen.getByTestId('btn-initiate-role-update'));
      expect(screen.getByText(/Self-Demotion Warning/)).toBeInTheDocument();

      fireEvent.click(screen.getByTestId('btn-confirm-role-update'));

      await waitFor(() => {
        expect(screen.getByText(/Last-Admin Protection Violation: Cannot demote the last active administrator/)).toBeInTheDocument();
      });
    });

    it('handles status change and last-admin deactivation rejection (422) without optimistic UI update', async () => {
      vi.spyOn(api, 'patch').mockRejectedValue(
        new ApiError(422, {
          error: 'InvariantViolationError',
          message: 'Cannot deactivate the last active administrator',
        })
      );

      render(<UserGovernanceForm currentAdminUserId="00000000-0000-0000-0000-000000000001" />);

      fireEvent.change(screen.getByTestId('input-status-user-id'), {
        target: { value: '00000000-0000-0000-0000-000000000001' },
      });
      fireEvent.change(screen.getByTestId('select-target-status'), {
        target: { value: 'deactivated' },
      });

      fireEvent.click(screen.getByTestId('btn-initiate-status-update'));
      expect(screen.getByText(/Self-Deactivation Warning/)).toBeInTheDocument();

      fireEvent.click(screen.getByTestId('btn-confirm-status-update'));

      await waitFor(() => {
        expect(screen.getByText(/Last-Admin Protection Violation: Cannot deactivate the last active administrator/)).toBeInTheDocument();
      });

      // Success message must NOT be displayed
      expect(screen.queryByText(/Successfully set user.*active status/)).not.toBeInTheDocument();
    });

    it('supports selecting registered users from searchable dropdowns and notifying parent on update', async () => {
      const updatedMock = vi.fn();
      const patchSpy = vi.spyOn(api, 'patch').mockResolvedValue({
        user: { id: sampleUsers[1].id, role: 'account_holder' },
      });

      render(
        <UserGovernanceForm
          currentAdminUserId={sampleUsers[3].id}
          users={sampleUsers}
          onUserUpdated={updatedMock}
        />
      );

      fireEvent.change(screen.getByTestId('input-role-user-search'), {
        target: { value: 'bob.audit' },
      });
      fireEvent.change(screen.getByTestId('select-role-user'), {
        target: { value: sampleUsers[1].id },
      });

      expect(screen.getByTestId('input-role-user-id')).toHaveValue(sampleUsers[1].id);
      expect(screen.getByTestId('select-target-role')).toHaveValue('auditor');

      fireEvent.change(screen.getByTestId('select-target-role'), {
        target: { value: 'account_holder' },
      });
      fireEvent.click(screen.getByTestId('btn-initiate-role-update'));
      fireEvent.click(screen.getByTestId('btn-confirm-role-update'));

      await waitFor(() => {
        expect(patchSpy).toHaveBeenCalledWith(
          `/api/admin/users/${sampleUsers[1].id}/role`,
          { role: 'account_holder' }
        );
      });
      expect(updatedMock).toHaveBeenCalled();
    });
  });

  describe('4. RegisteredUsersTable Component', () => {
    it('renders safe user fields and filters by search, role, and active status', () => {
      const onSelectMock = vi.fn();
      render(
        <RegisteredUsersTable
          users={sampleUsers}
          loading={false}
          error={null}
          onSelectUser={onSelectMock}
        />
      );

      expect(screen.getByText('Registered Users (4)')).toBeInTheDocument();
      expect(screen.getByText('alice_customer')).toBeInTheDocument();
      expect(screen.getByText('bob_auditor')).toBeInTheDocument();

      // Filter by role
      fireEvent.change(screen.getByTestId('select-users-role-filter'), {
        target: { value: 'account_holder' },
      });
      expect(screen.getByText('Registered Users (2 of 4)')).toBeInTheDocument();
      expect(screen.queryByText('bob_auditor')).not.toBeInTheDocument();

      // Filter by status
      fireEvent.change(screen.getByTestId('select-users-status-filter'), {
        target: { value: 'inactive' },
      });
      expect(screen.getByText('Registered Users (1 of 4)')).toBeInTheDocument();
      expect(screen.getByText('carol_inactive')).toBeInTheDocument();
      expect(screen.queryByText('alice_customer')).not.toBeInTheDocument();

      // Reset filters
      fireEvent.click(screen.getByTestId('btn-reset-users-filters'));
      expect(screen.getByText('Registered Users (4)')).toBeInTheDocument();

      // Search by email
      fireEvent.change(screen.getByTestId('input-users-search'), {
        target: { value: 'bob.audit@example.com' },
      });
      expect(screen.getByText('Registered Users (1 of 4)')).toBeInTheDocument();
      expect(screen.getByText('bob_auditor')).toBeInTheDocument();

      // Clicking Manage forwards selected user
      fireEvent.click(screen.getByTestId(`btn-select-user-${sampleUsers[1].id}`));
      expect(onSelectMock).toHaveBeenCalledWith(sampleUsers[1]);
    });
  });

  describe('5. AdminPortalPage Integration', () => {
    it('fetches accounts and registered users and links directory selection to governance controls', async () => {
      vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
        user: { id: sampleUsers[3].id, username: 'admin_root', role: 'admin' },
        role: 'admin',
        isAuthenticated: true,
      });

      const getSpy = vi.spyOn(api, 'get').mockImplementation((path) => {
        if (path === '/api/admin/users') {
          return Promise.resolve({ users: sampleUsers });
        }
        return Promise.resolve({ accounts: sampleAccounts });
      });

      render(
        <MemoryRouter initialEntries={['/admin']}>
          <Routes>
            <Route path="/admin" element={<AdminPortalPage />} />
          </Routes>
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText('Administrative Portal')).toBeInTheDocument();
      });

      expect(getSpy).toHaveBeenCalledWith('/api/accounts');
      expect(getSpy).toHaveBeenCalledWith('/api/admin/users');
      expect(screen.getByText(/Unassigned Customer Accounts \(1\)/)).toBeInTheDocument();
      expect(screen.getAllByText('ACC-NEW-001').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByTestId('btn-assign-acc-unassigned-1')).toBeInTheDocument();

      // Switch to Registered Users & Governance tab
      fireEvent.click(screen.getByTestId('admin-tab-users'));
      expect(screen.getByText('Registered Users (4)')).toBeInTheDocument();
      expect(screen.getByText('User Role Assignment')).toBeInTheDocument();
      expect(screen.getByText('User Account Activation & Deactivation')).toBeInTheDocument();

      // Click Manage on alice_customer -> pre-fills governance inputs
      fireEvent.click(screen.getByTestId(`btn-select-user-${sampleUsers[0].id}`));
      expect(screen.getByTestId('input-role-user-id')).toHaveValue(sampleUsers[0].id);
      expect(screen.getByTestId('input-status-user-id')).toHaveValue(sampleUsers[0].id);
    });
  });
});
