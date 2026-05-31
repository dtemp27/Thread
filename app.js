/* ──

/* ─── BEHAVIOUR TRACKING ─── */
(async function () {
  try {
    // earn.html has its own analytics block — skip here to avoid logging false 'home' visits
    const _path = window.location.pathname;
    const _isHome = _path === '/' || _path.endsWith('/index.html') || _path === '';
    if (!_isHome) return;

    const cfg = window.THREAD_CONFIG;
    if (!cfg?.supabaseUrl || !window.supabase) return;
    const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
    const PAGE = 'home';

    // Use let so _threadTrackRaw can close over these and read their final values
    // even when called before the geo fetch resolves (they'll just be null then).
    let ip = null, country = null, city = null, region = null;

    // Expose raw tracker IMMEDIATELY — before the geo fetch — so add-to-cart
    // events are never dropped if the user clicks fast on the first page load.
    window._threadTrackRaw = async function(type, label) {
      try { await sb.rpc('log_page_event', { p_event_type: type, p_ip: ip, p_country: country, p_city: city, p_region: region, p_page: PAGE, p_label: label }); } catch(_) {}
    };

    // Fetch geo once per session and cache it
    try {
      const cached = sessionStorage.getItem('thread_geo');
      const geo = cached ? JSON.parse(cached) : null;
      if (geo) {
        ip = geo.ip || null; country = geo.country_name || null; city = geo.city || null; region = geo.region || null;
      } else {
        const r = await fetch('https://ipapi.co/json/');
        if (r.ok) {
          const g = await r.json();
          sessionStorage.setItem('thread_geo', JSON.stringify(g));
          ip = g.ip || null; country = g.country_name || null; city = g.city || null; region = g.region || null;
        }
      }
    } catch(_) {}

    // Skip all tracking for owner's own IPs
    const OWNER_IPS = ['65.130.60.246', '187.199.28.205', '187.199.69.171'];
    if (OWNER_IPS.includes(ip)) {
      window._threadTrackRaw = null; // disable tracker for owner
      return;
    }

    // Helper: fire an event (throttled per label to avoid duplicates)
    async function track(type, label) {
      const key = `thread_tracked_${type}_${label}`;
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, '1');
      try {
        await sb.rpc('log_page_event', { p_event_type: type, p_ip: ip, p_country: country, p_city: city, p_region: region, p_page: PAGE, p_label: label });
      } catch(_) {}
    }

    // 1 — Page visit
    await track('visit', PAGE);

    // 2 — Time on page (setTimeout milestones — pagehide + fetch is cancelled by browsers on unload)
    [[15000, '15s+'], [30000, '30s+'], [60000, '1m+'], [180000, '3m+'], [300000, '5m+']].forEach(([delay, label]) => {
      setTimeout(() => track('time_on_page', label), delay);
    });

    // 3 — Scroll depth milestones (25 / 50 / 75 / 90 %)
    const _scrollFired = new Set();
    window.addEventListener('scroll', () => {
      const pct = Math.round((window.scrollY / (document.body.scrollHeight - window.innerHeight)) * 100);
      [25, 50, 75, 90].forEach(m => {
        if (pct >= m && !_scrollFired.has(m)) { _scrollFired.add(m); track('scroll_depth', m + '%'); }
      });
    }, { passive: true });

    // 4 — CTA click tracking (delegated)
    document.addEventListener('click', e => {
      const el = e.target.closest('a,button,[data-track]');
      if (!el) return;
      const label =
        el.dataset.track ||
        el.id ||
        (el.textContent || '').trim().slice(0, 40) ||
        el.className.split(' ')[0];
      if (label) track('click', label);
    });

    // 5 — Section visibility (Intersection Observer)
    const sections = document.querySelectorAll('section[id], .section[id], [data-section]');
    if (sections.length && 'IntersectionObserver' in window) {
      const obs = new IntersectionObserver(entries => {
        entries.forEach(en => { if (en.isIntersecting) track('section_view', en.target.id || en.target.dataset.section); });
      }, { threshold: 0.4 });
      sections.forEach(s => obs.observe(s));
    }

  } catch(_) {}
})();
/* ─── WELCOME STATE (post-signup from earn page) ─── */
(function () {
  if (new URLSearchParams(window.location.search).get('welcome') !== '1') return;

  // Clean URL so refresh doesn't re-trigger
  history.replaceState({}, '', window.location.pathname);

  // Append welcome bar as the last child of #navbar so it always sits flush
  // below the nav-inner — no height measurement needed, works on all devices.
  window.addEventListener('DOMContentLoaded', () => {
    requestAnimationFrame(() => {
      const navbar = document.getElementById('navbar');
      if (!navbar) return;

      // Make the navbar stack its children vertically so the bar flows below nav-inner
      navbar.style.flexDirection = 'column';

      const bar = document.createElement('div');
      bar.id = 'welcomeBar';
      bar.style.cssText = [
        'width:100%',
        'background:linear-gradient(90deg,#14532d,#166534)',
        'color:#fff',
        'padding:11px 16px',
        'display:flex','align-items:center','justify-content:center','gap:10px',
        'font-family:Space Grotesk,sans-serif','font-size:13px','font-weight:600',
        'box-shadow:0 2px 12px rgba(0,0,0,0.4)',
      ].join(';');

      bar.innerHTML = `
        <span style="font-size:16px">✓</span>
        <span>You're in! <span style="font-weight:400;opacity:.9">Order your piece below — your QR code gets printed on it and you start earning.</span></span>
        <a href="#shop" onclick="document.getElementById('shop')?.scrollIntoView({behavior:'smooth'});return false;"
           style="background:#22c55e;color:#fff;border-radius:50px;padding:6px 14px;font-size:12px;font-weight:700;white-space:nowrap;text-decoration:none;flex-shrink:0">
          Shop Now →
        </a>
        <button onclick="document.getElementById('welcomeBar')?.remove();var nb=document.getElementById('navbar');if(nb)nb.style.flexDirection='';"
                style="background:none;border:none;color:#fff;opacity:.6;cursor:pointer;font-size:18px;line-height:1;padding:0;flex-shrink:0">✕</button>
      `;
      navbar.appendChild(bar);

      // Auto-scroll to shop after brief pause
      setTimeout(() => {
        const shop = document.getElementById('shop');
        if (shop) shop.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 900);
    });
  });
})();

/* ─── AUTH STATE + GLOBAL NAV ─── */
async function renderNavAuth() {
  const actions = document.getElementById('navActions');
  const navLinks = document.querySelector('#navbar .nav-links');
  if (!actions) return;

  // Try Supabase first; fall back to localStorage session
  let user = null;
  try {
    if (window.DB?.auth?.getUser) user = await window.DB.auth.getUser();
  } catch(_) {}
  if (!user) {
    try { user = JSON.parse(localStorage.getItem('thread_session') || 'null'); }
    catch(_) {}
  }

  if (user) {
    // SIGNED IN — show Dashboard button + Sign Out
    // Try to grab the real name from the Supabase profiles table; fall back to metadata/email
    let displayName = user.user_metadata?.name || user.name || '';
    let avatarUrl = null;
    try {
      if (window.DB?.profiles?.get && user.id) {
        const profile = await window.DB.profiles.get(user.id);
        if (profile?.name) displayName = profile.name;
        if (profile?.avatar_url) avatarUrl = profile.avatar_url;
      }
    } catch(_) {}
    if (!displayName) {
      displayName = (user.email || 'You').split('@')[0];
    }
    const initial = (displayName.trim()[0] || 'U').toUpperCase();
    const avatarHtml = avatarUrl
      ? `<img src="${avatarUrl}" style="width:26px;height:26px;border-radius:50%;object-fit:cover;flex-shrink:0" onerror="this.outerHTML='<div class=nav-user-avatar>${initial}</div>'" />`
      : `<div class="nav-user-avatar">${initial}</div>`;
    actions.innerHTML = `
      <a href="dashboard.html" class="nav-user-pill" title="${displayName}'s dashboard">
        ${avatarHtml}
        Dashboard
      </a>
      <button class="btn-ghost btn-signout" onclick="threadSignOut()">Sign Out</button>
    `;
  } else {
    // SIGNED OUT — show Log In / Join Free
    actions.innerHTML = `
      <a href="auth.html?tab=signin" class="btn-ghost" id="navLogin">Log In</a>
      <a href="auth.html" class="btn-primary" id="navJoin">Join Free</a>
    `;
  }
}

async function threadSignOut() {
  try { if (window.DB?.auth?.signOut) await window.DB.auth.signOut(); } catch(_) {}
  localStorage.removeItem('thread_session');
  window.location.href = 'index.html';
}

// Run once DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', renderNavAuth);
} else {
  renderNavAuth();
}

/* ─── REFERRAL TRACKING ─── */
(async function () {
  const ref = new URLSearchParams(window.location.search).get('ref');
  if (!ref) return;
  localStorage.setItem('thread_ref', ref);

  // Don't double-count if user refreshes the page in the same session
  const scanKey = 'thread_scan_logged_' + ref;
  const alreadyLogged = sessionStorage.getItem(scanKey);

  // Log the scan to Supabase via RPC (bypasses RLS lookup issues)
  if (!alreadyLogged) {
    try {
      const cfg = window.THREAD_CONFIG;
      if (cfg?.supabaseUrl && window.supabase) {
        // Skip logging for owner's own IPs
        const cachedGeo = sessionStorage.getItem('thread_geo');
        const currentIp = cachedGeo ? JSON.parse(cachedGeo).ip : null;
        const OWNER_IPS = ['65.130.60.246', '187.199.28.205', '187.199.69.171'];
        if (OWNER_IPS.includes(currentIp)) {
          sessionStorage.setItem(scanKey, '1'); // mark done so we don't retry
        } else {
          const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
          // Log to referral system (for user referral codes linked to profiles)
          const { data: rpcData, error } = await sb.rpc('log_referral_scan', { ref_code: ref, scan_city: null });
          console.log('[THREAD] scan log result - ref:', ref, 'data:', rpcData, 'error:', error);
          if (error) console.error('[THREAD] scan log FAILED:', JSON.stringify(error));
          // ALSO log to tracked QR system (for admin-added codes like "bogoegg")
          // Safe no-op if the code isn't in tracked_qr_codes table
          try { await sb.rpc('log_tracked_qr_scan', { p_code: ref }); } catch(_) {}
          // Mark session as logged regardless (avoids double-counting on refresh)
          sessionStorage.setItem(scanKey, '1');
        }
      }
    } catch(e) { console.warn('[ref] scan log failed:', e); }
  }

  // Show referral banner
  const referrer = await window.DB?.profiles?.getByReferralCode(ref).catch(() => null);
  const banner = document.createElement('div');
  banner.className = 'ref-banner';
  const handle = referrer?.username ? `@${referrer.username}` : null;
  banner.innerHTML = handle
    ? `👕 You were referred by <span>${handle}</span> — they earn when you buy!`
    : `👕 You arrived via a THREAD referral link — they earn when you buy!`;
  document.body.appendChild(banner);
  setTimeout(() => banner.classList.add('show'), 600);
  setTimeout(() => banner.classList.remove('show'), 6000);
})();

/* ─── NAVBAR SCROLL ─── */
const navbar = document.getElementById('navbar');
window.addEventListener('scroll', () => {
  navbar.classList.toggle('scrolled', window.scrollY > 50);
});

/* ─── QR CODE GENERATOR (decorative grid) ─── */
function generateQR(containerId, size) {
  const container = document.getElementById(containerId);
  if (!container) return;
  function finderAt(rOff, cOff) {
    const cells = [];
    for (let r = 0; r < 7; r++)
      for (let c = 0; c < 7; c++)
        if (r===0||r===6||c===0||c===6||(r>=2&&r<=4&&c>=2&&c<=4))
          cells.push([r+rOff, c+cOff]);
    return cells;
  }
  const pattern = [...finderAt(0,0), ...finderAt(0,size-7), ...finderAt(size-7,0)];
  for (let i = 8; i < size-8; i++) {
    if (i%2===0) { pattern.push([6,i]); pattern.push([i,6]); }
  }
  const patSet = new Set(pattern.map(([r,c])=>r*100+c));
  function inQuiet(r,c){ return (r<9&&c<9)||(r<9&&c>=size-8)||(r>=size-8&&c<9); }
  for (let r=0;r<size;r++) for (let c=0;c<size;c++) {
    const el = document.createElement('div');
    el.classList.add('qr-cell');
    if (patSet.has(r*100+c) || (!inQuiet(r,c) && Math.random()>0.48)) el.classList.add('filled');
    container.appendChild(el);
  }
  container.style.gridTemplateColumns = `repeat(${size},1fr)`;
}

generateQR('qrGrid', 7);
generateQR('qrDemoGrid', 9);

/* ─── STYLED HERO QR (SVG — fixed seed, branded look) ─── */
function buildHeroQR() {
  const svg = document.getElementById('qrHeroSvg');
  if (!svg) return;

  const NS  = 'http://www.w3.org/2000/svg';
  const S   = 21;
  const M   = 9;
  const PAD = 5;
  const R   = M * 0.40;

  // Fixed seeded RNG — same pattern every single page load
  let _seed = 8675309;
  function rand() {
    _seed ^= _seed << 13;
    _seed ^= _seed >> 17;
    _seed ^= _seed << 5;
    return ((_seed >>> 0) / 0xFFFFFFFF);
  }

  function mk(tag, attrs) {
    const el = document.createElementNS(NS, tag);
    Object.entries(attrs).forEach(([k,v]) => el.setAttribute(k, v));
    return el;
  }

  // White background
  svg.appendChild(mk('rect',{width:210,height:210,fill:'white',rx:10}));

  // Areas reserved for finder patterns + separators
  function inFinder(r,c) {
    return (r<9&&c<9)||(r<9&&c>=S-8)||(r>=S-8&&c<9);
  }
  // Center logo area — clear 5×5 around center module
  const cMid = Math.floor(S/2);
  function inCenter(r,c) {
    return Math.abs(r-cMid)<=2 && Math.abs(c-cMid)<=2;
  }
  // Timing strips
  const timing = new Set();
  for (let i=8;i<S-8;i++) { timing.add(6*100+i); timing.add(i*100+6); }

  // Pre-generate the fixed data module grid
  const modules = Array.from({length:S}, (_,r) =>
    Array.from({length:S}, (_,c) => {
      if (inFinder(r,c) || inCenter(r,c)) return false;
      if (timing.has(r*100+c)) return (r+c)%2===0;
      return rand() > 0.46;
    })
  );

  // Draw data dots
  for (let r=0;r<S;r++) for (let c=0;c<S;c++) {
    if (!modules[r][c]) continue;
    svg.appendChild(mk('circle',{
      cx: PAD + c*M + M/2,
      cy: PAD + r*M + M/2,
      r:  R, fill:'#111'
    }));
  }

  // Finder patterns — rounded iOS style
  function drawFinder(rOff, cOff) {
    const x = PAD+cOff*M, y = PAD+rOff*M, sz=7*M, rd=M*1.5;
    svg.appendChild(mk('rect',{x,y,width:sz,height:sz,rx:rd,fill:'#111'}));
    svg.appendChild(mk('rect',{x:x+M,y:y+M,width:sz-2*M,height:sz-2*M,rx:rd*0.65,fill:'white'}));
    svg.appendChild(mk('rect',{x:x+2*M,y:y+2*M,width:3*M,height:3*M,rx:M*0.75,fill:'#111'}));
  }
  drawFinder(0,0);
  drawFinder(0,S-7);
  drawFinder(S-7,0);

  // Center T. logo — white circle + text
  const cx = PAD + cMid*M + M/2, cy = PAD + cMid*M + M/2;
  svg.appendChild(mk('circle',{cx,cy,r:M*2.2,fill:'white'}));
  const t = mk('text',{
    x:cx, y:cy+6,
    'text-anchor':'middle',
    'dominant-baseline':'middle',
    'font-family':'Space Mono,monospace',
    'font-weight':'700',
    'font-size':'17',
    fill:'#111'
  });
  t.textContent = 'T.';
  svg.appendChild(t);
}

buildHeroQR();

// Reuse same styled QR builder for the demo section
function buildDemoQR() {
  const svg = document.getElementById('qrDemoSvg');
  if (!svg) return;
  const NS = 'http://www.w3.org/2000/svg';
  const S=21, M=8, PAD=4, R=M*0.40;
  let _seed = 8675309;
  function rand() { _seed^=_seed<<13; _seed^=_seed>>17; _seed^=_seed<<5; return((_seed>>>0)/0xFFFFFFFF); }
  function mk(tag,attrs){ const el=document.createElementNS(NS,tag); Object.entries(attrs).forEach(([k,v])=>el.setAttribute(k,v)); return el; }
  svg.appendChild(mk('rect',{width:210,height:210,fill:'white',rx:8}));
  function inFinder(r,c){ return(r<9&&c<9)||(r<9&&c>=S-8)||(r>=S-8&&c<9); }
  const cMid=Math.floor(S/2);
  function inCenter(r,c){ return Math.abs(r-cMid)<=2&&Math.abs(c-cMid)<=2; }
  const timing=new Set();
  for(let i=8;i<S-8;i++){timing.add(6*100+i);timing.add(i*100+6);}
  for(let r=0;r<S;r++) for(let c=0;c<S;c++){
    if(inFinder(r,c)||inCenter(r,c)) continue;
    const isTiming=timing.has(r*100+c);
    const filled=isTiming?(r+c)%2===0:rand()>0.46;
    if(filled) svg.appendChild(mk('circle',{cx:PAD+c*M+M/2,cy:PAD+r*M+M/2,r:R,fill:'#111'}));
  }
  function drawFinder(rOff,cOff){
    const x=PAD+cOff*M,y=PAD+rOff*M,sz=7*M,rd=M*1.5;
    svg.appendChild(mk('rect',{x,y,width:sz,height:sz,rx:rd,fill:'#111'}));
    svg.appendChild(mk('rect',{x:x+M,y:y+M,width:sz-2*M,height:sz-2*M,rx:rd*0.65,fill:'white'}));
    svg.appendChild(mk('rect',{x:x+2*M,y:y+2*M,width:3*M,height:3*M,rx:M*0.75,fill:'#111'}));
  }
  drawFinder(0,0); drawFinder(0,S-7); drawFinder(S-7,0);
  const cx=PAD+cMid*M+M/2, cy=PAD+cMid*M+M/2;
  svg.appendChild(mk('circle',{cx,cy,r:M*2.2,fill:'white'}));
  const t=mk('text',{x:cx,y:cy+6,'text-anchor':'middle','dominant-baseline':'middle','font-family':'Space Mono,monospace','font-weight':'700','font-size':'15',fill:'#111'});
  t.textContent='T.'; svg.appendChild(t);
}
buildDemoQR();

/* ─── HERO PARALLAX ─── */
const heroBg = document.getElementById('heroBg');
const shirtMockup = document.getElementById('shirtMockup');

window.addEventListener('scroll', () => {
  const scrollY = window.scrollY;
  if (heroBg) heroBg.style.transform = `translateY(${scrollY * 0.4}px)`;
  if (shirtMockup) {
    const base = parseFloat(shirtMockup.style.getPropertyValue('--float') || 0);
    shirtMockup.style.transform = `translateY(${scrollY * 0.15}px) rotate(-2deg)`;
  }
});

/* ─── PARALLAX STRIPS ─── */
const parallaxBg = document.getElementById('parallaxBg');
const parallaxBg2 = document.getElementById('parallaxBg2');
const strip1 = document.getElementById('parallaxStrip');
const strip2 = document.getElementById('parallaxStrip2');

function updateParallax() {
  if (parallaxBg && strip1) {
    const rect = strip1.getBoundingClientRect();
    const offset = (rect.top + rect.height / 2 - window.innerHeight / 2) * 0.25;
    parallaxBg.style.transform = `translateY(${offset}px)`;
  }
  if (parallaxBg2 && strip2) {
    const rect2 = strip2.getBoundingClientRect();
    const offset2 = (rect2.top + rect2.height / 2 - window.innerHeight / 2) * 0.2;
    parallaxBg2.style.transform = `translateY(${offset2}px)`;
  }
}
window.addEventListener('scroll', updateParallax);
updateParallax();

/* ─── STAT COUNTER ANIMATION ─── */
function animateCounter(el) {
  const target = parseInt(el.dataset.target, 10);
  const prefix = el.dataset.prefix || '';
  const duration = 2000;
  const start = performance.now();

  function update(now) {
    const elapsed = now - start;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 4);
    const value = Math.floor(eased * target);
    el.textContent = prefix + value.toLocaleString();
    if (progress < 1) requestAnimationFrame(update);
    else el.textContent = prefix + target.toLocaleString();
  }
  requestAnimationFrame(update);
}

const statNums = document.querySelectorAll('.stat-num[data-target]');
let statsTriggered = false;
const statsObs = new IntersectionObserver((entries) => {
  entries.forEach(e => {
    if (e.isIntersecting && !statsTriggered) {
      statsTriggered = true;
      statNums.forEach(animateCounter);
    }
  });
}, { threshold: 0.3 });
if (statNums[0]) statsObs.observe(statNums[0]);

/* ─── SCROLL REVEAL ─── */
const reveals = document.querySelectorAll(
  '.step-card, .product-card, .reward-card, .lb-row, .qr-features-list li, .pq, .flow-node, .calc-left, .calc-right'
);
reveals.forEach((el, i) => {
  el.classList.add('reveal');
  el.style.transitionDelay = `${(i % 4) * 0.1}s`;
});

const revealObs = new IntersectionObserver((entries) => {
  entries.forEach(e => {
    if (e.isIntersecting) {
      e.target.classList.add('visible');
      revealObs.unobserve(e.target);
    }
  });
}, { threshold: 0.15 });
reveals.forEach(el => revealObs.observe(el));

/* ─── PRODUCT FILTER ─── */
const filterBtns = document.querySelectorAll('.filter-btn');
const productCards = document.querySelectorAll('.product-card');

filterBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    filterBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const filter = btn.dataset.filter;

    productCards.forEach(card => {
      const match = filter === 'all' || card.dataset.category === filter;
      card.style.display = match ? '' : 'none';
      if (match) {
        card.style.animation = 'none';
        requestAnimationFrame(() => {
          card.style.animation = '';
        });
      }
    });
  });
});

/* ─── CATALOG FILTER ─── */
const catBtns = document.querySelectorAll('.cat-btn');
const catalogCards = document.querySelectorAll('#catalogGrid .product-card');

catBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    catBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const filter = btn.dataset.cat;
    catalogCards.forEach(card => {
      const match = filter === 'all' || card.dataset.type === filter;
      card.style.display = match ? '' : 'none';
    });
  });
});

/* also wire tap-to-flip for catalog cards */
document.querySelectorAll('#catalogGrid .product-card .product-img').forEach(imgArea => {
  imgArea.addEventListener('click', (e) => {
    if (e.target.closest('.btn-add-cart')) return;
    imgArea.closest('.product-card').classList.toggle('flipped');
  });
});

/* ═══════════════════════════════
   CART SYSTEM
═══════════════════════════════ */
const CART_KEY = 'thread_cart';

function getCart() {
  return JSON.parse(localStorage.getItem(CART_KEY) || '{"items":[],"promoCode":null,"discount":0}');
}
function saveCart(cart) {
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
}

const HOODIE_COLORS_INDEX = {
  'Phantom Black': { body:'#1c1c1c', hood:'#111',    cord:'#555',    bg:'#0a0a0a' },
  'Midnight Navy': { body:'#0d1b35', hood:'#091428', cord:'#4a7dc4', bg:'#060e1a' },
  'Ember Crimson': { body:'#4a1010', hood:'#3a0a0a', cord:'#8b3030', bg:'#100303' },
  'Forest Shadow': { body:'#1a3a1e', hood:'#122814', cord:'#4a7850', bg:'#050d06' },
  'Ash Stone':     { body:'#4a4a4a', hood:'#3a3a3a', cord:'#999',    bg:'#2a2a2a' },
  'Ivory Pure':    { body:'#f4f1ea', hood:'#e8e3d6', cord:'#cfc8b8', bg:'#f0ece2' },
  'Bone':          { body:'#d9cfc0', hood:'#cec4b4', cord:'#b0a898', bg:'#e8e2d8' },
  'Tawny Dusk':    { body:'#7a5030', hood:'#5e3c22', cord:'#a07050', bg:'#3a2010' },
  'Silver Mist':   { body:'#b0b4b8', hood:'#9ca0a4', cord:'#787c80', bg:'#d0d4d8' },
};

// Map THREAD product names → image file slugs (in images/ folder)
const HOODIE_PHOTO_SLUG = {
  'Phantom Black': 'phantom-black',
  'Midnight Navy': 'midnight-navy',
  'Ember Crimson': 'ember-crimson',
  'Forest Shadow': 'forest-shadow',
  'Ash Stone':     'ash-stone',
  'Ivory Pure':    'ivory-pure',
  'Silver Mist':   'silver-mist',
  'Bone':          'bone',
  'Tawny Dusk':    'tawny-dusk',
};
const TEE_PHOTO_SLUG = {
  'Clean White': 'clean-white',
  'Raw Stone':   'raw-stone',
  'Jet Black':   'jet-black',
  'Slate Grey':  'slate-grey',
  'Deep Navy':   'deep-navy',
};

// Silently preload all product images so cart/checkout never waits on a first fetch
(function preloadProductImages() {
  const hoodieSlugs = Object.values(HOODIE_PHOTO_SLUG);
  const teeSlugs    = Object.values(TEE_PHOTO_SLUG);
  const ver = { hoodie: 'hoodie-20260517', tee: 'tee-20260517' };
  const srcs = [
    ...hoodieSlugs.map(s => `hoodie-variants/${s}-front.png?v=${ver.hoodie}`),
    ...teeSlugs.map(s    => `images/tee-${s}-front.webp?v=${ver.tee}`),
  ];
  srcs.forEach(src => { const img = new Image(); img.src = src; });
})();

function productThumb(item) {
  const rawName  = item.name || item;
  const isHoodie = (item.type || 'hoodie') !== 'tee';
  // Strip type suffix from name in case it was stored as "Raw Stone Tee" or "Phantom Black Hoodie"
  const name = rawName.replace(/\s+(Tee|Hoodie)$/i, '').trim();
  const slug = isHoodie
    ? (HOODIE_PHOTO_SLUG[name] || 'phantom-black')
    : (TEE_PHOTO_SLUG[name] || name.toLowerCase().replace(/\s+/g,'-'));
  const ver = isHoodie ? 'hoodie-20260517' : 'tee-20260517';
  const src = isHoodie
    ? `hoodie-variants/${slug}-front.png?v=${ver}`
    : `images/tee-${slug}-front.webp?v=${ver}`;
  return `<img src="${src}" alt="${name}" style="width:100%;height:100%;object-fit:cover;object-position:center top;background:#0a0a0a;border-radius:8px">`;
}

// Backward-compat aliases
function hoodieThumb(name) { return productThumb({name, type:'hoodie'}); }

// Kept for backward compatibility — same call signature, real photo now
function miniHoodieSVG(name) { return hoodieThumb(name); }

function calcShipping(cart) {
  const totalItems = (cart.items || []).reduce((s, i) => s + (i.qty || 1), 0);
  return totalItems >= 2 ? 0 : 10;
}

function cartTotal(cart) {
  const sub      = cart.items.reduce((s, i) => s + i.price * i.qty, 0);
  const disc     = cart.discount || 0;
  const shipping = calcShipping(cart);
  const total    = Math.max(0, sub - disc) + shipping;
  return { subtotal: sub, discount: disc, shipping, total };
}

function renderCartDrawer() {
  const cart = getCart();
  const itemsEl  = document.getElementById('cdItems');
  const footerEl = document.getElementById('cdFooter');
  const countEl  = document.getElementById('cdCount');
  const navCount = document.getElementById('cartCount');

  const totalQty = cart.items.reduce((s, i) => s + i.qty, 0);
  if (countEl) countEl.textContent = totalQty ? `(${totalQty})` : '';
  if (navCount) {
    navCount.textContent = totalQty;
    navCount.style.display = totalQty ? 'flex' : 'none';
  }

  if (!itemsEl) return;

  if (!cart.items.length) {
    itemsEl.innerHTML = `<div class="cd-empty"><span>🛍️</span><p>Your cart is empty</p><p style="font-size:12px;color:#555">Add a hoodie to get started</p></div>`;
    if (footerEl) footerEl.style.display = 'none';
    return;
  }

  if (footerEl) footerEl.style.display = 'block';

  const CART_SIZES = ['S','M','L','XL','2XL','3XL'];
  itemsEl.innerHTML = cart.items.map((item, idx) => {
    const isHoodie = (item.type || 'hoodie') !== 'tee';
    const typeLabel = isHoodie ? 'Oversized Heavyweight' : 'Oversized Tee';
    const currentSize = item.size || 'M';
    const sizePills = CART_SIZES.map(s => {
      const active = s === currentSize;
      return `<button onclick="changeCartSize(${idx},'${s}')"
        style="padding:3px 9px;margin:2px 2px 2px 0;font-size:11px;font-weight:600;
               border-radius:6px;cursor:pointer;font-family:Space Grotesk,sans-serif;
               border:1px solid ${active ? '#7c3aed' : 'rgba(255,255,255,0.12)'};
               background:${active ? 'rgba(124,58,237,0.18)' : 'transparent'};
               color:${active ? '#a78bfa' : '#666'}">${s}</button>`;
    }).join('');
    return `
    <div class="cd-item">
      <div class="cd-item-img">${productThumb(item)}</div>
      <div class="cd-item-info">
        <div class="cd-item-name">${item.name}</div>
        <div class="cd-item-type">${typeLabel}</div>
        <div style="margin-top:5px;line-height:1">${sizePills}</div>
        <div class="cd-item-price" style="margin-top:4px">$${item.price}</div>
      </div>
      <div class="cd-item-controls">
        <button class="cd-qty-btn" onclick="updateCartQty(${idx}, -1)">−</button>
        <span class="cd-qty">${item.qty}</span>
        <button class="cd-qty-btn" onclick="updateCartQty(${idx}, 1)">+</button>
        <button class="cd-remove" onclick="removeCartItem(${idx})" title="Remove">✕</button>
      </div>
    </div>`;
  }).join('');

  const { subtotal, discount, shipping, total } = cartTotal(cart);
  const subEl    = document.getElementById('cdSubtotal');
  const totEl    = document.getElementById('cdTotal');
  const discRow  = document.getElementById('cdDiscountRow');
  const discEl   = document.getElementById('cdDiscount');
  const shipEl   = document.getElementById('cdShipping');
  const nudgeEl  = document.getElementById('cdShippingNudge');

  if (subEl) subEl.textContent = '$' + subtotal.toFixed(2);
  if (totEl) totEl.textContent = '$' + total.toFixed(2);
  if (discRow) discRow.style.display = discount ? 'flex' : 'none';
  if (discEl && discount) discEl.textContent = '−$' + discount.toFixed(2);

  // Shipping row + free-shipping nudge (cart only)
  const totalItems = cart.items.reduce((s, i) => s + (i.qty || 1), 0);
  if (shipEl) {
    shipEl.textContent = shipping === 0 ? 'FREE' : '$' + shipping.toFixed(2);
    shipEl.className   = shipping === 0 ? 'cd-free' : '';
  }
  if (nudgeEl) nudgeEl.style.display = (totalItems === 1) ? 'block' : 'none';

  // write to checkout storage
  localStorage.setItem('thread_checkout', JSON.stringify({ items: cart.items, subtotal, discount, shipping, total, promoCode: cart.promoCode || null, ref: localStorage.getItem('thread_ref') }));
}

function addToCart(name, price, size = 'M', type = 'hoodie') {
  const cart = getCart();
  // Same product + same size = stack qty; different size = new line
  const existing = cart.items.find(i => i.name === name && i.size === size);
  if (existing) { existing.qty++; }
  else { cart.items.push({ name, price: parseFloat(price), qty: 1, size, type }); }
  saveCart(cart);
  renderCartDrawer();
  openCart();
  // Track add-to-cart as its own event type (non-deduped — each add counts).
  // Prefix with uid:ID| when the user is logged in so the admin panel can
  // link cart activity back to specific customer accounts.
  const _cartSession = JSON.parse(localStorage.getItem('thread_session') || 'null');
  const _cartLabel   = _cartSession?.id
    ? `uid:${_cartSession.id}|${name} (${size})`
    : `${name} (${size})`;
  window._threadTrackRaw?.('add_to_cart', _cartLabel);

  // Also stamp last_cart_at directly on the profile row so the admin
  // Customers tab shows cart activity instantly without needing analytics sync.
  if (_cartSession?.id) {
    try {
      const _cfg = window.THREAD_CONFIG;
      if (_cfg?.supabaseUrl && window.supabase) {
        const _sb = window.supabase.createClient(_cfg.supabaseUrl, _cfg.supabaseAnonKey);
        _sb.from('profiles')
          .update({ last_cart_at: new Date().toISOString() })
          .eq('id', _cartSession.id)
          .then(() => {});
      }
    } catch(_) {}
  }
}

function updateCartQty(idx, delta) {
  const cart = getCart();
  cart.items[idx].qty = Math.max(1, cart.items[idx].qty + delta);
  saveCart(cart); renderCartDrawer();
}

function removeCartItem(idx) {
  const cart = getCart();
  cart.items.splice(idx, 1);
  saveCart(cart); renderCartDrawer();
}

function changeCartSize(idx, newSize) {
  const cart = getCart();
  if (!cart.items[idx]) return;
  const item = cart.items[idx];
  if (item.size === newSize) return; // nothing to change
  // If another line with same product + new size exists, merge quantities
  const mergeIdx = cart.items.findIndex((it, i) => i !== idx && it.name === item.name && it.size === newSize);
  if (mergeIdx >= 0) {
    cart.items[mergeIdx].qty += item.qty;
    cart.items.splice(idx, 1);
  } else {
    cart.items[idx].size = newSize;
  }
  saveCart(cart); renderCartDrawer();
}

async function applyPromo() {
  const input = document.getElementById('promoInput');
  const code  = input?.value.trim().toUpperCase();
  if (!code) return;
  const cart = getCart();

  if (code === 'BOGOEGG') {
    // Easter egg — buy a hoodie, get a tee 50% off
    const hasTee    = cart.items.some(i => (i.type || 'hoodie') === 'tee');
    const hasHoodie = cart.items.some(i => (i.type || 'hoodie') !== 'tee');
    if (!hasTee || !hasHoodie) {
      showStoreToast('Add a hoodie + tee to use BOGOEGG', 'error'); return;
    }
    const teeItem  = cart.items.find(i => (i.type || 'hoodie') === 'tee');
    const discount = parseFloat((teeItem.price * 0.5).toFixed(2));
    cart.promoCode = code;
    cart.discount  = discount;
    saveCart(cart); renderCartDrawer();
    showStoreToast(`🥚 BOGOEGG applied — tee is 50% off!`);
    return;
  }

  /* ── BACK20 recovery codes — validate against Supabase ── */
  if (code.startsWith('BACK20')) {
    const cfg = window.THREAD_CONFIG;
    if (!cfg?.supabaseUrl || !window.supabase) {
      showStoreToast('Invalid promo code', 'error'); return;
    }
    const applyBtn = document.getElementById('promoApplyBtn') || document.querySelector('[onclick*="applyPromo"]');
    if (applyBtn) { applyBtn.disabled = true; applyBtn.textContent = 'Checking…'; }
    try {
      const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
      const { data: pct, error } = await sb.rpc('validate_user_promo_code', { p_code: code });
      if (error || pct == null) {
        showStoreToast('Invalid or already used promo code', 'error');
        return;
      }
      const subtotal = cart.items.reduce((s, i) => s + i.price * (i.qty || 1), 0);
      const discount = parseFloat((subtotal * (pct / 100)).toFixed(2));
      cart.promoCode = code;
      cart.discount  = discount;
      saveCart(cart); renderCartDrawer();
      showStoreToast(`${pct}% off applied! 🎉`);
    } catch (e) {
      showStoreToast('Could not validate code — try again', 'error');
    } finally {
      if (applyBtn) { applyBtn.disabled = false; applyBtn.textContent = 'Apply'; }
    }
    return;
  }

  /* ── General promo codes (THREAD20, etc.) — validate against Supabase ── */
  const _gpCfg = window.THREAD_CONFIG;
  if (_gpCfg?.supabaseUrl && window.supabase) {
    const applyBtn = document.getElementById('promoApplyBtn') || document.querySelector('[onclick*="applyPromo"]');
    if (applyBtn) { applyBtn.disabled = true; applyBtn.textContent = 'Checking…'; }
    try {
      const sb = window.supabase.createClient(_gpCfg.supabaseUrl, _gpCfg.supabaseAnonKey);
      let userEmail = null;
      try { const { data } = await sb.auth.getUser(); userEmail = data?.user?.email || null; } catch(_) {}
      if (!userEmail) { try { userEmail = JSON.parse(localStorage.getItem('thread_session') || 'null')?.email || null; } catch(_) {} }
      const { data: pct, error } = await sb.rpc('validate_general_promo', { p_code: code, p_email: userEmail });
      if (!error && pct != null) {
        const subtotal = cart.items.reduce((s, i) => s + i.price * (i.qty || 1), 0);
        const discount = parseFloat((subtotal * (pct / 100)).toFixed(2));
        cart.promoCode = code;
        cart.discount  = discount;
        saveCart(cart); renderCartDrawer();
        showStoreToast(`${pct}% off applied! 🎉`);
        return;
      }
    } catch (e) {
      showStoreToast('Could not validate code — try again', 'error');
      return;
    } finally {
      if (applyBtn) { applyBtn.disabled = false; applyBtn.textContent = 'Apply'; }
    }
  }

  showStoreToast('Invalid promo code', 'error');
}

// iOS Safari ignores overflow:hidden on body — pin it with position:fixed instead,
// saving/restoring the scroll offset so the page doesn't jump.
let _cartScrollY = 0;

function openCart() {
  if (typeof closeMobileMenu === 'function') closeMobileMenu();
  _cartScrollY = window.scrollY;
  document.body.style.top = `-${_cartScrollY}px`;
  document.body.classList.add('cart-open');
  document.getElementById('cartDrawer')?.classList.add('open');
  document.getElementById('cartOverlay')?.classList.add('open');
}
function closeCart() {
  document.getElementById('cartDrawer')?.classList.remove('open');
  document.getElementById('cartOverlay')?.classList.remove('open');
  document.body.classList.remove('cart-open');
  document.body.style.top = '';
  window.scrollTo(0, _cartScrollY);
}
function toggleCart() {
  const drawer = document.getElementById('cartDrawer');
  if (!drawer) return;
  if (typeof closeMobileMenu === 'function') closeMobileMenu();
  if (drawer.classList.contains('open')) { closeCart(); } else { openCart(); }
}
// Esc closes cart
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeCart();
});

/* ─── ADD TO CART (product buttons → opens size picker) ─── */
const cartToast = document.getElementById('cartToast');
let toastTimer = null;

document.querySelectorAll('.btn-add-cart').forEach(btn => {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const card = btn.closest('.product-card');
    const name  = btn.dataset.product || card?.querySelector('h3')?.textContent || 'Item';
    const price = btn.dataset.price   || '89';
    const type  = btn.dataset.type    || 'hoodie';
    openSizeModal(name, price, type);
  });
});

/* ─── Tap the photo (mobile) to toggle front/back ─── */
document.querySelectorAll('.product-card .product-img').forEach(imgArea => {
  imgArea.addEventListener('click', (e) => {
    if (e.target.closest('.btn-add-cart')) return;        // don't intercept button clicks
    const card = imgArea.closest('.product-card');
    if (!card) return;
    card.classList.toggle('flipped');
  });
});

/* ─── SIZE PICKER MODAL ─── */
let _pendingProduct = null;
function openSizeModal(name, price, type = 'hoodie') {
  _pendingProduct = { name, price, type };
  const productEl  = document.getElementById('sizeModalProduct');
  const overlay    = document.getElementById('sizeModalOverlay');
  const modal      = document.getElementById('sizeModal');
  const confirmBtn = document.getElementById('sizeModalConfirm');
  if (productEl) productEl.textContent = name + ' Hoodie';
  document.querySelectorAll('.size-pill').forEach(p => p.classList.remove('selected'));
  if (confirmBtn) confirmBtn.disabled = true;
  overlay?.classList.add('open');
  modal?.classList.add('open');
}
function closeSizeModal() {
  document.getElementById('sizeModalOverlay')?.classList.remove('open');
  document.getElementById('sizeModal')?.classList.remove('open');
  _pendingProduct = null;
}
document.querySelectorAll('.size-pill').forEach(pill => {
  pill.addEventListener('click', () => {
    document.querySelectorAll('.size-pill').forEach(p => p.classList.remove('selected'));
    pill.classList.add('selected');
    const btn = document.getElementById('sizeModalConfirm');
    if (btn) btn.disabled = false;
  });
});
document.getElementById('sizeModalConfirm')?.addEventListener('click', () => {
  const selected = document.querySelector('.size-pill.selected');
  if (!selected || !_pendingProduct) return;
  const size = selected.dataset.size;
  addToCart(_pendingProduct.name, _pendingProduct.price, size, _pendingProduct.type || 'hoodie');
  const productName = _pendingProduct.name;
  closeSizeModal();

  // Toast
  if (cartToast) {
    cartToast.innerHTML = `<span>✓</span> ${productName} (${size}) added!`;
    cartToast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => cartToast.classList.remove('show'), 2200);
  }
});
// ESC closes the modal
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeSizeModal();
});

function showStoreToast(msg, type = '') {
  cartToast.textContent = msg;
  cartToast.className = 'cart-toast show' + (type ? ' ' + type : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => cartToast.classList.remove('show'), 2500);
}

renderCartDrawer(); // init badge on page load

/* ─── EARNINGS CALCULATOR ─── */
const scanSlider = document.getElementById('scanSlider');
const scanDisplay = document.getElementById('scanDisplay');
const calcAmount = document.getElementById('calcAmount');
const calcDetail = document.getElementById('calcDetail');

function updateCalc() {
  const scans = parseInt(scanSlider.value, 10);
  scanDisplay.textContent = scans;

  const weeklyConversions  = scans * 0.18;
  const monthlyConversions = weeklyConversions * 4.33;

  // Avg order value: mix of hoodies ($89) and tees ($65)
  const avgOrder = 80;

  // Tier based on estimated monthly sales volume:
  // Starter 0-10 → 20%, Hustler 11-25 → 25%, Elite 26+ → 30%
  let pct, tierLabel;
  if (monthlyConversions <= 10) {
    pct = 0.20; tierLabel = '20%';
  } else if (monthlyConversions <= 25) {
    pct = 0.25; tierLabel = '25%';
  } else {
    pct = 0.30; tierLabel = '30%';
  }

  const monthly = monthlyConversions * avgOrder * pct;
  const rounded = Math.round(monthly / 5) * 5;

  calcAmount.textContent = '$' + rounded.toLocaleString();
  calcDetail.textContent = `~${monthlyConversions.toFixed(1)} purchases · ${scans} scans/wk`;

  const tierPctEl = document.getElementById('calcTierPct');
  if (tierPctEl) tierPctEl.textContent = tierLabel;
}

if (scanSlider) {
  scanSlider.addEventListener('input', updateCalc);
  updateCalc();
}

/* ─── TICKER DUPLICATE (infinite scroll) ─── */
const tickerTrack = document.getElementById('tickerTrack');
if (tickerTrack) {
  const clone = tickerTrack.cloneNode(true);
  tickerTrack.parentElement.appendChild(clone);
}

/* ─── SMOOTH ANCHOR SCROLL ─── */
document.querySelectorAll('a[href^="#"]').forEach(link => {
  link.addEventListener('click', (e) => {
    const target = document.querySelector(link.getAttribute('href'));
    if (target) {
      e.preventDefault();
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
});

/* ─── HAMBURGER MENU ─── */
const hamburger = document.getElementById('hamburger');
const navLinks = document.querySelector('.nav-links');

function closeMobileMenu() {
  if (navLinks) navLinks.classList.remove('open');
  if (hamburger) hamburger.classList.remove('open');
  document.body.classList.remove('menu-open');
}
function openMobileMenu() {
  // Close cart first if open — only one panel at a time
  if (typeof closeCart === 'function') closeCart();
  if (navLinks) navLinks.classList.add('open');
  if (hamburger) hamburger.classList.add('open');
}

// Tap anywhere outside the menu closes it
document.addEventListener('click', e => {
  if (!navLinks?.classList.contains('open')) return;
  if (e.target.closest('.nav-links') || e.target.closest('.hamburger')) return;
  closeMobileMenu();
});

if (hamburger && navLinks) {
  hamburger.addEventListener('click', () => {
    if (navLinks.classList.contains('open')) closeMobileMenu();
    else openMobileMenu();
  });
  // Close when tapping any nav link
  navLinks.querySelectorAll('a').forEach(a => {
    a.addEventListener('click', closeMobileMenu);
  });
}
// Esc closes the menu
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeMobileMenu();
});

/* ─── FLOATING REWARDS MOUSE PARALLAX ─── */
const floatingRewards = document.querySelectorAll('.floating-reward');
document.addEventListener('mousemove', (e) => {
  const cx = window.innerWidth / 2;
  const cy = window.innerHeight / 2;
  const dx = (e.clientX - cx) / cx;
  const dy = (e.clientY - cy) / cy;

  floatingRewards.forEach((el, i) => {
    const factor = (i + 1) * 8;
    el.style.transform = `translate(${dx * factor}px, ${dy * factor}px)`;
  });
});

/* ─── REWARD CARD HOVER SOUND EFFECT (visual) ─── */
document.querySelectorAll('.reward-card').forEach(card => {
  card.addEventListener('mouseenter', () => {
    card.style.transform = 'translateY(-6px) scale(1.02)';
  });
  card.addEventListener('mouseleave', () => {
    card.style.transform = '';
  });
});

/* ─── LEADERBOARD "START NOW" CLICK ─── */
document.querySelector('.lb-you')?.addEventListener('click', () => {
  document.getElementById('shop')?.scrollIntoView({ behavior: 'smooth' });
});

/* ─── SECTION ENTRY ANIMATIONS ─── */
const sectionTitles = document.querySelectorAll('.section-title, .section-tag, .section-sub');
sectionTitles.forEach(el => el.classList.add('reveal'));
const titleObs = new IntersectionObserver(entries => {
  entries.forEach(e => {
    if (e.isIntersecting) {
      e.target.classList.add('visible');
      titleObs.unobserve(e.target);
    }
  });
}, { threshold: 0.2 });
sectionTitles.forEach(el => titleObs.observe(el));

/* ─── PARALLAX HERO TILT ON SCROLL ─── */
const heroVisual = document.querySelector('.hero-visual');
if (heroVisual) {
  window.addEventListener('scroll', () => {
    const progress = window.scrollY / window.innerHeight;
    heroVisual.style.opacity = 1 - progress * 1.2;
    heroVisual.style.transform = `translateY(${window.scrollY * 0.2}px)`;
  });
}

/* ─── QR DEMO SCAN ANIMATION ─── */
const qrDemo = document.getElementById('qrDemo');
if (qrDemo) {
  const scanLine = document.createElement('div');
  scanLine.style.cssText = `
    position:absolute;
    left:0;right:0;
    height:2px;
    background:linear-gradient(90deg,transparent,rgba(108,99,255,0.8),transparent);
    animation:scanAnim 2.5s ease-in-out infinite;
    border-radius:1px;
  `;
  const style = document.createElement('style');
  style.textContent = `
    @keyframes scanAnim {
      0% { top: 10%; opacity: 0; }
      10% { opacity: 1; }
      90% { opacity: 1; }
      100% { top: 90%; opacity: 0; }
    }
  `;
  document.head.appendChild(style);
  qrDemo.appendChild(scanLine);
}

/* ─── SCROLL PROGRESS INDICATOR ─── */
const progressBar = document.createElement('div');
progressBar.style.cssText = `
  position:fixed;top:0;left:0;height:2px;
  background:linear-gradient(90deg,#6C63FF,#a78bfa,#ec4899);
  z-index:9999;transition:width 0.1s;
  width:0%;
`;
document.body.prepend(progressBar);
window.addEventListener('scroll', () => {
  const total = document.documentElement.scrollHeight - window.innerHeight;
  progressBar.style.width = (window.scrollY / total * 100) + '%';
});

