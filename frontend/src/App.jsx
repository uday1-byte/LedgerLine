import React from 'react';
import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { Navbar } from './components/layout/Navbar';
import { ProtectedRoute } from './components/common/ProtectedRoute';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { DashboardPage } from './pages/DashboardPage';
import { TransfersPage } from './pages/TransfersPage';
import { StatementsPage } from './pages/StatementsPage';
import { AdminPortalPage } from './pages/AdminPortalPage';
import { AuditorPortalPage } from './pages/AuditorPortalPage';

function HomePage() {
  const { user, isAuthenticated, role } = useAuth();

  if (isAuthenticated) {
    return <DashboardPage />;
  }

  return (
    <div style={{ maxWidth: '960px', margin: '2rem auto', padding: '0 1rem' }}>
      <div style={{
        backgroundColor: '#ffffff',
        borderRadius: '0.75rem',
        padding: '2rem',
        border: '1px solid #e2e8f0',
        boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
          <span style={{ fontSize: '2.5rem' }}>⚖️</span>
          <div>
            <h1 style={{ fontSize: '1.75rem', fontWeight: '700', color: '#0f172a' }}>
              BalanceVault Banking Platform
            </h1>
            <p style={{ color: '#64748b', fontSize: '0.95rem' }}>
              Phase 7 Frontend Foundation: Double-Entry Ledger, Cash Invariants & Audit Trail
            </p>
          </div>
        </div>

        {isAuthenticated ? (
          <div style={{
            marginTop: '1.5rem',
            padding: '1.25rem',
            backgroundColor: '#f8fafc',
            borderRadius: '0.5rem',
            border: '1px solid #e2e8f0',
          }}>
            <h2 style={{ fontSize: '1.1rem', fontWeight: '600', marginBottom: '0.75rem', color: '#1e293b' }}>
              Active Session Details
            </h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
              <div>
                <span style={{ fontSize: '0.8rem', color: '#64748b', textTransform: 'uppercase' }}>Username</span>
                <p style={{ fontWeight: '600', color: '#0f172a' }}>{user?.username}</p>
              </div>
              <div>
                <span style={{ fontSize: '0.8rem', color: '#64748b', textTransform: 'uppercase' }}>Email</span>
                <p style={{ fontWeight: '600', color: '#0f172a' }}>{user?.email}</p>
              </div>
              <div>
                <span style={{ fontSize: '0.8rem', color: '#64748b', textTransform: 'uppercase' }}>Role</span>
                <p style={{ fontWeight: '600', color: '#0284c7', textTransform: 'capitalize' }}>
                  {role ? role.replace('_', ' ') : ''}
                </p>
              </div>
              <div>
                <span style={{ fontSize: '0.8rem', color: '#64748b', textTransform: 'uppercase' }}>Status</span>
                <p style={{ fontWeight: '600', color: user?.is_active ? '#16a34a' : '#dc2626' }}>
                  {user?.is_active ? 'Active' : 'Deactivated'}
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div style={{ marginTop: '1.5rem' }}>
            <p style={{ color: '#475569', marginBottom: '1rem', fontSize: '0.95rem' }}>
              Sign in with your registered account credentials to access your banking dashboard, accounts, and financial transfers.
            </p>
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <Link
                to="/login"
                style={{
                  backgroundColor: '#0284c7',
                  color: '#ffffff',
                  padding: '0.5rem 1.25rem',
                  borderRadius: '0.375rem',
                  textDecoration: 'none',
                  fontWeight: '500',
                  fontSize: '0.9rem',
                }}
              >
                Sign In
              </Link>
              <Link
                to="/register"
                style={{
                  backgroundColor: '#ffffff',
                  color: '#0284c7',
                  border: '1px solid #bae6fd',
                  padding: '0.5rem 1.25rem',
                  borderRadius: '0.375rem',
                  textDecoration: 'none',
                  fontWeight: '500',
                  fontSize: '0.9rem',
                }}
              >
                Create Account
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function PlaceholderPage({ title, description, allowedRoles }) {
  return (
    <div style={{ maxWidth: '960px', margin: '2rem auto', padding: '0 1rem' }}>
      <div style={{
        backgroundColor: '#ffffff',
        borderRadius: '0.75rem',
        padding: '2rem',
        border: '1px solid #e2e8f0',
      }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: '700', color: '#0f172a', marginBottom: '0.5rem' }}>
          {title}
        </h1>
        <p style={{ color: '#64748b', fontSize: '0.95rem', marginBottom: '1.5rem' }}>
          {description}
        </p>
        <div style={{
          backgroundColor: '#eff6ff',
          padding: '1rem',
          borderRadius: '0.5rem',
          border: '1px solid #dbeafe',
          color: '#1e40af',
          fontSize: '0.875rem',
        }}>
          <strong>Stage 1 Route Placeholder:</strong> This section is protected and accessible to roles: <em>{allowedRoles ? allowedRoles.join(', ') : 'public'}</em>. Full interactive form implementation follows in subsequent Phase 7 stages.
        </div>
      </div>
    </div>
  );
}

function NotFoundPage() {
  return (
    <div style={{ maxWidth: '600px', margin: '4rem auto', padding: '2rem', textAlign: 'center' }}>
      <span style={{ fontSize: '3rem' }}>🔍</span>
      <h1 style={{ fontSize: '1.75rem', fontWeight: '700', color: '#0f172a', marginTop: '1rem' }}>
        Page Not Found (404)
      </h1>
      <p style={{ color: '#64748b', marginTop: '0.5rem', marginBottom: '1.5rem' }}>
        The requested URL was not found on this server.
      </p>
      <Link
        to="/"
        style={{
          display: 'inline-block',
          backgroundColor: '#0284c7',
          color: '#ffffff',
          padding: '0.5rem 1.25rem',
          borderRadius: '0.375rem',
          textDecoration: 'none',
          fontWeight: '500',
        }}
      >
        Return Home
      </Link>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Navbar />
        <main style={{ flex: 1, paddingBottom: '2rem' }}>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route
              path="/dashboard"
              element={
                <ProtectedRoute allowedRoles={['admin', 'account_holder', 'auditor']}>
                  <DashboardPage />
                </ProtectedRoute>
              }
            />
            
            {/* Protected Routes */}
            <Route
              path="/transfers"
              element={
                <ProtectedRoute allowedRoles={['admin', 'account_holder']}>
                  <TransfersPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/statements"
              element={
                <ProtectedRoute allowedRoles={['admin', 'account_holder', 'auditor']}>
                  <StatementsPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin"
              element={
                <ProtectedRoute allowedRoles={['admin']}>
                  <AdminPortalPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/auditor"
              element={
                <ProtectedRoute allowedRoles={['auditor']}>
                  <AuditorPortalPage />
                </ProtectedRoute>
              }
            />

            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </main>
      </BrowserRouter>
    </AuthProvider>
  );
}
