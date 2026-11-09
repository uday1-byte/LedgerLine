/**
 * Date and Timezone Utilities for LedgerLine Statements
 * 
 * Invariants:
 * 1. Zod backend validation requires strict ISO 8601 strings ending in 'Z' (e.g. 2026-03-01T00:00:00.000Z).
 * 2. Avoid silent interpretation: User calendar input is explicitly bound to either UTC or local timezone.
 * 3. Exact evaluation boundaries are surfaced clearly to the user.
 */

/**
 * Returns the browser's current IANA timezone name (e.g. "Asia/Kolkata", "America/New_York", "UTC").
 */
export function getLocalTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch (_) {
    return 'UTC';
  }
}

/**
 * Formats a timezone offset string (e.g. "UTC+05:30", "UTC-05:00", "UTC+00:00").
 */
export function getLocalTimeZoneOffset() {
  const offsetMinutes = -new Date().getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMinutes);
  const hours = String(Math.floor(abs / 60)).padStart(2, '0');
  const minutes = String(abs % 60).padStart(2, '0');
  return `UTC${sign}${hours}:${minutes}`;
}

/**
 * Formats an ISO datetime string for user display.
 * 
 * @param {string|Date} dateVal - ISO string or Date object
 * @param {object} [options]
 * @param {string} [options.timeZone] - Explicit timezone override ('UTC', local, etc.)
 * @returns {string} Formatted date/time string
 */
export function formatDateTime(dateVal, options = {}) {
  if (!dateVal) return 'N/A';
  try {
    const d = new Date(dateVal);
    if (isNaN(d.getTime())) return String(dateVal);

    const fmtOptions = {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
      ...(options.timeZone ? { timeZone: options.timeZone } : {}),
    };

    return new Intl.DateTimeFormat('en-IN', fmtOptions).format(d);
  } catch (_) {
    return String(dateVal);
  }
}

/**
 * Converts calendar date strings ("YYYY-MM-DD") into full ISO 8601 strings
 * conforming to Zod's backend `z.string().datetime()` requirements.
 * 
 * @param {string} fromDate - Calendar date string "YYYY-MM-DD" or empty
 * @param {string} toDate - Calendar date string "YYYY-MM-DD" or empty
 * @param {'UTC' | 'LOCAL'} timezoneMode - Explicit timezone interpretation
 * @returns {{ fromIso?: string, toIso?: string, error?: string, boundaryDescription?: string }}
 */
export function buildStatementDateRange(fromDate, toDate, timezoneMode = 'UTC') {
  const cleanFrom = fromDate ? fromDate.trim() : '';
  const cleanTo = toDate ? toDate.trim() : '';

  if (!cleanFrom && !cleanTo) {
    return { fromIso: undefined, toIso: undefined, boundaryDescription: 'All-time transaction history' };
  }

  const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
  if (cleanFrom && !DATE_REGEX.test(cleanFrom)) {
    return { error: 'Start date must be in YYYY-MM-DD format' };
  }
  if (cleanTo && !DATE_REGEX.test(cleanTo)) {
    return { error: 'End date must be in YYYY-MM-DD format' };
  }

  // Validate from <= to in calendar space
  if (cleanFrom && cleanTo && cleanFrom > cleanTo) {
    return { error: 'Start date cannot be later than end date' };
  }

  let fromIso;
  let toIso;

  if (timezoneMode === 'UTC') {
    if (cleanFrom) {
      fromIso = `${cleanFrom}T00:00:00.000Z`;
    }
    if (cleanTo) {
      toIso = `${cleanTo}T23:59:59.999Z`;
    }
  } else {
    // Local timezone mode: Construct local midnight to local 23:59:59.999, then convert to UTC ISO
    if (cleanFrom) {
      const [y, m, d] = cleanFrom.split('-').map(Number);
      const localStart = new Date(y, m - 1, d, 0, 0, 0, 0);
      fromIso = localStart.toISOString();
    }
    if (cleanTo) {
      const [y, m, d] = cleanTo.split('-').map(Number);
      const localEnd = new Date(y, m - 1, d, 23, 59, 59, 999);
      toIso = localEnd.toISOString();
    }
  }

  const tzLabel = timezoneMode === 'UTC' ? 'UTC' : `${getLocalTimeZone()} (${getLocalTimeZoneOffset()})`;
  const boundaryDescription = `Filtering in ${tzLabel}: ${fromIso || 'Beginning'} → ${toIso || 'Now'}`;

  return { fromIso, toIso, boundaryDescription };
}

