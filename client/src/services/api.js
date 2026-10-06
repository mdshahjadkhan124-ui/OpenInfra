/**
 * Axios API client.
 *
 * One instance for the whole app, with the token attached on every request and
 * a single place that decides what an error message says.
 */
import axios from 'axios';

const TOKEN_KEY = 'openinfra-token';

export const getToken = () => {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    // Private browsing, or site data blocked. Treat as signed out.
    return null;
  }
};

export const setToken = (token) => {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* nothing we can do; the session just will not persist */
  }
};

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  timeout: 180_000, // AI analysis and chain confirmation are genuinely slow
});

api.interceptors.request.use((config) => {
  const token = getToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

/** Listeners notified when the server says our token is no longer valid. */
const unauthorizedHandlers = new Set();
export const onUnauthorized = (handler) => {
  unauthorizedHandlers.add(handler);
  return () => unauthorizedHandlers.delete(handler);
};

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status;
    const body = error.response?.data;

    // An expired or revoked token should sign the user out everywhere at once,
    // rather than leaving each page to discover it independently.
    if (status === 401 && body?.code !== 'UNAUTHORIZED_LOGIN') {
      setToken(null);
      for (const handler of unauthorizedHandlers) handler();
    }

    /**
     * Normalise every failure into one readable string.
     *
     * The server's envelope already carries a user-facing `message` and
     * optional per-field `details`, so the UI should never have to show a raw
     * axios error — and never a bare "Request failed with status code 422".
     */
    const fieldDetail = body?.details?.[0]?.message;
    error.userMessage =
      fieldDetail ||
      body?.message ||
      (error.code === 'ECONNABORTED'
        ? 'That took too long. It may still have gone through — refresh before retrying.'
        : error.message === 'Network Error'
          ? 'Cannot reach the server. Is the API running on port 5000?'
          : 'Something went wrong. Please try again.');

    error.details = body?.details ?? null;
    error.code = body?.code ?? error.code;
    error.status = status ?? null;

    return Promise.reject(error);
  }
);

/** Unwrap the success envelope so callers deal in data, not transport. */
const unwrap = (promise) => promise.then((res) => res.data?.data ?? res.data);
const unwrapFull = (promise) => promise.then((res) => res.data);

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
export const authApi = {
  register: (payload) => unwrap(api.post('/auth/register', payload)),
  login: (payload) => unwrap(api.post('/auth/login', payload)),
  me: () => unwrap(api.get('/auth/me')),
  setWallet: (walletAddress) => unwrap(api.patch('/auth/wallet', { walletAddress })),
  listUsers: (params) => unwrapFull(api.get('/auth/users', { params })),
};

// ---------------------------------------------------------------------------
// Reports (citizen)
// ---------------------------------------------------------------------------
export const reportApi = {
  create: (formData, onUploadProgress) =>
    unwrap(api.post('/reports', formData, { onUploadProgress })),
  mine: (params) => unwrapFull(api.get('/reports/mine', { params })),
  stats: () => unwrap(api.get('/reports/mine/stats')),
  get: (id) => unwrap(api.get(`/reports/${id}`)),
  remove: (id) => unwrap(api.delete(`/reports/${id}`)),
};

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------
export const projectApi = {
  list: (params) => unwrapFull(api.get('/projects', { params })),
  mine: (params) => unwrapFull(api.get('/projects/mine', { params })),
  get: (id) => unwrap(api.get(`/projects/${id}`)),
};

// ---------------------------------------------------------------------------
// Bids (contractor)
// ---------------------------------------------------------------------------
export const bidApi = {
  submit: (payload) => unwrap(api.post('/bids', payload)),
  mine: (params) => unwrapFull(api.get('/bids/mine', { params })),
  withdraw: (id) => unwrap(api.patch(`/bids/${id}/withdraw`)),
};

// ---------------------------------------------------------------------------
// Milestones
// ---------------------------------------------------------------------------
export const milestoneApi = {
  forProject: (projectId) => unwrap(api.get(`/milestones/project/${projectId}`)),
  mine: (params) => unwrap(api.get('/milestones/mine', { params })),
  submitProgress: (id, formData, onUploadProgress) =>
    unwrap(api.post(`/milestones/${id}/progress`, formData, { onUploadProgress })),
};

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------
export const adminApi = {
  stats: () => unwrap(api.get('/admin/stats')),
  reports: (params) => unwrapFull(api.get('/admin/reports', { params })),
  approveReport: (id) => unwrap(api.patch(`/admin/reports/${id}/approve`)),
  rejectReport: (id, reason) => unwrap(api.patch(`/admin/reports/${id}/reject`, { reason })),
  publishReport: (id, payload) => unwrap(api.post(`/admin/reports/${id}/publish`, payload)),

  bidsForProject: (projectId, params) =>
    unwrap(api.get(`/admin/projects/${projectId}/bids`, { params })),
  award: (projectId, payload) => unwrapFull(api.post(`/admin/projects/${projectId}/award`, payload)),

  // --- on-chain, two steps either side of a MetaMask signature ---
  prepareLockFunds: (projectId) =>
    unwrap(api.post(`/admin/projects/${projectId}/lock-funds/prepare`)),
  confirmLockFunds: (projectId, transactionHash) =>
    unwrap(api.post(`/admin/projects/${projectId}/lock-funds/confirm`, { transactionHash })),

  milestones: (params) => unwrap(api.get('/admin/milestones', { params })),
  prepareRelease: (milestoneId, payload) =>
    unwrap(api.post(`/admin/milestones/${milestoneId}/approve/prepare`, payload)),
  confirmRelease: (milestoneId, payload) =>
    unwrapFull(api.post(`/admin/milestones/${milestoneId}/approve/confirm`, payload)),
  rejectMilestone: (milestoneId, reason) =>
    unwrap(api.patch(`/admin/milestones/${milestoneId}/reject`, { reason })),

  escrowContract: () => unwrap(api.get('/admin/escrow-contract')),
  /** One-way sync: read the chain, update our records. Never writes on-chain. */
  syncFromChain: (projectId) => unwrapFull(api.post(`/admin/projects/${projectId}/sync-from-chain`)),
};

// ---------------------------------------------------------------------------
// Public — no authentication. The transparency dashboard's data.
// ---------------------------------------------------------------------------
export const publicApi = {
  stats: () => unwrap(api.get('/public/stats')),
  activity: (params) => unwrap(api.get('/public/activity', { params })),
  projects: (params) => unwrapFull(api.get('/public/projects', { params })),
  project: (id) => unwrap(api.get(`/public/projects/${id}`)),
  /** Live comparison against the chain. Never cached. */
  verify: (id) => unwrap(api.get(`/public/projects/${id}/verify`)),
};

export default api;
