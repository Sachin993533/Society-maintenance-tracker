// ===================== State =====================
let currentUser = null; // { id, name, email, role, flat_number }
let currentView = 'complaints';

// Base URL the backend serves uploaded photos from (strip trailing /api)
const FILE_BASE = API_BASE.replace(/\/api\/?$/, '');

// ===================== Helpers =====================
function $(sel, root = document) { return root.querySelector(sel); }
function $all(sel, root = document) { return [...root.querySelectorAll(sel)]; }

function showToast(msg, isError = false) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.toggle('error', isError);
  el.classList.remove('hidden');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => el.classList.add('hidden'), 3500);
}

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso.endsWith('Z') || iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function statusClass(status) { return status.replace(/\s+/g, '-'); }

// ===================== Auth =====================
async function init() {
  const token = Api.loadToken();
  if (token) {
    try {
      const { user } = await Api.me();
      currentUser = user;
      enterApp();
      return;
    } catch (e) {
      Api.setToken(null);
    }
  }
  showAuthView();
}

function showAuthView() {
  $('#mainNav').classList.add('hidden');
  $('#view-auth').classList.remove('hidden');
  ['complaints', 'notices', 'dashboard'].forEach((v) => $(`#view-${v}`).classList.add('hidden'));
}

function enterApp() {
  $('#mainNav').classList.remove('hidden');
  $('#view-auth').classList.add('hidden');
  $('#navUser').textContent = `${currentUser.name} · ${currentUser.role}`;

  const isAdmin = currentUser.role === 'admin';
  $all('.admin-only').forEach((el) => el.classList.toggle('hidden', !isAdmin));
  $('#raiseComplaintCard').classList.toggle('hidden', isAdmin);
  $('#adminFilterCard').classList.toggle('hidden', !isAdmin);
  $('#postNoticeCard').classList.toggle('hidden', !isAdmin);
  $('#complaintsListTitle').textContent = isAdmin ? 'All complaints' : 'My complaints';

  switchView('complaints');
}

$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  $('#loginError').textContent = '';
  try {
    const { user, token } = await Api.login({ email: fd.get('email'), password: fd.get('password') });
    Api.setToken(token);
    currentUser = user;
    enterApp();
  } catch (err) {
    $('#loginError').textContent = err.message;
  }
});

$('#registerForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  $('#registerError').textContent = '';
  try {
    const { user, token } = await Api.register({
      name: fd.get('name'),
      email: fd.get('email'),
      password: fd.get('password'),
      flatNumber: fd.get('flatNumber'),
    });
    Api.setToken(token);
    currentUser = user;
    enterApp();
  } catch (err) {
    $('#registerError').textContent = err.message;
  }
});

$all('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    $all('.tab').forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    const which = tab.dataset.tab;
    $('#loginForm').classList.toggle('hidden', which !== 'login');
    $('#registerForm').classList.toggle('hidden', which !== 'register');
  });
});

$('#logoutBtn').addEventListener('click', () => {
  Api.setToken(null);
  currentUser = null;
  showAuthView();
});

// ===================== Nav / views =====================
$all('.nav-link').forEach((btn) => {
  btn.addEventListener('click', () => switchView(btn.dataset.view));
});

function switchView(view) {
  currentView = view;
  ['complaints', 'notices', 'dashboard'].forEach((v) => $(`#view-${v}`).classList.toggle('hidden', v !== view));
  $all('.nav-link').forEach((b) => b.classList.toggle('active', b.dataset.view === view));

  if (view === 'complaints') loadComplaints();
  if (view === 'notices') loadNotices();
  if (view === 'dashboard') loadDashboard();
}

// ===================== Complaints =====================
$('#complaintForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const fd = new FormData(form);
  $('#complaintError').textContent = '';
  try {
    await Api.createComplaint(fd);
    form.reset();
    showToast('Complaint submitted');
    loadComplaints();
  } catch (err) {
    $('#complaintError').textContent = err.message;
  }
});

$('#applyFilters')?.addEventListener('click', loadComplaints);
$('#clearFilters')?.addEventListener('click', () => {
  $('#filterCategory').value = '';
  $('#filterStatus').value = '';
  $('#filterDateFrom').value = '';
  $('#filterDateTo').value = '';
  loadComplaints();
});

async function loadComplaints() {
  const list = $('#complaintsList');
  list.innerHTML = '<p class="muted">Loading…</p>';
  try {
    let complaints;
    if (currentUser.role === 'admin') {
      const params = new URLSearchParams();
      const cat = $('#filterCategory').value;
      const status = $('#filterStatus').value;
      const from = $('#filterDateFrom').value;
      const to = $('#filterDateTo').value;
      if (cat) params.set('category', cat);
      if (status) params.set('status', status);
      if (from) params.set('dateFrom', from);
      if (to) params.set('dateTo', to);
      const q = params.toString() ? `?${params.toString()}` : '';
      ({ complaints } = await Api.allComplaints(q));
    } else {
      ({ complaints } = await Api.myComplaints());
    }
    renderComplaints(complaints);
  } catch (err) {
    list.innerHTML = `<p class="form-error">${err.message}</p>`;
  }
}

function renderComplaints(complaints) {
  const list = $('#complaintsList');
  if (!complaints.length) {
    list.innerHTML = `<div class="empty-state">No complaints ${currentUser.role === 'admin' ? 'match these filters' : 'yet — raise one above'}.</div>`;
    return;
  }
  list.innerHTML = '';
  complaints.forEach((c) => {
    const el = document.createElement('div');
    el.className = `ticket status-${statusClass(c.status)} ${c.overdue ? 'overdue' : ''}`;
    el.innerHTML = `
      <div class="ticket-id">#${String(c.id).padStart(4, '0')}</div>
      ${c.photo_path
        ? `<img class="ticket-photo" src="${FILE_BASE}${c.photo_path}" alt="Complaint photo" />`
        : `<div class="ticket-photo-placeholder"></div>`}
      <div class="ticket-main">
        <div class="ticket-top">
          <span class="ticket-category">${escapeHtml(c.category)}</span>
          <span class="badge badge-priority-${c.priority}">${c.priority}</span>
          ${c.overdue ? '<span class="badge badge-overdue">Overdue</span>' : ''}
        </div>
        <div class="ticket-desc">${escapeHtml(c.description)}</div>
        <div class="ticket-meta">
          ${currentUser.role === 'admin' ? `${escapeHtml(c.resident_name || '')}${c.flat_number ? ' · ' + escapeHtml(c.flat_number) : ''} · ` : ''}
          raised ${fmtDate(c.created_at)}
        </div>
      </div>
      <div class="ticket-side">
        <span class="badge badge-${statusClass(c.status)}">${c.status}</span>
      </div>
    `;
    el.addEventListener('click', () => openDetail(c.id));
    list.appendChild(el);
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

// ===================== Complaint detail modal =====================
$('#closeDetail').addEventListener('click', () => $('#detailModal').classList.add('hidden'));
$('#detailModal').addEventListener('click', (e) => {
  if (e.target.id === 'detailModal') $('#detailModal').classList.add('hidden');
});

async function openDetail(id) {
  const modal = $('#detailModal');
  const content = $('#detailContent');
  content.innerHTML = '<p class="muted">Loading…</p>';
  modal.classList.remove('hidden');
  try {
    const { complaint, history } = await Api.complaintDetail(id);
    renderDetail(complaint, history);
  } catch (err) {
    content.innerHTML = `<p class="form-error">${err.message}</p>`;
  }
}

function renderDetail(c, history) {
  const content = $('#detailContent');
  const isAdmin = currentUser.role === 'admin';

  content.innerHTML = `
    <div class="ticket-id">Work Order #${String(c.id).padStart(4, '0')}</div>
    <h2>${escapeHtml(c.category)}</h2>
    <div class="ticket-top" style="margin-bottom:10px;">
      <span class="badge badge-${statusClass(c.status)}">${c.status}</span>
      <span class="badge badge-priority-${c.priority}">${c.priority} priority</span>
      ${c.overdue ? '<span class="badge badge-overdue">Overdue</span>' : ''}
    </div>
    <p>${escapeHtml(c.description)}</p>
    ${c.photo_path ? `<img class="detail-photo" src="${FILE_BASE}${c.photo_path}" alt="Complaint photo" />` : ''}

    <h3>History</h3>
    <div id="historyList">
      ${history.map((h) => `
        <div class="history-item">
          <div class="history-status">${h.status}${h.actor_name ? ` — ${escapeHtml(h.actor_name)}` : ''}</div>
          <div class="history-time">${fmtDate(h.timestamp)}</div>
          ${h.note ? `<div class="history-note">${escapeHtml(h.note)}</div>` : ''}
        </div>
      `).join('')}
    </div>

    ${isAdmin && c.status !== 'Resolved' ? `
      <div class="admin-controls">
        <select id="priSelect">
          ${['Low', 'Medium', 'High'].map((p) => `<option ${p === c.priority ? 'selected' : ''}>${p}</option>`).join('')}
        </select>
        <button class="btn btn-ghost btn-sm" id="savePriority">Update priority</button>
        <select id="statusSelect">
          ${['Open', 'In Progress', 'Resolved'].filter((s) => s !== c.status).map((s) => `<option>${s}</option>`).join('')}
        </select>
        <button class="btn btn-primary btn-sm" id="saveStatus">Update status</button>
      </div>
      <input class="note-input" id="statusNote" type="text" placeholder="Optional note for the resident..." />
      <p class="form-error" id="detailError"></p>
    ` : ''}
  `;

  if (isAdmin && c.status !== 'Resolved') {
    $('#savePriority').addEventListener('click', async () => {
      try {
        await Api.updatePriority(c.id, { priority: $('#priSelect').value });
        showToast('Priority updated');
        openDetail(c.id);
        loadComplaints();
      } catch (err) {
        $('#detailError').textContent = err.message;
      }
    });
    $('#saveStatus').addEventListener('click', async () => {
      try {
        await Api.updateStatus(c.id, { status: $('#statusSelect').value, note: $('#statusNote').value });
        showToast('Status updated — resident notified by email');
        openDetail(c.id);
        loadComplaints();
      } catch (err) {
        $('#detailError').textContent = err.message;
      }
    });
  }
}

// ===================== Notices =====================
$('#noticeForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  $('#noticeError').textContent = '';
  try {
    await Api.postNotice({
      title: fd.get('title'),
      content: fd.get('content'),
      important: fd.get('important') === 'on',
    });
    e.target.reset();
    showToast('Notice posted');
    loadNotices();
  } catch (err) {
    $('#noticeError').textContent = err.message;
  }
});

async function loadNotices() {
  const list = $('#noticesList');
  list.innerHTML = '<p class="muted">Loading…</p>';
  try {
    const { notices } = await Api.listNotices();
    if (!notices.length) {
      list.innerHTML = '<div class="empty-state">No notices posted yet.</div>';
      return;
    }
    list.innerHTML = notices.map((n) => `
      <div class="notice ${n.important ? 'important' : ''}">
        <div class="notice-title-row">
          ${n.important ? '<span class="pin">&#128204;</span>' : ''}
          <h3>${escapeHtml(n.title)}</h3>
        </div>
        <div class="notice-content">${escapeHtml(n.content)}</div>
        <div class="notice-meta">${escapeHtml(n.author_name || 'Admin')} · ${fmtDate(n.created_at)}</div>
      </div>
    `).join('');
  } catch (err) {
    list.innerHTML = `<p class="form-error">${err.message}</p>`;
  }
}

// ===================== Dashboard =====================
async function loadDashboard() {
  const grid = $('#dashboardStats');
  grid.innerHTML = '<p class="muted">Loading…</p>';
  try {
    const stats = await Api.dashboard();
    grid.innerHTML = `
      <div class="stat-card">
        <h3>Total complaints</h3>
        <div class="stat-big">${stats.total}</div>
      </div>
      <div class="stat-card stat-overdue">
        <h3>Overdue (&gt; ${stats.overdue.thresholdDays}d open)</h3>
        <div class="stat-big">${stats.overdue.count}</div>
      </div>
      <div class="stat-card">
        <h3>By status</h3>
        ${stats.byStatus.map((s) => `<div class="stat-row"><span>${s.status}</span><strong>${s.count}</strong></div>`).join('') || '<p class="muted">No data</p>'}
      </div>
      <div class="stat-card">
        <h3>By category</h3>
        ${stats.byCategory.map((c) => `<div class="stat-row"><span>${escapeHtml(c.category)}</span><strong>${c.count}</strong></div>`).join('') || '<p class="muted">No data</p>'}
      </div>
    `;
  } catch (err) {
    grid.innerHTML = `<p class="form-error">${err.message}</p>`;
  }
}

// ===================== Boot =====================
init();
