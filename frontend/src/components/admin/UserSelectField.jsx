import React, { useMemo, useState } from 'react';

export function formatUserOptionLabel(user) {
  const statusTag = user.is_active ? 'Active' : 'Inactive';
  return `${user.username} (${user.email}) — ${user.role} · ${statusTag}`;
}

export function UserSelectField({
  label = 'Select Registered User',
  users = [],
  selectedUserId = '',
  onSelectUser,
  filterPredicate,
  disabled = false,
  searchPlaceholder = 'Filter users by username, email, or UUID...',
  emptyMessage = 'No matching registered users found.',
  searchTestId,
  selectTestId,
  idPrefix = 'user-select',
}) {
  const [searchTerm, setSearchTerm] = useState('');

  const filteredUsers = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    return users
      .filter((u) => (filterPredicate ? filterPredicate(u) : true))
      .filter((u) => {
        if (!query) return true;
        return (
          (u.username && u.username.toLowerCase().includes(query)) ||
          (u.email && u.email.toLowerCase().includes(query)) ||
          (u.id && u.id.toLowerCase().includes(query))
        );
      });
  }, [users, filterPredicate, searchTerm]);

  const handleSelectChange = (e) => {
    const nextId = e.target.value;
    if (!nextId) {
      onSelectUser('', null);
      return;
    }
    const matched = users.find((u) => u.id === nextId) || null;
    onSelectUser(nextId, matched);
  };

  return (
    <div style={{ marginBottom: '0.85rem' }}>
      <label
        htmlFor={`${idPrefix}-dropdown`}
        style={{ display: 'block', fontSize: '0.825rem', fontWeight: '700', color: '#1e293b', marginBottom: '0.35rem' }}
      >
        {label}
      </label>
      <input
        type="text"
        id={`${idPrefix}-search`}
        data-testid={searchTestId}
        placeholder={searchPlaceholder}
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
        disabled={disabled}
        style={{
          width: '100%',
          padding: '0.5rem 0.7rem',
          borderRadius: '0.375rem',
          border: '1px solid #cbd5e1',
          fontSize: '0.825rem',
          marginBottom: '0.4rem',
          outline: 'none',
          backgroundColor: disabled ? '#f1f5f9' : '#ffffff',
        }}
      />
      <select
        id={`${idPrefix}-dropdown`}
        data-testid={selectTestId}
        value={filteredUsers.some((u) => u.id === selectedUserId) ? selectedUserId : ''}
        onChange={handleSelectChange}
        disabled={disabled}
        style={{
          width: '100%',
          padding: '0.55rem 0.7rem',
          borderRadius: '0.375rem',
          border: '1px solid #cbd5e1',
          fontSize: '0.85rem',
          outline: 'none',
          backgroundColor: disabled ? '#f1f5f9' : '#ffffff',
        }}
      >
        <option value="">
          {filteredUsers.length > 0
            ? `-- Choose from ${filteredUsers.length} user${filteredUsers.length === 1 ? '' : 's'} --`
            : `-- ${emptyMessage} --`}
        </option>
        {filteredUsers.map((u) => (
          <option key={u.id} value={u.id}>
            {formatUserOptionLabel(u)}
          </option>
        ))}
      </select>
    </div>
  );
}
