import React, { useState, useMemo } from 'react';
import { parseRupeesToPaise, formatPaiseToINR } from '../../utils/currency';
import { Alert } from '../common/Alert';

const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export function TransferForm({
  accounts = [],
  currentUserRole,
  currentUserId,
  onInitiateReview,
  disabled = false,
}) {
  // Only customer accounts are eligible for transfers
  const customerAccounts = useMemo(() => {
    return accounts.filter((a) => a.account_type === 'customer');
  }, [accounts]);

  const [sourceAccountId, setSourceAccountId] = useState(() => {
    return customerAccounts.length > 0 ? customerAccounts[0].id : '';
  });

  const [destinationMode, setDestinationMode] = useState('internal'); // 'internal' | 'external'
  const [internalDestId, setInternalDestId] = useState('');
  const [externalDestId, setExternalDestId] = useState('');
  const [rupeesInput, setRupeesInput] = useState('');
  const [formError, setFormError] = useState(null);

  // Active source account details
  const sourceAccount = useMemo(() => {
    return customerAccounts.find((a) => a.id === sourceAccountId) || null;
  }, [customerAccounts, sourceAccountId]);

  // Destination accounts available for internal transfer
  const eligibleInternalDestinations = useMemo(() => {
    return customerAccounts.filter((a) => a.id !== sourceAccountId);
  }, [customerAccounts, sourceAccountId]);

  // Real-time currency parsing
  const parsedAmount = useMemo(() => {
    if (!rupeesInput.trim()) return null;
    return parseRupeesToPaise(rupeesInput);
  }, [rupeesInput]);

  const handleSubmit = (e) => {
    e.preventDefault();
    setFormError(null);

    if (disabled) return;

    if (!sourceAccountId) {
      setFormError('Please select a source funding account');
      return;
    }

    const effectiveDestId = destinationMode === 'internal' ? internalDestId : externalDestId.trim();

    if (!effectiveDestId) {
      setFormError('Please select or specify a destination account');
      return;
    }

    if (!UUID_REGEX.test(effectiveDestId)) {
      setFormError('Destination account must be a valid 36-character UUID');
      return;
    }

    if (sourceAccountId === effectiveDestId) {
      setFormError('Source and destination accounts must be different');
      return;
    }

    if (!parsedAmount || !parsedAmount.isValid) {
      setFormError(parsedAmount?.error || 'Please enter a valid transfer amount');
      return;
    }

    // Check balance sufficiency client-side
    if (sourceAccount?.balance_paise != null) {
      const sourceBalance = BigInt(sourceAccount.balance_paise);
      if (sourceBalance < parsedAmount.paiseBigInt) {
        setFormError(
          `Insufficient funds: Available balance is ${formatPaiseToINR(sourceBalance)}, but attempted transfer is ${formatPaiseToINR(parsedAmount.paiseBigInt)}.`
        );
        return;
      }
    }

    const destAccountObj = customerAccounts.find((a) => a.id === effectiveDestId);
    const toLabel = destAccountObj
      ? `${destAccountObj.account_number} (Customer)`
      : `Account (${effectiveDestId.slice(0, 8)}...${effectiveDestId.slice(-4)})`;

    onInitiateReview({
      operationType: 'transfer',
      endpoint: '/api/transfers',
      sourceAccountId,
      destinationAccountId: effectiveDestId,
      amountPaise: parsedAmount.paise,
      displayAmountINR: formatPaiseToINR(parsedAmount.paise),
      fromAccountLabel: `${sourceAccount?.account_number || 'Source Account'} (${formatPaiseToINR(sourceAccount?.balance_paise)})`,
      toAccountLabel: toLabel,
      payload: {
        sourceAccountId,
        destinationAccountId: effectiveDestId,
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

      {/* 1. Source Account */}
      <div style={{ marginBottom: '1.25rem' }}>
        <label
          htmlFor="transfer-source-account"
          style={{ display: 'block', fontSize: '0.85rem', fontWeight: '700', color: '#1e293b', marginBottom: '0.35rem' }}
        >
          Funding Account (From) <span style={{ color: '#dc2626' }}>*</span>
        </label>
        <select
          id="transfer-source-account"
          data-testid="transfer-source-select"
          value={sourceAccountId}
          onChange={(e) => {
            setSourceAccountId(e.target.value);
            setInternalDestId('');
          }}
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
        {sourceAccount && (
          <span style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '0.25rem', display: 'block' }}>
            Available balance: <strong>{formatPaiseToINR(sourceAccount.balance_paise)}</strong>
          </span>
        )}
      </div>

      {/* 2. Destination Account */}
      <div style={{ marginBottom: '1.25rem' }}>
        <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: '700', color: '#1e293b', marginBottom: '0.35rem' }}>
          Recipient Account (To) <span style={{ color: '#dc2626' }}>*</span>
        </label>

        {/* Transfer Destination Mode Toggle */}
        <div style={{ display: 'flex', gap: '1rem', marginBottom: '0.5rem', fontSize: '0.85rem' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', cursor: disabled ? 'not-allowed' : 'pointer' }}>
            <input
              type="radio"
              name="destMode"
              value="internal"
              checked={destinationMode === 'internal'}
              onChange={() => setDestinationMode('internal')}
              disabled={disabled || eligibleInternalDestinations.length === 0}
            />
            <span>Between Available Accounts ({eligibleInternalDestinations.length})</span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', cursor: disabled ? 'not-allowed' : 'pointer' }}>
            <input
              type="radio"
              name="destMode"
              value="external"
              checked={destinationMode === 'external'}
              onChange={() => setDestinationMode('external')}
              disabled={disabled}
            />
            <span>To External Account UUID</span>
          </label>
        </div>

        {destinationMode === 'internal' ? (
          <select
            data-testid="transfer-dest-select"
            value={internalDestId}
            onChange={(e) => setInternalDestId(e.target.value)}
            disabled={disabled || eligibleInternalDestinations.length === 0}
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
            <option value="">-- Select Destination Account --</option>
            {eligibleInternalDestinations.map((acc) => (
              <option key={acc.id} value={acc.id}>
                {acc.account_number} (Customer Account)
              </option>
            ))}
          </select>
        ) : (
          <div>
            <input
              type="text"
              data-testid="transfer-dest-input"
              placeholder="e.g. 00000000-0000-0000-0000-000000000000"
              value={externalDestId}
              onChange={(e) => setExternalDestId(e.target.value)}
              disabled={disabled}
              style={{
                width: '100%',
                padding: '0.65rem 0.75rem',
                borderRadius: '0.375rem',
                border: '1px solid #cbd5e1',
                backgroundColor: disabled ? '#f8fafc' : '#ffffff',
                fontSize: '0.9rem',
                fontFamily: 'monospace',
                outline: 'none',
              }}
            />
            <span style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.2rem', display: 'block' }}>
              Enter the valid 36-character UUID of the recipient customer account.
            </span>
          </div>
        )}
      </div>

      {/* 3. Amount in Rupees */}
      <div style={{ marginBottom: '1.5rem' }}>
        <label
          htmlFor="transfer-amount"
          style={{ display: 'block', fontSize: '0.85rem', fontWeight: '700', color: '#1e293b', marginBottom: '0.35rem' }}
        >
          Amount in Rupees (₹) <span style={{ color: '#dc2626' }}>*</span>
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
            id="transfer-amount"
            type="text"
            inputMode="decimal"
            data-testid="transfer-amount-input"
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

        {/* Live BigInt Conversion Preview */}
        {parsedAmount?.isValid && (
          <div style={{ fontSize: '0.8rem', color: '#0369a1', marginTop: '0.35rem', fontWeight: '600' }}>
            Transacting: {formatPaiseToINR(parsedAmount.paise)} ({parsedAmount.paise} integer paise)
          </div>
        )}
        {parsedAmount && !parsedAmount.isValid && (
          <div style={{ fontSize: '0.8rem', color: '#dc2626', marginTop: '0.35rem' }}>
            {parsedAmount.error}
          </div>
        )}
      </div>

      {/* Submit Button */}
      <button
        type="submit"
        disabled={disabled || customerAccounts.length === 0}
        data-testid="transfer-submit-btn"
        style={{
          width: '100%',
          backgroundColor: '#0284c7',
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
        Review Customer Transfer &rarr;
      </button>
    </form>
  );
}

