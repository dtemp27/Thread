/* ═══════════════════════════════════════════════
   THREAD DASHBOARD — dashboard.js
   Supabase-aware + localStorage fallback
═══════════════════════════════════════════════ */

/* ─── SUPABASE CLIENT ─── */
function getSB() {
  const cfg = window.THREAD_CONFIG;
  if (!cfg || !window.supabase) return null;
  return window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
}

/* ─── STORAGE (localStorage fallback) ─── */
const USERS_KEY   = 'thread_users';
const SESSION_KEY = 'thread_session';
function getUsers() { return JSON.parse(localStorage.getItem(USERS_KEY) || '[]'); }
function saveUsers(u) { localStorage.setItem(USERS_KEY, JSON.stringify(u)); }
function getLocalUser() {
  try {
    const stored = localStorage.getItem(SESSION_KEY);
    if (!stored) return null;
    const p = JSON.parse(stored);
    return (p && p.id) ? p : null;
  } catch(e) { return null; }
}
function updateUser(u) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(u));
  const users = getUsers();
  const i = users.findIndex(x => x.id === u.id);
  if (i !== -1) { users[i] = u; saveUsers(users); }
}

async function signOut() {
  try { const sb = getSB(); if (sb) await sb.auth.signOut(); } catch(e) {}
  localStorage.removeItem(SESSION_KEY);
  window.location.href = 'index.html';
}

/* ─── GLOBAL USER STATE ─── */
let user = null;
let _sb  = null;

/* ─── BOOT: load user then render ─── */
(async function initDashboard() {
  _sb = getSB();

  /* 1 — try Supabase */
  if (_sb) {
    try {
      const { data } = await _sb.auth.getUser();
      if (data?.user) {
        const { data: profile } = await _sb.from('profiles')
          .select('*').eq('id', data.user.id).single();
        if (profile) {
          user = {
            id:           profile.id,
            email:        profile.email,
            name:         profile.name  || '',
            referralCode: profile.referral_code || '',
            avatar:       (profile.name || profile.email || 'U').slice(0, 2).toUpperCase(),
            stats:        { totalScans: 0, conversions: 0, pendingEarnings: 0, totalEarned: 0, scanHistory: [] },
            purchases:    []
          };

          /* load referral scans */
          const { data: scans } = await _sb.from('referral_scans')
            .select('*').eq('referrer_id', data.user.id)
            .order('created_at', { ascending: false });
          if (scans?.length) {
            const convs    = scans.filter(s => s.converted);
            const earned   = convs.reduce((s, r) => s + parseFloat(r.commission || 0), 0);
            const pending  = convs.filter(s => s.status === 'pending')
                                  .reduce((s, r) => s + parseFloat(r.commission || 0), 0);
            user.stats = {
              totalScans:      scans.length,
              conversions:     convs.length,
              totalEarned:     parseFloat(earned.toFixed(2)),
              pendingEarnings: parseFloat(pending.toFixed(2)),
              scanHistory:     scans.map(s => ({
                type:      s.converted ? 'conversion' : 'scan',
                date:      s.created_at,
                city:      s.city || 'Unknown',
                converted: s.converted,
                amount:    parseFloat(s.commission || 0),
                status:    s.status || 'completed'
              }))
            };
          }

          /* load orders / purchases */
          const { data: orders } = await _sb.from('orders')
            .select('*').eq('customer_email', profile.email)
            .order('created_at', { ascending: false });
          if (orders?.length) {
            user.purchases = orders.flatMap(o =>
              (o.items || []).map(item => ({
                name:  item.name,
                price: item.price || 0,
                date:  o.created_at || new Date().toISOString()
              }))
            );
          }
        }
      }
    } catch(e) {
      console.warn('[dashboard] Supabase load error:', e);
    }
  }

  /* 2 — fallback: localStorage session */
  if (!user) user = getLocalUser();

  /* 3 — not logged in → redirect */
  if (!user) { window.location.href = 'auth.html'; return; }

  /* 4 — ensure required fields */
  user.stats        = user.stats    || { totalScans: 0, conversions: 0, pendingEarnings: 0, totalEarned: 0, scanHistory: [] };
  user.purchases    = user.purchases || [];
  user.avatar       = user.avatar   || (user.name || 'U').slice(0, 2).toUpperCase();
  user.referralCode = user.referralCode || user.referral_code || '';

  /* 5 — boot UI */
  bootUI();
})();

/* ═══════════════════════════════════════════════
   UI INIT (runs after user is loaded)
═══════════════════════════════════════════════ */
function bootUI() {

  /* ─── REFERRAL URL ─── */
  const baseURL = window.location.href.replace('dashboard.html','index.html').split('?')[0];
  const refURL  = baseURL + '?ref=' + user.referralCode;

  /* ─── INIT STATIC UI ─── */
  document.getElementById('suAvatar').textContent      = user.avatar;
  document.getElementById('suName').textContent        = user.name;
  document.getElementById('suEmail').textContent       = user.email;
  document.getElementById('topbarAvatar').textContent  = user.avatar;
  document.getElementById('tcValue').textContent       = user.referralCode;
  document.getElementById('refLinkInput').value        = refURL;
  document.getElementById('qcdValue').textContent      = user.referralCode;
  document.getElementById('qcdUrl').textContent        = refURL;
  document.getElementById('miniCodeLabel').textContent = user.referralCode;
  document.getElementById('welcomeMsg').textContent    = `Welcome back, ${(user.name||'').split(' ')[0] || 'there'}! 👋`;
  document.getElementById('welcomeSub').textContent    = `Here's how your referrals are performing today.`;
  document.getElementById('topbarDate').textContent    = new Date().toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'});

  /* ─── Cart badge ─── */
  (function updateDashCartBadge() {
    try {
      const raw = localStorage.getItem('thread_cart');
      if (!raw) return;
      const cart = JSON.parse(raw);
      const items = Array.isArray(cart) ? cart : (cart.items || []);
      const total = items.reduce((sum, i) => sum + (i.qty || 1), 0);
      const badge = document.getElementById('dashCartCount');
      if (badge && total > 0) { badge.textContent = total; badge.style.display = 'flex'; }
    } catch(e) {}
  })();

  /* ─── Cart navigation ─── */
  window.goToDashCart = function() {
    try {
      const raw = localStorage.getItem('thread_cart');
      const cart = raw ? JSON.parse(raw) : null;
      const items = cart?.items || (Array.isArray(cart) ? cart : []);
      if (!items.length) {
        // Nothing in cart — go browse the catalog
        window.location.href = 'catalog.html';
        return;
      }
      // Write thread_checkout so checkout.js doesn't redirect away
      const subtotal = items.reduce((s, i) => s + i.price * (i.qty || 1), 0);
      const discount = cart?.discount || 0;
      const total    = Math.max(0, subtotal - discount);
      localStorage.setItem('thread_checkout', JSON.stringify({
        items, subtotal, discount, total,
        promoCode: cart?.promoCode || '',
        ref: localStorage.getItem('thread_ref') || ''
      }));
      window.location.href = 'checkout.html';
    } catch(e) {
      window.location.href = 'catalog.html';
    }
  };

  /* clean up any leftover demo sessionStorage from a previous page load */
  sessionStorage.removeItem(DEMO_KEY_STATS);
  sessionStorage.removeItem(DEMO_KEY_PURCHASES);
  sessionStorage.removeItem(DEMO_KEY_ACTIVE);

  /* demo button is always visible — no conditional needed */

  /* ─── DRAW QR ─── */
  drawQR('miniQrCanvas', refURL, 120);
  drawQR('bigQrCanvas',  refURL, 220);

  /* ─── NAVIGATION ─── */
  document.querySelectorAll('.nav-item[data-section]').forEach(item => {
    item.addEventListener('click', () => switchSection(item.dataset.section));
  });
  document.querySelectorAll('[data-section]').forEach(el => {
    if (!el.classList.contains('nav-item')) {
      el.addEventListener('click', () => switchSection(el.dataset.section));
    }
  });

  /* hamburger */
  document.getElementById('menuToggle')?.addEventListener('click',
    () => document.getElementById('sidebar').classList.toggle('open'));
  document.getElementById('sidebarClose')?.addEventListener('click',
    () => document.getElementById('sidebar').classList.remove('open'));

  /* ─── ACTIVITY FILTERS ─── */
  document.querySelectorAll('.af-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.af-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activityFilter = btn.dataset.filter;
      renderActivity();
    });
  });
  document.getElementById('activitySearch')?.addEventListener('input', e => {
    activitySearch = e.target.value;
    renderActivity();
  });

  /* ─── SLIDERS ─── */
  const pieceSlider = document.getElementById('pieceSlider');
  const scanSlider2 = document.getElementById('scanSlider2');
  pieceSlider?.addEventListener('input', updatePotential);
  scanSlider2?.addEventListener('input', updatePotential);
  updatePotential();

  /* ─── CROSS-TAB REAL-TIME ─── */
  window.addEventListener('storage', e => {
    if (e.key === USERS_KEY) {
      const fresh = getLocalUser();
      if (fresh) {
        const prevScans = user.stats.totalScans;
        user = fresh;
        if (fresh.stats.totalScans > prevScans) {
          renderStats(); renderChart(); renderActivity(); renderTransactions();
          showToast('🔔 New scan from store!', 'success');
        }
      }
    }
  });

  /* ─── RENDER ALL ─── */
  renderAll();
  // scheduleNextScan() is NOT called here — it only runs when Demo Mode is on
}

/* ═══════════════════════════════════════════════
   NAVIGATION
═══════════════════════════════════════════════ */
function switchSection(name) {
  document.querySelectorAll('.dash-section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const sec = document.getElementById('section-' + name);
  const nav = document.querySelector(`.nav-item[data-section="${name}"]`);
  if (sec) sec.classList.add('active');
  if (nav) nav.classList.add('active');
  const titles = { overview:'Overview', qrcode:'My QR Code', earnings:'Earnings', activity:'Activity', purchases:'My Purchases' };
  document.getElementById('topbarTitle').textContent = titles[name] || 'Dashboard';
  document.getElementById('sidebar').classList.remove('open');
}

/* ═══════════════════════════════════════════════
   QR CODE — REAL GENERATOR (qr-code-styling)
═══════════════════════════════════════════════ */

// Light hoodies → black QR; Dark hoodies → white QR
const LIGHT_HOODIES = ['Silver Mist', 'Bone', 'Tawny Dusk', 'Ivory Pure'];
const DARK_HOODIES  = ['Phantom Black', 'Midnight Navy', 'Ember Crimson', 'Forest Shadow', 'Ash Stone'];

function getUserHoodieColor() {
  const all = [...LIGHT_HOODIES, ...DARK_HOODIES];
  for (const purchase of (user?.purchases || [])) {
    const name = purchase.name || '';
    for (const color of all) {
      if (name.includes(color)) return color;
    }
  }
  return null;
}

function getQRColors(hoodieColor) {
  const isLight = LIGHT_HOODIES.includes(hoodieColor);
  return isLight
    ? { fg: '#111111', bg: '#ffffff' }   // black QR on white
    : { fg: '#ffffff', bg: '#111111' };  // white QR on black
}

function drawQR(canvasId, text, size) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  const hoodieColor = getUserHoodieColor();
  const { fg, bg } = getQRColors(hoodieColor);

  // Use the high-res TLogo.png from the site
  const logoUrl = window.location.origin + '/images/TLogo.png';

  // Hide original canvas, inject a div for qr-code-styling
  canvas.style.display = 'none';
  const containerId = canvasId + '_qr';
  const old = document.getElementById(containerId);
  if (old) old.remove();
  const div = document.createElement('div');
  div.id = containerId;
  div.style.cssText = 'display:inline-block;border-radius:14px;overflow:hidden;';
  canvas.parentElement.insertBefore(div, canvas);

  new QRCodeStyling({
    width:  size,
    height: size,
    type:   'canvas',
    data:   text,
    image:  logoUrl,
    dotsOptions:         { color: fg, type: 'rounded' },
    cornersSquareOptions:{ color: fg, type: 'extra-rounded' },
    cornersDotOptions:   { color: fg, type: 'dot' },
    backgroundOptions:   { color: bg },
    imageOptions:        { crossOrigin: 'anonymous', margin: 4, imageSize: 0.32 },
  }).append(div);
}

/* ═══════════════════════════════════════════════
   STATS RENDERING
═══════════════════════════════════════════════ */
function renderStats() {
  const s     = user.stats;
  const scans = s.totalScans  || 0;
  const conv  = s.conversions || 0;
  const rate  = scans > 0 ? ((conv / scans) * 100).toFixed(1) : 0;
  const avail = Math.max(0, (s.totalEarned||0) - (s.withdrawn||0));

  setNum('statScans', scans);
  setNum('statConv',  conv);
  document.getElementById('statPending').textContent = (s.pendingEarnings||0).toFixed(2);
  document.getElementById('statEarned').textContent  = (s.totalEarned||0).toFixed(2);
  document.getElementById('subConv').textContent     = `~${rate}% conv. rate`;
  document.getElementById('subScans').textContent    = scans ? `${scans} total scans` : 'No scans yet';
  document.getElementById('subEarned').textContent   = conv  ? `${conv} conversions`  : 'All time';

  renderTier(conv);

  document.getElementById('qrTotalScans').textContent  = scans;
  document.getElementById('qrConversions').textContent = conv;
  document.getElementById('qrRate').textContent        = rate + '%';
  const avgEarn = conv > 0 ? ((s.totalEarned||0) / conv).toFixed(0) : 0;
  document.getElementById('qrAvgEarn').textContent = '$' + avgEarn;

  const todayScans  = (s.scanHistory||[]).filter(h => isToday(h.date)).length;
  const todayEarned = (s.scanHistory||[]).filter(h => isToday(h.date) && h.converted)
                       .reduce((a, b) => a + (b.amount||0), 0);
  document.getElementById('qrScanTrend').textContent  = `+${todayScans} today`;
  document.getElementById('qrConvTrend').textContent  = `+${(s.scanHistory||[]).filter(h=>isToday(h.date)&&h.converted).length} today`;
  document.getElementById('todayScans').textContent   = todayScans + ' scans';
  document.getElementById('todayEarned').textContent  = '$' + todayEarned.toFixed(2);

  document.getElementById('availCashout').textContent = '$' + avail.toFixed(2);
  document.getElementById('ebPending').textContent    = '$' + (s.pendingEarnings||0).toFixed(2);
  document.getElementById('ebAllTime').textContent    = '$' + (s.totalEarned||0).toFixed(2);
  document.getElementById('ebAvgSale').textContent    = '$' + (conv>0?((s.totalEarned||0)/conv).toFixed(2):'0.00');
  document.getElementById('cashoutBtn').disabled      = avail <= 0;

  const monthEarned = (s.scanHistory||[])
    .filter(h => h.converted && new Date(h.date).getMonth() === new Date().getMonth())
    .reduce((a,b) => a+(b.amount||0), 0);
  document.getElementById('ebMonth').textContent  = '$' + monthEarned.toFixed(2);
  document.getElementById('txCount').textContent  = (s.scanHistory||[]).filter(h=>h.converted).length + ' transactions';
}

/* ─── TIER PROGRESS RENDERING ─── */
function renderTier(conversions) {
  if (!window.ThreadTiers) return;
  const tier = window.ThreadTiers.getTierForReferrals(conversions);
  const next = window.ThreadTiers.getNextTier(tier);
  const pct  = window.ThreadTiers.progressToNext(conversions);

  // 1. Current tier card
  const badge = document.getElementById('tierBadge');
  if (badge) badge.style.background = tier.gradient;
  const emoji = document.getElementById('tierEmoji');
  if (emoji) emoji.textContent = tier.emoji;
  const name = document.getElementById('tierName');
  if (name) name.textContent = tier.name;
  const rate = document.getElementById('tierRate');
  if (rate) rate.textContent = `${tier.pct}% per referral sale`;

  const fill = document.getElementById('tierBarFill');
  if (fill) {
    fill.style.width = (pct * 100).toFixed(1) + '%';
    fill.style.background = tier.gradient;
  }
  const pctEl = document.getElementById('tierProgressPct');
  if (pctEl) pctEl.textContent = Math.round(pct * 100) + '%';

  const label = document.getElementById('tierProgressLabel');
  const nextEl = document.getElementById('tierNext');
  if (next) {
    if (label) label.textContent = `${conversions} / ${next.minSales} to ${next.name}`;
    if (nextEl) nextEl.textContent = `Next: ${next.emoji} ${next.name} — ${next.pct}% per sale`;
  } else {
    if (label) label.textContent = `${conversions} sales · Top tier`;
    if (nextEl) nextEl.textContent = '👑 You\'re at the top — max payout unlocked';
  }

  // 2. Full tier ladder with Drop Box rewards
  const grid = document.getElementById('dashTierGrid');
  if (grid) {
    grid.innerHTML = window.ThreadTiers.TIERS.map(t => {
      const status =
        t.id === tier.id ? 'current' :
        conversions > t.maxSales ? 'unlocked' :
        'locked';
      const rangeText = t.maxSales === Infinity
        ? `${t.minSales}+ sales`
        : `${t.minSales} – ${t.maxSales} sales`;
      const dropBox = t.unlockReward ? `
        <div class="dt-reward">
          <div class="dt-reward-head">
            <span class="dt-gift">${t.unlockReward.emoji}</span>
            <span class="dt-reward-name">${t.unlockReward.name}</span>
          </div>
          <ul class="dt-reward-items">
            ${t.unlockReward.items.map(i => `<li>${i}</li>`).join('')}
          </ul>
        </div>
      ` : `
        <div class="dt-reward dt-reward-none">
          <div class="dt-reward-head"><span class="dt-gift">✨</span><span class="dt-reward-name">Starting perks</span></div>
          <ul class="dt-reward-items">
            <li>Permanent QR code on your hoodie</li>
            <li>Live earnings dashboard</li>
            <li>Cash, gift card, or store credit</li>
          </ul>
        </div>
      `;
      return `
        <div class="dt-tile dt-tile-${t.id} dt-${status}">
          ${status === 'current' ? '<div class="dt-tag-current">YOU\'RE HERE</div>' : ''}
          ${status === 'unlocked' ? '<div class="dt-tag-unlocked">✓ UNLOCKED</div>' : ''}
          <div class="dt-top" style="background:${t.gradient}">
            <div class="dt-emoji">${t.emoji}</div>
            <div class="dt-name">${t.name}</div>
            <div class="dt-range">${rangeText}</div>
            <div class="dt-rate">${t.pct}%<span>/sale</span></div>
          </div>
          ${dropBox}
        </div>
      `;
    }).join('');
  }
}

function setNum(id, target) {
  const el = document.getElementById(id);
  if (!el) return;
  const current = parseInt(el.textContent) || 0;
  if (current === target) return;
  let v = current;
  const step = Math.max(1, Math.ceil(Math.abs(target - current) / 20));
  const iv = setInterval(() => {
    v = target > v ? Math.min(v + step, target) : Math.max(v - step, target);
    el.textContent = v;
    if (v === target) clearInterval(iv);
  }, 30);
}

function isToday(dateStr) {
  const d = new Date(dateStr), n = new Date();
  return d.getDate()===n.getDate() && d.getMonth()===n.getMonth() && d.getFullYear()===n.getFullYear();
}

/* ═══════════════════════════════════════════════
   WEEKLY CHART
═══════════════════════════════════════════════ */
function renderChart() {
  const history  = (user.stats.scanHistory || []);
  const weekDays = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i); weekDays.push(d);
  }
  const counts = weekDays.map(d =>
    history.filter(h => new Date(h.date).toDateString() === d.toDateString()).length);
  const max   = Math.max(...counts, 1);
  const total = counts.reduce((a,b)=>a+b,0);
  document.getElementById('chartTotal').textContent = total + ' scan' + (total!==1?'s':'');

  const chart  = document.getElementById('barChart');
  const daysEl = document.getElementById('barDays');
  chart.innerHTML = ''; daysEl.innerHTML = '';

  counts.forEach((c, i) => {
    const bar = document.createElement('div');
    bar.className = 'bar' + (i === 6 ? ' today' : '');
    bar.style.height = Math.max((c/max)*72, 4) + 'px';
    bar.title = weekDays[i].toLocaleDateString('en-US',{weekday:'short'}) + ': ' + c;
    chart.appendChild(bar);
    const lbl = document.createElement('div');
    lbl.className = 'bar-day';
    lbl.textContent = weekDays[i].toLocaleDateString('en-US',{weekday:'short'}).slice(0,2);
    daysEl.appendChild(lbl);
  });
}

/* ═══════════════════════════════════════════════
   MONTHLY CHART
═══════════════════════════════════════════════ */
function renderMonthlyChart() {
  const history = (user.stats.scanHistory || []);
  const months  = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const now     = new Date();
  const data    = months.map((_, mi) =>
    history.filter(h => h.converted && new Date(h.date).getMonth()===mi && new Date(h.date).getFullYear()===now.getFullYear())
           .reduce((a,b) => a+(b.amount||0), 0));
  const max       = Math.max(...data, 1);
  const yearTotal = data.reduce((a,b)=>a+b,0);
  document.getElementById('mccTotal').textContent = '$' + yearTotal.toFixed(0) + ' this year';

  const bars = document.getElementById('monthlyBars');
  const lbls = document.getElementById('monthlyLabels');
  bars.innerHTML = ''; lbls.innerHTML = '';
  data.forEach((v, i) => {
    const bar = document.createElement('div');
    bar.className = 'm-bar' + (i === now.getMonth() ? ' current' : '');
    bar.style.height = Math.max((v/max)*80, 4) + 'px';
    bar.title = months[i] + ': $' + v.toFixed(0);
    bars.appendChild(bar);
    const lbl = document.createElement('div');
    lbl.className = 'm-label';
    lbl.textContent = months[i].slice(0,1);
    lbls.appendChild(lbl);
  });
}

/* ═══════════════════════════════════════════════
   ACTIVITY FEED
═══════════════════════════════════════════════ */
let activityFilter = 'all';
let activitySearch = '';

function renderActivity() {
  const history = (user.stats.scanHistory || []).slice().reverse();
  renderActivityList('recentActivityList', history.slice(0,5), 'all');
  renderActivityList('activityFullList', history, activityFilter, activitySearch);

  const count = history.length;
  document.getElementById('activityCount').textContent = count + ' total';
  if (count > 0) {
    const badge = document.getElementById('activityBadge');
    badge.textContent  = Math.min(count, 9);
    badge.style.display = 'inline-flex';
  }
  renderTopLocations(history);
  renderTopDays(history);
  renderDonut();
}

function renderActivityList(containerId, items, filter, search) {
  const container = document.getElementById(containerId);
  if (!container) return;
  let filtered = filter==='all' ? items : items.filter(i=>i.type===filter);
  if (search) {
    const q = search.toLowerCase();
    filtered = filtered.filter(i => (i.city||'').toLowerCase().includes(q) || i.date.includes(q));
  }
  if (!filtered.length) {
    container.innerHTML = `<div class="empty-state"><span>${filter==='conversion'?'🛍️':'📡'}</span><p>${filter==='all'?'No activity yet. Wear your piece — every scan shows here instantly.':'No '+filter+'s yet.'}</p></div>`;
    return;
  }
  container.innerHTML = filtered.map(item => {
    const isConv  = item.type === 'conversion';
    const d       = new Date(item.date);
    const timeStr = d.toLocaleDateString('en-US',{month:'short',day:'numeric'}) + ' · ' + d.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'});
    return `<div class="activity-item">
      <div class="ai-dot ${item.type}"></div>
      <div class="ai-content">
        <div class="ai-title">${isConv ? '🛍️ Purchase via your QR' : '👁 QR code scanned'}</div>
        <div class="ai-meta">${item.city||'Unknown'} · ${timeStr}</div>
      </div>
      ${isConv ? `<div class="ai-amount ${item.status==='pending'?'pending-amt':'earned'}">+$${(item.amount||0).toFixed(2)}</div>` : ''}
    </div>`;
  }).join('');
}

function renderTopLocations(history) {
  const counts = {};
  history.forEach(h => { if (h.city) counts[h.city] = (counts[h.city]||0)+1; });
  const sorted = Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,5);
  const max    = sorted[0]?.[1] || 1;
  const el     = document.getElementById('topLocations');
  if (!el) return;
  if (!sorted.length) { el.innerHTML = '<div class="td-empty">No location data yet</div>'; return; }
  el.innerHTML = sorted.map(([city,n]) => `
    <div class="tl-item"><span>${city.split(',')[0]}</span><span>${n}</span></div>
    <div class="tl-bar"><div class="tl-bar-fill" style="width:${(n/max*100)}%"></div></div>`).join('');
}

function renderTopDays(history) {
  const counts = {};
  history.forEach(h => {
    const key = new Date(h.date).toLocaleDateString('en-US',{weekday:'short'});
    counts[key] = (counts[key]||0)+1;
  });
  const sorted = Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,4);
  const el = document.getElementById('topDays');
  if (!el) return;
  if (!sorted.length) { el.innerHTML = '<div class="td-empty">No data yet</div>'; return; }
  el.innerHTML = sorted.map(([day,n]) => `<div class="tl-item"><span>${day}</span><span>${n} scans</span></div>`).join('');
}

function renderDonut() {
  const canvas = document.getElementById('donutChart');
  if (!canvas) return;
  const ctx   = canvas.getContext('2d');
  const conv  = user.stats.conversions || 0;
  const total = user.stats.totalScans  || 0;
  ctx.clearRect(0,0,120,120);
  if (!total) {
    ctx.beginPath(); ctx.arc(60,60,44,0,Math.PI*2);
    ctx.strokeStyle='rgba(255,255,255,0.08)'; ctx.lineWidth=14; ctx.stroke(); return;
  }
  function arc(start, end, color) {
    ctx.beginPath(); ctx.arc(60,60,44,start,end);
    ctx.strokeStyle=color; ctx.lineWidth=14; ctx.stroke();
  }
  const convAngle = (conv/total)*Math.PI*2;
  arc(-Math.PI/2, -Math.PI/2+convAngle, '#22c55e');
  if (total-conv > 0) arc(-Math.PI/2+convAngle, -Math.PI/2+Math.PI*2, '#6C63FF');
  ctx.fillStyle='#f0f0f0'; ctx.font='bold 16px Space Grotesk,sans-serif';
  ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText(Math.round((conv/total)*100)+'%', 60, 60);
}

/* ═══════════════════════════════════════════════
   TRANSACTIONS
═══════════════════════════════════════════════ */
function renderTransactions() {
  const conversions = (user.stats.scanHistory||[]).filter(h=>h.converted).slice().reverse();
  const el = document.getElementById('transactionList');
  if (!el) return;
  if (!conversions.length) {
    el.innerHTML = `<div class="empty-state"><span>💳</span><p>No transactions yet. Earnings appear here when someone buys through your QR code.</p></div>`;
    return;
  }
  el.innerHTML = conversions.map(t => `
    <div class="ht-row">
      <span>${new Date(t.date).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}</span>
      <span>Referral · ${t.city||'Unknown'}</span>
      <span>+$${(t.amount||0).toFixed(2)}</span>
      <span><span class="ht-status ${t.status||'completed'}">${t.status||'Completed'}</span></span>
    </div>`).join('');
}

/* ═══════════════════════════════════════════════
   PURCHASES / WARDROBE
═══════════════════════════════════════════════ */
const HOODIE_COLORS = {
  'Phantom Black':{ body:'#1c1c1c', hood:'#111',    cord:'#555' },
  'Midnight Navy':{ body:'#0d1b35', hood:'#091428', cord:'#4a7dc4' },
  'Ember Crimson':{ body:'#2a0a0a', hood:'#1a0505', cord:'#8b3030' },
  'Forest Shadow':{ body:'#0b1a0d', hood:'#081208', cord:'#4a7850' },
  'Ash Stone':    { body:'#3a3a3a', hood:'#2a2a2a', cord:'#888' },
  'Void Purple':  { body:'#1a0d2e', hood:'#130924', cord:'#7c4dbb' },
  'Silver Mist':  { body:'#c8c8c4', hood:'#b0b0ab', cord:'#888' },
  'Bone':         { body:'#e8dfd0', hood:'#d8cfc0', cord:'#a89880' },
  'Tawny Dusk':   { body:'#b5895a', hood:'#9e7448', cord:'#7a5535' },
};

function hoodieSVG(name) {
  const c  = HOODIE_COLORS[name] || HOODIE_COLORS['Phantom Black'];
  const id = name.replace(/\s/g,'');
  return `<svg viewBox="0 0 300 340" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%">
    <defs>
      <linearGradient id="g_${id}" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%"   stop-color="rgba(0,0,0,0.4)"/>
        <stop offset="45%"  stop-color="rgba(255,255,255,0.05)"/>
        <stop offset="100%" stop-color="rgba(0,0,0,0.4)"/>
      </linearGradient>
    </defs>
    <path d="M73,82 L12,112 L6,208 L50,214 L60,128 Z" fill="${c.body}"/>
    <path d="M227,82 L288,112 L294,208 L250,214 L240,128 Z" fill="${c.body}"/>
    <path d="M60,128 L53,308 L247,308 L240,128 L227,82 Q200,70 150,65 Q100,70 73,82 Z" fill="${c.body}"/>
    <path d="M73,82 Q68,12 113,7 Q128,38 150,65 Q100,70 73,82 Z" fill="${c.hood}"/>
    <path d="M227,82 Q232,12 187,7 Q172,38 150,65 Q200,70 227,82 Z" fill="${c.hood}"/>
    <path d="M113,7 Q150,1 187,7 Q170,48 150,65 Q130,48 113,7 Z" fill="${c.hood}" opacity="0.7"/>
    <path d="M60,128 L53,308 L247,308 L240,128 L227,82 Q200,70 150,65 Q100,70 73,82 Z" fill="url(#g_${id})"/>
    <path d="M73,82 Q150,72 227,82" stroke="rgba(255,255,255,0.07)" stroke-width="2.5" fill="none"/>
    <path d="M6,205 Q28,213 50,211 L50,225 Q28,228 6,219 Z" fill="${c.hood}"/>
    <path d="M294,205 Q272,213 250,211 L250,225 Q272,228 294,219 Z" fill="${c.hood}"/>
    <path d="M53,305 L247,305 L247,320 Q150,326 53,320 Z" fill="${c.hood}"/>
    <path d="M103,205 Q150,198 197,205 L195,250 Q150,257 105,250 Z" fill="rgba(0,0,0,0.35)" stroke="rgba(255,255,255,0.04)" stroke-width="1"/>
    <line x1="150" y1="198" x2="150" y2="257" stroke="rgba(255,255,255,0.04)" stroke-width="1"/>
    <path d="M132,63 C128,85 123,105 117,124" stroke="${c.cord}" stroke-width="2.5" fill="none" stroke-linecap="round"/>
    <path d="M168,63 C172,85 177,105 183,124" stroke="${c.cord}" stroke-width="2.5" fill="none" stroke-linecap="round"/>
    <ellipse cx="117" cy="127" rx="4.5" ry="5.5" fill="${c.cord}"/>
    <ellipse cx="183" cy="127" rx="4.5" ry="5.5" fill="${c.cord}"/>
  </svg>`;
}

let _wardrobeTab = 'hoodie';
function setWardrobeTab(type, btn) {
  _wardrobeTab = type;
  document.querySelectorAll('.wardrobe-tab').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderPurchases();
}

function renderPurchases() {
  const grid = document.getElementById('purchasesGrid');
  if (!grid) return;
  const filtered = user.purchases.filter(p => {
    const isTee = (p.name || '').toLowerCase().includes('tee');
    return _wardrobeTab === 'tee' ? isTee : !isTee;
  });
  if (!filtered.length) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1">
      <span>👕</span><p>No pieces yet.</p>
      <a href="index.html" class="btn-shop-now">Browse the Collection →</a>
    </div>`;
    return;
  }
  grid.innerHTML = filtered.map(p => `
    <div class="purchase-card">
      <div class="pc-img">${hoodieSVG(p.name)}</div>
      <div class="pc-info">
        <h3>${p.name}</h3>
        <p>Ordered ${new Date(p.date).toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'})}</p>
        <div class="pc-qr-row">
          <div class="pc-code">${user.referralCode}</div>
          <span class="pc-scan-count">All scans tracked</span>
        </div>
      </div>
    </div>`).join('');
}

/* ═══════════════════════════════════════════════
   PAYOUT
═══════════════════════════════════════════════ */
function loadPayoutMethod() {
  const m = user.payoutMethod || 'cash';
  const r = document.querySelector(`input[name="payout"][value="${m}"]`);
  if (r) r.checked = true;
}
function savePayoutMethod() {
  const s = document.querySelector('input[name="payout"]:checked');
  if (!s) return;
  user.payoutMethod = s.value;
  updateUser(user);
  showToast('✓ Payout preference saved', 'success');
}

/* ═══════════════════════════════════════════════
   CASHOUT MODAL
═══════════════════════════════════════════════ */
function triggerCashout() {
  const avail = Math.max(0,(user.stats.totalEarned||0)-(user.stats.withdrawn||0));
  if (avail <= 0) return;
  document.getElementById('cashoutAmt').textContent = '$' + avail.toFixed(2);
  document.getElementById('cashoutModal').classList.add('show');
}
function confirmCashout() {
  const handle = document.getElementById('cashoutHandle').value.trim();
  if (!handle) { showToast('Enter your payout handle', 'error'); return; }
  const avail = Math.max(0,(user.stats.totalEarned||0)-(user.stats.withdrawn||0));
  user.stats.withdrawn = (user.stats.withdrawn||0) + avail;
  updateUser(user);
  closeModal('cashoutModal');
  showToast(`💸 $${avail.toFixed(2)} payout requested to ${handle}`, 'success');
  renderStats();
}
function openModal(id)  { document.getElementById(id).classList.add('show'); }
function closeModal(id) { document.getElementById(id).classList.remove('show'); }

/* ═══════════════════════════════════════════════
   COPY / SHARE
═══════════════════════════════════════════════ */
function copyRefLink() {
  const refURL = document.getElementById('refLinkInput').value;
  navigator.clipboard.writeText(refURL).catch(() => {
    const i = document.getElementById('refLinkInput'); i.select(); document.execCommand('copy');
  });
  showToast('✓ Referral link copied!', 'success');
}
function shareLink(type) {
  const refURL = document.getElementById('refLinkInput').value;
  if (type === 'copy') return copyRefLink();
  if (type === 'twitter') window.open('https://twitter.com/intent/tweet?text=I+earn+cash+just+by+wearing+this+hoodie+🔥+Scan+my+QR+code:+' + encodeURIComponent(refURL), '_blank');
  if (type === 'sms')     window.open('sms:?body=' + encodeURIComponent('Check out THREAD — I earn when you buy through my link: ' + refURL));
}

/* ═══════════════════════════════════════════════
   DOWNLOAD QR
═══════════════════════════════════════════════ */
function downloadQR() {
  const c   = document.getElementById('bigQrCanvas');
  const tmp = document.createElement('canvas');
  tmp.width = 300; tmp.height = 340;
  const ctx = tmp.getContext('2d');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0,0,300,340);
  ctx.drawImage(c, 40, 40);
  ctx.fillStyle = '#111'; ctx.font = 'bold 13px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('THREAD · ' + user.referralCode, 150, 320);
  const a = document.createElement('a');
  a.download = 'THREAD_QR_' + user.referralCode + '.png';
  a.href = tmp.toDataURL('image/png');
  a.click();
  showToast('✓ QR code downloaded!', 'success');
}

/* ═══════════════════════════════════════════════
   POTENTIAL EARNINGS CALC
═══════════════════════════════════════════════ */
function updatePotential() {
  const pieceSlider = document.getElementById('pieceSlider');
  const scanSlider2 = document.getElementById('scanSlider2');
  const pieces  = parseInt(pieceSlider?.value||1);
  const scans   = parseInt(scanSlider2?.value||10);
  document.getElementById('pieceCount').textContent    = pieces;
  document.getElementById('scanPerPiece').textContent  = scans;
  const monthly = pieces * scans * 4.33 * 0.18 * 20;
  document.getElementById('potentialAmount').textContent = '$' + Math.round(monthly/5)*5;
}

/* ═══════════════════════════════════════════════
   REAL-TIME SCAN SIMULATION
═══════════════════════════════════════════════ */
const CITIES = ['New York, NY','Los Angeles, CA','Chicago, IL','Houston, TX','Atlanta, GA',
  'Miami, FL','Dallas, TX','Seattle, WA','Denver, CO','Nashville, TN','Austin, TX',
  'Brooklyn, NY','Portland, OR','Phoenix, AZ','Charlotte, NC','San Diego, CA'];

function addRealTimeScan(converted) {
  const city   = CITIES[Math.floor(Math.random() * CITIES.length)];
  const amount = converted ? parseFloat((Math.random() * 14 + 10).toFixed(2)) : 0;
  const scan   = {
    type: converted ? 'conversion' : 'scan',
    date: new Date().toISOString(), city, converted, amount,
    status: converted ? 'pending' : undefined
  };

  user.stats.totalScans++;
  if (converted) {
    user.stats.conversions++;
    user.stats.pendingEarnings = parseFloat(((user.stats.pendingEarnings||0)+amount).toFixed(2));
  }
  user.stats.scanHistory.push(scan);
  updateUser(user);

  renderStats(); renderChart(); renderActivity(); renderTransactions(); renderDonut();
  addToLiveFeed(scan);

  const cardId = converted ? 'sc-conv' : 'sc-scans';
  const card   = document.getElementById(cardId);
  if (card) { card.style.borderColor = converted ? 'rgba(34,197,94,0.6)' : 'rgba(108,99,255,0.5)'; setTimeout(()=>card.style.borderColor='',1500); }

  const notif = document.getElementById('scanNotification');
  notif.className = 'scan-notification show ' + (converted ? 'conversion' : '');
  document.getElementById('snIcon').textContent  = converted ? '🛍️' : '👁';
  document.getElementById('snTitle').textContent = converted ? `New purchase! +$${amount.toFixed(2)} pending` : 'QR Code Scanned';
  document.getElementById('snMeta').textContent  = city + ' · just now';
  clearTimeout(notif._timer);
  notif._timer = setTimeout(() => notif.classList.remove('show'), 4500);

}

function addToLiveFeed(scan) {
  const feed = document.getElementById('liveFeedItems');
  if (!feed) return;
  const empty = feed.querySelector('.lsf-empty');
  if (empty) empty.remove();
  const item = document.createElement('div');
  item.className = 'lsf-item';
  item.innerHTML = `
    <div class="lsf-dot ${scan.type}"></div>
    <span class="lsf-city">${scan.city}</span>
    <span class="lsf-time">just now</span>
    ${scan.converted ? `<span class="lsf-amt">+$${scan.amount.toFixed(2)}</span>` : ''}`;
  feed.insertBefore(item, feed.firstChild);
  while (feed.children.length > 10) feed.removeChild(feed.lastChild);
}

let _demoScanTimer = null;

function scheduleNextScan() {
  if (!isDemoActive()) return;   // stop as soon as demo is turned off
  const delay = 8000 + Math.random() * 14000;  // 8–22s (faster so demo feels alive)
  _demoScanTimer = setTimeout(() => {
    if (!isDemoActive()) return;  // double-check before firing
    addRealTimeScan(Math.random() < 0.18);
    scheduleNextScan();
  }, delay);
}

function stopDemoScans() {
  if (_demoScanTimer) { clearTimeout(_demoScanTimer); _demoScanTimer = null; }
}

/* ═══════════════════════════════════════════════
   DEMO DATA TOGGLE
   State is kept in sessionStorage so it survives
   any accidental variable resets between renders.
═══════════════════════════════════════════════ */
const DEMO_KEY_STATS     = 'thread_demo_real_stats';
const DEMO_KEY_PURCHASES = 'thread_demo_real_purchases';
const DEMO_KEY_ACTIVE    = 'thread_demo_active';

function isDemoActive() {
  return sessionStorage.getItem(DEMO_KEY_ACTIVE) === '1';
}

function toggleDemo() {
  if (isDemoActive()) {
    clearDemoData();
  } else {
    loadDemoData();
  }
}

function loadDemoData() {
  /* save real data in sessionStorage so it always survives */
  sessionStorage.setItem(DEMO_KEY_STATS,     JSON.stringify(user.stats));
  sessionStorage.setItem(DEMO_KEY_PURCHASES, JSON.stringify(user.purchases));
  sessionStorage.setItem(DEMO_KEY_ACTIVE,    '1');

  const history = [];
  const now = Date.now();
  for (let i = 29; i >= 0; i--) {
    const n = Math.floor(Math.random() * 9);
    for (let j = 0; j < n; j++) {
      const d    = new Date(now - i*86400000 - Math.random()*50000000);
      const conv = Math.random() < 0.18;
      history.push({ type:conv?'conversion':'scan', date:d.toISOString(), city:CITIES[Math.floor(Math.random()*CITIES.length)], converted:conv, amount:conv?parseFloat((Math.random()*14+10).toFixed(2)):0, status:conv&&i<4?'pending':'completed' });
    }
  }
  user.purchases = [
    { name:'Phantom Black', price:89, date:new Date(now-25*86400000).toISOString() },
    { name:'Midnight Navy', price:89, date:new Date(now-10*86400000).toISOString() }
  ];
  const convItems = history.filter(h=>h.converted&&h.status==='completed');
  const pending   = history.filter(h=>h.converted&&h.status==='pending');
  user.stats = {
    totalScans:      history.length,
    conversions:     history.filter(h=>h.converted).length,
    pendingEarnings: parseFloat(pending.reduce((a,b)=>a+(b.amount||0),0).toFixed(2)),
    totalEarned:     parseFloat(convItems.reduce((a,b)=>a+(b.amount||0),0).toFixed(2)),
    scanHistory:     history
  };

  _updateDemoBtn(true);
  renderAll();
  scheduleNextScan();   // start live scan simulation only in demo mode
  showToast('📊 Demo mode on — live scans simulated', 'success');
}

function clearDemoData() {
  /* restore real data from sessionStorage */
  const savedStats     = sessionStorage.getItem(DEMO_KEY_STATS);
  const savedPurchases = sessionStorage.getItem(DEMO_KEY_PURCHASES);
  if (savedStats)     user.stats     = JSON.parse(savedStats);
  if (savedPurchases) user.purchases = JSON.parse(savedPurchases);

  sessionStorage.removeItem(DEMO_KEY_STATS);
  sessionStorage.removeItem(DEMO_KEY_PURCHASES);
  sessionStorage.removeItem(DEMO_KEY_ACTIVE);

  stopDemoScans();      // stop live scan simulation
  _updateDemoBtn(false);
  renderAll();
  showToast('Demo mode off — showing your real data', '');
}

function _updateDemoBtn(demoOn) {
  const btn = document.getElementById('demoBtn');
  if (!btn) return;
  if (demoOn) {
    btn.textContent       = '✕ Exit Demo';
    btn.style.borderColor = 'rgba(248,113,113,0.4)';
    btn.style.color       = '#f87171';
  } else {
    btn.textContent       = '🎬 Demo Mode';
    btn.style.borderColor = '';
    btn.style.color       = '';
  }
}

/* ═══════════════════════════════════════════════
   TOAST
═══════════════════════════════════════════════ */
let _toastTimer;
function showToast(msg, type='') {
  const t = document.getElementById('dbToast');
  t.textContent = msg;
  t.className   = 'db-toast show' + (type?' '+type:'');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
}

/* ═══════════════════════════════════════════════
   RENDER ALL
═══════════════════════════════════════════════ */
function renderAll() {
  renderStats();
  renderChart();
  renderMonthlyChart();
  renderActivity();
  renderTransactions();
  renderPurchases();
  loadPayoutMethod();
}
