/* ─── AUTH STATE ─── */
(function () {
  const id = localStorage.getItem('thread_session');
  const users = JSON.parse(localStorage.getItem('thread_users') || '[]');
  const user = id ? users.find(u => u.id === id) : null;
  const actions = document.getElementById('navActions');
  if (actions && user) {
    actions.innerHTML = `
      <a href="dashboard.html" class="nav-user-pill">
        <div class="nav-user-avatar">${user.avatar}</div>
        ${user.name.split(' ')[0]}'s Dashboard
      </a>`;
  }
})();

/* ─── REFERRAL TRACKING ─── */
(function () {
  const ref = new URLSearchParams(window.location.search).get('ref');
  if (!ref) return;
  localStorage.setItem('thread_ref', ref);

  // Find referrer name for banner
  const users = JSON.parse(localStorage.getItem('thread_users') || '[]');
  const referrer = users.find(u => u.referralCode === ref);
  const banner = document.createElement('div');
  banner.className = 'ref-banner';
  banner.innerHTML = referrer
    ? `👕 You were referred by <span>${referrer.name.split(' ')[0]}</span> — they earn when you buy!`
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

/* ─── QR CODE GENERATOR (decorative) ─── */
function generateQR(containerId, size) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const seed = Math.random();
  const pattern = [
    // Top-left finder
    [0,0],[0,1],[0,2],[0,3],[0,4],[0,5],[0,6],
    [1,0],[1,6],[2,0],[2,2],[2,3],[2,4],[2,6],
    [3,0],[3,2],[3,3],[3,4],[3,6],[4,0],[4,2],
    [4,3],[4,4],[4,6],[5,0],[5,6],[6,0],[6,1],
    [6,2],[6,3],[6,4],[6,5],[6,6],
  ];

  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const cell = document.createElement('div');
      cell.classList.add('qr-cell');
      const inPattern = pattern.some(([pr, pc]) => pr === r && pc === c);
      const filled = inPattern || (Math.random() > 0.5 && !(r < 8 && c < 8));
      if (filled) cell.classList.add('filled');
      container.appendChild(cell);
    }
  }
}

generateQR('qrGrid', 7);
generateQR('qrDemoGrid', 9);

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
  'Phantom Black': { body:'#1c1c1c', hood:'#111', cord:'#555', bg:'#0a0a0a' },
  'Midnight Navy': { body:'#0d1b35', hood:'#091428', cord:'#4a7dc4', bg:'#060e1a' },
  'Ember Crimson': { body:'#2a0a0a', hood:'#1a0505', cord:'#8b3030', bg:'#100303' },
  'Forest Shadow': { body:'#0b1a0d', hood:'#081208', cord:'#4a7850', bg:'#050d06' },
  'Ash Stone':     { body:'#3a3a3a', hood:'#2a2a2a', cord:'#888',    bg:'#1e1e1e' },
  'Void Purple':   { body:'#1a0d2e', hood:'#130924', cord:'#7c4dbb', bg:'#0a0415' },
};

function miniHoodieSVG(name) {
  const c = HOODIE_COLORS_INDEX[name] || HOODIE_COLORS_INDEX['Phantom Black'];
  return `<svg viewBox="0 0 300 340" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%;background:${c.bg}">
    <path d="M73,82 L12,112 L6,208 L50,214 L60,128 Z" fill="${c.body}"/>
    <path d="M227,82 L288,112 L294,208 L250,214 L240,128 Z" fill="${c.body}"/>
    <path d="M60,128 L53,308 L247,308 L240,128 L227,82 Q200,70 150,65 Q100,70 73,82 Z" fill="${c.body}"/>
    <path d="M73,82 Q68,12 113,7 Q128,38 150,65 Q100,70 73,82 Z" fill="${c.hood}"/>
    <path d="M227,82 Q232,12 187,7 Q172,38 150,65 Q200,70 227,82 Z" fill="${c.hood}"/>
    <path d="M113,7 Q150,1 187,7 Q170,48 150,65 Q130,48 113,7 Z" fill="${c.hood}" opacity="0.7"/>
    <path d="M132,63 C128,85 123,105 117,124" stroke="${c.cord}" stroke-width="3" fill="none" stroke-linecap="round"/>
    <path d="M168,63 C172,85 177,105 183,124" stroke="${c.cord}" stroke-width="3" fill="none" stroke-linecap="round"/>
    <ellipse cx="117" cy="127" rx="5" ry="6" fill="${c.cord}"/>
    <ellipse cx="183" cy="127" rx="5" ry="6" fill="${c.cord}"/>
  </svg>`;
}

function cartTotal(cart) {
  const sub = cart.items.reduce((s, i) => s + i.price * i.qty, 0);
  const disc = cart.discount || 0;
  return { subtotal: sub, discount: disc, total: Math.max(0, sub - disc) };
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

  itemsEl.innerHTML = cart.items.map((item, idx) => `
    <div class="cd-item">
      <div class="cd-item-img">${miniHoodieSVG(item.name)}</div>
      <div class="cd-item-info">
        <div class="cd-item-name">${item.name}</div>
        <div class="cd-item-size">Size: ${item.size || 'M'}</div>
        <div class="cd-item-price">$${item.price}</div>
        <div class="cd-item-earn">Earns referrer $${Math.round(item.price * 0.22)}</div>
      </div>
      <div class="cd-item-controls">
        <button class="cd-qty-btn" onclick="updateCartQty(${idx}, -1)">−</button>
        <span class="cd-qty">${item.qty}</span>
        <button class="cd-qty-btn" onclick="updateCartQty(${idx}, 1)">+</button>
        <button class="cd-remove" onclick="removeCartItem(${idx})" title="Remove">✕</button>
      </div>
    </div>`).join('');

  const { subtotal, discount, total } = cartTotal(cart);
  const subEl  = document.getElementById('cdSubtotal');
  const totEl  = document.getElementById('cdTotal');
  const discRow= document.getElementById('cdDiscountRow');
  const discEl = document.getElementById('cdDiscount');
  if (subEl) subEl.textContent = '$' + subtotal.toFixed(2);
  if (totEl) totEl.textContent = '$' + total.toFixed(2);
  if (discRow) discRow.style.display = discount ? 'flex' : 'none';
  if (discEl && discount) discEl.textContent = '−$' + discount.toFixed(2);

  // write to checkout storage
  localStorage.setItem('thread_checkout', JSON.stringify({ items: cart.items, subtotal, discount, total, ref: localStorage.getItem('thread_ref') }));
}

function addToCart(name, price, size = 'M') {
  const cart = getCart();
  // Same product + same size = stack qty; different size = new line
  const existing = cart.items.find(i => i.name === name && i.size === size);
  if (existing) { existing.qty++; }
  else { cart.items.push({ name, price: parseFloat(price), qty: 1, size }); }
  saveCart(cart);
  renderCartDrawer();
  openCart();
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

function applyPromo() {
  const code = document.getElementById('promoInput')?.value.trim().toUpperCase();
  const promos = { 'THREAD10': 10, 'WEAR20': 20, 'FIRST15': 15, 'SCAN25': 25 };
  const cart = getCart();
  if (promos[code]) {
    cart.promoCode = code;
    cart.discount  = promos[code];
    saveCart(cart); renderCartDrawer();
    showStoreToast(`✓ Promo "${code}" applied — $${promos[code]} off!`);
  } else {
    showStoreToast('Invalid promo code', 'error');
  }
}

function toggleCart() {
  const drawer  = document.getElementById('cartDrawer');
  const overlay = document.getElementById('cartOverlay');
  drawer?.classList.toggle('open');
  overlay?.classList.toggle('open');
}
function openCart() {
  document.getElementById('cartDrawer')?.classList.add('open');
  document.getElementById('cartOverlay')?.classList.add('open');
}

/* ─── ADD TO CART (product buttons → opens size picker) ─── */
const cartToast = document.getElementById('cartToast');
let toastTimer = null;

document.querySelectorAll('.btn-add-cart').forEach(btn => {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const card = btn.closest('.product-card');
    const name  = btn.dataset.product || card?.querySelector('h3')?.textContent || 'Item';
    const price = btn.dataset.price   || '89';
    openSizeModal(name, price);
  });
});

/* ─── SIZE PICKER MODAL ─── */
let _pendingProduct = null;
function openSizeModal(name, price) {
  _pendingProduct = { name, price };
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
  addToCart(_pendingProduct.name, _pendingProduct.price, size);
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
  const weeklyConversions = scans * 0.18;
  const monthlyConversions = weeklyConversions * 4.33;
  const monthly = monthlyConversions * 20;
  const rounded = Math.round(monthly / 5) * 5;
  calcAmount.textContent = '$' + rounded.toLocaleString();
  calcDetail.textContent = `~${monthlyConversions.toFixed(1)} purchases · ${scans} scans/wk`;
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
if (hamburger && navLinks) {
  hamburger.addEventListener('click', () => {
    navLinks.style.display = navLinks.style.display === 'flex' ? 'none' : 'flex';
    navLinks.style.flexDirection = 'column';
    navLinks.style.position = 'absolute';
    navLinks.style.top = '70px';
    navLinks.style.left = '0';
    navLinks.style.right = '0';
    navLinks.style.background = 'rgba(8,8,8,0.95)';
    navLinks.style.padding = '20px 24px';
    navLinks.style.borderBottom = '1px solid rgba(255,255,255,0.07)';
    navLinks.style.backdropFilter = 'blur(20px)';
  });
}

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
