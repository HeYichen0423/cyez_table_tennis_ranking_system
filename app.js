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
  // 新规则：这些 ID 用于今后新录入的比赛。
  friendly_new: { id: 'friendly_new', name: '友谊赛', weight: 0.3 },
  monthly: { id: 'monthly', name: '月赛', weight: 0.5 },
  small_qualifier: { id: 'small_qualifier', name: '小赛预选赛', weight: 0.6 },
  club_new: { id: 'club_new', name: '社团赛', weight: 0.7 },
  major_qualifier: { id: 'major_qualifier', name: '大赛预选赛', weight: 0.7 },
  district_city: { id: 'district_city', name: '区赛 / 市赛', weight: 0.8 },
  special: { id: 'special', name: '专项赛', weight: 1.0 },

  // 兼容历史记录：旧 ID 继续使用原来的权重，避免规则升级后历史积分被悄悄改变。
  legacy_friendly: { id: 'legacy_friendly', name: '历史：友谊赛', weight: 0.2, visible: false },
  legacy_club: { id: 'legacy_club', name: '历史：社团组织比赛', weight: 0.5, visible: false },
  legacy_school_qualifier: { id: 'legacy_school_qualifier', name: '历史：校级比赛预选赛', weight: 0.5, visible: false },
  legacy_district_qualifier: { id: 'legacy_district_qualifier', name: '历史：区赛 / 市赛预选赛', weight: 0.8, visible: false },
  legacy_school_official: { id: 'legacy_school_official', name: '历史：校级正式比赛', weight: 1.0, visible: false }
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
  approvedMatches: [],
  notifications: [],
  boardPosts: [],
  boardComments: [],
  boardTodayCount: 0,
  boardPage: 1
};
let currentUser = null;
let currentProfile = null;
let realtimeChannel = null;
let currentView = 'dashboard';
let authMode = 'login';
let passwordChangeRequired = false;
let startupAttempt = 0;
let themeMediaQuery = null;

const $ = id => document.getElementById(id);
const els = {
  liveStatus: $('liveStatus'),
  startupOverlay: $('startupOverlay'),
  startupTitle: $('startupTitle'),
  startupMessage: $('startupMessage'),
  startupRetryBtn: $('startupRetryBtn'),
  themeSelect: $('themeSelect'),
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
  exportRankingBtn: $('exportRankingBtn'),
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
  adminCreateUserBackdrop: $('adminCreateUserBackdrop'),
  adminCreateUserClose: $('adminCreateUserClose'),
  adminCreateUserCancel: $('adminCreateUserCancel'),
  adminCreateUserForm: $('adminCreateUserForm'),
  adminCreateRealName: $('adminCreateRealName'),
  adminCreateUsername: $('adminCreateUsername'),
  adminCreateResult: $('adminCreateResult'),
  adminCreateResultUsername: $('adminCreateResultUsername'),
  adminCreateResultPassword: $('adminCreateResultPassword'),
  adminCreateCopyPassword: $('adminCreateCopyPassword'),
  adminResetBackdrop: $('adminResetBackdrop'),
  adminResetClose: $('adminResetClose'),
  adminResetSummary: $('adminResetSummary'),
  adminResetForm: $('adminResetForm'),
  adminResetPassword: $('adminResetPassword'),
  notificationBadge: $('notificationBadge'),
  notificationsList: $('notificationsList'),
  markAllNotificationsBtn: $('markAllNotificationsBtn'),
  messageBoardForm: $('messageBoardForm'),
  messageBoardContent: $('messageBoardContent'),
  messageBoardQuota: $('messageBoardQuota'),
  messageBoardLoginHint: $('messageBoardLoginHint'),
  messageBoardAnonymous: $('messageBoardAnonymous'),
  messageBoardMentionHint: $('messageBoardMentionHint'),
  messageBoardList: $('messageBoardList'),
  messageBoardPagination: $('messageBoardPagination'),
  rosterFile: $('rosterFile'),
  rosterImportStatus: $('rosterImportStatus')
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
function competition(id) {
  const direct = COMPETITIONS[id];
  if (direct) return direct;
  const legacyMap = {
    friendly: COMPETITIONS.legacy_friendly,
    club: COMPETITIONS.legacy_club,
    school_qualifier: COMPETITIONS.legacy_school_qualifier,
    district_qualifier: COMPETITIONS.legacy_district_qualifier,
    school_official: COMPETITIONS.legacy_school_official
  };
  return legacyMap[id] || { name: id || '未知', weight: 0 };
}
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
  state.ratings = new Map(state.profiles.map(p => [p.id, Number(p.initial_rating ?? INITIAL_RATING)]));
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
  window.CYEZ_EXTERNAL_RATINGS = Object.fromEntries([...state.ratings.entries()]);
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
  els.competitionType.innerHTML = Object.values(COMPETITIONS).filter(c => c.visible !== false).map(c => `<option value="${c.id}">${esc(c.name)}（${c.weight}）</option>`).join('');
  els.competitionType.value = 'friendly_new';
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

function getSystemTheme() {
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
function applyTheme(mode) {
  const normalized = ['light','dark','system'].includes(mode) ? mode : 'system';
  const actual = normalized === 'system' ? getSystemTheme() : normalized;
  document.documentElement.dataset.theme = actual;
  if (els.themeSelect) els.themeSelect.value = normalized;
  localStorage.setItem('cyez-theme', normalized);
  if (themeMediaQuery) themeMediaQuery.onchange = null;
  if (normalized === 'system' && window.matchMedia) {
    themeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    themeMediaQuery.onchange = () => document.documentElement.dataset.theme = getSystemTheme();
  }
}
function initTheme() {
  applyTheme(localStorage.getItem('cyez-theme') || 'system');
  if (els.themeSelect) els.themeSelect.addEventListener('change', e => applyTheme(e.target.value));
}
function showStartupConnecting() {
  if (!els.startupOverlay) return;
  els.startupOverlay.hidden = false;
  els.startupOverlay.classList.remove('error-state');
  els.startupTitle.textContent = '正在连接服务器';
  els.startupMessage.textContent = '正在连接 CYEZ 云端数据库，请稍候…';
  els.startupRetryBtn.hidden = true;
}
function showStartupError(message='服务器连接超时，请稍后再试。') {
  if (!els.startupOverlay) return;
  els.startupOverlay.hidden = false;
  els.startupOverlay.classList.add('error-state');
  els.startupTitle.textContent = '暂时无法连接服务器';
  els.startupMessage.textContent = message;
  els.startupRetryBtn.hidden = false;
}
function hideStartupOverlay() {
  if (!els.startupOverlay) return;
  els.startupOverlay.classList.add('closing');
  setTimeout(()=>{ els.startupOverlay.hidden = true; els.startupOverlay.classList.remove('closing'); }, 180);
}
async function bootWithTimeout(timeoutMs=12000) {
  const attempt = ++startupAttempt;
  showStartupConnecting();
  if (!supabaseClient) {
    showStartupError('尚未配置 Supabase，请先检查 supabase-config.js。');
    return false;
  }
  const boot = (async()=>{
    await loadSession();
    await refreshData();
  })();
  const timeout = new Promise((_, reject)=>setTimeout(()=>reject(new Error('TIMEOUT')), timeoutMs));
  try {
    await Promise.race([boot, timeout]);
    if (attempt !== startupAttempt) return false;
    hideStartupOverlay();
    showToast('欢迎进入CYEZ乒乓球积分系统！');
    return true;
  } catch (e) {
    if (attempt !== startupAttempt) return false;
    if (e?.message === 'TIMEOUT') showStartupError('服务器连接超时，请稍后再试。');
    else showStartupError(e?.message || '服务器连接失败，请稍后再试。');
    return false;
  }
}

function unreadNotificationCount() {
  return state.notifications.filter(n => !n.read_at).length;
}

function renderNotificationBadge() {
  const count = unreadNotificationCount();
  if (els.notificationBadge) {
    els.notificationBadge.textContent = count ? (count > 99 ? '99+' : String(count)) : '';
    els.notificationBadge.hidden = count === 0;
  }
  document.querySelectorAll('[data-notification-badge]').forEach(el => {
    el.textContent = count ? (count > 99 ? '99+' : String(count)) : '';
    el.hidden = count === 0;
  });
}

function renderNotifications() {
  if (!els.notificationsList) return;
  const items = [...state.notifications].sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
  els.notificationsList.innerHTML = items.map(n => {
    const unread = !n.read_at;
    const safeBody = esc(n.body || '');
    const action = n.match_id ? `<button class="text-btn" data-notification-match="${esc(n.match_id)}">查看比赛</button>` : (n.message_post_id ? `<button class="text-btn" data-notification-message="${esc(n.message_post_id)}">查看留言</button>` : '');
    return `<div class="notification-item ${unread?'unread':''}" data-notification-row="${n.id}">
      <div class="notification-dot"></div>
      <div class="notification-main"><div class="notification-title">${esc(n.title||'通知')}</div><div class="notification-body">${safeBody}</div><div class="notification-time">${formatDateLong(n.created_at)}</div></div>
      <div class="notification-actions">${action}${unread?`<button class="text-btn" data-notification-read="${n.id}">标为已读</button>`:''}</div>
    </div>`;
  }).join('') || '<div class="empty">暂无通知。</div>';
  renderNotificationBadge();
}

async function loadNotifications() {
  if (!supabaseClient || !currentUser) { state.notifications=[]; renderNotifications(); return; }
  let data, error;
  ({ data, error } = await supabaseClient.from('notifications').select('id,type,title,body,match_id,tournament_id,message_post_id,read_at,created_at').eq('recipient_id',currentUser.id).order('created_at',{ascending:false}).limit(100));
  if (error && /message_post_id/i.test(error.message||'')) {
    ({ data, error } = await supabaseClient.from('notifications').select('id,type,title,body,match_id,tournament_id,read_at,created_at').eq('recipient_id',currentUser.id).order('created_at',{ascending:false}).limit(100));
  }
  if (error) {
    // 在数据库迁移完成前兼容旧站点；迁移完成后这里应正常读取。
    if (String(error.code||'')==='PGRST205' || /notifications/i.test(error.message||'')) { state.notifications=[]; renderNotifications(); return; }
    throw error;
  }
  state.notifications=data||[];
  renderNotifications();
  if (currentProfile) renderAccountBanner();
}

async function markNotificationRead(id) {
  if (!currentUser) return;
  try {
    const { error } = await supabaseClient.from('notifications').update({read_at: nowISO()}).eq('id',id).eq('recipient_id',currentUser.id);
    if (error) throw error;
    const n=state.notifications.find(x=>x.id===id); if(n)n.read_at=nowISO();
    renderNotifications();
  } catch(e){showToast(e.message||'通知更新失败。','error');}
}

async function markAllNotificationsRead() {
  if (!currentUser) return;
  try {
    const { error } = await supabaseClient.from('notifications').update({read_at: nowISO()}).eq('recipient_id',currentUser.id).is('read_at', null);
    if (error) throw error;
    state.notifications.forEach(n=>{if(!n.read_at)n.read_at=nowISO();});
    renderNotifications();
    showToast('已全部标为已读。');
  } catch(e){showToast(e.message||'操作失败。','error');}
}

function messageBoardDayCount() {
  return Number.isFinite(Number(state.boardTodayCount)) ? Number(state.boardTodayCount) : 0;
}

async function loadMessageBoard() {
  if (!supabaseClient) return;
  try { await supabaseClient.rpc('message_board_cleanup'); } catch (_) {}
  let posts = [];
  const { data: postData, error: pErr } = await supabaseClient.rpc('message_board_list');
  if (pErr) {
    if (String(pErr.code||'') === 'PGRST205' || /message_board/i.test(pErr.message||'')) {
      state.boardPosts=[]; state.boardComments=[]; state.boardTodayCount=0; renderMessageBoard(); return;
    }
    throw pErr;
  }
  posts = postData || [];
  state.boardPosts = posts;
  if (currentUser) {
    const { data: countData, error: countErr } = await supabaseClient.rpc('message_board_today_count');
    if (!countErr) state.boardTodayCount = Number(countData ?? 0);
  } else {
    state.boardTodayCount = 0;
  }
  const ids = state.boardPosts.map(p=>p.id);
  if (!ids.length) { state.boardComments=[]; renderMessageBoard(); return; }
  const { data: comments, error: cErr } = await supabaseClient.rpc('message_board_comments_list',{p_post_ids:ids});
  if (cErr) throw cErr;
  state.boardComments=comments||[];
  renderMessageBoard();
}

function renderMessageBoard() {
  if (!els.messageBoardList) return;
  const count = messageBoardDayCount();
  const adminViewer = isAdmin();
  if (els.messageBoardQuota) {
    els.messageBoardQuota.textContent = !currentUser ? '登录后可留言。' : adminViewer ? '' : `今天已发布 ${count}/3 条留言。`;
  }
  if (els.messageBoardForm) els.messageBoardForm.hidden = !currentUser || !!currentProfile?.is_banned;
  if (els.messageBoardLoginHint) els.messageBoardLoginHint.hidden = !!currentUser && !currentProfile?.is_banned;

  const visible = state.boardPosts.filter(p => !p.deleted_at && (p.is_pinned || !p.expires_at || new Date(p.expires_at) > new Date()));
  const pageSize = 10;
  const totalPages = Math.max(1, Math.ceil(visible.length / pageSize));
  state.boardPage = Math.min(Math.max(Number(state.boardPage) || 1, 1), totalPages);
  const start = (state.boardPage - 1) * pageSize;
  const pagePosts = visible.slice(start, start + pageSize);

  if (!visible.length) {
    els.messageBoardList.innerHTML = '<div class="card empty">还没有留言，来留下第一句话吧。</div>';
    if (els.messageBoardPagination) els.messageBoardPagination.innerHTML = '';
    return;
  }

  els.messageBoardList.innerHTML = pagePosts.map(post => {
    const authorName = post.author_real_name || '匿名用户';
    const authorUsername = post.author_username ? ` · @${esc(post.author_username)}` : '';
    const comments = state.boardComments.filter(c => c.post_id === post.id);
    const own = currentUser && post.author_id && currentUser.id === post.author_id;
    const canDelete = !!post.can_delete || !!own;
    const commentHtml = comments.map(c => {
      const ca = profile(c.author_id); const cOwn = currentUser?.id === c.author_id; const cCanDelete = cOwn || isAdmin();
      return `<div class="message-comment"><div><strong>${esc(ca?.real_name || '未知用户')}</strong><span class="muted"> · @${esc(ca?.username || '')} · ${formatDate(c.created_at)}</span></div><div class="message-comment-body">${esc(c.content).replace(/\n/g,'<br>')}</div>${cCanDelete ? `<button class="text-btn danger-text" data-delete-board-comment="${c.id}">删除</button>` : ''}</div>`;
    }).join('');
    const anonymousLabel = post.is_anonymous ? (adminViewer ? '<span class="pill">匿名发布</span>' : '') : '';
    return `<article class="card message-post ${post.is_pinned ? 'pinned' : ''}">
      <div class="message-post-head"><div><strong>${esc(authorName)}</strong>${authorUsername} ${anonymousLabel}</div><div class="message-post-meta">${post.is_pinned ? '<span class="pill active">置顶</span> ' : ''}${formatDate(post.created_at)}</div></div>
      <div class="message-post-content">${esc(post.content).replace(/\n/g,'<br>')}</div>
      <div class="message-post-actions">${canDelete ? `<button class="text-btn danger-text" data-delete-board-post="${post.id}">删除</button>` : ''}${post.can_pin ? `<button class="text-btn" data-pin-board-post="${post.id}" data-pin-value="${post.is_pinned ? 'false' : 'true'}">${post.is_pinned ? '取消置顶' : '置顶'}</button>` : ''}</div>
      <div class="message-comments">${commentHtml || '<div class="muted small">暂无评论。</div>'}</div>
      ${currentUser && !currentProfile?.is_banned ? `<form class="message-comment-form" data-comment-form="${post.id}"><input maxlength="500" placeholder="写评论…… 可用 @用户名 提醒对方" required><button class="btn btn-ghost btn-sm" type="submit">评论</button></form>` : ''}
    </article>`;
  }).join('');

  if (els.messageBoardPagination) {
    els.messageBoardPagination.innerHTML = totalPages > 1 ? `
      <button class="btn btn-ghost btn-sm" data-board-page="${state.boardPage - 1}" ${state.boardPage <= 1 ? 'disabled' : ''}>上一页</button>
      <span class="message-board-page-info">第 ${state.boardPage} / ${totalPages} 页</span>
      <button class="btn btn-ghost btn-sm" data-board-page="${state.boardPage + 1}" ${state.boardPage >= totalPages ? 'disabled' : ''}>下一页</button>
    ` : '';
  }
}

let mentionTarget = null;
let mentionMatches = [];
let mentionActiveIndex = 0;
function closeMentionSuggestions() {
  const box = $('messageMentionSuggestions');
  if (box) { box.hidden = true; box.innerHTML = ''; }
  mentionTarget = null; mentionMatches = []; mentionActiveIndex = 0;
}
function updateMentionSuggestions(input) {
  if (!input || !(input.id === 'messageBoardContent' || !!input.closest('[data-comment-form]'))) return closeMentionSuggestions();
  const caret = input.selectionStart ?? input.value.length;
  const before = input.value.slice(0, caret);
  const match = before.match(/(?:^|\s)@([a-zA-Z0-9_.-]*)$/);
  if (!match) return closeMentionSuggestions();
  const query = match[1].toLowerCase();
  mentionMatches = state.profiles.filter(p => !p.is_banned && p.id !== currentUser?.id && (!query || p.username.toLowerCase().includes(query) || p.real_name.toLowerCase().includes(query))).sort((a,b)=>a.real_name.localeCompare(b.real_name,'zh-CN')).slice(0,80);
  if (!mentionMatches.length) return closeMentionSuggestions();
  mentionTarget = input; mentionActiveIndex = 0;
  let box = input.parentElement.querySelector('.mention-suggestions');
  if (!box) {
    box = document.createElement('div'); box.className = 'mention-suggestions'; input.parentElement.appendChild(box);
  }
  box.innerHTML = mentionMatches.map((p,i)=>`<button type="button" class="mention-option ${i===0?'active':''}" data-mention-index="${i}"><strong>${esc(p.real_name)}</strong><span>@${esc(p.username)}</span></button>`).join('');
  box.hidden = false;
}
function chooseMention(index) {
  if (!mentionTarget || !mentionMatches[index]) return;
  const input = mentionTarget, p = mentionMatches[index], caret = input.selectionStart ?? input.value.length;
  const before = input.value.slice(0, caret), after = input.value.slice(input.selectionEnd ?? caret);
  const match = before.match(/(?:^|\s)@([a-zA-Z0-9_.-]*)$/);
  if (!match) return closeMentionSuggestions();
  const tokenStart = before.length - match[1].length - 1;
  const insert = `@${p.username} `;
  input.value = before.slice(0, tokenStart) + insert + after;
  const next = tokenStart + insert.length; input.focus(); input.setSelectionRange(next, next);
  closeMentionSuggestions();
}
function setupMentionAutocomplete() {
  document.addEventListener('input', e => { if (e.target.id === 'messageBoardContent' || !!e.target.closest('[data-comment-form]')) updateMentionSuggestions(e.target); });
  document.addEventListener('keydown', e => {
    if (!mentionTarget || !mentionMatches.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault(); mentionActiveIndex = (mentionActiveIndex + (e.key === 'ArrowDown' ? 1 : -1) + mentionMatches.length) % mentionMatches.length;
      const box = mentionTarget.parentElement.querySelector('.mention-suggestions');
      box?.querySelectorAll('.mention-option').forEach((el,i)=>{el.classList.toggle('active',i===mentionActiveIndex); if(i===mentionActiveIndex)el.scrollIntoView({block:'nearest'});});
    } else if (e.key === 'Enter' && !e.shiftKey) {
      const box = mentionTarget.parentElement.querySelector('.mention-suggestions');
      if (box && !box.hidden) { e.preventDefault(); chooseMention(mentionActiveIndex); }
    } else if (e.key === 'Escape') closeMentionSuggestions();
  });
  document.addEventListener('pointerdown', e => {
    const option = e.target.closest('[data-mention-index]');
    if (option) { e.preventDefault(); chooseMention(Number(option.dataset.mentionIndex)); return; }
    if (!e.target.closest('.mention-input-wrap, .message-comment-form')) closeMentionSuggestions();
  });
}

async function submitMessageBoard(e) {
  e.preventDefault();
  try {
    if (!currentUser || !currentProfile || currentProfile.is_banned) throw new Error('请先登录后再留言。');
    const content=els.messageBoardContent.value.trim();
    if (!content) throw new Error('留言不能为空。');
    const anonymous=!!els.messageBoardAnonymous?.checked;
    const {error}=await supabaseClient.rpc('message_board_create',{p_content:content,p_anonymous:anonymous});
    if(error) throw error;
    els.messageBoardForm.reset(); state.boardPage=1; await loadMessageBoard(); showToast('留言发布成功。');
  } catch(e) { showToast(e.message||'留言发布失败。','error'); }
}
async function deleteMessageBoardPost(id) {
  if(!confirm('确定删除这条留言吗？删除后不会恢复。')) return;
  try { const {error}=await supabaseClient.rpc('message_board_delete',{p_post_id:id}); if(error)throw error; await loadMessageBoard(); showToast('留言已删除。'); }
  catch(e){showToast(e.message||'删除留言失败。','error');}
}
async function pinMessageBoardPost(id,pin) {
  try { const {error}=await supabaseClient.rpc('message_board_pin',{p_post_id:id,p_pin:pin}); if(error)throw error; await loadMessageBoard(); showToast(pin?'留言已置顶。':'已取消置顶。'); }
  catch(e){showToast(e.message||'操作失败。','error');}
}
async function submitMessageBoardComment(form) {
  const postId=form.dataset.commentForm; const input=form.querySelector('input'); const content=input.value.trim();
  if(!content)return;
  try { const {error}=await supabaseClient.rpc('message_board_comment',{p_post_id:postId,p_content:content}); if(error)throw error; form.reset(); await loadMessageBoard(); showToast('评论已发布。'); }
  catch(e){showToast(e.message||'评论失败。','error');}
}
async function deleteMessageBoardComment(id) {
  if(!confirm('确定删除这条评论吗？')) return;
  try { const {error}=await supabaseClient.rpc('message_board_delete_comment',{p_comment_id:id}); if(error)throw error; await loadMessageBoard(); showToast('评论已删除。'); }
  catch(e){showToast(e.message||'删除评论失败。','error');}
}

function renderDashboard() {
  const rows = rankingRows();
  const activeCount = state.profiles.filter(p => !p.is_banned).length;
  const approvedCount = state.matches.filter(m => m.status === 'approved').length;
  const pendingCount = state.matches.filter(m => m.status === 'pending_opponent' && currentUser && (m.submitted_by === currentUser.id || m.player_a_id === currentUser.id || m.player_b_id === currentUser.id)).length;
  els.dashboardStats.innerHTML = `
    <div class="stat-card"><div class="stat-label">在册选手</div><div class="stat-value">${activeCount}</div><div class="stat-note">封禁账号：${state.profiles.filter(p=>p.is_banned).length}</div></div>
    <div class="stat-card"><div class="stat-label">已生效比赛</div><div class="stat-value">${approvedCount}</div><div class="stat-note">所有生效比赛实时同步</div></div>
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
  els.rankingBody.innerHTML = rows.map((r,i)=>`<tr><td><span class="rank-chip">${i+1}</span></td><td class="name-cell">${esc(r.real_name)} <span class="muted">@${esc(r.username)}</span></td><td class="rating-number">${formatRating(r.rating)}</td><td>${r.games}</td><td>${r.wins}-${r.losses}</td><td>${formatPct(r.winRate)}</td><td><span class="pill ${r.active?'active':'off'}">${r.active?'正常':'封禁'}</span></td><td><button class="text-btn" data-player-tournaments="${r.id}">查看赛事</button></td></tr>`).join('') || '<tr><td colspan="8"><div class="empty">没有匹配的选手。</div></td></tr>';
}

function canSeeMatch(m) {
  if (m.status === 'approved') return true;
  return !!currentUser && (m.submitted_by === currentUser.id || m.player_a_id === currentUser.id || m.player_b_id === currentUser.id || isStaff());
}
function matchActionHtml(m) {
  if (!currentUser) return '';
  const mySide = m.player_a_id === currentUser.id || m.player_b_id === currentUser.id;
  const isOpponent = m.status==='pending_opponent' && mySide && m.submitted_by !== currentUser.id;
  // 管理员/副管理员可以直接确认，无需等待对手上线。
  if (isStaff() && m.status==='pending_opponent') return `<button class="text-btn" data-approve-match="${m.id}">直接同意</button> <button class="text-btn danger-text" data-reject-match="${m.id}">拒绝</button>`;
  if (isOpponent && !currentProfile?.is_banned) return `<button class="text-btn" data-confirm-match="${m.id}">确认</button> <button class="text-btn danger-text" data-reject-match="${m.id}">拒绝</button>`;
  if (isStaff() && m.status==='approved') return `<button class="text-btn danger-text" data-cancel-match="${m.id}">撤销</button>`;
  if (isStaff() && (m.status==='rejected' || m.status==='cancelled')) return `<button class="text-btn danger-text" data-delete-match="${m.id}">彻底删除</button>`;
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

async function saveInitialRating(userId) {
  if (!isAdmin()) return;
  const p=profile(userId);
  const input=document.querySelector(`[data-initial-rating=\"${userId}\"]`);
  const rating=Number(input?.value);
  if (!p || !Number.isFinite(rating)) { showToast('请输入有效的初始积分。','error'); return; }
  if (rating < 500 || rating > 2500) { showToast('初始积分建议在 500–2500 之间。','error'); return; }
  const games=state.approvedMatches.filter(m=>m.player_a_id===userId||m.player_b_id===userId).length;
  if (games>0) { showToast('该选手已有生效比赛，初始积分已经锁定，不能再修改。','error'); return; }
  try {
    const {error}=await supabaseClient.rpc('admin_set_initial_rating',{p_user_id:userId,p_initial_rating:rating});
    if(error)throw error;
    await refreshData();
    showToast(`已将 ${p.real_name} 的初始积分设为 ${rating.toFixed(1)}。`);
  } catch(e){showToast(e.message||'初始积分修改失败。','error');}
}

function exportRanking() {
  try {
    const rows = rankingRows();
    const quote = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const lines = [
      ['排名', '真实姓名', '积分', '总胜负数'].map(quote).join(','),
      ...rows.map((r, i) => [i + 1, r.real_name, Number(Number(r.rating).toFixed(1)), `${r.wins}-${r.losses}`].map(quote).join(','))
    ];
    const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const d = new Date();
    const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
    a.href = url; a.download = `CYEZ乒乓球排行榜-${y}${m}${day}.csv`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  } catch (e) {
    showToast(e.message || 'CSV 排名导出失败，请稍后重试。', 'error');
  }
}

async function ensureXlsxLoaded() {
  if (window.XLSX) return;
  await new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-cyez-xlsx]');
    if (existing) { existing.addEventListener('load', resolve, {once:true}); existing.addEventListener('error', reject, {once:true}); return; }
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
    script.async = true;
    script.dataset.cyezXlsx = '1';
    script.onload = resolve;
    script.onerror = () => reject(new Error('Excel组件加载失败，请检查网络后重试。'));
    document.head.appendChild(script);
  });
}

async function importStudentRoster(file) {
  if (!isAdmin()) return;
  if (!file) return;
  try {
    await ensureXlsxLoaded();
    if (!/\.xlsx$/i.test(file.name)) throw new Error('请上传名为 student_info.xlsx 的 Excel 文件。');
    if (file.name !== 'student_info.xlsx') throw new Error('请上传文件名为 student_info.xlsx 的大名单。');
    els.rosterImportStatus.textContent='正在读取 student_info.xlsx…';
    const buf=await file.arrayBuffer();
    const wb=window.XLSX.read(buf,{type:'array'});
    const sheet=wb.Sheets[wb.SheetNames[0]];
    const rows=window.XLSX.utils.sheet_to_json(sheet,{header:1,defval:''});
    const headerIndex=rows.findIndex(r=>r.some(cell=>String(cell).trim()==='学生姓名'));
    if(headerIndex<0) throw new Error('没有找到“学生姓名”表头，请检查文件。');
    const colIndex=rows[headerIndex].findIndex(cell=>String(cell).trim()==='学生姓名');
    const names=[];
    for(let i=headerIndex+1;i<rows.length;i++){
      const name=String(rows[i]?.[colIndex]??'').trim().replace(/\s+/g,' ');
      if(name) names.push(name);
    }
    if(!names.length) throw new Error('“学生姓名”列没有可用数据。');
    const {data,error}=await supabaseClient.rpc('admin_import_school_roster',{p_names:names});
    if(error) throw error;
    if(data?.error) throw new Error(data.error);
    els.rosterImportStatus.textContent=`已导入 ${data?.inserted ?? names.length} 条学生姓名记录。`;
    showToast(`学校大名单导入成功，共 ${data?.inserted ?? names.length} 条。`);
  } catch(e){
    els.rosterImportStatus.textContent='导入失败。';
    showToast(e.message||'学生大名单导入失败。','error');
  } finally { if(els.rosterFile)els.rosterFile.value=''; }
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
    <div class="card"><div class="card-head"><div><h2>账号管理</h2><span class="muted">管理员可以直接创建账号、封禁账号、设置初始积分、添加/取消副管理员、为用户重置密码。初始积分只建议在选手开始比赛前设置。</span></div><div><button class="btn btn-primary" data-admin-create-user>＋ 直接创建账号</button></div></div><div class="table-wrap"><table class="data-table"><thead><tr><th>真实姓名</th><th>用户名</th><th>角色</th><th>当前积分</th><th>初始积分</th><th>状态</th><th>注册时间</th><th>操作</th></tr></thead><tbody>${rows.map(p=>{const r=rankingRows().find(x=>x.id===p.id);const self=currentUser?.id===p.id;const games=state.games.get(p.id)||0;const canSet=isAdmin()&&games===0&&!p.is_banned;return `<tr><td class="name-cell">${esc(p.real_name)}</td><td>@${esc(p.username)}</td><td><span class="pill">${p.role==='admin'?'管理员':p.role==='moderator'?'副管理员':'选手'}</span></td><td>${formatRating(r?.rating??INITIAL_RATING)}</td><td>${isAdmin()?`<div class="inline-edit"><input class="initial-rating-input" data-initial-rating="${p.id}" type="number" min="500" max="2500" step="0.1" value="${Number(p.initial_rating??INITIAL_RATING).toFixed(1)}" ${canSet?'':'disabled'}><button class="text-btn" data-save-initial-rating="${p.id}" ${canSet?'':'disabled'}>保存</button></div>${games>0?'<div class="muted">已有生效比赛，已锁定</div>':''}`:formatRating(p.initial_rating??INITIAL_RATING)}</td><td><span class="pill ${p.is_banned?'off':'active'}">${p.is_banned?'封禁':'正常'}</span></td><td>${formatDateLong(p.created_at)}</td><td>${isAdmin()&&!self?`<select class="admin-role-select" data-role-user="${p.id}"><option value="player" ${p.role==='player'?'selected':''}>选手</option><option value="moderator" ${p.role==='moderator'?'selected':''}>副管理员</option></select> <button class="text-btn ${p.is_banned?'':'danger-text'}" data-ban-user="${p.id}">${p.is_banned?'解封':'封禁'}</button> <button class="text-btn" data-reset-password="${p.id}">重置密码</button> <button class="text-btn danger-text" data-delete-user="${p.id}">永久删除</button>`:'—'}</td></tr>`;}).join('')||'<tr><td colspan="8"><div class="empty">没有账号。</div></td></tr>'}</tbody></table></div></div>
    ${isAdmin()?`<div class="card"><div class="card-head"><div><h2>学校学生大名单</h2><span class="muted">上传 student_info.xlsx，仅管理员可导入；名单不会展示给普通用户。注册时由服务器核对“学生姓名”。</span></div></div><div class="roster-import"><input id="rosterFile" type="file" accept=".xlsx" /><div id="rosterImportStatus" class="muted">请选择 student_info.xlsx。</div></div></div>`:''}
    ${isAdmin()?`<div class="card"><div class="card-head"><div><h2>操作日志</h2><span class="muted">账号权限变更和比赛审核/撤销会记录。</span></div><button class="btn btn-ghost" id="refreshAuditBtn">刷新日志</button></div><div id="auditContent"><div class="empty">正在加载…</div></div></div>`:''}
  `;
  if (isAdmin()) {
    els.rosterFile = $('rosterFile');
    els.rosterImportStatus = $('rosterImportStatus');
    loadAuditLogs();
  }
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
    els.loginBtn.innerHTML = `${esc(currentProfile.real_name)} · 我的账号${unreadNotificationCount() ? '<span class=\"account-red-dot\"></span>' : ''}`;
    els.signupBtn.hidden = false;
    els.signupBtn.textContent = '退出登录';
    els.signupBtn.className = 'btn btn-danger';
    els.signupBtn.onclick = signOut;
  }
  renderNotificationBadge();
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
  if (view==='notifications') renderNotifications();
  if (view==='messageboard') { renderMessageBoard(); if (supabaseClient) loadMessageBoard().catch(e=>showToast(e.message||'留言板加载失败。','error')); }
  window.scrollTo({top:0,behavior:'smooth'});
}

function showToast(message, type='success') {
  const t=document.createElement('div'); t.className=`toast ${type}`; t.setAttribute('role','status'); t.textContent=message; els.toastRegion.appendChild(t); setTimeout(()=>t.remove(),3200);
}

function openAuth(mode='login') { els.authBackdrop.hidden=false; switchAuthTab(mode); setTimeout(()=> (authMode==='login'?els.loginUsername:els.signupRealName).focus(),30); }
function closeAuth() { els.authBackdrop.hidden=true; }
function switchAuthTab(mode) {
  authMode=mode;
  document.querySelectorAll('.auth-tab').forEach(b=>b.classList.toggle('active',b.dataset.authTab===mode));
  els.loginForm.hidden=mode!=='login'; els.signupForm.hidden=mode!=='signup';
}
function openProfile(options={}) {
  if (!currentProfile) return openAuth('login');
  const required = !!options.required || passwordChangeRequired;
  passwordChangeRequired = required;
  els.profileSummary.innerHTML = required
    ? `<div><span>账号状态</span><strong>请先完成密码修改</strong></div><div><span>提示</span><strong>当前密码由管理员或系统安全地提供</strong></div>`
    : `<div><span>角色</span><strong>${currentProfile.role==='admin'?'管理员':currentProfile.role==='moderator'?'副管理员':'选手'}</strong></div><div><span>状态</span><strong>${currentProfile.is_banned?'封禁':'正常'}</strong></div>`;
  els.profileRealName.value=currentProfile.real_name;
  els.profileRealName.readOnly = !isAdmin();
  els.profileRealName.classList.toggle('readonly-field', !isAdmin());
  const realNameHint = document.getElementById('profileRealNameHint');
  if (realNameHint) realNameHint.textContent = isAdmin() ? '管理员可以在必要时修正选手真实姓名；普通选手不能自行修改。' : '真实姓名由学校信息确定，选手不能自行修改。';
  els.profileUsername.value=currentProfile.username;
  els.profileClose.hidden=required;
  els.profileForm.hidden=required;
  els.passwordForm.hidden=false;
  els.logoutBtn.hidden=false;
  els.passwordForm.classList.toggle('required-password-form', required);
  els.passwordForm.querySelector('.password-hint').textContent = required
    ? '请使用当前临时密码设置一个新的个人密码。完成后才能继续使用系统。'
    : '为了保护账号，请先输入当前密码，再设置新的密码。密码至少 8 位。';
  if (required && !els.profileCurrentPassword.value) els.profileCurrentPassword.value='';
  els.profileBackdrop.hidden=false;
  setTimeout(()=>els.profileCurrentPassword.focus(),30);
}
function closeProfile(force=false) {
  if (passwordChangeRequired && !force) { showToast('请先完成首次密码修改。','error'); return; }
  els.profileBackdrop.hidden=true;
  els.profileClose.hidden=false;
  els.profileForm.hidden=false;
  els.passwordForm.classList.remove('required-password-form');
  if (!passwordChangeRequired) els.passwordForm.querySelector('.password-hint').textContent='为了保护账号，请先输入当前密码，再设置新的密码。密码至少 8 位。';
}

async function signUp() {
  if (!supabaseClient) throw new Error('尚未配置 Supabase，请先填写 supabase-config.js。');
  const realName=els.signupRealName.value.trim();
  const username=els.signupUsername.value.trim().toLowerCase();
  const password=els.signupPassword.value;
  if (!realName) throw new Error('请输入真实姓名。');
  if (!/^[a-z0-9_.-]{3,24}$/.test(username)) throw new Error('用户名需为 3-24 位小写字母、数字、下划线、点或短横线。');
  if (password.length<8) throw new Error('密码至少 8 位。');
  const { data, error } = await supabaseClient.functions.invoke('register-student', { body: { real_name: realName, username, password } });
  if (error) {
    let msg=error.message||'注册失败。';
    try { if(error.context && typeof error.context.json==='function'){const payload=await error.context.json(); if(payload?.error)msg=payload.error;} } catch(_){}
    throw new Error(msg);
  }
  if (!data?.success) throw new Error(data?.error||'注册失败。');
  const email=`${username}@login.cyez.local`;
  const {error:loginError}=await supabaseClient.auth.signInWithPassword({email,password});
  if(loginError) throw new Error('注册成功，但自动登录失败，请使用新用户名和密码登录。');
  closeAuth();
  els.signupForm.reset();
  await loadSession();
  await refreshData();
  showToast('感谢注册CYEZ乒乓社积分系统');
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
  closeAuth();
  els.loginForm.reset();
  await loadSession();
  showToast('登录成功。');
}

async function signOut() {
  try {
    if (supabaseClient) { const {error}=await supabaseClient.auth.signOut(); if(error) throw error; }
    closeProfile(true);
    currentUser=null; currentProfile=null; passwordChangeRequired=false;
    updateAuthUi(); refreshSelects(); renderDashboard(); renderHistory(); renderAdmin(); renderMessageBoard();
    showToast('已退出登录。');
  } catch(e) {
    showToast(e.message || '退出登录失败。','error');
  }
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
  passwordChangeRequired = !!currentProfile?.password_change_required;
  if (currentProfile?.is_banned) {
    showToast('你的账号已被管理员封禁。','error');
  }
  if (passwordChangeRequired && !currentProfile?.is_banned) {
    setTimeout(() => openProfile({required:true}), 80);
  }
}

async function refreshData() {
  if (!supabaseClient) {
    renderUnconfigured();
    return;
  }
  const [{data:profiles,error:pErr},{data:matches,error:mErr}] = await Promise.all([
    supabaseClient.from('profiles').select('id,real_name,username,role,is_banned,created_at,initial_rating,school_verified').order('created_at',{ascending:true}),
    supabaseClient.from('matches').select('*').order('played_at',{ascending:true})
  ]);
  if (pErr) throw pErr; if (mErr) throw mErr;
  state.profiles=profiles||[]; state.matches=matches||[];
  rebuildRatings(); refreshSelects(); renderDashboard(); renderRanking(); renderHistory(); renderAdmin(); updateAuthUi(); await loadNotifications(); await loadMessageBoard();
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
async function staffApproveMatch(id) {
  const m=state.matches.find(x=>x.id===id);
  if (!m || m.status!=='pending_opponent') return;
  if (!confirm(`确定由管理员直接同意这场比赛吗？\n\n${playerLabel(m.player_a_id)} ${m.score_a}:${m.score_b} ${playerLabel(m.player_b_id)}\n\n同意后会立即计入排行榜。`)) return;
  try {
    const {error}=await supabaseClient.rpc('staff_approve_match',{target_match_id:id});
    if(error) throw error;
    await refreshData();
    showToast('管理员已直接同意比赛并计入排行榜。');
  } catch(e) { showToast(e.message || '直接同意失败，请检查 Supabase 是否部署了相关函数。','error'); }
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

function openAdminCreateUser() {
  if (!isAdmin()) { showToast('只有 admin 可以直接创建账号。','error'); return; }
  els.adminCreateUserForm.reset();
  if (els.adminCreateResult) els.adminCreateResult.hidden=true;
  els.adminCreateUserForm.hidden=false;
  els.adminCreateUserBackdrop.hidden=false;
  setTimeout(()=>els.adminCreateRealName.focus(),30);
}

function closeAdminCreateUser() {
  els.adminCreateUserBackdrop.hidden=true;
  els.adminCreateUserForm.reset();
  els.adminCreateUserForm.hidden=false;
  if (els.adminCreateResult) els.adminCreateResult.hidden=true;
  if (els.adminCreateResultUsername) els.adminCreateResultUsername.textContent='';
  if (els.adminCreateResultPassword) els.adminCreateResultPassword.value='';
}

async function adminCreateUser(e) {
  e.preventDefault();
  if (!isAdmin()) return;
  const realName=els.adminCreateRealName.value.trim();
  const username=els.adminCreateUsername.value.trim().toLowerCase();
  if (!realName) { showToast('请输入真实姓名。','error'); return; }
  if (!/^[a-z0-9_.-]{3,24}$/.test(username)) { showToast('用户名需为 3-24 位小写字母、数字、下划线、点或短横线。','error'); return; }
  try {
    const { data, error } = await supabaseClient.functions.invoke('admin-create-user', {
      body: { real_name: realName, username }
    });
    if (error) throw error;
    if (!data?.success) throw new Error(data?.error || '账号创建失败。');
    if (!data?.temp_password) throw new Error('账号已创建，但服务器没有返回临时密码。请不要关闭窗口，并联系管理员检查 Edge Function。');
    els.adminCreateUserForm.hidden=true;
    els.adminCreateResultUsername.textContent=username;
    els.adminCreateResultPassword.value=data.temp_password;
    els.adminCreateResult.hidden=false;
    els.adminCreateResultPassword.select();
    showToast(`账号 ${username} 创建成功。`);
    try { await refreshData(); } catch (refreshError) { console.error(refreshError); showToast('账号已经创建成功，但页面数据刷新失败，请稍后手动刷新。','error'); }
  } catch(err) {
    showToast(err.message || '账号创建失败。请确认 admin-create-user Edge Function 已部署。','error');
  }
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
  els.adminResetPassword.value='';
  els.adminResetPassword.readOnly=true;
  els.adminResetBackdrop.hidden=false;
}

function closeAdminResetPassword() {
  els.adminResetBackdrop.hidden=true;
  els.adminResetForm.reset();
  els.adminResetPassword.readOnly=true;
}

async function adminResetPassword(e) {
  e.preventDefault();
  if (!isAdmin()) return;
  const targetUserId = els.adminResetForm.dataset.targetUserId;
  if (!targetUserId) {
    showToast('没有选择需要重置密码的用户。','error');
    return;
  }
  try {
    const { data: sessionData, error: sessionError } = await supabaseClient.auth.getSession();
    if (sessionError) throw sessionError;
    const token = sessionData.session?.access_token;
    if (!token) throw new Error('登录状态已失效，请重新登录。');
    const { data, error } = await supabaseClient.functions.invoke('admin-reset-password', {
      body: { target_user_id: targetUserId }
    });
    if (error) throw error;
    if (!data?.success) throw new Error(data?.error || '密码重置失败。');
    if (!data?.temp_password) throw new Error('密码已处理，但服务器没有返回临时密码。请不要关闭窗口，并检查 Edge Function。');
    els.adminResetPassword.readOnly = true;
    els.adminResetPassword.value = data.temp_password;
    els.adminResetPassword.select();
    showToast(`已为 ${playerLabel(targetUserId)} 生成新的临时密码。请先复制并安全地交给用户。`);
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
    if (currentPassword.length < 8) throw new Error('当前密码无效。');
    if (newPassword.length < 8) throw new Error('新密码至少 8 位。');
    if (newPassword !== confirmPassword) throw new Error('两次输入的新密码不一致。');
    if (newPassword === currentPassword) throw new Error('新密码不能与当前密码相同。');

    const { data, error } = await supabaseClient.functions.invoke('change-own-password', {
      body: { current_password: currentPassword, new_password: newPassword }
    });
    if (error) {
      let msg=error.message||'密码修改失败。';
      try { if(error.context && typeof error.context.json==='function'){const payload=await error.context.json(); if(payload?.error)msg=payload.error;} } catch(_){}
      throw new Error(msg);
    }
    if (!data?.success) throw new Error(data?.error || '密码修改失败。');

    const email=`${currentProfile.username}@login.cyez.local`;
    const { error:loginError } = await supabaseClient.auth.signInWithPassword({ email, password:newPassword });
    if (loginError) throw new Error('密码已经修改成功，但自动重新登录失败，请重新登录。');

    await loadSession();
    await fetchCurrentProfile();
    passwordChangeRequired = !!currentProfile?.password_change_required;
    els.passwordForm.reset();
    closeProfile(true);
    showToast('密码修改成功。现在可以正常使用系统了。');
  } catch(e) {
    showToast(e.message || '密码修改失败。','error');
  }
}

async function saveProfile(e) {
  e.preventDefault();
  try {
    if (!currentUser || !currentProfile) throw new Error('请先登录。');
    if (currentProfile.is_banned) throw new Error('封禁账号不能修改账号资料。');

    const name = isAdmin() ? els.profileRealName.value.trim() : currentProfile.real_name;
    const username = els.profileUsername.value.trim().toLowerCase();
    if (!name) throw new Error('姓名不能为空。');
    if (!/^[a-z0-9_.-]{3,24}$/.test(username)) {
      throw new Error('用户名需为 3-24 位小写字母、数字、下划线、点或短横线。');
    }

    const { data, error } = await supabaseClient.functions.invoke('change-own-username', {
      body: { real_name: name, username }
    });
    if (error) {
      let detail = error.message || '资料保存失败。';
      try {
        if (error.context && typeof error.context.json === 'function') {
          const payload = await error.context.json();
          if (payload?.error) detail = payload.error;
        }
      } catch (_) {}
      throw new Error(detail);
    }
    if (data?.error) throw new Error(data.error);

    await fetchCurrentProfile();
    closeProfile();
    await refreshData();
    updateAuthUi();
    showToast(data?.message || '账号资料已保存。');
  } catch(e) {
    showToast(e.message || '保存失败。','error');
  }
}

function setupRealtime() {
  if (!supabaseClient) return;
  if (realtimeChannel) supabaseClient.removeChannel(realtimeChannel);
  realtimeChannel=supabaseClient.channel('cyez-live')
    .on('postgres_changes',{event:'*',schema:'public',table:'profiles'},async()=>{try{await refreshData();}catch(e){console.error(e);}})
    .on('postgres_changes',{event:'*',schema:'public',table:'matches'},async()=>{try{await refreshData();}catch(e){console.error(e);}})
    .on('postgres_changes',{event:'*',schema:'public',table:'notifications'},async()=>{try{if(currentUser) await loadNotifications();}catch(e){console.error(e);}})
    .on('postgres_changes',{event:'*',schema:'public',table:'message_board_comments'},async()=>{try{await loadMessageBoard();}catch(e){console.error(e);}})
    .subscribe((status)=>{
      els.liveStatus.innerHTML = status==='SUBSCRIBED' ? '<i></i> 实时同步中' : '<i class="off-dot"></i> 正在连接…';
    });
}

async function init() {
  populateCompetition(); setDefaultDate();
  initTheme();
  bindEvents();
  const ok = await bootWithTimeout();
  if (!ok) return;
  setupRealtime();
  supabaseClient.auth.onAuthStateChange(async (_event, session)=>{
    currentUser=session?.user || null;
    if (!currentUser) state.boardTodayCount = 0;
    try {
      await fetchCurrentProfile();
      updateAuthUi();
      await refreshData();
      await loadNotifications();
    } catch(e) { console.error(e); showToast(e.message || '账号状态更新失败。','error'); }
  });
  updateAuthUi();
}

function installBackdropClose(backdrop, closeFn) {
  if (!backdrop) return;
  let downOnBackdrop = false;
  backdrop.addEventListener('pointerdown', e => { downOnBackdrop = e.target === backdrop; });
  backdrop.addEventListener('pointerup', e => {
    const shouldClose = downOnBackdrop && e.target === backdrop;
    downOnBackdrop = false;
    if (shouldClose) closeFn();
  });
  backdrop.addEventListener('pointercancel', () => { downOnBackdrop = false; });
}

function setupDraggableModals() {
  document.querySelectorAll('.modal-backdrop > .modal').forEach(modal => {
    if (modal.dataset.draggableReady) return;
    modal.dataset.draggableReady='1';
    let dragging=false, startX=0, startY=0, baseX=0, baseY=0;
    const reset=()=>{modal.style.transform=''; modal.dataset.dragX='0'; modal.dataset.dragY='0';};
    modal.addEventListener('pointerdown', e => {
      if (e.button!==0 || e.target.closest('input,textarea,select,button,a,label')) return;
      const rect=modal.getBoundingClientRect();
      startX=e.clientX; startY=e.clientY;
      baseX=parseFloat(modal.dataset.dragX||'0'); baseY=parseFloat(modal.dataset.dragY||'0');
      dragging=true; modal.setPointerCapture?.(e.pointerId); modal.classList.add('dragging');
      e.preventDefault();
    });
    modal.addEventListener('pointermove', e => {
      if(!dragging)return;
      const x=baseX+e.clientX-startX, y=baseY+e.clientY-startY;
      modal.dataset.dragX=String(x); modal.dataset.dragY=String(y);
      modal.style.transform=`translate(${x}px,${y}px)`;
    });
    const end=e=>{if(!dragging)return;dragging=false;modal.classList.remove('dragging');modal.releasePointerCapture?.(e.pointerId);};
    modal.addEventListener('pointerup',end); modal.addEventListener('pointercancel',end);
    modal.addEventListener('dblclick', reset);
  });
}

function bindEvents() {
  document.addEventListener('click', async e=>{
    const tab=e.target.closest('[data-view]'); if(tab){navigate(tab.dataset.view);return;}
    const go=e.target.closest('[data-go-view]'); if(go){navigate(go.dataset.goView);return;}
    const score=e.target.closest('[data-score]'); if(score){const [a,b]=score.dataset.score.split(':');els.scoreA.value=a;els.scoreB.value=b;updatePreview();return;}
    if(e.target.id==='bannerLoginBtn'){openAuth('login');return;}
    if(e.target.id==='bannerSignupBtn'){openAuth('signup');return;}
    if(e.target.id==='bannerProfileBtn'){openProfile();return;}
    const approveBtn=e.target.closest('[data-approve-match]'); if(approveBtn){await staffApproveMatch(approveBtn.dataset.approveMatch);return;}
    const confirmBtn=e.target.closest('[data-confirm-match]'); if(confirmBtn){await confirmMatch(confirmBtn.dataset.confirmMatch);return;}
    const rejectBtn=e.target.closest('[data-reject-match]'); if(rejectBtn){await rejectMatch(rejectBtn.dataset.rejectMatch);return;}
    const cancelBtn=e.target.closest('[data-cancel-match]'); if(cancelBtn){await cancelMatch(cancelBtn.dataset.cancelMatch);return;}
    const deleteMatchBtn=e.target.closest('[data-delete-match]'); if(deleteMatchBtn){await deleteMatch(deleteMatchBtn.dataset.deleteMatch);return;}
    const banBtn=e.target.closest('[data-ban-user]'); if(banBtn){await toggleBan(banBtn.dataset.banUser);return;}
    const deleteBtn=e.target.closest('[data-delete-user]'); if(deleteBtn){await deleteUser(deleteBtn.dataset.deleteUser);return;}
    const resetPwdBtn=e.target.closest('[data-reset-password]'); if(resetPwdBtn){openAdminResetPassword(resetPwdBtn.dataset.resetPassword);return;}
    const createUserBtn=e.target.closest('[data-admin-create-user]'); if(createUserBtn){openAdminCreateUser();return;}
    if(e.target.id==='refreshAuditBtn'){loadAuditLogs();return;}
    const saveInitial=e.target.closest('[data-save-initial-rating]'); if(saveInitial){await saveInitialRating(saveInitial.dataset.saveInitialRating);return;}
    const notifRead=e.target.closest('[data-notification-read]'); if(notifRead){await markNotificationRead(notifRead.dataset.notificationRead);return;}
    const notifMatch=e.target.closest('[data-notification-match]'); if(notifMatch){await markNotificationRead((state.notifications.find(n=>n.match_id===notifMatch.dataset.notificationMatch)||{}).id); navigate('history'); return;}
    const notifMessage=e.target.closest('[data-notification-message]'); if(notifMessage){await markNotificationRead((state.notifications.find(n=>n.message_post_id===notifMessage.dataset.notificationMessage)||{}).id); navigate('messageboard'); return;}
    if(e.target.id==='markAllNotificationsBtn'){await markAllNotificationsRead();return;}
    const boardPageBtn=e.target.closest('[data-board-page]'); if(boardPageBtn && !boardPageBtn.disabled){state.boardPage=Number(boardPageBtn.dataset.boardPage)||1; renderMessageBoard(); return;}
    const deleteBoard=e.target.closest('[data-delete-board-post]'); if(deleteBoard){await deleteMessageBoardPost(deleteBoard.dataset.deleteBoardPost);return;}
    const pinBoard=e.target.closest('[data-pin-board-post]'); if(pinBoard){await pinMessageBoardPost(pinBoard.dataset.pinBoardPost,pinBoard.dataset.pinValue==='true');return;}
    const deleteBoardComment=e.target.closest('[data-delete-board-comment]'); if(deleteBoardComment){await deleteMessageBoardComment(deleteBoardComment.dataset.deleteBoardComment);return;}
  });
  document.querySelectorAll('[data-auth-tab]').forEach(btn=>btn.addEventListener('click',()=>switchAuthTab(btn.dataset.authTab)));
  // 登录/注册按钮通过 updateAuthUi() 设置 onclick；这里不要再绑定 openAuth，否则登录后点击“我的账号”会同时弹出认证弹窗。
  els.startupRetryBtn?.addEventListener('click',()=>bootWithTimeout());
  els.authClose.addEventListener('click',closeAuth);
  installBackdropClose(els.authBackdrop, closeAuth);
  els.loginForm.addEventListener('submit',async e=>{e.preventDefault();try{await signIn();}catch(err){showToast(err.message||'登录失败。','error');}});
  els.signupForm.addEventListener('submit',async e=>{e.preventDefault();try{await signUp();}catch(err){showToast(err.message||'注册失败。','error');}});
  els.messageBoardForm?.addEventListener('submit',submitMessageBoard);
  setupMentionAutocomplete();
  document.addEventListener('submit',e=>{const form=e.target.closest('[data-comment-form]'); if(form){e.preventDefault(); submitMessageBoardComment(form);}});
  els.profileClose.addEventListener('click',()=>closeProfile());
  installBackdropClose(els.profileBackdrop, ()=>closeProfile());
  els.adminCreateUserClose.addEventListener('click',closeAdminCreateUser);
  els.adminCreateUserCancel.addEventListener('click',closeAdminCreateUser);
  installBackdropClose(els.adminCreateUserBackdrop, closeAdminCreateUser);
  els.adminCreateUserForm.addEventListener('submit',adminCreateUser);
  els.adminCreateCopyPassword?.addEventListener('click',async ()=>{
    const value=els.adminCreateResultPassword?.value||'';
    if(!value)return;
    try{await navigator.clipboard.writeText(value);showToast('临时密码已复制。');}
    catch(_){els.adminCreateResultPassword.select();showToast('浏览器未允许自动复制，请手动复制。','error');}
  });
  els.profileForm.addEventListener('submit',saveProfile);
  els.passwordForm.addEventListener('submit',changeOwnPassword);
  els.logoutBtn.addEventListener('click',signOut);
  els.adminResetClose.addEventListener('click',closeAdminResetPassword);
  installBackdropClose(els.adminResetBackdrop, closeAdminResetPassword);
  els.adminResetForm.addEventListener('submit',adminResetPassword);
  els.matchForm.addEventListener('submit',submitMatch);
  els.matchForm.addEventListener('reset',()=>setTimeout(()=>{setDefaultDate();updateRatingsInForm();updatePreview();},0));
  [els.playerA,els.playerB,els.scoreA,els.scoreB,els.competitionType].forEach(el=>el.addEventListener('input',updatePreview));
  els.competitionType.addEventListener('change',updatePreview);
  els.playerA.addEventListener('change',()=>{updateRatingsInForm();updatePreview();});
  els.playerB.addEventListener('change',()=>{updateRatingsInForm();updatePreview();});
  els.rankingSearch.addEventListener('input',renderRanking);
  els.exportRankingBtn?.addEventListener('click', exportRanking);
  els.historyFilter.addEventListener('change',renderHistory);
  els.h2hA.addEventListener('change',renderH2H); els.h2hB.addEventListener('change',renderH2H);
  document.addEventListener('change',e=>{const role=e.target.closest('[data-role-user]');if(role)updateRole(role.dataset.roleUser,role.value); const rf=e.target.closest('#rosterFile'); if(rf)importStudentRoster(rf.files?.[0]);});
  setupDraggableModals();
}

init();
