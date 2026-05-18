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

  // Prevent future dates in the DOB picker
  const dobInput = document.getElementById('signupDob');
  if (dobInput) dobInput.max = new Date().toISOString().split('T')[0];
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
  const dob      = document.getElementById('signupDob').value;
  const email    = document.getElementById('signupEmail').value.trim().toLowerCase();
  const password = document.getElementById('signupPassword').value;
  const confirm  = document.getElementById('signupConfirm').value;
  const terms    = document.getElementById('agreeTerms').checked;

  if (!name)     { showFormError('signupError', 'Please enter your full name.'); return; }
  if (!dob)      { showFormError('signupError', 'Please enter your date of birth.'); return; }

  const age = calculateAge(dob);
  if (age < 13)  { showFormError('signupError', 'You must be at least 13 years old to create an account.'); return; }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showFormError('signupError', 'Please enter a valid email.'); return; }
  if (password.length < 6)  { showFormError('signupError', 'Password must be at least 6 characters.'); return; }
  if (password !== confirm)  { showFormError('signupError', 'Passwords do not match.'); return; }
  if (!terms)    { showFormError('signupError', 'You must agree to the terms to continue.'); return; }

  if (age < 18) {
    showParentalConsentModal({ name, dob, email, password });
    return;
  }

  await completeSignUp({ name, dob, email, password });
}

async function completeSignUp({ name, dob, email, password, parentEmail = null }) {
  setLoading('signup', true);
  try {
    const sb = getSB();
    if (!sb) throw new Error('Service unavailable. Please try again.');

    const { data, error } = await sb.auth.signUp({ email, password });
    if (error) throw new Error(error.message);

    const referralCode = generateReferralCode(name);
    const referredBy   = (localStorage.getItem('thread_ref') || '').trim() || null;
    const profileData  = {
      id: data.user.id, email, name,
      referral_code: referralCode,
      referred_by:   referredBy,
      date_of_birth: dob,
    };
    if (parentEmail) {
      profileData.parent_email = parentEmail;
      profileData.is_minor     = true;
    }
    await sb.from('profiles').upsert(profileData, { onConflict: 'id' });

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
