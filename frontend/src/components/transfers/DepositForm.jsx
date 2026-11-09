import React, { useState, useMemo } from 'react';
import { parseRupeesToPaise, formatPaiseToINR } from '../../utils/currency';
import { Alert } from '../common/Alert';

export function DepositForm({
  accounts = [],
  currentUserRole,
  onInitiateReview,
  disabled = false,
}) {
  const customerAccounts = useMemo(() => {
    return accounts.filter((a) => a.account_type === 'customer');
  }, [accounts]);

  const [targetAccountId, setTargetAccountId] = useState(() => {
    return customerAccounts.length > 0 ? customerAccounts[0].id : '';
  });

  const [rupeesInput, setRupeesInput] = useState('');
  const [formError, setFormError] = useState(null);

  const targetAccount = useMemo(() => {
    return customerAccounts.find((a) => a.id === targetAccountId) || null;
  }, [customerAccounts, targetAccountId]);

  const parsedAmount = useMemo(() => {
    if (!rupeesInput.trim()) return null;
    return parseRupeesToPaise(rupeesInput);
  }, [rupeesInput]);

  const handleSubmit = (e) => {
    e.preventDefault();
    setFormError(null);

    if (disabled) return;

    if (!targetAccountId) {
      setFormError('Please select a target account for the deposit');
      return;
    }

    if (!parsedAmount || !parsedAmount.isValid) {
      setFormError(parsedAmount?.error || 'Please enter a valid deposit amount');
      return;
    }

    onInitiateReview({
      operationType: 'deposit',
      endpoint: '/api/transfers/deposit',
      accountId: targetAccountId,
      amountPaise: parsedAmount.paise,
      displayAmountINR: formatPaiseToINR(parsedAmount.paise),
      fromAccountLabel: 'Cash Clearing (System Clearing)',
      toAccountLabel: `${targetAccount?.account_number || 'Target Account'} (Customer)`,
      payload: {
        accountId: targetAccountId,
        amountPaise: parsedAmount.paise,
      },
    });
  };

  return (
    <form onSubmit={handleSubmit} style={{ maxWidth: '640px', margin: '0 auto' }}>
      {formError && (
        <div style={{ marginBottom: '1.25rem' }}>
          <Alert type="error" message={formError} />
        </div>
      )}

      {/* Target Account */}
      <div style={{ marginBottom: '1.25rem' }}>
        <label
          htmlFor="deposit-target-account"
          style={{ display: 'block', fontSize: '0.85rem', fontWeight: '700', color: '#1e293b', marginBottom: '0.35rem' }}
        >
          Target Account (Deposit To) <span style={{ color: '#dc2626' }}>*</span>
        </label>
        <select
          id="deposit-target-account"
          data-testid="deposit-account-select"
          value={targetAccountId}
          onChange={(e) => setTargetAccountId(e.target.value)}
          disabled={disabled || customerAccounts.length === 0}
          style={{
            width: '100%',
            padding: '0.65rem 0.75rem',
            borderRadius: '0.375rem',
            border: '1px solid #cbd5e1',
            backgroundColor: disabled ? '#f8fafc' : '#ffffff',
            fontSize: '0.9rem',
            outline: 'none',
          }}
        >
          {customerAccounts.map((acc) => (
            <option key={acc.id} value={acc.id}>
              {acc.account_number} — Balance: {formatPaiseToINR(acc.balance_paise)}
            </option>
          ))}
        </select>
        {targetAccount && (
          <span style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '0.25rem', display: 'block' }}>
            Current balance: <strong>{formatPaiseToINR(targetAccount.balance_paise)}</strong>
          </span>
        )}
      </div>

      {/* Amount in Rupees */}
      <div style={{ marginBottom: '1.5rem' }}>
        <label
          htmlFor="deposit-amount"
          style={{ display: 'block', fontSize: '0.85rem', fontWeight: '700', color: '#1e293b', marginBottom: '0.35rem' }}
        >
          Deposit Amount in Rupees (₹) <span style={{ color: '#dc2626' }}>*</span>
        </label>
        <div style={{ position: 'relative' }}>
          <span style={{
            position: 'absolute',
            left: '0.75rem',
            top: '50%',
            transform: 'translateY(-50%)',
            fontWeight: '700',
            color: '#64748b',
          }}>
            ₹
          </span>
          <input
            id="deposit-amount"
            type="text"
            inputMode="decimal"
            data-testid="deposit-amount-input"
            placeholder="0.00"
            value={rupeesInput}
            onChange={(e) => setRupeesInput(e.target.value)}
            disabled={disabled}
            style={{
              width: '100%',
              padding: '0.65rem 0.75rem 0.65rem 2rem',
              borderRadius: '0.375rem',
              border: '1px solid #cbd5e1',
              backgroundColor: disabled ? '#f8fafc' : '#ffffff',
              fontSize: '1.1rem',
              fontWeight: '700',
              outline: 'none',
            }}
          />
        </div>

        {/* Live Preview */}
        {parsedAmount?.isValid && (
          <div style={{ fontSize: '0.8rem', color: '#15803d', marginTop: '0.35rem', fontWeight: '600' }}>
            Depositing: {formatPaiseToINR(parsedAmount.paise)} ({parsedAmount.paise} integer paise)
          </div>
        )}
        {parsedAmount && !parsedAmount.isValid && (
          <div style={{ fontSize: '0.8rem', color: '#dc2626', marginTop: '0.35rem' }}>
            {parsedAmount.error}
          </div>
        )}
      </div>

      <button
        type="submit"
        disabled={disabled || customerAccounts.length === 0}
        data-testid="deposit-submit-btn"
        style={{
          width: '100%',
          backgroundColor: '#15803d',
          color: '#ffffff',
          border: 'none',
          borderRadius: '0.375rem',
          padding: '0.75rem',
          fontSize: '0.95rem',
          fontWeight: '700',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.6 : 1,
        }}
      >
        Review Cash Deposit &rarr;
      </button>
    </form>
  );
}

