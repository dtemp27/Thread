/* ─────────────────────────────────────────────────────────────────────────
   THREAD — Giveaway Admin  (giveaway-admin.js v2)
   Standalone admin page for giveaway submissions.
   Requires: config.js (window.THREAD_CONFIG), supabase.min.js
───────────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  /* ── Supabase ── */
  const cfg = window.THREAD_CONFIG;
  const sb  = (cfg?.supabaseUrl && cfg.supabaseUrl !== 'YOUR_SUPABASE_URL' && window.supabase)
    ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey)
    : null;

  /* ── Gate: check on load ── */
  (function init() {
    if (sessionStorage.getItem('thread_admin_authed') === '1') {
      unlock();
    }
    const p = document.getElementById('gatePass');
    if (p) setTimeout(() => p.focus(), 100);
  })();

  /* ── Password check ── */
  window.gaCheckGate = function () {
    const pass  = (document.getElementById('gatePass')?.value || '').trim();
    const errEl = document.getElementById('gaGateError');
    if (!cfg?.adminPassword) {
      if (errEl) errEl.textContent = 'Admin password not configured.';
      return;
    }
    if (pass === cfg.adminPassword) {
      sessionStorage.setItem('thread_admin_authed', '1');
      if (errEl) errEl.textContent = '';
      unlock();
    } else {
      if (errEl) errEl.textContent = 'Incorrect password — try again.';
      const input = document.getElementById('gatePass');
      if (input) { input.value = ''; input.focus(); }
    }
  };

  /* ── Unlock: hide gate, show app ── */
  function unlock() {
    const gate = document.getElementById('gaGate');
    const app  = document.getElementById('gaApp');
    if (gate) gate.style.display = 'none';
    if (app)  app.style.display  = 'flex';
    gaLoad();
  }

  /* ── Sign out ── */
  window.gaSignOut = function () {
    sessionStorage.removeItem('thread_admin_authed');
    location.reload();
  };

  /* ── Entry cache + selection ── */
  let _entries    = [];
  let _selectedIds = new Set();

  /* ── Load data ── */
  window.gaLoad = async function () {
    _selectedIds.clear();
    updateDeleteBtn();

    const selectAll = document.getElementById('gaSelectAll');
    if (selectAll) selectAll.checked = false;

    const body = document.getElementById('gaBody');
    if (body) body.innerHTML = '<tr><td colspan="8" class="ga-empty">Loading…</td></tr>';

    if (!sb) {
      if (body) body.innerHTML = '<tr><td colspan="8" class="ga-empty">Supabase not configured.</td></tr>';
      return;
    }

    try {
      const { data, error } = await sb.rpc('get_giveaway_entries');
      if (error) throw error;
      _entries = Array.isArray(data) ? data : [];
      renderTable(_entries);
      renderStats(_entries);
      const hint = document.getElementById('gaLastRefresh');
      if (hint) hint.textContent = 'Updated ' + new Date().toLocaleTimeString();
    } catch (e) {
      console.error('[GA] load error', e);
      if (body) body.innerHTML = '<tr><td colspan="8" class="ga-empty">Error loading data — ' + (e.message || 'unknown') + '</td></tr>';
    }
  };

  /* ── Render stats ── */
  function renderStats(entries) {
    const today   = new Date().toISOString().slice(0, 10);
    const total   = entries.length;
    const todayCt = entries.filter(e => (e.created_at || '').slice(0, 10) === today).length;
    const tees    = entries.filter(e => e.prize_choice === 'tees').length;
    const hoodie  = entries.filter(e => e.prize_choice === 'hoodie').length;
    setText('gaTotal',  total);
    setText('gaToday',  todayCt);
    setText('gaTees',   tees);
    setText('gaHoodie', hoodie);
  }

  /* ── Render table (with checkboxes) ── */
  function renderTable(entries) {
    const body = document.getElementById('gaBody');
    if (!body) return;

    if (!entries.length) {
      body.innerHTML = '<tr><td colspan="8" class="ga-empty">No entries yet.</td></tr>';
      return;
    }

    const sorted = [...entries].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    body.innerHTML = sorted.map((e, i) => {
      const id       = esc(e.id || '');
      const num      = sorted.length - i;
      const name     = esc(e.name  || '—');
      const email    = esc(e.email || '—');
      const ig       = e.instagram
        ? `<a href="https://instagram.com/${esc(e.instagram)}" target="_blank" style="color:#e879f9;text-decoration:none">@${esc(e.instagram)}</a>`
        : '—';
      const prize    = prizeBadge(e.prize_choice);
      const location = esc([e.city, e.country].filter(Boolean).join(', ') || '—');
      const date     = e.created_at ? fmtDate(e.created_at) : '—';
      const checked  = _selectedIds.has(e.id) ? 'checked' : '';

      return `<tr data-id="${id}">
        <td class="ga-check-td"><input type="checkbox" class="ga-check ga-row-check" data-id="${id}" ${checked} /></td>
        <td style="color:#555;font-size:12px">${num}</td>
        <td style="font-weight:600;color:#fff">${name}</td>
        <td>${email}</td>
        <td>${ig}</td>
        <td>${prize}</td>
        <td>${location}</td>
        <td style="white-space:nowrap;color:#555;font-size:12px">${date}</td>
      </tr>`;
    }).join('');

    /* Event delegation — one listener on the tbody */
    body.addEventListener('change', onRowCheckChange);
  }

  function onRowCheckChange(ev) {
    const cb = ev.target.closest('.ga-row-check');
    if (!cb) return;
    const id = cb.dataset.id;
    if (!id) return;
    if (cb.checked) _selectedIds.add(id);
    else            _selectedIds.delete(id);
    updateDeleteBtn();
    syncSelectAllCheckbox();
  }

  /* ── Select-all toggle ── */
  window.gaToggleSelectAll = function (masterCb) {
    const body = document.getElementById('gaBody');
    if (!body) return;
    body.querySelectorAll('.ga-row-check').forEach(cb => {
      cb.checked = masterCb.checked;
      const id = cb.dataset.id;
      if (!id) return;
      if (masterCb.checked) _selectedIds.add(id);
      else                  _selectedIds.delete(id);
    });
    updateDeleteBtn();
  };

  function syncSelectAllCheckbox() {
    const selectAll = document.getElementById('gaSelectAll');
    if (!selectAll) return;
    const allBoxes = document.querySelectorAll('.ga-row-check');
    if (!allBoxes.length) { selectAll.checked = false; selectAll.indeterminate = false; return; }
    const checkedCount = [...allBoxes].filter(cb => cb.checked).length;
    if (checkedCount === 0)               { selectAll.checked = false; selectAll.indeterminate = false; }
    else if (checkedCount === allBoxes.length) { selectAll.checked = true;  selectAll.indeterminate = false; }
    else                                  { selectAll.checked = false; selectAll.indeterminate = true;  }
  }

  /* ── Delete Selected ── */
  window.gaDeleteSelected = async function () {
    const ids = [..._selectedIds];
    if (!ids.length) return;

    const confirmed = confirm(
      `Delete ${ids.length} selected entr${ids.length === 1 ? 'y' : 'ies'}?\n\nThis cannot be undone.`
    );
    if (!confirmed) return;

    if (!sb) { alert('Supabase not configured.'); return; }

    try {
      const { error } = await sb.rpc('delete_giveaway_entries', { p_ids: ids });
      if (error) throw error;
      _selectedIds.clear();
      await gaLoad();
    } catch (e) {
      alert('Error deleting entries: ' + (e.message || 'unknown'));
    }
  };

  function updateDeleteBtn() {
    const btn   = document.getElementById('gaDeleteSelectedBtn');
    if (!btn) return;
    const count = _selectedIds.size;
    btn.disabled     = count === 0;
    btn.textContent  = count > 0
      ? `🗑 Delete Selected (${count})`
      : '🗑 Delete Selected';
  }

  /* ── Pick winner ── */
  window.gaPickWinner = function () {
    if (!_entries.length) { alert('No entries to pick from.'); return; }
    const winner = _entries[Math.floor(Math.random() * _entries.length)];
    setText('gaWinnerName',  winner.name      || '—');
    setText('gaWinnerEmail', winner.email     || '—');
    setText('gaWinnerIg',    winner.instagram ? '@' + winner.instagram : '—');
    setText('gaWinnerPrize', prizeText(winner.prize_choice));
    const modal = document.getElementById('gaWinnerModal');
    if (modal) modal.classList.add('open');
  };

  window.closeWinnerModal = function () {
    const modal = document.getElementById('gaWinnerModal');
    if (modal) modal.classList.remove('open');
  };

  /* ── Export CSV ── */
  window.gaExportCSV = function () {
    if (!_entries.length) { alert('No entries to export.'); return; }
    const headers = ['#', 'Name', 'Email', 'Instagram', 'Prize', 'Source', 'IP', 'City', 'Date'];
    const sorted  = [..._entries].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    const rows    = sorted.map((e, i) => [
      sorted.length - i,
      q(e.name), q(e.email), q(e.instagram), q(e.prize_choice),
      q(e.source), q(e.ip), q(e.city),
      q(e.created_at ? new Date(e.created_at).toLocaleString() : ''),
    ].join(','));
    const csv  = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = 'thread-giveaway-entries-' + new Date().toISOString().slice(0, 10) + '.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  /* ── Clear ALL entries ── */
  window.gaClearAll = async function () {
    if (!_entries.length) { alert('No entries to clear.'); return; }
    const confirmed = confirm(
      'Delete ALL ' + _entries.length + ' giveaway entries?\n\nThis cannot be undone.'
    );
    if (!confirmed) return;
    if (!sb) { alert('Supabase not configured.'); return; }
    try {
      const { error } = await sb.rpc('clear_giveaway_entries');
      if (error) throw error;
      _selectedIds.clear();
      await gaLoad();
    } catch (e) {
      alert('Error clearing entries: ' + (e.message || 'unknown'));
    }
  };

  /* ── Helpers ── */
  function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  function esc(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function q(val) {
    const s = String(val == null ? '' : val).replace(/"/g, '""');
    return '"' + s + '"';
  }

  function fmtDate(iso) {
    try {
      return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch (_) { return iso; }
  }

  function prizeBadge(prize) {
    if (prize === 'tees')   return '<span style="background:rgba(124,58,237,0.2);color:#a78bfa;border:1px solid rgba(124,58,237,0.3);border-radius:6px;padding:2px 8px;font-size:11px;font-weight:700;white-space:nowrap">👕 2 Tees</span>';
    if (prize === 'hoodie') return '<span style="background:rgba(251,191,36,0.12);color:#fbbf24;border:1px solid rgba(251,191,36,0.25);border-radius:6px;padding:2px 8px;font-size:11px;font-weight:700;white-space:nowrap">🧥 Hoodie</span>';
    return '<span style="color:#555">—</span>';
  }

  function prizeText(prize) {
    if (prize === 'tees')   return '👕 2 Tees (any style, any size)';
    if (prize === 'hoodie') return '🧥 1 Hoodie (any style, any size)';
    return 'Prize not selected';
  }

})();
