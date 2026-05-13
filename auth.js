'use strict';

console.log('[auth.js v2] loaded — direct Supabase mode');

/* ─── Supabase direct client (bypasses db.js entirely) ───────────────────── */
function getSB() {
  const cfg = window.THREAD_CONFIG;
  if (!cfg || !window.supabase) { console.warn('[auth.js] getSB: missing cfg or supabase'); return null; }
  const client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
  console.log('[auth.js] getSB client:', typeof client, 'auth:', typeof client?.auth);
  return client;
}

function generateReferralCode(name) {
  const prefix = name.replace(/[^a-zA-Z]/g, '').toUpperCase().slice(0, 4).padEnd(4, 'X');
  const chars  = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let suffix   = '';
  for (let i = 0; i < 4; i++) suffix += chars[Math.floor(Math.random() * chars.length)];
  return prefix + suffix;
}

/* ─── REDIRECT IF ALREADY SIGNED IN ─────────────────────────────────────── */
(async function () {
  try {
    const sb = getSB();
    if (sb) {
      const { data } = await sb.auth.getUser();
      if (data?.user) window.location.href = 'dashboard.html';
    }
  } catch(e) {}
})();

/* ─── CHECK URL TAB PARAM ────────────────────────────────────────────────── */
(function () {
  const params = new URLSearchParams(window.location.search);
  if (params.get('tab') === 'signin') switchTab('signin');
})();

/* ─── TAB SWITCHER ───────────────────────────────────────────────────────── */
function switchTab(tab) {
  const signupForm = document.getElementById('signupForm');
  const signinForm = document.getElementById('signinForm');
  const tabSignup  = document.getElementById('tabSignup');
  const tabSignin  = document.getElementById('tabSignin');

  if (tab === 'signup') {
    signupForm.classList.remove('hidden');
    signinForm.classList.add('hidden');
    tabSignup.classList.add('active');
    tabSignin.classList.remove('active');
  } else {
    signinForm.classList.remove('hidden');
    signupForm.classList.add('hidden');
    tabSignin.classList.add('active');
    tabSignup.classList.remove('active');
  }
  clearErrors();
}

function clearErrors() {
  document.querySelectorAll('.form-error').forEach(el => {
    el.textContent = '';
    el.classList.remove('show');
  });
}

function showFormError(id, msg) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
}

function setLoading(formId, loading) {
  const btn    = document.getElementById(formId + 'Btn');
  const text   = btn?.querySelector('.btn-text');
  const loader = btn?.querySelector('.btn-loader');
  if (btn)    btn.disabled = loading;
  if (text)   text.classList.toggle('hidden', loading);
  if (loader) loader.classList.toggle('hidden', !loading);
}

/* ─── SIGN UP ────────────────────────────────────────────────────────────── */
async function handleSignUp(event) {
  event.preventDefault();
  clearErrors();

  const name     = document.getElementById('signupName').value.trim();
  const email    = document.getElementById('signupEmail').value.trim().toLowerCase();
  const password = document.getElementById('signupPassword').value;
  const confirm  = document.getElementById('signupConfirm').value;
  const terms    = document.getElementById('agreeTerms').checked;

  if (!name)                           { showFormError('signupError', 'Please enter your full name.'); return; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showFormError('signupError', 'Please enter a valid email.'); return; }
  if (password.length < 6)             { showFormError('signupError', 'Password must be at least 6 characters.'); return; }
  if (password !== confirm)            { showFormError('signupError', 'Passwords do not match.'); return; }
  if (!terms)                          { showFormError('signupError', 'You must agree to the terms to continue.'); return; }

  setLoading('signup', true);

  try {
    const sb = getSB();
    if (!sb) throw new Error('Service unavailable. Please try again.');

    const { data, error } = await sb.auth.signUp({ email, password });
    if (error) throw new Error(error.message);

    // Create profile with referral code
    const referralCode = generateReferralCode(name);
    await sb.from('profiles').upsert({
      id: data.user.id, email, name, referral_code: referralCode
    });

    setLoading('signup', false);
    showSuccessOverlay(name, referralCode);

  } catch(e) {
    setLoading('signup', false);
    showFormError('signupError', e.message || 'Something went wrong. Please try again.');
  }
}

/* ─── SIGN IN ────────────────────────────────────────────────────────────── */
async function handleSignIn(event) {
  event.preventDefault();
  clearErrors();

  const email    = document.getElementById('signinEmail').value.trim().toLowerCase();
  const password = document.getElementById('signinPassword').value;

  if (!email)    { showFormError('signinError', 'Please enter your email.'); return; }
  if (!password) { showFormError('signinError', 'Please enter your password.'); return; }

  setLoading('signin', true);

  try {
    const sb = getSB();
    if (!sb) throw new Error('Service unavailable. Please try again.');

    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message);

    setLoading('signin', false);
    const next = new URLSearchParams(window.location.search).get('next');
    window.location.href = next || 'dashboard.html';

  } catch(e) {
    setLoading('signin', false);
    showFormError('signinError', e.message || 'Invalid email or password.');
  }
}

/* ─── SUCCESS OVERLAY ────────────────────────────────────────────────────── */
function showSuccessOverlay(name, code) {
  if (!document.getElementById('authSuccessOverlay')) {
    const el = document.createElement('div');
    el.id = 'authSuccessOverlay';
    el.style.cssText = `
      position:fixed;inset:0;background:rgba(0,0,0,.85);backdrop-filter:blur(12px);
      display:flex;align-items:center;justify-content:center;z-index:1000;
      animation:fadeIn .3s ease;
    `;
    el.innerHTML = `
      <div style="background:#111;border:1px solid #222;border-radius:24px;padding:48px 40px;
                  max-width:400px;width:90%;text-align:center;">
        <div style="font-size:48px;margin-bottom:16px">🎉</div>
        <h2 style="font-size:22px;font-weight:700;margin-bottom:8px">Welcome to THREAD!</h2>
        <p style="color:#888;font-size:14px;margin-bottom:24px">
          Your account is ready. Here's your unique referral code:
        </p>
        <div style="background:#0a0a0a;border:1px solid #222;border-radius:12px;
                    padding:16px;font-family:'Space Mono',monospace;font-size:22px;
                    font-weight:700;letter-spacing:4px;color:#fff;margin-bottom:24px"
             id="successCodeDisplay">${code || 'Generating…'}</div>
        <p style="color:#666;font-size:12px;margin-bottom:28px">
          This code is printed on every THREAD piece you order.<br>
          When someone scans it and buys — you earn.
        </p>
        <div style="width:100%;background:#1a1a1a;border-radius:8px;height:4px;margin-bottom:8px;overflow:hidden">
          <div id="successBar" style="height:100%;background:#fff;width:0%;transition:width 3s linear;border-radius:8px"></div>
        </div>
        <p style="color:#555;font-size:12px">Taking you to your dashboard…</p>
      </div>`;
    document.body.appendChild(el);
    setTimeout(() => { const bar = document.getElementById('successBar'); if (bar) bar.style.width = '100%'; }, 50);
  }
  const next = new URLSearchParams(window.location.search).get('next');
  setTimeout(() => window.location.href = next || 'dashboard.html', 3200);
}

/* ─── PASSWORD TOGGLE ────────────────────────────────────────────────────── */
function togglePass(inputId, btn) {
  const input = document.getElementById(inputId);
  if (!input) return;
  input.type = input.type === 'password' ? 'text' : 'password';
  btn.textContent = input.type === 'password' ? '👁' : '🙈';
}
