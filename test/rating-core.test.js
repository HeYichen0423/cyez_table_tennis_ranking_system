'use strict';
// CYEZ 积分核心算法单元测试：node --test
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../rating-core.js');

test('初始常量与权重表保持既有数值', () => {
  assert.equal(core.INITIAL_RATING, 1500);
  assert.equal(core.K, 32);
  assert.equal(core.COMPETITIONS.friendly_new.weight, 0.3);
  assert.equal(core.COMPETITIONS.special.weight, 1.0);
});

test('competition() 解析新 ID、旧 ID 与未知 ID', () => {
  assert.equal(core.competition('monthly').weight, 0.5);
  // 历史 ID 必须映射到 legacy 条目，保证旧比赛权重不被改动。
  assert.equal(core.competition('friendly').weight, 0.2);
  assert.equal(core.competition('school_official').weight, 1.0);
  assert.equal(core.competition('不存在的级别').weight, 0);
});

test('expectedScore 在积分相等时为 0.5，且对高分选手更大', () => {
  assert.equal(core.expectedScore(1500, 1500), 0.5);
  assert.ok(core.expectedScore(1700, 1500) > 0.5);
  assert.ok(core.expectedScore(1500, 1700) < 0.5);
});

test('scoreMultiplier 对爆冷/大比分给出更高权重，且不超过上限 1.5', () => {
  assert.equal(core.scoreMultiplier(0, 4), 0);
  const narrow = core.scoreMultiplier(4, 3);
  const blowout = core.scoreMultiplier(4, 0);
  assert.ok(blowout > narrow);
  assert.ok(core.scoreMultiplier(11, 0) <= 1.5);
});

test('calculateDelta 按 0.1 分取整且赢家得分为正', () => {
  const { delta } = core.calculateDelta(1500, 1500, 4, 0, 0.3);
  assert.equal(delta, Math.round(delta * 10) / 10);
  assert.ok(delta > 0);
});

test('replayRatings 每场保持零和、累计场次并写回每场明细', () => {
  const profiles = [
    { id: 'a', initial_rating: 1500 },
    { id: 'b', initial_rating: 1500 },
  ];
  const matches = [
    { id: 'm1', played_at: '2026-01-01T00:00:00Z', created_at: '2026-01-01T00:00:00Z', player_a_id: 'a', player_b_id: 'b', score_a: 4, score_b: 0, competition_id: 'friendly_new', status: 'approved' },
    { id: 'm2', played_at: '2026-01-02T00:00:00Z', created_at: '2026-01-02T00:00:00Z', player_a_id: 'b', player_b_id: 'a', score_a: 4, score_b: 0, competition_id: 'friendly_new', status: 'approved' },
  ];
  const r = core.replayRatings(profiles, matches, core.competition);
  // 每场比赛双方加减同一个数，因此总积分守恒。
  assert.equal(Number((r.ratings.get('a') + r.ratings.get('b')).toFixed(1)), 3000);
  assert.equal(r.games.get('a'), 2);
  assert.equal(r.games.get('b'), 2);
  assert.equal(r.wins.get('a'), 1);
  assert.equal(r.losses.get('a'), 1);
  assert.equal(r.wins.get('b'), 1);
  assert.equal(r.losses.get('b'), 1);
  assert.equal(matches[0]._winnerId, 'a');
  assert.equal(matches[1]._winnerId, 'b');
  // 明细里记录了赛前积分与变化量。
  assert.equal(matches[0]._preRatingWinner, 1500);
  assert.ok(matches[0]._delta > 0);
});

test('replayRatings 按时间顺序回放，补录更早比赛会影响后续积分', () => {
  const profiles = [
    { id: 'a', initial_rating: 1500 },
    { id: 'b', initial_rating: 1500 },
    { id: 'c', initial_rating: 1500 },
  ];
  const later = { id: 'm-late', played_at: '2026-02-01T00:00:00Z', created_at: '2026-02-01T00:00:00Z', player_a_id: 'a', player_b_id: 'b', score_a: 4, score_b: 0, competition_id: 'special', status: 'approved' };
  const earlier = { id: 'm-early', played_at: '2026-01-01T00:00:00Z', created_at: '2026-01-01T00:00:00Z', player_a_id: 'c', player_b_id: 'a', score_a: 4, score_b: 0, competition_id: 'special', status: 'approved' };
  const r = core.replayRatings(profiles, [later, earlier], core.competition);
  assert.equal(r.approvedMatches[0].id, 'm-early');
  assert.equal(r.approvedMatches[1].id, 'm-late');
  // 先输给 c 后再赢 b，与直接赢 b 的积分不同。
  const r2 = core.replayRatings(profiles, [later], core.competition);
  assert.notEqual(r.ratings.get('a'), r2.ratings.get('a'));
});

test('replayRatings 支持函数式权重覆盖', () => {
  const profiles = [
    { id: 'a', initial_rating: 1500 },
    { id: 'b', initial_rating: 1500 },
  ];
  const matches = [
    { id: 'm1', played_at: '2026-01-01T00:00:00Z', created_at: '2026-01-01T00:00:00Z', player_a_id: 'a', player_b_id: 'b', score_a: 4, score_b: 0, competition_id: 'special', status: 'approved' },
  ];
  const low = core.replayRatings(profiles, matches, () => 0.1);
  const high = core.replayRatings(profiles, matches, () => 1.0);
  assert.ok(high.ratings.get('a') > low.ratings.get('a'));
});
