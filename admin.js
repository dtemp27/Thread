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

/* ─── Navigation ────────────────────────────────────────────────────────── */
let currentSection = 'overview';

const SECTION_TITLES = { overview:'Overview', orders:'Orders', customers:'Customers', referrals:'Referrals', dropboxes:'Drop Boxes', analytics:'Analytics', giveaway:'Giveaway' };

function showSection(name) {
  document.querySelectorAll('.ad-section').forEach(s => s.style.display = 'none');
  document.querySelectorAll('.ad-nav-item').forEach(b => b.classList.toggle('active', b.dataset.section === name));
  document.querySelectorAll('.ad-bn-item').forEach(b => b.classList.toggle('active', b.dataset.section === name));
  document.getElementById('sec-' + name).style.display = 'flex';
  document.getElementById('adPageTitle').textContent = SECTION_TITLES[name] || name;
  currentSection = name;
  sessionStorage.setItem('thread_admin_section', name); // persist across refresh
}

/* ─── Data store ────────────────────────────────────────────────────────── */
let allOrders    = [];
let allCustomers = [];
let allScans     = [];
let currentOrderFilter = 'all';
// Set of customer IDs who have at least one add_to_cart event (populated by loadAnalytics)
let _cartUserIds = new Set();

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
  safe(loadAnalytics,   'loadAnalytics');
  safe(loadTrackedQRs,  'loadTrackedQRs');
  safe(loadGiveaway,    'loadGiveaway');
  const savedSection = sessionStorage.getItem('thread_admin_section') || 'overview';
  safe(() => showSection(savedSection), 'showSection');

  if (!refresh.textContent.startsWith('ERROR')) refresh.textContent = 'Updated ' + new Date().toLocaleTimeString();
}

// Auto-refresh removed — refresh manually

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
  const bnDropBadge = document.getElementById('bnDropBadge');
  if (badge) badge.textContent = owed.length;
  if (bnDropBadge) owed.length > 0 ? bnDropBadge.classList.add('show') : bnDropBadge.classList.remove('show');

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

  // Pending badge (sidebar + bottom nav)
  const badge = document.getElementById('pendingBadge');
  const bnBadge = document.getElementById('bnPendingBadge');
  if (pendingOrders.length > 0) {
    badge.textContent = pendingOrders.length;
    badge.classList.add('show');
    if (bnBadge) bnBadge.classList.add('show');
  } else {
    if (bnBadge) bnBadge.classList.remove('show');
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
    '<tr><td colspan="9" class="ad-empty">No orders match</td></tr>';
}

function orderRow(o, showAction) {
  const customer = o.profiles?.name || o.customer_email || '—';
  const items    = Array.isArray(o.items)
    ? o.items.map(i => { const type = i.type === "tee" ? "Tee" : "Hoodie"; return `${i.name} ${type}${i.size ? " ("+i.size+")" : ""} ×${i.qty}`; }).join(", ")
    : '—';
  const date = o.created_at
    ? new Date(o.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : '—';
  const displayId = o.order_number || o.id || '';
  const idShort = displayId.length > 16 ? displayId.slice(0, 16) + '...' : displayId;
  const ref     = o.referral_code ? `<code style="font-size:11px">${o.referral_code}</code>` : '—';

  const buyerCode = o.buyer_qr_code || o.referral_code || '';
  const qrDownload = showAction && buyerCode
    ? `<button class="ad-action-btn" style="background:#111;color:#fff;margin-right:4px" onclick="downloadQR('${escapeHtml(buyerCode)}','${escapeHtml(o.customer_email||buyerCode)}','black')">⬛ QR</button>`
    : '';
  const action = showAction
    ? `<button class="ad-action-btn" onclick="openStatusModal('${o.id}')">Edit</button>`
    : '';

  return `<tr>
    <td><input type="checkbox" class="order-checkbox" data-id="${o.id}" onchange="updateDeleteBtn()"></td>
    <td><code style="font-size:11px">${idShort}</code></td>
    <td>${customer}</td>
    <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${items}</td>
    <td style="font-family:var(--mono)">$${parseFloat(o.total||0).toFixed(2)}</td>
    ${showAction ? `<td>${ref}</td>` : ''}
    <td><span class="status-pill s-${o.status||'pending'}">${o.status||'pending'}</span></td>
    <td style="white-space:nowrap">${date}</td>
    ${showAction ? `<td>${qrDownload}${action}</td>` : ''}
  </tr>`;
}

function toggleAllOrders(cb) {
  document.querySelectorAll('.order-checkbox').forEach(c => c.checked = cb.checked);
  updateDeleteBtn();
}

function updateDeleteBtn() {
  const any = document.querySelectorAll('.order-checkbox:checked').length > 0;
  const btn = document.getElementById('deleteOrdersBtn');
  if (btn) btn.style.display = any ? '' : 'none';
  const selectAll = document.getElementById('selectAllOrders');
  if (selectAll) {
    const all  = document.querySelectorAll('.order-checkbox').length;
    const chk  = document.querySelectorAll('.order-checkbox:checked').length;
    selectAll.indeterminate = chk > 0 && chk < all;
    selectAll.checked = all > 0 && chk === all;
  }
}

async function deleteSelectedOrders() {
  const checked = [...document.querySelectorAll('.order-checkbox:checked')];
  if (!checked.length) return;
  const ids = checked.map(c => c.dataset.id);
  if (!confirm(`Delete ${ids.length} order${ids.length > 1 ? 's' : ''}? This cannot be undone.`)) return;

  try {
    const cfg = window.THREAD_CONFIG;
    if (cfg?.supabaseUrl && window.supabase) {
      const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
      const { error } = await sb.rpc('delete_orders_by_ids', { order_ids: ids });
      if (error) { alert('Delete failed: ' + error.message); return; }
    } else {
      // localStorage fallback
      const stored = JSON.parse(localStorage.getItem('thread_orders') || '[]');
      localStorage.setItem('thread_orders', JSON.stringify(stored.filter(o => !ids.includes(o.id))));
    }
    // Remove from local array and re-render
    allOrders = allOrders.filter(o => !ids.includes(o.id));
    renderOrders();
    renderOverview();
    document.getElementById('deleteOrdersBtn').style.display = 'none';
    document.getElementById('selectAllOrders').checked = false;
  } catch(e) {
    alert('Error: ' + e.message);
  }
}

/* ─────────────────────────────────────────────────────────────────────────
   CUSTOMERS
───────────────────────────────────────────────────────────────────────── */
function renderCustomers() {
  const search = (document.getElementById('customerSearch')?.value || '').toLowerCase().replace(/^@/, '');
  let filtered = allCustomers;
  if (search) {
    filtered = filtered.filter(c =>
      (c.name     || '').toLowerCase().includes(search) ||
      (c.email    || '').toLowerCase().includes(search) ||
      (c.username || '').toLowerCase().includes(search)
    );
  }

  // Show any cart events that couldn't be linked to an account (no uid: prefix)
  const unlinkedCarts = _analyticsCache.filter(e => {
    if (e.event_type !== 'add_to_cart') return false;
    const label = e.page_label || '';
    // Linked events start with uid: — show the rest
    return !label.startsWith('uid:');
  });
  const unlinkedBox = document.getElementById('unlinkedCartBox');
  if (unlinkedBox) {
    if (unlinkedCarts.length) {
      unlinkedBox.style.display = 'block';
      unlinkedBox.innerHTML = `
        <div style="font-size:12px;font-weight:700;color:#fcd34d;margin-bottom:8px">
          ⚠️ ${unlinkedCarts.length} cart add${unlinkedCarts.length > 1 ? 's' : ''} couldn't be linked to an account (logged out or pre-update):
        </div>
        ${unlinkedCarts.map(e => {
          const t = new Date(e.created_at).toLocaleString([], { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });
          const loc = [e.city, e.country].filter(Boolean).join(', ') || '—';
          const item = (e.page_label || '—').replace(/^uid:[^|]+\|/, '');
          return `<div style="display:flex;gap:16px;align-items:center;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.05);font-size:12px">
            <span style="color:#888;white-space:nowrap">${t}</span>
            <code style="color:#a78bfa;font-size:11px">${escapeHtml(e.ip_address || '—')}</code>
            <span style="color:#ccc">${escapeHtml(loc)}</span>
            <span style="color:#e2e8f0;font-weight:600">${escapeHtml(item)}</span>
          </div>`;
        }).join('')}`;
    } else {
      unlinkedBox.style.display = 'none';
    }
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
      ? `<button class="ad-action-btn" style="background:#111;color:#fff;margin-right:4px" onclick="downloadQR('${escapeHtml(code)}','${escapeHtml(c.name || code)}','black')">⬛ Black</button><button class="ad-action-btn" style="background:#3a3a3a;color:#aaa;border:1px solid #555" onclick="downloadQR('${escapeHtml(code)}','${escapeHtml(c.name || code)}','white')">⬜ White</button>`
      : '<span style="color:#555">—</span>';
    const hasCart   = _cartUserIds.has(c.id) || !!c.last_cart_at;
    const cartTime  = c.last_cart_at
      ? new Date(c.last_cart_at).toLocaleString([], { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' })
      : null;
    const cartBadge = hasCart
      ? `<span style="background:#1a1a3a;border:1px solid #4c1d95;color:#c4b5fd;padding:3px 8px;border-radius:8px;font-size:11px;font-weight:600" title="${cartTime ? 'Last added: ' + cartTime : ''}">🛒 Yes</span>${cartTime ? `<br><span style="font-size:10px;color:#666">${cartTime}</span>` : ''}`
      : `<span style="color:#444;font-size:12px">—</span>`;
    return `<tr>
      <td><strong>${c.name || '—'}</strong></td>
      <td>${c.email || '—'}</td>
      <td>${username}</td>
      <td>${referredBy}</td>
      <td><code style="font-size:11px">${code || '—'}</code></td>
      <td>${customerOrders.length}</td>
      <td style="font-family:var(--mono)">$${spent.toFixed(2)}</td>
      <td>${cartBadge}</td>
      <td>${c.payout_method ? `<span style="font-size:12px;color:#a78bfa;font-weight:600">${c.payout_method}</span><br><span style="font-size:11px;color:#888">${c.payout_handle || '—'}</span>` : '<span style="color:#444">—</span>'}</td>
      <td>${joined}</td>
      <td>${qrBtn}</td>
      <td style="white-space:nowrap">
        <button class="ad-action-btn" style="background:#7f1d1d;color:#fca5a5;font-size:11px;margin-bottom:4px" onclick="clearAccountData('${escapeHtml(c.id || '')}','${escapeHtml(c.email || '')}','${escapeHtml(c.name || '')}')">🗑 Clear Data</button>
        <button class="ad-action-btn" style="background:#dc2626;color:#fff;font-size:11px;font-weight:700;display:block" onclick="confirmDeleteUser('${escapeHtml(c.id || '')}','${escapeHtml(c.email || '')}','${escapeHtml(c.name || '')}')">💀 Delete User</button>
      </td>
    </tr>`;
  }).join('') : '<tr><td colspan="11" class="ad-empty">No customers</td></tr>';
}

/* ─────────────────────────────────────────────────────────────────────────
   SYNC USERNAMES
   Calls a SECURITY DEFINER RPC that reads raw_user_meta_data from
   auth.users and backfills username into profiles for any row that is
   missing it.  Requires the following function to exist in Supabase:

   CREATE OR REPLACE FUNCTION sync_usernames_from_metadata()
   RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
   DECLARE updated_count integer;
   BEGIN
     UPDATE profiles p
       SET username = (u.raw_user_meta_data->>'username')
       FROM auth.users u
       WHERE p.id = u.id
         AND (p.username IS NULL OR p.username = '')
         AND (u.raw_user_meta_data->>'username') IS NOT NULL
         AND (u.raw_user_meta_data->>'username') != '';
     GET DIAGNOSTICS updated_count = ROW_COUNT;
     RETURN json_build_object('updated', updated_count);
   END; $$;
───────────────────────────────────────────────────────────────────────── */
async function syncMissingUsernames() {
  const btn = document.getElementById('syncUsernamesBtn');
  if (btn) { btn.textContent = 'Syncing…'; btn.disabled = true; }
  try {
    const cfg = window.THREAD_CONFIG;
    if (!cfg?.supabaseUrl || !window.supabase) { alert('Supabase not connected'); return; }
    const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);

    const { data, error } = await sb.rpc('sync_usernames_from_metadata');
    if (error) {
      // Guide the user if the function doesn't exist yet
      alert(
        'Sync failed: ' + error.message + '\n\n' +
        'You need to create the sync_usernames_from_metadata() function in Supabase first.\n' +
        'Go to Supabase → SQL Editor → New Query, then paste the SQL from the comment at the top of syncMissingUsernames in admin.js.'
      );
      return;
    }

    const count = typeof data === 'object' ? (data?.updated ?? 0) : (data ?? 0);
    alert(`✓ Synced ${count} username${count !== 1 ? 's' : ''} from auth metadata into profiles.`);
    // Reload customers so the table reflects the updated data
    allCustomers = await DB.customers.getAll();
    renderCustomers();
  } catch(e) {
    alert('Error: ' + e.message);
  } finally {
    if (btn) { btn.textContent = '🔄 Sync Usernames'; btn.disabled = false; }
  }
}

/* ─────────────────────────────────────────────────────────────────────────
   TRACKED QR CODES
───────────────────────────────────────────────────────────────────────── */
async function loadTrackedQRs() {
  const body = document.getElementById('trackedQRBody');
  if (!body) return;
  const cfg = window.THREAD_CONFIG;
  if (!cfg?.supabaseUrl || !window.supabase) return;
  const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);

  const { data, error } = await sb.rpc('get_tracked_qr_stats');
  if (error || !data?.length) {
    body.innerHTML = '<tr><td colspan="6" class="ad-empty">No tracked codes yet — add one above</td></tr>';
    return;
  }
  body.innerHTML = data.map(row => {
    const lastScan = row.last_scan
      ? new Date(row.last_scan).toLocaleString('en-US', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' })
      : '—';
    return `<tr>
      <td><strong>${escapeHtml(row.label || row.code)}</strong></td>
      <td><code style="font-size:11px">${escapeHtml(row.code)}</code></td>
      <td><strong style="font-size:18px;color:#a78bfa">${row.scan_count || 0}</strong></td>
      <td style="font-size:12px;color:#888">${lastScan}</td>
      <td><button class="ad-action-btn" style="background:#111;color:#fff" onclick="downloadQR('${escapeHtml(row.code)}','${escapeHtml(row.label||row.code)}','black')">⬛ QR</button></td>
      <td><button class="ad-action-btn" style="background:#7f1d1d;color:#fca5a5;font-size:11px" onclick="removeTrackedQR('${escapeHtml(row.id)}')">Remove</button></td>
    </tr>`;
  }).join('');
}

async function addTrackedQR() {
  const code  = (document.getElementById('newQRCodeInput')?.value  || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
  const label = (document.getElementById('newQRLabelInput')?.value || '').trim();
  if (!code) { alert('Enter a code first.'); return; }
  const cfg = window.THREAD_CONFIG;
  if (!cfg?.supabaseUrl || !window.supabase) return;
  const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
  const { error } = await sb.rpc('add_tracked_qr', { p_code: code, p_label: label || code });
  if (error) { alert('Error: ' + error.message); return; }
  document.getElementById('newQRCodeInput').value  = '';
  document.getElementById('newQRLabelInput').value = '';
  loadTrackedQRs();
}

async function removeTrackedQR(id) {
  if (!confirm('Remove this tracked code?')) return;
  const cfg = window.THREAD_CONFIG;
  if (!cfg?.supabaseUrl || !window.supabase) return;
  const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
  const { error } = await sb.rpc('remove_tracked_qr', { p_id: id });
  if (error) { alert('Error: ' + error.message); return; }
  loadTrackedQRs();
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

/* ─── CLEAR ACCOUNT DATA ───────────────────────────────────────────────── */
let _clearTarget = null;

/* ─── DELETE USER (full account wipe) ──────────────────────────────────── */
let _deleteTarget = null;

function confirmDeleteUser(userId, email, name) {
  _deleteTarget = { userId, email, name };
  document.getElementById('deleteUserName').textContent  = name || email || 'Unknown';
  document.getElementById('deleteUserEmail').textContent = email || userId || '';
  document.getElementById('deleteUserModal').style.display = 'flex';
}

function closeDeleteUserModal() {
  document.getElementById('deleteUserModal').style.display = 'none';
  _deleteTarget = null;
}

async function executeDeleteUser() {
  if (!_deleteTarget) return;
  const { userId, email, name } = _deleteTarget;
  const btn = document.querySelector('#deleteUserModal .ad-action-btn[onclick="executeDeleteUser()"]');
  if (btn) { btn.textContent = 'Deleting…'; btn.disabled = true; }
  try {
    const cfg = window.THREAD_CONFIG;
    if (!cfg?.supabaseUrl || !window.supabase) { alert('Supabase not connected'); return; }
    const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);

    // Wipe all data first — orders, referral scans, and analytics events
    await sb.rpc('clear_account_data', {
      p_user_id: userId,
      p_email:   email,
      p_orders:  true,
      p_scans:   true,
      p_events:  true,
    });

    // Now delete the auth account and profile row itself
    const { error } = await sb.rpc('delete_user_account', { p_user_id: userId, p_email: email });
    if (error) { alert('Delete failed: ' + error.message); return; }
    closeDeleteUserModal();
    await loadAllData();
    alert(`✓ ${name || email} has been permanently deleted.`);
  } catch(e) {
    alert('Error: ' + e.message);
  } finally {
    if (btn) { btn.textContent = '🗑 Delete Forever'; btn.disabled = false; }
  }
}

/* ─── CLEAR ACCOUNT DATA (data only, keeps the user) ───────────────────── */
function clearAccountData(userId, email, name) {
  _clearTarget = { userId, email, name };
  document.getElementById('clearModalLabel').textContent = name || email || userId;
  document.getElementById('clearOrders').checked = true;
  document.getElementById('clearScans').checked  = true;
  document.getElementById('clearEvents').checked = false;
  document.getElementById('clearModal').style.display = 'flex';
}

function closeClearModal() {
  document.getElementById('clearModal').style.display = 'none';
  _clearTarget = null;
}

async function confirmClearData() {
  if (!_clearTarget) return;
  const { userId, email, name } = _clearTarget;
  const doOrders = document.getElementById('clearOrders').checked;
  const doScans  = document.getElementById('clearScans').checked;
  const doEvents = document.getElementById('clearEvents').checked;
  if (!doOrders && !doScans && !doEvents) { alert('Select at least one option.'); return; }

  try {
    const cfg = window.THREAD_CONFIG;
    if (!cfg?.supabaseUrl || !window.supabase) { alert('Supabase not connected'); return; }
    const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
    const { error } = await sb.rpc('clear_account_data', {
      p_user_id:    userId,
      p_email:      email,
      p_orders:     doOrders,
      p_scans:      doScans,
      p_events:     doEvents
    });
    if (error) { alert('Clear failed: ' + error.message); return; }
    closeClearModal();
    await loadAllData();
    alert('Done — data cleared for ' + (name || email));
  } catch(e) { alert('Error: ' + e.message); }
}

/* ─── GLOBAL CLEAR ACTIONS ─────────────────────────────────────────────────── */
async function clearAllScans() {
  if (!confirm('Delete ALL referral scan records? This cannot be undone.')) return;
  try {
    const cfg = window.THREAD_CONFIG;
    if (!cfg?.supabaseUrl || !window.supabase) { alert('Supabase not connected'); return; }
    const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
    const { error } = await sb.rpc('clear_all_referral_scans');
    if (error) { alert('Failed: ' + error.message); return; }
    allScans = [];
    renderReferrals();
    alert('All referral scans cleared.');
  } catch(e) { alert('Error: ' + e.message); }
}

async function resetCartStat() {
  if (!confirm('Clear all Add to Cart events? Visits and other analytics will be kept. This cannot be undone.')) return;
  try {
    const cfg = window.THREAD_CONFIG;
    if (!cfg?.supabaseUrl || !window.supabase) { alert('Supabase not connected'); return; }
    const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
    const { error } = await sb.rpc('clear_cart_events');
    if (error) { alert('Failed: ' + error.message); return; }
    loadAnalytics();
  } catch(e) { alert('Error: ' + e.message); }
}

async function deleteEventsByIP(ip) {
  if (!ip) return;
  if (!confirm(`Delete ALL analytics events from IP ${ip}? This cannot be undone.`)) return;
  try {
    const cfg = window.THREAD_CONFIG;
    if (!cfg?.supabaseUrl || !window.supabase) { alert('Supabase not connected'); return; }
    const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
    const { error } = await sb.rpc('delete_events_by_ip', { p_ip: ip });
    if (error) { alert('Failed: ' + error.message); return; }
    loadAnalytics();
  } catch(e) { alert('Error: ' + e.message); }
}

async function clearAllAnalytics() {
  if (!confirm('Delete ALL analytics events (visits + carts)? This cannot be undone.')) return;
  try {
    const cfg = window.THREAD_CONFIG;
    if (!cfg?.supabaseUrl || !window.supabase) { alert('Supabase not connected'); return; }
    const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
    const { error } = await sb.rpc('clear_all_analytics');
    if (error) { alert('Failed: ' + error.message); return; }
    loadAnalytics();
    alert('All analytics events cleared.');
  } catch(e) { alert('Error: ' + e.message); }
}

/* ─── ANALYTICS DOWNLOAD ───────────────────────────────────────────────────── */
let _analyticsCache = [];

function downloadAnalyticsCSV() {
  if (!_analyticsCache.length) { alert('No analytics data loaded yet. Open the Analytics tab first.'); return; }
  const cols = ['time', 'event_type', 'detail', 'page', 'ip_address', 'city', 'country'];
  const rows = _analyticsCache.map(e => [
    new Date(e.created_at).toLocaleString(),
    e.event_type || '',
    e.page_label || '',
    e.page || '',
    e.ip_address || '',
    e.city || '',
    e.country || ''
  ]);
  const csv = [cols, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `THREAD-analytics-${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
}

/* ─── ANALYTICS ────────────────────────────────────────────────────────────── */
async function loadAnalytics() {
  const body = document.getElementById('analyticsBody');
  if (!body) return;

  try {
    const cfg = window.THREAD_CONFIG;
    if (!cfg?.supabaseUrl || !window.supabase) {
      body.innerHTML = '<tr><td colspan="5" class="ad-empty">Supabase not connected</td></tr>';
      return;
    }
    const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);

    const { data, error } = await sb.rpc('get_all_analytics');
    if (data) _analyticsCache = data;

    if (error || !data) {
      body.innerHTML = `<tr><td colspan="5" class="ad-empty">Could not load analytics${error ? ': ' + error.message : ''}</td></tr>`;
      return;
    }

    const visits    = data.filter(e => e.event_type === 'visit');
    const carts     = data.filter(e => e.event_type === 'add_to_cart');
    const clicks    = data.filter(e => e.event_type === 'click');
    const scrolls   = data.filter(e => e.event_type === 'scroll_depth');
    const sections  = data.filter(e => e.event_type === 'section_view');
    const timings   = data.filter(e => e.event_type === 'time_on_page');
    const uniqueIPs = new Set(visits.map(e => e.ip_address).filter(Boolean));
    const cartRate  = visits.length ? Math.round((carts.length / visits.length) * 100) : 0;

    // New signups in the last 24 hours (from allCustomers already loaded)
    const since24h    = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const newSignups  = allCustomers.filter(c => c.created_at && c.created_at >= since24h).length;
    const convRate    = uniqueIPs.size ? Math.round((newSignups / uniqueIPs.size) * 100) : 0;

    document.getElementById('statUniqueVisitors').textContent = uniqueIPs.size;
    document.getElementById('statTotalVisits').textContent    = visits.length;
    document.getElementById('statAddToCarts').textContent     = carts.length;
    document.getElementById('statCartRate').textContent       = cartRate + '%';
    document.getElementById('statNewSignups').textContent     = newSignups;
    document.getElementById('statConvRate').textContent       = convRate + '%';

    // Build set of customer IDs who have added to cart (label format: uid:ID|item)
    _cartUserIds = new Set(
      carts
        .map(e => (e.page_label || '').match(/^uid:([^|]+)\|/)?.[1])
        .filter(Boolean)
    );
    // Re-render customers so the cart badge updates immediately
    renderCustomers();

    // Top clicks breakdown
    const clickCounts = {};
    clicks.forEach(e => { const l = e.page_label || e.page || '—'; clickCounts[l] = (clickCounts[l]||0)+1; });
    const topClicks = Object.entries(clickCounts).sort((a,b)=>b[1]-a[1]).slice(0,8);

    // Scroll depth breakdown
    const scrollCounts = {};
    scrolls.forEach(e => { const l = e.page_label || e.page || '—'; scrollCounts[l] = (scrollCounts[l]||0)+1; });

    // Section views
    const sectionCounts = {};
    sections.forEach(e => { const l = e.page_label || e.page || '—'; sectionCounts[l] = (sectionCounts[l]||0)+1; });

    // Time on page
    const timingCounts = {};
    timings.forEach(e => { const l = e.page_label || e.page || '—'; timingCounts[l] = (timingCounts[l]||0)+1; });

    // Render breakdowns
    const clicksEl = document.getElementById('analyticsClicks');
    if (clicksEl) {
      clicksEl.innerHTML = topClicks.length
        ? topClicks.map(([label, count]) => `
          <div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid #1a1a1a">
            <span style="font-size:13px;color:#ccc;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:220px">${escapeHtml(label)}</span>
            <span style="font-family:var(--mono);font-size:13px;color:#a78bfa;flex-shrink:0;margin-left:12px">${count}×</span>
          </div>`).join('')
        : '<div style="color:#555;font-size:13px;padding:8px 0">No click data yet</div>';
    }

    const scrollEl = document.getElementById('analyticsScroll');
    if (scrollEl) {
      const order = ['25%','50%','75%','90%'];
      scrollEl.innerHTML = order.map(d => {
        const n = scrollCounts[d] || 0;
        const pct = visits.length ? Math.round((n/visits.length)*100) : 0;
        return `<div style="margin-bottom:10px">
          <div style="display:flex;justify-content:space-between;font-size:12px;color:#aaa;margin-bottom:4px"><span>${d}</span><span>${n} visitors (${pct}%)</span></div>
          <div style="background:#1a1a1a;border-radius:4px;height:6px"><div style="background:#7c3aed;height:6px;border-radius:4px;width:${pct}%"></div></div>
        </div>`;
      }).join('');
    }

    const timingEl = document.getElementById('analyticsTiming');
    if (timingEl) {
      const order2 = ['15s+','30s+','1m+','3m+','5m+'];
      timingEl.innerHTML = order2.map(d => {
        const n = timingCounts[d] || 0;
        const maxN = Math.max(...order2.map(x => timingCounts[x] || 0), 1);
        const pct = Math.round((n / maxN) * 100);
        return `<div style="margin-bottom:8px">
          <div style="display:flex;justify-content:space-between;font-size:12px;color:#aaa;margin-bottom:4px"><span>${d}</span><span style="color:#4ade80;font-family:var(--mono)">${n}</span></div>
          <div style="background:#1a1a1a;border-radius:4px;height:5px"><div style="background:#4ade80;height:5px;border-radius:4px;width:${pct}%"></div></div>
        </div>`;
      }).join('');
    }

    if (!data.length) {
      body.innerHTML = '<tr><td colspan="6" class="ad-empty">No events yet — visit the site to start tracking</td></tr>';
      return;
    }

    const EVENT_BADGES = {
      visit:        '<span style="background:#1a472a;color:#4ade80;padding:2px 7px;border-radius:10px;font-size:11px">👁 Visit</span>',
      add_to_cart:  '<span style="background:#4c1d95;color:#c4b5fd;padding:2px 7px;border-radius:10px;font-size:11px">🛒 Cart</span>',
      click:        '<span style="background:#1e3a5f;color:#93c5fd;padding:2px 7px;border-radius:10px;font-size:11px">👆 Click</span>',
      scroll_depth: '<span style="background:#1c2f1c;color:#86efac;padding:2px 7px;border-radius:10px;font-size:11px">📜 Scroll</span>',
      section_view: '<span style="background:#2d1b00;color:#fcd34d;padding:2px 7px;border-radius:10px;font-size:11px">📍 Section</span>',
      time_on_page: '<span style="background:#1f1f1f;color:#9ca3af;padding:2px 7px;border-radius:10px;font-size:11px">⏱ Time</span>',
    };

    body.innerHTML = data.map(e => {
      const badge    = EVENT_BADGES[e.event_type] || `<span style="background:#1a1a1a;color:#888;padding:2px 7px;border-radius:10px;font-size:11px">${e.event_type}</span>`;
      const location = [e.city, e.country].filter(Boolean).join(', ') || '—';
      const time     = new Date(e.created_at).toLocaleString([], { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });
      const label    = e.page_label || '';
      const ip       = e.ip_address || '';
      const ipCell   = ip
        ? `<code style="font-size:11px;color:#a78bfa">${escapeHtml(ip)}</code>
           <button onclick="deleteEventsByIP('${escapeHtml(ip)}')"
             style="margin-left:6px;padding:1px 6px;background:#2a0a0a;border:1px solid #7f1d1d;border-radius:4px;color:#fca5a5;font-size:10px;cursor:pointer;vertical-align:middle"
             title="Delete all events from this IP">🗑</button>`
        : '—';
      return `<tr>
        <td>${badge}</td>
        <td style="white-space:nowrap">${ipCell}</td>
        <td>${escapeHtml(location)}</td>
        <td>${escapeHtml(e.page || '—')}${label ? `<span style="color:#888;font-size:11px"> · ${escapeHtml(label)}</span>` : ''}</td>
        <td style="color:#888;font-size:12px">${time}</td>
      </tr>`;
    }).join('');
  } catch(e) {
    const body = document.getElementById('analyticsBody');
    if (body) body.innerHTML = `<tr><td colspan="5" class="ad-empty">Error: ${e.message}</td></tr>`;
  }
}

/* ─────────────────────────────────────────────────────────────────────────
   GIVEAWAY
───────────────────────────────────────────────────────────────────────── */
let _giveawayEntries = [];

async function loadGiveaway() {
  const body = document.getElementById('gwEntriesBody');
  if (!body) return;
  const cfg = window.THREAD_CONFIG;
  if (!cfg?.supabaseUrl || !window.supabase) {
    body.innerHTML = '<tr><td colspan="6" class="ad-empty">Supabase not connected</td></tr>';
    return;
  }
  const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);

  try {
    const { data, error } = await sb.rpc('get_giveaway_entries');
    if (error) throw error;

    _giveawayEntries = data || [];
    renderGiveaway(_giveawayEntries);

    /* update stat cards */
    const totalEl   = document.getElementById('gwStatTotal');
    const todayEl   = document.getElementById('gwStatToday');
    const sourceEl  = document.getElementById('gwStatSource');
    const badge     = document.getElementById('giveawayBadge');

    if (totalEl) totalEl.textContent = _giveawayEntries.length.toLocaleString();

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayCount = _giveawayEntries.filter(e => new Date(e.created_at) >= today).length;
    if (todayEl) todayEl.textContent = todayCount;

    /* top source */
    const sourceCounts = {};
    _giveawayEntries.forEach(e => {
      const s = e.source || 'direct';
      sourceCounts[s] = (sourceCounts[s] || 0) + 1;
    });
    const topSource = Object.entries(sourceCounts).sort((a, b) => b[1] - a[1])[0];
    if (sourceEl) sourceEl.textContent = topSource ? `${topSource[0]} (${topSource[1]})` : '—';

    /* sidebar badge */
    if (badge) {
      badge.textContent = _giveawayEntries.length;
      badge.style.display = _giveawayEntries.length ? 'inline-flex' : 'none';
    }
  } catch (e) {
    body.innerHTML = `<tr><td colspan="6" class="ad-empty">Error: ${e.message}</td></tr>`;
  }
}

function renderGiveaway(entries) {
  const body = document.getElementById('gwEntriesBody');
  if (!body) return;
  if (!entries.length) {
    body.innerHTML = '<tr><td colspan="6" class="ad-empty">No entries yet — share the giveaway link!</td></tr>';
    return;
  }
  body.innerHTML = entries.map((e, i) => {
    const dt = e.created_at
      ? new Date(e.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
      : '—';
    const location = [e.city, e.country].filter(Boolean).join(', ') || '—';
    const src = escapeHtml(e.source || 'direct');
    const srcColor = src === 'direct' ? '#555' : '#a78bfa';
    return `<tr>
      <td style="color:#555;font-size:12px">${entries.length - i}</td>
      <td><strong>${escapeHtml(e.name || '—')}</strong></td>
      <td style="font-size:13px;color:#ccc">${escapeHtml(e.email || '—')}</td>
      <td><span style="color:${srcColor};font-size:12px;background:rgba(124,58,237,0.1);padding:3px 9px;border-radius:100px">${src}</span></td>
      <td style="font-size:12px;color:#888">${escapeHtml(location)}</td>
      <td style="font-size:12px;color:#888;white-space:nowrap">${dt}</td>
    </tr>`;
  }).join('');
}

async function pickGiveawayWinner() {
  if (!_giveawayEntries.length) {
    alert('No entries yet — nothing to pick from!');
    return;
  }
  /* quick animated pick */
  const idx    = Math.floor(Math.random() * _giveawayEntries.length);
  const winner = _giveawayEntries[idx];
  const msg    = [
    '🎉  WINNER SELECTED!',
    '',
    `Name:  ${winner.name}`,
    `Email: ${winner.email}`,
    winner.city ? `City:  ${winner.city}` : '',
    '',
    `Entry #${_giveawayEntries.length - idx} of ${_giveawayEntries.length}`,
    '',
    'Copy their email and send a DM — they get to choose 2 tees or 1 hoodie.'
  ].filter(l => l !== undefined).join('\n');
  alert(msg);
}

function exportGiveawayCSV() {
  if (!_giveawayEntries.length) { alert('No entries to export.'); return; }
  const cols = ['#', 'Name', 'Email', 'Source', 'City', 'Date'];
  const rows = _giveawayEntries.map((e, i) => [
    _giveawayEntries.length - i,
    e.name  || '',
    e.email || '',
    e.source || 'direct',
    e.city   || '',
    e.created_at ? new Date(e.created_at).toLocaleString() : ''
  ]);
  const csv = [cols, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  const a   = document.createElement('a');
  a.href    = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
  a.download = `THREAD-giveaway-${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
}

async function clearGiveawayEntries() {
  if (!_giveawayEntries.length) { alert('Nothing to clear.'); return; }
  if (!confirm(`Delete ALL ${_giveawayEntries.length} giveaway entries? This cannot be undone.`)) return;
  const cfg = window.THREAD_CONFIG;
  if (!cfg?.supabaseUrl || !window.supabase) { alert('Supabase not connected'); return; }
  const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
  const { error } = await sb.rpc('clear_giveaway_entries');
  if (error) { alert('Failed: ' + error.message); return; }
  _giveawayEntries = [];
  renderGiveaway([]);
  const totalEl = document.getElementById('gwStatTotal');
  const todayEl = document.getElementById('gwStatToday');
  if (totalEl) totalEl.textContent = '0';
  if (todayEl) todayEl.textContent = '0';
  alert('All giveaway entries cleared.');
}
