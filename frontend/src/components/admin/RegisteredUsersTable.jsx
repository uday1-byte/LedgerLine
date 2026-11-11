import React, { useMemo, useState } from 'react';
import { Alert } from '../common/Alert';
import { formatDateTime } from '../../utils/date';

const ROLE_STYLES = {
  admin: { bg: '#f3e8ff', color: '#6b21a8' },
  auditor: { bg: '#fef3c7', color: '#92400e' },
  account_holder: { bg: '#e0f2fe', color: '#0369a1' },
};

export function RegisteredUsersTable({
  users = [],
  loading = false,
  error = null,
  onSelectUser,
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState(''); // '' | 'active' | 'inactive'

  const filteredUsers = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return users.filter((u) => {
      if (roleFilter && u.role !== roleFilter) return false;
      if (statusFilter === 'active' && !u.is_active) return false;
      if (statusFilter === 'inactive' && u.is_active) return false;
      if (!query) return true;
      return (
        (u.username && u.username.toLowerCase().includes(query)) ||
        (u.email && u.email.toLowerCase().includes(query)) ||
        (u.id && u.id.toLowerCase().includes(query))
      );
    });
  }, [users, searchQuery, roleFilter, statusFilter]);

  const hasActiveFilters = Boolean(searchQuery.trim() || roleFilter || statusFilter);

  const handleResetFilters = () => {
    setSearchQuery('');
    setRoleFilter('');
    setStatusFilter('');
  };

  return (
    <div
      role="region"
      aria-label="Registered Users Directory"
      style={{
        backgroundColor: '#ffffff',
        borderRadius: '0.75rem',
        border: '1px solid #e2e8f0',
        overflow: 'hidden',
        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)',
        marginBottom: '1.5rem',
      }}
    >
      <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid #e2e8f0' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '0.85rem' }}>
          <div>
            <h3 style={{ fontSize: '1.1rem', fontWeight: '700', color: '#0f172a', margin: 0 }}>
              Registered Users ({filteredUsers.length}
              {hasActiveFilters ? ` of ${users.length}` : ''})
            </h3>
            <p style={{ color: '#64748b', fontSize: '0.8rem', margin: '0.2rem 0 0 0' }}>
              Search by username or email, or filter by role and active status. Select a user to pre-fill governance controls below.
            </p>
          </div>
          {hasActiveFilters && (
            <button
              type="button"
              data-testid="btn-reset-users-filters"
              onClick={handleResetFilters}
              style={{
                padding: '0.4rem 0.8rem',
                backgroundColor: '#f8fafc',
                border: '1px solid #cbd5e1',
                borderRadius: '0.375rem',
                fontSize: '0.78rem',
                fontWeight: '600',
                color: '#475569',
                cursor: 'pointer',
              }}
            >
              Clear Filters
            </button>
          )}
        </div>

        {/* Filter Controls */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem' }}>
          <input
            type="text"
            data-testid="input-users-search"
            aria-label="Search registered users"
            placeholder="Search username, email, or UUID..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              padding: '0.5rem 0.75rem',
              borderRadius: '0.375rem',
              border: '1px solid #cbd5e1',
              fontSize: '0.85rem',
              outline: 'none',
            }}
          />
          <select
            data-testid="select-users-role-filter"
            aria-label="Filter users by role"
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            style={{
              padding: '0.5rem 0.75rem',
              borderRadius: '0.375rem',
              border: '1px solid #cbd5e1',
              fontSize: '0.85rem',
              backgroundColor: '#ffffff',
              outline: 'none',
            }}
          >
            <option value="">All Roles</option>
            <option value="account_holder">Account Holder</option>
            <option value="auditor">Auditor</option>
            <option value="admin">Admin</option>
          </select>
          <select
            data-testid="select-users-status-filter"
            aria-label="Filter users by active status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            style={{
              padding: '0.5rem 0.75rem',
              borderRadius: '0.375rem',
              border: '1px solid #cbd5e1',
              fontSize: '0.85rem',
              backgroundColor: '#ffffff',
              outline: 'none',
            }}
          >
            <option value="">All Statuses</option>
            <option value="active">Active Only</option>
            <option value="inactive">Inactive Only</option>
          </select>
        </div>
      </div>

      {error && (
        <div style={{ padding: '1rem 1.5rem' }}>
          <Alert type="error" message={error} />
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: '2rem', color: '#64748b', fontSize: '0.9rem' }}>
          Loading registered users...
        </div>
      ) : filteredUsers.length === 0 ? (
        <div style={{ padding: '2rem', textAlign: 'center', color: '#64748b', fontSize: '0.875rem' }}>
          No registered users match the current filters.
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                <th style={{ padding: '0.75rem 1rem' }}>Username</th>
                <th style={{ padding: '0.75rem 1rem' }}>Email</th>
                <th style={{ padding: '0.75rem 1rem' }}>User UUID</th>
                <th style={{ padding: '0.75rem 1rem' }}>Role</th>
                <th style={{ padding: '0.75rem 1rem' }}>Status</th>
                <th style={{ padding: '0.75rem 1rem' }}>Registered</th>
                {onSelectUser && <th style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {filteredUsers.map((u, idx) => {
                const roleBadge = ROLE_STYLES[u.role] || { bg: '#f1f5f9', color: '#475569' };
                return (
                  <tr
                    key={u.id}
                    data-testid={`user-row-${u.id}`}
                    style={{ borderBottom: '1px solid #f1f5f9', backgroundColor: idx % 2 === 0 ? '#ffffff' : '#fafafa' }}
                  >
                    <td style={{ padding: '0.8rem 1rem', fontWeight: '700', color: '#0f172a' }}>
                      {u.username}
                    </td>
                    <td style={{ padding: '0.8rem 1rem', color: '#334155' }}>
                      {u.email}
                    </td>
                    <td style={{ padding: '0.8rem 1rem', fontFamily: 'monospace', fontSize: '0.775rem', color: '#64748b' }}>
                      {u.id}
                    </td>
                    <td style={{ padding: '0.8rem 1rem' }}>
                      <span
                        style={{
                          display: 'inline-block',
                          fontSize: '0.725rem',
                          fontWeight: '700',
                          padding: '0.15rem 0.5rem',
                          borderRadius: '9999px',
                          backgroundColor: roleBadge.bg,
                          color: roleBadge.color,
                        }}
                      >
                        {u.role}
                      </span>
                    </td>
                    <td style={{ padding: '0.8rem 1rem' }}>
                      <span
                        style={{
                          display: 'inline-block',
                          fontSize: '0.725rem',
                          fontWeight: '700',
                          padding: '0.15rem 0.5rem',
                          borderRadius: '9999px',
                          backgroundColor: u.is_active ? '#dcfce7' : '#fee2e2',
                          color: u.is_active ? '#166534' : '#991b1b',
                        }}
                      >
                        {u.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td style={{ padding: '0.8rem 1rem', color: '#64748b', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
                      {formatDateTime(u.created_at)}
                    </td>
                    {onSelectUser && (
                      <td style={{ padding: '0.8rem 1rem', textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <button
                          type="button"
                          data-testid={`btn-select-user-${u.id}`}
                          onClick={() => onSelectUser(u)}
                          style={{
                            padding: '0.3rem 0.65rem',
                            backgroundColor: '#0284c7',
                            color: '#ffffff',
                            border: 'none',
                            borderRadius: '0.25rem',
                            fontSize: '0.75rem',
                            fontWeight: '600',
                            cursor: 'pointer',
                          }}
                        >
                          Manage
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
