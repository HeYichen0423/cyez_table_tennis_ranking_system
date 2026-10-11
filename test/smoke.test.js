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
