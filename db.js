/**
 * THREAD Store — Unified Data Layer (db.js)
 *
 * When Supabase is configured → uses real cloud database + auth.
 * When not configured (local dev) → falls back to localStorage.
 * Swap is transparent — all code calls DB.xxx() the same way.
 */

(function () {
  'use strict';

  /* ── Supabase client (lazy init) ──────────────────────────────────────── */
  let _sb = null;

  function getSB() {
    if (_sb) return _sb;
    const cfg = window.THREAD_CONFIG;
    if (!cfg || cfg.supabaseUrl === 'YOUR_SUPABASE_URL') return null;
    if (!window.supabase) return null;
    _sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
    return _sb;
  }

  const isLive = () => !!getSB();

  /* ── In-memory cache ───────────────────────────────────────────────────── */
  let _user    = null;   // Supabase auth user
  let _profile = null;   // profiles table row

  /* ── Helpers ────────────────────────────────────────────────────────────── */
  function simpleHash(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h) ^ str.charCodeAt(i);
    return (h >>> 0).toString(36);
  }

  function generateReferralCode(name) {
    const prefix = name.replace(/[^a-zA-Z]/g, '').toUpperCase().slice(0, 4).padEnd(4, 'X');
    const chars  = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let suffix   = '';
    for (let i = 0; i < 4; i++) suffix += chars[Math.floor(Math.random() * chars.length)];
    return prefix + suffix;
  }

  /* ─────────────────────────────────────────────────────────────────────────
     AUTH
  ───────────────────────────────────────────────────────────────────────── */
  const Auth = {

    async signUp(email, password, name) {
      /* ── Live (Supabase) ── */
      if (isLive()) {
        const { data, error } = await getSB().auth.signUp({ email, password });
        if (error) return { error };

        const referralCode = generateReferralCode(name);
        const { error: pe } = await getSB().from('profiles').insert({
          id: data.user.id, email, name, referral_code: referralCode
        });
        if (pe) return { error: pe };

        _user    = data.user;
        _profile = { id: data.user.id, email, name, referralCode };
        return { data: { user: data.user, profile: _profile }, error: null };
      }

      /* ── Fallback (localStorage) ── */
      const users = JSON.parse(localStorage.getItem('thread_users') || '{}');
      if (users[email]) return { error: { message: 'Email already registered.' } };

      const referralCode = generateReferralCode(name);
      const user = {
        id: 'loc_' + Math.random().toString(36).slice(2, 10),
        email, name, referralCode,
        passwordHash: simpleHash(password),
        stats: { totalScans: 0, conversions: 0, earned: 0, pending: 0, history: [] },
        purchases: [],
        createdAt: Date.now()
      };
      users[email] = user;
      localStorage.setItem('thread_users', JSON.stringify(users));
      localStorage.setItem('thread_session', JSON.stringify(user));
      _profile = user;
      return { data: { user, profile: user }, error: null };
    },

    async signIn(email, password) {
      /* ── Live ── */
      if (isLive()) {
        const { data, error } = await getSB().auth.signInWithPassword({ email, password });
        if (error) return { error };
        _user = data.user;
        return { data, error: null };
      }

      /* ── Fallback ── */
      const users = JSON.parse(localStorage.getItem('thread_users') || '{}');
      const user  = users[email];
      if (!user || user.passwordHash !== simpleHash(password)) {
        return { error: { message: 'Invalid email or password.' } };
      }
      localStorage.setItem('thread_session', JSON.stringify(user));
      _profile = user;
      return { data: { user }, error: null };
    },

    async signOut() {
      if (isLive()) await getSB().auth.signOut();
      localStorage.removeItem('thread_session');
      _user    = null;
      _profile = null;
    },

    /* Returns the auth user (Supabase) or localStorage user */
    async getUser() {
      if (isLive()) {
        if (_user) return _user;
        const { data } = await getSB().auth.getUser();
        _user = data?.user || null;
        return _user;
      }
      return JSON.parse(localStorage.getItem('thread_session'));
    },

    /* Sync — returns cached value without network call */
    getUserSync() {
      if (_user) return _user;
      return JSON.parse(localStorage.getItem('thread_session'));
    },

    onAuthChange(cb) {
      if (!isLive()) return;
      getSB().auth.onAuthStateChange((event, session) => {
        _user = session?.user || null;
        cb(event, _user);
      });
    }
  };

  /* ─────────────────────────────────────────────────────────────────────────
     PROFILES
  ───────────────────────────────────────────────────────────────────────── */
  const Profiles = {

    async get(userId) {
      if (isLive()) {
        if (_profile?.id === userId) return _profile;
        const { data } = await getSB().from('profiles').select('*').eq('id', userId).single();
        _profile = data ? { ...data, referralCode: data.referral_code } : null;
        return _profile;
      }
      const session = JSON.parse(localStorage.getItem('thread_session'));
      return session?.id === userId ? session : null;
    },

    async getByReferralCode(code) {
      if (!code) return null;
      if (isLive()) {
        const { data } = await getSB().from('profiles').select('*')
          .eq('referral_code', code).maybeSingle();
        return data ? { ...data, referralCode: data.referral_code } : null;
      }
      const users = JSON.parse(localStorage.getItem('thread_users') || '{}');
      return Object.values(users).find(u => u.referralCode === code) || null;
    },

    async getStats(userId) {
      if (isLive()) {
        const { data } = await getSB().from('referral_scans').select('*')
          .eq('referrer_id', userId);
        const scans       = data || [];
        const conversions = scans.filter(s => s.converted);
        const earned      = conversions.reduce((s, r) => s + (r.commission || 0), 0);
        const pendingRows = scans.filter(s => s.converted && s.status === 'pending');
        const pending     = pendingRows.reduce((s, r) => s + (r.commission || 0), 0);
        return { totalScans: scans.length, conversions: conversions.length, earned, pending, history: scans };
      }
      const session = JSON.parse(localStorage.getItem('thread_session'));
      return session?.stats || { totalScans: 0, conversions: 0, earned: 0, pending: 0, history: [] };
    }
  };

  /* ─────────────────────────────────────────────────────────────────────────
     ORDERS
  ───────────────────────────────────────────────────────────────────────── */
  const Orders = {

    async create(orderData) {
      if (isLive()) {
        const { data, error } = await getSB().from('orders').insert(orderData).select().single();
        return { data, error };
      }
      // Fallback
      const orders = JSON.parse(localStorage.getItem('thread_orders') || '[]');
      const order  = { id: 'LS-' + Date.now(), ...orderData, created_at: new Date().toISOString() };
      orders.unshift(order);
      localStorage.setItem('thread_orders', JSON.stringify(orders));
      return { data: order, error: null };
    },

    /* Admin: get all orders */
    async getAll() {
      if (isLive()) {
        const { data } = await getSB().from('orders')
          .select('*')
          .order('created_at', { ascending: false });
        return data || [];
      }
      return JSON.parse(localStorage.getItem('thread_orders') || '[]');
    },

    async getByUser(userId) {
      if (isLive()) {
        const { data } = await getSB().from('orders').select('*')
          .eq('user_id', userId).order('created_at', { ascending: false });
        return data || [];
      }
      const session = JSON.parse(localStorage.getItem('thread_session'));
      return session?.purchases || [];
    },

    async updateStatus(orderId, status) {
      if (isLive()) {
        await getSB().from('orders').update({ status }).eq('id', orderId);
        return;
      }
      const orders = JSON.parse(localStorage.getItem('thread_orders') || '[]');
      const idx    = orders.findIndex(o => o.id === orderId);
      if (idx !== -1) { orders[idx].status = status; localStorage.setItem('thread_orders', JSON.stringify(orders)); }
    }
  };

  /* ─────────────────────────────────────────────────────────────────────────
     REFERRAL SCANS
  ───────────────────────────────────────────────────────────────────────── */
  const Referrals = {

    async logScan(referralCode, referrerId, meta = {}) {
      if (isLive()) {
        const { data } = await getSB().from('referral_scans').insert({
          referral_code: referralCode,
          referrer_id:   referrerId,
          converted:     false,
          city:          meta.city || null
        }).select().single();
        return data;
      }
      return null;
    },

    async markConverted(referralCode, orderId, commission) {
      if (isLive()) {
        // Mark the most recent unconverted scan for this referral code
        const { data } = await getSB().from('referral_scans')
          .select('id').eq('referral_code', referralCode).eq('converted', false)
          .order('created_at', { ascending: false }).limit(1);
        if (data?.length) {
          await getSB().from('referral_scans')
            .update({ converted: true, order_id: orderId, commission, status: 'pending' })
            .eq('id', data[0].id);
        }
        return;
      }
      // Fallback: update referrer's localStorage stats
      const users    = JSON.parse(localStorage.getItem('thread_users') || '{}');
      const refEmail = Object.keys(users).find(e => users[e].referralCode === referralCode);
      if (!refEmail) return;
      const ref = users[refEmail];
      if (!ref.stats) ref.stats = { totalScans: 0, conversions: 0, earned: 0, pending: 0, history: [] };
      ref.stats.conversions++;
      ref.stats.earned  += commission;
      ref.stats.pending += commission;
      ref.stats.history.unshift({ type: 'conversion', orderId, commission, ts: Date.now() });
      users[refEmail] = ref;
      localStorage.setItem('thread_users', JSON.stringify(users));
      // Update session if this is the active user
      const session = JSON.parse(localStorage.getItem('thread_session'));
      if (session?.email === refEmail) localStorage.setItem('thread_session', JSON.stringify(ref));
    },

    async getForUser(userId) {
      if (isLive()) {
        const { data } = await getSB().from('referral_scans').select('*')
          .eq('referrer_id', userId).order('created_at', { ascending: false });
        return data || [];
      }
      const session = JSON.parse(localStorage.getItem('thread_session'));
      return session?.stats?.history || [];
    },

    /* Count lifetime converted referrals for a user — used by tier system */
    async countConvertedFor(userId) {
      if (isLive()) {
        const { count } = await getSB().from('referral_scans')
          .select('id', { count: 'exact', head: true })
          .eq('referrer_id', userId).eq('converted', true);
        return count || 0;
      }
      const session = JSON.parse(localStorage.getItem('thread_session'));
      return session?.stats?.conversions || 0;
    },

    /* Same as above but by referral code (used when we don't have the user ID) */
    async countConvertedForCode(referralCode) {
      if (!referralCode) return 0;
      if (isLive()) {
        const { count } = await getSB().from('referral_scans')
          .select('id', { count: 'exact', head: true })
          .eq('referral_code', referralCode).eq('converted', true);
        return count || 0;
      }
      const users = JSON.parse(localStorage.getItem('thread_users') || '{}');
      const refEmail = Object.keys(users).find(e => users[e].referralCode === referralCode);
      return refEmail ? (users[refEmail].stats?.conversions || 0) : 0;
    },

    /* Admin: all scans */
    async getAll() {
      if (isLive()) {
        const { data } = await getSB().from('referral_scans')
          .select('*').order('created_at', { ascending: false }).limit(200);
        return data || [];
      }
      return [];
    },

    /* Supabase real-time subscription — fires callback when a new scan is inserted */
    subscribeToScans(referrerId, onScan) {
      if (!isLive()) return null;
      return getSB()
        .channel('live_scans_' + referrerId)
        .on('postgres_changes', {
          event:  'INSERT',
          schema: 'public',
          table:  'referral_scans',
          filter: `referrer_id=eq.${referrerId}`
        }, payload => onScan(payload.new))
        .subscribe();
    }
  };

  /* ─────────────────────────────────────────────────────────────────────────
     CUSTOMERS (admin only)
  ───────────────────────────────────────────────────────────────────────── */
  const Customers = {
    async getAll() {
      if (isLive()) {
        const { data } = await getSB().from('profiles')
          .select('*')
          .order('created_at', { ascending: false });
        return data || [];
      }
      const users = JSON.parse(localStorage.getItem('thread_users') || '{}');
      return Object.values(users);
    }
  };

  /* ── Expose globally ────────────────────────────────────────────────────── */
  window.DB = {
    isLive,
    auth:          Auth,
    profiles:      Profiles,
    orders:        Orders,
    referrals:     Referrals,
    customers:     Customers,
    generateReferralCode,
    simpleHash,
    getSB
  };

})();
