'use strict';

/* ─── Load checkout data ──────────────────────────────────────────────────── */
const checkoutData = JSON.parse(localStorage.getItem('thread_checkout') || 'null');
const refCode      = localStorage.getItem('thread_ref') || null;

const urlParams = new URLSearchParams(window.location.search);
const isStripeReturn = urlParams.get('stripe_success') === '1';

// Handle Stripe return first
if (isStripeReturn) {
  handleStripeReturn();
}

// Redirect to store if cart is empty (but NOT when returning from Stripe)
if (!isStripeReturn && (!checkoutData || !checkoutData.items?.length)) {
  window.location.href = 'index.html';
}

// Require login — redirect to sign in if not logged in
if (!isStripeReturn) {
  const cfg = window.THREAD_CONFIG;
  const ref = cfg?.supabaseUrl?.replace('https://', '').split('.')[0] || '';
  const hasSupabaseSession = ref && localStorage.getItem('sb-' + ref + '-auth-token');
  const hasLocalSession    = localStorage.getItem('thread_session');
  if (!hasSupabaseSession && !hasLocalSession) {
    window.location.href = 'auth.html?tab=signin&next=checkout.html';
  }
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

/* ─── Simple checkout handler ─────────────────────────────────────────────── */
async function handleCheckout(e) {
  e.preventDefault();
  const email = document.getElementById('cardEmail').value.trim();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    showError('Please enter a valid email for your receipt.');
    return;
  }
  await launchStripeCheckout(email);
}

/* ─── Launch Stripe Checkout ──────────────────────────────────────────────── */
async function launchStripeCheckout(email) {
  const btn  = document.getElementById('btnPayNow');
  const txt  = document.getElementById('payBtnText');
  const spin = document.getElementById('paySpinner');
  btn.disabled = true; txt.style.display = 'none'; spin.style.display = 'block';

  // Save email for use after Stripe returns
  localStorage.setItem('thread_checkout_email', email);

  try {
    const orderId = genOrderId();
    const base = window.location.origin + window.location.pathname.replace(/\/[^/]*$/, '');
    const res  = await fetch(window.THREAD_CONFIG.stripeFunctionUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        items:        checkoutData.items,
        total:        checkoutData.total,
        orderId:      orderId,
        referralCode: refCode || '',
        promoCode:    checkoutData.promoCode || '',
        successUrl:   base + '/checkout.html',
        cancelUrl:    base + '/checkout.html'
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
  const email   = localStorage.getItem('thread_checkout_email') || '';
  localStorage.removeItem('thread_checkout_email');
  await finalizeOrder(orderId, email);
}

/* ─── Finalize order (save to DB, credit referrer, show confirmation) ────── */
async function finalizeOrder(orderId, customerEmail = '') {
  if (!checkoutData) return;

  // Save order to database
  try {
    await window.DB.orders.create({
      id:             orderId,
      items:          checkoutData.items,
      subtotal:       checkoutData.subtotal,
      discount:       checkoutData.discount || 0,
      total:          checkoutData.total,
      promo_code:     checkoutData.promoCode || null,
      referral_code:  refCode || null,
      customer_email: customerEmail,
      status:         'paid'
    });
  } catch(e) {
    console.warn('Order save error:', e);
  }

  // Credit referrer commission (10%)
  let refResult = null;
  if (refCode) {
    try {
      const commission = parseFloat((checkoutData.total * 0.10).toFixed(2));
      await window.DB.referrals.markConverted(refCode, orderId, commission);
      const referrer = await window.DB.profiles.getByReferralCode(refCode);
      if (referrer) refResult = { name: referrer.name, commission };
    } catch(e) { console.warn('Referral error:', e); }
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

  try {
    const user = await window.DB.auth.getUser();
    if (user) document.getElementById('successDashLink').style.display = 'block';
  } catch(e) {}
}

function showError(msg) {
  const el = document.getElementById('cfError');
  el.textContent = msg;
  el.style.display = 'block';
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
