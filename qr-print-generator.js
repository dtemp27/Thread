/**
 * THREAD — QR + Logo Print File Generator
 * ─────────────────────────────────────────────────────────────────────────────
 * Generates a print-ready PNG (high-res, transparent background) combining
 *   1. THREAD wordmark / logo
 *   2. The customer's UNIQUE referral QR code (links back to thread-dun.vercel.app/?ref=CODE)
 *   3. A small "scan to shop · earn rewards" tagline
 *
 * The resulting PNG (base64) is what gets sent to the POD service (Apliiq,
 * Printful, Printify) as the artwork file when an order is placed.
 *
 * Dependencies:
 *   - qrious (loaded via CDN in checkout.html). Falls back to a stub
 *     pattern if the library hasn't loaded.
 *
 * Public API:
 *   window.ThreadPrint.generate({ referralCode, size })  → { dataUrl, blob }
 *   window.ThreadPrint.sendToPOD(payload)                → stubbed API call
 *
 * Print-area sizing assumption:
 *   Most POD back prints are 12"x14" at 150–300 DPI.
 *   Default output = 2400x2800 px (≈ 200 DPI on a 12"x14" area) — fine for
 *   both Apliiq and Printful.
 */

(function () {
  'use strict';

  /* ── Config ──────────────────────────────────────────────────────────── */
  const DEFAULT_SIZE        = { w: 2400, h: 2800 };          // print canvas
  const REFERRAL_URL_BASE   = 'https://thread-dun.vercel.app/?ref=';
  const LOGO_TEXT           = 'THREAD';
  const TAGLINE             = 'SCAN TO SHOP · EARN REWARDS';

  /* ── QR generation (uses qrious if loaded; else stub) ───────────────── */
  function generateQRCanvas(text, pixelSize) {
    // Real QR via qrious — high error correction so the logo overlay is safe
    if (window.QRious) {
      const tmp = document.createElement('canvas');
      new QRious({
        element: tmp,
        value:   text,
        size:    pixelSize,
        level:   'H',           // ~30% error correction → safe to overlay logo
        padding: 0,
        foreground: '#000',
        background: '#fff'
      });
      return tmp;
    }

    // Fallback stub (visual placeholder) if qrious failed to load.
    // NOT scannable — only used so the UI/preview doesn't break.
    console.warn('[ThreadPrint] qrious not loaded — using placeholder pattern');
    const c = document.createElement('canvas');
    c.width = c.height = pixelSize;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, pixelSize, pixelSize);
    ctx.fillStyle = '#000';
    const cells = 25;
    const cs    = pixelSize / cells;
    let seed    = 0;
    for (let i = 0; i < text.length; i++) seed = (seed * 31 + text.charCodeAt(i)) >>> 0;
    function rnd() { seed = (seed * 1103515245 + 12345) >>> 0; return (seed >>> 16) / 65535; }
    for (let r = 0; r < cells; r++)
      for (let col = 0; col < cells; col++)
        if (rnd() > 0.5) ctx.fillRect(col * cs, r * cs, cs, cs);
    return c;
  }

  /* ── Compose the full print file (logo + QR + tagline) ──────────────── */
  function generate({ referralCode, size = DEFAULT_SIZE } = {}) {
    if (!referralCode) throw new Error('referralCode required');

    const W = size.w, H = size.h;
    const canvas = document.createElement('canvas');
    canvas.width  = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');

    // Transparent background (POD services handle the garment color themselves)
    ctx.clearRect(0, 0, W, H);

    /* — 1. THREAD wordmark at top — */
    ctx.fillStyle    = '#fff';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'top';
    ctx.font         = '900 360px "Space Grotesk", "Helvetica Neue", Arial, sans-serif';
    ctx.fillText(LOGO_TEXT, W / 2, 120);

    // Thin underline beneath logo
    ctx.fillRect(W / 2 - 480, 530, 960, 8);

    /* — 2. QR code, centered, large — */
    const qrPx = Math.floor(W * 0.7);
    const qrX  = (W - qrPx) / 2;
    const qrY  = 720;

    // White card behind QR (so it's scannable on dark hoodies)
    const pad = 60;
    ctx.fillStyle = '#fff';
    roundRect(ctx, qrX - pad, qrY - pad, qrPx + pad * 2, qrPx + pad * 2, 40);
    ctx.fill();

    const qrCanvas = generateQRCanvas(REFERRAL_URL_BASE + referralCode, qrPx);
    ctx.drawImage(qrCanvas, qrX, qrY);

    /* — 3. Tagline + referral code beneath QR — */
    ctx.fillStyle    = '#fff';
    ctx.font         = '700 90px "Space Mono", monospace';
    ctx.textBaseline = 'top';
    ctx.fillText(TAGLINE, W / 2, qrY + qrPx + pad + 100);

    ctx.font = '500 70px "Space Mono", monospace';
    ctx.fillStyle = '#bbb';
    ctx.fillText('CODE: ' + referralCode, W / 2, qrY + qrPx + pad + 230);

    /* — Output — */
    const dataUrl = canvas.toDataURL('image/png');
    return { dataUrl, canvas, width: W, height: H, referralCode };
  }

  /* ── Tiny rounded-rect helper ───────────────────────────────────────── */
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y,     x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x,     y + h, r);
    ctx.arcTo(x,     y + h, x,     y,     r);
    ctx.arcTo(x,     y,     x + w, y,     r);
    ctx.closePath();
  }

  /* ── Upload PNG to Supabase Storage (so the POD service can fetch it) ─ */
  /**
   * Uploads the print file to Supabase Storage and returns a public URL that
   * Apliiq/Printful can hotlink for the print job. Requires a `print-files`
   * bucket in Supabase Storage with public read access.
   */
  async function uploadToStorage(dataUrl, orderId, referralCode) {
    if (!window.DB || !window.DB.isLive || !window.DB.isLive()) {
      console.log('[ThreadPrint] Supabase not live — skipping upload');
      return null;
    }
    const sb = window.DB.getSB();
    if (!sb) return null;

    // Convert data URL → Blob
    const res  = await fetch(dataUrl);
    const blob = await res.blob();

    const path = `${orderId}-${referralCode}.png`;
    const { data, error } = await sb.storage
      .from('print-files')
      .upload(path, blob, { contentType: 'image/png', upsert: true });

    if (error) {
      console.warn('[ThreadPrint] Upload failed:', error.message);
      return null;
    }

    const { data: pub } = sb.storage.from('print-files').getPublicUrl(path);
    return pub?.publicUrl || null;
  }

  /* ── POD API submission (stubbed — wire in your real key when ready) ── */
  /**
   * Sends the order to whichever POD service you choose. For now this is
   * a stub that logs + returns a mock response. To go live:
   *
   *   1. Pick a service: 'apliiq' | 'printful' | 'printify'
   *   2. Move this call SERVER-SIDE (Supabase edge function) so your
   *      API key isn't exposed in the browser.
   *   3. Replace the stub body with the real fetch().
   *
   * Apliiq:    POST https://api.apliiq.com/orders         (Bearer token)
   * Printful:  POST https://api.printful.com/orders       (Bearer token)
   * Printify:  POST https://api.printify.com/v1/shops/{}  (Bearer token)
   */
  async function sendToPOD({
    orderId,
    referralCode,
    items,
    customerEmail,
    shippingAddress,
    printFileUrl
  }) {
    const cfg     = window.THREAD_CONFIG || {};
    const service = cfg.podService || 'apliiq';

    // No edge function URL configured yet → stub mode (just logs)
    if (!cfg.podFunctionUrl || cfg.podFunctionUrl.includes('YOUR_')) {
      console.log('[ThreadPrint] POD stub (no podFunctionUrl set)', {
        service, orderId, referralCode, itemCount: items?.length, printFileUrl
      });
      return { ok: true, stub: true, podOrderId: 'POD-' + orderId, service };
    }

    // Real call → Supabase edge function (which holds the API key server-side)
    try {
      const res = await fetch(cfg.podFunctionUrl, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          orderId, referralCode, items,
          customerEmail, shippingAddress, printFileUrl
        })
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        console.warn('[ThreadPrint] POD API error:', data.error || res.status);
        return { ok: false, error: data.error || ('HTTP ' + res.status) };
      }
      console.log('[ThreadPrint] POD order submitted:', data);
      return data;
    } catch (err) {
      console.warn('[ThreadPrint] POD request failed:', err.message);
      return { ok: false, error: err.message };
    }
  }

  /* ── Expose ────────────────────────────────────────────────────────── */
  window.ThreadPrint = { generate, uploadToStorage, sendToPOD };

})();
