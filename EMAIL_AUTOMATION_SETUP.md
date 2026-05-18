# THREAD Order Email Automation

Goal: after a Stripe payment succeeds, the customer gets an order confirmation from:

```txt
THREAD <contact@mythread.shop>
```

This uses:

- Stripe Checkout for payment
- Stripe webhook for the reliable "payment succeeded" signal
- Supabase Edge Function for server-side automation
- Resend for sending the actual email

Do not send automated emails directly from Google Workspace/Gmail. Keep Google Workspace as the inbox for `contact@mythread.shop`; use Resend for transactional emails.

## 1. Verify mythread.shop in Resend

1. Go to `https://resend.com`
2. Create an account
3. Go to Domains
4. Add `mythread.shop`
5. Add the DNS records Resend gives you inside Vercel domain DNS
6. Wait until Resend shows the domain as verified
7. Create an API key, usually starts with `re_`

## 2. Run the Supabase SQL migration

In Supabase:

1. SQL Editor
2. New query
3. Paste the contents of `email-automation-schema.sql`
4. Run

This adds `order_number` and `email_sent_at` to the `orders` table.

## 3. Update the existing create-checkout function

In Supabase:

1. Edge Functions
2. Open `create-checkout`
3. Replace all code with the contents of `edge-function.js`
4. Deploy

Keep JWT verification OFF for this function.

## 4. Create the new stripe-webhook function

In Supabase:

1. Edge Functions
2. Deploy new function
3. Name it exactly:

```txt
stripe-webhook
```

4. Paste the contents of `stripe-webhook-email-function.js`
5. Deploy

Keep JWT verification OFF for this function too. Stripe has its own signature verification.

## 5. Add Supabase Edge Function secrets

In Supabase Edge Function secrets, add:

```txt
STRIPE_SECRET_KEY=sk_test_...
RESEND_API_KEY=re_...
ORDER_EMAIL_FROM=THREAD <contact@mythread.shop>
ORDER_ADMIN_EMAIL=contact@mythread.shop
```

Also make sure this exists:

```txt
SUPABASE_SERVICE_ROLE_KEY=your Supabase service_role key
```

You can get the service role key from Supabase project settings. Never put this key in `config.js` or GitHub.

You will add `STRIPE_WEBHOOK_SECRET` after creating the Stripe webhook in the next step.

## 6. Create the Stripe webhook endpoint

In Stripe:

1. Developers
2. Webhooks
3. Add endpoint
4. Endpoint URL:

```txt
https://ermatmianwpfzvhmpdgn.supabase.co/functions/v1/stripe-webhook
```

5. Select event:

```txt
checkout.session.completed
```

6. Save
7. Reveal/copy the signing secret. It starts with `whsec_`

Back in Supabase Edge Function secrets, add:

```txt
STRIPE_WEBHOOK_SECRET=whsec_...
```

## 7. Upload updated site files to GitHub

Upload and commit these files:

- `checkout.js`
- `db.js`
- `admin.js`
- `edge-function.js`
- `stripe-webhook-email-function.js`
- `email-automation-schema.sql`
- `EMAIL_AUTOMATION_SETUP.md`

Vercel will redeploy automatically.

## 8. Test

1. Go to `https://mythread.shop` or your Vercel URL
2. Add a hoodie to cart
3. Checkout with Stripe test card:

```txt
4242 4242 4242 4242
Any future expiry
Any CVC
```

4. Confirm the email arrives from `contact@mythread.shop`
5. Check `/admin` to confirm the paid order appears

