import React, { useState, useEffect } from 'react';

export default function App() {
  const [healthData, setHealthData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchHealth = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/health');
      if (!response.ok) {
        throw new Error(`Server responded with status ${response.status}`);
      }
      const data = await response.json();
      setHealthData(data);
    } catch (err) {
      setError(err.message || 'Unable to reach backend server');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHealth();
  }, []);

  return (
    <div style={{ maxWidth: '960px', margin: '0 auto', padding: '2rem 1.5rem', width: '100%' }}>
      {/* Header */}
      <header style={{ marginBottom: '2.5rem', borderBottom: '1px solid #e2e8f0', paddingBottom: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
          <span style={{ fontSize: '2rem' }}>⚖️</span>
          <h1 style={{ fontSize: '1.875rem', fontWeight: '700', letterSpacing: '-0.025em' }}>
            LedgerLine
          </h1>
          <span style={{
            fontSize: '0.75rem',
            backgroundColor: '#0284c7',
            color: '#ffffff',
            padding: '0.2rem 0.6rem',
            borderRadius: '9999px',
            fontWeight: '600'
          }}>
            Foundation Phase
          </span>
        </div>
        <p style={{ color: '#64748b', fontSize: '1rem' }}>
          Robust, Double-Entry Financial Ledger Application
        </p>
      </header>

      {/* Main Grid */}
      <main style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.5rem' }}>
        
        {/* API Health Card */}
        <section style={{
          backgroundColor: '#ffffff',
          borderRadius: '0.75rem',
          padding: '1.5rem',
          boxShadow: '0 1px 3px rgba(0,0,0,0.1), 0 1px 2px rgba(0,0,0,0.06)',
          border: '1px solid #e2e8f0'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h2 style={{ fontSize: '1.125rem', fontWeight: '600' }}>Backend Health Status</h2>
            <button
              onClick={fetchHealth}
              disabled={loading}
              style={{
                backgroundColor: '#f1f5f9',
                border: '1px solid #cbd5e1',
                padding: '0.35rem 0.75rem',
                borderRadius: '0.375rem',
                cursor: loading ? 'not-allowed' : 'pointer',
                fontSize: '0.875rem',
                fontWeight: '500'
              }}
            >
              {loading ? 'Checking...' : 'Refresh'}
            </button>
          </div>

          {loading && (
            <p style={{ color: '#64748b', fontSize: '0.9rem' }}>Pinging backend API at /api/health...</p>
          )}

          {error && (
            <div style={{
              backgroundColor: '#fef2f2',
              color: '#991b1b',
              padding: '0.75rem 1rem',
              borderRadius: '0.5rem',
              fontSize: '0.875rem',
              border: '1px solid #fecaca'
            }}>
              <strong>Backend Offline:</strong> {error}
              <p style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: '#b91c1c' }}>
                Make sure the backend is running with <code>npm run dev:backend</code>.
              </p>
            </div>
          )}

          {healthData && !loading && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{
                  display: 'inline-block',
                  width: '10px',
                  height: '10px',
                  borderRadius: '50%',
                  backgroundColor: '#16a34a'
                }} />
                <span style={{ fontWeight: '600', color: '#16a34a' }}>
                  {healthData.status.toUpperCase()}
                </span>
                <span style={{ color: '#64748b', fontSize: '0.85rem' }}>({healthData.service})</span>
              </div>
              <div style={{ fontSize: '0.85rem', color: '#475569' }}>
                <div><strong>Environment:</strong> {healthData.environment}</div>
                <div><strong>Uptime:</strong> {healthData.uptime}</div>
                <div><strong>Server Time:</strong> {new Date(healthData.timestamp).toLocaleTimeString()}</div>
                <div><strong>Database Pool:</strong> {healthData.database.status}</div>
              </div>
            </div>
          )}
        </section>

        {/* Tech Stack Summary */}
        <section style={{
          backgroundColor: '#ffffff',
          borderRadius: '0.75rem',
          padding: '1.5rem',
          boxShadow: '0 1px 3px rgba(0,0,0,0.1), 0 1px 2px rgba(0,0,0,0.06)',
          border: '1px solid #e2e8f0'
        }}>
          <h2 style={{ fontSize: '1.125rem', fontWeight: '600', marginBottom: '1rem' }}>Technology Stack</h2>
          <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.875rem' }}>
            <li>⚡ <strong>Frontend:</strong> React 18 + Vite</li>
            <li>🚀 <strong>Backend:</strong> Node.js + Express</li>
            <li>🐘 <strong>Database:</strong> PostgreSQL (port 5432)</li>
            <li>🔌 <strong>DB Client:</strong> node-postgres (pg.Pool)</li>
            <li>🛡️ <strong>Validation:</strong> Zod schema validation</li>
            <li>🧪 <strong>Testing:</strong> Jest + Supertest</li>
            <li>🔐 <strong>Auth Ready:</strong> JWT + bcrypt</li>
          </ul>
        </section>

        {/* Setup Guardrails */}
        <section style={{
          backgroundColor: '#ffffff',
          borderRadius: '0.75rem',
          padding: '1.5rem',
          boxShadow: '0 1px 3px rgba(0,0,0,0.1), 0 1px 2px rgba(0,0,0,0.06)',
          border: '1px solid #e2e8f0',
          gridColumn: '1 / -1'
        }}>
          <h2 style={{ fontSize: '1.125rem', fontWeight: '600', marginBottom: '0.75rem' }}>Project Foundation Status</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
            <div style={{ padding: '0.75rem', backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '0.5rem' }}>
              <div style={{ color: '#166534', fontWeight: '600', fontSize: '0.875rem' }}>✓ Environment Variables</div>
              <div style={{ fontSize: '0.8rem', color: '#15803d', marginTop: '0.25rem' }}>Configured via .env.example with no secrets leaked</div>
            </div>
            <div style={{ padding: '0.75rem', backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '0.5rem' }}>
              <div style={{ color: '#166534', fontWeight: '600', fontSize: '0.875rem' }}>✓ PostgreSQL Config</div>
              <div style={{ fontSize: '0.8rem', color: '#15803d', marginTop: '0.25rem' }}>Targeting ledgerline_dev on port 5432</div>
            </div>
            <div style={{ padding: '0.75rem', backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '0.5rem' }}>
              <div style={{ color: '#166534', fontWeight: '600', fontSize: '0.875rem' }}>✓ Health Check & Tests</div>
              <div style={{ fontSize: '0.8rem', color: '#15803d', marginTop: '0.25rem' }}>GET /api/health tested with Jest & Supertest</div>
            </div>
            <div style={{ padding: '0.75rem', backgroundColor: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '0.5rem' }}>
              <div style={{ color: '#1e40af', fontWeight: '600', fontSize: '0.875rem' }}>⏳ Next Phase: Database Schema</div>
              <div style={{ fontSize: '0.8rem', color: '#1d4ed8', marginTop: '0.25rem' }}>Awaiting user approval before schema migration</div>
            </div>
          </div>
        </section>

      </main>
    </div>
  );
}
