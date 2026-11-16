import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { get, post, tokenStore, setAuthErrorHandler } from '../api/client.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const logout = useCallback(() => { tokenStore.set(null); setUser(null); }, []);

  useEffect(() => {
    setAuthErrorHandler((err) => {
      if (err.code === 'PASSWORD_CHANGE_REQUIRED') setUser((u) => (u ? { ...u, must_change_password: true } : u));
      else logout();
    });
    if (!tokenStore.get()) { setLoading(false); return; }
    get('/auth/me').then((d) => setUser(d.user)).catch(() => logout()).finally(() => setLoading(false));
  }, [logout]);

  const login = async (email, password) => {
    const d = await post('/auth/login', { email, password });
    tokenStore.set(d.token);
    setUser(d.user);
    return d.user;
  };

  const changePassword = async (current_password, new_password) => {
    const d = await post('/auth/change-password', { current_password, new_password });
    tokenStore.set(d.token);
    setUser(d.user);
  };

  const value = useMemo(() => ({ user, loading, login, logout, changePassword }), [user, loading, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
