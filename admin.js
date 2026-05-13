'use strict';

/* ─── Gate ──────────────────────────────────────────────────────────────── */
const ADMIN_KEY = 'thread_admin_authed';

(function checkAdminGate() {
  if (sessionStorage.getItem(ADMIN_KEY) === '1') {
    unlock();
  }
})();

function checkGate() {
  const pw  = document.getElementById('gatePassword').value;
  const cfg = window.THREAD_CONFIG;
  if (pw === (cfg?.adminPassword || 'thread_admin_2024')) {
    sessionStorage.setItem(ADMIN_KEY, '1');
    unlock();
  } else {
    document.getElementById('gateError').textContent = 'Incorrect password.';
    document.getElementById('gatePassword').classList.add('shake');
    setTimeout(() => document.getElementById('gatePassword').classList.remove('shake'), 500);
  }
}

function unlock() {
  document.getElementById('adminGate').style.display = 'none';
  document.getElementById('adminApp').style.display  = 'flex';
  updateModeBadge();
  loadAllData();
}

function adminSignOut() {
  sessionStorage.removeItem(ADMIN_KEY);
  window.location.reload();
}

/* ─── Mode badge ────────────────────────────────────────────────────────── */
function updateModeBadge() {
  const badge = document.getElementById('adModeBadge');
  if (DB.isLive()) {
    badge.textContent = '● LIVE — Supabase';
    badge.classList.add('live');
  } else {
    badge.textContent = '⚠ LOCAL MODE';
  }
}

/* ─── Navigation ────────────────────────────────────────────────────────── */
let currentSection = 'overview';

function showSection(name) {
  document.querySelectorAll('.ad-section').forEach(s => s.style.display = 'none');
  document.querySelectorAll('.ad-nav-item').forEach(b => b.classList.toggle('active', b.dataset.section === name));
  document.getElementById('sec-' + name).style.display = 'flex';
  document.getElementById('adPageTitle').textContent = name.charAt(0).toUpperCase() + name.slice(1);
  currentSection = name;
}

/* ─── Data store ────────────────────────────────────────────────────────── */
let allOrders    = [];
let allCustomers = [];
let allScans     = [];
let currentOrderFilter = 'all';

/* ─── Load everything ───────────────────────────────────────────────────── */
async function loadAllData() {
  const refresh = document.getElementById('adLastRefresh');
  refresh.textContent = 'Loading…';

  try {
    [allOrders, allCustomers, allScans] = await Promise.all([
      DB.orders.getAll(),
      DB.customers.getAll(),
      DB.referrals.getAll()
    ]);
  } catch (e) {
    console.warn('Admin data load error:', e);
  }

  renderOverview();
  renderOrders();
  renderCustomers();
  renderReferrals();

  refresh.textContent = 'Updated ' + new Date().toLocaleTimeString();
}

/* ─────────────────────────────────────────────────────────────────────────
   OVERVIEW
───────────────────────────────────────────────────────────────────────── */
function renderOverview() {
  const paidOrders    = allOrders.filter(o => o.status === 'paid' || o.status === 'shipped' || o.status === 'delivered');
  const pendingOrders = allOrders.filter(o => o.status === 'pending');
  const revenue       = paidOrders.reduce((s, o) => s + parseFloat(o.total || 0), 0);
  const commissions   = allScans.filter(s => s.converted).reduce((s, r) => s + parseFloat(r.commission || 0), 0);

  document.getElementById('ovRevenue').textContent   = '$' + revenue.toFixed(2);
  document.getElementById('ovRevSub').textContent    = `from ${paidOrders.length} paid orders`;
  document.getElementById('ovOrders').textContent    = allOrders.length;
  document.getElementById('ovOrdSub').textContent    = `${pendingOrders.length} pending`;
  document.getElementById('ovCustomers').textContent = allCustomers.length;
  document.getElementById('ovCommissions').textContent = '$' + commissions.toFixed(2);

  // Pending badge
  const badge = document.getElementById('pendingBadge');
  if (pendingOrders.length > 0) {
    badge.textContent = pendingOrders.length;
    badge.classList.add('show');
  }

  // Recent orders table (last 5)
  const tbody = document.getElementById('recentOrdersBody');
  const recent = [...allOrders].slice(0, 5);
  tbody.innerHTML = recent.length ? recent.map(o => orderRow(o, false)).join('') :
    '<tr><td colspan="6" class="ad-empty">No orders yet</td></tr>';

  // Revenue chart (last 30 days)
  renderRevenueChart();
}

function renderRevenueChart() {
  const container = document.getElementById('revenueChartBars');
  const today     = new Date();
  const days      = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    days.push(d);
  }

  const dailyRevenue = days.map(day => {
    const dayStr = day.toISOString().split('T')[0];
    return allOrders
      .filter(o => (o.created_at || '').startsWith(dayStr) &&
        ['paid','shipped','delivered'].includes(o.status))
      .reduce((s, o) => s + parseFloat(o.total || 0), 0);
  });

  const max = Math.max(...dailyRevenue, 1);

  container.innerHTML = days.map((d, i) => {
    const h   = Math.round((dailyRevenue[i] / max) * 100);
    const lbl = d.getDate() === 1 ? d.toLocaleString('default', { month: 'short' }) :
               (i % 5 === 0 ? d.getDate() : '');
    return `<div class="chart-bar-wrap">
      <div class="chart-bar ${dailyRevenue[i] > 0 ? 'has-value' : ''}"
           style="height:${Math.max(h, 2)}px"
           title="${d.toLocaleDateString()}: $${dailyRevenue[i].toFixed(2)}"></div>
      <div class="chart-label">${lbl}</div>
    </div>`;
  }).join('');
}

/* ─────────────────────────────────────────────────────────────────────────
   ORDERS
───────────────────────────────────────────────────────────────────────── */
function filterOrders(filter, btn) {
  currentOrderFilter = filter;
  if (btn) {
    document.querySelectorAll('.ad-filter').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  }
  renderOrders();
}

function renderOrders() {
  const search = (document.getElementById('orderSearch')?.value || '').toLowerCase();
  let filtered = allOrders;

  if (currentOrderFilter !== 'all') {
    filtered = filtered.filter(o => o.status === currentOrderFilter);
  }
  if (search) {
    filtered = filtered.filter(o =>
      (o.id || '').toLowerCase().includes(search) ||
      (o.customer_email || '').toLowerCase().includes(search) ||
      (o.profiles?.email || '').toLowerCase().includes(search) ||
      (o.profiles?.name  || '').toLowerCase().includes(search)
    );
  }

  const tbody = document.getElementById('ordersBody');
  tbody.innerHTML = filtered.length ? filtered.map(o => orderRow(o, true)).join('') :
    '<tr><td colspan="8" class="ad-empty">No orders match</td></tr>';
}

function orderRow(o, showAction) {
  const customer = o.profiles?.name || o.customer_email || '—';
  const items    = Array.isArray(o.items)
    ? o.items.map(i => `${i.name} ×${i.qty}`).join(', ')
    : '—';
  const date = o.created_at
    ? new Date(o.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : '—';
  const idShort = (o.id || '').slice(0, 12);
  const ref     = o.referral_code ? `<code style="font-size:11px">${o.referral_code}</code>` : '—';

  const action = showAction
    ? `<button class="ad-action-btn" onclick="openStatusModal('${o.id}')">Edit</button>`
    : '';

  return `<tr>
    <td><code style="font-size:11px">${idShort}…</code></td>
    <td>${customer}</td>
    <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${items}</td>
    <td style="font-family:var(--mono)">$${parseFloat(o.total||0).toFixed(2)}</td>
    ${showAction ? `<td>${ref}</td>` : ''}
    <td><span class="status-pill s-${o.status||'pending'}">${o.status||'pending'}</span></td>
    <td style="white-space:nowrap">${date}</td>
    ${showAction ? `<td>${action}</td>` : ''}
  </tr>`;
}

/* ─────────────────────────────────────────────────────────────────────────
   CUSTOMERS
───────────────────────────────────────────────────────────────────────── */
function renderCustomers() {
  const search = (document.getElementById('customerSearch')?.value || '').toLowerCase();
  let filtered = allCustomers;
  if (search) {
    filtered = filtered.filter(c =>
      (c.name  || '').toLowerCase().includes(search) ||
      (c.email || '').toLowerCase().includes(search)
    );
  }

  const tbody = document.getElementById('customersBody');
  tbody.innerHTML = filtered.length ? filtered.map(c => {
    const customerOrders = allOrders.filter(o => o.user_id === c.id || o.customer_email === c.email);
    const spent = customerOrders.filter(o => ['paid','shipped','delivered'].includes(o.status))
      .reduce((s, o) => s + parseFloat(o.total || 0), 0);
    const joined = c.created_at
      ? new Date(c.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      : '—';
    return `<tr>
      <td><strong>${c.name || '—'}</strong></td>
      <td>${c.email || '—'}</td>
      <td><code style="font-size:11px">${c.referral_code || c.referralCode || '—'}</code></td>
      <td>${customerOrders.length}</td>
      <td style="font-family:var(--mono)">$${spent.toFixed(2)}</td>
      <td>${joined}</td>
    </tr>`;
  }).join('') : '<tr><td colspan="6" class="ad-empty">No customers</td></tr>';
}

/* ─────────────────────────────────────────────────────────────────────────
   REFERRALS
───────────────────────────────────────────────────────────────────────── */
function renderReferrals() {
  const conversions = allScans.filter(s => s.converted);
  const convRate    = allScans.length ? ((conversions.length / allScans.length) * 100).toFixed(1) : 0;
  const commTotal   = conversions.reduce((s, r) => s + parseFloat(r.commission || 0), 0);

  document.getElementById('refTotalScans').textContent   = allScans.length;
  document.getElementById('refConversions').textContent  = conversions.length;
  document.getElementById('refConvRate').textContent     = `${convRate}% conversion rate`;
  document.getElementById('refCommPaid').textContent     = '$' + commTotal.toFixed(2);

  // Group by referrer
  const byReferrer = {};
  allScans.forEach(s => {
    const key  = s.referrer_id || s.referral_code;
    const name = s.profiles?.name || s.referral_code || key;
    if (!byReferrer[key]) byReferrer[key] = { name, code: s.referral_code, scans: 0, convs: 0, earned: 0, pending: 0 };
    byReferrer[key].scans++;
    if (s.converted) {
      byReferrer[key].convs++;
      byReferrer[key].earned += parseFloat(s.commission || 0);
      if (s.status === 'pending') byReferrer[key].pending += parseFloat(s.commission || 0);
    }
  });

  const sorted = Object.values(byReferrer).sort((a, b) => b.earned - a.earned);

  if (sorted.length) {
    document.getElementById('refTopEarner').textContent    = sorted[0].name;
    document.getElementById('refTopEarnerSub').textContent = `$${sorted[0].earned.toFixed(2)} earned`;
  }

  // Top referrers table
  const topBody = document.getElementById('topReferrersBody');
  topBody.innerHTML = sorted.length ? sorted.slice(0, 20).map(r => `<tr>
    <td><strong>${r.name}</strong></td>
    <td><code style="font-size:11px">${r.code}</code></td>
    <td>${r.scans}</td>
    <td>${r.convs}</td>
    <td style="font-family:var(--mono);color:#00e676">$${r.earned.toFixed(2)}</td>
    <td style="font-family:var(--mono);color:#ffd54f">$${r.pending.toFixed(2)}</td>
  </tr>`).join('') : '<tr><td colspan="6" class="ad-empty">No referral data yet</td></tr>';

  // Recent scans table
  const scanBody = document.getElementById('recentScansBody');
  const recent   = allScans.slice(0, 50);
  scanBody.innerHTML = recent.length ? recent.map(s => {
    const when = s.created_at
      ? new Date(s.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
      : '—';
    return `<tr>
      <td style="white-space:nowrap">${when}</td>
      <td>${s.profiles?.name || '—'}</td>
      <td><code style="font-size:11px">${s.referral_code || '—'}</code></td>
      <td>${s.city || '—'}</td>
      <td>${s.converted
        ? '<span class="status-pill s-paid">Yes</span>'
        : '<span class="status-pill s-pending">No</span>'}</td>
      <td style="font-family:var(--mono)">${s.converted ? '$' + parseFloat(s.commission||0).toFixed(2) : '—'}</td>
    </tr>`;
  }).join('') : '<tr><td colspan="6" class="ad-empty">No scan events</td></tr>';
}

/* ─────────────────────────────────────────────────────────────────────────
   STATUS MODAL
───────────────────────────────────────────────────────────────────────── */
let _editingOrderId = null;

function openStatusModal(orderId) {
  _editingOrderId = orderId;
  document.getElementById('modalOrderId').textContent = orderId.slice(0, 16) + '…';
  document.getElementById('statusModal').style.display = 'flex';
}

function closeStatusModal() {
  document.getElementById('statusModal').style.display = 'none';
  _editingOrderId = null;
}

async function setStatus(status) {
  if (!_editingOrderId) return;
  await DB.orders.updateStatus(_editingOrderId, status);
  // Update local cache
  const idx = allOrders.findIndex(o => o.id === _editingOrderId);
  if (idx !== -1) allOrders[idx].status = status;
  closeStatusModal();
  renderOverview();
  renderOrders();
}
