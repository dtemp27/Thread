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
            name:         profile.name     || '',
            username:     profile.username || '',
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
            const now      = Date.now();
            const convs    = scans.filter(s => s.converted);
            const earned   = convs.reduce((s, r) => s + parseFloat(r.commission || 0), 0);
            const pending  = convs.filter(s => isScanPending(s, now)).reduce((s, r) => s + parseFloat(r.commission || 0), 0);
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
                status:    s.status || 'completed',
                clears_at: s.clears_at || null
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

function handleNewScan(scan) {
  const entry = {
    type:      scan.converted ? 'conversion' : 'scan',
    date:      scan.created_at || new Date().toISOString(),
    city:      scan.city || 'Unknown',
    converted: scan.converted || false,
    amount:    parseFloat(scan.commission || 0),
    status:    scan.status || 'completed'
  };
  user.stats.totalScans++;
  user.stats.scanHistory.unshift(entry);
  if (scan.converted) {
    user.stats.conversions++;
    user.stats.totalEarned     = parseFloat((user.stats.totalEarned + entry.amount).toFixed(2));
    user.stats.pendingEarnings = parseFloat((user.stats.pendingEarnings + entry.amount).toFixed(2));
  }
  renderStats(); renderActivity(); renderTransactions();
  showToast('👁 New scan — ' + (entry.city !== 'Unknown' ? entry.city : 'someone just scanned your code!'), 'success');
}

/* ═══════════════════════════════════════════════
   UI INIT (runs after user is loaded)
═══════════════════════════════════════════════ */
function bootUI() {

  /* ─── REFERRAL URL ─── */
  const baseURL = window.location.origin + '/';
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
  const displayHandle = user.username ? `@${user.username}` : ((user.name||'').split(' ')[0] || 'there');
  document.getElementById('welcomeMsg').textContent    = `Welcome back, ${displayHandle}! 👋`;
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

  /* ─── REAL-TIME SCAN LISTENER + POLLING FALLBACK ─── */
  if (_sb && user.id) {
    // Realtime (instant when it works)
    _sb.channel('dashboard_scans_' + user.id)
      .on('postgres_changes', {
        event:  'INSERT',
        schema: 'public',
        table:  'referral_scans',
        filter: `referrer_id=eq.${user.id}`
      }, payload => handleNewScan(payload.new))
      .subscribe();

    // Polling fallback every 15s — catches scans if realtime drops
    setInterval(async () => {
      try {
        const { data: scans } = await _sb.from('referral_scans')
          .select('*').eq('referrer_id', user.id)
          .order('created_at', { ascending: false });
        if (!scans) return;
        if (scans.length > user.stats.totalScans) {
          const newCount = scans.length - user.stats.totalScans;
          const now      = Date.now();
          const convs    = scans.filter(s => s.converted);
          const earned   = convs.reduce((s, r) => s + parseFloat(r.commission || 0), 0);
          const pending  = convs.filter(s => isScanPending(s, now)).reduce((s, r) => s + parseFloat(r.commission || 0), 0);
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
              status:    s.status || 'completed',
              clears_at: s.clears_at || null
            }))
          };
          renderStats(); renderActivity(); renderTransactions();
          showToast(`👁 ${newCount} new scan${newCount > 1 ? 's' : ''}!`, 'success');
        }
      } catch(e) {}
    }, 15000);
  }
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
  const titles = { overview:'Overview', qrcode:'My QR Code', earnings:'Earnings', activity:'Activity', purchases:'My Closet' };
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

async function _imgToDataURL(src) {
  // Method 1: fetch → FileReader (no canvas taint, works same-origin)
  try {
    const resp = await fetch(src);
    if (resp.ok) {
      const blob = await resp.blob();
      return await new Promise(resolve => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror  = () => resolve(null);
        reader.readAsDataURL(blob);
      });
    }
  } catch(e) {}
  // Method 2: img + canvas fallback
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width  = img.naturalWidth  || 100;
        c.height = img.naturalHeight || 100;
        c.getContext('2d').drawImage(img, 0, 0);
        resolve(c.toDataURL('image/png'));
      } catch(e) { resolve(null); }
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

async function drawQR(canvasId, text, size) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  canvas.style.display = 'none';
  const containerId = canvasId + '_qr';
  const old = document.getElementById(containerId);
  if (old) old.remove();

  const div = document.createElement('div');
  div.id = containerId;
  div.style.cssText = `display:inline-block;width:${size}px;height:${size}px;border-radius:16px;overflow:hidden;flex-shrink:0;`;
  canvas.parentElement.insertBefore(div, canvas);

  // Render at 4x for crisp high-res display, scaled down via CSS
  const renderSize  = size * 4;
  const logoDataUrl = await _imgToDataURL(new URL('images/Transparent-Logo.png', window.location.href).href);

  if (window.QRCodeStyling) {
    const qrOpts = {
      width:  renderSize,
      height: renderSize,
      type:   'canvas',
      data:   text,
      margin: 0,
      qrOptions: { errorCorrectionLevel: 'H' },
      dotsOptions:          { color: '#000000', type: 'dots' },
      cornersSquareOptions: { color: '#000000', type: 'extra-rounded' },
      cornersDotOptions:    { color: '#000000', type: 'dot' },
      backgroundOptions:    { color: '#ffffff' },
    };
    if (logoDataUrl) {
      qrOpts.image        = logoDataUrl;
      qrOpts.imageOptions = { margin: 6, imageSize: 0.25, hideBackgroundDots: true };
    }
    const qr = new QRCodeStyling(qrOpts);
    qr.append(div);
    // Scale high-res canvas down to display size for crispness
    setTimeout(() => {
      const c = div.querySelector('canvas');
      if (c) { c.style.width = size + 'px'; c.style.height = size + 'px'; }
    }, 400);
    return;
  }

  // Fallback: API image with CSS logo overlay
  const encoded  = encodeURIComponent(text);
  const logoSize = Math.floor(size * 0.18);
  div.style.cssText = `position:relative;display:inline-block;width:${size}px;height:${size}px;border-radius:16px;overflow:hidden;background:#fff;`;
  div.innerHTML = `
    <img src="https://api.qrserver.com/v1/create-qr-code/?size=${renderSize}x${renderSize}&data=${encoded}&margin=8&ecc=H"
         style="width:${size}px;height:${size}px;display:block;image-rendering:crisp-edges;" />
    <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);
                width:${logoSize+8}px;height:${logoSize+8}px;background:#fff;border-radius:6px;
                display:flex;align-items:center;justify-content:center;">
      <img src="images/Transparent-Logo.png" style="width:${logoSize}px;height:${logoSize}px;display:block;object-fit:contain;" />
    </div>`;
}

/* ═══════════════════════════════════════════════
   STATS RENDERING
═══════════════════════════════════════════════ */

const FALLBACK_HOLD_MS = 14 * 24 * 60 * 60 * 1000; // 14 days from conversion date

function isScanPending(scan, now) {
  if (scan.status !== 'pending') return false;
  if (scan.clears_at) return new Date(scan.clears_at).getTime() > now;
  // No delivery confirmation yet — hold for 14 days from conversion date as fallback
  const scanDate = new Date(scan.date || scan.created_at || 0).getTime();
  return (now - scanDate) < FALLBACK_HOLD_MS;
}

function renderStats() {
  const s     = user.stats;
  const scans = s.totalScans  || 0;
  const conv  = s.conversions || 0;
  const rate  = scans > 0 ? ((conv / scans) * 100).toFixed(1) : 0;
  const avail = Math.max(0, (s.totalEarned||0) - (s.pendingEarnings||0) - (s.withdrawn||0));

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
      <a href="catalog.html" class="btn-shop-now">Browse the Collection →</a>
    </div>`;
    return;
  }
  const HOODIE_PHOTO_SLUGS = {
    'Phantom Black':'phantom-black','Midnight Navy':'midnight-navy',
    'Ember Crimson':'ember-crimson','Forest Shadow':'forest-shadow',
    'Ash Stone':'ash-stone','Ivory Pure':'ivory-pure',
  };
  const TEE_PHOTO_SLUGS = {
    'Clean White':'clean-white','Raw Stone':'raw-stone',
    'Jet Black':'jet-black','Slate Grey':'slate-grey','Deep Navy':'deep-navy',
  };
  grid.innerHTML = filtered.map(p => {
    const isTee = (p.type || '').toLowerCase() === 'tee' || (p.name||'').toLowerCase().includes('tee');
    const cleanName = (p.name || '').replace(/\s+(Tee|Hoodie)$/i, '').trim();
    const slug = isTee
      ? (TEE_PHOTO_SLUGS[cleanName] || cleanName.toLowerCase().replace(/\s+/g,'-'))
      : (HOODIE_PHOTO_SLUGS[cleanName] || 'phantom-black');
    const imgSrc = isTee
      ? `images/tee-${slug}-front.png?v=tee-20260517`
      : `hoodie-variants/${slug}-front.png?v=hoodie-20260517`;
    return `
    <div class="purchase-card">
      <div class="pc-img">
        <img src="${imgSrc}" alt="${cleanName}" style="width:100%;height:auto;display:block;background:#1a1a1a">
      </div>
      <div class="pc-info">
        <h3>${p.name}</h3>
        <p>Ordered ${new Date(p.date).toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'})}</p>
        <div class="pc-qr-row">
          <div class="pc-code">${user.referralCode}</div>
          <span class="pc-scan-count">All scans tracked</span>
        </div>
      </div>
    </div>`;
  }).join('');
}

/* ═══════════════════════════════════════════════
   PAYOUT
═══════════════════════════════════════════════ */
const PAYOUT_META = {
  venmo:    { label: 'Your Venmo username',       placeholder: '@username',           hint: 'e.g. @jordanw — the handle people use to send you money' },
  paypal:   { label: 'Your PayPal email',         placeholder: 'you@email.com',       hint: 'The email address on your PayPal account' },
  zelle:    { label: 'Your Zelle phone or email', placeholder: '(801) 555-0000',      hint: 'Phone number or email linked to your Zelle account' },
  cashapp:  { label: 'Your Cash App $Cashtag',    placeholder: '$cashtag',            hint: 'e.g. $jordanw' },
  giftcard: { label: 'Preferred gift card brand', placeholder: 'Amazon, Nike, Apple...', hint: "We'll send a digital gift card to your email on file" },
  other:    { label: 'Describe your preference',  placeholder: 'e.g. Bitcoin, Venmo...', hint: "We'll reach out to confirm the best way to pay you" },
};

let _selectedPayoutMethod = null;

function selectPayoutMethod(method) {
  _selectedPayoutMethod = method;

  // Highlight selected pill
  document.querySelectorAll('.pp-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.method === method);
  });

  const meta  = PAYOUT_META[method] || PAYOUT_META.other;
  const wrap  = document.getElementById('payoutHandleWrap');
  const label = document.getElementById('payoutHandleLabel');
  const input = document.getElementById('payoutHandleInput');
  const hint  = document.getElementById('payoutHandleHint');

  label.textContent       = meta.label;
  input.placeholder       = meta.placeholder;
  hint.textContent        = meta.hint;
  wrap.style.display      = 'block';
  input.focus();
}

function loadPayoutMethod() {
  const method = user.payout_method || user.payoutMethod || null;
  const handle = user.payout_handle || null;
  if (!method) return;

  // Pre-select pill
  selectPayoutMethod(method);

  // Pre-fill handle
  const input = document.getElementById('payoutHandleInput');
  if (input && handle) input.value = handle;

  // Show saved badge
  const badge = document.getElementById('payoutSavedBadge');
  if (badge && handle) badge.style.display = 'inline-flex';
}

async function savePayoutMethod() {
  if (!_selectedPayoutMethod) { showToast('Select a payout method first', 'error'); return; }
  const handle = (document.getElementById('payoutHandleInput')?.value || '').trim();
  if (!handle) { showToast('Enter your payout details', 'error'); return; }

  try {
    const sb = getSB();
    if (sb && user.id) {
      const { error } = await sb.from('profiles').update({
        payout_method: _selectedPayoutMethod,
        payout_handle: handle,
      }).eq('id', user.id);
      if (error) throw new Error(error.message);
    }
    // Update local cache
    user.payout_method = _selectedPayoutMethod;
    user.payout_handle = handle;

    const badge = document.getElementById('payoutSavedBadge');
    if (badge) badge.style.display = 'inline-flex';
    showToast('✓ Payout method saved', 'success');
  } catch(e) {
    showToast('Save failed: ' + e.message, 'error');
  }
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
async function downloadQR() {
  const size    = 300;
  const refURL  = document.getElementById('refLinkInput').value;
  const encoded = encodeURIComponent(refURL);
  const apiUrl  = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encoded}&margin=8`;

  try {
    // Fetch QR image and draw it onto a canvas with the logo + label
    const resp = await fetch(apiUrl);
    const blob = await resp.blob();
    const qrDataUrl = await new Promise(resolve => {
      const r = new FileReader(); r.onloadend = () => resolve(r.result); r.readAsDataURL(blob);
    });

    const tmp = document.createElement('canvas');
    tmp.width = size; tmp.height = size + 40;
    const ctx = tmp.getContext('2d');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, tmp.width, tmp.height);

    // Draw QR
    const qrImg = new Image();
    await new Promise(resolve => { qrImg.onload = resolve; qrImg.src = qrDataUrl; });
    ctx.drawImage(qrImg, 0, 0, size, size);

    // Draw TLogo in center
    const logoSize = Math.floor(size * 0.22);
    const lx = (size - logoSize) / 2, ly = (size - logoSize) / 2;
    try {
      const logo = new Image();
      await new Promise((resolve, reject) => { logo.onload = resolve; logo.onerror = reject; logo.src = 'images/Transparent-Logo.png'; });
      ctx.fillStyle = '#fff';
      ctx.fillRect(lx - 4, ly - 4, logoSize + 8, logoSize + 8);
      ctx.drawImage(logo, lx, ly, logoSize, logoSize);
    } catch(_) {}

    // Label
    ctx.fillStyle = '#111'; ctx.font = 'bold 13px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('THREAD · ' + user.referralCode, size / 2, size + 26);

    const a = document.createElement('a');
    a.download = 'THREAD_QR_' + user.referralCode + '.png';
    a.href = tmp.toDataURL('image/png');
    a.click();
    showToast('✓ QR code downloaded!', 'success');
  } catch(e) {
    // Fallback: just open the QR API URL directly
    window.open(apiUrl, '_blank');
    showToast('✓ QR code opened!', 'success');
  }
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
  loadFollowing();
}

/* ═══════════════════════════════════════════════
   FOLLOWING
═══════════════════════════════════════════════ */
let _followTab = 'following';
let _followSearchTimer = null;

function switchFollowTab(tab) {
  _followTab = tab;
  document.getElementById('fwTabFollowing').classList.toggle('active', tab === 'following');
  document.getElementById('fwTabRequests').classList.toggle('active', tab === 'requests');
  document.getElementById('followingList').style.display  = tab === 'following' ? '' : 'none';
  document.getElementById('requestsList').style.display   = tab === 'requests'  ? '' : 'none';
  document.getElementById('followSearchResults').style.display = 'none';
  document.getElementById('followSearchInput').value = '';
}

function followSearch(query) {
  clearTimeout(_followSearchTimer);
  const results = document.getElementById('followSearchResults');
  if (!query.trim()) { results.style.display = 'none'; return; }
  _followSearchTimer = setTimeout(() => doFollowSearch(query.trim()), 350);
}

async function doFollowSearch(query) {
  const results = document.getElementById('followSearchResults');
  results.style.display = 'block';
  results.innerHTML = '<div style="padding:8px 16px;color:#666;font-size:13px">Searching…</div>';
  try {
    if (!_sb) { results.innerHTML = '<div style="padding:8px 16px;color:#666;font-size:13px">Not connected</div>'; return; }
    const q = query.replace(/^@/, '').toLowerCase();
    const { data, error } = await _sb.rpc('search_users_for_follow', { p_query: q, p_self_id: user.id });
    if (error || !data?.length) {
      results.innerHTML = '<div style="padding:10px 16px;color:#555;font-size:13px">No users found</div>';
      return;
    }
    results.innerHTML = data.map(u => {
      const statusMap = { accepted: 'Following', pending: 'Requested', incoming: 'Accept?' };
      const status = u.follow_status;
      const btnHtml = status === 'accepted'
        ? `<button class="fw-action-btn fw-unfollow" onclick="unfollowUser('${u.id}','${escFw(u.name)}')">Unfollow</button>`
        : status === 'pending'
        ? `<button class="fw-action-btn" style="opacity:.5;cursor:default">Requested</button>`
        : status === 'incoming'
        ? `<button class="fw-action-btn fw-accept" onclick="acceptFollowFromSearch('${u.follow_id}')">Accept</button>`
        : `<button class="fw-action-btn fw-follow" onclick="sendFollowRequest('${u.id}','${escFw(u.name)}',this)">Follow</button>`;
      return `<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 16px;border-bottom:1px solid #1a1a1a">
        <div>
          <div style="font-weight:600;font-size:14px">${escFw(u.name || 'Unknown')}</div>
          <div style="font-size:12px;color:#7c3aed">@${escFw(u.username || '—')}</div>
        </div>
        ${btnHtml}
      </div>`;
    }).join('');
  } catch(e) {
    results.innerHTML = `<div style="padding:8px 16px;color:#f87171;font-size:13px">Error: ${e.message}</div>`;
  }
}

async function sendFollowRequest(targetId, targetName, btn) {
  if (!_sb || !user?.id) return;
  if (btn) { btn.textContent = '…'; btn.disabled = true; }
  try {
    const { error } = await _sb.rpc('send_follow_request', { p_target_id: targetId });
    if (error) throw new Error(error.message);
    if (btn) { btn.textContent = 'Requested'; btn.disabled = true; btn.style.opacity = '.5'; }
    showToast(`Follow request sent to ${targetName}`, 'success');
  } catch(e) {
    if (btn) { btn.textContent = 'Follow'; btn.disabled = false; }
    showToast('Failed: ' + e.message, 'error');
  }
}

async function acceptFollowFromSearch(followId) {
  await respondToRequest(followId, true);
  doFollowSearch(document.getElementById('followSearchInput').value);
}

async function loadFollowing() {
  if (!_sb || !user?.id) {
    document.getElementById('followingList').innerHTML = '<div class="lb-empty">Sign in to use following</div>';
    return;
  }
  try {
    // Load following
    const { data: following } = await _sb.rpc('get_my_following', { p_user_id: user.id });
    renderFollowingList(following || []);

    // Load incoming requests
    const { data: requests } = await _sb.rpc('get_my_follow_requests', { p_user_id: user.id });
    renderRequestsList(requests || []);
  } catch(e) {
    document.getElementById('followingList').innerHTML = `<div class="lb-empty">Error loading</div>`;
  }
}

function renderFollowingList(list) {
  const el = document.getElementById('followingList');
  if (!list.length) {
    el.innerHTML = '<div class="lb-empty">Not following anyone yet — search a username above to send a request</div>';
    return;
  }
  el.innerHTML = list.map(f => `
    <div class="fw-row">
      <div class="fw-avatar">${(f.name||'?')[0].toUpperCase()}</div>
      <div class="fw-info">
        <div class="fw-name">${escFw(f.name || '—')}</div>
        <div class="fw-handle">@${escFw(f.username || '—')}</div>
      </div>
      <div class="fw-stats">
        <div class="fw-stat"><span class="fw-stat-val">${f.total_scans || 0}</span><span class="fw-stat-label">scans</span></div>
        <div class="fw-stat"><span class="fw-stat-val green">$${parseFloat(f.total_earned||0).toFixed(0)}</span><span class="fw-stat-label">earned</span></div>
      </div>
      <button class="fw-action-btn fw-unfollow" onclick="unfollowUser('${f.following_id}','${escFw(f.name)}')">Unfollow</button>
    </div>
  `).join('');
}

function renderRequestsList(list) {
  const badge = document.getElementById('fwRequestBadge');
  if (badge) { badge.textContent = list.length; badge.style.display = list.length ? 'inline' : 'none'; }
  const el = document.getElementById('requestsList');
  if (!list.length) { el.innerHTML = '<div class="lb-empty">No pending requests</div>'; return; }
  el.innerHTML = list.map(r => `
    <div class="fw-row" id="fwreq-${r.follow_id}">
      <div class="fw-avatar">${(r.name||'?')[0].toUpperCase()}</div>
      <div class="fw-info">
        <div class="fw-name">${escFw(r.name || '—')}</div>
        <div class="fw-handle">@${escFw(r.username || '—')}</div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end">
        <button class="fw-action-btn fw-follow" onclick="acceptAndFollowBack('${r.follow_id}','${r.follower_id}','${escFw(r.name)}',this)">Follow Back</button>
        <button class="fw-action-btn fw-accept" onclick="respondToRequest('${r.follow_id}', true)">Accept</button>
        <button class="fw-action-btn fw-decline" onclick="respondToRequest('${r.follow_id}', false)">Decline</button>
      </div>
    </div>
  `).join('');
}

async function respondToRequest(followId, accept) {
  if (!_sb) return;
  try {
    const { error } = await _sb.rpc('respond_to_follow_request', { p_follow_id: followId, p_accept: accept });
    if (error) throw new Error(error.message);
    showToast(accept ? 'Request accepted' : 'Request declined', 'success');
    loadFollowing();
  } catch(e) { showToast('Error: ' + e.message, 'error'); }
}

async function acceptAndFollowBack(followId, requesterId, requesterName, btn) {
  if (!_sb) return;
  btn.textContent = '…'; btn.disabled = true;
  try {
    // Accept their request
    const { error: e1 } = await _sb.rpc('respond_to_follow_request', { p_follow_id: followId, p_accept: true });
    if (e1) throw new Error(e1.message);
    // Send a follow request back to them
    const { error: e2 } = await _sb.rpc('send_follow_request', { p_target_id: requesterId });
    if (e2) throw new Error(e2.message);
    showToast(`Accepted & followed ${requesterName} back`, 'success');
    loadFollowing();
  } catch(e) {
    btn.textContent = 'Follow Back'; btn.disabled = false;
    showToast('Error: ' + e.message, 'error');
  }
}

async function unfollowUser(targetId, targetName) {
  if (!_sb || !user?.id) return;
  if (!confirm(`Unfollow ${targetName}?`)) return;
  try {
    const { error } = await _sb.rpc('unfollow_user', { p_target_id: targetId });
    if (error) throw new Error(error.message);
    showToast(`Unfollowed ${targetName}`, 'success');
    loadFollowing();
    doFollowSearch(document.getElementById('followSearchInput').value);
  } catch(e) { showToast('Error: ' + e.message, 'error'); }
}

function escFw(s) { return String(s||'').replace(/'/g,"&#39;").replace(/"/g,"&quot;"); }
