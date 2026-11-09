import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import {
  api,
  setAuthToken,
  getAuthToken,
  clearAuthToken,
  registerUnauthorizedHandler,
} from '../api/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setTokenState] = useState(() => getAuthToken());
  const [loading, setLoading] = useState(true);

  const logout = useCallback(() => {
    clearAuthToken();
    setTokenState(null);
    setUser(null);
  }, []);

  const login = useCallback((newToken, userData) => {
    setAuthToken(newToken);
    setTokenState(newToken);
    setUser(userData);
  }, []);

  // Fetch current user details from GET /api/auth/me using active token
  const refreshUser = useCallback(async () => {
    const currentToken = getAuthToken();
    if (!currentToken) {
      setUser(null);
      setLoading(false);
      return null;
    }

    try {
      const data = await api.get('/api/auth/me');
      if (data && data.user) {
        setUser(data.user);
        return data.user;
      }
      throw new Error('Malformed user payload');
    } catch (err) {
      // 401 or network failure clears the session
      logout();
      return null;
    } finally {
      setLoading(false);
    }
  }, [logout]);

  // Initial bootstrap: validate existing session on page load/refresh
  useEffect(() => {
    registerUnauthorizedHandler(() => {
      logout();
    });

    refreshUser();
  }, [refreshUser, logout]);

  const value = {
    user,
    token,
    role: user?.role || null,
    isAuthenticated: Boolean(token && user),
    loading,
    login,
    logout,
    refreshUser,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

