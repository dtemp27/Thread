/**
 * THREAD Store — Configuration
 *
 * Step 1: Create accounts at supabase.com, stripe.com
 * Step 2: Replace the placeholder values below with your real keys
 * Step 3: Deploy to Vercel (drag-and-drop your folder at vercel.com/new)
 *
 * Until you fill these in, the site runs in LOCAL mode (localStorage only).
 * Everything still works locally — just no real payments or cloud database.
 */

window.THREAD_CONFIG = {
  // ─── Supabase ───────────────────────────────────────────────────────────────
  // Get these from: supabase.com → your project → Settings → API
  supabaseUrl:      'https://ermatmianwpfzvhmpdgn.supabase.co',       // e.g. https://abcxyz.supabase.co
  supabaseAnonKey:  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVybWF0bWlhbndwZnp2aG1wZGduIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg2OTIwMTAsImV4cCI6MjA5NDI2ODAxMH0.NAgaESmpSwevaWBh1REiXjxTaF05-ccWVxfgS3B7Mgg',  // "anon public" key

  // ─── Stripe ─────────────────────────────────────────────────────────────────
  // Get this from: dashboard.stripe.com → Developers → API keys → Publishable key
  stripePublishableKey: 'pk_live_51TWgQPE11iNHdIansld1ffbfV41o1ijODTRxJBz2HumNwSySf8LW0hCrRhVteGrw6sH1rj4cK6RSpNAUJ2YvLpAo00zBBXMTPI',  // starts with pk_test_ or pk_live_

  // ─── Stripe Checkout Edge Function ─────────────────────────────────────────
  // After deploying the Supabase Edge Function (see edge-function.js),
  // paste the function URL here.
  // Format: https://[YOUR_PROJECT_REF].supabase.co/functions/v1/create-checkout
  stripeFunctionUrl: 'https://ermatmianwpfzvhmpdgn.supabase.co/functions/v1/create-checkout',

  // ─── POD (Print-on-Demand) Edge Function ───────────────────────────────────
  // After deploying pod-edge-function.js, paste the URL below.
  // Until set, POD submission falls back to the local stub (logs only).
  // Format: https://[YOUR_PROJECT_REF].supabase.co/functions/v1/submit-pod-order
  podFunctionUrl: 'https://ermatmianwpfzvhmpdgn.supabase.co/functions/v1/rapid-processor',

  // Which POD service to use. Must also match POD_SERVICE in Supabase secrets.
  podService: 'printful',   // 'apliiq' | 'printful' | 'printify'

  // ─── Admin ──────────────────────────────────────────────────────────────────
  // SHA-256 hash of the admin password. Never store the plaintext here.
  // To change: run `echo -n 'yourpassword' | sha256sum` and paste the result.
  adminPasswordHash: '6179a4c2031b16c6bf4909694150941d8ebdbc6133b8099956c69b0a94fb59f3',
};
