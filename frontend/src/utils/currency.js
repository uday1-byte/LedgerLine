/**
 * Currency Utilities for LedgerLine
 * 
 * Strict Money Handling Invariants:
 * - NEVER use JavaScript floating-point arithmetic (Number / float).
 * - All monetary values in LedgerLine are stored and tracked in integer paise (1 Rupee = 100 paise).
 * - Conversion between Rupees (user interface) and Paise (backend API) is performed exclusively
 *   via string parsing and BigInt arithmetic.
 */

export const PG_MAX_BIGINT = 9223372036854775807n;

/**
 * Formats an integer paise value (string, number, or BigInt) into an Indian Rupee string (e.g. "₹1,250.50").
 * Handles positive, negative, and zero values cleanly without floating-point math.
 * 
 * @param {string|number|bigint|null|undefined} paise 
 * @returns {string} Formatted INR currency string
 */
export function formatPaiseToINR(paise) {
  if (paise === null || paise === undefined || paise === '') {
    return '₹0.00';
  }

  let paiseBigInt;
  try {
    paiseBigInt = BigInt(paise);
  } catch (_) {
    return '₹0.00';
  }

  const isNegative = paiseBigInt < 0n;
  const absPaise = isNegative ? -paiseBigInt : paiseBigInt;

  const rupees = absPaise / 100n;
  const remainderPaise = absPaise % 100n;
  const paisePadded = remainderPaise.toString().padStart(2, '0');

  // Format whole rupees according to Indian numbering system (Lakhs / Crores)
  // We use Intl.NumberFormat on BigInt, supported in modern JavaScript environments
  const formattedRupees = new Intl.NumberFormat('en-IN', {
    maximumFractionDigits: 0,
    useGrouping: true,
  }).format(rupees);

  const prefix = isNegative ? '-₹' : '₹';
  return `${prefix}${formattedRupees}.${paisePadded}`;
}

/**
 * Parses user input in Rupees (e.g. "1250", "1250.5", "1250.50", "0.05") directly into
 * an integer paise string without floating-point arithmetic.
 * 
 * @param {string|number} rupeesInput 
 * @returns {{ isValid: boolean, error?: string, paise?: string, paiseBigInt?: bigint }}
 */
export function parseRupeesToPaise(rupeesInput) {
  if (rupeesInput === null || rupeesInput === undefined) {
    return { isValid: false, error: 'Amount is required' };
  }

  const trimmed = String(rupeesInput).trim();
  if (trimmed === '') {
    return { isValid: false, error: 'Amount is required' };
  }

  // Reject negative numbers or symbols
  if (trimmed.startsWith('-')) {
    return { isValid: false, error: 'Amount must be positive' };
  }

  // Validate decimal format: either whole digits or digits with up to 2 decimal places
  // Matches "123", "123.4", "123.45", "0.5", "0.05"
  const regex = /^(0|[1-9]\d*)(\.(\d{1,2}))?$/;
  if (!regex.test(trimmed)) {
    if (trimmed.includes('.') && trimmed.split('.')[1].length > 2) {
      return { isValid: false, error: 'Amount cannot have more than 2 decimal places (paise)' };
    }
    return { isValid: false, error: 'Please enter a valid amount (e.g. 100 or 100.50)' };
  }

  const [rupeesPart, paisePart = ''] = trimmed.split('.');
  const paddedPaise = paisePart.padEnd(2, '0');

  try {
    const wholeRupeesBigInt = BigInt(rupeesPart);
    const paiseComponentBigInt = BigInt(paddedPaise);
    const totalPaiseBigInt = wholeRupeesBigInt * 100n + paiseComponentBigInt;

    if (totalPaiseBigInt <= 0n) {
      return { isValid: false, error: 'Amount must be greater than zero' };
    }

    if (totalPaiseBigInt > PG_MAX_BIGINT) {
      return {
        isValid: false,
        error: `Amount exceeds maximum allowed limit (${formatPaiseToINR(PG_MAX_BIGINT)})`,
      };
    }

    return {
      isValid: true,
      paise: totalPaiseBigInt.toString(),
      paiseBigInt: totalPaiseBigInt,
    };
  } catch (err) {
    return { isValid: false, error: 'Failed to process amount. Please check the value.' };
  }
}

