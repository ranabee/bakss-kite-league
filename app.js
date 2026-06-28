/* ============================================================
   BAKSS Kite League Manager Pro — v2.0
   Live Supabase · Real Schema · Multi-Club SaaS
   ============================================================ */

'use strict';

// ============================================================
// CONFIG
// ============================================================
const CONFIG = {
  supabaseUrl: 'https://fblzbbbftapygeurseza.supabase.co',
  supabaseKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZibHpiYmJmdGFweWdldXJzZXphIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE0Njk4ODgsImV4cCI6MjA5NzA0NTg4OH0.tLmp-zuYC6RpewFujYSqNoITNpRISoEwoaF7XPHwM-s',
  version: '2.0.0',
  plans: {
    trial:    { name: 'Free Trial',  price: 0,   maxPlayers: 20  },
    small:    { name: 'Small Club',  price: 5,   maxPlayers: 30  },
    standard: { name: 'Standard',   price: 10,  maxPlayers: 75  },
    large:    { name: 'Large Club',  price: 20,  maxPlayers: 200 },
  },
};

// ============================================================
// STATE
// ============================================================
const State = {
  db:          null,   // Supabase client
  user:        null,   // auth user
  clubUser:    null,   // club_users row
  club:        null,   // clubs row
  isAdmin:     false,  // shortcut
  view:        null,
  data:        {},
  deferredInstall: null,
};

// ============================================================
// SUPABASE INIT
// ============================================================
function initSupabase() {
  return window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true }
  });
}

// ============================================================
// DATABASE — uses existing kite_* schema
// ============================================================
const DB = {
  // ---- Auth ----
  async signIn(email, pw)    { return State.db.auth.signInWithPassword({ email, password: pw }); },
  async signOut()            { return State.db.auth.signOut(); },
  async resetPw(email)       { return State.db.auth.resetPasswordForEmail(email, { redirectTo: location.href }); },
  async updatePw(pw)         { return State.db.auth.updateUser({ password: pw }); },

  // ---- Club user lookup ----
  async getClubUser(userId) {
    return State.db.from('club_users')
      .select('*, clubs(*), subscriptions(*)')
      .eq('user_id', userId).eq('status','active').maybeSingle();
  },

  // ---- Players (kite_players) ----
  async getPlayers() {
    return State.db.from('kite_players').select('*').order('name');
  },
  async createPlayer(name) {
    return State.db.from('kite_players')
      .insert({ name, name_lower: name.toLowerCase().trim(), active: true })
      .select().single();
  },
  async togglePlayer(id, active) {
    return State.db.from('kite_players').update({ active }).eq('id', id);
  },
  async updatePlayerName(id, name) {
    return State.db.from('kite_players')
      .update({ name, name_lower: name.toLowerCase().trim() }).eq('id', id);
  },

  // ---- Seasons (kite_seasons) ----
  async getSeasons() {
    return State.db.from('kite_seasons').select('*').order('created_at', { ascending: false });
  },
  async createSeason(name) {
    return State.db.from('kite_seasons').insert({ name, is_active: false }).select().single();
  },
  async setActiveSeason(id) {
    await State.db.from('kite_seasons').update({ is_active: false }).neq('id', id);
    return State.db.from('kite_seasons').update({ is_active: true }).eq('id', id);
  },

  // ---- Matches (kite_matches) ----
  async getMatches(season, limit = 50) {
    let q = State.db.from('kite_matches')
      .select(`id, match_date, season, status, notes, submitted_by,
               winner:winner_id(id,name), loser:loser_id(id,name)`)
      .order('match_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(limit);
    if (season) q = q.eq('season', season);
    return q;
  },
  async submitMatch(winnerId, loserId, season, matchDate, notes, submittedBy) {
    const status = State.isAdmin ? 'approved' : 'pending';
    return State.db.from('kite_matches').insert({
      winner_id: winnerId, loser_id: loserId,
      season, match_date: matchDate || todayStr(),
      notes: notes || null, submitted_by: submittedBy || 'App',
      status, approved_by: State.isAdmin ? State.user?.email || 'Admin' : null,
      approved_at: State.isAdmin ? new Date().toISOString() : null,
    }).select().single();
  },
  async approveMatch(id) {
    return State.db.from('kite_matches').update({
      status: 'approved',
      approved_by: State.user?.email || 'Admin',
      approved_at: new Date().toISOString(),
    }).eq('id', id);
  },
  async rejectMatch(id) {
    return State.db.from('kite_matches').update({ status: 'rejected' }).eq('id', id);
  },
  async deleteMatch(id) {
    return State.db.from('kite_matches').delete().eq('id', id);
  },

  // ---- Leaderboard ----
  async getLeaderboard(season) {
    let q = State.db.from('kite_matches')
      .select('winner_id, loser_id, winner:winner_id(id,name), loser:loser_id(id,name)')
      .eq('status', 'approved');
    if (season) q = q.eq('season', season);
    return q;
  },

  // ---- Settings (kite_settings) ----
  async getSettings() {
    return State.db.from('kite_settings').select('*');
  },
  async setSetting(key, value) {
    return State.db.from('kite_settings')
      .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  },

  // ---- Teams (kite_teams) ----
  async getTeams(season) {
    let q = State.db.from('kite_teams').select('*').order('created_at', { ascending: false });
    if (season) q = q.eq('season', season);
    return q;
  },

  // ---- Club management ----
  async getClub() {
    return State.db.from('clubs').select('*, subscriptions(*)').eq('slug','bakss').maybeSingle();
  },
  async getClubUsers() {
    return State.db.from('club_users').select('*').eq('club_id', State.club?.id);
  },
  async inviteUser(email, role) {
    return State.db.from('invitations').insert({
      club_id: State.club?.id, email, role, invited_by: State.user.id,
    }).select().single();
  },
};

// ============================================================
// UI HELPERS
// ============================================================
const UI = {
  setContent(html) { document.getElementById('main-content').innerHTML = html; },

  setActiveNav(view) {
    document.querySelectorAll('.nav-item').forEach(el =>
      el.classList.toggle('active', el.dataset.view === view));
  },

  showNav(show) {
    const n = document.getElementById('bottom-nav');
    if (n) n.style.display = show ? 'flex' : 'none';
  },

  toast(msg, type = 'info') {
    const icons = {
      success: `<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg>`,
      error:   `<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6M9 9l6 6"/></svg>`,
      info:    `<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
    };
    const t = document.createElement('div');
    t.className = `toast toast-${type}`;
    t.innerHTML = `${icons[type]}<span class="toast-msg">${escHtml(msg)}</span>`;
    document.getElementById('toast-container').appendChild(t);
    setTimeout(() => t.remove(), 3500);
  },

  showSheet(id) {
    document.getElementById('overlay').classList.add('show');
    document.getElementById(id)?.classList.add('show');
  },
  hideSheet(id) {
    document.getElementById('overlay').classList.remove('show');
    document.getElementById(id)?.classList.remove('show');
  },
  hideAllSheets() {
    document.getElementById('overlay').classList.remove('show');
    document.querySelectorAll('.sheet, .modal').forEach(s => s.classList.remove('show'));
  },

  async confirm(title, msg) {
    return new Promise(resolve => {
      document.getElementById('confirm-title').textContent = title;
      document.getElementById('confirm-msg').textContent   = msg;
      document.getElementById('overlay').classList.add('show');
      document.getElementById('confirm-modal').classList.add('show');
      document.getElementById('confirm-yes').onclick = () => { this.hideAllSheets(); resolve(true); };
      document.getElementById('confirm-no').onclick  = () => { this.hideAllSheets(); resolve(false); };
    });
  },

  btnLoad(btn, on) {
    if (!btn) return;
    if (on) { btn.dataset.orig = btn.innerHTML; btn.innerHTML = `<div class="spinner" style="width:20px;height:20px;border-width:2px"></div>`; btn.disabled = true; }
    else    { btn.innerHTML = btn.dataset.orig || btn.innerHTML; btn.disabled = false; }
  },

  initials: name => (name||'?').split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2),

  statusBadge(s) {
    const m = { active:'badge-green', approved:'badge-green', pending:'badge-gold',
                rejected:'badge-red', inactive:'badge-grey', trial:'badge-gold',
                completed:'badge-grey', locked:'badge-red', past_due:'badge-red' };
    return `<span class="badge ${m[s]||'badge-grey'}">${capitalize(s)}</span>`;
  },

  roleBadge(r) {
    const l = { super_admin:'Super Admin', club_admin:'Admin', club_staff:'Staff', player:'Player', viewer:'Viewer' };
    return `<span class="badge role-${r}">${l[r]||r}</span>`;
  },

  skeleton: (n=3) => Array(n).fill(0).map(()=>`
    <div class="list-row">
      <div class="skeleton" style="width:44px;height:44px;border-radius:12px;flex-shrink:0"></div>
      <div style="flex:1;display:flex;flex-direction:column;gap:8px">
        <div class="skeleton" style="height:14px;width:60%"></div>
        <div class="skeleton" style="height:12px;width:40%"></div>
      </div>
    </div>`).join(''),

  empty: (icon, title, sub, action='') => `
    <div class="empty-state">
      <div class="empty-icon">${icon}</div>
      <div class="empty-title">${title}</div>
      <div class="empty-sub">${sub}</div>
      ${action}
    </div>`,
};

// ============================================================
// VIEWS
// ============================================================
const Views = {

  // ----------------------------------------------------------
  // LOGIN
  // ----------------------------------------------------------
  login() {
    UI.showNav(false);
    UI.setContent(`
    <div class="login-page">
      <img src="./icons/logo.png" class="login-logo-img" alt="BAKSS Kite League">
      <div class="login-subtitle">Admin Portal</div>

      <div class="login-form">
        <div class="form-group">
          <label class="form-label">Email</label>
          <input id="login-email" type="email" class="form-input" placeholder="admin@bakss.co.uk" autocomplete="email">
        </div>
        <div class="form-group">
          <label class="form-label">Password</label>
          <div class="input-group">
            <input id="login-pw" type="password" class="form-input" placeholder="Password" autocomplete="current-password">
            <span class="input-group-icon" onclick="togglePw('login-pw',this)">${ICONS.eye}</span>
          </div>
        </div>
        <div id="login-err" class="form-error"></div>
        <button id="login-btn" class="btn btn-primary mt-16" onclick="Auth.login()">Sign In to Admin</button>
        <div class="text-center mt-16">
          <a href="#" onclick="Views.forgotPw()" class="text-muted text-sm">Forgot password?</a>
        </div>
        <div class="divider">or</div>
        <button class="btn btn-secondary btn-full" onclick="Auth.viewPublic()">
          ${ICONS.leaderboard}&nbsp; View Public Leaderboard
        </button>
      </div>

      ${State.deferredInstall ? `
      <div class="install-banner mt-16" onclick="Auth.installPWA()">
        <img src="./icons/logo.png" style="width:36px;height:36px;border-radius:8px;object-fit:contain" alt="">
        <div class="install-banner-text">
          <strong>Install BAKSS App</strong>
          <span>Add to Home Screen for best experience</span>
        </div>
        ${ICONS.chevronRight}
      </div>` : ''}

      <div class="login-footer mt-16">
        BAKSS Kite League Manager Pro v${CONFIG.version}<br>
        <span style="font-size:11px;color:var(--text-dim)">Admin access only · Public leaderboard above</span>
      </div>
    </div>`);

    document.getElementById('login-pw')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') Auth.login();
    });
  },

  forgotPw() {
    UI.setContent(`
    <div class="login-page">
      <button class="btn btn-secondary btn-sm mb-16" onclick="Router.go('login')">← Back</button>
      <img src="./icons/logo.png" class="login-logo-img" style="width:80px;height:80px" alt="BAKSS">
      <div class="login-subtitle" style="margin-top:12px">Reset Password</div>
      <div class="form-group mt-24">
        <label class="form-label">Email Address</label>
        <input id="reset-email" type="email" class="form-input" placeholder="admin@bakss.co.uk">
      </div>
      <div id="reset-err" class="form-error"></div>
      <button id="reset-btn" class="btn btn-primary mt-8" onclick="Auth.sendReset()">Send Reset Link</button>
    </div>`);
  },

  // ----------------------------------------------------------
  // DASHBOARD
  // ----------------------------------------------------------
  async dashboard() {
    UI.showNav(true);
    UI.setActiveNav('dashboard');
    const settings = State.data.settings || {};
    const leagueName   = settings.league_name   || 'BAKSS Kite League';
    const currentSeason = settings.current_season || 'Current Season';

    UI.setContent(`
    <div class="app-header">
      <img src="./icons/logo.png" class="header-logo" alt="BAKSS">
      <div class="header-title">${escHtml(leagueName)}</div>
      ${State.isAdmin ? `<span class="header-badge">ADMIN</span>` : ''}
    </div>
    <div class="scroll-content">
      ${!State.isAdmin ? `
      <div class="card" style="border-color:var(--gold-border);background:var(--gold-dim);margin-bottom:12px">
        <div class="flex items-center gap-8">
          ${ICONS.info}
          <span class="text-sm">Viewing as public · <a href="#" onclick="Router.go('login')" style="color:var(--gold)">Admin login</a></span>
        </div>
      </div>` : ''}

      <div id="dash-stats">${UI.skeleton(2)}</div>
      <div id="dash-recent"></div>
    </div>`);

    // Load stats
    const [matchRes, playerRes] = await Promise.all([
      DB.getMatches(currentSeason, 200),
      DB.getPlayers(),
    ]);
    const matches  = matchRes.data  || [];
    const players  = playerRes.data || [];
    State.data.players = players;
    State.data.currentSeason = currentSeason;

    const approved = matches.filter(m => m.status === 'approved');
    const pending  = matches.filter(m => m.status === 'pending');
    const todayM   = approved.filter(m => m.match_date === todayStr());

    document.getElementById('dash-stats').innerHTML = `
    <div class="card card-gold mb-12">
      <div class="card-title" style="color:rgba(8,16,31,0.65)">Active Season</div>
      <div class="card-value" style="color:var(--bg);font-size:22px">${escHtml(currentSeason)}</div>
      <div style="font-size:13px;color:rgba(8,16,31,0.6);margin-top:6px">${approved.length} matches recorded</div>
    </div>
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-icon">${ICONS.users}</div>
        <div class="stat-value">${players.filter(p=>p.active).length}</div>
        <div class="stat-label">Active Players</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon">${ICONS.trophy}</div>
        <div class="stat-value">${approved.length}</div>
        <div class="stat-label">Total Wins</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon">${ICONS.cut}</div>
        <div class="stat-value">${todayM.length}</div>
        <div class="stat-label">Today</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="${pending.length>0?'background:rgba(251,191,36,0.15);color:var(--warning)':''}">${ICONS.clock}</div>
        <div class="stat-value" style="${pending.length>0?'color:var(--warning)':''}">${pending.length}</div>
        <div class="stat-label">Pending</div>
      </div>
    </div>`;

    const recent = matches.slice(0,5);
    document.getElementById('dash-recent').innerHTML = `
    <div class="section-header">
      <div class="section-title">Recent Matches</div>
      <a class="section-link" onclick="Router.go('matches')">View All</a>
    </div>
    ${recent.length ? recent.map(m => matchRow(m, State.isAdmin)).join('') :
      UI.empty(ICONS.cut, 'No Matches Yet', 'Record the first cut of the season!')}
    <button class="btn btn-secondary btn-full mt-16" onclick="Router.go('leaderboard')">
      ${ICONS.leaderboard}&nbsp; Full Leaderboard
    </button>`;
  },

  // ----------------------------------------------------------
  // PLAYERS
  // ----------------------------------------------------------
  async players() {
    UI.showNav(true);
    UI.setActiveNav('players');

    UI.setContent(`
    <div class="app-header">
      <div class="header-title">Players</div>
      ${State.isAdmin ? `<button class="header-action" onclick="Views.addPlayerSheet()">${ICONS.plus}</button>` : ''}
    </div>
    <div class="scroll-content">
      <div class="search-bar">
        ${ICONS.search}
        <input class="form-input" id="player-search" placeholder="Search players…" oninput="Views.filterPlayers(this.value)">
      </div>
      <div id="players-list">${UI.skeleton()}</div>
    </div>
    ${State.isAdmin ? `<button class="fab" onclick="Views.addPlayerSheet()">${ICONS.plus}</button>` : ''}`);

    const { data } = await DB.getPlayers();
    State.data.players = data || [];
    Views.renderPlayers(State.data.players);
  },

  renderPlayers(list) {
    const el = document.getElementById('players-list');
    if (!el) return;
    if (!list.length) { el.innerHTML = UI.empty(ICONS.users,'No Players','No players found'); return; }
    el.innerHTML = list.map(p => `
    <div class="list-row" onclick="${State.isAdmin ? `Views.editPlayerSheet('${p.id}')` : ''}">
      <div class="list-row-avatar">${UI.initials(p.name)}</div>
      <div class="list-row-body">
        <div class="list-row-name">${escHtml(p.name)}</div>
        <div class="list-row-sub">${p.active ? 'Active' : 'Inactive'}</div>
      </div>
      <div class="list-row-end">
        ${UI.statusBadge(p.active ? 'active' : 'inactive')}
        ${State.isAdmin ? `<button class="btn btn-icon btn-secondary" onclick="event.stopPropagation();Views.editPlayerSheet('${p.id}')">${ICONS.edit}</button>` : ''}
      </div>
    </div>`).join('');
  },

  filterPlayers(q) {
    Views.renderPlayers((State.data.players||[]).filter(p =>
      p.name.toLowerCase().includes(q.toLowerCase())));
  },

  addPlayerSheet() {
    if (!document.getElementById('player-sheet')) {
      document.body.insertAdjacentHTML('beforeend', `
      <div id="player-sheet" class="sheet">
        <div class="sheet-handle"></div>
        <div id="ps-title" class="sheet-title">Add Player</div>
        <form onsubmit="event.preventDefault();Views.savePlayer()">
          <input type="hidden" id="ps-id">
          <div class="form-group">
            <label class="form-label">Player Name *</label>
            <input id="ps-name" class="form-input" placeholder="Full name" required>
          </div>
          <div class="form-group" id="ps-status-group" style="display:none">
            <label class="form-label">Status</label>
            <select id="ps-status" class="form-input form-select">
              <option value="true">Active</option>
              <option value="false">Inactive</option>
            </select>
          </div>
          <div class="modal-actions">
            <button type="submit" id="ps-save" class="btn btn-primary">Save Player</button>
            <button type="button" class="btn btn-secondary" onclick="UI.hideSheet('player-sheet')">Cancel</button>
          </div>
        </form>
      </div>`);
    }
    document.getElementById('ps-title').textContent = 'Add Player';
    document.getElementById('ps-id').value = '';
    document.getElementById('ps-name').value = '';
    document.getElementById('ps-status-group').style.display = 'none';
    UI.showSheet('player-sheet');
  },

  editPlayerSheet(id) {
    const p = (State.data.players||[]).find(x => x.id === id);
    if (!p) return;
    Views.addPlayerSheet();
    setTimeout(() => {
      document.getElementById('ps-title').textContent = 'Edit Player';
      document.getElementById('ps-id').value = p.id;
      document.getElementById('ps-name').value = p.name;
      document.getElementById('ps-status').value = String(p.active);
      document.getElementById('ps-status-group').style.display = 'block';
    }, 40);
  },

  async savePlayer() {
    const btn  = document.getElementById('ps-save');
    const id   = document.getElementById('ps-id').value;
    const name = document.getElementById('ps-name').value.trim();
    const active = document.getElementById('ps-status')?.value !== 'false';
    if (!name) { UI.toast('Enter a player name','error'); return; }
    UI.btnLoad(btn, true);
    let err;
    if (id) {
      const r1 = await DB.updatePlayerName(id, name);
      const r2 = await DB.togglePlayer(id, active);
      err = r1.error || r2.error;
      if (!err) { const i = State.data.players.findIndex(p=>p.id===id); if(i>-1) State.data.players[i] = {...State.data.players[i], name, active}; }
    } else {
      const { data, error } = await DB.createPlayer(name);
      err = error;
      if (!err && data) State.data.players.unshift(data);
    }
    UI.btnLoad(btn, false);
    if (err) { UI.toast(err.message,'error'); return; }
    UI.hideSheet('player-sheet');
    UI.toast(id ? 'Player updated' : 'Player added', 'success');
    Views.renderPlayers(State.data.players);
  },

  // ----------------------------------------------------------
  // MATCHES
  // ----------------------------------------------------------
  async matches() {
    UI.showNav(true);
    UI.setActiveNav('matches');
    const settings       = State.data.settings || {};
    const currentSeason  = settings.current_season || '';

    UI.setContent(`
    <div class="app-header">
      <div class="header-title">Matches</div>
      ${State.isAdmin ? `<button class="header-action" onclick="Views.recordMatchSheet()">${ICONS.plus}</button>` : ''}
    </div>
    <div class="scroll-content">
      <div class="tab-bar">
        <button class="tab-item active" id="tab-approved" onclick="Views.matchTab('approved')">Approved</button>
        <button class="tab-item" id="tab-pending"  onclick="Views.matchTab('pending')">Pending ${State.isAdmin?'<span id="pend-badge"></span>':''}</button>
      </div>
      <div id="matches-list">${UI.skeleton()}</div>
    </div>
    ${State.isAdmin ? `<button class="fab" onclick="Views.recordMatchSheet()">${ICONS.plus}</button>` : ''}`);

    State.data.matchSeason = currentSeason;
    await Views.matchTab('approved');
  },

  async matchTab(tab) {
    document.querySelectorAll('.tab-item').forEach(t => t.classList.remove('active'));
    document.getElementById(`tab-${tab}`)?.classList.add('active');
    const el = document.getElementById('matches-list');
    el.innerHTML = UI.skeleton();

    const { data } = await DB.getMatches(State.data.matchSeason, 100);
    const all = data || [];
    const filtered = all.filter(m => m.status === tab);

    // Pending badge
    const pendCount = all.filter(m => m.status === 'pending').length;
    const pb = document.getElementById('pend-badge');
    if (pb) pb.innerHTML = pendCount > 0 ? `<span class="badge badge-red" style="margin-left:4px;padding:1px 5px">${pendCount}</span>` : '';

    if (!filtered.length) {
      el.innerHTML = UI.empty(ICONS.cut, `No ${capitalize(tab)} Matches`,
        tab === 'pending' ? 'All caught up!' : 'Record the first match',
        State.isAdmin && tab === 'approved' ? `<button class="btn btn-primary" onclick="Views.recordMatchSheet()">Record Match</button>` : '');
      return;
    }

    el.innerHTML = filtered.map(m => matchRow(m, State.isAdmin, true)).join('');
  },

  recordMatchSheet() {
    const players = (State.data.players||[]).filter(p => p.active);
    const settings = State.data.settings || {};
    if (!document.getElementById('match-sheet')) {
      document.body.insertAdjacentHTML('beforeend', `
      <div id="match-sheet" class="sheet">
        <div class="sheet-handle"></div>
        <div class="sheet-title">Record Match</div>
        <form onsubmit="event.preventDefault();Views.saveMatch()">
          <div class="card" style="background:var(--gold-dim);border-color:var(--gold-border);text-align:center;margin-bottom:16px;padding:12px">
            <div style="font-size:12px;font-weight:600;color:var(--gold);letter-spacing:0.5px;margin-bottom:4px">MATCH RESULT</div>
            <div style="display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:8px">
              <div style="text-align:center;font-size:11px;color:var(--text-muted);font-weight:600">WINNER ✂️</div>
              <div style="color:var(--gold);font-weight:800;font-size:16px">vs</div>
              <div style="text-align:center;font-size:11px;color:var(--text-muted);font-weight:600">LOSER 🪁</div>
            </div>
          </div>
          <div class="stats-grid" style="margin-bottom:16px">
            <div class="form-group" style="margin:0">
              <label class="form-label">Winner *</label>
              <select id="m-winner" class="form-input form-select" required>
                <option value="">Select</option>
                ${players.map(p=>`<option value="${p.id}">${escHtml(p.name)}</option>`).join('')}
              </select>
            </div>
            <div class="form-group" style="margin:0">
              <label class="form-label">Loser *</label>
              <select id="m-loser" class="form-input form-select" required>
                <option value="">Select</option>
                ${players.map(p=>`<option value="${p.id}">${escHtml(p.name)}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">Date</label>
            <input id="m-date" type="date" class="form-input" value="${todayStr()}">
          </div>
          <div class="form-group">
            <label class="form-label">Season</label>
            <input id="m-season" class="form-input" value="${escHtml(settings.current_season||'')}" placeholder="e.g. Basant 2026">
          </div>
          <div class="form-group">
            <label class="form-label">Notes</label>
            <input id="m-notes" class="form-input" placeholder="Optional notes…">
          </div>
          <div class="modal-actions">
            <button type="submit" id="m-save" class="btn btn-primary">Save Match</button>
            <button type="button" class="btn btn-secondary" onclick="UI.hideSheet('match-sheet')">Cancel</button>
          </div>
        </form>
      </div>`);
    } else {
      // Refresh player selects
      ['m-winner','m-loser'].forEach(id => {
        const sel = document.getElementById(id);
        if (!sel) return;
        sel.innerHTML = `<option value="">Select</option>` +
          players.map(p=>`<option value="${p.id}">${escHtml(p.name)}</option>`).join('');
      });
    }
    UI.showSheet('match-sheet');
  },

  async saveMatch() {
    const btn    = document.getElementById('m-save');
    const winner = document.getElementById('m-winner').value;
    const loser  = document.getElementById('m-loser').value;
    const date   = document.getElementById('m-date').value;
    const season = document.getElementById('m-season').value.trim();
    const notes  = document.getElementById('m-notes').value.trim();
    if (!winner || !loser) { UI.toast('Select both winner and loser','error'); return; }
    if (winner === loser)  { UI.toast('Winner and loser must be different','error'); return; }
    UI.btnLoad(btn, true);
    const { error } = await DB.submitMatch(winner, loser, season, date, notes, State.user?.email || 'Admin');
    UI.btnLoad(btn, false);
    if (error) { UI.toast(error.message, 'error'); return; }
    UI.hideSheet('match-sheet');
    UI.toast(State.isAdmin ? 'Match recorded ✓' : 'Match submitted for approval', 'success');
    Views.matchTab('approved');
  },

  async approveMatch(id) {
    const { error } = await DB.approveMatch(id);
    if (error) { UI.toast(error.message,'error'); return; }
    UI.toast('Match approved','success');
    Views.matchTab('pending');
  },

  async rejectMatch(id) {
    const ok = await UI.confirm('Reject Match','This will permanently reject this match result.');
    if (!ok) return;
    const { error } = await DB.rejectMatch(id);
    if (error) { UI.toast(error.message,'error'); return; }
    UI.toast('Match rejected','success');
    Views.matchTab('pending');
  },

  async deleteMatch(id) {
    const ok = await UI.confirm('Delete Match','Permanently delete this match record?');
    if (!ok) return;
    const { error } = await DB.deleteMatch(id);
    if (error) { UI.toast(error.message,'error'); return; }
    UI.toast('Deleted','success');
    Views.matchTab('approved');
  },

  // ----------------------------------------------------------
  // LEADERBOARD
  // ----------------------------------------------------------
  async leaderboard() {
    UI.showNav(true);
    UI.setActiveNav('leaderboard');
    const settings = State.data.settings || {};
    const currentSeason = settings.current_season || '';

    // Load seasons for filter
    const { data: seasons } = await DB.getSeasons();

    UI.setContent(`
    <div class="app-header">
      <div class="header-title">Leaderboard</div>
      <button class="header-action" onclick="Views.shareLeaderboard()" title="Share">${ICONS.share}</button>
    </div>
    <div class="scroll-content">
      <div class="form-group">
        <select id="lb-season" class="form-input form-select" onchange="Views.loadLeaderboard(this.value)">
          <option value="">All Time</option>
          ${(seasons||[]).map(s=>`<option value="${escHtml(s.name)}" ${s.name===currentSeason?'selected':''}>${escHtml(s.name)}</option>`).join('')}
        </select>
      </div>
      <div id="podium-wrap"></div>
      <div id="lb-list">${UI.skeleton()}</div>
    </div>`);

    Views.loadLeaderboard(currentSeason);
  },

  async loadLeaderboard(season) {
    const el  = document.getElementById('lb-list');
    const pod = document.getElementById('podium-wrap');
    if (!el) return;
    el.innerHTML = UI.skeleton();

    const { data } = await DB.getLeaderboard(season);
    const rows = data || [];

    // Aggregate wins/losses per player
    const agg = {};
    rows.forEach(r => {
      const wid = r.winner_id, lid = r.loser_id;
      if (!agg[wid]) agg[wid] = { id:wid, name: r.winner?.name||'?', wins:0, losses:0 };
      if (!agg[lid]) agg[lid] = { id:lid, name: r.loser?.name ||'?', wins:0, losses:0 };
      agg[wid].wins++;
      agg[lid].losses++;
    });
    const sorted = Object.values(agg).sort((a,b) => b.wins - a.wins || a.losses - b.losses);

    if (!sorted.length) {
      if (pod) pod.innerHTML = '';
      el.innerHTML = UI.empty(ICONS.trophy,'No Results','No approved matches found for this season');
      return;
    }

    // Podium (top 3) — display order: 2nd, 1st, 3rd
    if (pod && sorted.length >= 2) {
      const orders = sorted.length >= 3 ? [1,0,2] : [0,1];
      pod.innerHTML = `
      <div class="leaderboard-podium">
        ${orders.map(i => sorted[i] ? `
        <div class="podium-item rank-${i+1}">
          <div class="podium-avatar">${UI.initials(sorted[i].name)}</div>
          <div class="podium-name">${sorted[i].name.split(' ')[0]}</div>
          <div class="podium-score">${sorted[i].wins} ✂️</div>
          <div class="podium-stand">${['🥇','🥈','🥉'][i]}</div>
        </div>` : '<div class="podium-item"></div>').join('')}
      </div>`;
    } else if (pod) { pod.innerHTML = ''; }

    el.innerHTML = `<div class="list-title mt-8 mb-8">Full Rankings</div>` +
      sorted.map((p,i) => `
      <div class="list-row">
        <div class="list-row-rank">${i<3?['🥇','🥈','🥉'][i]:i+1}</div>
        <div class="list-row-avatar">${UI.initials(p.name)}</div>
        <div class="list-row-body">
          <div class="list-row-name">${escHtml(p.name)}</div>
          <div class="list-row-sub">${p.losses} loss${p.losses!==1?'es':''}</div>
        </div>
        <div style="text-align:right">
          <div class="list-row-value">${p.wins} ✂️</div>
          <div class="text-xs text-muted">${p.wins+p.losses > 0 ? Math.round(p.wins/(p.wins+p.losses)*100)+'%' : '—'}</div>
        </div>
      </div>`).join('');
  },

  shareLeaderboard() {
    const url = `${location.origin}${location.pathname}#leaderboard`;
    if (navigator.share) {
      navigator.share({ title: 'BAKSS Kite League Leaderboard', url });
    } else {
      navigator.clipboard?.writeText(url).then(() => UI.toast('Link copied!','success'));
    }
  },

  // ----------------------------------------------------------
  // SETTINGS (admin only)
  // ----------------------------------------------------------
  async settings() {
    UI.showNav(true);
    UI.setActiveNav('more');
    const s = State.data.settings || {};

    UI.setContent(`
    <div class="app-header">
      <div class="header-title">Settings</div>
    </div>
    <div class="scroll-content">

      ${State.isAdmin ? `
      <div class="list-section">
        <div class="list-title">League</div>
        <div class="card">
          <div class="form-group">
            <label class="form-label">League Name</label>
            <input id="set-league" class="form-input" value="${escHtml(s.league_name||'')}" placeholder="BAKSS Kite League">
          </div>
          <div class="form-group">
            <label class="form-label">Current Season</label>
            <input id="set-season" class="form-input" value="${escHtml(s.current_season||'')}" placeholder="Basant 2026">
          </div>
          <button class="btn btn-primary" onclick="Views.saveSettings()">Save Settings</button>
        </div>
      </div>

      <div class="list-section">
        <div class="list-title">Admin</div>
        <div class="list-row" onclick="Views.inviteSheet()">
          <div class="list-row-body"><div class="list-row-name">Invite Admin User</div><div class="list-row-sub">Send access to a new admin</div></div>
          ${ICONS.chevronRight}
        </div>
        <div class="list-row" onclick="Views.changePw()">
          <div class="list-row-body"><div class="list-row-name">Change Password</div></div>
          ${ICONS.chevronRight}
        </div>
      </div>` : ''}

      <div class="list-section">
        <div class="list-title">App</div>
        <div class="list-row" onclick="Auth.installPWA()">
          <div class="list-row-body"><div class="list-row-name">Install App</div><div class="list-row-sub">Add to Home Screen</div></div>
          ${ICONS.chevronRight}
        </div>
        <div class="list-row">
          <div class="list-row-body"><div class="list-row-name">Version</div><div class="list-row-sub">BAKSS Kite League Manager v${CONFIG.version}</div></div>
        </div>
      </div>

      <div class="list-section">
        <div class="list-title">Account</div>
        ${State.isAdmin ? `
        <div class="list-row" onclick="Auth.logout()">
          <div class="list-row-body"><div class="list-row-name" style="color:var(--error)">Sign Out</div></div>
        </div>` : `
        <div class="list-row" onclick="Router.go('login')">
          <div class="list-row-body"><div class="list-row-name">Admin Login</div></div>
          ${ICONS.chevronRight}
        </div>`}
      </div>

    </div>`);
  },

  async saveSettings() {
    const league = document.getElementById('set-league').value.trim();
    const season = document.getElementById('set-season').value.trim();
    const [r1, r2] = await Promise.all([
      DB.setSetting('league_name', league),
      DB.setSetting('current_season', season),
    ]);
    if (r1.error || r2.error) { UI.toast('Save failed','error'); return; }
    State.data.settings.league_name   = league;
    State.data.settings.current_season = season;
    UI.toast('Settings saved','success');
  },

  inviteSheet() {
    if (!document.getElementById('invite-sheet')) {
      document.body.insertAdjacentHTML('beforeend', `
      <div id="invite-sheet" class="sheet">
        <div class="sheet-handle"></div>
        <div class="sheet-title">Invite Admin</div>
        <form onsubmit="event.preventDefault();Views.sendInvite()">
          <div class="form-group">
            <label class="form-label">Email *</label>
            <input id="inv-email" type="email" class="form-input" placeholder="admin@example.com" required>
          </div>
          <div class="form-group">
            <label class="form-label">Role</label>
            <select id="inv-role" class="form-input form-select">
              <option value="club_staff">Club Staff</option>
              <option value="club_admin">Club Admin</option>
              <option value="viewer">Viewer</option>
            </select>
          </div>
          <div class="modal-actions">
            <button type="submit" id="inv-save" class="btn btn-primary">Send Invite</button>
            <button type="button" class="btn btn-secondary" onclick="UI.hideSheet('invite-sheet')">Cancel</button>
          </div>
        </form>
      </div>`);
    }
    UI.showSheet('invite-sheet');
  },

  async sendInvite() {
    const btn   = document.getElementById('inv-save');
    const email = document.getElementById('inv-email').value.trim();
    const role  = document.getElementById('inv-role').value;
    UI.btnLoad(btn, true);
    const { error } = await DB.inviteUser(email, role);
    UI.btnLoad(btn, false);
    if (error) { UI.toast(error.message,'error'); return; }
    UI.hideSheet('invite-sheet');
    UI.toast(`Invite sent to ${email}`,'success');
  },

  changePw() {
    UI.showNav(false);
    UI.setContent(`
    <div class="login-page">
      <button class="btn btn-secondary btn-sm mb-16" onclick="Router.go('settings');UI.showNav(true)">← Back</button>
      <div class="login-subtitle">Change Password</div>
      <div class="form-group mt-24">
        <label class="form-label">New Password</label>
        <input id="np1" type="password" class="form-input" placeholder="Min 8 characters">
      </div>
      <div class="form-group">
        <label class="form-label">Confirm Password</label>
        <input id="np2" type="password" class="form-input" placeholder="Repeat">
      </div>
      <div id="pw-err" class="form-error"></div>
      <button class="btn btn-primary mt-8" onclick="Views.doChangePw()">Update Password</button>
    </div>`);
  },

  async doChangePw() {
    const p1=document.getElementById('np1').value, p2=document.getElementById('np2').value;
    const err=document.getElementById('pw-err');
    if (p1.length<8){err.textContent='Min 8 characters';err.classList.add('show');return;}
    if (p1!==p2){err.textContent='Passwords do not match';err.classList.add('show');return;}
    const {error}=await DB.updatePw(p1);
    if(error){err.textContent=error.message;err.classList.add('show');return;}
    UI.toast('Password updated','success');
    Router.go('settings'); UI.showNav(true);
  },
};

// ============================================================
// MATCH ROW COMPONENT
// ============================================================
function matchRow(m, isAdmin, showActions=false) {
  const wName = m.winner?.name || '?';
  const lName = m.loser?.name  || '?';
  return `
  <div class="list-row" style="${m.status==='pending'?'border-color:rgba(251,191,36,0.3)':''}">
    <div style="flex:1;min-width:0">
      <div class="flex items-center gap-8 mb-4">
        <div class="list-row-avatar" style="width:32px;height:32px;border-radius:8px;font-size:11px;background:rgba(74,222,128,0.12);color:var(--success)">
          ${UI.initials(wName)}
        </div>
        <div style="font-weight:700;font-size:14px">${escHtml(wName)}</div>
        <div class="text-muted" style="font-size:11px;margin:0 2px">✂️ cut</div>
        <div class="list-row-avatar" style="width:32px;height:32px;border-radius:8px;font-size:11px;background:rgba(248,113,113,0.1);color:var(--error)">
          ${UI.initials(lName)}
        </div>
        <div style="font-weight:600;font-size:14px;color:var(--text-muted)">${escHtml(lName)}</div>
      </div>
      <div class="flex items-center gap-8">
        <span class="text-xs text-muted">${formatDate(m.match_date||m.session_date)}</span>
        ${m.season ? `<span class="text-xs text-muted">· ${escHtml(m.season)}</span>` : ''}
        ${UI.statusBadge(m.status)}
      </div>
    </div>
    ${showActions && isAdmin && m.status === 'pending' ? `
    <div style="display:flex;flex-direction:column;gap:6px;flex-shrink:0">
      <button class="btn btn-sm" style="background:rgba(74,222,128,0.15);color:var(--success);min-width:80px" onclick="Views.approveMatch('${m.id}')">Approve</button>
      <button class="btn btn-sm btn-danger" onclick="Views.rejectMatch('${m.id}')">Reject</button>
    </div>` : showActions && isAdmin ? `
    <button class="btn btn-icon btn-danger" onclick="Views.deleteMatch('${m.id}')">${ICONS.trash}</button>` : ''}
  </div>`;
}

// ============================================================
// AUTH MODULE
// ============================================================
const Auth = {
  async login() {
    const btn   = document.getElementById('login-btn');
    const email = document.getElementById('login-email')?.value.trim();
    const pw    = document.getElementById('login-pw')?.value;
    const errEl = document.getElementById('login-err');
    if (errEl) errEl.classList.remove('show');
    if (!email || !pw) {
      if (errEl) { errEl.textContent = 'Enter email and password'; errEl.classList.add('show'); }
      return;
    }
    UI.btnLoad(btn, true);
    const { error } = await DB.signIn(email, pw);
    if (error) {
      if (errEl) { errEl.textContent = error.message; errEl.classList.add('show'); }
      UI.btnLoad(btn, false);
    }
    // onAuthStateChange handles success routing
  },

  async logout() {
    const ok = await UI.confirm('Sign Out','Sign out of admin?');
    if (!ok) return;
    await DB.signOut();
    State.user = State.clubUser = null;
    State.isAdmin = false;
    Router.go('login');
  },

  viewPublic() {
    State.isAdmin = false;
    Router.go('leaderboard');
  },

  async sendReset() {
    const btn   = document.getElementById('reset-btn');
    const email = document.getElementById('reset-email')?.value.trim();
    const errEl = document.getElementById('reset-err');
    if (!email) { if(errEl){errEl.textContent='Enter email';errEl.classList.add('show');} return; }
    UI.btnLoad(btn, true);
    const { error } = await DB.resetPw(email);
    UI.btnLoad(btn, false);
    if (error) { if(errEl){errEl.textContent=error.message;errEl.classList.add('show');} return; }
    UI.toast('Reset link sent — check your email','success');
    setTimeout(() => Router.go('login'), 1500);
  },

  installPWA() {
    if (State.deferredInstall) State.deferredInstall.prompt();
    else UI.toast('In Chrome: tap ⋮ → Add to Home Screen. In Safari: Share → Add to Home Screen.','info');
  },
};

// ============================================================
// ROUTER
// ============================================================
const Router = {
  go(view, params={}) {
    State.view = view;
    location.hash = view;
    this.render(view, params);
  },
  render(view) {
    const map = {
      login:       Views.login,
      dashboard:   Views.dashboard,
      players:     Views.players,
      matches:     Views.matches,
      leaderboard: Views.leaderboard,
      settings:    Views.settings,
    };
    (map[view] || map.dashboard).call(Views);
  },
  init() {
    window.addEventListener('hashchange', () => {
      const h = location.hash.replace('#','') || 'dashboard';
      this.render(h);
    });
  },
};

// ============================================================
// ICONS
// ============================================================
const ICONS = {
  dashboard:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>`,
  users:       `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
  trophy:      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M8 21h8M12 17v4M7 4H4v5c0 2.2 1.8 4 4 4h8c2.2 0 4-1.8 4-4V4h-3"/><path d="M7 4h10v5a5 5 0 0 1-10 0V4z"/></svg>`,
  cut:         `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/></svg>`,
  leaderboard: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>`,
  more:        `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg>`,
  plus:        `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
  edit:        `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`,
  trash:       `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`,
  search:      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`,
  share:       `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>`,
  chevronRight:`<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--text-muted);flex-shrink:0"><polyline points="9 18 15 12 9 6"/></svg>`,
  eye:         `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`,
  info:        `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--gold);flex-shrink:0"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
  clock:       `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
};

// ============================================================
// UTILS
// ============================================================
function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g,' ') : ''; }
function todayStr()    { return new Date().toISOString().split('T')[0]; }
function formatDate(d) {
  if (!d) return '—';
  const dt = new Date(d);
  if (isNaN(dt)) return String(d);
  return dt.toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' });
}
function escHtml(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function togglePw(inputId, icon) {
  const inp = document.getElementById(inputId);
  if (!inp) return;
  inp.type = inp.type === 'password' ? 'text' : 'password';
  icon.innerHTML = inp.type === 'password' ? ICONS.eye :
    `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;
}

// ============================================================
// BOTTOM NAV
// ============================================================
function buildNav() {
  document.getElementById('bottom-nav').innerHTML = `
    <button class="nav-item" data-view="dashboard"   onclick="Router.go('dashboard')">   ${ICONS.dashboard}  <span class="nav-label">Home</span></button>
    <button class="nav-item" data-view="players"     onclick="Router.go('players')">     ${ICONS.users}      <span class="nav-label">Players</span></button>
    <button class="nav-item" data-view="matches"     onclick="Router.go('matches')">     ${ICONS.cut}        <span class="nav-label">Matches</span></button>
    <button class="nav-item" data-view="leaderboard" onclick="Router.go('leaderboard')"> ${ICONS.leaderboard}<span class="nav-label">Ranking</span></button>
    <button class="nav-item" data-view="more"        onclick="Router.go('settings')">    ${ICONS.more}       <span class="nav-label">More</span></button>`;
}

// ============================================================
// INIT
// ============================================================
async function initApp() {
  State.db = initSupabase();
  buildNav();
  Router.init();

  // Service worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(()=>{});
  }

  // PWA install prompt
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    State.deferredInstall = e;
  });

  // Overlay / sheet close
  document.getElementById('overlay').addEventListener('click', () => UI.hideAllSheets());

  // Load settings (public, no auth needed)
  const { data: rawSettings } = await DB.getSettings();
  State.data.settings = {};
  (rawSettings||[]).forEach(r => { State.data.settings[r.key] = r.value; });

  // Load club
  const { data: club } = await DB.getClub();
  State.club = club;

  // Check existing auth session
  State.db.auth.onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_IN' && session) {
      State.user = session.user;
      State.isAdmin = true;
      // Try to get club_user role
      const { data: cu } = await DB.getClubUser(session.user.id);
      State.clubUser = cu;
      hideSplash();
      const h = location.hash.replace('#','');
      Router.go(h && h !== 'login' ? h : 'dashboard');
    } else if (event === 'SIGNED_OUT') {
      State.user = State.clubUser = null;
      State.isAdmin = false;
      hideSplash();
      Router.go('login');
    } else if (event === 'PASSWORD_RECOVERY') {
      hideSplash();
      Views.changePw();
    }
  });

  const { data: { session } } = await State.db.auth.getSession();
  if (session) {
    State.user    = session.user;
    State.isAdmin = true;
    const { data: cu } = await DB.getClubUser(session.user.id);
    State.clubUser = cu;
    hideSplash();
    const h = location.hash.replace('#','');
    Router.go(h && h !== 'login' ? h : 'dashboard');
  } else {
    hideSplash();
    // Show public leaderboard by default (not login gate)
    const h = location.hash.replace('#','');
    Router.go(h && h !== 'login' ? h : 'leaderboard');
  }
}

function hideSplash() {
  const s = document.getElementById('splash');
  if (s) { s.classList.add('hidden'); setTimeout(() => s.remove(), 600); }
}

document.addEventListener('DOMContentLoaded', initApp);
