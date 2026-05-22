'use strict';

/* ─── Gate ──────────────────────────────────────────────────────────────── */
const ADMIN_KEY = 'thread_admin_authed';

(function checkAdminGate() {
  try {
    if (sessionStorage.getItem(ADMIN_KEY) === '1') {
      unlock();
    }
  } catch(e) {
    // If anything crashes during auto-unlock, just show the gate
    sessionStorage.removeItem(ADMIN_KEY);
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
  try {
    document.getElementById('adminGate').style.display = 'none';
    document.getElementById('adminApp').style.display  = 'flex';
    updateModeBadge();
    loadAllData();
  } catch(e) {
    // If crash, clear session and reload so the gate shows
    sessionStorage.removeItem(ADMIN_KEY);
    window.location.reload();
  }
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

/* ─── Mobile sidebar ────────────────────────────────────────────────────── */
function openSidebar() {
  document.getElementById('adSidebar').classList.add('open');
  document.getElementById('sidebarOverlay').classList.add('open');
  document.body.style.overflow = 'hidden';
}
function closeSidebar() {
  document.getElementById('adSidebar').classList.remove('open');
  document.getElementById('sidebarOverlay').classList.remove('open');
  document.body.style.overflow = '';
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

  const safe = (fn, name) => { try { fn(); } catch(e) { console.error(`[admin crash] ${name}:`, e); refresh.textContent = `ERROR in ${name}: ${e.message}`; } };
  safe(renderOverview,  'renderOverview');
  safe(renderOrders,    'renderOrders');
  safe(renderCustomers, 'renderCustomers');
  safe(renderReferrals, 'renderReferrals');
  safe(loadDropBoxes,   'loadDropBoxes');
  safe(() => showSection('overview'), 'showSection');

  if (!refresh.textContent.startsWith('ERROR')) refresh.textContent = 'Updated ' + new Date().toLocaleTimeString();
}

// Auto-refresh every 30 seconds so conversions, scans and orders appear live
setInterval(() => {
  if (sessionStorage.getItem(ADMIN_KEY) === '1') loadAllData();
}, 30000);

/* ─────────────────────────────────────────────────────────────────────────
   DROP BOX QUEUE  (tier-up physical reward fulfillment)
───────────────────────────────────────────────────────────────────────── */
const DROPBOX_KEY = 'thread_admin_dropboxes_shipped';
function getShippedDropboxes() {
  try { return JSON.parse(localStorage.getItem(DROPBOX_KEY) || '[]'); }
  catch { return []; }
}
function saveShippedDropboxes(list) {
  localStorage.setItem(DROPBOX_KEY, JSON.stringify(list));
}
function markDropboxShipped(referrerId, tierId, wearerName) {
  const list = getShippedDropboxes();
  list.push({ referrerId, tierId, wearerName, shippedAt: Date.now() });
  saveShippedDropboxes(list);
  loadDropBoxes();
}
function undoDropboxShipped(referrerId, tierId) {
  const list = getShippedDropboxes().filter(x => !(x.referrerId === referrerId && x.tierId === tierId));
  saveShippedDropboxes(list);
  loadDropBoxes();
}

async function loadDropBoxes() {
  if (!window.ThreadTiers) return;

  // 1. Build a referrer-id → { name, email, code, conversions } map from scans + customers
  const byReferrerId = {};
  allScans.forEach(s => {
    if (!s.referrer_id) return;
    if (!byReferrerId[s.referrer_id]) {
      byReferrerId[s.referrer_id] = { conversions: 0, code: s.referral_code };
    }
    if (s.converted) byReferrerId[s.referrer_id].conversions++;
  });
  // Attach customer details
  Object.keys(byReferrerId).forEach(id => {
    const cust = allCustomers.find(c => c.id === id || c.user_id === id);
    if (cust) {
      byReferrerId[id].name  = cust.name || cust.email || '—';
      byReferrerId[id].email = cust.email;
    } else {
      byReferrerId[id].name  = byReferrerId[id].code || 'Unknown';
      byReferrerId[id].email = '—';
    }
  });

  // 2. Compute owed drop boxes (every tier-up earns a box; track shipped state)
  const shipped = getShippedDropboxes();
  const isShipped = (referrerId, tierId) =>
    shipped.some(x => x.referrerId === referrerId && x.tierId === tierId);

  const owed = [];
  Object.entries(byReferrerId).forEach(([refId, info]) => {
    window.ThreadTiers.TIERS.forEach(tier => {
      if (!tier.unlockReward) return;                       // Starter has no box
      if (info.conversions >= tier.minSales && !isShipped(refId, tier.id)) {
        owed.push({ referrerId: refId, ...info, tier });
      }
    });
  });

  // 3. Render queue
  const body  = document.getElementById('dropBoxBody');
  const badge = document.getElementById('dropBoxBadge');
  if (badge) badge.textContent = owed.length;

  if (!owed.length) {
    body.innerHTML = `<tr><td colspan="6" class="ad-empty">No pending drop boxes 👌</td></tr>`;
  } else {
    body.innerHTML = owed.map(r => {
      const contents = r.tier.unlockReward.items.map(i => `<li>${i}</li>`).join('');
      return `
        <tr>
          <td><strong>${escapeHtml(r.name)}</strong></td>
          <td>${escapeHtml(r.email)}</td>
          <td><span class="db-tier-pill db-tier-${r.tier.id}">${r.tier.emoji} ${r.tier.name}</span></td>
          <td><strong>${r.conversions}</strong></td>
          <td><ul class="db-contents">${contents}</ul></td>
          <td>
            <button class="ad-action-btn ship" onclick="markDropboxShipped('${r.referrerId}','${r.tier.id}','${escapeHtml(r.name)}')">
              ✓ Mark Shipped
            </button>
          </td>
        </tr>
      `;
    }).join('');
  }

  // 4. Render history
  const histBody = document.getElementById('dropBoxHistoryBody');
  if (!shipped.length) {
    histBody.innerHTML = `<tr><td colspan="4" class="ad-empty">No shipped drop boxes yet</td></tr>`;
  } else {
    histBody.innerHTML = shipped.slice().reverse().map(s => {
      const tier = window.ThreadTiers.TIERS.find(t => t.id === s.tierId);
      return `
        <tr>
          <td>${escapeHtml(s.wearerName || '—')}</td>
          <td><span class="db-tier-pill db-tier-${s.tierId}">${tier?.emoji || '🎁'} ${tier?.name || s.tierId}</span></td>
          <td>${new Date(s.shippedAt).toLocaleDateString()} ${new Date(s.shippedAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</td>
          <td><button class="ad-action-btn refund-btn" onclick="undoDropboxShipped('${s.referrerId}','${s.tierId}')">Undo</button></td>
        </tr>
      `;
    }).join('');
  }

  // 5. Stat counts
  const totalPending = owed.length;
  const totalHustler = owed.filter(o => o.tier.id === 'hustler').length;
  const totalElite   = owed.filter(o => o.tier.id === 'elite').length;
  const totalShipped = shipped.length;
  document.getElementById('dbPending').textContent = totalPending;
  document.getElementById('dbHustler').textContent = totalHustler;
  document.getElementById('dbElite').textContent   = totalElite;
  document.getElementById('dbShipped').textContent = totalShipped;
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
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
      (o.order_number || '').toLowerCase().includes(search) ||
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
  const displayId = o.order_number || o.id || '';
  const idShort = displayId.length > 16 ? displayId.slice(0, 16) + '...' : displayId;
  const ref     = o.referral_code ? `<code style="font-size:11px">${o.referral_code}</code>` : '—';

  const action = showAction
    ? `<button class="ad-action-btn" onclick="openStatusModal('${o.id}')">Edit</button>`
    : '';

  return `<tr>
    <td><code style="font-size:11px">${idShort}</code></td>
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
    const referrer = c.referred_by
      ? allCustomers.find(r => r.referral_code === c.referred_by)
      : null;
    const referredBy = referrer
      ? `<span style="font-weight:600">${referrer.name || '—'}</span><br><span style="font-size:11px;color:#888">${referrer.email || ''}</span>`
      : (c.referred_by ? `<code style="font-size:11px">${c.referred_by}</code>` : '<span style="color:#555">—</span>');
    const code = c.referral_code || c.referralCode || '';
    const username = c.username ? `<span style="color:#a78bfa;font-weight:600">@${escapeHtml(c.username)}</span>` : '<span style="color:#444">—</span>';
    const qrBtn = code
      ? `<button class="ad-action-btn" style="background:#111;color:#fff;margin-right:4px" onclick="downloadQR('${escapeHtml(code)}','${escapeHtml(c.name || code)}','black')">⬛ Black</button><button class="ad-action-btn" style="background:#fff;color:#111;border:1px solid #555" onclick="downloadQR('${escapeHtml(code)}','${escapeHtml(c.name || code)}','white')">⬜ White</button>`
      : '<span style="color:#555">—</span>';
    return `<tr>
      <td><strong>${c.name || '—'}</strong></td>
      <td>${c.email || '—'}</td>
      <td>${username}</td>
      <td>${referredBy}</td>
      <td><code style="font-size:11px">${code || '—'}</code></td>
      <td>${customerOrders.length}</td>
      <td style="font-family:var(--mono)">$${spent.toFixed(2)}</td>
      <td>${joined}</td>
      <td>${qrBtn}</td>
    </tr>`;
  }).join('') : '<tr><td colspan="9" class="ad-empty">No customers</td></tr>';
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

  // Helper: look up readable label for a referrer from allCustomers
  function referrerLabel(referrerId, referralCode) {
    const cust = allCustomers.find(c => c.id === referrerId || c.user_id === referrerId)
               || allCustomers.find(c => (c.referral_code || c.referralCode) === referralCode);
    if (!cust) return referralCode || referrerId || '—';
    return cust.name && cust.name.trim() ? cust.name : (cust.email || referralCode || '—');
  }

  // Helper: turn raw city/source values into readable labels
  function cleanLocation(raw) {
    if (!raw) return '—';
    const map = {
      parallaxStrip:  'Homepage',
      parallaxStrip2: 'Homepage',
      parallaxBg:     'Homepage',
      parallaxBg2:    'Homepage',
      heroSection:    'Homepage',
      hero:           'Homepage',
      productSection: 'Products',
      checkoutPage:   'Checkout',
      catalogPage:    'Catalog',
    };
    return map[raw] || raw;
  }

  // Group by referrer
  const byReferrer = {};
  allScans.forEach(s => {
    const key  = s.referrer_id || s.referral_code;
    const name = referrerLabel(s.referrer_id, s.referral_code);
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
    <td><strong>${escapeHtml(r.name)}</strong></td>
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
    const rLabel = referrerLabel(s.referrer_id, s.referral_code);
    return `<tr>
      <td style="white-space:nowrap">${when}</td>
      <td>${escapeHtml(rLabel)}</td>
      <td><code style="font-size:11px">${s.referral_code || '—'}</code></td>
      <td>${cleanLocation(s.city)}</td>
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

/* ─────────────────────────────────────────────────────────────────────────
   QR CODE DOWNLOAD
   Generates a 600×600 QR linking to mythread.shop/?ref=CODE and downloads
   it as a PNG you can drop straight onto the hoodie/tee print file.
───────────────────────────────────────────────────────────────────────── */
async function downloadQR(code, name, color) {
  if (!window.QRCodeStyling) {
    alert('QR library not loaded — please refresh and try again.');
    return;
  }

  const isWhite  = color === 'white';
  const dotColor = isWhite ? '#ffffff' : '#000000';
  // Use a chroma-key background that won't appear in the dots or logo:
  // black QR  → cyan bg  (#00ffff) → strip R<50 & G>200 & B>200
  // white QR  → lime bg  (#00ff00) → strip R<50 & G>200 & B<50
  const bgColor  = isWhite ? '#00ff00' : '#00ffff';

  const url      = `https://mythread.shop/?ref=${encodeURIComponent(code)}`;
  const safeName = (name || code).replace(/[^a-zA-Z0-9_-]/g, '_');
  const label    = isWhite ? 'WHITE' : 'BLACK';

  // Black QR uses Transparent-Logo.png, White QR uses No-background-t-Logo.png
  const logoFile = isWhite ? 'No-background-t-Logo.png' : 'Transparent-Logo.png';
  let logoDataUrl = null;
  try {
    const r = await fetch(`${window.location.origin}/images/${logoFile}`);
    if (r.ok) {
      const blob = await r.blob();
      logoDataUrl = await new Promise(res => {
        const fr = new FileReader();
        fr.onloadend = () => res(fr.result);
        fr.readAsDataURL(blob);
      });
    }
  } catch(_) {}

  const qr = new QRCodeStyling({
    width:  1200,
    height: 1200,
    type:   'canvas',
    data:   url,
    margin: 40,
    qrOptions:            { errorCorrectionLevel: 'H' },
    dotsOptions:          { color: dotColor, type: 'dots' },
    cornersSquareOptions: { color: dotColor, type: 'extra-rounded' },
    cornersDotOptions:    { color: dotColor, type: 'dot' },
    backgroundOptions:    { color: bgColor },
    ...(logoDataUrl ? {
      image: logoDataUrl,
      imageOptions: { margin: 8, imageSize: 0.25, hideBackgroundDots: true }
    } : {})
  });

  const hidden = document.createElement('div');
  hidden.style.cssText = 'position:fixed;left:-9999px;top:-9999px;';
  document.body.appendChild(hidden);
  qr.append(hidden);

  setTimeout(() => {
    const canvas = hidden.querySelector('canvas');
    if (!canvas) { qr.download({ name: `THREAD-QR-${label}-${safeName}`, extension: 'png' }); hidden.remove(); return; }

    const out = document.createElement('canvas');
    out.width  = canvas.width;
    out.height = canvas.height;
    const ctx  = out.getContext('2d');
    ctx.clearRect(0, 0, out.width, out.height);
    ctx.drawImage(canvas, 0, 0);

    // Strip chroma-key background only — leaves dots and logo untouched
    const imgData = ctx.getImageData(0, 0, out.width, out.height);
    const d = imgData.data;
    for (let i = 0; i < d.length; i += 4) {
      if (isWhite) {
        // Remove lime green: R<50, G>200, B<50
        if (d[i] < 50 && d[i+1] > 200 && d[i+2] < 50) d[i+3] = 0;
      } else {
        // Remove cyan: R<50, G>200, B>200
        if (d[i] < 50 && d[i+1] > 200 && d[i+2] > 200) d[i+3] = 0;
      }
    }
    ctx.putImageData(imgData, 0, 0);

    const link = document.createElement('a');
    link.download = `THREAD-QR-${label}-${safeName}.png`;
    link.href = out.toDataURL('image/png');
    link.click();
    hidden.remove();
  }, 1000);
}
