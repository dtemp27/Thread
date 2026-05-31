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

function calculateAge(dob) {
  const today = new Date();
  const birth = new Date(dob);
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age;
}

// Holds form data while the parental consent modal is open
let _pendingSignup = null;

/* ─── REDIRECT IF ALREADY SIGNED IN ─────────────────────────────────────── */
(async function () {
  try {
    // Never auto-redirect when this page is being loaded as an email-verification
    // callback — the type=signup / code handler below needs to run first.
    const _cbQp   = new URLSearchParams(window.location.search);
    const _cbHash = window.location.hash;
    const _isVerifyCallback = _cbQp.get('type') === 'signup'
                           || _cbQp.get('code')
                           || _cbHash.includes('type=signup');
    if (_isVerifyCallback) return;

    const sb = getSB();
    if (sb) {
      const { data } = await sb.auth.getUser();
      if (data?.user) window.location.href = 'dashboard.html';
    }
  } catch(e) {}
})();

/* ─── CHECK URL TAB PARAM + SET DOB MAX ─────────────────────────────────── */
(function () {
  const params = new URLSearchParams(window.location.search);
  if (params.get('tab') === 'signin') switchTab('signin');

  // Detect Supabase callback types in the URL hash or query params
  const hash    = window.location.hash;
  const _qp     = new URLSearchParams(window.location.search);
  const _type   = _qp.get('type') || (hash.match(/[#&]type=([^&]+)/) || [])[1] || '';
  const _code   = _qp.get('code') || ''; // PKCE flow

  if (_type === 'recovery') {
    // Password reset link → show the reset-password form
    switchTab('reset');
  } else if (_type === 'signup' || _code) {
    // Email verification link clicked → exchange token for real session,
    // store thread_session, then send user to home page scrolled to the shop.
    (async function () {
      try {
        const sb = getSB();
        if (sb) {
          let session = null;
          if (_code) {
            // PKCE flow: exchange the one-time code for a session
            const { data: d } = await sb.auth.exchangeCodeForSession(_code);
            session = d?.session;
          } else {
            // Implicit flow: Supabase JS reads tokens from the URL hash automatically
            const { data: d } = await sb.auth.getSession();
            session = d?.session;
          }

          if (session?.user) {
            // Guaranteed fallback: if the upsert in completeSignUp was blocked by RLS
            // (email confirmation enabled → no auth context at signup time), upsert the
            // pending profile now using the freshly-confirmed authenticated session.
            try {
              const pending = JSON.parse(localStorage.getItem('thread_pending_profile') || 'null');
              if (pending && pending.email === session.user.email) {
                const pd = {
                  id:            session.user.id,
                  email:         pending.email,
                  name:          pending.name,
                  username:      pending.username      || null,
                  referral_code: pending.referralCode,
                  referred_by:   pending.referredBy    || null,
                  date_of_birth: pending.dob           || null,
                };
                if (pending.parentEmail) { pd.parent_email = pending.parentEmail; pd.is_minor = true; }
                const { error: pendErr } = await sb.from('profiles').upsert(pd, { onConflict: 'id' });
                if (!pendErr) localStorage.removeItem('thread_pending_profile');
              }
            } catch(_) {}

            // Pull name/referral code from profiles table
            let name = session.user.user_metadata?.name || '';
            let username = session.user.user_metadata?.username || '';
            let referralCode = '';
            try {
              const { data: prof } = await sb.from('profiles')
                .select('name, username, referral_code')
                .eq('id', session.user.id).single();
              if (prof) {
                name         = prof.name         || name;
                username     = prof.username      || username;
                referralCode = prof.referral_code || '';
              }
            } catch(_) {}

            // Update thread_session with verified data
            localStorage.setItem('thread_session', JSON.stringify({
              id: session.user.id,
              email: session.user.email,
              name, username, referralCode, referral_code: referralCode,
              avatar: (name || session.user.email || 'U').slice(0, 2).toUpperCase(),
              stats: { totalScans: 0, conversions: 0, pendingEarnings: 0, totalEarned: 0, scanHistory: [] },
              purchases: [],
            }));
          }
        }
      } catch(e) { console.warn('[auth] email verify error:', e); }
      // Send them to the home page with the shop section in view
      window.location.href = 'index.html?welcome=1';
    })();
  }

  // Prevent future dates in the DOB picker
  const dobInput = document.getElementById('signupDob');
  if (dobInput) dobInput.max = new Date().toISOString().split('T')[0];

  // Live password requirement indicators
  function watchPassword(inputId, lenId, specId) {
    const input = document.getElementById(inputId);
    if (!input) return;
    input.addEventListener('input', () => {
      const val = input.value;
      const lenOk  = val.length >= 7;
      const specOk = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?`~]/.test(val);
      const lenEl  = document.getElementById(lenId);
      const specEl = document.getElementById(specId);
      if (lenEl)  { lenEl.textContent  = (lenOk  ? '✓' : '✗') + ' At least 7 characters';           lenEl.className  = 'req' + (lenOk  ? ' met' : ''); }
      if (specEl) { specEl.textContent = (specOk ? '✓' : '✗') + ' One special character (!@#$%^&*)'; specEl.className = 'req' + (specOk ? ' met' : ''); }
    });
  }
  watchPassword('signupPassword', 'pwLen', 'pwSpec');
  watchPassword('resetPassword',  'pwLenReset', 'pwSpecReset');
})();

/* ─── TAB SWITCHER ───────────────────────────────────────────────────────── */
function switchTab(tab) {
  const forms = ['signupForm','signinForm','forgotForm','resetForm'];
  forms.forEach(id => document.getElementById(id)?.classList.add('hidden'));

  const tabSignup = document.getElementById('tabSignup');
  const tabSignin = document.getElementById('tabSignin');
  tabSignup?.classList.remove('active');
  tabSignin?.classList.remove('active');

  if (tab === 'signup') {
    document.getElementById('signupForm')?.classList.remove('hidden');
    tabSignup?.classList.add('active');
  } else if (tab === 'signin') {
    document.getElementById('signinForm')?.classList.remove('hidden');
    tabSignin?.classList.add('active');
  } else if (tab === 'forgot') {
    document.getElementById('forgotForm')?.classList.remove('hidden');
  } else if (tab === 'reset') {
    document.getElementById('resetForm')?.classList.remove('hidden');
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

function showFormSuccess(id, msg) {
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

  const agreeTerms = document.getElementById('agreeTerms');
  if (agreeTerms && !agreeTerms.checked) {
    showError('signupError', 'Please agree to the Terms & Conditions before creating an account.');
    return;
  }

  const name     = document.getElementById('signupName').value.trim();
  const dob      = document.getElementById('signupDob').value;
  const email    = document.getElementById('signupEmail').value.trim().toLowerCase();
  const password = document.getElementById('signupPassword').value;
  const confirm  = document.getElementById('signupConfirm').value;
  const terms    = document.getElementById('agreeTerms').checked;

  const username = document.getElementById('signupUsername').value.trim().toLowerCase().replace(/^@/, '');

  if (!name)     { showFormError('signupError', 'Please enter your full name.'); return; }
  if (!username) { showFormError('signupError', 'Please choose a username.'); return; }
  if (username.length < 3) { showFormError('signupError', 'Username must be at least 3 characters.'); return; }
  if (username.length > 20) { showFormError('signupError', 'Username must be 20 characters or less.'); return; }
  if (!/^[a-z0-9_]+$/.test(username)) { showFormError('signupError', 'Username can only contain letters, numbers, and underscores.'); return; }
  if (!dob)      { showFormError('signupError', 'Please enter your date of birth.'); return; }

  const age = calculateAge(dob);
  if (age < 13)  { showFormError('signupError', 'You must be at least 13 years old to create an account.'); return; }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showFormError('signupError', 'Please enter a valid email.'); return; }
  if (password.length < 7)  { showFormError('signupError', 'Password must be at least 7 characters.'); return; }
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?`~]/.test(password)) { showFormError('signupError', 'Password must include at least one special character (e.g. !@#$%).'); return; }
  if (password !== confirm)  { showFormError('signupError', 'Passwords do not match.'); return; }
  if (!terms)    { showFormError('signupError', 'You must agree to the terms to continue.'); return; }

  if (age < 18) {
    showParentalConsentModal({ name, username, dob, email, password });
    return;
  }

  await completeSignUp({ name, username, dob, email, password });
}

async function completeSignUp({ name, username, dob, email, password, parentEmail = null }) {
  setLoading('signup', true);
  try {
    const sb = getSB();
    if (!sb) throw new Error('Service unavailable. Please try again.');

    // Check username availability
    const { data: available } = await sb.rpc('check_username_available', { p_username: username });
    if (available === false) {
      setLoading('signup', false);
      showFormError('signupError', 'That username is already taken. Please choose another.');
      return;
    }

    const referralCode = generateReferralCode(name);
    const referredBy   = (localStorage.getItem('thread_ref') || '').trim() || null;

    const { data, error } = await sb.auth.signUp({
      email, password,
      options: {
        data: { name, username },
        // After the user clicks the verification link, Supabase redirects here.
        // auth.js detects type=signup and forwards them to the home page → shop section.
        emailRedirectTo: 'https://mythread.shop/auth.html',
      }
    });
    if (error) throw new Error(error.message);

    const pendingProfile = { name, username, dob, email, referralCode, referredBy, parentEmail };
    localStorage.setItem('thread_pending_profile', JSON.stringify(pendingProfile));

    if (data.user) {
      const profileData = {
        id: data.user.id, email, name, username,
        referral_code: referralCode,
        referred_by:   referredBy,
        date_of_birth: dob,
      };
      if (parentEmail) { profileData.parent_email = parentEmail; profileData.is_minor = true; }

      // When Supabase email confirmation is enabled, signUp() returns a user but
      // no session — the client is unauthenticated and RLS will silently block the
      // upsert. Only clear thread_pending_profile when the upsert actually succeeds;
      // the email-verification callback below is the guaranteed fallback.
      const { error: upsertErr } = await sb.from('profiles').upsert(profileData, { onConflict: 'id' });
      if (!upsertErr) {
        localStorage.removeItem('thread_pending_profile');
      }
      // If upsertErr, thread_pending_profile stays in localStorage so the
      // verification callback (type=signup / code) can upsert it once the user
      // has a real confirmed session.

      // Try to sign in immediately (works when email confirmation is disabled).
      try {
        await sb.auth.signInWithPassword({ email, password });
      } catch(_) {}

      // Always store a local session — dashboard.js, checkout.js all read this as fallback.
      localStorage.setItem('thread_session', JSON.stringify({
        id: data.user.id, email, name, username,
        referralCode, referral_code: referralCode,
        avatar: (name || email || 'U').slice(0, 2).toUpperCase(),
        stats: { totalScans: 0, conversions: 0, pendingEarnings: 0, totalEarned: 0, scanHistory: [] },
        purchases: [],
      }));
    }

    setLoading('signup', false);
    showSuccessOverlay(name, referralCode);
  } catch(e) {
    setLoading('signup', false);
    showFormError('signupError', e.message || 'Something went wrong. Please try again.');
  }
}

/* ─── PARENTAL CONSENT MODAL ─────────────────────────────────────────────── */
function showParentalConsentModal(signupData) {
  _pendingSignup = signupData;

  const modal = document.createElement('div');
  modal.id = 'parentalModal';
  modal.innerHTML = `
    <div class="parental-overlay" id="parentalOverlay">
      <div class="parental-box">
        <div class="parental-icon">👨‍👩‍👧‍👦</div>
        <h3>Earn today — with your parents' approval!</h3>
        <p class="parental-sub">Since you're under 18, we just need your parent or guardian's info to get you started.</p>
        <div class="form-group" style="margin-top:20px;">
          <label style="font-size:13px;font-weight:600;color:#888;letter-spacing:.3px;">Parent / Guardian Email</label>
          <input type="email" id="parentEmail" placeholder="parent@email.com" style="
            width:100%;padding:14px 16px;background:#111;border:1px solid rgba(255,255,255,0.08);
            border-radius:10px;color:#f0f0f0;font-family:'Space Grotesk',sans-serif;font-size:15px;
            outline:none;margin-top:8px;box-sizing:border-box;
          " />
        </div>
        <div class="form-check" style="margin-top:14px;display:flex;gap:10px;align-items:flex-start;">
          <input type="checkbox" id="parentConsent" style="width:18px;height:18px;margin-top:2px;accent-color:#6C63FF;cursor:pointer;flex-shrink:0;" />
          <label for="parentConsent" style="font-size:13px;color:#888;cursor:pointer;line-height:1.5;">
            My parent or guardian has reviewed and approved this account
          </label>
        </div>
        <div class="form-error" id="parentalError" style="margin-top:10px;font-size:13px;border-radius:8px;padding:0;max-height:0;overflow:hidden;transition:all .3s;color:#f87171;background:rgba(248,113,113,.1);border:1px solid rgba(248,113,113,.2);"></div>
        <button onclick="submitWithParentalConsent()" style="
          width:100%;margin-top:20px;padding:16px;background:#6C63FF;color:#fff;border:none;
          border-radius:12px;font-family:'Space Grotesk',sans-serif;font-size:15px;font-weight:700;
          cursor:pointer;transition:.25s cubic-bezier(.4,0,.2,1);
        " onmouseover="this.style.background='#a78bfa'" onmouseout="this.style.background='#6C63FF'">
          Let's Go — Start Earning!
        </button>
        <button onclick="closeParentalModal()" style="
          width:100%;margin-top:10px;padding:12px;background:transparent;color:#888;border:none;
          font-family:'Space Grotesk',sans-serif;font-size:14px;cursor:pointer;
        ">
          Go back
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  requestAnimationFrame(() => {
    document.getElementById('parentalOverlay').classList.add('show');
  });
}

async function submitWithParentalConsent() {
  const parentEmail = (document.getElementById('parentEmail')?.value || '').trim().toLowerCase();
  const consent     = document.getElementById('parentConsent')?.checked;
  const errEl       = document.getElementById('parentalError');

  const showErr = (msg) => {
    if (!errEl) return;
    errEl.textContent = msg;
    errEl.style.padding = '10px 14px';
    errEl.style.maxHeight = '60px';
  };

  if (!parentEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(parentEmail)) {
    showErr('Please enter a valid parent or guardian email.'); return;
  }
  if (!consent) {
    showErr('Please confirm your parent or guardian has approved this account.'); return;
  }

  closeParentalModal();
  const data = { ..._pendingSignup, parentEmail };
  _pendingSignup = null;
  await completeSignUp(data);
}

function closeParentalModal() {
  const modal = document.getElementById('parentalModal');
  if (!modal) return;
  const overlay = document.getElementById('parentalOverlay');
  if (overlay) overlay.classList.remove('show');
  setTimeout(() => modal.remove(), 300);
}

/* ─── SIGN IN ────────────────────────────────────────────────────────────── */
async function handleSignIn(event) {
  event.preventDefault();
  clearErrors();

  let emailOrUser = document.getElementById('signinEmail').value.trim().toLowerCase().replace(/^@/, '');
  const password  = document.getElementById('signinPassword').value;

  if (!emailOrUser) { showFormError('signinError', 'Please enter your email or username.'); return; }
  if (!password)    { showFormError('signinError', 'Please enter your password.'); return; }

  setLoading('signin', true);

  try {
    const sb = getSB();
    if (!sb) throw new Error('Service unavailable. Please try again.');

    // If not an email, look up email by username
    let email = emailOrUser;
    if (!emailOrUser.includes('@')) {
      const { data: lookedUp } = await sb.rpc('get_email_by_username', { p_username: emailOrUser });
      if (!lookedUp) {
        setLoading('signin', false);
        showFormError('signinError', 'No account found with that username.');
        return;
      }
      email = lookedUp;
    }

    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message);

    // If there's a pending profile from signup (email confirmation flow), upsert it now
    try {
      const pending = JSON.parse(localStorage.getItem('thread_pending_profile') || 'null');
      if (pending && data.user && pending.email === email) {
        const profileData = {
          id: data.user.id,
          email: pending.email,
          name: pending.name,
          username: pending.username || null,
          referral_code: pending.referralCode,
          referred_by: pending.referredBy,
          date_of_birth: pending.dob,
        };
        if (pending.parentEmail) { profileData.parent_email = pending.parentEmail; profileData.is_minor = true; }
        await sb.from('profiles').upsert(profileData, { onConflict: 'id' });
        localStorage.removeItem('thread_pending_profile');
      }
    } catch(_) {}

    setLoading('signin', false);
    const _params   = new URLSearchParams(window.location.search);
    const _next     = _params.get('next');
    const _fromEarn = _params.get('from') === 'earn';
    window.location.href = _next || (_fromEarn ? 'index.html?welcome=1' : 'dashboard.html');

  } catch(e) {
    setLoading('signin', false);
    showFormError('signinError', e.message || 'Invalid email or password.');
  }
}

/* ─── FORGOT PASSWORD ────────────────────────────────────────────────────── */
async function handleForgotPassword(event) {
  event.preventDefault();
  clearErrors();

  const email = document.getElementById('forgotEmail').value.trim().toLowerCase();
  if (!email) { showFormError('forgotError', 'Please enter your email.'); return; }

  setLoading('forgot', true);
  try {
    const sb = getSB();
    if (!sb) throw new Error('Service unavailable.');

    const { error } = await sb.auth.resetPasswordForEmail(email, {
      redirectTo: 'https://mythread.shop/auth?tab=reset'
    });
    if (error) throw new Error(error.message);

    setLoading('forgot', false);
    const successEl = document.getElementById('forgotSuccess');
    if (successEl) {
      successEl.textContent = '✓ Reset link sent! Check your inbox at ' + email;
      successEl.classList.add('show');
    }
  } catch(e) {
    setLoading('forgot', false);
    showFormError('forgotError', e.message || 'Something went wrong. Please try again.');
  }
}

/* ─── RESET PASSWORD ─────────────────────────────────────────────────────── */
async function handleResetPassword(event) {
  event.preventDefault();
  clearErrors();

  const password = document.getElementById('resetPassword').value;
  const confirm  = document.getElementById('resetConfirm').value;

  if (password.length < 7) { showFormError('resetError', 'Password must be at least 7 characters.'); return; }
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?`~]/.test(password)) { showFormError('resetError', 'Password must include at least one special character (e.g. !@#$%).'); return; }
  if (password !== confirm) { showFormError('resetError', 'Passwords do not match.'); return; }

  setLoading('reset', true);
  try {
    const sb = getSB();
    if (!sb) throw new Error('Service unavailable.');

    const { error } = await sb.auth.updateUser({ password });
    if (error) throw new Error(error.message);

    setLoading('reset', false);
    // Show success then redirect to dashboard
    const btn = document.getElementById('resetBtn');
    if (btn) btn.innerHTML = '<span class="btn-text">✓ Password updated! Redirecting…</span>';
    setTimeout(() => window.location.href = 'dashboard.html', 1800);
  } catch(e) {
    setLoading('reset', false);
    showFormError('resetError', e.message || 'Something went wrong. Please try again.');
  }
}

/* ─── SUCCESS OVERLAY ────────────────────────────────────────────────────── */
function showSuccessOverlay(name, code) {
  if (!document.getElementById('authSuccessOverlay')) {
    const firstName = (name || 'there').split(' ')[0];
    const referralUrl = `https://mythread.shop/?ref=${encodeURIComponent(code)}`;
    const qrSize = 180; // display size in px

    const el = document.createElement('div');
    el.id = 'authSuccessOverlay';
    el.style.cssText = `
      position:fixed;inset:0;background:rgba(0,0,0,.88);backdrop-filter:blur(14px);
      display:flex;align-items:center;justify-content:center;z-index:10000;
      animation:fadeIn .3s ease;padding:16px;
    `;
    el.innerHTML = `
      <div style="background:#111;border:1px solid rgba(255,255,255,0.1);border-radius:24px;
                  padding:36px 32px;max-width:380px;width:100%;text-align:center;
                  box-shadow:0 24px 64px rgba(0,0,0,0.6);">
        <div style="font-size:36px;margin-bottom:10px">🎉</div>
        <h2 style="font-size:21px;font-weight:700;margin-bottom:6px;color:#f0f0f0">
          Welcome, ${firstName}!
        </h2>
        <p style="color:#777;font-size:13px;margin-bottom:20px;line-height:1.5;">
          Your personal QR code is ready — it goes on every hoodie you order.<br>
          When someone scans it and buys, <strong style="color:#a78bfa">you earn.</strong>
        </p>
        <div style="display:inline-flex;background:#fff;border-radius:16px;padding:12px;
                    margin-bottom:14px;box-shadow:0 4px 20px rgba(0,0,0,0.4);">
          <div id="authQrHolder" style="width:${qrSize}px;height:${qrSize}px;border-radius:10px;overflow:hidden;"></div>
        </div>
        <p style="color:#888;font-size:11px;margin-bottom:20px;font-family:'Space Mono',monospace;
                  letter-spacing:.08em;">
          CODE: ${code}
        </p>
        <div style="width:100%;background:#1a1a1a;border-radius:8px;height:3px;margin-bottom:10px;overflow:hidden">
          <div id="successBar" style="height:100%;background:linear-gradient(90deg,#6C63FF,#a78bfa);
               width:0%;transition:width 3.2s linear;border-radius:8px"></div>
        </div>
        <p style="color:#555;font-size:12px;line-height:1.5;">
          📬 Check your email — click the link to verify and start shopping.
        </p>
      </div>`;
    document.body.appendChild(el);
    setTimeout(() => { const bar = document.getElementById('successBar'); if (bar) bar.style.width = '100%'; }, 60);

    // Render QR — uses QRCodeStyling with the IDENTICAL config as dashboard.js drawQR()
    _buildAuthQR(referralUrl, qrSize);
  }
  // Always send to verify.html — works the same whether they signed up from
  // the main site or the /earn page. The email verification callback handles
  // the redirect to the shop for everyone.
  setTimeout(() => {
    window.location.href = 'verify.html';
  }, 3200);
}

async function _buildAuthQR(referralUrl, size) {
  const div = document.getElementById('authQrHolder');
  if (!div) return;

  const renderSize = size * 4; // 4x for crispness on retina

  if (window.QRCodeStyling) {
    // Convert logo to data URL so QRCodeStyling can embed it (same as dashboard _imgToDataURL)
    let logoDataUrl = null;
    try {
      logoDataUrl = await new Promise(resolve => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          const c = document.createElement('canvas');
          c.width = img.naturalWidth || 64; c.height = img.naturalHeight || 64;
          c.getContext('2d').drawImage(img, 0, 0);
          resolve(c.toDataURL('image/png'));
        };
        img.onerror = () => resolve(null);
        img.src = 'images/Transparent-Logo.webp';
      });
    } catch(_) {}

    // Exact same options used in dashboard.js drawQR()
    const qrOpts = {
      width:  renderSize,
      height: renderSize,
      type:   'canvas',
      data:   referralUrl,
      margin: 0,
      qrOptions: { errorCorrectionLevel: 'H' },
      dotsOptions:          { color: '#000000', type: 'dots' },
      cornersSquareOptions: { color: '#000000', type: 'extra-rounded' },
      cornersDotOptions:    { color: '#000000', type: 'dot' },
      backgroundOptions:    { color: '#ffffff' },
    };
    if (logoDataUrl) {
      qrOpts.image        = logoDataUrl;
      qrOpts.imageOptions = { margin: 6, imageSize: 0.25, hideBackgroundDots: true };
    }
    const qr = new QRCodeStyling(qrOpts);
    qr.append(div);
    // Scale high-res canvas down to display size (same trick as dashboard)
    setTimeout(() => {
      const c = div.querySelector('canvas');
      if (c) { c.style.width = size + 'px'; c.style.height = size + 'px'; }
    }, 400);
    return;
  }

  // Fallback if library failed to load: API image + CSS logo overlay
  const logoSize = Math.round(size * 0.20);
  const encoded  = encodeURIComponent(referralUrl);
  div.style.cssText = `position:relative;width:${size}px;height:${size}px;border-radius:10px;overflow:hidden;`;
  div.innerHTML = `
    <img src="https://api.qrserver.com/v1/create-qr-code/?size=${renderSize}x${renderSize}&data=${encoded}&margin=10&ecc=H"
         width="${size}" height="${size}" style="display:block;image-rendering:crisp-edges;" />
    <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);
                width:${logoSize+8}px;height:${logoSize+8}px;background:#fff;border-radius:6px;
                display:flex;align-items:center;justify-content:center;">
      <img src="images/Transparent-Logo.webp" width="${logoSize}" height="${logoSize}" style="object-fit:contain;" />
    </div>`;
}

/* ─── PASSWORD TOGGLE ────────────────────────────────────────────────────── */
function togglePass(inputId, btn) {
  const input = document.getElementById(inputId);
  if (!input) return;
  input.type = input.type === 'password' ? 'text' : 'password';
  btn.textContent = input.type === 'password' ? '👁' : '🙈';
}
