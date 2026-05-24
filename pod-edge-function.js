/**
 * THREAD Store — Supabase Edge Function: submit-pod-order
 *
 * Forwards a paid order to the chosen Print-on-Demand service (Apliiq,
 * Printful, or Printify) with the customer's unique QR + logo print file.
 * The API key stays SERVER-SIDE so it never leaves Supabase secrets.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * HOW TO DEPLOY (no terminal needed):
 *   1. supabase.com → your project → Edge Functions → New function
 *   2. Name it: submit-pod-order
 *   3. Paste EVERYTHING between the comment fences below into the editor
 *   4. Click Deploy
 *   5. Settings → Edge Functions → Secrets, add:
 *        POD_SERVICE     = apliiq         (or 'printful' / 'printify')
 *        POD_API_KEY     = (your API key from the POD service)
 *        POD_STORE_ID    = (only needed for Printify; your shop ID)
 *   6. Copy the function URL → paste it into config.js → podFunctionUrl
 * ─────────────────────────────────────────────────────────────────────────
 *
 * ═══════════ PASTE EVERYTHING BELOW THIS LINE INTO SUPABASE ═══════════
 */

/*
const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {

  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const {
      orderId,
      referralCode,        // buyer's own code (printed on hoodie)
      items,               // [{ name, price, qty, size, productVariant }]
      customerEmail,
      shippingAddress,     // { name, address1, city, state_code, country_code, zip }
      printFileUrl,        // public URL of the buyer's unique QR PNG
    } = await req.json();

    const service = (Deno.env.get('POD_SERVICE') || 'apliiq').toLowerCase();
    const apiKey  = Deno.env.get('POD_API_KEY');

    if (!apiKey) {
      return json({ error: 'POD_API_KEY not configured in Supabase secrets' }, 500);
    }
    if (!printFileUrl) {
      return json({ error: 'printFileUrl required — upload the design first' }, 400);
    }

    let result;
    if (service === 'apliiq')   result = await submitToApliiq();
    else if (service === 'printful') result = await submitToPrintful();
    else if (service === 'printify') result = await submitToPrintify();
    else return json({ error: 'Unknown POD service: ' + service }, 400);

    return json({ ok: true, service, ...result });


    /* ── APLIIQ ──────────────────────────────────────────────────────── *./
    async function submitToApliiq() {
      // Apliiq Dropship API — see https://help.apliiq.com (request access from their team)
      // Each line item maps a product variant SKU to your print file.
      const lineItems = items.map(item => ({
        product_sku: mapToApliiqSku(item),      // e.g. 'IND4000-BLK-M'
        quantity:    item.qty,
        artwork: [{
          location: 'full_back',                // back-print placement
          image_url: printFileUrl,
          width_inches: 12,
          height_inches: 14
        }]
      }));

      const res = await fetch('https://api.apliiq.com/v1/orders', {
        method:  'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type':  'application/json'
        },
        body: JSON.stringify({
          external_id: orderId,
          shipping:    shippingAddress,
          customer:    { email: customerEmail },
          line_items:  lineItems,
          metadata:    { thread_buyer_code: referralCode }
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error('Apliiq API: ' + (data.message || res.status));
      return { podOrderId: data.id, raw: data };
    }


    /* ── PRINTFUL ────────────────────────────────────────────────────── *./
    async function submitToPrintful() {
      // Printful v2 API — https://developers.printful.com/docs/v2-beta/
      const orderItems = items.map(item => ({
        source: 'catalog',
        catalog_variant_id: mapToPrintfulVariantId(item),   // numeric variant ID
        quantity: item.qty,
        placements: [{
          placement: 'back',
          technique: 'dtg',
          layers: [{ type: 'file', url: printFileUrl }]
        }]
      }));

      const res = await fetch('https://api.printful.com/v2/orders', {
        method:  'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type':  'application/json'
        },
        body: JSON.stringify({
          external_id:     orderId,
          recipient:       shippingAddress,
          customer_email:  customerEmail,
          order_items:     orderItems
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error('Printful API: ' + (data?.error?.message || res.status));
      return { podOrderId: data?.data?.id, raw: data };
    }


    /* ── PRINTIFY ────────────────────────────────────────────────────── *./
    async function submitToPrintify() {
      // Printify API — https://developers.printify.com
      const storeId = Deno.env.get('POD_STORE_ID');
      if (!storeId) throw new Error('POD_STORE_ID not set for Printify');

      const lineItems = items.map(item => ({
        product_id: mapToPrintifyProductId(item),
        variant_id: mapToPrintifyVariantId(item),
        quantity:   item.qty,
        print_provider_id: 1,
        print_areas: { back: printFileUrl }
      }));

      const res = await fetch(`https://api.printify.com/v1/shops/${storeId}/orders.json`, {
        method:  'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type':  'application/json'
        },
        body: JSON.stringify({
          external_id:      orderId,
          label:            'THREAD ' + orderId,
          line_items:       lineItems,
          shipping_method:  1,
          send_shipping_notification: true,
          address_to:       shippingAddress
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error('Printify API: ' + (data.error || res.status));
      return { podOrderId: data.id, raw: data };
    }


    /* ── SKU/Variant maps — fill in with real IDs from each service ──── *./
    // These map your internal color names (Phantom Black, Midnight Navy, ...)
    // to the SKUs the POD service uses. After you create your products on the
    // POD platform, paste the real IDs here.
    function mapToApliiqSku(item) {
      const map = {
        'Phantom Black':  'IND4000-BLK',
        'Midnight Navy':  'IND4000-NVY',
        'Ember Crimson':  'IND4000-RED',
        'Forest Shadow':  'IND4000-GRN',
        'Ash Stone':      'IND4000-GRY',
        'Void Purple':    'IND4000-PUR',
      };
      const size = item.size || 'M';
      return (map[item.name] || 'IND4000-BLK') + '-' + size;
    }
    function mapToPrintfulVariantId(item) {
      // Numeric Printful variant IDs — look these up in Printful's product catalog
      // for the Bella+Canvas 4719 or Cotton Heritage M2580 in each color/size.
      return 12347; // placeholder
    }
    function mapToPrintifyProductId(item) { return 'YOUR_PRODUCT_ID'; }
    function mapToPrintifyVariantId(item) { return 0; }


    /* ── Helpers ─────────────────────────────────────────────────────── *./
    function json(body, status = 200) {
      return new Response(JSON.stringify(body), {
        status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
*/

// ↑ ↑ ↑ END OF EDGE FUNCTION CODE ↑ ↑ ↑
