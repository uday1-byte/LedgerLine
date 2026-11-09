import React, { useState } from 'react';
import { Link, useNavigate, Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api, ApiError } from '../api/client';
import { Alert } from '../components/common/Alert';

export function RegisterPage() {
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();

  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});

  // If already authenticated, redirect to home/dashboard
  if (isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  const validateForm = () => {
    const errors = {};
    const trimmedUsername = username.trim();
    const trimmedEmail = email.trim().toLowerCase();

    // 1. Username validation (consistent with backend Zod schema)
    if (!trimmedUsername) {
      errors.username = 'Username is required';
    } else if (trimmedUsername.length < 3) {
      errors.username = 'Username must be at least 3 characters long';
    } else if (trimmedUsername.length > 64) {
      errors.username = 'Username must not exceed 64 characters';
    } else if (!/^[a-zA-Z0-9_-]+$/.test(trimmedUsername)) {
      errors.username = 'Username can only contain alphanumeric characters, underscores, and hyphens';
    }

    // 2. Email validation
    if (!trimmedEmail) {
      errors.email = 'Email is required';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      errors.email = 'Invalid email address format';
    } else if (trimmedEmail.length > 255) {
      errors.email = 'Email must not exceed 255 characters';
    }

    // 3. Password validation (consistent with backend validatePasswordStrength)
    if (!password) {
      errors.password = 'Password is required';
    } else if (password.length < 8) {
      errors.password = 'Password must be at least 8 characters long';
    } else {
      const hasLetter = /[a-zA-Z]/.test(password);
      const hasNumber = /[0-9]/.test(password);
      if (!hasLetter || !hasNumber) {
        errors.password = 'Password must contain at least one letter and one number';
      }
    }

    // 4. Confirm password validation
    if (!confirmPassword) {
      errors.confirmPassword = 'Confirming your password is required';
    } else if (password !== confirmPassword) {
      errors.confirmPassword = 'Passwords do not match';
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    if (!validateForm()) {
      return;
    }

    // Capture password for request payload, then immediately zero out state
    const submittedPassword = password;
    setPassword('');
    setConfirmPassword('');

    setLoading(true);

    try {
      const payload = {
        username: username.trim(),
        email: email.trim().toLowerCase(),
        password: submittedPassword,
      };

      const response = await api.post('/api/auth/register', payload);

      if (response && response.user) {
        // Successful registration: navigate to login with success alert
        navigate('/login', {
          state: {
            message: 'Registration successful! Please sign in with your new credentials.',
          },
          replace: true,
        });
      } else {
        throw new Error('Registration failed. Please try again.');
      }
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message || 'Registration failed. Please verify your details.');
      } else {
        setError(err.message || 'An unexpected error occurred. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      maxWidth: '480px',
      margin: '2.5rem auto',
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
          <span style={{ fontSize: '2.5rem' }} role="img" aria-label="user registration">📝</span>
          <h1 style={{
            fontSize: '1.5rem',
            fontWeight: '700',
            color: '#0f172a',
            marginTop: '0.5rem',
            letterSpacing: '-0.02em',
          }}>
            Open Your Account
          </h1>
          <p style={{ color: '#64748b', fontSize: '0.875rem', marginTop: '0.25rem' }}>
            Register to start banking with LedgerLine
          </p>
        </div>

        {error && (
          <Alert type="error" message={error} onClose={() => setError(null)} />
        )}

        <form onSubmit={handleSubmit} noValidate>
          {/* Username */}
          <div style={{ marginBottom: '1.25rem' }}>
            <label
              htmlFor="reg-username"
              style={{
                display: 'block',
                fontSize: '0.875rem',
                fontWeight: '600',
                color: '#334155',
                marginBottom: '0.375rem',
              }}
            >
              Username
            </label>
            <input
              id="reg-username"
              type="text"
              autoComplete="username"
              required
              disabled={loading}
              value={username}
              onChange={(e) => {
                setUsername(e.target.value);
                if (fieldErrors.username) setFieldErrors({ ...fieldErrors, username: null });
              }}
              placeholder="e.g. raj_sharma"
              style={{
                width: '100%',
                padding: '0.625rem 0.875rem',
                fontSize: '0.925rem',
                borderRadius: '0.375rem',
                border: `1px solid ${fieldErrors.username ? '#ef4444' : '#cbd5e1'}`,
                backgroundColor: loading ? '#f8fafc' : '#ffffff',
                color: '#0f172a',
                outline: 'none',
              }}
            />
            {fieldErrors.username && (
              <p style={{ color: '#dc2626', fontSize: '0.8rem', marginTop: '0.25rem' }}>
                {fieldErrors.username}
              </p>
            )}
            <p style={{ color: '#94a3b8', fontSize: '0.75rem', marginTop: '0.25rem' }}>
              3–64 characters. Letters, numbers, hyphens, and underscores only.
            </p>
          </div>

          {/* Email */}
          <div style={{ marginBottom: '1.25rem' }}>
            <label
              htmlFor="reg-email"
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
              id="reg-email"
              type="email"
              autoComplete="email"
              required
              disabled={loading}
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (fieldErrors.email) setFieldErrors({ ...fieldErrors, email: null });
              }}
              placeholder="e.g. raj@example.com"
              style={{
                width: '100%',
                padding: '0.625rem 0.875rem',
                fontSize: '0.925rem',
                borderRadius: '0.375rem',
                border: `1px solid ${fieldErrors.email ? '#ef4444' : '#cbd5e1'}`,
                backgroundColor: loading ? '#f8fafc' : '#ffffff',
                color: '#0f172a',
                outline: 'none',
              }}
            />
            {fieldErrors.email && (
              <p style={{ color: '#dc2626', fontSize: '0.8rem', marginTop: '0.25rem' }}>
                {fieldErrors.email}
              </p>
            )}
          </div>

          {/* Password with show/hide control */}
          <div style={{ marginBottom: '1.25rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.375rem' }}>
              <label
                htmlFor="reg-password"
                style={{
                  fontSize: '0.875rem',
                  fontWeight: '600',
                  color: '#334155',
                }}
              >
                Password
              </label>
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? 'Hide passwords' : 'Show passwords'}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: '0.8rem',
                  color: '#0284c7',
                  cursor: 'pointer',
                  padding: 0,
                  fontWeight: '500',
                }}
              >
                {showPassword ? 'Hide password' : 'Show password'}
              </button>
            </div>
            <div style={{ position: 'relative' }}>
              <input
                id="reg-password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                required
                disabled={loading}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (fieldErrors.password) setFieldErrors({ ...fieldErrors, password: null });
                }}
                placeholder="At least 8 characters with letter & number"
                style={{
                  width: '100%',
                  padding: '0.625rem 0.875rem',
                  fontSize: '0.925rem',
                  borderRadius: '0.375rem',
                  border: `1px solid ${fieldErrors.password ? '#ef4444' : '#cbd5e1'}`,
                  backgroundColor: loading ? '#f8fafc' : '#ffffff',
                  color: '#0f172a',
                  outline: 'none',
                }}
              />
            </div>
            {fieldErrors.password && (
              <p style={{ color: '#dc2626', fontSize: '0.8rem', marginTop: '0.25rem' }}>
                {fieldErrors.password}
              </p>
            )}
            <p style={{ color: '#94a3b8', fontSize: '0.75rem', marginTop: '0.25rem' }}>
              Minimum 8 characters. Must contain at least one letter and one number.
            </p>
          </div>

          {/* Confirm Password */}
          <div style={{ marginBottom: '1.75rem' }}>
            <label
              htmlFor="reg-confirm-password"
              style={{
                display: 'block',
                fontSize: '0.875rem',
                fontWeight: '600',
                color: '#334155',
                marginBottom: '0.375rem',
              }}
            >
              Confirm Password
            </label>
            <input
              id="reg-confirm-password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              required
              disabled={loading}
              value={confirmPassword}
              onChange={(e) => {
                setConfirmPassword(e.target.value);
                if (fieldErrors.confirmPassword) setFieldErrors({ ...fieldErrors, confirmPassword: null });
              }}
              placeholder="Re-enter your password"
              style={{
                width: '100%',
                padding: '0.625rem 0.875rem',
                fontSize: '0.925rem',
                borderRadius: '0.375rem',
                border: `1px solid ${fieldErrors.confirmPassword ? '#ef4444' : '#cbd5e1'}`,
                backgroundColor: loading ? '#f8fafc' : '#ffffff',
                color: '#0f172a',
                outline: 'none',
              }}
            />
            {fieldErrors.confirmPassword && (
              <p style={{ color: '#dc2626', fontSize: '0.8rem', marginTop: '0.25rem' }}>
                {fieldErrors.confirmPassword}
              </p>
            )}
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
                Creating Account...
              </>
            ) : (
              'Create Account'
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
          Already registered with LedgerLine?{' '}
          <Link
            to="/login"
            style={{
              color: '#0284c7',
              fontWeight: '600',
              textDecoration: 'none',
            }}
          >
            Sign in
          </Link>
        </div>
      </div>
    </div>
  );
}

