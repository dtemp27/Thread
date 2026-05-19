/**
 * THREAD Supabase Edge Function: printful-webhook
 *
 * Listens for Printful delivery events. When Printful confirms a package
 * is delivered, this function:
 *   1. Finds the matching order in Supabase by Printful's order ID
 *   2. Marks the order status = 'delivered' and stamps delivered_at
 *   3. Sets clears_at = delivered_at + 72 hours on the linked referral scan
 *      so the referrer's commission unlocks automatically after the hold
 *
 * ─────────────────────────────────────────────────────────────────────────
 * DEPLOY STEPS:
 *   1. supabase.com → your project → Edge Functions → New function
 *   2. Name it exactly: printful-webhook
 *   3. Paste everything below into the editor and click Deploy
 *   4. Settings → Secrets, add:
 *        PRINTFUL_WEBHOOK_SECRET = (see step 5 below)
 *        SUPABASE_URL            = (auto-available in edge functions)
 *        SUPABASE_SERVICE_ROLE_KEY = (your service role key — NOT the anon key)
 *   5. In Printful dashboard → Stores → your store → Webhooks → Add webhook:
 *        URL:    https://ermatmianwpfzvhmpdgn.supabase.co/functions/v1/printful-webhook
 *        Events: ✅ Package delivered
 *        Secret: make up any string, e.g. "thread_pf_secret_2026" — save it as PRINTFUL_WEBHOOK_SECRET
 *   6. Click "Send test event" in Printful to verify it's working
 *      (check Edge Function logs: Supabase → Edge Functions → printful-webhook → Logs)
 * ─────────────────────────────────────────────────────────────────────────
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const HOLD_HOURS = 72;
const HOLD_MS    = HOLD_HOURS * 60 * 60 * 1000;

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-printful-signature',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST')   return json({ error: 'Method not allowed' }, 405);

  const rawBody = await req.text();

  try {
    // ── 1. Verify Printful signature ────────────────────────────────────────
    const secret    = Deno.env.get('PRINTFUL_WEBHOOK_SECRET');
    const signature = req.headers.get('x-printful-signature');
    if (secret && signature) {
      const key       = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
      const sigBytes  = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
      const expected  = Array.from(new Uint8Array(sigBytes)).map(b => b.toString(16).padStart(2, '0')).join('');
      if (signature !== expected) {
        console.warn('[printful-webhook] signature mismatch — rejected');
        return json({ error: 'Invalid signature' }, 401);
      }
    }

    const event = JSON.parse(rawBody);
    console.log('[printful-webhook] event type:', event.type);

    // ── 2. Only handle package_delivered ────────────────────────────────────
    if (event.type !== 'package_delivered') {
      return json({ received: true, action: 'ignored' });
    }

    // ── 3. Extract Printful order ID ────────────────────────────────────────
    // Printful sends the order as event.data.order — id is their internal ID,
    // external_id is the order_number you passed when creating the order (TH-XXXXX)
    const pfOrderId   = String(event.data?.order?.id || '');
    const externalId  = String(event.data?.order?.external_id || '');

    if (!pfOrderId && !externalId) {
      throw new Error('Printful event missing order id');
    }

    console.log('[printful-webhook] delivered — pfOrderId:', pfOrderId, 'externalId:', externalId);

    // ── 4. Init Supabase with service role (bypasses RLS) ───────────────────
    const sb = createClient(
      Deno.env.get('SUPABASE_URL'),
      Deno.env.get('SERVICE_ROLE_KEY'),
    );

    // ── 5. Find the order in our DB ─────────────────────────────────────────
    // Try matching on pod_order_id first, fall back to order_number
    let order = null;

    if (pfOrderId) {
      const { data } = await sb.from('orders').select('id, referral_code, status')
        .eq('pod_order_id', pfOrderId).maybeSingle();
      order = data;
    }
    if (!order && externalId) {
      const { data } = await sb.from('orders').select('id, referral_code, status')
        .eq('order_number', externalId).maybeSingle();
      order = data;
    }

    if (!order) {
      console.warn('[printful-webhook] no matching order found for pfOrderId:', pfOrderId, 'externalId:', externalId);
      // Return 200 so Printful doesn't keep retrying — we just don't have this order
      return json({ received: true, action: 'order_not_found' });
    }

    if (order.status === 'delivered') {
      console.log('[printful-webhook] order already marked delivered — skipping');
      return json({ received: true, action: 'already_delivered' });
    }

    // ── 6. Stamp delivered_at on the order ──────────────────────────────────
    const deliveredAt = new Date().toISOString();
    const clearsAt    = new Date(Date.now() + HOLD_MS).toISOString();

    await sb.from('orders').update({
      status:       'delivered',
      delivered_at: deliveredAt,
    }).eq('id', order.id);

    console.log('[printful-webhook] order', order.id, 'marked delivered at', deliveredAt);

    // ── 7. Set clears_at on linked pending referral scan ────────────────────
    // The referral scan is linked by order_id (set when markConverted runs at checkout)
    const { data: updatedScans, error: scanErr } = await sb.from('referral_scans')
      .update({ clears_at: clearsAt })
      .eq('order_id', order.id)
      .eq('status', 'pending')
      .select('id, commission, referral_code');

    if (scanErr) {
      console.error('[printful-webhook] scan update error:', scanErr.message);
    } else {
      console.log('[printful-webhook] set clears_at on', updatedScans?.length || 0, 'referral scan(s) — clears at', clearsAt);
    }

    return json({
      received:    true,
      action:      'delivered',
      order_id:    order.id,
      clears_at:   clearsAt,
      scans_updated: updatedScans?.length || 0,
    });

  } catch (err) {
    console.error('[printful-webhook] error:', err.message);
    return json({ error: err.message }, 400);
  }
});

/* ── Helpers ──────────────────────────────────────────────────────────────── */
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
