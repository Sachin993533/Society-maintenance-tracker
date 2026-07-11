// Simple fetch wrapper for the backend API.
// Change API_BASE when deploying the frontend separately from the backend.
const API_BASE = window.API_BASE_OVERRIDE || 'http://localhost:5000/api';

const Api = {
  token: null,

  setToken(t) {
    this.token = t;
    if (t) localStorage.setItem('mt_token', t);
    else localStorage.removeItem('mt_token');
  },

  loadToken() {
    this.token = localStorage.getItem('mt_token');
    return this.token;
  },

  async request(path, { method = 'GET', body, isForm = false } = {}) {
    const headers = {};
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;
    if (!isForm && body) headers['Content-Type'] = 'application/json';

    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: isForm ? body : body ? JSON.stringify(body) : undefined,
    });

    let data = null;
    try { data = await res.json(); } catch (e) { /* no body */ }

    if (!res.ok) {
      throw new Error((data && data.error) || `Request failed (${res.status})`);
    }
    return data;
  },

  // Auth
  register(payload) { return this.request('/auth/register', { method: 'POST', body: payload }); },
  login(payload) { return this.request('/auth/login', { method: 'POST', body: payload }); },
  me() { return this.request('/auth/me'); },

  // Complaints
  createComplaint(formData) { return this.request('/complaints', { method: 'POST', body: formData, isForm: true }); },
  myComplaints() { return this.request('/complaints/mine'); },
  allComplaints(query = '') { return this.request(`/complaints${query}`); },
  complaintDetail(id) { return this.request(`/complaints/${id}`); },
  updateStatus(id, payload) { return this.request(`/complaints/${id}/status`, { method: 'PATCH', body: payload }); },
  updatePriority(id, payload) { return this.request(`/complaints/${id}/priority`, { method: 'PATCH', body: payload }); },

  // Notices
  listNotices() { return this.request('/notices'); },
  postNotice(payload) { return this.request('/notices', { method: 'POST', body: payload }); },

  // Dashboard
  dashboard() { return this.request('/dashboard'); },
};
