import React from 'react';

export function StatementPagination({
  totalEntries = 0,
  limit = 50,
  offset = 0,
  note,
  onPageChange,
  isLoading = false,
}) {
  if (totalEntries === 0) return null;

  const currentPage = Math.floor(offset / limit) + 1;
  const totalPages = Math.ceil(totalEntries / limit) || 1;

  const startEntry = offset + 1;
  const endEntry = Math.min(offset + limit, totalEntries);

  const hasPrev = offset > 0;
  const hasNext = offset + limit < totalEntries;

  const handlePrev = () => {
    if (!hasPrev || isLoading) return;
    const newOffset = Math.max(0, offset - limit);
    onPageChange(newOffset);
  };

  const handleNext = () => {
    if (!hasNext || isLoading) return;
    const newOffset = offset + limit;
    onPageChange(newOffset);
  };

  return (
    <div
      role="navigation"
      aria-label="Statement Pagination"
      className="no-print"
      style={{
        backgroundColor: '#ffffff',
        borderRadius: '0.75rem',
        border: '1px solid #e2e8f0',
        padding: '1rem 1.5rem',
        marginBottom: '1.5rem',
        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        {/* Count info */}
        <div data-testid="pagination-info" style={{ fontSize: '0.875rem', color: '#475569' }}>
          Showing <strong>{startEntry}</strong>–<strong>{endEntry}</strong> of <strong>{totalEntries}</strong> entries
          <span style={{ marginLeft: '0.5rem', color: '#94a3b8' }}>
            (Page {currentPage} of {totalPages})
          </span>
        </div>

        {/* Buttons */}
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            type="button"
            onClick={handlePrev}
            disabled={!hasPrev || isLoading}
            data-testid="pagination-prev-btn"
            style={{
              padding: '0.45rem 0.9rem',
              backgroundColor: '#ffffff',
              border: '1px solid #cbd5e1',
              borderRadius: '0.375rem',
              fontSize: '0.85rem',
              fontWeight: '600',
              color: !hasPrev || isLoading ? '#94a3b8' : '#334155',
              cursor: !hasPrev || isLoading ? 'not-allowed' : 'pointer',
              opacity: !hasPrev || isLoading ? 0.6 : 1,
            }}
          >
            &larr; Previous
          </button>

          <button
            type="button"
            onClick={handleNext}
            disabled={!hasNext || isLoading}
            data-testid="pagination-next-btn"
            style={{
              padding: '0.45rem 0.9rem',
              backgroundColor: '#ffffff',
              border: '1px solid #cbd5e1',
              borderRadius: '0.375rem',
              fontSize: '0.85rem',
              fontWeight: '600',
              color: !hasNext || isLoading ? '#94a3b8' : '#334155',
              cursor: !hasNext || isLoading ? 'not-allowed' : 'pointer',
              opacity: !hasNext || isLoading ? 0.6 : 1,
            }}
          >
            Next &rarr;
          </button>
        </div>
      </div>

      {/* Concurrency Offset-Pagination Notice */}
      {note && (
        <div
          data-testid="pagination-concurrency-note"
          style={{
            marginTop: '0.75rem',
            paddingTop: '0.75rem',
            borderTop: '1px solid #f1f5f9',
            fontSize: '0.75rem',
            color: '#64748b',
            lineHeight: '1.4',
          }}
        >
          <strong>Pagination Concurrency Note:</strong> {note}
        </div>
      )}
    </div>
  );
}
