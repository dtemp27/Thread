/**
 * THREAD Supabase Edge Function: create-checkout
 *
 * Deploy in Supabase as function name: create-checkout
 * Required secret:
 *   STRIPE_SECRET_KEY = sk_test_... or sk_live_...
 *
 * This creates the Stripe Checkout Session. The confirmation email is sent by
 * stripe-webhook-email-function.js after Stripe confirms payment.
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const {
      items = [],
      orderId = '',
      customerEmail = '',
      referralCode = '',
      promoCode = '',
      successUrl,
      cancelUrl,
    } = await req.json();

    if (!items.length) throw new Error('Cart is empty.');
    if (!successUrl || !cancelUrl) throw new Error('Missing redirect URLs.');

    const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
    if (!stripeKey) throw new Error('Missing STRIPE_SECRET_KEY.');

    const body = new URLSearchParams();
    body.append('mode', 'payment');
    body.append('success_url', `${successUrl}?stripe_success=1&session_id={CHECKOUT_SESSION_ID}&order_id=${encodeURIComponent(orderId)}`);
    body.append('cancel_url', `${cancelUrl}?cancelled=1`);
    body.append('payment_method_types[0]', 'card');
    body.append('billing_address_collection', 'required');
    body.append('shipping_address_collection[allowed_countries][0]', 'US');
    body.append('shipping_address_collection[allowed_countries][1]', 'CA');
    body.append('shipping_address_collection[allowed_countries][2]', 'GB');
    body.append('shipping_address_collection[allowed_countries][3]', 'AU');
    body.append('metadata[order_number]', orderId);
    body.append('metadata[referral_code]', referralCode);
    body.append('metadata[promo_code]', promoCode);

    if (customerEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) {
      body.append('customer_email', customerEmail);
    }

    items.forEach((item, i) => {
      const name = `${item.name || 'THREAD'} Hoodie`;
      const unitAmount = Math.max(50, Math.round(Number(item.price || 0) * 100));
      const qty = Math.max(1, parseInt(item.qty || 1, 10));
      body.append(`line_items[${i}][price_data][currency]`, 'usd');
      body.append(`line_items[${i}][price_data][product_data][name]`, name);
      body.append(`line_items[${i}][price_data][product_data][description]`, `THREAD Classic - Size ${item.size || 'M'} - Referral QR included`);
      body.append(`line_items[${i}][price_data][unit_amount]`, String(unitAmount));
      body.append(`line_items[${i}][quantity]`, String(qty));
    });

    const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${stripeKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });

    const session = await stripeRes.json();
    if (!stripeRes.ok || session.error) {
      throw new Error(session.error?.message || 'Stripe Checkout failed.');
    }

    return new Response(JSON.stringify({ url: session.url, sessionId: session.id }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

