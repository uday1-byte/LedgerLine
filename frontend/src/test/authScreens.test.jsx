import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { LoginPage } from '../pages/LoginPage';
import { RegisterPage } from '../pages/RegisterPage';
import { Alert } from '../components/common/Alert';
import * as AuthContextModule from '../context/AuthContext';
import { api, ApiError } from '../api/client';

describe('Shared Alert Component', () => {
  it('renders alert message with role="alert"', () => {
    render(<Alert type="error" message="An unexpected error occurred" />);
    const alertEl = screen.getByRole('alert');
    expect(alertEl).toBeInTheDocument();
    expect(alertEl).toHaveTextContent('An unexpected error occurred');
  });

  it('renders children content when provided', () => {
    render(
      <Alert type="success">
        <span>Account updated successfully</span>
      </Alert>
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Account updated successfully');
  });

  it('renders dismiss button and triggers onClose when clicked', () => {
    const handleClose = vi.fn();
    render(<Alert type="warning" message="Session expiring soon" onClose={handleClose} />);
    const dismissBtn = screen.getByLabelText('Dismiss message');
    expect(dismissBtn).toBeInTheDocument();
    fireEvent.click(dismissBtn);
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it('returns null when neither message nor children are provided', () => {
    const { container } = render(<Alert type="info" />);
    expect(container.firstChild).toBeNull();
  });
});

describe('LoginPage Component', () => {
  let mockLogin;

  beforeEach(() => {
    mockLogin = vi.fn();
    vi.restoreAllMocks();
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
      user: null,
      token: null,
      role: null,
      isAuthenticated: false,
      loading: false,
      login: mockLogin,
      logout: vi.fn(),
      refreshUser: vi.fn(),
    });
  });

  const renderLoginPage = (initialState = {}) => {
    return render(
      <MemoryRouter initialEntries={[{ pathname: '/login', state: initialState }]}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<div>Dashboard Destination</div>} />
          <Route path="/transfers" element={<div>Transfers Destination</div>} />
        </Routes>
      </MemoryRouter>
    );
  };

  it('renders email and password inputs, submit button, and toggle control', () => {
    renderLoginPage();

    expect(screen.getByLabelText(/Email Address/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Password/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Sign In/i })).toBeInTheDocument();
    expect(screen.getByLabelText('Show password')).toBeInTheDocument();
  });

  it('toggles password visibility between password and text', () => {
    renderLoginPage();
    const passwordInput = screen.getByLabelText(/^Password/i);
    const toggleBtn = screen.getByLabelText('Show password');

    expect(passwordInput).toHaveAttribute('type', 'password');

    fireEvent.click(toggleBtn);
    expect(passwordInput).toHaveAttribute('type', 'text');
    expect(screen.getByLabelText('Hide password')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Hide password'));
    expect(passwordInput).toHaveAttribute('type', 'password');
  });

  it('displays validation error if submitted with empty fields', async () => {
    renderLoginPage();
    const submitBtn = screen.getByRole('button', { name: /Sign In/i });

    fireEvent.click(submitBtn);

    expect(screen.getByRole('alert')).toHaveTextContent(/Email address is required/i);
  });

  it('displays validation error if email is entered but password is missing', async () => {
    renderLoginPage();
    const emailInput = screen.getByLabelText(/Email Address/i);
    const submitBtn = screen.getByRole('button', { name: /Sign In/i });

    fireEvent.change(emailInput, { target: { value: 'user@example.com' } });
    fireEvent.click(submitBtn);

    expect(screen.getByRole('alert')).toHaveTextContent(/Password is required/i);
  });

  it('executes successful login, clears password, calls AuthContext login, and redirects', async () => {
    const postSpy = vi.spyOn(api, 'post').mockResolvedValue({
      message: 'Login successful',
      token: 'jwt-auth-token-xyz',
      user: {
        id: 'user-001',
        username: 'alice_holder',
        email: 'alice@example.com',
        role: 'account_holder',
        is_active: true,
      },
    });

    renderLoginPage({ from: { pathname: '/transfers' } });

    const emailInput = screen.getByLabelText(/Email Address/i);
    const passwordInput = screen.getByLabelText(/^Password/i);
    const submitBtn = screen.getByRole('button', { name: /Sign In/i });

    fireEvent.change(emailInput, { target: { value: 'alice@example.com' } });
    fireEvent.change(passwordInput, { target: { value: 'SecurePass123' } });

    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(postSpy).toHaveBeenCalledWith('/api/auth/login', {
        email: 'alice@example.com',
        password: 'SecurePass123',
      });
    });

    expect(mockLogin).toHaveBeenCalledWith('jwt-auth-token-xyz', {
      id: 'user-001',
      username: 'alice_holder',
      email: 'alice@example.com',
      role: 'account_holder',
      is_active: true,
    });

    // Password must be cleared from the input field
    expect(passwordInput.value).toBe('');

    // Must have navigated to intended destination
    await waitFor(() => {
      expect(screen.getByText('Transfers Destination')).toBeInTheDocument();
    });
  });

  it('displays error alert on 401 Unauthorized (invalid credentials) and clears password', async () => {
    vi.spyOn(api, 'post').mockRejectedValue(
      new ApiError(401, { error: 'Unauthorized', message: 'Invalid email or password' }, 'Invalid email or password')
    );

    renderLoginPage();

    const emailInput = screen.getByLabelText(/Email Address/i);
    const passwordInput = screen.getByLabelText(/^Password/i);
    const submitBtn = screen.getByRole('button', { name: /Sign In/i });

    fireEvent.change(emailInput, { target: { value: 'wrong@example.com' } });
    fireEvent.change(passwordInput, { target: { value: 'WrongPassword99' } });

    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Invalid email or password');
    });

    // Email remains for easy correction, password cleared for security
    expect(emailInput.value).toBe('wrong@example.com');
    expect(passwordInput.value).toBe('');
    expect(mockLogin).not.toHaveBeenCalled();
  });

  it('displays error alert on 403 Forbidden (deactivated user)', async () => {
    vi.spyOn(api, 'post').mockRejectedValue(
      new ApiError(403, { error: 'Forbidden', message: 'User account is deactivated' }, 'User account is deactivated')
    );

    renderLoginPage();

    const emailInput = screen.getByLabelText(/Email Address/i);
    const passwordInput = screen.getByLabelText(/^Password/i);
    const submitBtn = screen.getByRole('button', { name: /Sign In/i });

    fireEvent.change(emailInput, { target: { value: 'disabled@example.com' } });
    fireEvent.change(passwordInput, { target: { value: 'ValidPass123' } });

    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('User account is deactivated');
    });
    expect(passwordInput.value).toBe('');
  });

  it('displays success alert when redirected from registration with location state message', () => {
    renderLoginPage({ message: 'Registration successful! Please sign in with your new credentials.' });

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Registration successful! Please sign in with your new credentials.'
    );
  });

  it('redirects to dashboard immediately if user is already authenticated', () => {
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
      user: { id: 'u1', username: 'bob', role: 'admin' },
      token: 'jwt-valid',
      role: 'admin',
      isAuthenticated: true,
      loading: false,
      login: mockLogin,
      logout: vi.fn(),
      refreshUser: vi.fn(),
    });

    renderLoginPage();

    expect(screen.getByText('Dashboard Destination')).toBeInTheDocument();
    expect(screen.queryByLabelText(/Email Address/i)).not.toBeInTheDocument();
  });
});

describe('RegisterPage Component', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
      user: null,
      token: null,
      role: null,
      isAuthenticated: false,
      loading: false,
      login: vi.fn(),
      logout: vi.fn(),
      refreshUser: vi.fn(),
    });
  });

  const renderRegisterPage = () => {
    return render(
      <MemoryRouter initialEntries={['/register']}>
        <Routes>
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/login" element={<div>Login Page Destination</div>} />
        </Routes>
      </MemoryRouter>
    );
  };

  it('renders all registration fields, show/hide control, and submit button', () => {
    renderRegisterPage();

    expect(screen.getByLabelText(/Username/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Email Address/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Password/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Confirm Password/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Create Account/i })).toBeInTheDocument();
  });

  it('validates client-side constraints without making API call', async () => {
    const postSpy = vi.spyOn(api, 'post');
    renderRegisterPage();

    const submitBtn = screen.getByRole('button', { name: /Create Account/i });
    fireEvent.click(submitBtn);

    // Client-side errors should show for required fields
    expect(screen.getByText('Username is required')).toBeInTheDocument();
    expect(screen.getByText('Email is required')).toBeInTheDocument();
    expect(screen.getByText('Password is required')).toBeInTheDocument();
    expect(screen.getByText('Confirming your password is required')).toBeInTheDocument();
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('rejects short usernames and invalid characters', async () => {
    const postSpy = vi.spyOn(api, 'post');
    renderRegisterPage();

    const usernameInput = screen.getByLabelText(/Username/i);
    const submitBtn = screen.getByRole('button', { name: /Create Account/i });

    // Too short
    fireEvent.change(usernameInput, { target: { value: 'ab' } });
    fireEvent.click(submitBtn);
    expect(screen.getByText('Username must be at least 3 characters long')).toBeInTheDocument();

    // Invalid character
    fireEvent.change(usernameInput, { target: { value: 'invalid user!' } });
    fireEvent.click(submitBtn);
    expect(
      screen.getByText('Username can only contain alphanumeric characters, underscores, and hyphens')
    ).toBeInTheDocument();

    expect(postSpy).not.toHaveBeenCalled();
  });

  it('rejects passwords under 8 characters or missing letters/numbers', async () => {
    const postSpy = vi.spyOn(api, 'post');
    renderRegisterPage();

    const passwordInput = screen.getByLabelText(/^Password/i);
    const submitBtn = screen.getByRole('button', { name: /Create Account/i });

    // Under 8 characters
    fireEvent.change(passwordInput, { target: { value: 'Pass1' } });
    fireEvent.click(submitBtn);
    expect(screen.getByText('Password must be at least 8 characters long')).toBeInTheDocument();

    // 8+ chars but only letters
    fireEvent.change(passwordInput, { target: { value: 'OnlyLettersPassword' } });
    fireEvent.click(submitBtn);
    expect(
      screen.getByText('Password must contain at least one letter and one number')
    ).toBeInTheDocument();

    expect(postSpy).not.toHaveBeenCalled();
  });

  it('rejects mismatched password and confirm-password', async () => {
    const postSpy = vi.spyOn(api, 'post');
    renderRegisterPage();

    const passwordInput = screen.getByLabelText(/^Password/i);
    const confirmInput = screen.getByLabelText(/Confirm Password/i);
    const submitBtn = screen.getByRole('button', { name: /Create Account/i });

    fireEvent.change(passwordInput, { target: { value: 'ValidPass123' } });
    fireEvent.change(confirmInput, { target: { value: 'DifferentPass456' } });
    fireEvent.click(submitBtn);

    expect(screen.getByText('Passwords do not match')).toBeInTheDocument();
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('executes successful registration, clears password fields, and redirects to /login', async () => {
    const postSpy = vi.spyOn(api, 'post').mockResolvedValue({
      message: 'User registered successfully',
      user: {
        id: 'new-user-123',
        username: 'charlie_chaplin',
        email: 'charlie@example.com',
        role: 'account_holder',
        is_active: true,
      },
    });

    renderRegisterPage();

    const usernameInput = screen.getByLabelText(/Username/i);
    const emailInput = screen.getByLabelText(/Email Address/i);
    const passwordInput = screen.getByLabelText(/^Password/i);
    const confirmInput = screen.getByLabelText(/Confirm Password/i);
    const submitBtn = screen.getByRole('button', { name: /Create Account/i });

    fireEvent.change(usernameInput, { target: { value: 'charlie_chaplin' } });
    fireEvent.change(emailInput, { target: { value: 'charlie@example.com' } });
    fireEvent.change(passwordInput, { target: { value: 'ValidPassword123' } });
    fireEvent.change(confirmInput, { target: { value: 'ValidPassword123' } });

    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(postSpy).toHaveBeenCalledWith('/api/auth/register', {
        username: 'charlie_chaplin',
        email: 'charlie@example.com',
        password: 'ValidPassword123',
      });
    });

    // Passwords must be cleared immediately
    expect(passwordInput.value).toBe('');
    expect(confirmInput.value).toBe('');

    // Must navigate to login page destination
    await waitFor(() => {
      expect(screen.getByText('Login Page Destination')).toBeInTheDocument();
    });
  });

  it('handles 409 Conflict error for taken username/email and clears password', async () => {
    vi.spyOn(api, 'post').mockRejectedValue(
      new ApiError(409, { error: 'ConflictError', message: 'Username is already taken' }, 'Username is already taken')
    );

    renderRegisterPage();

    const usernameInput = screen.getByLabelText(/Username/i);
    const emailInput = screen.getByLabelText(/Email Address/i);
    const passwordInput = screen.getByLabelText(/^Password/i);
    const confirmInput = screen.getByLabelText(/Confirm Password/i);
    const submitBtn = screen.getByRole('button', { name: /Create Account/i });

    fireEvent.change(usernameInput, { target: { value: 'existing_user' } });
    fireEvent.change(emailInput, { target: { value: 'existing@example.com' } });
    fireEvent.change(passwordInput, { target: { value: 'ValidPassword123' } });
    fireEvent.change(confirmInput, { target: { value: 'ValidPassword123' } });

    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Username is already taken');
    });

    expect(usernameInput.value).toBe('existing_user');
    expect(emailInput.value).toBe('existing@example.com');
    expect(passwordInput.value).toBe('');
    expect(confirmInput.value).toBe('');
  });
});

