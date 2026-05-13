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
  stripePublishableKey: 'pk_test_51TWgQY2QT4x5CZb3vq2cvn7Ppikhuth0V9C2T8T4s0uaK2ZGVokmaA60AWnB9eGOnQL3Pia6GsmyltLS4gGXqedi003oqW1Oza',  // starts with pk_test_ or pk_live_

  // ─── Stripe Checkout Edge Function ─────────────────────────────────────────
  // After deploying the Supabase Edge Function (see edge-function.js),
  // paste the function URL here.
  // Format: https://[YOUR_PROJECT_REF].supabase.co/functions/v1/create-checkout
  stripeFunctionUrl: 'YOUR_EDGE_FUNCTION_URL',

  // ─── Admin ──────────────────────────────────────────────────────────────────
  // Password to access /admin.html  — change this to something secure!
  adminPassword: 'thread_admin_2024',
};
