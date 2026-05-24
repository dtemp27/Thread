# THREAD Backend Setup — Order Confirmation Emails

This guide gets your order confirmation emails live from `contact@mythread.shop`.
When a customer pays through Stripe, they automatically receive a branded email with their order ID, items, total, and QR commission info.

---

## Services You Need

| Service | What It Does | Cost |
|---------|-------------|------|
| **Resend** | Sends emails from contact@mythread.shop | Free up to 3,000/mo |
| **Supabase** | Already set up — stores orders + runs edge functions | Free tier |
| **Stripe** | Already set up — processes payments | Already paying fees |

---

## Step 1 — Set Up Resend (Email Sender)

1. Go to **[resend.com](https://resend.com)** → Create a free account
2. In the Resend dashboard → **Domains** → **Add Domain**
3. Enter: `mythread.shop`
4. Resend shows you **4 DNS records** to add. Go to wherever your domain DNS is managed (GoDaddy, Namecheap, Cloudflare, etc.) and add all 4 records exactly as shown
5. Click **Verify** in Resend — wait 5–10 minutes for DNS to propagate
6. Once verified → go to **API Keys** → **Create API Key**
   - Name it: `thread-email`
   - Permission: **Sending access**
7. **Copy the API key** — starts with `re_` — you only see it once

---

## Step 2 — Install the Supabase CLI

Open your terminal and run:

```bash
npm install -g supabase
```

Then login:

```bash
supabase login
```

Then link to your project (your project ref is `ermatmianwpfzvhmpdgn`):

```bash
supabase link --project-ref ermatmianwpfzvhmpdgn
```

It will ask for your **database password** — find it in Supabase dashboard → Settings → Database → Database password.

---

## Step 3 — Deploy the Email Edge Function

Create the function folder:

```bash
supabase functions new stripe-webhook
```

This creates `supabase/functions/stripe-webhook/index.ts`.

Open that file and **replace all its contents** with everything from:
```
clothing-store/stripe-webhook-email-function.js
```
(just copy-paste the entire file contents)

Then deploy it:

```bash
supabase functions deploy stripe-webhook --no-verify-jwt
```

You'll see a URL like:
```
https://ermatmianwpfzvhmpdgn.supabase.co/functions/v1/stripe-webhook
```

**Save that URL** — you need it for Step 4.

---

## Step 4 — Set Up the Stripe Webhook

1. Go to **[dashboard.stripe.com](https://dashboard.stripe.com)**
2. **Developers** → **Webhooks** → **Add endpoint**
3. **Endpoint URL**: paste the URL from Step 3:
   ```
   https://ermatmianwpfzvhmpdgn.supabase.co/functions/v1/stripe-webhook
   ```
4. **Events to listen to** → click **Select events** → find and check:
   - `checkout.session.completed`
5. Click **Add endpoint**
6. On the webhook page → click **Reveal** next to **Signing secret**
7. **Copy the signing secret** — starts with `whsec_`

---

## Step 5 — Set the Supabase Secrets

Run these commands one by one in your terminal. Replace the placeholder values with your real keys:

```bash
# Your Stripe SECRET key (NOT the publishable key — starts with sk_live_ or sk_test_)
# Find it: Stripe dashboard → Developers → API keys → Secret key (click Reveal)
supabase secrets set STRIPE_SECRET_KEY=sk_live_REPLACE_WITH_YOUR_KEY

# The webhook signing secret from Step 4 (starts with whsec_)
supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_REPLACE_WITH_YOUR_KEY

# Your Resend API key from Step 1 (starts with re_)
supabase secrets set RESEND_API_KEY=re_REPLACE_WITH_YOUR_KEY

# The "from" address for customer emails (exactly as shown)
supabase secrets set ORDER_EMAIL_FROM="THREAD <contact@mythread.shop>"

# Where you receive a BCC of every order (your email)
supabase secrets set ORDER_ADMIN_EMAIL=contact@mythread.shop
```

Verify your secrets are set:

```bash
supabase secrets list
```

You should see all 5 listed.

---

## Step 6 — Test It

1. Go to your store and add a product to the cart
2. Complete a test purchase using Stripe test card: `4242 4242 4242 4242` (any future expiry, any CVV)
3. After payment, check the customer email inbox
4. Also check `contact@mythread.shop` — you get a BCC of every order

If the email doesn't arrive within 2 minutes:
- Check Supabase Edge Function logs: **Supabase dashboard → Edge Functions → stripe-webhook → Logs**
- Check Stripe webhook logs: **Stripe dashboard → Developers → Webhooks → your endpoint → Recent deliveries**

---

## What the Customer Receives

The email is sent from **THREAD <contact@mythread.shop>** with subject:

> Your THREAD order TH-XXXXX-XXXX is confirmed ✓

It includes:
- ✅ Order number (prominently displayed)
- ✅ Each item: name, type (Hoodie/Tee), size, qty, price
- ✅ Subtotal / discount / shipping (FREE) / **Total**
- ✅ Shipping address
- ✅ Expected ship timeline (1–2 days processing, 2–4 days shipping)
- ✅ QR commission info (20% → 25% → 30% tiers)
- ✅ Link to their dashboard
- ✅ Your admin email gets BCC'd on every order

---

## Troubleshooting

**"Resend domain not verified"**
→ DNS records take up to 48 hours to propagate. Check your DNS provider and make sure all 4 records are added exactly as shown in Resend.

**"Missing secret: STRIPE_SECRET_KEY"**
→ Run the `supabase secrets set` command again for that key.

**Stripe webhook shows "Signature verification failed"**
→ Make sure `STRIPE_WEBHOOK_SECRET` matches the webhook endpoint's signing secret (not a different webhook's secret).

**Emails going to spam**
→ Resend domain verification must be complete with DKIM and SPF records. All 4 records must be green in Resend's domain dashboard.

**Function times out**
→ Supabase free tier has a 2-second CPU limit. The email function is lightweight enough to run well within it.
