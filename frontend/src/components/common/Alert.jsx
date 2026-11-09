import React from 'react';

/**
 * Reusable Alert Component
 * 
 * Accessible notification banner for success, error, warning, and informational states.
 * Uses role="alert" with aria-live="polite" for assistive technology compatibility.
 * 
 * @param {object} props
 * @param {'error' | 'success' | 'warning' | 'info'} [props.type='info']
 * @param {string} [props.message]
 * @param {React.ReactNode} [props.children]
 * @param {() => void} [props.onClose]
 * @param {string} [props.className]
 */
export function Alert({ type = 'info', message, children, onClose, className = '' }) {
  const content = message || children;
  if (!content) return null;

  const styleConfig = {
    error: {
      bg: '#fef2f2',
      border: '#fecaca',
      text: '#991b1b',
      icon: '⚠️',
      iconColor: '#dc2626',
    },
    success: {
      bg: '#f0fdf4',
      border: '#bbf7d0',
      text: '#166534',
      icon: '✅',
      iconColor: '#16a34a',
    },
    warning: {
      bg: '#fffbeb',
      border: '#fde68a',
      text: '#92400e',
      icon: '⚡',
      iconColor: '#d97706',
    },
    info: {
      bg: '#f0f9ff',
      border: '#bae6fd',
      text: '#075985',
      icon: 'ℹ️',
      iconColor: '#0284c7',
    },
  };

  const current = styleConfig[type] || styleConfig.info;

  return (
    <div
      role="alert"
      aria-live="polite"
      className={`alert-banner alert-${type} ${className}`}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: '0.75rem',
        padding: '0.875rem 1rem',
        borderRadius: '0.5rem',
        backgroundColor: current.bg,
        border: `1px solid ${current.border}`,
        color: current.text,
        fontSize: '0.875rem',
        lineHeight: 1.4,
        marginBottom: '1rem',
      }}
    >
      <span
        style={{
          fontSize: '1.1rem',
          lineHeight: 1,
          flexShrink: 0,
          marginTop: '0.05rem',
        }}
        aria-hidden="true"
      >
        {current.icon}
      </span>
      <div style={{ flex: 1, wordBreak: 'break-word' }}>
        {content}
      </div>
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          aria-label="Dismiss message"
          style={{
            background: 'none',
            border: 'none',
            color: current.text,
            fontSize: '1rem',
            cursor: 'pointer',
            padding: '0 0.25rem',
            lineHeight: 1,
            opacity: 0.7,
            marginLeft: 'auto',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.opacity = '1')}
          onMouseLeave={(e) => (e.currentTarget.style.opacity = '0.7')}
        >
          ✕
        </button>
      )}
    </div>
  );
}

