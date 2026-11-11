import React, { useState } from 'react';
import { Link, useNavigate, useLocation, Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api, ApiError } from '../api/client';
import { Alert } from '../components/common/Alert';

export function LoginPage() {
  const { login, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // If redirected from successful registration, display friendly success alert
  const [successMessage, setSuccessMessage] = useState(() => location.state?.message || null);

  // Destination to return after successful login
  const from = location.state?.from?.pathname || '/';

  // If already authenticated, redirect away from login page
  if (isAuthenticated) {
    return <Navigate to={from} replace />;
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSuccessMessage(null);

    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail) {
      setError('Email address is required');
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setError('Please enter a valid email address (e.g. user@example.com)');
      return;
    }

    if (!password) {
      setError('Password is required');
      return;
    }

    // Capture password locally and clear input state immediately to avoid lingering plaintext in React state
    const submittedPassword = password;
    setPassword('');

    setLoading(true);

    try {
      const response = await api.post('/api/auth/login', {
        email: trimmedEmail,
        password: submittedPassword,
      });

      if (response && response.token && response.user) {
        login(response.token, response.user);
        navigate(from, { replace: true });
      } else {
        throw new Error('Invalid authentication response from server');
      }
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message || 'Login failed. Please check your credentials.');
      } else {
        setError(err.message || 'An unexpected error occurred. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      maxWidth: '440px',
      margin: '3rem auto',
      padding: '0 1rem',
    }}>
      <div style={{
        backgroundColor: '#ffffff',
        borderRadius: '0.75rem',
        padding: '2.25rem',
        border: '1px solid #e2e8f0',
        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -2px rgba(0, 0, 0, 0.05)',
      }}>
        <div style={{ textAlign: 'center', marginBottom: '1.75rem' }}>
          <span style={{ fontSize: '2.5rem' }} role="img" aria-label="padlock">🔐</span>
          <h1 style={{
            fontSize: '1.5rem',
            fontWeight: '700',
            color: '#0f172a',
            marginTop: '0.5rem',
            letterSpacing: '-0.02em',
          }}>
            Sign In to LedgerLine
          </h1>
          <p style={{ color: '#64748b', fontSize: '0.875rem', marginTop: '0.25rem' }}>
            Enter your credentials to access your banking account
          </p>
        </div>

        {successMessage && !error && (
          <Alert
            type="success"
            message={successMessage}
            onClose={() => setSuccessMessage(null)}
          />
        )}

        {error && (
          <Alert type="error" message={error} onClose={() => setError(null)} />
        )}

        <form onSubmit={handleSubmit} noValidate>
          {/* Email input */}
          <div style={{ marginBottom: '1.25rem' }}>
            <label
              htmlFor="login-email"
              style={{
                display: 'block',
                fontSize: '0.875rem',
                fontWeight: '600',
                color: '#334155',
                marginBottom: '0.375rem',
              }}
            >
              Email Address
            </label>
            <input
              id="login-email"
              type="email"
              autoComplete="email"
              required
              disabled={loading}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="e.g. user@example.com"
              style={{
                width: '100%',
                padding: '0.625rem 0.875rem',
                fontSize: '0.925rem',
                borderRadius: '0.375rem',
                border: '1px solid #cbd5e1',
                backgroundColor: loading ? '#f8fafc' : '#ffffff',
                color: '#0f172a',
                outline: 'none',
                transition: 'border-color 0.15s ease',
              }}
              onFocus={(e) => (e.target.style.borderColor = '#0284c7')}
              onBlur={(e) => (e.target.style.borderColor = '#cbd5e1')}
            />
          </div>

          {/* Password input with show/hide control */}
          <div style={{ marginBottom: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.375rem' }}>
              <label
                htmlFor="login-password"
                style={{
                  fontSize: '0.875rem',
                  fontWeight: '600',
                  color: '#334155',
                }}
              >
                Password
              </label>
            </div>
            <div style={{ position: 'relative' }}>
              <input
                id="login-password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                required
                disabled={loading}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your account password"
                style={{
                  width: '100%',
                  padding: '0.625rem 2.75rem 0.625rem 0.875rem',
                  fontSize: '0.925rem',
                  borderRadius: '0.375rem',
                  border: '1px solid #cbd5e1',
                  backgroundColor: loading ? '#f8fafc' : '#ffffff',
                  color: '#0f172a',
                  outline: 'none',
                  transition: 'border-color 0.15s ease',
                }}
                onFocus={(e) => (e.target.style.borderColor = '#0284c7')}
                onBlur={(e) => (e.target.style.borderColor = '#cbd5e1')}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                disabled={loading}
                style={{
                  position: 'absolute',
                  right: '0.5rem',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  padding: '0.25rem 0.5rem',
                  fontSize: '1.1rem',
                  cursor: 'pointer',
                  color: '#64748b',
                  lineHeight: 1,
                }}
              >
                {showPassword ? '👁️' : '👁️‍🗨️'}
              </button>
            </div>
          </div>

          {/* Submit button */}
          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%',
              padding: '0.75rem 1rem',
              fontSize: '0.95rem',
              fontWeight: '600',
              borderRadius: '0.375rem',
              backgroundColor: loading ? '#93c5fd' : '#0284c7',
              color: '#ffffff',
              border: 'none',
              cursor: loading ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.5rem',
              transition: 'background-color 0.15s ease',
            }}
            onMouseEnter={(e) => {
              if (!loading) e.currentTarget.style.backgroundColor = '#0369a1';
            }}
            onMouseLeave={(e) => {
              if (!loading) e.currentTarget.style.backgroundColor = '#0284c7';
            }}
          >
            {loading ? (
              <>
                <span
                  style={{
                    width: '1rem',
                    height: '1rem',
                    border: '2px solid #ffffff',
                    borderTopColor: 'transparent',
                    borderRadius: '50%',
                    animation: 'spin 0.8s linear infinite',
                    display: 'inline-block',
                  }}
                />
                Signing in...
              </>
            ) : (
              'Sign In'
            )}
          </button>
        </form>

        <div style={{
          marginTop: '1.75rem',
          paddingTop: '1.25rem',
          borderTop: '1px solid #f1f5f9',
          textAlign: 'center',
          fontSize: '0.875rem',
          color: '#64748b',
        }}>
          Don't have an account yet?{' '}
          <Link
            to="/register"
            style={{
              color: '#0284c7',
              fontWeight: '600',
              textDecoration: 'none',
            }}
          >
            Create an account
          </Link>
        </div>
      </div>
    </div>
  );
}

