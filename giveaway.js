/* ─────────────────────────────────────────────────────────────────────────
   THREAD Giveaway Landing Page — giveaway.js
   Writes entries to Supabase `giveaway_entries` table.
   Source tracking via ?src= URL param (e.g. ?src=facebook, ?src=instagram).
───────────────────────────────────────────────────────────────────────── */
(async function () {
  'use strict';

  const OWNER_IPS = ['65.130.60.246', '187.199.28.205', '187.199.69.171'];

  /* ── Supabase client ── */
  const cfg = window.THREAD_CONFIG;
  const sb  = (cfg?.supabaseUrl && cfg.supabaseUrl !== 'YOUR_SUPABASE_URL' && window.supabase)
    ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey)
    : null;

  /* ── Ad source tracking ── */
  const urlParams = new URLSearchParams(window.location.search);
  const source    = (urlParams.get('src') || urlParams.get('source') || 'direct').slice(0, 50);

  /* ── Geo / IP ── */
  let geoCity = null;
  let geoIp   = null;
  try {
    const cached = sessionStorage.getItem('thread_geo');
    if (cached) {
      const g = JSON.parse(cached);
      geoCity = g.city || null;
      geoIp   = g.ip   || null;
    } else {
      const res = await fetch('https://ipapi.co/json/');
      if (res.ok) {
        const g = await res.json();
        geoCity = g.city || null;
        geoIp   = g.ip   || null;
        sessionStorage.setItem('thread_geo', JSON.stringify({ city: geoCity, ip: geoIp }));
      }
    }
  } catch (_) {}

  // Never store owner IPs
  if (OWNER_IPS.includes(geoIp)) { geoIp = null; geoCity = null; }

  /* ── Load live entry count ── */
  async function refreshCount() {
    if (!sb) return;
    try {
      const { data } = await sb.rpc('get_giveaway_count');
      const el = document.getElementById('entryCount');
      if (el && data !== null && data !== undefined) {
        el.textContent = Number(data).toLocaleString();
      }
    } catch (_) {}
  }
  refreshCount();

  /* ── Already entered? (restore success screen) ── */
  if (localStorage.getItem('thread_giveaway_entered')) {
    showSuccess(/* animate= */ false);
    return; // skip form binding
  }

  /* ── Form logic ── */
  const form    = document.getElementById('gwForm');
  const errEl   = document.getElementById('gwError');
  const btn     = document.getElementById('gwBtn');
  const btnText = btn?.querySelector('.btn-text');
  const btnLoad = btn?.querySelector('.btn-loader');

  if (!form) return;

  document.getElementById('gwName')?.addEventListener('input', () => { errEl.textContent = ''; });
  document.getElementById('gwEmail')?.addEventListener('input', () => { errEl.textContent = ''; });

  form.addEventListener('submit', async () => {
    const name  = (document.getElementById('gwName')?.value  || '').trim();
    const email = (document.getElementById('gwEmail')?.value || '').trim().toLowerCase();

    /* basic validation */
    if (!name) {
      errEl.textContent = 'Please enter your name.';
      document.getElementById('gwName')?.focus();
      return;
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errEl.textContent = 'Please enter a valid email address.';
      document.getElementById('gwEmail')?.focus();
      return;
    }

    /* loading state */
    setLoading(true);
    errEl.textContent = '';

    try {
      if (sb) {
        const { error } = await sb.from('giveaway_entries').insert({
          name,
          email,
          source,
          ip:   geoIp   || null,
          city: geoCity || null,
        });

        if (error) {
          /* duplicate email — treat as already entered */
          const isDuplicate =
            error.code === '23505'                     ||
            (error.message || '').includes('unique')   ||
            (error.message || '').includes('duplicate') ||
            (error.message || '').includes('already');

          if (isDuplicate) {
            localStorage.setItem('thread_giveaway_entered', '1');
            showSuccess(true);
          } else {
            setLoading(false);
            errEl.textContent = 'Something went wrong — please try again.';
            console.error('[giveaway] insert error:', error);
          }
          return;
        }
      }

      /* success */
      localStorage.setItem('thread_giveaway_entered', '1');
      showSuccess(true);

    } catch (e) {
      setLoading(false);
      errEl.textContent = 'Connection error — please try again.';
      console.error('[giveaway] error:', e);
    }
  });

  /* ── Helpers ── */
  function setLoading(on) {
    btn.disabled = on;
    btnText?.classList.toggle('gw-hidden', on);
    btnLoad?.classList.toggle('gw-hidden', !on);
  }

  function showSuccess(animate) {
    const wrap    = document.getElementById('formWrap');
    const success = document.getElementById('gwSuccess');
    if (!success) return;
    if (wrap) wrap.classList.add('gw-hidden');
    success.classList.remove('gw-hidden');
    if (!animate) success.style.animation = 'none';
    setTimeout(refreshCount, 800);
  }

})();
