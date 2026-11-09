import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

/**
 * ProtectedRoute Component
 * 
 * Security Architecture Notice:
 * - This route guard provides CLIENT-SIDE NAVIGATION FLOW AND UX PROTECTION ONLY.
 * - Frontend route guards are NOT authoritative security boundaries.
 * - The backend Express API and PostgreSQL RBAC triggers unconditionally enforce authentication,
 *   role checks, and ownership constraints on every single API request.
 * 
 * @param {object} props
 * @param {React.ReactNode} props.children
 * @param {string[]} [props.allowedRoles] - Optional list of permitted roles: ['admin', 'account_holder', 'auditor']
 */
export function ProtectedRoute({ children, allowedRoles }) {
  const { user, isAuthenticated, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '50vh',
        gap: '1rem',
        color: '#64748b'
      }}>
        <div style={{
          width: '2.5rem',
          height: '2.5rem',
          border: '3px solid #e2e8f0',
          borderTopColor: '#0284c7',
          borderRadius: '50%',
          animation: 'spin 1s linear infinite'
        }} />
        <p style={{ fontSize: '0.95rem' }}>Verifying authentication session...</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    // Redirect unauthenticated visitors to login, preserving intended destination in location state
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (allowedRoles && allowedRoles.length > 0) {
    const userRole = user?.role;
    if (!userRole || !allowedRoles.includes(userRole)) {
      return (
        <div style={{
          maxWidth: '600px',
          margin: '3rem auto',
          padding: '2rem',
          backgroundColor: '#fff',
          borderRadius: '0.75rem',
          border: '1px solid #fee2e2',
          boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
          textAlign: 'center'
        }}>
          <span style={{ fontSize: '3rem' }}>🚫</span>
          <h2 style={{ fontSize: '1.5rem', color: '#991b1b', marginTop: '1rem', marginBottom: '0.5rem' }}>
            Access Denied
          </h2>
          <p style={{ color: '#475569', fontSize: '0.95rem', marginBottom: '1.5rem' }}>
            Your account role (<strong>{userRole || 'unknown'}</strong>) does not have permission to view this section.
          </p>
          <a
            href="/"
            style={{
              display: 'inline-block',
              backgroundColor: '#0284c7',
              color: '#ffffff',
              padding: '0.5rem 1.25rem',
              borderRadius: '0.375rem',
              textDecoration: 'none',
              fontWeight: '500',
              fontSize: '0.9rem'
            }}
          >
            Return to Dashboard
          </a>
        </div>
      );
    }
  }

  return children;
}

