/* ─────────────────────────────────────────────────────────────────────────
   THREAD Giveaway — giveaway.js v4
   • Creates a full THREAD account OR signs in existing user to enter
   • Duplicate prevention: email unique, instagram unique, user_id unique,
     IP soft-block, device fingerprint check
───────────────────────────────────────────────────────────────────────── */
(async function () {
  'use strict';

  const OWNER_IPS = ['65.130.60.246', '187.199.28.205', '187.199.69.171'];
  const source    = 'instagram';

  /* ── Supabase ── */
  const cfg = window.THREAD_CONFIG;
  const sb  = (cfg?.supabaseUrl && cfg.supabaseUrl !== 'YOUR_SUPABASE_URL' && window.supabase)
    ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey)
    : null;

  /* ── Device fingerprint (browser properties → stable hash) ── */
  function makeFingerprint() {
    const raw = [
      navigator.userAgent,
      navigator.language,
      screen.width + 'x' + screen.height + 'x' + screen.colorDepth,
      new Date().getTimezoneOffset(),
      navigator.hardwareConcurrency || '',
    ].join('|');
    let h = 0;
    for (let i = 0; i < raw.length; i++) h = Math.imul(31, h) + raw.charCodeAt(i) | 0;
    return Math.abs(h).toString(36);
  }
  const fingerprint = makeFingerprint();

  /* ── Geo / IP ── */
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
  const BASE_COUNT = 7582;
  async function refreshCount() {
    if (!sb) return;
    try {
      const { data } = await sb.rpc('get_giveaway_count');
      const el = document.getElementById('entryCount');
      if (el && data != null) el.textContent = (BASE_COUNT + Number(data)).toLocaleString();
    } catch (_) {}
  }
  refreshCount();

  /* ── Already entered? Check localStorage + fingerprint ── */
  if (localStorage.getItem('thread_giveaway_entered')) {
    showSuccess(false, 'already');
    return;
  }

  if (sb) {
    try {
      const { data: fpFound } = await sb.rpc('check_giveaway_fingerprint', { p_fp: fingerprint });
      if (fpFound) {
        localStorage.setItem('thread_giveaway_entered', '1');
        showSuccess(false, 'already');
        return;
      }
    } catch (_) {}
  }

  /* ── Prize selection ── */
  let selectedPrize = null;

  window.selectPrize = function (prize) {
    selectedPrize = prize;
    document.getElementById('prizeTees')?.classList.toggle('selected',   prize === 'tees');
    document.getElementById('prizeHoodie')?.classList.toggle('selected', prize === 'hoodie');
    setError('');
  };

  document.getElementById('prizeTees')?.addEventListener('keydown',   e => { if (e.key === 'Enter' || e.key === ' ') selectPrize('tees'); });
  document.getElementById('prizeHoodie')?.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') selectPrize('hoodie'); });

  /* ── Tab switching ── */
  window.gwSwitchTab = function (tab) {
    const isNew = tab === 'new';
    document.getElementById('gwFormNew')?.classList.toggle('gw-hidden', !isNew);
    document.getElementById('gwFormExisting')?.classList.toggle('gw-hidden', isNew);
    document.getElementById('tabNew')?.classList.toggle('active', isNew);
    document.getElementById('tabExisting')?.classList.toggle('active', !isNew);
    setError('');
  };

  /* ── Password live validation ── */
  document.getElementById('gwPassword')?.addEventListener('input', function () {
    const v = this.value;
    setReq('gwPwLen',  v.length >= 7);
    setReq('gwPwSpec', /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(v));
  });

  /* ── Username / Instagram sanitisers ── */
  document.getElementById('gwUsername')?.addEventListener('input', function () {
    this.value = this.value.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase();
  });
  function sanitiseIG(el) {
    if (!el) return;
    el.addEventListener('input', function () {
      this.value = this.value.replace(/^@+/, '').replace(/[^a-zA-Z0-9_.]/g, '');
    });
  }
  sanitiseIG(document.getElementById('gwInstagram'));
  sanitiseIG(document.getElementById('gwInstagramEx'));

  /* ═══════════════════════════════════════════════════════════════════════
     NEW ACCOUNT SUBMIT
  ═══════════════════════════════════════════════════════════════════════ */
  document.getElementById('gwFormNew')?.addEventListener('submit', async () => {
    const name      = (document.getElementById('gwName')?.value      || '').trim();
    const username  = (document.getElementById('gwUsername')?.value   || '').trim().toLowerCase();
    const instagram = (document.getElementById('gwInstagram')?.value  || '').trim().replace(/^@+/, '');
    const dob       = (document.getElementById('gwDob')?.value        || '').trim();
    const email     = (document.getElementById('gwEmail')?.value      || '').trim().toLowerCase();
    const password  = (document.getElementById('gwPassword')?.value   || '');
    const confirm   = (document.getElementById('gwConfirm')?.value    || '');
    const agreed    = document.getElementById('gwAgree')?.checked;

    setError('');

    if (!selectedPrize)                                            return setError('Please tap a prize to select what you want.');
    if (!name)                                                     return setError('Please enter your full name.');
    if (!username || username.length < 2)                         return setError('Username must be at least 2 characters.');
    if (!/^[a-z0-9_]+$/.test(username))                           return setError('Username: letters, numbers, underscores only.');
    if (!instagram)                                               return setError('Please enter your Instagram handle.');
    if (!dob)                                                     return setError('Please enter your date of birth.');
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))    return setError('Please enter a valid email address.');
    if (password.length < 7)                                      return setError('Password must be at least 7 characters.');
    if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) return setError('Password needs at least one special character.');
    if (password !== confirm)                                     return setError('Passwords do not match.');
    if (!agreed)                                                  return setError('Please agree to the Terms & Conditions.');

    setLoading('new', true);

    try {
      if (!sb) throw new Error('Service unavailable — please try again.');

      /* IP duplicate check (soft block) */
      if (geoIp) {
        const { data: ipTaken } = await sb.rpc('check_giveaway_ip', { p_ip: geoIp }).catch(() => ({ data: false }));
        if (ipTaken) {
          setLoading('new', false);
          return setError('An entry has already been submitted from this location. If that wasn\'t you, contact us.');
        }
      }

      /* Username availability */
      const { data: available } = await sb.rpc('check_username_available', { p_username: username });
      if (available === false) {
        setLoading('new', false);
        return setError('That username is already taken — please choose another.');
      }

      /* Create account */
      const referralCode = generateReferralCode(name);
      const referredBy   = (localStorage.getItem('thread_ref') || '').trim() || null;

      const { data: authData, error: authErr } = await sb.auth.signUp({
        email, password,
        options: { data: { name, username }, emailRedirectTo: 'https://mythread.shop/auth.html' }
      });
      if (authErr) throw new Error(authErr.message);

      localStorage.setItem('thread_pending_profile', JSON.stringify({ name, username, dob, email, referralCode, referredBy }));

      if (authData.user) {
        const profileData = { id: authData.user.id, email, name, username, referral_code: referralCode, referred_by: referredBy, date_of_birth: dob };
        const { error: upsertErr } = await sb.from('profiles').upsert(profileData, { onConflict: 'id' });
        if (!upsertErr) localStorage.removeItem('thread_pending_profile');

        try { await sb.auth.signInWithPassword({ email, password }); } catch (_) {}

        localStorage.setItem('thread_session', JSON.stringify({
          id: authData.user.id, email, name, username,
          referralCode, referral_code: referralCode,
          avatar: (name || email || 'U').slice(0, 2).toUpperCase(),
          stats: { totalScans: 0, conversions: 0, pendingEarnings: 0, totalEarned: 0, scanHistory: [] },
          purchases: [],
        }));

        try {
          await sb.from('giveaway_entries').insert({
            name, email, source,
            user_id:      authData.user.id,
            instagram,
            prize_choice: selectedPrize,
            ip:           geoIp        || null,
            city:         geoCity      || null,
            fingerprint,
          });
        } catch (_) {}
      }

      localStorage.setItem('thread_giveaway_entered', '1');
      showSuccess(true, 'new');

    } catch (e) {
      setLoading('new', false);
      const msg = e.message || '';
      if (msg.toLowerCase().includes('already registered') || msg.toLowerCase().includes('already been registered')) {
        setError('An account with that email already exists. Use the "Already Have an Account" tab to sign in and enter.');
      } else {
        setError(msg || 'Something went wrong — please try again.');
      }
    }
  });

  /* ═══════════════════════════════════════════════════════════════════════
     EXISTING ACCOUNT SUBMIT
  ═══════════════════════════════════════════════════════════════════════ */
  document.getElementById('gwFormExisting')?.addEventListener('submit', async () => {
    const email     = (document.getElementById('gwEmailEx')?.value     || '').trim().toLowerCase();
    const password  = (document.getElementById('gwPasswordEx')?.value  || '');
    const instagram = (document.getElementById('gwInstagramEx')?.value || '').trim().replace(/^@+/, '');

    setError('');

    if (!selectedPrize) return setError('Please tap a prize above to select what you want.');
    if (!email)         return setError('Please enter your email.');
    if (!password)      return setError('Please enter your password.');
    if (!instagram)     return setError('Please enter your Instagram handle.');

    setLoading('ex', true);

    try {
      if (!sb) throw new Error('Service unavailable — please try again.');

      /* IP duplicate check */
      if (geoIp) {
        const { data: ipTaken } = await sb.rpc('check_giveaway_ip', { p_ip: geoIp }).catch(() => ({ data: false }));
        if (ipTaken) {
          setLoading('ex', false);
          return setError('An entry has already been submitted from this location.');
        }
      }

      /* Sign in */
      const { data: authData, error: authErr } = await sb.auth.signInWithPassword({ email, password });
      if (authErr) {
        setLoading('ex', false);
        return setError('Invalid email or password — please try again.');
      }

      const user = authData.user;

      /* Store local session */
      const { data: profile } = await sb.from('profiles').select('name, username, referral_code').eq('id', user.id).single().catch(() => ({ data: null }));
      localStorage.setItem('thread_session', JSON.stringify({
        id: user.id, email,
        name:          profile?.name     || email,
        username:      profile?.username || '',
        referralCode:  profile?.referral_code || '',
        referral_code: profile?.referral_code || '',
        avatar: ((profile?.name || email || 'U').slice(0, 2)).toUpperCase(),
        stats: { totalScans: 0, conversions: 0, pendingEarnings: 0, totalEarned: 0, scanHistory: [] },
        purchases: [],
      }));

      /* Insert giveaway entry */
      const { error: insertErr } = await sb.from('giveaway_entries').insert({
        name:         profile?.name || email,
        email,
        source,
        user_id:      user.id,
        instagram,
        prize_choice: selectedPrize,
        ip:           geoIp   || null,
        city:         geoCity || null,
        fingerprint,
      });

      if (insertErr) {
        setLoading('ex', false);
        if (insertErr.code === '23505' || (insertErr.message || '').includes('unique') || (insertErr.message || '').includes('duplicate')) {
          localStorage.setItem('thread_giveaway_entered', '1');
          showSuccess(true, 'already');
        } else {
          setError('Could not enter — please try again. (' + insertErr.message + ')');
        }
        return;
      }

      localStorage.setItem('thread_giveaway_entered', '1');
      showSuccess(true, 'existing');

    } catch (e) {
      setLoading('ex', false);
      setError(e.message || 'Something went wrong — please try again.');
    }
  });

  /* ── Helpers ── */
  function setLoading(form, on) {
    const btnId = form === 'new' ? 'gwBtnNew' : 'gwBtnEx';
    const btn   = document.getElementById(btnId);
    if (!btn) return;
    btn.disabled = on;
    btn.querySelector('.btn-text')?.classList.toggle('gw-hidden', on);
    btn.querySelector('.btn-loader')?.classList.toggle('gw-hidden', !on);
  }

  function setError(msg) {
    const el = document.getElementById('gwError');
    if (el) el.textContent = msg;
  }

  function setReq(id, met) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.toggle('met', met);
    el.textContent = (met ? '✓' : '✗') + el.textContent.slice(1);
  }

  function showSuccess(animate, reason) {
    const wrap    = document.getElementById('formWrap');
    const success = document.getElementById('gwSuccess');
    const msg     = document.getElementById('gwSuccessMsg');
    if (!success) return;
    if (wrap) wrap.classList.add('gw-hidden');
    success.classList.remove('gw-hidden');
    if (!animate) success.style.animation = 'none';
    if (msg) {
      if (reason === 'already') {
        msg.textContent = "You've already entered the THREAD giveaway. Good luck — winner announced soon!";
      } else if (reason === 'existing') {
        msg.textContent = "You're in! We'll contact the winner via Instagram. Good luck!";
      } else {
        msg.innerHTML = "Your THREAD account has been created and you're entered in the giveaway.<br>Check your email to verify your account. Good luck!";
      }
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

  /* ── Global helpers ── */
  window.gwTogglePass = function (id, btn) {
    const input = document.getElementById(id);
    if (!input) return;
    const isText    = input.type === 'text';
    input.type      = isText ? 'password' : 'text';
    btn.textContent = isText ? '👁' : '🙈';
  };

  window.gwToggleFaq = function (suffix) {
    const trigger = document.getElementById('faqTrigger' + suffix);
    const body    = document.getElementById('faqBody'    + suffix);
    if (!trigger || !body) return;
    const isOpen = body.classList.toggle('open');
    trigger.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
  };

})();
