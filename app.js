/* CYEZ PASSWORD MANAGEMENT LOGIC v2 */
/* CYEZ乒乓球积分系统：Supabase 实时版 */
const { createClient } = window.supabase;

const CONFIG = window.CYEZ_SUPABASE_CONFIG || {};
const isConfigured = CONFIG.url && !CONFIG.url.includes('YOUR-PROJECT') && CONFIG.anonKey && !CONFIG.anonKey.includes('YOUR_');
const supabaseClient = isConfigured ? createClient(CONFIG.url, CONFIG.anonKey, {
  auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true }
}) : null;

const INITIAL_RATING = 1500;
const K = 32;
const COMPETITIONS = {
  friendly: { id: 'friendly', name: '友谊赛', weight: 0.2 },
  club: { id: 'club', name: '社团组织比赛', weight: 0.5 },
  school_qualifier: { id: 'school_qualifier', name: '校级比赛预选赛', weight: 0.5 },
  district_qualifier: { id: 'district_qualifier', name: '区赛 / 市赛预选赛', weight: 0.8 },
  school_official: { id: 'school_official', name: '校级正式比赛', weight: 1.0 }
};
const STATUS_NAMES = {
  pending_opponent: '待对手确认',
  approved: '已生效',
  rejected: '已拒绝',
  cancelled: '已撤销'
};

const state = {
  profiles: [],
  matches: [],
  ratings: new Map(),
  games: new Map(),
  wins: new Map(),
  losses: new Map(),
  approvedMatches: []
};
let currentUser = null;
let currentProfile = null;
let realtimeChannel = null;
let currentView = 'dashboard';
let authMode = 'login';

const $ = id => document.getElementById(id);
const els = {
  liveStatus: $('liveStatus'),
  authActions: $('authActions'),
  loginBtn: $('loginBtn'),
  signupBtn: $('signupBtn'),
  dashboardStats: $('dashboardStats'),
  dashboardRankingBody: $('dashboardRankingBody'),
  dashboardRecent: $('dashboardRecent'),
  accountBanner: $('accountBanner'),
  matchAuthNotice: $('matchAuthNotice'),
  matchEditor: $('matchEditor'),
  matchForm: $('matchForm'),
  matchDate: $('matchDate'),
  competitionType: $('competitionType'),
  playerA: $('playerA'),
  playerB: $('playerB'),
  ratingA: $('ratingA'),
  ratingB: $('ratingB'),
  currentParticipantNote: $('currentParticipantNote'),
  scoreA: $('scoreA'),
  scoreB: $('scoreB'),
  matchPreview: $('matchPreview'),
  previewC: $('previewC'),
  previewM: $('previewM'),
  previewE: $('previewE'),
  rankingSearch: $('rankingSearch'),
  rankingBody: $('rankingBody'),
  historyFilter: $('historyFilter'),
  historyBody: $('historyBody'),
  h2hA: $('h2hA'),
  h2hB: $('h2hB'),
  h2hContent: $('h2hContent'),
  adminContent: $('adminContent'),
  toastRegion: $('toastRegion'),
  authBackdrop: $('authBackdrop'),
  authClose: $('authClose'),
  loginForm: $('loginForm'),
  signupForm: $('signupForm'),
  loginUsername: $('loginUsername'),
  loginPassword: $('loginPassword'),
  signupRealName: $('signupRealName'),
  signupUsername: $('signupUsername'),
  signupPassword: $('signupPassword'),
  profileBackdrop: $('profileBackdrop'),
  profileClose: $('profileClose'),
  profileSummary: $('profileSummary'),
  profileForm: $('profileForm'),
  profileRealName: $('profileRealName'),
  profileUsername: $('profileUsername'),
  logoutBtn: $('logoutBtn'),
  passwordForm: $('passwordForm'),
  profileCurrentPassword: $('profileCurrentPassword'),
  profileNewPassword: $('profileNewPassword'),
  profileConfirmPassword: $('profileConfirmPassword'),
  adminResetBackdrop: $('adminResetBackdrop'),
  adminResetClose: $('adminResetClose'),
  adminResetSummary: $('adminResetSummary'),
  adminResetForm: $('adminResetForm'),
  adminResetPassword: $('adminResetPassword'),
  generateTempPasswordBtn: $('generateTempPasswordBtn')
};

function esc(v='') {
  return String(v).replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;'}[ch]));
}
function uid() { return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`; }
function nowISO() { return new Date().toISOString(); }
function formatRating(n) { return Number(n || 0).toFixed(1); }
function formatDate(v) { return new Date(v).toLocaleString('zh-CN', {year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}); }
function formatDateLong(v) { return new Date(v).toLocaleString('zh-CN', {year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'}); }
function formatPct(n) { return `${(Number(n || 0) * 100).toFixed(1)}%`; }
function competition(id) { return COMPETITIONS[id] || { name: id || '未知', weight: 0 }; }
function profile(id) { return state.profiles.find(p => p.id === id); }
function activeProfiles() { return state.profiles.filter(p => !p.is_banned); }
function isStaff() { return !!currentProfile && !currentProfile.is_banned && ['admin','moderator'].includes(currentProfile.role); }
function isAdmin() { return !!currentProfile && !currentProfile.is_banned && currentProfile.role === 'admin'; }
function playerLabel(id) { const p = profile(id); return p ? p.real_name : '未知选手'; }

function expectedScore(myRating, opponentRating) {
  return 1 / (1 + Math.pow(10, (opponentRating - myRating) / 400));
}
function scoreMultiplier(w, l) {
  const total = w + l;
  if (w <= l || total <= 0) return 0;
  const closeness = Math.pow((w - l) / total, 0.65);
  const length = Math.pow(Math.log(1 + total) / Math.log(5), 0.35);
  return Math.min(1.5, 0.70 + 0.80 * closeness * length);
}
function calculateDelta(winnerRating, loserRating, winnerScore, loserScore, weight) {
  const e = expectedScore(winnerRating, loserRating);
  const m = scoreMultiplier(winnerScore, loserScore);
  return { e, m, delta: K * weight * m * (1 - e) };
}

function sortMatches(ms) {
  return [...ms].sort((a,b) => new Date(a.played_at) - new Date(b.played_at)
    || new Date(a.created_at) - new Date(b.created_at)
    || a.id.localeCompare(b.id));
}

function rebuildRatings() {
  state.ratings = new Map(state.profiles.map(p => [p.id, INITIAL_RATING]));
  state.games = new Map(state.profiles.map(p => [p.id, 0]));
  state.wins = new Map(state.profiles.map(p => [p.id, 0]));
  state.losses = new Map(state.profiles.map(p => [p.id, 0]));
  state.approvedMatches = sortMatches(state.matches.filter(m => m.status === 'approved'));
  for (const m of state.approvedMatches) {
    const aRating = state.ratings.get(m.player_a_id) ?? INITIAL_RATING;
    const bRating = state.ratings.get(m.player_b_id) ?? INITIAL_RATING;
    const aWon = Number(m.score_a) > Number(m.score_b);
    const winnerId = aWon ? m.player_a_id : m.player_b_id;
    const loserId = aWon ? m.player_b_id : m.player_a_id;
    const winnerRating = aWon ? aRating : bRating;
    const loserRating = aWon ? bRating : aRating;
    const winnerScore = aWon ? Number(m.score_a) : Number(m.score_b);
    const loserScore = aWon ? Number(m.score_b) : Number(m.score_a);
    const calc = calculateDelta(winnerRating, loserRating, winnerScore, loserScore, competition(m.competition_id).weight);
    m._winnerId = winnerId;
    m._delta = calc.delta;
    m._preRatingWinner = winnerRating;
    m._preRatingLoser = loserRating;
    m._expectedWinner = calc.e;
    m._multiplier = calc.m;
    state.ratings.set(winnerId, winnerRating + calc.delta);
    state.ratings.set(loserId, loserRating - calc.delta);
    state.games.set(m.player_a_id, (state.games.get(m.player_a_id) || 0) + 1);
    state.games.set(m.player_b_id, (state.games.get(m.player_b_id) || 0) + 1);
    state.wins.set(winnerId, (state.wins.get(winnerId) || 0) + 1);
    state.losses.set(loserId, (state.losses.get(loserId) || 0) + 1);
  }
}

function rankingRows() {
  return state.profiles.map(p => {
    const games = state.games.get(p.id) || 0;
    const wins = state.wins.get(p.id) || 0;
    const losses = state.losses.get(p.id) || 0;
    return {
      ...p,
      rating: state.ratings.get(p.id) ?? INITIAL_RATING,
      games, wins, losses,
      winRate: games ? wins / games : 0,
      active: !p.is_banned
    };
  }).sort((a,b) => b.rating - a.rating || b.wins - a.wins || a.real_name.localeCompare(b.real_name, 'zh-CN'));
}

function populateCompetition() {
  els.competitionType.innerHTML = Object.values(COMPETITIONS).map(c => `<option value="${c.id}">${esc(c.name)}（${c.weight}）</option>`).join('');
  els.competitionType.value = 'school_official';
}
function setDefaultDate() {
  const d = new Date(Date.now() - new Date().getTimezoneOffset() * 60000);
  els.matchDate.value = d.toISOString().slice(0,16);
}
function fillSelect(el, includeEmpty=true, onlyActive=true) {
  const arr = onlyActive ? activeProfiles() : state.profiles;
  const previous = el.value;
  el.innerHTML = `${includeEmpty ? '<option value="">请选择选手</option>' : ''}` + arr.map(p => `<option value="${p.id}">${esc(p.real_name)}（${esc(p.username)} · ${formatRating(state.ratings.get(p.id) ?? INITIAL_RATING)}）</option>`).join('');
  if (arr.some(p => p.id === previous)) el.value = previous;
}
function refreshSelects() {
  const pA = els.playerA.value, pB = els.playerB.value, hA = els.h2hA.value, hB = els.h2hB.value;
  fillSelect(els.playerA); fillSelect(els.playerB); fillSelect(els.h2hA); fillSelect(els.h2hB);
  if (currentProfile && !pA && activeProfiles().some(p => p.id === currentProfile.id)) els.playerA.value = '';
  else if (currentProfile && !pA) els.playerA.value = currentProfile.id;
  if (pA && activeProfiles().some(p=>p.id===pA)) els.playerA.value = pA;
  if (pB && activeProfiles().some(p=>p.id===pB)) els.playerB.value = pB;
  if (hA && activeProfiles().some(p=>p.id===hA)) els.h2hA.value = hA;
  if (hB && activeProfiles().some(p=>p.id===hB)) els.h2hB.value = hB;
  updateRatingsInForm();
  renderH2H();
}
function updateRatingsInForm() {
  els.ratingA.textContent = `${formatRating(state.ratings.get(els.playerA.value) ?? INITIAL_RATING)} 分`;
  els.ratingB.textContent = `${formatRating(state.ratings.get(els.playerB.value) ?? INITIAL_RATING)} 分`;
  if (currentProfile) {
    const a = els.playerA.value === currentProfile.id, b = els.playerB.value === currentProfile.id;
    els.currentParticipantNote.textContent = a || b ? '✓ 你是本场比赛参与者，提交后将由对手确认。' : '请将你自己的账号选为 A 或 B，否则无法提交。';
    els.currentParticipantNote.className = `current-user-note ${a || b ? 'good' : 'warn'}`;
  } else {
    els.currentParticipantNote.textContent = '';
  }
}

function updatePreview() {
  const a = profile(els.playerA.value), b = profile(els.playerB.value);
  const sa = Number(els.scoreA.value), sb = Number(els.scoreB.value);
  const c = competition(els.competitionType.value);
  if (!a || !b || a.id === b.id || !Number.isFinite(sa) || !Number.isFinite(sb) || sa < 0 || sb < 0 || sa === sb) {
    els.matchPreview.innerHTML = '<div class="preview-empty">选择双方并录入有效比分后，这里会显示积分变化预览。</div>';
    els.previewC.textContent = c.weight ?? '—';
    els.previewM.textContent = '—';
    els.previewE.textContent = '—';
    return;
  }
  const aR = state.ratings.get(a.id) ?? INITIAL_RATING, bR = state.ratings.get(b.id) ?? INITIAL_RATING;
  const aWon = sa > sb;
  const winner = aWon ? a : b, loser = aWon ? b : a;
  const calc = calculateDelta(aWon ? aR : bR, aWon ? bR : aR, Math.max(sa,sb), Math.min(sa,sb), c.weight);
  const aDelta = aWon ? calc.delta : -calc.delta;
  els.previewC.textContent = c.weight.toFixed(1);
  els.previewM.textContent = calc.m.toFixed(3);
  els.previewE.textContent = formatPct(aWon ? calc.e : 1 - calc.e);
  els.matchPreview.innerHTML = `<div class="preview-main"><div class="preview-side"><div class="preview-name">${esc(a.real_name)}</div><div class="preview-rating">赛前 ${formatRating(aR)}</div></div><div class="delta ${aDelta >= 0 ? 'positive' : 'negative'}">${aDelta>=0?'+':'−'}${formatRating(Math.abs(aDelta))}</div><div class="preview-vs">${sa}:${sb}</div><div class="delta ${aDelta >= 0 ? 'negative' : 'positive'}">${aDelta<0?'+':'−'}${formatRating(Math.abs(aDelta))}</div><div class="preview-side"><div class="preview-name">${esc(b.real_name)}</div><div class="preview-rating">赛前 ${formatRating(bR)}</div></div></div><div class="preview-footer">胜者：<strong>${esc(winner.real_name)}</strong> · 负者：${esc(loser.real_name)} · 仅确认后计入积分</div>`;
}

function renderDashboard() {
  const rows = rankingRows();
  const activeCount = state.profiles.filter(p => !p.is_banned).length;
  const approvedCount = state.matches.filter(m => m.status === 'approved').length;
  const pendingCount = state.matches.filter(m => m.status === 'pending_opponent' && currentUser && (m.submitted_by === currentUser.id || m.player_a_id === currentUser.id || m.player_b_id === currentUser.id)).length;
  const avg = rows.length ? rows.reduce((s,r)=>s+r.rating,0) / rows.length : INITIAL_RATING;
  els.dashboardStats.innerHTML = `
    <div class="stat-card"><div class="stat-label">在册选手</div><div class="stat-value">${activeCount}</div><div class="stat-note">封禁账号：${state.profiles.filter(p=>p.is_banned).length}</div></div>
    <div class="stat-card"><div class="stat-label">已生效比赛</div><div class="stat-value">${approvedCount}</div><div class="stat-note">所有生效比赛实时同步</div></div>
    <div class="stat-card"><div class="stat-label">当前平均积分</div><div class="stat-value">${formatRating(avg)}</div><div class="stat-note">理论上始终保持 1500</div></div>
    <div class="stat-card"><div class="stat-label">待我确认</div><div class="stat-value">${currentProfile ? pendingCount : '—'}</div><div class="stat-note">登录后可直接处理</div></div>`;
  els.dashboardRankingBody.innerHTML = rows.slice(0,8).map((r,i)=>`<tr><td><span class="rank-chip">${i+1}</span></td><td class="name-cell">${esc(r.real_name)} ${r.is_banned?'<span class="pill off">封禁</span>':''}</td><td class="rating-number">${formatRating(r.rating)}</td><td>${r.games}</td><td>${formatPct(r.winRate)}</td></tr>`).join('') || '<tr><td colspan="5"><div class="empty">还没有选手。</div></td></tr>';
  const ms = [...state.matches].sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)).slice(0,6);
  els.dashboardRecent.innerHTML = ms.map(m => {
    const a=profile(m.player_a_id), b=profile(m.player_b_id); const approved=m.status==='approved';
    return `<div class="recent-item"><div class="recent-player"><div class="recent-name">${esc(a?.real_name||'未知')}</div><div class="recent-rating">${approved?formatRating(m._preRatingWinner && m._winnerId===m.player_a_id?m._preRatingWinner:state.ratings.get(m.player_a_id)||1500):'—'}</div></div><div><div class="recent-score">${m.score_a}:${m.score_b}</div><div class="match-meta">${esc(competition(m.competition_id).name)} · ${esc(STATUS_NAMES[m.status]||m.status)}</div></div><div class="recent-player right"><div class="recent-name">${esc(b?.real_name||'未知')}</div><div class="recent-rating">${approved?'积分已生效':'等待确认'}</div></div></div>`;
  }).join('') || '<div class="empty">还没有比赛记录。</div>';
  renderAccountBanner();
}

function renderAccountBanner() {
  if (!currentProfile) {
    els.accountBanner.innerHTML = `<div><strong>登录后可提交比赛</strong><span> 所有人都可以查看实时排行榜和已生效比赛。</span></div><div class="banner-actions"><button class="btn btn-ghost" id="bannerLoginBtn">登录</button><button class="btn btn-primary" id="bannerSignupBtn">注册</button></div>`;
    return;
  }
  if (currentProfile.is_banned) {
    els.accountBanner.innerHTML = `<div><strong>账号已被封禁</strong><span> 当前只能查看公开历史记录，不能提交或确认比赛。</span></div><button class="btn btn-ghost" id="bannerProfileBtn">查看账号</button>`;
    return;
  }
  const me = rankingRows().find(r=>r.id===currentProfile.id);
  const pending = state.matches.filter(m=>m.status==='pending_opponent' && m.player_a_id!==currentProfile.id && m.player_b_id!==currentProfile.id ? false : (m.status==='pending_opponent' && (m.submitted_by===currentProfile.id || m.player_a_id===currentProfile.id || m.player_b_id===currentProfile.id))).length;
  els.accountBanner.innerHTML = `<div><strong>你好，${esc(currentProfile.real_name)}</strong><span> ${currentProfile.role==='admin'?'管理员':currentProfile.role==='moderator'?'副管理员':'选手'} · 当前积分 <b>${formatRating(me?.rating??INITIAL_RATING)}</b> · ${me?.games||0} 场比赛${pending?' · 待处理 '+pending+' 场':''}</span></div><button class="btn btn-ghost" id="bannerProfileBtn">我的账号</button>`;
}

function renderRanking() {
  const q = (els.rankingSearch.value || '').trim().toLowerCase();
  const rows = rankingRows().filter(r => !q || `${r.real_name} ${r.username}`.toLowerCase().includes(q));
  els.rankingBody.innerHTML = rows.map((r,i)=>`<tr><td><span class="rank-chip">${i+1}</span></td><td class="name-cell">${esc(r.real_name)} <span class="muted">@${esc(r.username)}</span></td><td class="rating-number">${formatRating(r.rating)}</td><td>${r.games}</td><td>${r.wins}-${r.losses}</td><td>${formatPct(r.winRate)}</td><td><span class="pill ${r.active?'active':'off'}">${r.active?'正常':'封禁'}</span></td></tr>`).join('') || '<tr><td colspan="7"><div class="empty">没有匹配的选手。</div></td></tr>';
}

function canSeeMatch(m) {
  if (m.status === 'approved') return true;
  return !!currentUser && (m.submitted_by === currentUser.id || m.player_a_id === currentUser.id || m.player_b_id === currentUser.id || isStaff());
}
function matchActionHtml(m) {
  if (!currentUser) return '';
  const mySide = m.player_a_id === currentUser.id || m.player_b_id === currentUser.id;
  const isOpponent = m.status==='pending_opponent' && mySide && m.submitted_by !== currentUser.id;
  if (isOpponent && !currentProfile?.is_banned) return `<button class="text-btn" data-confirm-match="${m.id}">确认</button> <button class="text-btn danger-text" data-reject-match="${m.id}">拒绝</button>`;
  if (isStaff() && m.status==='approved') return `<button class="text-btn danger-text" data-cancel-match="${m.id}">撤销</button>`;
  if (isStaff() && (m.status==='rejected' || m.status==='cancelled')) return `<button class="text-btn danger-text" data-delete-match="${m.id}">彻底删除</button>`;
  if (isStaff() && m.status==='pending_opponent') return `<button class="text-btn danger-text" data-reject-match="${m.id}">拒绝</button>`;
  return '';
}
function deltaForMatch(m, playerId) {
  if (m.status !== 'approved' || !m._winnerId) return null;
  return m._winnerId === playerId ? m._delta : -m._delta;
}
function renderHistory() {
  const filter = els.historyFilter.value || 'all';
  let ms = state.matches.filter(canSeeMatch).sort((a,b)=>new Date(b.played_at)-new Date(a.played_at)||new Date(b.created_at)-new Date(a.created_at));
  if (filter !== 'all') ms = ms.filter(m=>m.status===filter);
  els.historyBody.innerHTML = ms.map(m=>{
    const a=profile(m.player_a_id), b=profile(m.player_b_id); const aDelta=deltaForMatch(m,m.player_a_id);
    return `<tr><td>${formatDate(m.played_at)}</td><td class="name-cell">${esc(a?.real_name||'未知')}</td><td><strong>${m.score_a}:${m.score_b}</strong></td><td class="name-cell">${esc(b?.real_name||'未知')}</td><td><span class="pill">${esc(competition(m.competition_id).name)}</span></td><td><span class="pill ${m.status==='approved'?'active':m.status==='cancelled'||m.status==='rejected'?'off':''}">${esc(STATUS_NAMES[m.status]||m.status)}</span></td><td class="${aDelta==null?'neutral':aDelta>=0?'positive':'negative'}">${aDelta==null?'—':(aDelta>=0?'+':'−')+formatRating(Math.abs(aDelta))}</td><td>${matchActionHtml(m)}</td></tr>`;
  }).join('') || '<tr><td colspan="8"><div class="empty">没有符合条件的记录。</div></td></tr>';
}

function renderH2H() {
  const a=profile(els.h2hA.value), b=profile(els.h2hB.value);
  if (!a || !b || a.id===b.id) { els.h2hContent.innerHTML='<div class="card empty">请选择两名不同的选手。</div>'; return; }
  const ms=state.matches.filter(m=>m.status==='approved' && ((m.player_a_id===a.id&&m.player_b_id===b.id)||(m.player_a_id===b.id&&m.player_b_id===a.id))).sort((x,y)=>new Date(y.played_at)-new Date(x.played_at));
  let aw=0,bw=0,ad=0,bd=0;
  ms.forEach(m=>{ const d=deltaForMatch(m,a.id)||0; ad+=d; bd-=d; if(m._winnerId===a.id) aw++; else bw++; });
  els.h2hContent.innerHTML=`<div class="h2h-summary"><div class="h2h-stat"><span>${esc(a.real_name)} 胜场</span><strong>${aw}</strong></div><div class="h2h-stat"><span>${esc(b.real_name)} 胜场</span><strong>${bw}</strong></div><div class="h2h-stat"><span>总交手</span><strong>${ms.length}</strong></div><div class="h2h-stat"><span>${esc(a.real_name)} 累计净变动</span><strong class="${ad>=0?'positive':'negative'}">${ad>=0?'+':'−'}${formatRating(Math.abs(ad))}</strong></div><div class="h2h-stat"><span>${esc(b.real_name)} 累计净变动</span><strong class="${bd>=0?'positive':'negative'}">${bd>=0?'+':'−'}${formatRating(Math.abs(bd))}</strong></div></div><div class="card"><div class="card-head"><div><div class="h2h-title">${esc(a.real_name)} vs ${esc(b.real_name)}</div><span class="muted">仅统计已生效比赛</span></div></div><div class="table-wrap"><table class="data-table"><thead><tr><th>日期</th><th>比分</th><th>胜者</th><th>比赛类型</th><th>${esc(a.real_name)} 积分变化</th></tr></thead><tbody>${ms.map(m=>{const winner=profile(m._winnerId);const d=deltaForMatch(m,a.id)||0;return `<tr><td>${formatDateLong(m.played_at)}</td><td><strong>${m.player_a_id===a.id?m.score_a:m.score_b}:${m.player_a_id===a.id?m.score_b:m.score_a}</strong></td><td>${esc(winner?.real_name||'未知')}</td><td>${esc(competition(m.competition_id).name)}</td><td class="${d>=0?'positive':'negative'}">${d>=0?'+':'−'}${formatRating(Math.abs(d))}</td></tr>`;}).join('')||'<tr><td colspan="5"><div class="empty">两人还没有交手记录。</div></td></tr>'}</tbody></table></div></div>`;
}

function renderAdmin() {
  if (!isStaff()) { els.adminContent.innerHTML='<div class="card empty">你没有访问管理后台的权限。</div>'; return; }
  const pending = state.matches.filter(m=>m.status==='pending_opponent').sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
  const rows = state.profiles.slice().sort((a,b)=>a.real_name.localeCompare(b.real_name,'zh-CN'));
  els.adminContent.innerHTML = `
    <div class="stats-grid admin-stats">
      <div class="stat-card"><div class="stat-label">待审核/确认</div><div class="stat-value">${pending.length}</div></div>
      <div class="stat-card"><div class="stat-label">账号总数</div><div class="stat-value">${state.profiles.length}</div></div>
      <div class="stat-card"><div class="stat-label">副管理员</div><div class="stat-value">${state.profiles.filter(p=>p.role==='moderator').length}</div></div>
      <div class="stat-card"><div class="stat-label">封禁账号</div><div class="stat-value">${state.profiles.filter(p=>p.is_banned).length}</div></div>
    </div>
    <div class="card"><div class="card-head"><div><h2>待处理比赛</h2><span class="muted">副管理员和管理员可以审核；参赛对手可以确认。</span></div></div><div class="table-wrap"><table class="data-table"><thead><tr><th>提交时间</th><th>比赛</th><th>比分</th><th>级别</th><th>提交人</th><th>操作</th></tr></thead><tbody>${pending.map(m=>`<tr><td>${formatDate(m.created_at)}</td><td class="name-cell">${esc(playerLabel(m.player_a_id))} vs ${esc(playerLabel(m.player_b_id))}</td><td><strong>${m.score_a}:${m.score_b}</strong></td><td>${esc(competition(m.competition_id).name)}</td><td>${esc(playerLabel(m.submitted_by))}</td><td>${matchActionHtml(m)}</td></tr>`).join('')||'<tr><td colspan="6"><div class="empty">没有待处理比赛。</div></td></tr>'}</tbody></table></div></div>
    <div class="card"><div class="card-head"><div><h2>账号管理</h2><span class="muted">管理员可以封禁账号、添加/取消副管理员、为用户设置新的临时密码。系统不会显示用户现有密码。没有已生效比赛的账号可以永久删除；未生效、已拒绝或已撤销的关联记录会在删除账号时一并清理。</span></div></div><div class="table-wrap"><table class="data-table"><thead><tr><th>真实姓名</th><th>用户名</th><th>角色</th><th>积分</th><th>状态</th><th>注册时间</th><th>操作</th></tr></thead><tbody>${rows.map(p=>{const r=rankingRows().find(x=>x.id===p.id);const self=currentUser?.id===p.id;return `<tr><td class="name-cell">${esc(p.real_name)}</td><td>@${esc(p.username)}</td><td><span class="pill">${p.role==='admin'?'管理员':p.role==='moderator'?'副管理员':'选手'}</span></td><td>${formatRating(r?.rating??INITIAL_RATING)}</td><td><span class="pill ${p.is_banned?'off':'active'}">${p.is_banned?'封禁':'正常'}</span></td><td>${formatDateLong(p.created_at)}</td><td>${isAdmin()&&!self?`<select class="admin-role-select" data-role-user="${p.id}"><option value="player" ${p.role==='player'?'selected':''}>选手</option><option value="moderator" ${p.role==='moderator'?'selected':''}>副管理员</option></select> <button class="text-btn ${p.is_banned?'':'danger-text'}" data-ban-user="${p.id}">${p.is_banned?'解封':'封禁'}</button> <button class="text-btn" data-reset-password="${p.id}">重置密码</button> <button class="text-btn danger-text" data-delete-user="${p.id}">永久删除</button>`:'—'}</td></tr>`;}).join('')||'<tr><td colspan="7"><div class="empty">没有账号。</div></td></tr>'}</tbody></table></div></div>
    ${isAdmin()?`<div class="card"><div class="card-head"><div><h2>操作日志</h2><span class="muted">账号权限变更和比赛审核/撤销会记录。</span></div><button class="btn btn-ghost" id="refreshAuditBtn">刷新日志</button></div><div id="auditContent"><div class="empty">正在加载…</div></div></div>`:''}
  `;
  if (isAdmin()) loadAuditLogs();
}

async function loadAuditLogs() {
  const host = $('auditContent'); if (!host || !supabaseClient) return;
  const { data, error } = await supabaseClient.from('audit_logs').select('*').order('created_at',{ascending:false}).limit(100);
  if (error) { host.innerHTML=`<div class="empty">日志读取失败：${esc(error.message)}</div>`; return; }
  host.innerHTML = data.map(x=>`<div class="audit-row"><div><strong>${esc(x.action)}</strong><span class="muted"> ${esc(playerLabel(x.actor_id))}</span></div><div class="muted">${formatDateLong(x.created_at)}</div></div>`).join('') || '<div class="empty">暂无日志。</div>';
}

function updateAuthUi() {
  document.querySelectorAll('.staff-only').forEach(el=>el.hidden=!isStaff());
  if (!currentProfile) {
    els.loginBtn.textContent = '登录';
    els.loginBtn.className = 'btn btn-ghost';
    els.loginBtn.onclick = () => openAuth('login');
    els.signupBtn.hidden = false;
    els.signupBtn.textContent = '注册';
    els.signupBtn.className = 'btn btn-primary';
    els.signupBtn.onclick = () => openAuth('signup');
  } else {
    els.loginBtn.textContent = `${currentProfile.real_name} · 我的账号`;
    els.loginBtn.className = 'btn btn-ghost user-button';
    els.loginBtn.onclick = openProfile;
    els.signupBtn.hidden = true;
    els.signupBtn.onclick = null;
  }
  const canWrite = currentProfile && !currentProfile.is_banned;
  els.matchEditor.hidden = !canWrite;
  els.matchAuthNotice.hidden = !!canWrite;
  if (!canWrite) {
    els.matchAuthNotice.innerHTML = currentProfile?.is_banned ? '<strong>账号已被封禁。</strong> 当前不能提交或确认比赛，请联系管理员。' : '<strong>请先登录。</strong> 选手登录后才能提交比赛记录，对手确认后才会进入排行榜。';
  }
}

function navigate(view) {
  currentView = view;
  document.querySelectorAll('.view').forEach(x=>x.classList.toggle('active', x.id===`view-${view}`));
  document.querySelectorAll('.nav-tab').forEach(x=>x.classList.toggle('active', x.dataset.view===view));
  if (view==='ranking') renderRanking();
  if (view==='history') renderHistory();
  if (view==='headtohead') renderH2H();
  if (view==='admin') renderAdmin();
  window.scrollTo({top:0,behavior:'smooth'});
}

function showToast(message, type='success') {
  const t=document.createElement('div'); t.className=`toast ${type}`; t.textContent=message; els.toastRegion.appendChild(t); setTimeout(()=>t.remove(),4500);
}

function openAuth(mode='login') { els.authBackdrop.hidden=false; switchAuthTab(mode); setTimeout(()=> (authMode==='login'?els.loginUsername:els.signupRealName).focus(),30); }
function closeAuth() { els.authBackdrop.hidden=true; }
function switchAuthTab(mode='login') {
  authMode = mode === 'signup' ? 'signup' : 'login';
  document.querySelectorAll('.auth-tab').forEach(b=>
    b.classList.toggle('active', b.dataset.authTab === authMode)
  );

  const showLogin = authMode === 'login';
  const showSignup = authMode === 'signup';

  // Use an explicit CSS class in addition to the hidden attribute.
  // This prevents .auth-form { display:grid } from ever making the
  // inactive form visible.
  els.loginForm.classList.toggle('is-hidden', !showLogin);
  els.signupForm.classList.toggle('is-hidden', !showSignup);
  els.loginForm.hidden = !showLogin;
  els.signupForm.hidden = !showSignup;
  els.loginForm.setAttribute('aria-hidden', String(!showLogin));
  els.signupForm.setAttribute('aria-hidden', String(!showSignup));

  // Disable controls in the hidden form so browser validation cannot
  // interfere with the visible form.
  els.loginUsername.disabled = !showLogin;
  els.loginPassword.disabled = !showLogin;
  els.signupRealName.disabled = !showSignup;
  els.signupUsername.disabled = !showSignup;
  els.signupPassword.disabled = !showSignup;
}
function openProfile() {
  if (!currentProfile) return openAuth();
  els.profileSummary.innerHTML=`<div><span>角色</span><strong>${currentProfile.role==='admin'?'管理员':currentProfile.role==='moderator'?'副管理员':'选手'}</strong></div><div><span>状态</span><strong>${currentProfile.is_banned?'封禁':'正常'}</strong></div>`;
  els.profileRealName.value=currentProfile.real_name;
  els.profileUsername.value=currentProfile.username;
  els.profileBackdrop.hidden=false;
}
function closeProfile() { els.profileBackdrop.hidden=true; }

async function signUp() {
  if (!supabaseClient) throw new Error('尚未配置 Supabase，请先填写 supabase-config.js。');
  const realName=els.signupRealName.value.trim();
  const username=els.signupUsername.value.trim().toLowerCase();
  const password=els.signupPassword.value;
  if (!realName) throw new Error('请输入真实姓名。');
  if (!/^[a-z0-9_.-]{3,24}$/.test(username)) throw new Error('用户名需为 3-24 位小写字母、数字、下划线、点或短横线。');
  if (password.length<8) throw new Error('密码至少 8 位。');
  const { data: exists, error: existsError } = await supabaseClient.from('profiles').select('id').eq('username',username).maybeSingle();
  if (existsError) throw existsError;
  if (exists) throw new Error('用户名已被使用，请换一个。');
  const email=`${username}@login.cyez.local`;
  const { data, error }=await supabaseClient.auth.signUp({email,password,options:{data:{real_name:realName,username}}});
  if (error) throw error;
  if (!data.session) throw new Error('注册成功，但当前 Supabase 仍要求邮箱确认。请在 Auth 设置中关闭 Confirm Email 后重试。');
  closeAuth(); await refreshData(); showToast('注册成功，欢迎加入 CYEZ。');
}

async function signIn() {
  if (!supabaseClient) throw new Error('尚未配置 Supabase，请先填写 supabase-config.js。');
  const username=els.loginUsername.value.trim().toLowerCase();
  const password=els.loginPassword.value;
  const { data: p, error: profileError }=await supabaseClient.from('profiles').select('id,username').eq('username',username).maybeSingle();
  if (profileError) throw profileError;
  if (!p) throw new Error('用户名或密码错误。');
  const email=`${p.username}@login.cyez.local`;
  const { error }=await supabaseClient.auth.signInWithPassword({email,password});
  if (error) throw error;
  closeAuth(); await loadSession(); showToast('登录成功。');
}

async function signOut() {
  if (supabaseClient) await supabaseClient.auth.signOut();
  currentUser=null; currentProfile=null; updateAuthUi(); refreshSelects(); renderDashboard(); renderHistory(); renderAdmin(); showToast('已退出登录。');
}

async function loadSession() {
  if (!supabaseClient) return;
  const { data }=await supabaseClient.auth.getSession();
  currentUser=data.session?.user || null;
  if (currentUser) await fetchCurrentProfile(); else currentProfile=null;
  updateAuthUi();
}
async function fetchCurrentProfile() {
  if (!currentUser) { currentProfile=null; return; }
  const { data,error }=await supabaseClient.from('profiles').select('*').eq('id',currentUser.id).maybeSingle();
  if (error) throw error;
  currentProfile=data;
  if (currentProfile?.is_banned) {
    showToast('你的账号已被管理员封禁。','error');
  }
}

async function refreshData() {
  if (!supabaseClient) {
    renderUnconfigured();
    return;
  }
  const [{data:profiles,error:pErr},{data:matches,error:mErr}] = await Promise.all([
    supabaseClient.from('profiles').select('id,real_name,username,role,is_banned,created_at').order('created_at',{ascending:true}),
    supabaseClient.from('matches').select('*').order('played_at',{ascending:true})
  ]);
  if (pErr) throw pErr; if (mErr) throw mErr;
  state.profiles=profiles||[]; state.matches=matches||[];
  rebuildRatings(); refreshSelects(); renderDashboard(); renderRanking(); renderHistory(); renderAdmin(); updateAuthUi();
}
function renderUnconfigured() {
  els.dashboardStats.innerHTML='<div class="config-warning"><strong>网站尚未连接云端数据库。</strong><span>请编辑 <code>supabase-config.js</code> 填入 Supabase URL 和 Publishable / anon key，然后部署到 GitHub Pages。</span></div>';
  els.accountBanner.innerHTML='<div><strong>配置 Supabase 后启用实时系统</strong><span>当前只能查看页面框架。</span></div>';
}

async function submitMatch(e) {
  e.preventDefault();
  try {
    if (!currentUser || !currentProfile || currentProfile.is_banned) throw new Error('请先登录，并确保账号没有被封禁。');
    const a=profile(els.playerA.value), b=profile(els.playerB.value);
    const sa=Number(els.scoreA.value), sb=Number(els.scoreB.value);
    if (!a || !b || a.id===b.id) throw new Error('请选择两名不同的选手。');
    if (a.id!==currentUser.id && b.id!==currentUser.id) throw new Error('你只能提交自己参与的比赛。');
    if (!Number.isInteger(sa)||!Number.isInteger(sb)||sa<0||sb<0||sa===sb) throw new Error('请输入有效比分，双方局数不能相同。');
    if (sa>99||sb>99) throw new Error('比分不能超过 99。');
    const payload={played_at:new Date(els.matchDate.value).toISOString(),competition_id:els.competitionType.value,player_a_id:a.id,player_b_id:b.id,score_a:sa,score_b:sb,submitted_by:currentUser.id,status:'pending_opponent'};
    const {error}=await supabaseClient.from('matches').insert(payload);
    if (error) throw error;
    showToast(`${a.real_name} ${sa}:${sb} ${b.real_name} 已提交，等待对手确认。`);
    els.matchForm.reset(); setDefaultDate(); els.scoreA.value=4; els.scoreB.value=0; refreshData(); navigate('history');
  } catch (err) { showToast(err.message || '提交失败。','error'); }
}

async function updateMatchStatus(id, status) {
  const { error }=await supabaseClient.from('matches').update({status}).eq('id',id);
  if (error) throw error;
}
async function confirmMatch(id) {
  try { await updateMatchStatus(id,'approved'); await refreshData(); showToast('比赛已确认并计入排行榜。'); }
  catch(e){showToast(e.message || '确认失败。','error');}
}
async function rejectMatch(id) {
  try { await updateMatchStatus(id,'rejected'); await refreshData(); showToast('比赛已拒绝。'); }
  catch(e){showToast(e.message || '操作失败。','error');}
}
async function cancelMatch(id) {
  const m=state.matches.find(x=>x.id===id); if(!m) return;
  if (!confirm(`确定撤销 ${playerLabel(m.player_a_id)} ${m.score_a}:${m.score_b} ${playerLabel(m.player_b_id)} 吗？撤销后系统会自动按剩余生效比赛重算积分。`)) return;
  try { await updateMatchStatus(id,'cancelled'); await refreshData(); showToast('比赛已撤销，积分已自动重新计算。'); }
  catch(e){showToast(e.message || '撤销失败。','error');}
}

async function deleteMatch(id) {
  if (!isAdmin()) return;
  const m=state.matches.find(x=>x.id===id); if(!m) return;
  if (!['rejected','cancelled'].includes(m.status)) { showToast('只有已拒绝或已撤销的比赛记录可以彻底删除。','error'); return; }
  const ok = confirm(`确定永久删除这条历史记录吗？\n\n${playerLabel(m.player_a_id)} ${m.score_a}:${m.score_b} ${playerLabel(m.player_b_id)}\n\n删除后无法恢复。`);
  if (!ok) return;
  try {
    const {error}=await supabaseClient.rpc('admin_delete_match',{target_match_id:id});
    if(error) throw error;
    await refreshData();
    showToast('历史比赛记录已彻底删除。');
  } catch(e) {
    showToast(e.message || '历史比赛删除失败。','error');
  }
}

async function updateRole(userId, role) {
  if (!isAdmin()) return;
  try { const {error}=await supabaseClient.from('profiles').update({role}).eq('id',userId); if(error)throw error; await refreshData(); showToast('账号角色已更新。'); }
  catch(e){showToast(e.message||'角色更新失败。','error');}
}
async function toggleBan(userId) {
  if (!isAdmin()) return;
  const p=profile(userId); if(!p) return;
  const next=!p.is_banned;
  if (!confirm(`确定${next?'封禁':'解封'}账号“${p.real_name}（@${p.username}）”吗？`)) return;
  try { const {error}=await supabaseClient.from('profiles').update({is_banned:next}).eq('id',userId); if(error)throw error; await refreshData(); showToast(`账号已${next?'封禁':'解封'}。`); }
  catch(e){showToast(e.message||'账号状态更新失败。','error');}
}

async function deleteUser(userId) {
  if (!isAdmin()) return;
  const p=profile(userId); if(!p || userId===currentUser?.id) return;
  const linked = state.matches.filter(m => m.player_a_id===userId || m.player_b_id===userId || m.submitted_by===userId);
  const approvedMatches = linked.filter(m => m.status==='approved');
  if (approvedMatches.length > 0) {
    showToast(`账号“${p.real_name}（@${p.username}）”还有 ${approvedMatches.length} 条已生效比赛。请先逐场撤销这些比赛，才能永久删除账号。`, 'error');
    return;
  }
  const removableMatches = linked.filter(m => ['pending_opponent','rejected','cancelled'].includes(m.status)).length;
  const extra = removableMatches ? `\n\n该账号还有 ${removableMatches} 条未生效/已撤销记录，删除账号时会一并永久清理。` : '';
  const ok = confirm(`确定永久删除账号“${p.real_name}（@${p.username}）”吗？${extra}\n\n此操作会删除该账号的登录信息和选手资料，且无法恢复。`);
  if (!ok) return;
  try {
    const { error } = await supabaseClient.rpc('admin_delete_user', { target_user_id: userId });
    if (error) throw error;
    await refreshData();
    showToast(`账号“${p.real_name}”已永久删除。`);
  } catch(e) {
    showToast(e.message || '账号删除失败。', 'error');
  }
}

function generateTempPassword(length=12) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
  const array = new Uint32Array(length);
  crypto.getRandomValues(array);
  let out='';
  for (let i=0;i<length;i++) out += alphabet[array[i] % alphabet.length];
  return out;
}

function openAdminResetPassword(userId) {
  if (!isAdmin()) return;
  const p=profile(userId);
  if (!p || userId===currentUser?.id || p.role==='admin') {
    showToast('出于安全考虑，不能重置其他 admin 或当前登录账号的密码。','error');
    return;
  }
  els.adminResetSummary.innerHTML=`<div><span>真实姓名</span><strong>${esc(p.real_name)}</strong></div><div><span>用户名</span><strong>@${esc(p.username)}</strong></div>`;
  els.adminResetForm.dataset.targetUserId=userId;
  els.adminResetPassword.value=generateTempPassword();
  els.adminResetBackdrop.hidden=false;
  setTimeout(()=>els.adminResetPassword.select(),30);
}

function closeAdminResetPassword() {
  els.adminResetBackdrop.hidden=true;
  els.adminResetForm.reset();
}

async function adminResetPassword(e) {
  e.preventDefault();
  if (!isAdmin()) return;
  const targetUserId = els.adminResetForm.dataset.targetUserId;
  if (!targetUserId) {
    showToast('没有选择需要重置密码的用户。','error');
    return;
  }
  const password = els.adminResetPassword.value;
  if (password.length < 8) {
    showToast('临时密码至少 8 位。','error');
    return;
  }
  try {
    const { data: sessionData, error: sessionError } = await supabaseClient.auth.getSession();
    if (sessionError) throw sessionError;
    const token = sessionData.session?.access_token;
    if (!token) throw new Error('登录状态已失效，请重新登录。');
    const { data, error } = await supabaseClient.functions.invoke('admin-reset-password', {
      body: { target_user_id: targetUserId, password }
    });
    if (error) throw error;
    if (!data?.success) throw new Error(data?.error || '密码重置失败。');
    closeAdminResetPassword();
    showToast(`已为 ${playerLabel(targetUserId)} 设置新的临时密码。请安全地转交给用户，并让其登录后立即修改。`);
  } catch(e) {
    showToast(e.message || '管理员重置密码失败。请确认 Edge Function 已部署。','error');
  }
}

async function changeOwnPassword(e) {
  e.preventDefault();
  try {
    if (!currentUser || !currentProfile || currentProfile.is_banned) throw new Error('请先登录且账号不能处于封禁状态。');
    const currentPassword=els.profileCurrentPassword.value;
    const newPassword=els.profileNewPassword.value;
    const confirmPassword=els.profileConfirmPassword.value;
    if (newPassword.length < 8) throw new Error('新密码至少 8 位。');
    if (newPassword !== confirmPassword) throw new Error('两次输入的新密码不一致。');
    if (newPassword === currentPassword) throw new Error('新密码不能与当前密码相同。');
    const { error } = await supabaseClient.auth.updateUser({ password:newPassword, current_password:currentPassword });
    if (error) throw error;
    els.passwordForm.reset();
    showToast('密码修改成功。请使用新密码登录。');
  } catch(e) {
    showToast(e.message || '密码修改失败。','error');
  }
}

async function saveProfile(e) {
  e.preventDefault();
  try {
    const name=els.profileRealName.value.trim();
    if(!name) throw new Error('姓名不能为空。');
    const {error}=await supabaseClient.from('profiles').update({real_name:name}).eq('id',currentUser.id);
    if(error)throw error;
    await fetchCurrentProfile(); closeProfile(); await refreshData(); showToast('账号资料已保存。');
  } catch(e){showToast(e.message||'保存失败。','error');}
}

function setupRealtime() {
  if (!supabaseClient) return;
  if (realtimeChannel) supabaseClient.removeChannel(realtimeChannel);
  realtimeChannel=supabaseClient.channel('cyez-live')
    .on('postgres_changes',{event:'*',schema:'public',table:'profiles'},async()=>{try{await refreshData();}catch(e){console.error(e);}})
    .on('postgres_changes',{event:'*',schema:'public',table:'matches'},async()=>{try{await refreshData();}catch(e){console.error(e);}})
    .subscribe((status)=>{
      els.liveStatus.innerHTML = status==='SUBSCRIBED' ? '<i></i> 实时同步中' : '<i class="off-dot"></i> 正在连接…';
    });
}

async function init() {
  populateCompetition(); setDefaultDate();
  bindEvents();
  if (!supabaseClient) { renderUnconfigured(); updateAuthUi(); return; }
  try {
    await loadSession();
    await refreshData();
    setupRealtime();
    supabaseClient.auth.onAuthStateChange(async (_event, session)=>{
      currentUser=session?.user || null;
      await fetchCurrentProfile();
      updateAuthUi();
      try { await refreshData(); } catch(e) { console.error(e); }
    });
  } catch(e) { showToast(e.message||'连接数据库失败。','error'); }
}

function bindEvents() {
  document.addEventListener('click', async e=>{
    const tab=e.target.closest('[data-view]'); if(tab){navigate(tab.dataset.view);return;}
    const go=e.target.closest('[data-go-view]'); if(go){navigate(go.dataset.goView);return;}
    const score=e.target.closest('[data-score]'); if(score){const [a,b]=score.dataset.score.split(':');els.scoreA.value=a;els.scoreB.value=b;updatePreview();return;}
    if(e.target.id==='bannerLoginBtn'){openAuth('login');return;}
    if(e.target.id==='bannerSignupBtn'){openAuth('signup');return;}
    if(e.target.id==='bannerProfileBtn'){openProfile();return;}
    const confirmBtn=e.target.closest('[data-confirm-match]'); if(confirmBtn){await confirmMatch(confirmBtn.dataset.confirmMatch);return;}
    const rejectBtn=e.target.closest('[data-reject-match]'); if(rejectBtn){await rejectMatch(rejectBtn.dataset.rejectMatch);return;}
    const cancelBtn=e.target.closest('[data-cancel-match]'); if(cancelBtn){await cancelMatch(cancelBtn.dataset.cancelMatch);return;}
    const deleteMatchBtn=e.target.closest('[data-delete-match]'); if(deleteMatchBtn){await deleteMatch(deleteMatchBtn.dataset.deleteMatch);return;}
    const banBtn=e.target.closest('[data-ban-user]'); if(banBtn){await toggleBan(banBtn.dataset.banUser);return;}
    const deleteBtn=e.target.closest('[data-delete-user]'); if(deleteBtn){await deleteUser(deleteBtn.dataset.deleteUser);return;}
    const resetPwdBtn=e.target.closest('[data-reset-password]'); if(resetPwdBtn){openAdminResetPassword(resetPwdBtn.dataset.resetPassword);return;}
    if(e.target.id==='refreshAuditBtn'){loadAuditLogs();return;}
  });
  document.querySelectorAll('[data-auth-tab]').forEach(btn=>btn.addEventListener('click',()=>switchAuthTab(btn.dataset.authTab)));
  // 登录/注册按钮通过 updateAuthUi() 设置 onclick；这里不要再绑定 openAuth，否则登录后点击“我的账号”会同时弹出认证弹窗。
  els.authClose.addEventListener('click',closeAuth);
  els.authBackdrop.addEventListener('click',e=>{if(e.target===els.authBackdrop)closeAuth();});
  els.loginForm.addEventListener('submit',async e=>{e.preventDefault();try{await signIn();}catch(err){showToast(err.message||'登录失败。','error');}});
  els.signupForm.addEventListener('submit',async e=>{e.preventDefault();try{await signUp();}catch(err){showToast(err.message||'注册失败。','error');}});
  els.profileClose.addEventListener('click',closeProfile);
  els.profileBackdrop.addEventListener('click',e=>{if(e.target===els.profileBackdrop)closeProfile();});
  els.profileForm.addEventListener('submit',saveProfile);
  els.passwordForm.addEventListener('submit',changeOwnPassword);
  els.logoutBtn.addEventListener('click',signOut);
  els.adminResetClose.addEventListener('click',closeAdminResetPassword);
  els.adminResetBackdrop.addEventListener('click',e=>{if(e.target===els.adminResetBackdrop)closeAdminResetPassword();});
  els.adminResetForm.addEventListener('submit',adminResetPassword);
  els.generateTempPasswordBtn.addEventListener('click',()=>{els.adminResetPassword.value=generateTempPassword(); els.adminResetPassword.select();});
  els.matchForm.addEventListener('submit',submitMatch);
  els.matchForm.addEventListener('reset',()=>setTimeout(()=>{setDefaultDate();updateRatingsInForm();updatePreview();},0));
  [els.playerA,els.playerB,els.scoreA,els.scoreB,els.competitionType].forEach(el=>el.addEventListener('input',updatePreview));
  els.competitionType.addEventListener('change',updatePreview);
  els.playerA.addEventListener('change',()=>{updateRatingsInForm();updatePreview();});
  els.playerB.addEventListener('change',()=>{updateRatingsInForm();updatePreview();});
  els.rankingSearch.addEventListener('input',renderRanking);
  els.historyFilter.addEventListener('change',renderHistory);
  els.h2hA.addEventListener('change',renderH2H); els.h2hB.addEventListener('change',renderH2H);
  document.addEventListener('change',e=>{const role=e.target.closest('[data-role-user]');if(role)updateRole(role.dataset.roleUser,role.value);});
}

init();
