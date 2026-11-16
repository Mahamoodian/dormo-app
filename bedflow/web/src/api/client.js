const BASE = import.meta.env.VITE_API_URL || '';
const TOKEN_KEY = 'bedflow.token';

let onAuthError = () => {};
export const setAuthErrorHandler = (fn) => { onAuthError = fn; };

export const tokenStore = {
  get: () => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } },
  set: (t) => { try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ } },
};

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error || `Request failed (${status})`);
    this.status = status;
    this.code = body?.code;
  }
}

export async function api(path, { method = 'GET', body, params } = {}) {
  const url = new URL(`${BASE}/api${path}`, window.location.origin);
  if (params) Object.entries(params).forEach(([k, v]) => v !== undefined && v !== '' && v !== null && url.searchParams.set(k, v));
  const token = tokenStore.get();
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const err = new ApiError(res.status, data);
    if (res.status === 401 || err.code === 'PASSWORD_CHANGE_REQUIRED') onAuthError(err);
    throw err;
  }
  return data;
}

export const get = (p, params) => api(p, { params });
export const post = (p, body) => api(p, { method: 'POST', body: body ?? {} });
export const patch = (p, body) => api(p, { method: 'PATCH', body });
export const del = (p) => api(p, { method: 'DELETE' });
