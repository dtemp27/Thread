'use strict';

/* ─── Load checkout data ──────────────────────────────────────────────────── */
const checkoutData = JSON.parse(localStorage.getItem('thread_checkout') || 'null');
const refCode      = localStorage.getItem('thread_ref') || null;

// Check for Stripe success return
const urlParams = new URLSearchParams(window.location.search);
if (urlParams.get('stripe_success') === '1') {
  handleStripeReturn();
}

if (!checkoutData || !checkoutData.items?.length) {
  window.location.href = 'index.html';
}

/* ─── Hoodie color map ────────────────────────────────────────────────────── */
const HOODIE_COLORS = {
  'Phantom Black':  { bg: '#111',    body: '#1a1a1a', hood: '#0d0d0d' },
  'Midnight Navy':  { bg: '#0a1628', body: '#0d2245', hood: '#081a36' },
  'Ember Crimson':  { bg: '#1a0000', body: '#8b0000', hood: '#6d0000' },
  'Forest Shadow':  { bg: '#0a1a0a', body: '#1a3a1a', hood: '#0d2a0d' },
  'Ash Stone':      { bg: '#1a1a1a', body: '#8a8a8a', hood: '#6a6a6a' },
  'Void Purple':    { bg: '#0d0015', body: '#2d0060', hood: '#1a0040' },
};

function miniHoodieSVG(name) {
  const c = HOODIE_COLORS[name] || HOODIE_COLORS['Phantom Black'];
  return `<svg viewBox="0 0 56 56" width="56" height="56" xmlns="http://www.w3.org/2000/svg">
    <rect width="56" height="56" rx="8" fill="${c.bg}"/>
    <path d="M28 8 C24 8 20 10 18 14 L10 20 L14 24 L18 20 L18 46 L38 46 L38 20 L42 24 L46 20 L38 14 C36 10 32 8 28 8 Z" fill="${c.body}"/>
    <path d="M28 8 C24 8 20 10 18 14 L22 18 C23 13 25 11 28 11 C31 11 33 13 34 18 L38 14 C36 10 32 8 28 8 Z" fill="${c.hood}"/>
    <ellipse cx="28" cy="13" rx="4" ry="3" fill="${c.hood}"/>
  </svg>`;
}

/* ─── Render order summary ────────────────────────────────────────────────── */
function renderSummary() {
  const data = checkoutData;
  const container = document.getElementById('coItems');

  container.innerHTML = data.items.map(item => `
    <div class="co-item">
      <div class="co-item-thumb">${miniHoodieSVG(item.name)}</div>
      <div class="co-item-info">
        <div class="co-item-name">${item.name} Hoodie</div>
        <div class="co-item-meta">THREAD Classic — Size M</div>
      </div>
      <div class="co-item-right">
        <div class="co-item-price">$${(item.price * item.qty).toFixed(2)}</div>
        <div class="co-item-qty">Qty: ${item.qty}</div>
      </div>
    </div>
  `).join('');

  document.getElementById('coSubtotal').textContent    = `$${data.subtotal.toFixed(2)}`;
  document.getElementById('coTotal').textContent       = `$${data.total.toFixed(2)}`;
  document.getElementById('payBtnAmount').textContent  = `$${data.total.toFixed(2)}`;

  if (data.discount > 0) {
    document.getElementById('coDiscountRow').style.display  = '';
    document.getElementById('coDiscount').textContent       = data.discount.toFixed(2);
    document.getElementById('coPromoApplied').style.display = '';
    document.getElementById('coPromoCode').textContent      = data.promoCode || '';
    document.getElementById('coPromoSaving').textContent    = data.discount.toFixed(2);
  }

  // Referral attribution
  if (refCode) {
    DB.profiles.getByReferralCode(refCode).then(referrer => {
      if (referrer) {
        document.getElementById('coRefNotice').style.display = 'flex';
        document.getElementById('coRefName').textContent     = referrer.name;
      }
    });
  }
}

if (checkoutData) renderSummary();

/* ─── Card preview logic ──────────────────────────────────────────────────── */
const NETWORKS = {
  visa:       { pattern: /^4/,             label: 'VISA',
    svg: `<svg viewBox="0 0 60 20" width="52" height="18" xmlns="http://www.w3.org/2000/svg"><text x="0" y="16" font-family="Arial" font-weight="900" font-size="20" fill="white" font-style="italic">VISA</text></svg>` },
  mastercard: { pattern: /^5[1-5]|^2[2-7]/, label: 'MC',
    svg: `<svg viewBox="0 0 50 32" width="44" height="28" xmlns="http://www.w3.org/2000/svg"><circle cx="16" cy="16" r="14" fill="#eb001b" opacity=".9"/><circle cx="34" cy="16" r="14" fill="#f79e1b" opacity=".9"/><path d="M25 5.5 A14 14 0 0 1 25 26.5 A14 14 0 0 1 25 5.5Z" fill="#ff5f00"/></svg>` },
  amex:       { pattern: /^3[47]/,         label: 'AMEX',
    svg: `<svg viewBox="0 0 60 20" width="52" height="18" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="0" width="60" height="20" rx="3" fill="#2E77BC"/><text x="5" y="15" font-family="Arial" font-weight="900" font-size="12" fill="white">AMEX</text></svg>` },
  discover:   { pattern: /^6(?:011|5)/,    label: 'DISC',
    svg: `<svg viewBox="0 0 60 20" width="52" height="18" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="0" width="60" height="20" rx="3" fill="#e65c1c"/><text x="3" y="14" font-family="Arial" font-weight="700" font-size="10" fill="white">DISCOVER</text></svg>` },
};

function detectNetwork(num) {
  const clean = num.replace(/\s/g, '');
  for (const [key, net] of Object.entries(NETWORKS)) {
    if (net.pattern.test(clean)) return key;
  }
  return null;
}

function formatCardNumber(input) {
  let v = input.value.replace(/\D/g, '').slice(0, 16);
  input.value = (v.match(/.{1,4}/g) || []).join(' ');

  const network = detectNetwork(v);
  const padded  = v.padEnd(16, '•');
  const display = (padded.match(/.{1,4}/g) || []).join(' ');
  document.getElementById('cardNumberDisplay').textContent = display;

  const netEl  = document.getElementById('cardNetwork');
  const typeEl = document.getElementById('cfCardType');
  if (network) {
    netEl.innerHTML  = NETWORKS[network].svg;
    typeEl.textContent = NETWORKS[network].label;
    input.classList.toggle('valid',   v.length === 16);
    input.classList.toggle('invalid', v.length > 0 && v.length < 16);
  } else {
    netEl.innerHTML = ''; typeEl.textContent = '';
    input.classList.remove('valid', 'invalid');
  }
}

function updateCardName(input) {
  document.getElementById('cardHolderDisplay').textContent =
    input.value.trim().toUpperCase() || 'FULL NAME';
}

function formatExpiry(input) {
  let v = input.value.replace(/\D/g, '').slice(0, 4);
  if (v.length >= 3) v = v.slice(0, 2) + '/' + v.slice(2);
  input.value = v;
  document.getElementById('cardExpiryDisplay').textContent = v || 'MM/YY';
  const [mm, yy] = v.split('/');
  if (mm && yy && yy.length === 2) {
    const now = new Date();
    const expM = parseInt(mm), expY = 2000 + parseInt(yy);
    const ok = expM >= 1 && expM <= 12 &&
      (expY > now.getFullYear() || (expY === now.getFullYear() && expM >= now.getMonth() + 1));
    input.classList.toggle('valid', ok);
    input.classList.toggle('invalid', !ok);
  } else {
    input.classList.remove('valid', 'invalid');
  }
}

function updateCvv(input) {
  const v = input.value.replace(/\D/g, '').slice(0, 4);
  input.value = v;
  document.getElementById('cardCvvDisplay').textContent = v || '•••';
  input.classList.toggle('valid', v.length >= 3);
}

function flipCard(toBack) {
  document.getElementById('cardPreview').classList.toggle('flipped', toBack);
}

/* ─── Luhn validation ─────────────────────────────────────────────────────── */
function luhn(num) {
  return num.replace(/\s/g, '').split('').reverse().map(Number)
    .reduce((acc, d, i) => { if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; } return acc + d; }, 0) % 10 === 0;
}

/* ─── Generate order ID ───────────────────────────────────────────────────── */
function genOrderId() {
  return 'TH-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2,6).toUpperCase();
}

/* ─── Apple Pay ───────────────────────────────────────────────────────────── */
function handleApplePay() {
  if (window.ApplePaySession && ApplePaySession.canMakePayments()) {
    const req = {
      countryCode: 'US', currencyCode: 'USD',
      supportedNetworks: ['visa','masterCard','amex'],
      merchantCapabilities: ['supports3DS'],
      total: { label: 'THREAD', amount: String(checkoutData.total.toFixed(2)) }
    };
    const session = new ApplePaySession(3, req);
    session.onvalidatemerchant = () => session.completeMerchantValidation({});
    session.onpaymentauthorized = () => {
      session.completePayment(ApplePaySession.STATUS_SUCCESS);
      finalizeOrder(genOrderId());
    };
    session.begin();
  } else {
    const btn = document.getElementById('btnApplePay');
    btn.disabled = true;
    btn.textContent = 'Processing…';
    setTimeout(() => finalizeOrder(genOrderId()), 2000);
  }
}

/* ─── Google Pay ──────────────────────────────────────────────────────────── */
function handleGooglePay() {
  const btn = document.getElementById('btnGooglePay');
  btn.disabled = true;
  btn.innerHTML = '<span style="color:#3c4043;font-size:14px;font-weight:600">Processing…</span>';
  setTimeout(() => finalizeOrder(genOrderId()), 2000);
}

/* ─── Card pay ────────────────────────────────────────────────────────────── */
async function handleCardPay(e) {
  e.preventDefault();

  const num    = document.getElementById('cardNumber').value;
  const name   = document.getElementById('cardName').value.trim();
  const expiry = document.getElementById('cardExpiry').value;
  const cvv    = document.getElementById('cardCvv').value;
  const email  = document.getElementById('cardEmail').value.trim();
  const errEl  = document.getElementById('cfError');
  errEl.style.display = 'none';

  const numClean = num.replace(/\s/g, '');
  if (numClean.length < 13 || !luhn(numClean)) { showError('Please enter a valid card number.'); return; }
  if (!name)                                    { showError('Please enter the cardholder name.'); return; }
  if (!/^\d{2}\/\d{2}$/.test(expiry))          { showError('Please enter a valid expiry (MM/YY).'); return; }
  const [mm, yy] = expiry.split('/');
  const now = new Date();
  if (parseInt(mm) < 1 || parseInt(mm) > 12 ||
    (2000 + parseInt(yy)) < now.getFullYear() ||
    ((2000 + parseInt(yy)) === now.getFullYear() && parseInt(mm) < now.getMonth() + 1)) {
    showError('Your card has expired or the expiry date is invalid.'); return;
  }
  if (cvv.length < 3) { showError('Please enter a valid CVV.'); return; }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showError('Please enter a valid email for your receipt.'); return; }

  // ── Try Stripe Checkout (real payment) ──────────────────────────────────
  const cfg = window.THREAD_CONFIG;
  if (cfg?.stripeFunctionUrl && cfg.stripeFunctionUrl !== 'YOUR_EDGE_FUNCTION_URL') {
    await launchStripeCheckout(email);
    return;
  }

  // ── Demo mode fallback ───────────────────────────────────────────────────
  const btn  = document.getElementById('btnPayNow');
  const txt  = document.getElementById('payBtnText');
  const spin = document.getElementById('paySpinner');
  btn.disabled = true; txt.style.display = 'none'; spin.style.display = 'block';
  setTimeout(() => finalizeOrder(genOrderId()), 2000);
}

/* ─── Launch Stripe Checkout ──────────────────────────────────────────────── */
async function launchStripeCheckout(email) {
  const btn  = document.getElementById('btnPayNow');
  const txt  = document.getElementById('payBtnText');
  const spin = document.getElementById('paySpinner');
  btn.disabled = true; txt.style.display = 'none'; spin.style.display = 'block';

  try {
    // Pre-create order record
    const { data: order } = await DB.orders.create({
      user_id:       (await DB.auth.getUser())?.id || null,
      items:         checkoutData.items,
      subtotal:      checkoutData.subtotal,
      discount:      checkoutData.discount || 0,
      total:         checkoutData.total,
      promo_code:    checkoutData.promoCode || null,
      referral_code: refCode || null,
      customer_email: email,
      status:        'pending'
    });

    const base = window.location.origin + window.location.pathname.replace(/\/[^/]*$/, '');
    const res  = await fetch(THREAD_CONFIG.stripeFunctionUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        items:       checkoutData.items,
        total:       checkoutData.total,
        orderId:     order?.id || genOrderId(),
        referralCode: refCode || '',
        promoCode:   checkoutData.promoCode || '',
        successUrl:  base + '/checkout.html',
        cancelUrl:   base + '/checkout.html'
      })
    });

    const { url, error } = await res.json();
    if (error) throw new Error(error);
    window.location.href = url;  // Redirect to Stripe hosted checkout

  } catch (err) {
    showError('Payment setup failed: ' + err.message);
    btn.disabled = false; txt.style.display = ''; spin.style.display = 'none';
  }
}

/* ─── Handle Stripe return (success URL) ─────────────────────────────────── */
async function handleStripeReturn() {
  const orderId = urlParams.get('order_id') || genOrderId();
  await finalizeOrder(orderId, true);
}

/* ─── Finalize order (save to DB, credit referrer, show confirmation) ────── */
async function finalizeOrder(orderId, skipCreate = false) {
  if (!checkoutData) return;

  // Save order (if not already saved during Stripe redirect)
  if (!skipCreate) {
    const user = await DB.auth.getUser();
    await DB.orders.create({
      id:            orderId,
      user_id:       user?.id || null,
      items:         checkoutData.items,
      subtotal:      checkoutData.subtotal,
      discount:      checkoutData.discount || 0,
      total:         checkoutData.total,
      promo_code:    checkoutData.promoCode || null,
      referral_code: refCode || null,
      status:        'paid'
    });
  } else {
    // Update pre-created order to paid
    await DB.orders.updateStatus(orderId, 'paid');
  }

  // Credit referrer commission (10%)
  let refResult = null;
  if (refCode) {
    const commission = parseFloat((checkoutData.total * 0.10).toFixed(2));
    await DB.referrals.markConverted(refCode, orderId, commission);
    const referrer = await DB.profiles.getByReferralCode(refCode);
    if (referrer) refResult = { name: referrer.name, commission };
  }

  // Update buyer's purchase history in localStorage session
  const session = JSON.parse(localStorage.getItem('thread_session') || 'null');
  if (session) {
    if (!session.purchases) session.purchases = [];
    session.purchases.unshift({ orderId, items: checkoutData.items, total: checkoutData.total, ts: Date.now() });
    localStorage.setItem('thread_session', JSON.stringify(session));
  }

  // Clear cart
  localStorage.removeItem('thread_cart');
  localStorage.removeItem('thread_checkout');

  // Show success overlay
  showSuccess(orderId, refResult);
}

/* ─── Success overlay ─────────────────────────────────────────────────────── */
async function showSuccess(orderId, refResult) {
  document.getElementById('confirmStep').classList.add('active');
  const overlay = document.getElementById('coSuccessOverlay');
  overlay.style.display = 'flex';
  document.getElementById('successOrderId').textContent = orderId;

  if (refResult) {
    document.getElementById('successRefMsg').style.display  = 'flex';
    document.getElementById('successRefName').textContent   = refResult.name;
  }

  const user = await DB.auth.getUser();
  if (user) document.getElementById('successDashLink').style.display = 'block';
}

function showError(msg) {
  const el = document.getElementById('cfError');
  el.textContent = msg;
  el.style.display = 'block';
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
