/**
 * THREAD Supabase Edge Function: stripe-webhook
 *
 * Deploy in Supabase as function name: stripe-webhook
 *
 * Required secrets:
 *   STRIPE_SECRET_KEY       = sk_test_... or sk_live_...
 *   STRIPE_WEBHOOK_SECRET   = whsec_... from Stripe webhook endpoint
 *   RESEND_API_KEY          = re_...
 *   ORDER_EMAIL_FROM        = THREAD <contact@mythread.shop>
 *   ORDER_ADMIN_EMAIL       = contact@mythread.shop
 *
 * This function receives Stripe's checkout.session.completed webhook, saves
 * the paid order into Supabase, and emails the customer from contact@mythread.shop.
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
    const event = await verifyStripeEvent(rawBody, req.headers.get('stripe-signature'));

    if (event.type === 'checkout.session.completed') {
      await handleCheckoutCompleted(event.data.object);
    }

    return json({ received: true });
  } catch (err) {
    console.error('[stripe-webhook] error:', err.message);
    return json({ error: err.message }, 400);
  }
});

async function handleCheckoutCompleted(session) {
  const stripeKey = mustEnv('STRIPE_SECRET_KEY');
  const customerEmail = session.customer_details?.email || session.customer_email || '';
  if (!customerEmail) throw new Error('Stripe session is missing customer email.');

  const orderNumber = session.metadata?.order_number || session.metadata?.order_id || session.id;
  const referralCode = session.metadata?.referral_code || null;
  const promoCode = session.metadata?.promo_code || null;
  const lineItems = await fetchStripeLineItems(stripeKey, session.id);
  const items = lineItems.map((li) => {
    const qty = li.quantity || 1;
    const amount = Number(li.amount_subtotal || li.amount_total || 0);
    return {
      name: (li.description || 'THREAD Hoodie').replace(/\s+Hoodie$/i, ''),
      qty,
      price: Number((amount / Math.max(1, qty) / 100).toFixed(2)),
    };
  });

  const subtotal = cents(session.amount_subtotal);
  const total = cents(session.amount_total);
  const discount = cents(session.total_details?.amount_discount || 0);

  await upsertPaidOrder({
    order_number: orderNumber,
    stripe_session_id: session.id,
    items,
    subtotal,
    discount,
    total,
    promo_code: promoCode,
    referral_code: referralCode,
    customer_email: customerEmail,
    status: 'paid',
    email_sent_at: new Date().toISOString(),
  });

  await sendOrderEmail({
    to: customerEmail,
    orderNumber,
    items,
    subtotal,
    discount,
    total,
  });
}

async function fetchStripeLineItems(stripeKey, sessionId) {
  const res = await fetch(`https://api.stripe.com/v1/checkout/sessions/${sessionId}/line_items?limit=100`, {
    headers: { Authorization: `Bearer ${stripeKey}` },
  });
  const jsonBody = await res.json();
  if (!res.ok || jsonBody.error) throw new Error(jsonBody.error?.message || 'Could not load Stripe line items.');
  return jsonBody.data || [];
}

async function upsertPaidOrder(order) {
  const supabaseUrl = mustEnv('SUPABASE_URL');
  const serviceKey = mustEnv('SUPABASE_SERVICE_ROLE_KEY');

  const res = await fetch(`${supabaseUrl}/rest/v1/orders?on_conflict=order_number`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(order),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase order save failed: ${text}`);
  }
}

async function sendOrderEmail({ to, orderNumber, items, subtotal, discount, total }) {
  const resendKey = mustEnv('RESEND_API_KEY');
  const from = Deno.env.get('ORDER_EMAIL_FROM') || 'THREAD <contact@mythread.shop>';
  const adminEmail = Deno.env.get('ORDER_ADMIN_EMAIL') || 'contact@mythread.shop';

  const html = renderOrderEmail({ orderNumber, items, subtotal, discount, total });
  const text = renderOrderEmailText({ orderNumber, items, subtotal, discount, total });

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [to],
      bcc: [adminEmail],
      reply_to: adminEmail,
      subject: `Your THREAD order ${orderNumber} is confirmed`,
      html,
      text,
    }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.error) throw new Error(body.error?.message || 'Resend email failed.');
}

function renderOrderEmail({ orderNumber, items, subtotal, discount, total }) {
  const rows = items.map((item) => `
    <tr>
      <td style="padding:12px 0;border-bottom:1px solid #eee;">
        <strong>${escapeHtml(item.name)} Hoodie</strong><br>
        <span style="color:#777;font-size:13px;">Qty ${item.qty}</span>
      </td>
      <td style="padding:12px 0;border-bottom:1px solid #eee;text-align:right;">$${(item.price * item.qty).toFixed(2)}</td>
    </tr>
  `).join('');

  const discountRow = discount > 0 ? `
    <tr>
      <td style="padding:6px 0;color:#16a34a;">Discount</td>
      <td style="padding:6px 0;text-align:right;color:#16a34a;">-$${discount.toFixed(2)}</td>
    </tr>
  ` : '';

  return `<!doctype html>
  <html>
    <body style="margin:0;background:#f6f6f6;font-family:Arial,Helvetica,sans-serif;color:#111;">
      <div style="max-width:620px;margin:0 auto;padding:28px 16px;">
        <div style="background:#090909;color:#fff;border-radius:18px 18px 0 0;padding:28px;">
          <div style="font-size:22px;font-weight:800;letter-spacing:2px;">THREAD.</div>
          <h1 style="margin:28px 0 8px;font-size:28px;line-height:1.1;">Order confirmed</h1>
          <p style="margin:0;color:#bbb;">Thanks for your order. We are getting your THREAD gear ready.</p>
        </div>
        <div style="background:#fff;border-radius:0 0 18px 18px;padding:28px;">
          <p style="margin:0 0 18px;color:#555;">Order <strong>${escapeHtml(orderNumber)}</strong></p>
          <table style="width:100%;border-collapse:collapse;font-size:15px;">${rows}</table>
          <table style="width:100%;border-collapse:collapse;margin-top:18px;font-size:15px;">
            <tr><td style="padding:6px 0;color:#555;">Subtotal</td><td style="padding:6px 0;text-align:right;">$${subtotal.toFixed(2)}</td></tr>
            ${discountRow}
            <tr><td style="padding:6px 0;color:#555;">Shipping</td><td style="padding:6px 0;text-align:right;">Free</td></tr>
            <tr><td style="padding:14px 0 0;font-size:18px;font-weight:800;">Total</td><td style="padding:14px 0 0;text-align:right;font-size:18px;font-weight:800;">$${total.toFixed(2)}</td></tr>
          </table>
          <div style="margin-top:26px;padding:18px;border-radius:14px;background:#f7f7f7;color:#555;font-size:14px;line-height:1.5;">
            Your hoodie includes your own referral QR code. When people scan it and buy, you earn rewards.
          </div>
          <p style="margin:26px 0 0;color:#777;font-size:13px;">Questions? Reply to this email or contact us at contact@mythread.shop.</p>
        </div>
      </div>
    </body>
  </html>`;
}

function renderOrderEmailText({ orderNumber, items, subtotal, discount, total }) {
  const itemLines = items.map((item) => `- ${item.name} Hoodie x${item.qty}: $${(item.price * item.qty).toFixed(2)}`).join('\n');
  return [
    'THREAD order confirmed',
    `Order: ${orderNumber}`,
    '',
    itemLines,
    '',
    `Subtotal: $${subtotal.toFixed(2)}`,
    discount > 0 ? `Discount: -$${discount.toFixed(2)}` : null,
    'Shipping: Free',
    `Total: $${total.toFixed(2)}`,
    '',
    'Questions? Reply to this email or contact contact@mythread.shop.',
  ].filter(Boolean).join('\n');
}

async function verifyStripeEvent(payload, signatureHeader) {
  const webhookSecret = mustEnv('STRIPE_WEBHOOK_SECRET');
  if (!signatureHeader) throw new Error('Missing Stripe signature header.');

  const parts = Object.fromEntries(
    signatureHeader.split(',').map((part) => {
      const [k, v] = part.split('=');
      return [k, v];
    })
  );
  const timestamp = parts.t;
  const expected = parts.v1;
  if (!timestamp || !expected) throw new Error('Invalid Stripe signature header.');

  const signedPayload = `${timestamp}.${payload}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(webhookSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signedPayload));
  const actual = [...new Uint8Array(signature)].map((b) => b.toString(16).padStart(2, '0')).join('');

  if (!timingSafeEqual(actual, expected)) throw new Error('Stripe signature verification failed.');
  return JSON.parse(payload);
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

function cents(value) {
  return Number(((Number(value || 0)) / 100).toFixed(2));
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function mustEnv(name) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

