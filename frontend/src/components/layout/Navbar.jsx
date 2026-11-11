import React, { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

export function Navbar() {
  const { user, isAuthenticated, role, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const closeMobileMenu = () => setMobileMenuOpen(false);

  const isActive = (path) => location.pathname === path;

  const roleBadgeColors = {
    admin: { bg: '#f3e8ff', text: '#6b21a8', border: '#d8b4fe' },
    account_holder: { bg: '#e0f2fe', text: '#0369a1', border: '#bae6fd' },
    auditor: { bg: '#fef3c7', text: '#92400e', border: '#fde68a' },
  };

  const badgeStyle = roleBadgeColors[role] || { bg: '#f1f5f9', text: '#475569', border: '#cbd5e1' };

  return (
    <header style={{
      backgroundColor: '#ffffff',
      borderBottom: '1px solid #e2e8f0',
      boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
      position: 'sticky',
      top: 0,
      zIndex: 40,
    }}>
      <div style={{
        maxWidth: '1200px',
        margin: '0 auto',
        padding: '0.75rem 1.5rem',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
      }}>
        {/* Brand / Logo */}
        <Link
          to="/"
          onClick={closeMobileMenu}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.6rem',
            textDecoration: 'none',
            color: '#0f172a',
          }}
        >
          <span style={{ fontSize: '1.75rem' }} role="img" aria-label="balance scale">⚖️</span>
          <div>
            <span style={{ fontSize: '1.25rem', fontWeight: '700', letterSpacing: '-0.02em' }}>
              BalanceVault
            </span>
            <span style={{
              marginLeft: '0.5rem',
              fontSize: '0.7rem',
              backgroundColor: '#0284c7',
              color: '#ffffff',
              padding: '0.15rem 0.45rem',
              borderRadius: '9999px',
              fontWeight: '600',
              verticalAlign: 'middle',
            }}>
              Banking Core
            </span>
          </div>
        </Link>

        {/* Mobile menu toggle */}
        <button
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          style={{
            display: 'none',
            background: 'none',
            border: '1px solid #cbd5e1',
            borderRadius: '0.375rem',
            padding: '0.4rem 0.6rem',
            fontSize: '1.1rem',
            cursor: 'pointer',
          }}
          className="mobile-toggle-btn"
          aria-label="Toggle navigation"
        >
          {mobileMenuOpen ? '✕' : '☰'}
        </button>

        {/* Navigation Links */}
        <nav
          className={`nav-links ${mobileMenuOpen ? 'mobile-open' : ''}`}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '1rem',
          }}
        >
          {isAuthenticated ? (
            <>
              {/* Common view for account_holder and admin */}
              {role !== 'auditor' && (
                <>
                  <Link
                    to="/"
                    onClick={closeMobileMenu}
                    style={{
                      textDecoration: 'none',
                      fontSize: '0.9rem',
                      fontWeight: isActive('/') ? '600' : '500',
                      color: isActive('/') ? '#0284c7' : '#475569',
                      padding: '0.35rem 0.6rem',
                      borderRadius: '0.375rem',
                    }}
                  >
                    Dashboard
                  </Link>

                  <Link
                    to="/transfers"
                    onClick={closeMobileMenu}
                    style={{
                      textDecoration: 'none',
                      fontSize: '0.9rem',
                      fontWeight: isActive('/transfers') ? '600' : '500',
                      color: isActive('/transfers') ? '#0284c7' : '#475569',
                      padding: '0.35rem 0.6rem',
                      borderRadius: '0.375rem',
                    }}
                  >
                    Transfers & Cash
                  </Link>
                </>
              )}

              {/* Statements link accessible to all roles */}
              <Link
                to="/statements"
                onClick={closeMobileMenu}
                style={{
                  textDecoration: 'none',
                  fontSize: '0.9rem',
                  fontWeight: isActive('/statements') ? '600' : '500',
                  color: isActive('/statements') ? '#0284c7' : '#475569',
                  padding: '0.35rem 0.6rem',
                  borderRadius: '0.375rem',
                }}
              >
                Statements
              </Link>

              {/* Role-specific portal: Admin */}
              {role === 'admin' && (
                <Link
                  to="/admin"
                  onClick={closeMobileMenu}
                  style={{
                    textDecoration: 'none',
                    fontSize: '0.9rem',
                    fontWeight: isActive('/admin') ? '600' : '500',
                    color: isActive('/admin') ? '#6b21a8' : '#6b21a8',
                    backgroundColor: '#faf5ff',
                    border: '1px solid #e9d5ff',
                    padding: '0.35rem 0.65rem',
                    borderRadius: '0.375rem',
                  }}
                >
                  Admin Portal
                </Link>
              )}

              {/* Role-specific portal: Auditor */}
              {role === 'auditor' && (
                <Link
                  to="/auditor"
                  onClick={closeMobileMenu}
                  style={{
                    textDecoration: 'none',
                    fontSize: '0.9rem',
                    fontWeight: isActive('/auditor') ? '600' : '500',
                    color: isActive('/auditor') ? '#92400e' : '#92400e',
                    backgroundColor: '#fffbeb',
                    border: '1px solid #fef3c7',
                    padding: '0.35rem 0.65rem',
                    borderRadius: '0.375rem',
                  }}
                >
                  Auditor Portal
                </Link>
              )}

              {/* User Profile Pill & Logout */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                marginLeft: '0.5rem',
                paddingLeft: '0.75rem',
                borderLeft: '1px solid #e2e8f0',
              }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                  <span style={{ fontSize: '0.85rem', fontWeight: '600', color: '#1e293b' }}>
                    {user?.username}
                  </span>
                  <span style={{
                    fontSize: '0.7rem',
                    fontWeight: '600',
                    backgroundColor: badgeStyle.bg,
                    color: badgeStyle.text,
                    border: `1px solid ${badgeStyle.border}`,
                    padding: '0.05rem 0.4rem',
                    borderRadius: '9999px',
                    textTransform: 'capitalize',
                  }}>
                    {role ? role.replace('_', ' ') : ''}
                  </span>
                </div>

                <button
                  onClick={handleLogout}
                  style={{
                    backgroundColor: '#f8fafc',
                    color: '#dc2626',
                    border: '1px solid #fecaca',
                    padding: '0.35rem 0.75rem',
                    borderRadius: '0.375rem',
                    fontSize: '0.825rem',
                    fontWeight: '500',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                  title="Sign out of your session"
                >
                  Logout
                </button>
              </div>
            </>
          ) : (
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <Link
                to="/login"
                onClick={closeMobileMenu}
                style={{
                  textDecoration: 'none',
                  fontSize: '0.9rem',
                  fontWeight: '500',
                  color: '#0284c7',
                  border: '1px solid #bae6fd',
                  padding: '0.35rem 0.85rem',
                  borderRadius: '0.375rem',
                }}
              >
                Sign In
              </Link>
              <Link
                to="/register"
                onClick={closeMobileMenu}
                style={{
                  textDecoration: 'none',
                  fontSize: '0.9rem',
                  fontWeight: '500',
                  color: '#ffffff',
                  backgroundColor: '#0284c7',
                  padding: '0.35rem 0.85rem',
                  borderRadius: '0.375rem',
                }}
              >
                Register
              </Link>
            </div>
          )}
        </nav>
      </div>
    </header>
  );
}

