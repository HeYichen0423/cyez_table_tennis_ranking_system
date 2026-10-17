'use strict';
// DOM 冒烟测试：在 jsdom 中加载真实页面脚本，验证没有加载期错误且关键渲染函数可运行。
// jsdom 是可选依赖（npm install --no-save jsdom）；缺失时本文件自动跳过。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

let JSDOM;
try { ({ JSDOM } = require('jsdom')); } catch { JSDOM = null; }

const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

// 最小 Supabase 桩：任何查询都返回空数据，避免冒烟测试访问真实后端。
function makeStubClient() {
  const result = () => Promise.resolve({ data: [], error: null });
  const query = {
    select() { return query; },
    order() { return query; },
    range() { return query; },
    eq() { return query; },
    is() { return query; },
    limit() { return query; },
    maybeSingle() { return Promise.resolve({ data: null, error: null }); },
    then(res, rej) { return result().then(res, rej); },
  };
  return {
    from() { return query; },
    rpc() { return Promise.resolve({ data: [], error: null }); },
    functions: { invoke: () => Promise.resolve({ data: {}, error: null }) },
    auth: {
      getSession: () => Promise.resolve({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: () => Promise.resolve({ error: null }),
      signInWithPassword: () => Promise.resolve({ error: null }),
    },
    channel() {
      const ch = { on() { return ch; }, subscribe(cb) { if (cb) cb('SUBSCRIBED'); return ch; } };
      return ch;
    },
    removeChannel() {},
  };
}

test('页面脚本在 jsdom 中可加载并完成初始渲染', { skip: JSDOM ? false : 'jsdom 未安装（npm install --no-save jsdom）' }, async () => {
  const dom = new JSDOM(read('index.html'), { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://cyeztt.me/' });
  const { window } = dom;
  window.supabase = { createClient: () => makeStubClient() };
  window.CYEZ_SUPABASE_CONFIG = { url: 'https://example.supabase.co', anonKey: 'sb_publishable_test' };

  const errors = [];
  window.addEventListener('error', e => errors.push(e.error || e.message));
  window.addEventListener('unhandledrejection', e => errors.push(e.reason));

  for (const file of ['rating-core.js', 'app.js', 'tournament.js']) {
    window.eval(read(file));
  }

  assert.ok(window.CYEZRatingCore, 'CYEZRatingCore 应挂载到 window');
  assert.equal(typeof window.CYEZRatingCore.replayRatings, 'function');

  // 等待 init()/refreshData() 的微任务完成。
  await new Promise(r => setTimeout(r, 60));

  const doc = window.document;
  assert.ok(doc.getElementById('dashboardStats').innerHTML.length > 0, '总览统计应已渲染');
  assert.ok(doc.getElementById('rankingBody').innerHTML.length > 0, '排行榜应已渲染');
  assert.ok(doc.getElementById('historyBody').innerHTML.length > 0, '历史记录应已渲染');

  assert.deepEqual(errors, [], '加载过程中不应有未捕获错误');
});

test('按 Esc 可关闭普通弹窗，但强制改密弹窗不可关闭', { skip: JSDOM ? false : 'jsdom 未安装' }, async () => {
  const dom = new JSDOM(read('index.html'), { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://cyeztt.me/' });
  const { window } = dom;
  window.supabase = { createClient: () => makeStubClient() };
  window.CYEZ_SUPABASE_CONFIG = { url: 'https://example.supabase.co', anonKey: 'sb_publishable_test' };
  for (const file of ['rating-core.js', 'app.js', 'tournament.js']) window.eval(read(file));
  await new Promise(r => setTimeout(r, 60));

  const doc = window.document;
  doc.getElementById('loginBtn').click();
  assert.equal(doc.getElementById('authBackdrop').hidden, false, '点击登录应打开弹窗');
  doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(doc.getElementById('authBackdrop').hidden, true, 'Esc 应关闭登录弹窗');
});

// 赛事录入：管理员可以为一方的弃权选择结果，弃权场次在界面上标记为不计入积分。
function makeTournamentStub(rpcResult) {
  const data = {
    profiles: [
      { id: 'p1', real_name: '管理员', username: 'admin', role: 'admin', is_banned: false, created_at: '2026-01-01' },
      { id: 'p2', real_name: '选手甲', username: 'jia', role: 'player', is_banned: false, created_at: '2026-01-01' },
      { id: 'p3', real_name: '选手乙', username: 'yi', role: 'player', is_banned: false, created_at: '2026-01-01' },
    ],
    matches: [],
    tournaments: [{ id: 't1', name: '测试赛事', competition_id: 'special', format: 'single_elim', status: 'in_progress', start_at: '2026-01-01', group_count: 0, advance_per_group: 1, created_by: 'p1', created_at: '2026-01-01' }],
    tournament_entries: [
      { tournament_id: 't1', player_id: 'p2', seed: 1 },
      { tournament_id: 't1', player_id: 'p3', seed: 2 },
    ],
    tournament_matches: [
      { id: 'm1', tournament_id: 't1', bracket_key: 'winners-r1-m1', stage: 'winners', round_no: 1, match_no: 1, label: '第1轮 · 1', player_a_id: 'p2', player_b_id: 'p3', score_a: null, score_b: null, status: 'scheduled', winner_id: null, forfeit: 'none', next_match_id: null, next_slot: null, next_loss_match_id: null, next_loss_slot: null },
      { id: 'm2', tournament_id: 't1', bracket_key: 'winners-r1-m2', stage: 'winners', round_no: 1, match_no: 2, label: '第1轮 · 2', player_a_id: 'p2', player_b_id: 'p3', score_a: null, score_b: null, status: 'completed', winner_id: 'p2', forfeit: 'a', next_match_id: null, next_slot: null, next_loss_match_id: null, next_loss_slot: null },
    ],
  };
  const query = rows => ({
    select() { return this; }, order() { return this; }, range() { return this; }, eq() { return this; }, is() { return this; }, limit() { return this; },
    maybeSingle() { return Promise.resolve({ data: rows[0] ?? null, error: null }); },
    then(res, rej) { return Promise.resolve({ data: rows, error: null }).then(res, rej); },
  });
  return {
    from(table) { return query(data[table] || []); },
    rpc() { return Promise.resolve(rpcResult || { data: [], error: null }); },
    functions: { invoke: () => Promise.resolve({ data: { success: true }, error: null }) },
    auth: {
      getSession: () => Promise.resolve({ data: { session: { user: { id: 'p1' } } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: () => Promise.resolve({ error: null }),
      signInWithPassword: () => Promise.resolve({ error: null }),
    },
    channel() { const ch = { on() { return ch; }, subscribe(cb) { if (cb) cb('SUBSCRIBED'); return ch; } }; return ch; },
    removeChannel() {},
  };
}

test('赛事录入支持一方/双方弃权，且弃权场次标注不计入积分', { skip: JSDOM ? false : 'jsdom 未安装' }, async () => {
  const dom = new JSDOM(read('index.html'), { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://cyeztt.me/' });
  const { window } = dom;
  window.supabase = { createClient: () => makeTournamentStub() };
  window.CYEZ_SUPABASE_CONFIG = { url: 'https://example.supabase.co', anonKey: 'sb_publishable_test' };
  for (const file of ['rating-core.js', 'app.js', 'tournament.js']) window.eval(read(file));
  await new Promise(r => setTimeout(r, 80));

  const html = window.document.getElementById('tournamentDetail').innerHTML;
  assert.ok(html.includes('data-tm-forfeit="m1"'), '未完成比赛应提供弃权选择');
  assert.ok(html.includes('无弃权') && html.includes('A 方弃权') && html.includes('B 方弃权') && html.includes('双方弃权'), '弃权选项应包含四种取值');
  assert.ok(html.includes('A 方弃权，本场不计入积分'), '弃权场次应标注不计入积分');
});

// 排行榜：用“查看过去比赛”弹窗展示该选手的对手、比分与赛前/赛后积分。
function makeRankingStub() {
  const data = {
    profiles: [
      { id: 'p1', real_name: '赵一', username: 'zhao', role: 'player', is_banned: false, created_at: '2026-01-01', initial_rating: 1500 },
      { id: 'p2', real_name: '钱二', username: 'qian', role: 'player', is_banned: false, created_at: '2026-01-01', initial_rating: 1500 },
    ],
    matches: [
      { id: 'm1', played_at: '2026-02-01T10:00:00Z', created_at: '2026-02-01T10:00:00Z', player_a_id: 'p1', player_b_id: 'p2', score_a: 4, score_b: 2, competition_id: 'special', submitted_by: 'p1', status: 'approved' },
    ],
    notifications: [],
    message_board_posts: [],
    message_board_comments: [],
  };
  const query = rows => ({
    select() { return this; }, order() { return this; }, range() { return this; }, eq() { return this; }, is() { return this; }, limit() { return this; },
    maybeSingle() { return Promise.resolve({ data: rows[0] ?? null, error: null }); },
    then(res, rej) { return Promise.resolve({ data: rows, error: null }).then(res, rej); },
  });
  return {
    from(table) { return query(data[table] || []); },
    rpc() { return Promise.resolve({ data: [], error: null }); },
    functions: { invoke: () => Promise.resolve({ data: { success: true }, error: null }) },
    auth: {
      getSession: () => Promise.resolve({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: () => Promise.resolve({ error: null }),
      signInWithPassword: () => Promise.resolve({ error: null }),
    },
    channel() { const ch = { on() { return ch; }, subscribe(cb) { if (cb) cb('SUBSCRIBED'); return ch; } }; return ch; },
    removeChannel() {},
  };
}

test('排行榜的“查看过去比赛”展示对手、比分与赛前/赛后积分', { skip: JSDOM ? false : 'jsdom 未安装' }, async () => {
  const dom = new JSDOM(read('index.html'), { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://cyeztt.me/' });
  const { window } = dom;
  window.supabase = { createClient: () => makeRankingStub() };
  window.CYEZ_SUPABASE_CONFIG = { url: 'https://example.supabase.co', anonKey: 'sb_publishable_test' };
  for (const file of ['rating-core.js', 'app.js', 'tournament.js']) window.eval(read(file));
  await new Promise(r => setTimeout(r, 80));

  const doc = window.document;
  const rankingHtml = doc.getElementById('rankingBody').innerHTML;
  assert.ok(rankingHtml.includes('查看过去比赛'), '排行榜应显示“查看过去比赛”按钮');
  assert.ok(!rankingHtml.includes('查看赛事'), '旧的“查看赛事”按钮应已移除');

  doc.querySelector('[data-player-matches="p1"]').click();
  assert.equal(doc.getElementById('playerMatchesBackdrop').hidden, false, '点击应打开过去比赛弹窗');
  const body = doc.getElementById('playerMatchesBody').innerHTML;
  assert.ok(body.includes('钱二'), '应显示对手姓名');
  assert.ok(body.includes('4:2'), '应显示比分');
  assert.ok(body.includes('1500.0'), '应显示赛前积分');
  assert.ok(body.includes('1517.9'), '应显示赛后积分');
});

test('选择选手的下拉按姓名顺序排列', { skip: JSDOM ? false : 'jsdom 未安装' }, async () => {
  const dom = new JSDOM(read('index.html'), { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://cyeztt.me/' });
  const { window } = dom;
  window.supabase = { createClient: () => makeRankingStub() };
  window.CYEZ_SUPABASE_CONFIG = { url: 'https://example.supabase.co', anonKey: 'sb_publishable_test' };
  for (const file of ['rating-core.js', 'app.js', 'tournament.js']) window.eval(read(file));
  await new Promise(r => setTimeout(r, 80));

  const doc = window.document;
  // 数据里“赵一”在前，但按姓名顺序“钱二”应排在前面。
  for (const id of ['playerA', 'playerB', 'h2hA', 'h2hB']) {
    const names = [...doc.getElementById(id).options].map(o => o.textContent).filter(t => t && !t.startsWith('请选择'));
    assert.deepEqual(names.map(n => n.split('（')[0]), ['钱二', '赵一'], `${id} 应按姓名顺序排列`);
  }
});

// 线上 RPC 尚未升级（缺少 p_forfeit）时，应给出可执行的提示，而不是 PostgREST 的原始报错。
test('弃权保存遇到未升级的 RPC 时提示部署 SQL', { skip: JSDOM ? false : 'jsdom 未安装' }, async () => {
  const rpcError = { message: 'Could not find the function public.staff_set_tournament_result(p_forfeit, p_match_id, p_score_a, p_score_b) in the schema cache', code: 'PGRST202' };
  const dom = new JSDOM(read('index.html'), { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://cyeztt.me/' });
  const { window } = dom;
  window.supabase = { createClient: () => makeTournamentStub({ data: null, error: rpcError }) };
  window.CYEZ_SUPABASE_CONFIG = { url: 'https://example.supabase.co', anonKey: 'sb_publishable_test' };
  for (const file of ['rating-core.js', 'app.js', 'tournament.js']) window.eval(read(file));
  await new Promise(r => setTimeout(r, 80));

  const doc = window.document;
  const toasts = [];
  window.showToast = (msg, type) => toasts.push({ msg, type });

  const select = doc.querySelector('[data-tm-forfeit="m1"]');
  select.value = 'a';
  select.dispatchEvent(new window.Event('change', { bubbles: true }));
  doc.querySelector('[data-save-tm="m1"]').click();
  await new Promise(r => setTimeout(r, 40));

  assert.equal(toasts.length, 1, '应弹出一条错误提示');
  assert.equal(toasts[0].type, 'error');
  assert.ok(toasts[0].msg.includes('supabase-schema.sql'), '提示应引导管理员部署 SQL：' + toasts[0].msg);
  assert.ok(!toasts[0].msg.includes('Could not find the function'), '不应把 PostgREST 原始报错直接抛给用户');
});
