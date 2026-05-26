/**
 * THREAD Supabase Edge Function: send-recovery-emails
 *
 * Deploy as function name: send-recovery-emails
 *
 * Required Supabase secrets:
 *   SUPABASE_URL              = https://xxxx.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY = service_role key
 *   RESEND_API_KEY            = re_...
 *
 * Called from the admin panel to send 20% off recovery emails to users
 * who signed up but never completed a purchase.
 * Generates a unique single-use promo code per user and stores it in
 * the user_promo_codes table.
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { dryRun = false } = req.method === 'POST' ? await req.json().catch(() => ({})) : {};

    const supabaseUrl  = mustEnv('SUPABASE_URL');
    const serviceKey   = mustEnv('SUPABASE_SERVICE_ROLE_KEY');
    const resendKey    = mustEnv('RESEND_API_KEY');

    /* ── 1. Get eligible users (signed up, no paid order, no existing code) ── */
    const usersRes = await fetch(
      `${supabaseUrl}/rest/v1/rpc/get_users_without_orders`,
      {
        method: 'POST',
        headers: {
          apikey:         serviceKey,
          Authorization:  `Bearer ${serviceKey}`,
          'Content-Type': 'application/json',
        },
        body: '{}',
      }
    );
    const users = await usersRes.json();

    if (!Array.isArray(users) || !users.length) {
      return json({ sent: 0, message: 'No eligible users found.' });
    }

    if (dryRun) {
      return json({ sent: 0, eligible: users.length, users: users.map(u => u.email), dryRun: true });
    }

    /* ── 2. Generate codes + send emails ── */
    let sent = 0;
    const errors = [];

    for (const user of users) {
      try {
        const code = generateCode();

        /* Store code in Supabase */
        const insertRes = await fetch(`${supabaseUrl}/rest/v1/user_promo_codes`, {
          method: 'POST',
          headers: {
            apikey:         serviceKey,
            Authorization:  `Bearer ${serviceKey}`,
            'Content-Type': 'application/json',
            Prefer:         'return=minimal',
          },
          body: JSON.stringify({
            user_id:      user.user_id,
            email:        user.email,
            code,
            discount_pct: 20,
          }),
        });

        if (!insertRes.ok) {
          const err = await insertRes.text();
          errors.push({ email: user.email, error: 'DB insert failed: ' + err });
          continue;
        }

        /* Send email via Resend */
        const emailRes = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization:  `Bearer ${resendKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from:    'THREAD <contact@mythread.shop>',
            to:      [user.email],
            subject: 'You left something behind 👕 — here\'s 20% off',
            html:    buildEmailHtml(user.name || user.email.split('@')[0], code),
          }),
        });

        if (!emailRes.ok) {
          const err = await emailRes.text();
          errors.push({ email: user.email, error: 'Email send failed: ' + err });
          continue;
        }

        sent++;
      } catch (e) {
        errors.push({ email: user.email, error: e.message });
      }
    }

    return json({ sent, eligible: users.length, errors });

  } catch (err) {
    console.error('[send-recovery-emails] error:', err.message);
    return json({ error: err.message }, 400);
  }
});

/* ─── Code generator ────────────────────────────────────────────────────── */
function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let suffix = '';
  for (let i = 0; i < 6; i++) suffix += chars[Math.floor(Math.random() * chars.length)];
  return 'BACK20' + suffix;
}

/* ─── Email HTML template ───────────────────────────────────────────────── */
function buildEmailHtml(name, code) {
  const firstName = name.split(' ')[0] || 'there';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>20% off — THREAD</title>
</head>
<body style="margin:0;padding:0;background:#0a0a12;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">

  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a12;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">

          <!-- Logo -->
          <tr>
            <td align="center" style="padding-bottom:32px;">
              <span style="font-size:28px;font-weight:900;letter-spacing:-1px;color:#ffffff;">
                THREAD<span style="color:#7c3aed;">.</span>
              </span>
            </td>
          </tr>

          <!-- Card -->
          <tr>
            <td style="background:#13131f;border:1px solid rgba(255,255,255,0.08);border-radius:20px;padding:40px 36px;">

              <!-- Headline -->
              <p style="margin:0 0 8px;font-size:13px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#7c3aed;">
                JUST FOR YOU
              </p>
              <h1 style="margin:0 0 16px;font-size:30px;font-weight:800;color:#ffffff;line-height:1.15;letter-spacing:-0.5px;">
                Hey ${firstName}, you left<br>something behind.
              </h1>
              <p style="margin:0 0 28px;font-size:16px;color:#888;line-height:1.65;">
                You signed up for THREAD but never grabbed your piece.
                We get it — life gets busy. So we're giving you
                <strong style="color:#ffffff;">20% off your entire order</strong>,
                on us. No strings.
              </p>

              <!-- Promo code box -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
                <tr>
                  <td style="background:#0a0a12;border:2px dashed rgba(124,58,237,0.5);border-radius:14px;padding:20px;text-align:center;">
                    <p style="margin:0 0 6px;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#666;">
                      Your code
                    </p>
                    <p style="margin:0 0 6px;font-size:30px;font-weight:900;letter-spacing:3px;color:#a78bfa;font-family:'Courier New',monospace;">
                      ${code}
                    </p>
                    <p style="margin:0;font-size:12px;color:#555;">
                      One-time use · 20% off your entire order
                    </p>
                  </td>
                </tr>
              </table>

              <!-- What is THREAD reminder -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;background:rgba(124,58,237,0.07);border:1px solid rgba(124,58,237,0.15);border-radius:12px;padding:0;">
                <tr>
                  <td style="padding:18px 20px;">
                    <p style="margin:0 0 12px;font-size:13px;font-weight:700;color:#ffffff;">
                      Quick reminder — what is THREAD?
                    </p>
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="padding:4px 0;font-size:13px;color:#888;">👕 &nbsp;Every piece ships with a unique QR code</td>
                      </tr>
                      <tr>
                        <td style="padding:4px 0;font-size:13px;color:#888;">📲 &nbsp;Someone scans yours → taken to the THREAD store</td>
                      </tr>
                      <tr>
                        <td style="padding:4px 0;font-size:13px;color:#888;">💸 &nbsp;They buy → you earn a commission. Every time.</td>
                      </tr>
                      <tr>
                        <td style="padding:4px 0;font-size:13px;color:#888;">📊 &nbsp;Track every scan live in your dashboard</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- CTA Button -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
                <tr>
                  <td align="center">
                    <a href="https://mythread.shop/index.html#shop"
                       style="display:inline-block;background:#7c3aed;color:#ffffff;text-decoration:none;font-size:16px;font-weight:800;letter-spacing:0.2px;padding:16px 40px;border-radius:50px;">
                      Shop &amp; Use My 20% Off →
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin:0;font-size:12px;color:#444;text-align:center;line-height:1.6;">
                Enter <strong style="color:#666;">${code}</strong> at checkout.
                This code is yours — one use, no expiry.
              </p>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="padding-top:28px;">
              <p style="margin:0 0 6px;font-size:12px;color:#333;">
                <a href="https://mythread.shop" style="color:#555;text-decoration:none;">mythread.shop</a>
                &nbsp;·&nbsp;
                <a href="https://mythread.shop/terms.html" style="color:#555;text-decoration:none;">Terms</a>
              </p>
              <p style="margin:0;font-size:11px;color:#2a2a3a;">
                You're receiving this because you created a THREAD account.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>

</body>
</html>`;
}

/* ─── Helpers ───────────────────────────────────────────────────────────── */
function mustEnv(key) {
  const v = Deno.env.get(key);
  if (!v) throw new Error(`Missing env var: ${key}`);
  return v;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
