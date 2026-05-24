// ═══════════════════════════════════════════════════════════════════════════
// THREAD — Supabase Edge Function (rapid-processor)
// ═══════════════════════════════════════════════════════════════════════════

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const body = await req.json();
    const apiKey = Deno.env.get('POD_API_KEY');
    if (!apiKey) return json({ error: 'POD_API_KEY not configured' }, 500);

    if (body.lookup) {
      return json(await lookupPrintfulVariants(body.q || '4719', apiKey));
    }

    const { orderId, referralCode, items, customerEmail, shippingAddress, printFileUrl } = body;
    const service = (Deno.env.get('POD_SERVICE') || 'printful').toLowerCase();
    if (!printFileUrl) return json({ error: 'printFileUrl required' }, 400);

    let result;
    if (service === 'printful') {
      result = await submitToPrintful({ orderId, items, customerEmail, shippingAddress, printFileUrl, apiKey });
    } else if (service === 'apliiq') {
      result = await submitToApliiq({ orderId, referralCode, items, customerEmail, shippingAddress, printFileUrl, apiKey });
    } else {
      return json({ error: 'Unknown POD service: ' + service }, 400);
    }
    return json({ ok: true, service, ...result });

  } catch (err) {
    return json({ error: err.message }, 500);
  }
});

async function lookupPrintfulVariants(query, apiKey) {
  let match = null;
  let offset = 0;
  const limit = 100;
  let totalChecked = 0;

  while (offset < 1000) {
    const res = await fetch(`https://api.printful.com/v2/catalog-products?limit=${limit}&offset=${offset}`, {
      headers: { 'Authorization': `Bearer ${apiKey}` }
    });
    const data = await res.json();
    const products = data?.data || [];
    if (!products.length) break;

    totalChecked += products.length;
    match = products.find((p) =>
      (p.name || '').toLowerCase().includes(query.toLowerCase()) ||
      String(p.id) === query
    );
    if (match) break;
    if (products.length < limit) break;
    offset += limit;
  }

  if (!match) return { error: `No product found matching "${query}"`, totalChecked };

  // Paginate variants — Printful max limit = 100 per page
  let allVariants = [];
  let vOffset = 0;
  const vLimit = 100;
  while (vOffset < 500) {
    const varRes = await fetch(`https://api.printful.com/v2/catalog-products/${match.id}/catalog-variants?limit=${vLimit}&offset=${vOffset}`, {
      headers: { 'Authorization': `Bearer ${apiKey}` }
    });
    const varData = await varRes.json();
    const page = Array.isArray(varData?.data) ? varData.data : [];
    if (!page.length) break;
    allVariants = allVariants.concat(page);
    if (page.length < vLimit) break;
    vOffset += vLimit;
  }

  const variants = allVariants.map((v) => ({
    id:    v.id || v.variant_id || v.catalog_variant_id,
    color: v.color || v.color_name,
    size:  v.size  || v.size_name,
  }));

  return { productId: match.id, productName: match.name, variantCount: variants.length, variants };
}

async function submitToPrintful(p) {
  const orderItems = p.items.map((item) => ({
    source: 'catalog',
    catalog_variant_id: mapToPrintfulVariantId(item),
    quantity: item.qty,
    placements: [{
      placement: 'back',
      technique: 'dtg',
      layers: [{ type: 'file', url: p.printFileUrl }]
    }]
  }));

  const res = await fetch('https://api.printful.com/v2/orders', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${p.apiKey}`,
      'Content-Type':  'application/json'
    },
    body: JSON.stringify({
      external_id:    p.orderId,
      recipient:      p.shippingAddress,
      customer_email: p.customerEmail,
      order_items:    orderItems
    })
  });
  const data = await res.json();
  if (!res.ok) throw new Error('Printful: ' + (data?.error?.message || JSON.stringify(data)));
  return { podOrderId: data?.data?.id, raw: data };
}

async function submitToApliiq(p) {
  const lineItems = p.items.map((item) => ({
    product_sku: mapToApliiqSku(item),
    quantity:    item.qty,
    artwork: [{ location: 'full_back', image_url: p.printFileUrl, width_inches: 12, height_inches: 14 }]
  }));

  const res = await fetch('https://api.apliiq.com/v1/orders', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${p.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      external_id: p.orderId,
      shipping:    p.shippingAddress,
      customer:    { email: p.customerEmail },
      line_items:  lineItems,
      metadata:    { thread_buyer_code: p.referralCode }
    })
  });
  const data = await res.json();
  if (!res.ok) throw new Error('Apliiq: ' + (data.message || JSON.stringify(data)));
  return { podOrderId: data.id, raw: data };
}

function mapToPrintfulVariantId(item) {
  const size = item.size || 'M';
  // Bella + Canvas 4719 Unisex Oversized Heavyweight Hoodie variants
  const map = {
    'Phantom Black':  { S: 22958, M: 22960, L: 22962, XL: 22964, '2XL': 22966, '3XL': 22968 },  // Printful: Black
    'Midnight Navy':  { S: 22987, M: 22988, L: 22989, XL: 22990, '2XL': 22991, '3XL': 22992 },  // Printful: Navy
    'Ember Crimson':  { S: 22981, M: 22982, L: 22983, XL: 22984, '2XL': 22985, '3XL': 22986 },  // Printful: Maroon
    'Forest Shadow':  { S: 22970, M: 22972, L: 22974, XL: 22976, '2XL': 22978, '3XL': 22980 },  // Printful: Forest
    'Ash Stone':      { S: 22951, M: 22952, L: 22953, XL: 22954, '2XL': 22955, '3XL': 22956 },  // Printful: Asphalt
    'Ivory Pure':     { S: 23005, M: 23006, L: 23007, XL: 23008, '2XL': 23009, '3XL': 23010 },  // Printful: White
  };
  return map[item.name]?.[size] || 0;
}

function mapToApliiqSku(item) {
  const map = {
    'Phantom Black':  'IND4000-BLK',
    'Midnight Navy':  'IND4000-NVY',
    'Ember Crimson':  'IND4000-RED',
    'Forest Shadow':  'IND4000-GRN',
    'Ash Stone':      'IND4000-GRY',
    'Void Purple':    'IND4000-PUR',
  };
  return (map[item.name] || 'IND4000-BLK') + '-' + (item.size || 'M');
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}
