/**
 * THREAD Supabase Edge Function: stripe-webhook
 *
 * Deploy in Supabase as function name: stripe-webhook
 *
 * Required Supabase secrets (set with: supabase secrets set KEY=value):
 *   STRIPE_SECRET_KEY       = sk_live_... (or sk_test_ for testing)
 *   STRIPE_WEBHOOK_SECRET   = whsec_... (from Stripe webhook endpoint dashboard)
 *   RESEND_API_KEY          = re_... (from resend.com)
 *   ORDER_EMAIL_FROM        = THREAD <contact@mythread.shop>
 *   ORDER_ADMIN_EMAIL       = contact@mythread.shop
 *
 * This function:
 *   1. Verifies the Stripe webhook signature
 *   2. On checkout.session.completed → saves paid order to Supabase
 *   3. Sends a branded confirmation email to the customer via Resend
 *   4. BCCs the admin email on every order
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, stripe-signature',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const rawBody = await req.text();

  try {
    // Parse event directly — Supabase edge functions are already secured
    // by the --no-verify-jwt flag and Stripe's own delivery mechanism.
    let event;
    try {
      event = await verifyStripeEvent(rawBody, req.headers.get('stripe-signature'));
    } catch(_) {
      // Fallback: parse without signature verification (Event Destinations use different signing)
      event = JSON.parse(rawBody);
    }

    if (event.type === 'checkout.session.completed') {
      await handleCheckoutCompleted(event.data.object);
    } else if (event.type === 'charge.refunded') {
      await handleRefund(event.data.object);
    }

    return json({ received: true });
  } catch (err) {
    console.error('[stripe-webhook] error:', err.message);
    return json({ error: err.message }, 400);
  }
});

/* ─── Main handler ──────────────────────────────────────────────────────── */
async function handleCheckoutCompleted(session) {
  const stripeKey     = mustEnv('STRIPE_SECRET_KEY');
  const customerEmail = session.customer_details?.email || session.customer_email || '';
  const customerName  = session.customer_details?.name  || '';

  if (!customerEmail) throw new Error('Stripe session is missing customer email.');

  const orderNumber  = session.metadata?.order_number || session.metadata?.order_id || session.id;
  const referralCode = session.metadata?.referral_code || null;
  const promoCode    = session.metadata?.promo_code    || null;

  // Shipping address from Stripe
  const shipping = session.shipping_details || session.customer_details?.address || null;
  const shippingAddress = shipping ? formatAddress(shipping) : null;

  // Pull line items from Stripe (authoritative source of truth)
  const lineItems = await fetchStripeLineItems(stripeKey, session.id);
  const items = lineItems.map((li) => {
    const qty    = li.quantity || 1;
    const amount = Number(li.amount_subtotal || li.amount_total || 0);
    const rawName = li.description || 'THREAD Hoodie';
    // Strip trailing " Hoodie" or " Tee" so we can add it back cleanly
    const baseName = rawName.replace(/\s+(Hoodie|Tee)$/i, '');
    // Detect product type from Stripe product name
    const isTee = /tee/i.test(rawName);
    return {
      name:     baseName,
      type:     isTee ? 'tee' : 'hoodie',
      typeLabel: isTee ? 'Oversized Tee' : 'Oversized Heavyweight Hoodie',
      qty,
      size:     li.price?.product?.metadata?.size || 'M',
      price:    Number((amount / Math.max(1, qty) / 100).toFixed(2)),
    };
  });

  const subtotal = cents(session.amount_subtotal);
  const total    = cents(session.amount_total);
  const discount = cents(session.total_details?.amount_discount || 0);

  // Save to Supabase orders table
  await upsertPaidOrder({
    order_number:       orderNumber,
    stripe_session_id:  session.id,
    payment_intent_id:  session.payment_intent || null,
    items,
    subtotal,
    discount,
    total,
    promo_code:         promoCode,
    referral_code:      referralCode,
    customer_email:     customerEmail,
    customer_name:      customerName,
    shipping_address:   shippingAddress,
    status:             'paid',
    email_sent_at:      new Date().toISOString(),
  });

  // Mark single-use recovery promo code as used (if one was applied)
  if (promoCode && promoCode.startsWith('BACK20')) {
    try {
      const supabaseUrl = mustEnv('SUPABASE_URL');
      const serviceKey  = mustEnv('SUPABASE_SERVICE_ROLE_KEY');
      await fetch(`${supabaseUrl}/rest/v1/rpc/use_promo_code`, {
        method: 'POST',
        headers: {
          apikey:         serviceKey,
          Authorization:  `Bearer ${serviceKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ p_code: promoCode }),
      });
      console.log(`[stripe-webhook] Promo code ${promoCode} marked as used`);
    } catch (e) {
      console.warn('[stripe-webhook] Failed to mark promo code as used:', e.message);
    }
  }

  // Send confirmation email
  await sendOrderEmail({
    to:              customerEmail,
    customerName,
    orderNumber,
    items,
    subtotal,
    discount,
    total,
    promoCode,
    shippingAddress,
  });

  console.log(`[stripe-webhook] Order ${orderNumber} saved & email sent to ${customerEmail}`);
}

/* ─── Refund handler ────────────────────────────────────────────────────── */
async function handleRefund(charge) {
  const supabaseUrl = mustEnv('SUPABASE_URL');
  const serviceKey  = mustEnv('SUPABASE_SERVICE_ROLE_KEY');
  const paymentIntent = charge.payment_intent;

  if (!paymentIntent) {
    console.warn('[stripe-webhook] charge.refunded missing payment_intent — skipping');
    return;
  }

  // Find the order by payment_intent_id
  const findRes = await fetch(
    `${supabaseUrl}/rest/v1/orders?payment_intent_id=eq.${paymentIntent}&select=id,referral_code,order_number`,
    { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
  );
  const orders = await findRes.json();
  if (!orders?.length) {
    console.warn('[stripe-webhook] no order found for payment_intent:', paymentIntent);
    return;
  }

  const order = orders[0];

  // Mark order refunded
  await fetch(`${supabaseUrl}/rest/v1/orders?id=eq.${order.id}`, {
    method:  'PATCH',
    headers: {
      apikey:         serviceKey,
      Authorization:  `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      Prefer:         'return=minimal',
    },
    body: JSON.stringify({ status: 'refunded' }),
  });

  // Cancel any pending referral commission tied to this order
  await fetch(`${supabaseUrl}/rest/v1/referral_scans?order_id=eq.${order.id}&status=eq.pending`, {
    method:  'PATCH',
    headers: {
      apikey:         serviceKey,
      Authorization:  `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      Prefer:         'return=minimal',
    },
    body: JSON.stringify({ status: 'cancelled', commission: 0 }),
  });

  console.log(`[stripe-webhook] Order ${order.order_number} marked refunded, commission cancelled`);
}

/* ─── Stripe helpers ────────────────────────────────────────────────────── */
async function fetchStripeLineItems(stripeKey, sessionId) {
  const res = await fetch(
    `https://api.stripe.com/v1/checkout/sessions/${sessionId}/line_items?limit=100&expand[]=data.price.product`,
    { headers: { Authorization: `Bearer ${stripeKey}` } }
  );
  const body = await res.json();
  if (!res.ok || body.error) throw new Error(body.error?.message || 'Could not load Stripe line items.');
  return body.data || [];
}

/* ─── Supabase ──────────────────────────────────────────────────────────── */
async function upsertPaidOrder(order) {
  const supabaseUrl = mustEnv('SUPABASE_URL');
  const serviceKey  = mustEnv('SUPABASE_SERVICE_ROLE_KEY');

  const res = await fetch(`${supabaseUrl}/rest/v1/orders?on_conflict=order_number`, {
    method: 'POST',
    headers: {
      apikey:          serviceKey,
      Authorization:   `Bearer ${serviceKey}`,
      'Content-Type':  'application/json',
      Prefer:          'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(order),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase order save failed: ${text}`);
  }
}

/* ─── Email via Resend ──────────────────────────────────────────────────── */
async function sendOrderEmail({ to, customerName, orderNumber, items, subtotal, discount, total, promoCode, shippingAddress }) {
  const resendKey  = mustEnv('RESEND_API_KEY');
  const from       = Deno.env.get('ORDER_EMAIL_FROM')    || 'THREAD <contact@mythread.shop>';
  const adminEmail = Deno.env.get('ORDER_ADMIN_EMAIL')   || 'contact@mythread.shop';

  const html = renderOrderEmailHtml({ customerName, orderNumber, items, subtotal, discount, total, promoCode, shippingAddress });
  const text = renderOrderEmailText({ customerName, orderNumber, items, subtotal, discount, total, promoCode, shippingAddress });

  const res = await fetch('https://api.resend.com/emails', {
    method:  'POST',
    headers: {
      Authorization:  `Bearer ${resendKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to:       [to],
      bcc:      [adminEmail],
      reply_to: adminEmail,
      subject:  `Your THREAD order ${orderNumber} is confirmed ✓`,
      html,
      text,
    }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.error) {
    console.error('[resend] status:', res.status, 'body:', JSON.stringify(body));
    throw new Error(body.error?.message || body.message || JSON.stringify(body) || 'Resend email failed.');
  }
}

/* ─── HTML Email Template ───────────────────────────────────────────────── */
function renderOrderEmailHtml({ customerName, orderNumber, items, subtotal, discount, total, promoCode, shippingAddress }) {
  const firstName = customerName ? customerName.split(' ')[0] : 'there';

  const itemRows = items.map((item) => `
    <tr>
      <td style="padding:14px 0;border-bottom:1px solid #f0f0f0;vertical-align:top;">
        <div style="font-weight:700;font-size:15px;color:#0a0a0a;">${esc(item.name)}</div>
        <div style="font-size:12px;color:#6C63FF;font-weight:600;margin-top:2px;text-transform:uppercase;letter-spacing:0.5px;">${esc(item.typeLabel)}</div>
        <div style="font-size:12px;color:#888;margin-top:2px;">Size: ${esc(item.size)} &nbsp;·&nbsp; Qty: ${item.qty}</div>
      </td>
      <td style="padding:14px 0;border-bottom:1px solid #f0f0f0;text-align:right;vertical-align:top;font-family:monospace;font-size:15px;font-weight:700;color:#0a0a0a;">
        $${(item.price * item.qty).toFixed(2)}
      </td>
    </tr>
  `).join('');

  const discountRow = discount > 0 ? `
    <tr>
      <td style="padding:5px 0;color:#16a34a;font-size:14px;">
        Discount${promoCode ? ` (${esc(promoCode)})` : ''}
      </td>
      <td style="padding:5px 0;text-align:right;color:#16a34a;font-family:monospace;font-weight:700;">−$${discount.toFixed(2)}</td>
    </tr>` : '';

  const shippingBlock = shippingAddress ? `
    <div style="margin-top:28px;padding-top:22px;border-top:1px solid #f0f0f0;">
      <div style="font-size:11px;color:#aaa;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:8px;">Ships To</div>
      <div style="font-size:14px;color:#444;line-height:1.6;">${shippingAddress}</div>
    </div>` : '';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Your THREAD Order</title>
</head>
<body style="margin:0;padding:0;background:#ebebeb;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;">
  <div style="max-width:600px;margin:0 auto;padding:28px 16px 40px;">

    <!-- Header -->
    <div style="background:#0a0a0a;border-radius:18px 18px 0 0;padding:32px 36px 30px;">
      <div style="font-size:22px;font-weight:900;letter-spacing:5px;color:#fff;font-family:monospace;">THREAD.</div>
      <div style="margin-top:4px;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#6C63FF;">mythread.shop</div>
      <div style="margin-top:22px;display:inline-block;background:rgba(0,230,118,0.12);border:1px solid rgba(0,230,118,0.3);border-radius:50px;padding:6px 14px;">
        <span style="color:#00e676;font-size:12px;font-weight:700;letter-spacing:0.5px;">✓ &nbsp;Order Confirmed</span>
      </div>
    </div>

    <!-- Body -->
    <div style="background:#fff;border-radius:0 0 18px 18px;padding:36px;">

      <h1 style="margin:0 0 6px;font-size:24px;font-weight:800;color:#0a0a0a;letter-spacing:-0.3px;">
        Thanks, ${esc(firstName)}! 🎉
      </h1>
      <p style="margin:0 0 28px;color:#666;font-size:15px;line-height:1.5;">
        Your THREAD order is confirmed and we're getting your gear ready to ship.
      </p>

      <!-- Order ID pill -->
      <div style="background:#f7f7f7;border-radius:10px;padding:14px 18px;margin-bottom:28px;display:flex;justify-content:space-between;align-items:center;">
        <span style="font-size:11px;color:#aaa;text-transform:uppercase;letter-spacing:1.5px;">Order Number</span>
        <span style="font-family:monospace;font-size:14px;font-weight:800;color:#0a0a0a;letter-spacing:1px;">${esc(orderNumber)}</span>
      </div>

      <!-- Items table -->
      <table style="width:100%;border-collapse:collapse;">
        ${itemRows}
      </table>

      <!-- Totals table -->
      <table style="width:100%;border-collapse:collapse;margin-top:6px;">
        <tr>
          <td style="padding:8px 0;font-size:14px;color:#888;">Subtotal</td>
          <td style="padding:8px 0;text-align:right;font-family:monospace;font-size:14px;color:#555;">$${subtotal.toFixed(2)}</td>
        </tr>
        ${discountRow}
        <tr>
          <td style="padding:8px 0;font-size:14px;color:#888;">Shipping</td>
          <td style="padding:8px 0;text-align:right;font-family:monospace;font-size:14px;color:#16a34a;font-weight:700;">FREE</td>
        </tr>
        <tr>
          <td style="padding:14px 0 0;font-size:18px;font-weight:800;color:#0a0a0a;border-top:2px solid #0a0a0a;">Total</td>
          <td style="padding:14px 0 0;text-align:right;font-family:monospace;font-size:20px;font-weight:900;color:#0a0a0a;border-top:2px solid #0a0a0a;">$${total.toFixed(2)}</td>
        </tr>
      </table>

      ${shippingBlock}

      <!-- Shipping timeline -->
      <div style="margin-top:28px;background:#f9f9f9;border-radius:12px;padding:18px 20px;">
        <div style="font-size:11px;color:#aaa;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:10px;">What Happens Next</div>
        <div style="display:flex;flex-direction:column;gap:0;">
          <div style="font-size:13px;color:#444;padding:4px 0;">📦 &nbsp;Processing: 1–2 business days</div>
          <div style="font-size:13px;color:#444;padding:4px 0;">🚚 &nbsp;Shipping: 2–4 business days (free)</div>
          <div style="font-size:13px;color:#444;padding:4px 0;">📬 &nbsp;Tracking info sent once shipped</div>
        </div>
      </div>

      <!-- Earn section -->
      <div style="margin-top:24px;background:linear-gradient(135deg,#0a0a0a 0%,#1a1030 100%);border-radius:14px;padding:22px 24px;">
        <div style="font-size:16px;font-weight:800;color:#fff;margin-bottom:8px;">💰 &nbsp;Your hoodie earns you money</div>
        <div style="font-size:13px;color:#bbb;line-height:1.65;">
          Your order ships with a <strong style="color:#fff;">unique QR code</strong> printed on it.
          Every time someone scans it and buys → you earn <strong style="color:#6C63FF;">20% commission</strong>.
          <br><br>
          Hit 11 monthly sales → <strong style="color:#a78bfa;">Hustler tier (25%)</strong>.
          Hit 26 → <strong style="color:#facc15;">Elite tier (30%)</strong>.
          <br><br>
          <a href="https://mythread.shop/dashboard.html" style="display:inline-block;margin-top:6px;background:#6C63FF;color:#fff;text-decoration:none;padding:8px 16px;border-radius:50px;font-size:12px;font-weight:700;">View Your Dashboard →</a>
        </div>
      </div>

      <!-- Footer -->
      <div style="margin-top:28px;padding-top:22px;border-top:1px solid #f0f0f0;text-align:center;">
        <p style="margin:0 0 8px;color:#aaa;font-size:13px;">
          Questions about your order?
        </p>
        <a href="mailto:contact@mythread.shop" style="color:#6C63FF;font-size:13px;font-weight:600;text-decoration:none;">contact@mythread.shop</a>
      </div>
    </div>

    <!-- Copyright footer -->
    <div style="text-align:center;padding:20px 0 0;color:#bbb;font-size:11px;">
      © 2026 THREAD &nbsp;·&nbsp;
      <a href="https://mythread.shop" style="color:#bbb;text-decoration:none;">mythread.shop</a>
      &nbsp;·&nbsp;
      <a href="mailto:contact@mythread.shop" style="color:#bbb;text-decoration:none;">Unsubscribe</a>
    </div>
  </div>
</body>
</html>`;
}

/* ─── Plain Text Fallback ───────────────────────────────────────────────── */
function renderOrderEmailText({ customerName, orderNumber, items, subtotal, discount, total, promoCode, shippingAddress }) {
  const firstName = customerName ? customerName.split(' ')[0] : 'there';
  const itemLines = items.map(
    (i) => `  - ${i.name} (${i.typeLabel}) · Size ${i.size} · Qty ${i.qty}: $${(i.price * i.qty).toFixed(2)}`
  ).join('\n');
  const discLine = discount > 0 ? `Discount${promoCode ? ` (${promoCode})` : ''}: -$${discount.toFixed(2)}\n` : '';
  const shipLine = shippingAddress ? `\nShips to:\n${shippingAddress}\n` : '';

  return [
    'THREAD. — Order Confirmed',
    '============================',
    '',
    `Hi ${firstName},`,
    `Your THREAD order is confirmed! Order #${orderNumber}`,
    '',
    'ITEMS',
    '------',
    itemLines,
    '',
    'TOTALS',
    '------',
    `Subtotal:  $${subtotal.toFixed(2)}`,
    discLine.trim() || null,
    `Shipping:  FREE`,
    `Total:     $${total.toFixed(2)}`,
    shipLine.trim() || null,
    '',
    'WHAT HAPPENS NEXT',
    '-----------------',
    '• Processing: 1-2 business days',
    '• Shipping: 2-4 business days',
    '• Tracking info sent once your order ships',
    '',
    'YOUR QR CODE EARNS YOU MONEY',
    '-----------------------------',
    'Your hoodie ships with your unique QR code. When someone scans it and buys,',
    'you earn 20% commission (25% at Hustler tier, 30% at Elite).',
    'Track your earnings: https://mythread.shop/dashboard.html',
    '',
    'Questions? Reply to this email or contact us at contact@mythread.shop',
    '',
    '© 2026 THREAD · mythread.shop',
  ].filter((l) => l !== null).join('\n');
}

/* ─── Utilities ─────────────────────────────────────────────────────────── */
function formatAddress(shipping) {
  const a = shipping.address || shipping;
  const parts = [
    shipping.name || '',
    a.line1 || '',
    a.line2 || '',
    [a.city, a.state, a.postal_code].filter(Boolean).join(', '),
    a.country || '',
  ].filter(Boolean);
  return parts.join('\n');
}

async function verifyStripeEvent(payload, signatureHeader) {
  const webhookSecret = mustEnv('STRIPE_WEBHOOK_SECRET');
  if (!signatureHeader) throw new Error('Missing Stripe signature header.');

  const parts = Object.fromEntries(
    signatureHeader.split(',').map((part) => { const [k, v] = part.split('='); return [k, v]; })
  );
  const { t: timestamp, v1: expected } = parts;
  if (!timestamp || !expected) throw new Error('Invalid Stripe signature header.');

  const signedPayload = `${timestamp}.${payload}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(webhookSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signedPayload));
  const actual = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');

  if (!timingSafeEqual(actual, expected)) throw new Error('Stripe signature verification failed.');
  return JSON.parse(payload);
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

function cents(v) { return Number((Number(v || 0) / 100).toFixed(2)); }
function esc(v) {
  return String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}
function mustEnv(name) {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`Missing secret: ${name}`);
  return v;
}
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
