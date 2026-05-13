/**
 * THREAD Store — Supabase Edge Function: create-checkout
 *
 * HOW TO DEPLOY (no coding tools needed):
 * ─────────────────────────────────────────────────────────────────────────
 * 1. Go to supabase.com → your project → Edge Functions → New function
 * 2. Name it: create-checkout
 * 3. Paste ALL of the code below (starting from the import line) into the editor
 * 4. Click "Deploy"
 * 5. Go to Settings → Edge Functions → Secrets and add:
 *      STRIPE_SECRET_KEY = sk_live_... (or sk_test_... for testing)
 * 6. Copy the Function URL shown after deploy
 * 7. Paste it into config.js → stripeFunctionUrl
 * ─────────────────────────────────────────────────────────────────────────
 *
 * ═══════════ PASTE EVERYTHING BELOW THIS LINE INTO SUPABASE ═══════════
 */

// ↓ ↓ ↓ PASTE THIS INTO THE SUPABASE EDGE FUNCTION EDITOR ↓ ↓ ↓

/*
import Stripe from 'https://esm.sh/stripe@13?target=deno';

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const {
      items,           // Array of { name, price, qty }
      total,           // Final total in dollars
      orderId,         // UUID of the pre-created order in Supabase
      referralCode,    // Referrer's code (optional)
      promoCode,       // Promo code applied (optional)
      successUrl,      // Where to redirect after payment
      cancelUrl,       // Where to redirect if user cancels
    } = await req.json();

    const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY'), {
      apiVersion: '2023-10-16',
    });

    // Build line items from cart
    const lineItems = items.map(item => ({
      price_data: {
        currency: 'usd',
        product_data: {
          name: `${item.name} Hoodie`,
          description: 'THREAD Classic — Referral QR included',
        },
        unit_amount: Math.round(item.price * 100),  // Stripe uses cents
      },
      quantity: item.qty,
    }));

    // If there's a discount, add it as a negative line item
    if (total < items.reduce((s, i) => s + i.price * i.qty, 0)) {
      const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0);
      const discount = subtotal - total;
      lineItems.push({
        price_data: {
          currency: 'usd',
          product_data: { name: `Promo: ${promoCode || 'Discount'}` },
          unit_amount: -Math.round(discount * 100),
        },
        quantity: 1,
      });
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items:  lineItems,
      mode:        'payment',
      success_url: `${successUrl}?stripe_success=1&session_id={CHECKOUT_SESSION_ID}&order_id=${orderId}`,
      cancel_url:  `${cancelUrl}?cancelled=1`,
      // Apple Pay + Google Pay are automatically enabled in Stripe Checkout
      // when the user's browser/device supports them — no extra config needed.
      metadata: {
        order_id:      orderId  || '',
        referral_code: referralCode || '',
      },
      billing_address_collection: 'required',
      shipping_address_collection: {
        allowed_countries: ['US', 'CA', 'GB', 'AU'],
      },
    });

    return new Response(
      JSON.stringify({ url: session.url, sessionId: session.id }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
*/

// ↑ ↑ ↑ END OF EDGE FUNCTION CODE ↑ ↑ ↑
