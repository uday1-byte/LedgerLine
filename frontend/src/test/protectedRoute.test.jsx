import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { ProtectedRoute } from '../components/common/ProtectedRoute';
import * as AuthContextModule from '../context/AuthContext';

function renderWithRouter(ui, initialRoute = '/protected') {
  return render(
    <MemoryRouter initialEntries={[initialRoute]}>
      <Routes>
        <Route path="/login" element={<div>Login Page Mock</div>} />
        <Route path="/protected" element={ui} />
      </Routes>
    </MemoryRouter>
  );
}

describe('ProtectedRoute Component', () => {
  it('renders loading indicator while authentication session is loading', () => {
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
      user: null,
      isAuthenticated: false,
      loading: true,
      role: null,
    });

    renderWithRouter(
      <ProtectedRoute>
        <div>Secret Content</div>
      </ProtectedRoute>
    );

    expect(screen.getByText(/Verifying authentication session/i)).toBeInTheDocument();
    expect(screen.queryByText('Secret Content')).not.toBeInTheDocument();
  });

  it('redirects unauthenticated users to /login', () => {
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
      user: null,
      isAuthenticated: false,
      loading: false,
      role: null,
    });

    renderWithRouter(
      <ProtectedRoute>
        <div>Secret Content</div>
      </ProtectedRoute>
    );

    expect(screen.getByText('Login Page Mock')).toBeInTheDocument();
    expect(screen.queryByText('Secret Content')).not.toBeInTheDocument();
  });

  it('renders protected content when user is authenticated and no role restriction is specified', () => {
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
      user: { id: 'u1', username: 'carol', role: 'account_holder' },
      isAuthenticated: true,
      loading: false,
      role: 'account_holder',
    });

    renderWithRouter(
      <ProtectedRoute>
        <div>Account Holder Protected Dashboard</div>
      </ProtectedRoute>
    );

    expect(screen.getByText('Account Holder Protected Dashboard')).toBeInTheDocument();
  });

  it('renders protected content when user has a role included in allowedRoles', () => {
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
      user: { id: 'adm-1', username: 'superadmin', role: 'admin' },
      isAuthenticated: true,
      loading: false,
      role: 'admin',
    });

    renderWithRouter(
      <ProtectedRoute allowedRoles={['admin']}>
        <div>Admin Management Center</div>
      </ProtectedRoute>
    );

    expect(screen.getByText('Admin Management Center')).toBeInTheDocument();
  });

  it('blocks access and displays Access Denied when user role is not permitted', () => {
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
      user: { id: 'u1', username: 'dave', role: 'account_holder' },
      isAuthenticated: true,
      loading: false,
      role: 'account_holder',
    });

    renderWithRouter(
      <ProtectedRoute allowedRoles={['admin']}>
        <div>Admin Management Center</div>
      </ProtectedRoute>
    );

    expect(screen.getByText('Access Denied')).toBeInTheDocument();
    expect(screen.getByText(/Your account role/i)).toBeInTheDocument();
    expect(screen.getByText('account_holder')).toBeInTheDocument();
    expect(screen.queryByText('Admin Management Center')).not.toBeInTheDocument();
  });
});
