'use strict';

/* ─── Load checkout data ──────────────────────────────────────────────────── */
let checkoutData = JSON.parse(localStorage.getItem('thread_checkout') || 'null');
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

/* ─── Product thumbnail ───────────────────────────────────────────────────── */
const PRODUCT_SLUGS = {
  'Phantom Black': 'phantom-black',
  'Midnight Navy': 'midnight-navy',
  'Ember Crimson': 'ember-crimson',
  'Forest Shadow': 'forest-shadow',
  'Ash Stone':     'ash-stone',
  'Ivory Pure':    'ivory-pure',
  'Silver Mist':   'silver-mist',
  'Bone':          'bone',
  'Tawny Dusk':    'tawny-dusk',
  'Jet Black':     'jet-black',
  'Deep Navy':     'deep-navy',
  'Slate Grey':    'slate-grey',
  'Raw Stone':     'raw-stone',
  'Clean White':   'clean-white',
};

function miniHoodieSVG(name, type) {
  const isHoodie = (type || 'hoodie') !== 'tee';
  const slug = PRODUCT_SLUGS[name] || name.toLowerCase().replace(/\s+/g, '-');
  const imgSrc = isHoodie
    ? `hoodie-variants/${slug}-front.png?v=hoodie-20260517`
    : `images/tee-${slug}-2.png?v=tee-20260517`;
  return `<img src="${imgSrc}" alt="${name}" style="width:56px;height:56px;object-fit:cover;object-position:center top;border-radius:8px;background:#111">`;
}

/* ─── Recalculate totals and save ────────────────────────────────────────── */
function recalcCheckout() {
  const subtotal = checkoutData.items.reduce((s, i) => s + i.price * i.qty, 0);
  const discount = checkoutData.discount || 0;
  const total    = Math.max(0, subtotal - discount);
  checkoutData.subtotal = subtotal;
  checkoutData.total    = total;
  // Keep thread_checkout in sync so page refresh preserves edits
  localStorage.setItem('thread_checkout', JSON.stringify(checkoutData));
  // Also keep thread_cart in sync
  try {
    const cart = JSON.parse(localStorage.getItem('thread_cart') || '{}');
    cart.items    = checkoutData.items;
    cart.discount = discount;
    localStorage.setItem('thread_cart', JSON.stringify(cart));
  } catch(_) {}
}

/* ─── Promo re-validation (called after any cart change) ─────────────────── */
function validateCheckoutPromo() {
  if (!checkoutData?.promoCode) return;
  if (checkoutData.promoCode === 'BOGOEGG') {
    const hoodies = checkoutData.items.filter(i => (i.type || 'hoodie') !== 'tee');
    const tees    = checkoutData.items.filter(i => i.type === 'tee');
    if (!hoodies.length || !tees.length) {
      checkoutData.promoCode = null;
      checkoutData.discount  = 0;
      // Hide promo UI
      const applied = document.getElementById('coPromoApplied');
      const msg     = document.getElementById('coPromoMsg');
      const input   = document.getElementById('coPromoInput');
      if (applied) applied.style.display = 'none';
      if (input)   input.value = '';
      if (msg) { msg.textContent = 'Promo removed — item requirement no longer met.'; msg.className = 'co-promo-msg co-promo-msg-error'; msg.style.display = 'block'; clearTimeout(msg._t); msg._t = setTimeout(() => { msg.style.display = 'none'; }, 3500); }
    } else {
      checkoutData.discount = parseFloat((Math.min(...tees.map(i => i.price)) * 0.5).toFixed(2));
    }
  }
}

/* ─── Update qty from checkout page ─────────────────────────────────────── */
function updateCheckoutQty(idx, delta) {
  if (!checkoutData?.items?.[idx]) return;
  const newQty = (checkoutData.items[idx].qty || 1) + delta;
  if (newQty < 1) { removeCheckoutItem(idx); return; }
  checkoutData.items[idx].qty = newQty;
  validateCheckoutPromo();
  recalcCheckout();
  renderSummary();
}

function removeCheckoutItem(idx) {
  if (!checkoutData?.items) return;
  checkoutData.items.splice(idx, 1);
  validateCheckoutPromo();
  recalcCheckout();
  if (!checkoutData.items.length) {
    localStorage.removeItem('thread_checkout');
    localStorage.removeItem('thread_cart');
    window.location.href = 'catalog.html';
    return;
  }
  renderSummary();
}

/* ─── Render order summary ────────────────────────────────────────────────── */
function renderSummary() {
  const data = checkoutData;
  const container = document.getElementById('coItems');

  container.innerHTML = data.items.map((item, idx) => {
    const isHoodie = (item.type || 'hoodie') !== 'tee';
    const itemLabel = isHoodie ? 'Hoodie' : 'Tee';
    const typeLabel = isHoodie ? 'Oversized Heavyweight' : 'Oversized Tee';
    return `
    <div class="co-item">
      <div class="co-item-thumb">${miniHoodieSVG(item.name, item.type)}</div>
      <div class="co-item-info">
        <div class="co-item-name">${item.name} ${itemLabel}</div>
        <div class="co-item-meta">${typeLabel} — Size ${item.size || 'M'}</div>
      </div>
      <div class="co-item-right">
        <div class="co-item-price">$${(item.price * item.qty).toFixed(2)}</div>
        <div class="co-qty-ctrl">
          <button class="co-qty-btn" onclick="updateCheckoutQty(${idx}, -1)" aria-label="Decrease">−</button>
          <span class="co-qty-num">${item.qty}</span>
          <button class="co-qty-btn" onclick="updateCheckoutQty(${idx}, 1)" aria-label="Increase">+</button>
          <button class="co-qty-remove" onclick="removeCheckoutItem(${idx})" aria-label="Remove item">✕</button>
        </div>
      </div>
    </div>
  `;
  }).join('');

  document.getElementById('coSubtotal').textContent    = `$${data.subtotal.toFixed(2)}`;
  document.getElementById('coTotal').textContent       = `$${data.total.toFixed(2)}`;
  document.getElementById('payBtnAmount').textContent  = `$${data.total.toFixed(2)}`;

  if (data.discount > 0) {
    document.getElementById('coDiscountRow').style.display  = '';
    document.getElementById('coDiscount').textContent       = '–$' + data.discount.toFixed(2);
    document.getElementById('coPromoApplied').style.display = '';
    document.getElementById('coPromoCode').textContent      = data.promoCode || '';
    document.getElementById('coPromoSaving').textContent    = data.discount.toFixed(2);
    // Pre-fill the promo input so the user can see which code is active
    const promoInput = document.getElementById('coPromoInput');
    if (promoInput && data.promoCode && !promoInput.value) promoInput.value = data.promoCode;
  }

  // Referral attribution. Keep this optional so checkout still works if db.js
  // fails to load; the server webhook handles the real paid order.
  if (refCode && window.DB?.profiles?.getByReferralCode) {
    window.DB.profiles.getByReferralCode(refCode).then(referrer => {
      if (referrer) {
        document.getElementById('coRefNotice').style.display = 'flex';
        document.getElementById('coRefName').textContent     = referrer.name;
      }
    }).catch(() => {});
  }
}

if (checkoutData) renderSummary();

/* ─── Generate order ID ───────────────────────────────────────────────────── */
function genOrderId() {
  return 'TH-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2,6).toUpperCase();
}

async function getCheckoutEmail() {
  try {
    const cfg = window.THREAD_CONFIG;
    if (cfg?.supabaseUrl && window.supabase?.createClient) {
      const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
      const { data } = await sb.auth.getUser();
      if (data?.user?.email) return data.user.email;
    }
  } catch (_) {}

  try {
    const session = JSON.parse(localStorage.getItem('thread_session') || 'null');
    if (session?.email) return session.email;
  } catch (_) {}

  return '';
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

/* ─── Simple checkout handler — Stripe collects email on its own page ─── */
async function handleCheckout(e) {
  e.preventDefault();
  // Try to use the logged-in user's email if available (pre-fills Stripe form).
  // Stripe still collects/verifies the customer email on its hosted page.
  const email = await getCheckoutEmail();
  await launchStripeCheckout(email);
}

/* ─── Bake discount into item prices before sending to Stripe ─────────────── */
function buildStripeItems(items, discount, promoCode) {
  if (!discount || discount <= 0) return items;
  const adjusted = items.map(i => ({ ...i }));
  if (promoCode === 'BOGOEGG') {
    const teeIdxs = adjusted.reduce((acc, item, idx) => { if (item.type === 'tee') acc.push(idx); return acc; }, []);
    if (teeIdxs.length) {
      const minIdx = teeIdxs.reduce((a, b) => adjusted[a].price <= adjusted[b].price ? a : b);
      adjusted[minIdx] = { ...adjusted[minIdx], price: parseFloat((adjusted[minIdx].price * 0.5).toFixed(2)) };
    }
  } else {
    const maxIdx = adjusted.reduce((a, _, i) => adjusted[i].price > adjusted[a].price ? i : a, 0);
    adjusted[maxIdx] = { ...adjusted[maxIdx], price: parseFloat(Math.max(0.01, adjusted[maxIdx].price - discount).toFixed(2)) };
  }
  return adjusted;
}

/* ─── Launch Stripe Checkout ──────────────────────────────────────────────── */
async function launchStripeCheckout(email) {
  const btn  = document.getElementById('btnPayNow');
  const txt  = document.getElementById('payBtnText');
  const spin = document.getElementById('paySpinner');
  btn.disabled = true; txt.style.display = 'none'; spin.style.display = 'block';

  // Save email (if available) for use after Stripe returns
  if (email) localStorage.setItem('thread_checkout_email', email);
  else       localStorage.removeItem('thread_checkout_email');

  try {
    const orderId = genOrderId();
    const base = window.location.origin + window.location.pathname.replace(/\/[^/]*$/, '');
    const stripeItems = buildStripeItems(checkoutData.items, checkoutData.discount || 0, checkoutData.promoCode || '');
    const res  = await fetch(window.THREAD_CONFIG.stripeFunctionUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        items:        stripeItems,
        discount:     0,
        total:        checkoutData.total,
        orderId:      orderId,
        customerEmail: email || '',
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

  // ─── Generate the buyer's unique QR print file ────────────────────────
  // The QR encodes THIS buyer's own referral code so the hoodie they're
  // about to receive will earn them commissions when others scan it.
  let printFileUrl = null;
  let buyerReferralCode = null;
  try {
    const buyer = await window.DB.auth.getUser();
    // Pull the referral code from either Supabase profile or local session
    if (buyer) {
      const profile = await window.DB.profiles.get(buyer.id);
      buyerReferralCode =
        profile?.referralCode ||
        profile?.referral_code ||
        JSON.parse(localStorage.getItem('thread_session') || '{}').referralCode ||
        null;
    }

    if (buyerReferralCode && window.ThreadPrint) {
      const { dataUrl } = await window.ThreadPrint.generate({
        referralCode: buyerReferralCode
      });
      // Upload to Supabase Storage so POD service can hotlink (returns null
      // when Supabase isn't configured — fine for local dev).
      printFileUrl = await window.ThreadPrint.uploadToStorage(
        dataUrl, orderId, buyerReferralCode
      );
      console.log('[checkout] Print file generated for code', buyerReferralCode,
                  printFileUrl ? '(uploaded)' : '(local only)');
    }
  } catch(e) {
    console.warn('Print file generation error:', e);
  }

  // Save order to database (now includes the print-file reference)
  try {
    await window.DB.orders.create({
      order_number:     orderId,
      items:            checkoutData.items,
      subtotal:         checkoutData.subtotal,
      discount:         checkoutData.discount || 0,
      total:            checkoutData.total,
      promo_code:       checkoutData.promoCode || null,
      referral_code:    refCode || null,
      customer_email:   customerEmail,
      status:           'paid',
      print_file_url:   printFileUrl,
      buyer_qr_code:    buyerReferralCode
    });
  } catch(e) {
    console.warn('Order save error:', e);
  }

  // Submit to POD service (uses podFunctionUrl from config; falls back to stub
  // if the edge function isn't deployed yet)
  try {
    if (window.ThreadPrint && buyerReferralCode) {
      const podResult = await window.ThreadPrint.sendToPOD({
        orderId,
        referralCode:  buyerReferralCode,
        items:         checkoutData.items,
        customerEmail,
        printFileUrl
      });
      // Save the POD service's order ID back onto our order row for tracking
      if (podResult?.podOrderId && window.DB?.orders?.updateStatus) {
        try {
          const sb = window.DB.getSB && window.DB.getSB();
          if (sb) {
            await sb.from('orders').update({
              pod_service:  podResult.service || 'apliiq',
              pod_order_id: podResult.podOrderId
            }).eq('id', orderId);
          }
        } catch(_) {}
      }
    }
  } catch(e) { console.warn('POD submission error:', e); }

  // Credit referrer commission using the tier system
  // Priority for "who gets the credit":
  //   1. Buyer's profile.referred_by  — account-linked, survives device/browser switches
  //   2. localStorage thread_ref       — current-browser session fallback
  //   3. URL ?ref= param               — if they're checking out directly from a scan
  let refResult = null;
  let effectiveRefCode = refCode;  // starts as localStorage value
  try {
    const buyer = await window.DB.auth.getUser();
    if (buyer) {
      const profile = await window.DB.profiles.get(buyer.id);
      if (profile?.referredBy || profile?.referred_by) {
        effectiveRefCode = profile.referredBy || profile.referred_by;
      }
    }
  } catch(_) {}

  if (effectiveRefCode) {
    try {
      // 1. Count the referrer's past converted sales BEFORE crediting this new one
      const pastConversions = await window.DB.referrals.countConvertedForCode(effectiveRefCode);

      // 2. Look up their current tier from that count
      const tier = window.ThreadTiers
        ? window.ThreadTiers.getTierForReferrals(pastConversions)
        : { perSale: 20, name: 'Starter' };

      // 3. Commission = per-sale amount × number of hoodies in this order
      const itemCount  = checkoutData.items.reduce((s, i) => s + i.qty, 0);
      const commission = parseFloat((tier.perSale * itemCount).toFixed(2));

      await window.DB.referrals.markConverted(effectiveRefCode, orderId, commission);
      const referrer = await window.DB.profiles.getByReferralCode(effectiveRefCode);
      if (referrer) {
        refResult = { name: referrer.name, commission, tier: tier.name };
      }
      console.log('[checkout] Credited referrer:',
        { code: effectiveRefCode, tier: tier.name, perSale: tier.perSale, itemCount, commission });
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

/* ─── Promo code at checkout ──────────────────────────────────────────────── */
function applyCheckoutPromo() {
  const code = (document.getElementById('coPromoInput')?.value || '').trim().toUpperCase();
  if (!code) return;

  const flatPromos = { 'THREAD10': 10, 'WEAR20': 20, 'FIRST15': 15, 'SCAN25': 25 };

  if (code === 'BOGOEGG') {
    const hoodies = checkoutData.items.filter(i => (i.type || 'hoodie') !== 'tee');
    const tees    = checkoutData.items.filter(i => i.type === 'tee');
    if (!hoodies.length) { showPromoMsg('Add a sweatshirt to use this code', 'error'); return; }
    if (!tees.length)    { showPromoMsg('Add a tee to use this code', 'error'); return; }
    const cheapestTee = Math.min(...tees.map(i => i.price));
    checkoutData.promoCode = code;
    checkoutData.discount  = parseFloat((cheapestTee * 0.5).toFixed(2));
    recalcCheckout();
    renderSummary();
    showPromoMsg(`✓ "BOGOEGG" applied — tee 50% off!`, 'success');
    return;
  }

  if (flatPromos[code]) {
    checkoutData.promoCode = code;
    checkoutData.discount  = flatPromos[code];
    recalcCheckout();
    renderSummary();
    showPromoMsg(`✓ "${code}" applied — $${flatPromos[code]} off!`, 'success');
  } else {
    showPromoMsg('Invalid promo code', 'error');
  }
}

function showPromoMsg(msg, type) {
  const el = document.getElementById('coPromoMsg');
  if (!el) return;
  el.textContent = msg;
  el.className = 'co-promo-msg co-promo-msg-' + type;
  el.style.display = 'block';
  clearTimeout(el._t);
  el._t = setTimeout(() => { if (type !== 'success') el.style.display = 'none'; }, 3000);
}

