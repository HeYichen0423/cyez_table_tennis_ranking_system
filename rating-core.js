/* CYEZ 乒乓球积分系统 - 核心积分算法模块
 *
 * 该模块被 app.js、tournament.js 通过 <script> 引入（挂载到 window.CYEZRatingCore），
 * 同时导出 CommonJS，供 `node --test` 做单元测试。
 *
 * 设计原则：本文件只包含纯函数，不触碰 DOM、window 或 Supabase，
 * 以便在不启动浏览器的情况下验证 Elo 相关逻辑。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.CYEZRatingCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
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

  // 旧 ID -> 新条目，保证历史比赛权重不被改变。
  const LEGACY_COMPETITION_MAP = {
    friendly: COMPETITIONS.legacy_friendly,
    club: COMPETITIONS.legacy_club,
    school_qualifier: COMPETITIONS.legacy_school_qualifier,
    district_qualifier: COMPETITIONS.legacy_district_qualifier,
    school_official: COMPETITIONS.legacy_school_official
  };

  function competition(id) {
    const direct = COMPETITIONS[id];
    if (direct) return direct;
    return LEGACY_COMPETITION_MAP[id] || { name: id || '未知', weight: 0 };
  }

  function round1(n) {
    return Math.round(Number(n) * 10) / 10;
  }

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
    // 积分统一按 0.1 分为最小单位；同一场比赛双方加减同一个已舍入变化量，保持零和。
    const delta = round1(K * weight * m * (1 - e));
    return { e, m, delta };
  }

  function sortMatches(ms) {
    return [...ms].sort((a, b) => new Date(a.played_at) - new Date(b.played_at)
      || new Date(a.created_at) - new Date(b.created_at)
      || String(a.id).localeCompare(String(b.id)));
  }

  /**
   * 回放全部已生效比赛，重算每位选手的积分与胜负场次。
   *
   * @param {Array} profiles 选手资料（含 id、可选 initial_rating）
   * @param {Array} approvedMatches 已生效比赛（status === 'approved'）
   * @param {(competitionId: string) => number|{weight:number}} weightOf 权重查询函数
   * @returns {{ratings: Map, games: Map, wins: Map, losses: Map, approvedMatches: Array}}
   */
  function replayRatings(profiles, approvedMatches, weightOf) {
    const weight = (id) => {
      const value = typeof weightOf === 'function' ? weightOf(id) : undefined;
      if (typeof value === 'number') return value;
      if (value && typeof value.weight === 'number') return value.weight;
      return competition(id).weight;
    };

    const ratings = new Map(profiles.map(p => [p.id, round1(Number(p.initial_rating ?? INITIAL_RATING))]));
    const games = new Map(profiles.map(p => [p.id, 0]));
    const wins = new Map(profiles.map(p => [p.id, 0]));
    const losses = new Map(profiles.map(p => [p.id, 0]));

    const ordered = sortMatches(approvedMatches);
    for (const m of ordered) {
      const aRating = ratings.get(m.player_a_id) ?? INITIAL_RATING;
      const bRating = ratings.get(m.player_b_id) ?? INITIAL_RATING;
      const aWon = Number(m.score_a) > Number(m.score_b);
      const winnerId = aWon ? m.player_a_id : m.player_b_id;
      const loserId = aWon ? m.player_b_id : m.player_a_id;
      const winnerRating = aWon ? aRating : bRating;
      const loserRating = aWon ? bRating : aRating;
      const winnerScore = aWon ? Number(m.score_a) : Number(m.score_b);
      const loserScore = aWon ? Number(m.score_b) : Number(m.score_a);
      const calc = calculateDelta(winnerRating, loserRating, winnerScore, loserScore, weight(m.competition_id));
      m._winnerId = winnerId;
      m._delta = calc.delta;
      m._preRatingWinner = winnerRating;
      m._preRatingLoser = loserRating;
      m._expectedWinner = calc.e;
      m._multiplier = calc.m;
      // 与历史实现保持一致：只有初始积分与每场变化量取到 0.1，累计过程保留完整浮点精度，
      // 否则逐场取整会与线上既有排行榜产生微小偏差。
      ratings.set(winnerId, winnerRating + calc.delta);
      ratings.set(loserId, loserRating - calc.delta);
      games.set(m.player_a_id, (games.get(m.player_a_id) || 0) + 1);
      games.set(m.player_b_id, (games.get(m.player_b_id) || 0) + 1);
      wins.set(winnerId, (wins.get(winnerId) || 0) + 1);
      losses.set(loserId, (losses.get(loserId) || 0) + 1);
    }

    return { ratings, games, wins, losses, approvedMatches: ordered };
  }

  return {
    INITIAL_RATING,
    K,
    COMPETITIONS,
    LEGACY_COMPETITION_MAP,
    competition,
    expectedScore,
    scoreMultiplier,
    calculateDelta,
    sortMatches,
    replayRatings
  };
});
