/**
 * Centralized API Client for BalanceVault (LedgerLine)
 * 
 * Security Invariants & Policy:
 * 1. Tokens are never stored in localStorage (preventing persistent cross-session XSS token leakage).
 * 2. Tokens are stored primarily in-memory within React state. To support page refreshes within
 *    the active tab, an optional fallback to sessionStorage is maintained. Note: sessionStorage
 *    is vulnerable to same-origin XSS within the tab lifecycle, but is automatically wiped when the tab closes.
 * 3. The client never logs passwords, JWTs, or sensitive authorization headers.
 * 4. HTTP 401 responses trigger immediate session invalidation and token clearing.
 * 5. Resolves VITE_API_BASE_URL when configured for standalone production hosting,
 *    falling back to relative `/api` paths routed via the Vite dev proxy locally.
 */

const TOKEN_STORAGE_KEY = 'ledgerline_session_token';

// In-memory token storage
let inMemoryToken = null;
let unauthorizedHandler = null;

export const setAuthToken = (token) => {
  inMemoryToken = token;
  if (token) {
    try {
      sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
    } catch (_) {
      // sessionStorage unavailable or quota exceeded; in-memory fallback remains active
    }
  } else {
    try {
      sessionStorage.removeItem(TOKEN_STORAGE_KEY);
    } catch (_) {}
  }
};

export const getAuthToken = () => {
  if (inMemoryToken) {
    return inMemoryToken;
  }
  try {
    const stored = sessionStorage.getItem(TOKEN_STORAGE_KEY);
    if (stored) {
      inMemoryToken = stored;
      return stored;
    }
  } catch (_) {}
  return null;
};

export const clearAuthToken = () => {
  setAuthToken(null);
};

export const registerUnauthorizedHandler = (handler) => {
  unauthorizedHandler = handler;
};

export class ApiError extends Error {
  constructor(status, data, message) {
    super(message || (data && data.message) || `HTTP error ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
    this.errorType = data?.error || 'ApiError';
    this.details = data?.details || null;
    this.isIdempotencyConflict = (status === 409 && data?.error === 'IdempotencyConflictError');
    this.isConcurrentRequest = (status === 409 && data?.error === 'ConcurrentRequestError');
    // Ambiguous outcomes: network failures (0), gateway/timeouts (502, 503, 504), or in-flight concurrent execution (409 ConcurrentRequestError)
    this.isAmbiguous = (
      status === 0 ||
      status === 502 ||
      status === 503 ||
      status === 504 ||
      this.isConcurrentRequest
    );
  }
}

/**
 * Resolves an API endpoint against VITE_API_BASE_URL when configured,
 * preserving relative `/api/...` paths for local Vite dev proxy fallback.
 *
 * @param {string} endpoint - API endpoint path (e.g. '/api/auth/me')
 * @param {string} [apiBaseUrl] - Optional override base URL (defaults to VITE_API_BASE_URL)
 * @returns {string} Resolved request URL
 */
export function resolveApiUrl(endpoint, apiBaseUrl = import.meta.env?.VITE_API_BASE_URL) {
  if (/^https?:\/\//i.test(endpoint)) {
    return endpoint;
  }

  const normalizedBase = typeof apiBaseUrl === 'string'
    ? apiBaseUrl.trim().replace(/\/+$/, '')
    : '';

  if (!normalizedBase) {
    return endpoint;
  }

  const normalizedEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  return `${normalizedBase}${normalizedEndpoint}`;
}

/**
 * Executes an HTTP request against the BalanceVault backend API.
 * 
 * @param {string} endpoint - API endpoint path (e.g. '/api/auth/me')
 * @param {object} options - Fetch options (method, body, headers, etc.)
 * @returns {Promise<any>} Parsed JSON response body
 */
export async function apiRequest(endpoint, options = {}) {
  const {
    method = 'GET',
    body,
    headers = {},
    requireAuth = true,
    ...restOptions
  } = options;

  const requestHeaders = {
    'Accept': 'application/json',
    ...headers,
  };

  if (body !== undefined && !(body instanceof FormData)) {
    requestHeaders['Content-Type'] = 'application/json';
  }

  // Inject Bearer token if available
  const token = getAuthToken();
  if (token && !requestHeaders['Authorization']) {
    requestHeaders['Authorization'] = `Bearer ${token}`;
  }

  const fetchOptions = {
    method,
    headers: requestHeaders,
    body: body !== undefined && !(body instanceof FormData) ? JSON.stringify(body) : body,
    ...restOptions,
  };

  const targetUrl = resolveApiUrl(endpoint);

  let response;
  try {
    response = await fetch(targetUrl, fetchOptions);
  } catch (netErr) {
    throw new ApiError(0, null, 'Network connection failed. Please ensure the backend server is running.');
  }

  let responseData = null;
  const contentType = response.headers.get('content-type');
  if (contentType && contentType.includes('application/json')) {
    try {
      responseData = await response.json();
    } catch (_) {
      responseData = null;
    }
  }

  if (!response.ok) {
    // Intercept 401 Unauthorized globally
    if (response.status === 401) {
      clearAuthToken();
      if (typeof unauthorizedHandler === 'function') {
        unauthorizedHandler();
      }
    }

    const errorMessage =
      responseData?.message ||
      (typeof responseData?.error === 'string' ? responseData.error : null) ||
      `Request failed with status ${response.status}`;

    throw new ApiError(response.status, responseData, errorMessage);
  }

  if (options.withResponseHeaders) {
    const isReplayed = response.headers.get('idempotent-replayed') === 'true';
    return {
      data: responseData,
      headers: response.headers,
      status: response.status,
      isReplayed,
    };
  }

  return responseData;
}

export const api = {
  get: (endpoint, options = {}) => apiRequest(endpoint, { ...options, method: 'GET' }),
  post: (endpoint, body, options = {}) => apiRequest(endpoint, { ...options, method: 'POST', body }),
  patch: (endpoint, body, options = {}) => apiRequest(endpoint, { ...options, method: 'PATCH', body }),
  delete: (endpoint, options = {}) => apiRequest(endpoint, { ...options, method: 'DELETE' }),
};

