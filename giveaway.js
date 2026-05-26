/* ─────────────────────────────────────────────────────────────────────────
   THREAD Giveaway — giveaway.js v2
   Creates a full THREAD account and enters the user in the giveaway.
   Source tracked via ?src= URL param (e.g. ?src=facebook).
───────────────────────────────────────────────────────────────────────── */
(async function () {
  'use strict';

  const OWNER_IPS = ['65.130.60.246', '187.199.28.205', '187.199.69.171'];

  /* ── Supabase ── */
  const cfg = window.THREAD_CONFIG;
  const sb  = (cfg?.supabaseUrl && cfg.supabaseUrl !== 'YOUR_SUPABASE_URL' && window.supabase)
    ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey)
    : null;

  /* ── Ad source — hardcoded to Instagram ── */
  const source = 'instagram';

  /* ── Geo ── */
  let geoCity = null, geoIp = null;
  try {
    const cached = sessionStorage.getItem('thread_geo');
    if (cached) {
      const g = JSON.parse(cached);
      geoCity = g.city || null;
      geoIp   = g.ip   || null;
    } else {
      const r = await fetch('https://ipapi.co/json/');
      if (r.ok) {
        const g = await r.json();
        geoCity = g.city || null;
        geoIp   = g.ip   || null;
        sessionStorage.setItem('thread_geo', JSON.stringify({ city: geoCity, ip: geoIp }));
      }
    }
  } catch (_) {}
  if (OWNER_IPS.includes(geoIp)) { geoIp = null; geoCity = null; }

  /* ── Live entry count ── */
  const BASE_COUNT = 7582; // starting offset — real signups add on top
  async function refreshCount() {
    if (!sb) return;
    try {
      const { data } = await sb.rpc('get_giveaway_count');
      const el = document.getElementById('entryCount');
      if (el && data != null) el.textContent = (BASE_COUNT + Number(data)).toLocaleString();
    } catch (_) {}
  }
  refreshCount();

  /* ── Already signed up? ── */
  if (localStorage.getItem('thread_giveaway_entered')) {
    showSuccess(false);
    return;
  }

  /* ── Prize selection ── */
  let selectedPrize = null;

  window.selectPrize = function (prize) {
    selectedPrize = prize;
    document.getElementById('prizeTees')?.classList.toggle('selected', prize === 'tees');
    document.getElementById('prizeHoodie')?.classList.toggle('selected', prize === 'hoodie');
    // Clear prize error if present
    if (errEl) errEl.textContent = '';
  };

  // Keyboard support
  document.getElementById('prizeTees')?.addEventListener('keydown',   e => { if (e.key === 'Enter' || e.key === ' ') selectPrize('tees'); });
  document.getElementById('prizeHoodie')?.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') selectPrize('hoodie'); });

  /* ── Password live validation ── */
  const pwInput = document.getElementById('gwPassword');
  if (pwInput) {
    pwInput.addEventListener('input', () => {
      const v      = pwInput.value;
      const lenOk  = v.length >= 7;
      const specOk = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(v);
      setReq('gwPwLen',  lenOk);
      setReq('gwPwSpec', specOk);
    });
  }

  /* ── Username sanitiser ── */
  const unInput = document.getElementById('gwUsername');
  if (unInput) {
    unInput.addEventListener('input', () => {
      unInput.value = unInput.value.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase();
    });
  }

  /* ── Instagram sanitiser (strip leading @, allow letters/numbers/_/.) ── */
  const igInput = document.getElementById('gwInstagram');
  if (igInput) {
    igInput.addEventListener('input', () => {
      igInput.value = igInput.value.replace(/^@+/, '').replace(/[^a-zA-Z0-9_.]/g, '');
    });
  }

  /* ── Form submit ── */
  const form    = document.getElementById('gwForm');
  const errEl   = document.getElementById('gwError');
  const btn     = document.getElementById('gwBtn');
  const btnText = btn?.querySelector('.btn-text');
  const btnLoad = btn?.querySelector('.btn-loader');

  if (!form) return;

  form.addEventListener('submit', async () => {
    const name      = (document.getElementById('gwName')?.value      || '').trim();
    const username  = (document.getElementById('gwUsername')?.value   || '').trim().toLowerCase();
    const instagram = (document.getElementById('gwInstagram')?.value  || '').trim().replace(/^@+/, '');
    const dob       = (document.getElementById('gwDob')?.value        || '').trim();
    const email     = (document.getElementById('gwEmail')?.value      || '').trim().toLowerCase();
    const password  = (document.getElementById('gwPassword')?.value   || '');
    const confirm   = (document.getElementById('gwConfirm')?.value    || '');
    const agreed    = document.getElementById('gwAgree')?.checked;

    errEl.textContent = '';

    /* ── Validation ── */
    if (!selectedPrize) return setError('Please tap a prize to select what you want — 2 tees or 1 hoodie.');
    if (!name) return setError('Please enter your full name.');
    if (!username || username.length < 2) return setError('Username must be at least 2 characters.');
    if (!/^[a-z0-9_]+$/.test(username)) return setError('Username can only contain letters, numbers, and underscores.');
    if (!instagram || instagram.length < 1) return setError('Please enter your Instagram handle.');
    if (!dob) return setError('Please enter your date of birth.');
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return setError('Please enter a valid email address.');
    if (password.length < 7) return setError('Password must be at least 7 characters.');
    if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) return setError('Password needs at least one special character.');
    if (password !== confirm) return setError('Passwords do not match.');
    if (!agreed) return setError('Please agree to the Terms & Conditions to continue.');

    setLoading(true);

    try {
      if (!sb) throw new Error('Service unavailable — please try again.');

      /* ── Check username availability ── */
      const { data: available } = await sb.rpc('check_username_available', { p_username: username });
      if (available === false) {
        setLoading(false);
        return setError('That username is already taken — please choose another.');
      }

      /* ── Generate referral code ── */
      const referralCode = generateReferralCode(name);
      const referredBy   = (localStorage.getItem('thread_ref') || '').trim() || null;

      /* ── Create Supabase auth account ── */
      const { data: authData, error: authErr } = await sb.auth.signUp({
        email, password,
        options: {
          data: { name, username },
          emailRedirectTo: 'https://mythread.shop/auth.html',
        }
      });
      if (authErr) throw new Error(authErr.message);

      /* ── Store pending profile (fallback if email confirmation blocks upsert) ── */
      const pendingProfile = { name, username, dob, email, referralCode, referredBy };
      localStorage.setItem('thread_pending_profile', JSON.stringify(pendingProfile));

      /* ── Upsert profile row ── */
      if (authData.user) {
        const profileData = {
          id:            authData.user.id,
          email, name, username,
          referral_code: referralCode,
          referred_by:   referredBy,
          date_of_birth: dob,
        };
        const { error: upsertErr } = await sb.from('profiles').upsert(profileData, { onConflict: 'id' });
        if (!upsertErr) localStorage.removeItem('thread_pending_profile');

        /* ── Try immediate sign-in (works when email confirmation disabled) ── */
        try { await sb.auth.signInWithPassword({ email, password }); } catch (_) {}

        /* ── Store local session (dashboard / checkout fallback) ── */
        localStorage.setItem('thread_session', JSON.stringify({
          id: authData.user.id, email, name, username,
          referralCode, referral_code: referralCode,
          avatar: (name || email || 'U').slice(0, 2).toUpperCase(),
          stats: { totalScans: 0, conversions: 0, pendingEarnings: 0, totalEarned: 0, scanHistory: [] },
          purchases: [],
        }));

        /* ── Log giveaway entry ── */
        try {
          await sb.from('giveaway_entries').insert({
            name, email, source,
            user_id:      authData.user.id,
            instagram:    instagram || null,
            prize_choice: selectedPrize,
            ip:           geoIp   || null,
            city:         geoCity || null,
          });
        } catch (_) {
          // Duplicate or missing column — not fatal, account is created regardless
        }
      }

      localStorage.setItem('thread_giveaway_entered', '1');
      showSuccess(true);

    } catch (e) {
      setLoading(false);
      const msg = e.message || '';
      if (msg.toLowerCase().includes('already registered') || msg.toLowerCase().includes('already been registered')) {
        setError('An account with that email already exists. Try signing in at mythread.shop/auth.html');
      } else {
        setError(msg || 'Something went wrong — please try again.');
      }
    }
  });

  /* ── Helpers ── */
  function setLoading(on) {
    if (!btn) return;
    btn.disabled = on;
    btnText?.classList.toggle('gw-hidden', on);
    btnLoad?.classList.toggle('gw-hidden', !on);
  }

  function setError(msg) {
    if (errEl) errEl.textContent = msg;
  }

  function setReq(id, met) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.toggle('met', met);
    el.textContent = (met ? '✓' : '✗') + el.textContent.slice(1);
  }

  function showSuccess(animate) {
    const wrap    = document.getElementById('formWrap');
    const success = document.getElementById('gwSuccess');
    const msg     = document.getElementById('gwSuccessMsg');
    if (!success) return;
    if (wrap) wrap.classList.add('gw-hidden');
    success.classList.remove('gw-hidden');
    if (!animate) success.style.animation = 'none';
    if (msg && !animate) {
      msg.textContent = "You've already entered the THREAD giveaway. Good luck!";
    }
    setTimeout(refreshCount, 800);
  }

  function generateReferralCode(name) {
    const prefix = name.replace(/[^a-zA-Z]/g, '').toUpperCase().slice(0, 4).padEnd(4, 'X');
    const chars  = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let suffix   = '';
    for (let i = 0; i < 4; i++) suffix += chars[Math.floor(Math.random() * chars.length)];
    return prefix + suffix;
  }

  /* ── Global: FAQ toggle (suffix = 'Top' or 'Bot') ── */
  window.gwToggleFaq = function (suffix) {
    const trigger = document.getElementById('faqTrigger' + suffix);
    const body    = document.getElementById('faqBody'    + suffix);
    if (!trigger || !body) return;
    const isOpen = body.classList.toggle('open');
    trigger.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
  };

  /* ── Global: password show/hide ── */
  window.gwTogglePass = function (id, btn) {
    const input = document.getElementById(id);
    if (!input) return;
    const isText = input.type === 'text';
    input.type   = isText ? 'password' : 'text';
    btn.textContent = isText ? '👁' : '🙈';
  };

})();
