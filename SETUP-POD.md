# THREAD — Print-on-Demand Setup Checklist

The code is wired up. You need to do 3 things in your browser to make it go live.
Each step is dead simple — just clicks, copies, pastes. About 15 minutes total.

---

## Step 1 — Supabase: Create the print-files storage bucket  (~2 min)

1. Go to https://supabase.com/dashboard → open your THREAD project.
2. Left sidebar → **Storage**.
3. Click **New bucket**.
4. Name: `print-files`
5. Toggle **Public bucket** ON. (POD services need to fetch the PNG by URL.)
6. Click **Create bucket**.

Done. Every order's unique QR PNG will land here.

---

## Step 2 — Supabase: Run the updated SQL schema  (~1 min)

1. Same Supabase project → left sidebar → **SQL Editor**.
2. Click **New query**.
3. Open the file `supabase-schema.sql` from your project folder.
4. Copy the entire contents → paste into the SQL editor.
5. Click **Run**.

The new `ALTER TABLE` lines add `print_file_url`, `buyer_qr_code`, `pod_service`,
and `pod_order_id` columns to your existing orders table. Safe to re-run.

---

## Step 3 — POD service: Create account & get API key  (~10 min)

Pick ONE — I recommended **Apliiq** for THREAD's brand. Printful is the
backup pick if Apliiq's onboarding is slow.

### Option A: Apliiq (recommended)

1. Go to https://www.apliiq.com → click **Start Selling** → create your account.
2. Once in the dashboard, set up your shop (brand name = THREAD, logo, etc.).
3. Go to **Dropship → API** (or contact Apliiq support to request API access).
4. Generate / copy your **API key**.
5. Add your products in the Apliiq catalog — pick the **IND4000 Heavyweight
   Pullover** in the colors you want (Phantom Black, Midnight Navy, etc.).
6. Note the SKU for each color/size combination — you'll paste these into
   `pod-edge-function.js` under `mapToApliiqSku()` later.

### Option B: Printful

1. Go to https://www.printful.com → Sign up.
2. Dashboard → **Settings → API → Create new API token**.
3. Copy the token.
4. Create your products in **Product catalog** → use the **Bella+Canvas 4719**
   for heavyweight, or **Cotton Heritage M2580** for mid-weight.
5. Note each variant ID (numeric) → paste into `mapToPrintfulVariantId()`.

---

## Step 4 — Supabase: Deploy the edge function  (~3 min)

1. Supabase dashboard → **Edge Functions** → **New function**.
2. Name: `submit-pod-order`
3. Open `pod-edge-function.js` from your project folder.
4. Copy EVERYTHING between the `/*` and `*/` fences (the actual edge function code).
5. Paste into the Supabase editor → click **Deploy**.
6. After it deploys, go to **Settings → Edge Functions → Secrets**.
7. Add three secrets:
   - `POD_SERVICE` = `apliiq` (or `printful`, or `printify`)
   - `POD_API_KEY` = (your API key from Step 3)
   - `POD_STORE_ID` = (only for Printify — your shop ID number)
8. Copy the function URL shown after deploy. It looks like:
   `https://ermatmianwpfzvhmpdgn.supabase.co/functions/v1/submit-pod-order`
9. Open `config.js` → confirm `podFunctionUrl` matches that URL.
   (I already pre-filled it — should be correct.)

---

## Step 5 — Test the full flow  (~2 min)

1. Visit your live site (https://thread-dun.vercel.app/).
2. Sign in (or sign up for a fresh test account).
3. Add a hoodie to cart → checkout → complete with a Stripe test card
   (`4242 4242 4242 4242`, any future date, any CVC).
4. After payment, open browser dev tools → Console tab.
5. Look for:
   - `[checkout] Print file generated for code XXXX (uploaded)`
   - `[ThreadPrint] POD order submitted: { podOrderId: ..., service: 'apliiq' }`
6. Go to Apliiq/Printful dashboard → confirm the test order appeared.

---

## Things I CAN'T do for you (and why)

- **Create your Apliiq/Printful account** → For security, I can't create
  accounts on your behalf. You do this once, takes 2 minutes.
- **Handle your API key** → I can't store, transmit, or paste sensitive
  credentials. You add it to Supabase secrets directly — it stays server-side
  and never touches the browser.
- **Click "Deploy" in Supabase** → I don't have access to your Supabase
  dashboard. You click Deploy; the code I wrote runs there.

Everything else (the code, the wiring, the edge function logic) is done.

---

## Troubleshooting

**"POD stub (no podFunctionUrl set)" in console**
You haven't deployed the edge function yet, or `config.js` still has a
placeholder URL. Re-do Step 4.

**"POD_API_KEY not configured" error**
The edge function deployed but the secret wasn't saved. Re-do Step 4.7.

**Print file URL is null in the order row**
The `print-files` storage bucket doesn't exist or isn't public. Re-do Step 1.

**Order appears in your DB but not on Apliiq**
Check the SKU map in `pod-edge-function.js` — the placeholder SKUs need to
match real products you created in your Apliiq catalog (Step 3.5).
