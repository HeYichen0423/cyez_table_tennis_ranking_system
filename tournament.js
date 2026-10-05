/* CYEZ Tournament / Bracket Module
 * 依赖：Supabase JS v2、supabase-config.js
 * 说明：比赛结果会通过数据库 RPC 写入 public.matches(status='approved')，因此自动进入原有 Elo 重算流程。
 */
(() => {
  const { createClient } = window.supabase;
  const CONFIG = window.CYEZ_SUPABASE_CONFIG || {};
  const configured = CONFIG.url && !CONFIG.url.includes('YOUR-PROJECT') && CONFIG.anonKey && !CONFIG.anonKey.includes('YOUR_');
  const client = configured ? createClient(CONFIG.url, CONFIG.anonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }) : null;

  const TOURNAMENT_COMPETITIONS = {
    friendly_new: { name: '友谊赛', weight: 0.3 },
    monthly: { name: '月赛', weight: 0.5 },
    small_qualifier: { name: '小赛预选赛', weight: 0.6 },
    club_new: { name: '社团赛', weight: 0.7 },
    major_qualifier: { name: '大赛预选赛', weight: 0.7 },
    district_city: { name: '区赛 / 市赛', weight: 0.8 },
    special: { name: '专项赛', weight: 1.0 }
  };
  const FORMAT_NAMES = { group_knockout: '小组循环 + 淘汰赛制', single_elim: '单败淘汰制', double_elim: '双败淘汰制' };
  const STATUS_NAMES = { draft: '草稿', in_progress: '进行中', completed: '已结束', cancelled: '已取消', scheduled: '待进行', completed_match: '已结束', bye: '轮空' };

  const state = { tournaments: [], selectedId: null, entries: [], allEntries: [], matches: [], profiles: [], currentProfile: null, playerFilter: '', realtime: null, refreshTimer: null };
  const $ = id => document.getElementById(id);
  const els = {
    view: $('view-tournaments'), list: $('tournamentList'), detail: $('tournamentDetail'), playerFilter: $('tournamentPlayerFilter'), formatFilter: $('tournamentFormatFilter'), search: $('tournamentSearch'), createBtn: $('createTournamentBtn'),
    createBackdrop: $('tournamentCreateBackdrop'), createForm: $('tournamentCreateForm'), createName: $('tournamentName'), createStart: $('tournamentStart'), createCompetition: $('tournamentCompetition'), createFormat: $('tournamentFormat'), createGroupCount: $('tournamentGroupCount'), createAdvance: $('tournamentAdvance'), playerChecklist: $('tournamentPlayerChecklist'), createNote: $('tournamentCreateNote'), createClose: $('tournamentCreateClose')
  };

  const esc = (s='') => String(s).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;'}[c]));
  const uid = () => crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const player = id => state.profiles.find(p => p.id === id) || null;
  const playerName = id => player(id)?.real_name || '待定';
  const isStaff = () => !!state.currentProfile && !state.currentProfile.is_banned && ['admin','moderator'].includes(state.currentProfile.role);
  const isAdmin = () => !!state.currentProfile && !state.currentProfile.is_banned && state.currentProfile.role === 'admin';
  const dateText = v => v ? new Date(v).toLocaleString('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}) : '—';
  const powerOfTwo = n => { let p=1; while(p<n)p*=2; return p; };

  function seedOrder(size) {
    if (size === 1) return [1];
    let arr = [1, 2];
    while (arr.length < size) {
      const max = arr.length * 2 + 1;
      arr = arr.flatMap(x => [x, max - x]);
    }
    return arr;
  }

  function roundCountFor(n) { return Math.max(1, Math.ceil(Math.log2(Math.max(2,n)))); }

  function makeEliminationMatches(playersOrCount, stage, format) {
    const n = Array.isArray(playersOrCount) ? playersOrCount.length : Number(playersOrCount || 0);
    if (n < 2) throw new Error('淘汰赛至少需要 2 名选手。');
    const size = powerOfTwo(n);
    const rounds = roundCountFor(size);
    const round = [];
    for (let i=0;i<size/2;i++) {
      round.push({
        id:uid(),
        bracket_key:`${stage}-r1-m${i+1}`,
        stage,
        round_no:1,
        match_no:i+1,
        label:`第1轮 · ${i+1}`,
        player_a_id:null,
        player_b_id:null,
        status:'scheduled',
        winner_id:null,
        next_match_id:null,
        next_slot:null,
        next_loss_match_id:null,
        next_loss_slot:null
      });
    }
    const all=[...round];
    const roundsMap=[round];
    for(let r=2;r<=rounds;r++){
      const count=size/Math.pow(2,r);
      const current=[];
      for(let m=1;m<=count;m++){
        current.push({
          id:uid(),
          bracket_key:`${stage}-r${r}-m${m}`,
          stage,
          round_no:r,
          match_no:m,
          label:`${r===rounds?'决赛':`第${r}轮`} · ${m}`,
          player_a_id:null,
          player_b_id:null,
          status:'scheduled',
          winner_id:null,
          next_match_id:null,
          next_slot:null,
          next_loss_match_id:null,
          next_loss_slot:null
        });
      }
      all.push(...current);
      roundsMap.push(current);
    }
    for(let r=0;r<roundsMap.length-1;r++){
      roundsMap[r].forEach((m,idx)=>{
        m.next_match_id=roundsMap[r+1][Math.floor(idx/2)].id;
        m.next_slot=idx%2===0?1:2;
      });
    }
    return {all, roundsMap, rounds};
  }

  function makeDoubleElimMatches(playersOrCount) {
    const n = Array.isArray(playersOrCount) ? playersOrCount.length : Number(playersOrCount || 0);
    if (n < 4) throw new Error('双败淘汰制至少需要 4 名选手。');
    if (n > 32) throw new Error('双败淘汰制目前最多支持 32 名选手。');
    const size = powerOfTwo(n);
    const k = roundCountFor(size);
    const wbRounds=[]; const all=[];
    for(let r=1;r<=k;r++) {
      const count=size/Math.pow(2,r); const cur=[];
      for(let m=1;m<=count;m++) cur.push({
        id:uid(), bracket_key:`winners-r${r}-m${m}`, stage:'winners', round_no:r, match_no:m,
        label:`胜者组 R${r} · ${m}`, player_a_id:null, player_b_id:null, status:'scheduled',
        winner_id:null, next_match_id:null, next_slot:null, next_loss_match_id:null, next_loss_slot:null
      });
      wbRounds.push(cur); all.push(...cur);
    }
    for(let r=0;r<k-1;r++){
      wbRounds[r].forEach((m,idx)=>{
        m.next_match_id=wbRounds[r+1][Math.floor(idx/2)].id;
        m.next_slot=idx%2===0?1:2;
      });
    }

    // 标准双败败者组：32人时为 8,8,4,4,2,2,1,1。
    const lbRounds=[]; const counts=[];
    for(let r=1;r<=k-1;r++){
      const count=Math.max(1,size/Math.pow(2,r+1));
      counts.push(count,count);
    }
    for(let lr=1;lr<=2*k-2;lr++) {
      const count=counts[lr-1]; const cur=[];
      for(let m=1;m<=count;m++) cur.push({
        id:uid(), bracket_key:`losers-r${lr}-m${m}`, stage:'losers', round_no:lr, match_no:m,
        label:`败者组 R${lr} · ${m}`, player_a_id:null, player_b_id:null, status:'scheduled',
        winner_id:null, next_match_id:null, next_slot:null, next_loss_match_id:null, next_loss_slot:null
      });
      lbRounds.push(cur); all.push(...cur);
    }

    for(let lr=0;lr<lbRounds.length-1;lr++) {
      const src=lbRounds[lr], dest=lbRounds[lr+1];
      if(dest.length===src.length) src.forEach((m,idx)=>{m.next_match_id=dest[idx].id;m.next_slot=1;});
      else src.forEach((m,idx)=>{m.next_match_id=dest[Math.floor(idx/2)].id;m.next_slot=idx%2===0?1:2;});
    }

    // 胜者组败者去向：WB1→LB1；WB2→LB2；WB3→LB4；WB4→LB6；WB5→LB8。
    wbRounds.forEach((wr,ri)=>{
      const r=ri+1;
      const targetRound = r===1 ? 1 : 2*r-2;
      const dest=lbRounds[targetRound-1];
      if(!dest)return;
      wr.forEach((m,idx)=>{
        const destIdx = r===1 ? Math.floor(idx/2) : idx;
        const destSlot = r===1 ? (idx%2===0?1:2) : 2;
        if(dest[destIdx]) { m.next_loss_match_id=dest[destIdx].id; m.next_loss_slot=destSlot; }
      });
    });

    const grand={id:uid(),bracket_key:'grand-final',stage:'final',round_no:1,match_no:1,label:'总决赛',player_a_id:null,player_b_id:null,status:'scheduled',winner_id:null,next_match_id:null,next_slot:null,next_loss_match_id:null,next_loss_slot:null};
    const reset={id:uid(),bracket_key:'reset-final',stage:'final',round_no:2,match_no:1,label:'总决赛加赛',player_a_id:null,player_b_id:null,status:'scheduled',winner_id:null,next_match_id:null,next_slot:null,next_loss_match_id:null,next_loss_slot:null};
    all.push(grand,reset);
    wbRounds[k-1][0].next_match_id=grand.id;wbRounds[k-1][0].next_slot=1;
    lbRounds[lbRounds.length-1][0].next_match_id=grand.id;lbRounds[lbRounds.length-1][0].next_slot=2;

    return {all, wbRounds, lbRounds};
  }

  function makeGroupMatchesFromEntries(entries) {
    const groups = new Map();
    entries.forEach(e=>{
      if(!e.group_no) return;
      if(!groups.has(e.group_no)) groups.set(e.group_no,[]);
      const p=player(e.player_id);
      if(p) groups.get(e.group_no).push({p,slot_no:e.slot_no||999});
    });
    const matches=[];
    [...groups.entries()].sort((a,b)=>a[0]-b[0]).forEach(([groupNo,items])=>{
      items.sort((a,b)=>a.slot_no-b.slot_no || a.p.real_name.localeCompare(b.p.real_name,'zh-CN'));
      let no=1;
      for(let i=0;i<items.length;i++) for(let j=i+1;j<items.length;j++){
        matches.push({
          id:uid(),
          bracket_key:`group-g${groupNo}-m${no}`,
          stage:'group',
          round_no:1,
          match_no:no++,
          group_no:groupNo,
          label:`小组 ${String.fromCharCode(64+Number(groupNo))} · ${i+1}-${j+1}`,
          player_a_id:items[i].p.id,
          player_b_id:items[j].p.id,
          status:'scheduled',
          winner_id:null,
          next_match_id:null,
          next_slot:null,
          next_loss_match_id:null,
          next_loss_slot:null
        });
      }
    });
    return matches;
  }

  function buildSingleKnockout(players, stage='knockout') {
    const data=makeEliminationMatches(players,stage,stage);
    return data.all;
  }

  function groupStandings(groups) {
    return groups.map((g,gi)=>{
      const rows=g.map(p=>({p,wins:0,losses:0,gf:0,ga:0,diff:0,points:0}));
      const map=new Map(rows.map(r=>[r.p.id,r]));
      state.matches.filter(m=>m.stage==='group' && m.group_no===gi+1 && m.status==='completed').forEach(m=>{
        const a=map.get(m.player_a_id),b=map.get(m.player_b_id);if(!a||!b)return;
        a.gf+=Number(m.score_a);a.ga+=Number(m.score_b);a.diff=a.gf-a.ga;b.gf+=Number(m.score_b);b.ga+=Number(m.score_a);b.diff=b.gf-b.ga;
        if(Number(m.score_a)>Number(m.score_b)){a.wins++;a.points+=1;b.losses++;}else{b.wins++;b.points+=1;a.losses++;}
      });
      rows.sort((a,b)=>b.wins-a.wins||b.diff-a.diff||b.gf-a.gf||a.p.real_name.localeCompare(b.p.real_name,'zh-CN'));
      return {group:gi+1,rows};
    });
  }

  function tournamentGroupsFromEntries() {
    const g=Math.max(0,Number(state.selectedTournament?.group_count||0));
    const groups=Array.from({length:g},()=>[]);
    state.entries.forEach(e=>{ if(e.group_no && groups[e.group_no-1]) groups[e.group_no-1].push(player(e.player_id)); });
    groups.forEach(x=>x.sort((a,b)=>(state.entries.find(e=>e.player_id===a.id)?.slot_no||0)-(state.entries.find(e=>e.player_id===b.id)?.slot_no||0)));
    return groups;
  }

  async function refreshProfile() {
    if(!client)return;
    const {data:session}=await client.auth.getSession();
    if(!session.session){state.currentProfile=null;return;}
    const {data,error}=await client.from('profiles').select('*').eq('id',session.session.user.id).maybeSingle();
    if(error) throw error;
    state.currentProfile=data;
  }

  async function refreshTournaments(selectId=state.selectedId) {
    if(!client){renderConfig();return;}
    const [{data:tournaments,error:tErr},{data:profiles,error:pErr},{data:allEntries,error:entryErr}]=await Promise.all([
      client.from('tournaments').select('*').order('start_at',{ascending:false}),
      client.from('profiles').select('id,real_name,username,role,is_banned,created_at').order('real_name',{ascending:true}),
      client.from('tournament_entries').select('tournament_id,player_id,seed')
    ]);
    if(tErr) throw tErr;if(pErr) throw pErr;if(entryErr) throw entryErr;
    state.tournaments=tournaments||[]; state.profiles=profiles||[]; state.allEntries=allEntries||[];
    updateStaffButton();
    populatePlayerFilter();
    if(selectId && state.tournaments.some(t=>t.id===selectId)) state.selectedId=selectId;
    else state.selectedId=state.tournaments[0]?.id||null;
    renderTournamentList();
    if(state.selectedId) await loadTournament(state.selectedId); else renderTournamentDetail();
  }

  async function loadTournament(id) {
    if(!client||!id)return;
    state.selectedId=id;
    const [{data:entries,error:eErr},{data:matches,error:mErr}]=await Promise.all([
      client.from('tournament_entries').select('*').eq('tournament_id',id).order('seed',{ascending:true}),
      client.from('tournament_matches').select('*').eq('tournament_id',id).order('stage',{ascending:true}).order('round_no',{ascending:true}).order('match_no',{ascending:true})
    ]);
    if(eErr)throw eErr;if(mErr)throw mErr;
    state.entries=entries||[];state.matches=matches||[];
    renderTournamentDetail();
  }

  Object.defineProperty(state,'selectedTournament',{get(){return state.tournaments.find(t=>t.id===state.selectedId)||null;}});

  function renderTournamentList() {
    const q=(els.search?.value||'').trim().toLowerCase();
    const format=(els.formatFilter?.value||'all');
    const filtered=state.tournaments.filter(t=>{
      if(format!=='all'&&t.format!==format)return false;
      const matchesPlayer=!state.playerFilter||state.allEntries.some(e=>e.tournament_id===t.id&&e.player_id===state.playerFilter);
      if(q&&!`${t.name} ${FORMAT_NAMES[t.format]} ${TOURNAMENT_COMPETITIONS[t.competition_id]?.name||''}`.toLowerCase().includes(q))return false;
      if(!matchesPlayer)return false;
      return true;
    });
    els.list.innerHTML=filtered.map(t=>{
      const active=t.id===state.selectedId;
      const comp=TOURNAMENT_COMPETITIONS[t.competition_id]||{name:t.competition_id,weight:'—'};
      return `<button class="tournament-list-item ${active?'active':''}" data-tournament-select="${t.id}"><div><strong>${esc(t.name)}</strong><span>${esc(FORMAT_NAMES[t.format]||t.format)} · ${esc(comp.name)}</span></div><div class="tournament-list-meta"><b>${statusText(t.status)}</b><span>${dateText(t.start_at)}</span></div></button>`;
    }).join('')||'<div class="empty">没有符合条件的赛事。</div>';
  }

  function statusText(s){return STATUS_NAMES[s]||s;}
  function matchStatus(m){if(m.status==='completed')return '已结束';if(m.status==='bye')return '轮空';if(m.status==='cancelled')return '已取消';return '待进行';}
  function matchPlayersReady(m){return !!m.player_a_id&&!!m.player_b_id;}

  function matchEditor(m) {
    if(!isStaff())return '';
    if(m.status==='bye'||m.status==='cancelled')return '';
    if(!matchPlayersReady(m))return '';
    const canEdit=m.status==='scheduled'||m.status==='completed';
    if(!canEdit)return '';
    return `<div class="tournament-result-editor"><input type="number" min="0" max="99" value="${m.score_a ?? ''}" placeholder="0" data-tm-score-a="${m.id}"><span>:</span><input type="number" min="0" max="99" value="${m.score_b ?? ''}" placeholder="0" data-tm-score-b="${m.id}"><button class="btn btn-primary btn-sm" data-save-tm="${m.id}">${m.status==='completed'?'修改结果':'录入结果'}</button>${m.status==='completed'?`<button class="text-btn danger-text" data-clear-tm="${m.id}">清除结果</button>`:''}</div>`;
  }

  function firstRoundSlotEditor(m) {
    if(!isStaff()||!(m.stage==='knockout'||m.stage==='winners')||m.round_no!==1||!['scheduled','bye'].includes(m.status))return '';
    const optionHtml=(slot)=>state.entries.map(e=>{const p=player(e.player_id);const selected=(slot===1?m.player_a_id:m.player_b_id)===e.player_id?'selected':'';return `<option value="${e.player_id}" ${selected}>${esc(p?.real_name||'未知')}</option>`;}).join('');
    const manualBye=(m.player_a_id&&!m.player_b_id)||(!m.player_a_id&&m.player_b_id);
    return `<div class="slot-editors"><select data-tm-slot="${m.id}:1"><option value="">空位</option>${optionHtml(1)}</select><select data-tm-slot="${m.id}:2"><option value="">空位</option>${optionHtml(2)}</select></div>
      ${manualBye&&m.status==='scheduled'?`<button class="text-btn danger-text manual-bye-btn" data-manual-bye="${m.id}">手动设为轮空并晋级</button>`:''}`;
  }

  function matchCard(m) {
    const a=player(m.player_a_id),b=player(m.player_b_id);
    const score=m.status==='completed'?`${m.score_a}:${m.score_b}`:(m.status==='bye'?'轮空':'—');
    const win=m.winner_id;
    return `<div class="bracket-match ${m.status==='completed'?'done':''} ${m.status==='bye'?'bye':''}">
      <div class="bracket-match-top"><span>${esc(m.label||`第${m.round_no}轮 · ${m.match_no}`)}</span><span class="pill">${matchStatus(m)}</span></div>
      <div class="bracket-player ${win===m.player_a_id?'winner':''}"><span>${esc(a?.real_name||'待定')}</span><b>${m.status==='completed' ? m.score_a : ''}</b></div>
      <div class="bracket-player ${win===m.player_b_id?'winner':''}"><span>${esc(b?.real_name||'待定')}</span><b>${m.status==='completed' ? m.score_b : ''}</b></div>
      ${m.status==='scheduled'&&(!a||!b)?'<div class="match-hint">等待晋级选手</div>':''}
      ${m.status==='bye'?`<div class="match-hint">${esc(playerName(m.winner_id))} 轮空晋级</div>`:''}
      ${firstRoundSlotEditor(m)}
      ${matchEditor(m)}
    </div>`;
  }

  function bracketColumns(matches, stageFilter) {
    const rounds=[...new Set(matches.filter(m=>m.stage===stageFilter).map(m=>m.round_no))].sort((a,b)=>a-b);
    if(!rounds.length)return '<div class="empty">暂无淘汰赛节点。</div>';
    return `<div class="bracket-scroll"><div class="bracket-grid">${rounds.map(r=>`<div class="bracket-column"><div class="bracket-round-title">${r===rounds.length?'决赛':`第 ${r} 轮`}</div>${matches.filter(m=>m.stage===stageFilter&&m.round_no===r).sort((a,b)=>a.match_no-b.match_no).map(matchCard).join('')}</div>`).join('')}</div></div>`;
  }

  function groupAssignmentEditor() {
    if(!isStaff()) return '';
    const g=Number(state.selectedTournament?.group_count||0);
    if(!g) return '';
    const maxSlot=Math.max(1,Math.ceil(state.entries.length/g));
    const allAssigned=state.entries.length>0 && state.entries.every(e=>e.group_no);
    const hasGroupMatches=state.matches.some(m=>m.stage==='group');
    const locked=state.matches.some(m=>m.stage==='group' && m.status==='completed');
    return `<div class="card"><div class="card-head"><div><h3>手动分组与小组签位</h3><span class="muted">管理员/副管理员手动决定每名选手进入哪个小组及小组位置；系统不会自动抽签。</span></div><div class="form-actions"><button class="btn btn-primary btn-sm" data-generate-groups ${(!allAssigned||hasGroupMatches||locked)?'disabled':''}>生成小组赛程</button></div></div>
      <div class="table-wrap"><table class="data-table"><thead><tr><th>选手</th><th>用户名</th><th>小组</th><th>小组位置</th></tr></thead><tbody>
      ${state.entries.map(e=>{
        const p=player(e.player_id);
        const groupOpts=[`<option value="">未分组</option>`].concat(Array.from({length:g},(_,i)=>`<option value="${i+1}" ${Number(e.group_no)===i+1?'selected':''}>${String.fromCharCode(65+i)}组</option>`)).join('');
        const slotOpts=Array.from({length:maxSlot},(_,i)=>`<option value="${i+1}" ${Number(e.slot_no)===i+1?'selected':''}>${i+1}</option>`).join('');
        return `<tr><td class="name-cell">${esc(p?.real_name||'未知')}</td><td>@${esc(p?.username||'')}</td><td><select data-entry-group="${e.player_id}" ${hasGroupMatches||locked?'disabled':''}>${groupOpts}</select></td><td><select data-entry-slot="${e.player_id}" ${(!e.group_no||hasGroupMatches||locked)?'disabled':''}>${slotOpts}</select></td></tr>`;
      }).join('')}</tbody></table></div></div>`;
  }

  function groupView() {
    const groups=tournamentGroupsFromEntries();
    const standings=groupStandings(groups);
    const groupRows=standings.map(s=>`<div class="card"><div class="card-head"><div><h3>小组 ${String.fromCharCode(64+s.group)}</h3><span class="muted">按胜场 → 局差 → 得分排名</span></div></div><div class="table-wrap"><table class="data-table"><thead><tr><th>名次</th><th>选手</th><th>胜</th><th>负</th><th>局差</th></tr></thead><tbody>${s.rows.map((r,i)=>`<tr><td>${i+1}</td><td class="name-cell">${esc(r.p.real_name)}</td><td>${r.wins}</td><td>${r.losses}</td><td>${r.diff>0?'+':''}${r.diff}</td></tr>`).join('')||'<tr><td colspan="5"><div class="empty">暂无数据。</div></td></tr>'}</tbody></table></div></div>`).join('');
    return `${groupAssignmentEditor()}<div class="tournament-group-grid">${groupRows}</div>
      <div class="card"><div class="card-head"><div><h3>小组赛</h3><span class="muted">管理员/副管理员录入赛果；小组赛程由管理人员在分组完成后手动点击生成。</span></div></div><div class="tournament-group-matches">${state.matches.filter(m=>m.stage==='group').sort((a,b)=>(a.group_no-b.group_no)||(a.match_no-b.match_no)).map(matchCard).join('')||'<div class="empty">尚未生成小组赛程。</div>'}</div></div>`;
  }

  function knockoutSection() {
    if(state.selectedTournament.format==='double_elim') {
      return `<div class="card"><div class="card-head"><div><h3>胜者组</h3><span class="muted">输掉一场后进入败者组。</span></div></div>${bracketColumns(state.matches,'winners')}</div><div class="card"><div class="card-head"><div><h3>败者组</h3><span class="muted">再次失利即淘汰。</span></div></div>${bracketColumns(state.matches,'losers')}</div><div class="card"><div class="card-head"><div><h3>总决赛</h3></div></div>${bracketColumns(state.matches,'final')}</div>`;
    }
    return `<div class="card"><div class="card-head"><div><h3>${state.selectedTournament.format==='group_knockout'?'淘汰赛':'淘汰赛签位表'}</h3><span class="muted">每场结果确认后，胜者按签位关系进入下一轮；不会自动抽签。</span></div></div>${bracketColumns(state.matches,state.selectedTournament.format==='group_knockout'?'knockout':'winners')}</div>`;
  }

  function renderTournamentDetail() {
    if(!state.selectedTournament){els.detail.innerHTML='<div class="card empty">请选择一场赛事。</div>';return;}
    const t=state.selectedTournament, comp=TOURNAMENT_COMPETITIONS[t.competition_id]||{name:t.competition_id,weight:'—'};
    const participantNames=state.entries.map(e=>player(e.player_id)?.real_name).filter(Boolean);
    const groupDone=t.format==='group_knockout' && state.matches.some(m=>m.stage==='group') && state.matches.filter(m=>m.stage==='group').every(m=>m.status==='completed');
    const hasKnockout=state.matches.some(m=>m.stage==='knockout');
    const staffActions=isStaff()?`<div class="form-actions"><button class="btn btn-ghost" data-tour-status="completed">结束赛事</button><button class="btn btn-ghost" data-tour-status="cancelled">取消赛事</button>${t.format==='group_knockout'&&groupDone&&!hasKnockout?`<button class="btn btn-ghost" data-generate-knockout>生成淘汰赛空签位</button>`:''}<button class="btn btn-danger" data-delete-tournament>彻底删除赛事</button></div>`:'';
    const note=t.format==='group_knockout'?'小组分组、位置和淘汰赛首轮签位全部由管理员/副管理员手动填写。':t.format==='double_elim'?'双败赛制：签位由管理员/副管理员手动填写，赛果确认后系统仅按既定线路推进。':'单败赛制：首轮签位由管理员/副管理员手动填写，赛果确认后按既定线路推进。';
    els.detail.innerHTML=`<div class="tournament-detail-head"><div><div class="eyebrow">TOURNAMENT</div><h1>${esc(t.name)}</h1><p>${esc(FORMAT_NAMES[t.format])} · ${esc(comp.name)}（权重 ${comp.weight}） · ${dateText(t.start_at)}</p></div><div class="tournament-actions"><span class="pill ${t.status==='completed'?'active':''}">${statusText(t.status)}</span>${staffActions}</div></div>
      <div class="tournament-stat-strip"><div><span>参赛人数</span><strong>${state.entries.length}</strong></div><div><span>已完成比赛</span><strong>${state.matches.filter(m=>m.status==='completed').length}</strong></div><div><span>比赛节点</span><strong>${state.matches.length}</strong></div><div><span>赛事权重</span><strong>${comp.weight}</strong></div></div>
      <div class="card"><div class="card-head"><div><h3>赛事说明</h3><span class="muted">${esc(note)}</span></div></div><div class="participant-chips">${participantNames.map(n=>`<span class="pill">${esc(n)}</span>`).join('')}</div></div>
      ${t.format==='group_knockout'?groupView():''}
      ${knockoutSection()}`;
  }

  function updateStaffButton(){ if(els.createBtn) els.createBtn.hidden=!isStaff(); }

  function populatePlayerFilter(){
    if(!els.playerFilter)return;
    const previous=els.playerFilter.value||state.playerFilter;
    els.playerFilter.innerHTML='<option value="">所有选手</option>'+state.profiles.filter(p=>!p.is_banned).map(p=>`<option value="${p.id}">${esc(p.real_name)}</option>`).join('');
    if(previous&&state.profiles.some(p=>p.id===previous)) els.playerFilter.value=previous; else els.playerFilter.value=state.playerFilter||'';
  }

  function renderCreatePlayers() {
    const ranked=state.profiles.filter(p=>!p.is_banned).slice().sort((a,b)=>a.real_name.localeCompare(b.real_name,'zh-CN'));
    els.playerChecklist.innerHTML=ranked.map(p=>`<label class="player-check"><input type="checkbox" value="${p.id}"><span><strong>${esc(p.real_name)}</strong><small>@${esc(p.username)}</small></span></label>`).join('')||'<div class="empty">暂无可报名选手。</div>';
  }

  function openCreateTournament() { if(!isStaff())return; renderCreatePlayers(); els.createForm.reset(); els.createStart.value=new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,16); updateCreateFormatUI(); els.createBackdrop.hidden=false; }
  function closeCreateTournament(){els.createBackdrop.hidden=true;}
  function updateCreateFormatUI(){
    const hybrid=els.createFormat.value==='group_knockout';
    els.createGroupCount.closest('.field').hidden=!hybrid;
    els.createAdvance.closest('.field').hidden=!hybrid;
    els.createNote.textContent=els.createFormat.value==='double_elim'
      ? '双败淘汰制支持 4-32 人。创建后不会自动抽签，请由管理员/副管理员手动填写胜者组首轮签位；轮空也需手动确认。'
      : hybrid
        ? '小组人数与选手分组均由管理员/副管理员手动安排；系统不会自动抽签。分组完成后由管理员手动生成小组赛程。'
        : '单败淘汰制建议参赛人数不超过 64 人。创建后不会自动抽签，请手动填写首轮签位。';
  }

  function createStructure(selected,format,groupCount,advance) {
    // 不再按积分或姓名排序，也不再把选手自动放入任何签位。
    const entries=selected.map((p,i)=>({player_id:p.id,seed:i+1,group_no:null,slot_no:null}));
    if(format==='single_elim') return {entries,matches:makeEliminationMatches(selected.length,'winners','winners').all};
    if(format==='double_elim') return {entries,matches:makeDoubleElimMatches(selected.length).all};
    return {entries,matches:[]};
  }

  async function submitCreateTournament(e){
    e.preventDefault();
    try{
      if(!isStaff())throw new Error('没有赛事管理权限。');
      const selectedIds=[...els.playerChecklist.querySelectorAll('input[type=checkbox]:checked')].map(x=>x.value);
      const selected=selectedIds.map(id=>player(id)).filter(Boolean);
      const format=els.createFormat.value;const groupCount=Number(els.createGroupCount.value||0);const advance=Number(els.createAdvance.value||2);
      if(!els.createName.value.trim())throw new Error('请输入赛事名称。');
      if(selected.length<2)throw new Error('至少选择 2 名选手。');
      if(format==='double_elim'&&(selected.length<4||selected.length>32))throw new Error('双败淘汰制支持 4-32 名选手。');
      if(format==='group_knockout'){if(groupCount<2)throw new Error('小组赛至少需要 2 组。');if(selected.length<groupCount*3)throw new Error('建议每组至少 3 人，请减少组数或增加参赛人数。');if(advance*groupCount>64)throw new Error('晋级人数过多，请降低每组晋级人数。');}
      const structure=createStructure(selected,format,groupCount,advance);
      const start=new Date(els.createStart.value).toISOString();
      const {data,error}=await client.rpc('staff_create_tournament',{p_name:els.createName.value.trim(),p_competition_id:els.createCompetition.value,p_format:format,p_start_at:start,p_group_count:format==='group_knockout'?groupCount:0,p_advance_per_group:format==='group_knockout'?advance:1,p_entries:structure.entries,p_matches:structure.matches});
      if(error)throw error;
      closeCreateTournament(); await refreshTournaments(data); showToast('赛事创建成功。当前为手动签位模式，请在赛事详情中填写签位。');
    }catch(err){showToast(err.message||'赛事创建失败。','error');}
  }

  async function setEntryPlacement(playerId, groupNo, slotNo){
    try{
      const t=state.selectedTournament;
      if(!t||t.format!=='group_knockout'||!isStaff()) throw new Error('没有权限。');
      const {error}=await client.rpc('staff_set_tournament_entry_slot',{
        p_tournament_id:t.id,
        p_player_id:playerId,
        p_group_no:groupNo?Number(groupNo):null,
        p_slot_no:slotNo?Number(slotNo):null
      });
      if(error) throw error;
      await loadTournament(t.id);
      toast('小组签位已更新。');
    }catch(e){toast(e.message||'小组签位更新失败。','error');}
  }

  async function generateGroupMatches(){
    try{
      const t=state.selectedTournament;
      if(!t||t.format!=='group_knockout'||!isStaff())throw new Error('没有权限。');
      if(state.matches.some(m=>m.stage==='group'))throw new Error('小组赛程已经生成。');
      if(state.entries.some(e=>!e.group_no))throw new Error('请先为所有选手完成分组。');
      const seen=new Set();
      for(const e of state.entries){
        const key=`${e.group_no}:${e.slot_no||''}`;
        if(seen.has(key)) throw new Error('同一小组内存在重复位置，请调整后再生成赛程。');
        seen.add(key);
      }
      const matches=makeGroupMatchesFromEntries(state.entries);
      if(!matches.length)throw new Error('没有可生成的小组比赛。');
      const {error}=await client.rpc('staff_add_tournament_matches',{p_tournament_id:t.id,p_matches:matches});
      if(error)throw error;
      await loadTournament(t.id);
      toast('小组赛程已生成。');
    }catch(e){toast(e.message||'生成小组赛程失败。','error');}
  }

  async function generateKnockoutFramework(){
    try{
      const t=state.selectedTournament;
      if(!t||t.format!=='group_knockout'||!isStaff())throw new Error('没有权限。');
      if(state.matches.some(m=>m.stage==='knockout'))throw new Error('淘汰赛签位已经生成。');
      const groupMatches=state.matches.filter(m=>m.stage==='group');
      if(!groupMatches.length || !groupMatches.every(m=>m.status==='completed'))throw new Error('请先完成全部小组赛。');
      const qualifierCount=Number(t.group_count)*Number(t.advance_per_group);
      if(qualifierCount<2)throw new Error('晋级人数不足。');
      const ko=makeEliminationMatches(qualifierCount,'knockout','knockout').all;
      const {error}=await client.rpc('staff_add_tournament_matches',{p_tournament_id:t.id,p_matches:ko});
      if(error)throw error;
      await loadTournament(t.id);
      toast('淘汰赛空白签位已生成，请手动填入晋级选手。');
    }catch(e){toast(e.message||'生成淘汰赛失败。','error');}
  }

  async function deleteTournament(){
    try{
      if(!isStaff())throw new Error('没有赛事管理权限。');
      const t=state.selectedTournament;
      if(!t) return;
      const ok=confirm(`确定要彻底删除赛事“${t.name}”吗？\n\n该操作会永久删除赛事、签位、赛事产生的积分比赛记录和赛事历史。删除后不可恢复。`);
      if(!ok)return;
      const {error}=await client.rpc('staff_delete_tournament',{p_tournament_id:t.id});
      if(error)throw error;
      state.selectedId=null;
      await refreshTournaments();
      toast('赛事已彻底删除。');
    }catch(e){toast(e.message||'删除赛事失败。','error');}
  }

  function toast(msg,type='success'){if(window.showToast){window.showToast(msg,type);return;}const div=document.createElement('div');div.className=`toast ${type}`;div.textContent=msg;document.body.appendChild(div);setTimeout(()=>div.remove(),3500);}
  function showToast(msg,type){toast(msg,type);}
  window.CYEZTournament = { openPlayerFilter(id){state.playerFilter=id||'';if(els.playerFilter)els.playerFilter.value=id||'';const entry=state.allEntries.find(e=>e.player_id===id);if(entry)state.selectedId=entry.tournament_id;navigateTournaments();}, navigate:navigateTournaments };

  function navigateTournaments(){
    document.querySelectorAll('.view').forEach(x=>x.classList.toggle('active',x.id==='view-tournaments'));
    document.querySelectorAll('.nav-tab').forEach(x=>x.classList.toggle('active',x.dataset.view==='tournaments'));
    if(!state.tournaments.length && client)refreshTournaments().catch(e=>toast(e.message||'赛事加载失败。','error'));
    window.scrollTo({top:0,behavior:'smooth'});
  }

  async function loadTournamentOnce(id){const [{data:entries},{data:matches}]=await Promise.all([client.from('tournament_entries').select('*').eq('tournament_id',id).order('seed',{ascending:true}),client.from('tournament_matches').select('*').eq('tournament_id',id).order('round_no',{ascending:true}).order('match_no',{ascending:true})]);state.entries=entries||[];state.matches=matches||[];renderTournamentDetail();}

  async function saveResult(id,clear=false){
    try{const a=document.querySelector(`[data-tm-score-a="${id}"]`);const b=document.querySelector(`[data-tm-score-b="${id}"]`);const sa=clear?null:(a?.value===''?null:Number(a?.value));const sb=clear?null:(b?.value===''?null:Number(b?.value));if(!clear&&(!Number.isInteger(sa)||!Number.isInteger(sb)||sa===sb))throw new Error('请输入两个不同的整数比分。');const {error}=await client.rpc('staff_set_tournament_result',{p_match_id:id,p_score_a:sa,p_score_b:sb});if(error)throw error;await refreshTournaments(state.selectedId);toast(clear?'结果已清除，积分将按剩余赛事重算。':'比赛结果已保存，积分已自动更新。');}catch(e){toast(e.message||'保存失败。','error');}
  }
  async function manualBye(id){
    try{
      const {error}=await client.rpc('staff_advance_tournament_bye',{p_match_id:id});
      if(error)throw error;
      await loadTournament(state.selectedId);
      toast('已手动确认轮空并晋级。');
    }catch(e){toast(e.message||'设置轮空失败。','error');}
  }
  async function setSlot(key,value){const [id,slot]=key.split(':');try{const {error}=await client.rpc('staff_set_tournament_slot',{p_match_id:id,p_slot:Number(slot),p_player_id:value||null});if(error)throw error;await loadTournament(state.selectedId);toast('首轮签位已更新。');}catch(e){toast(e.message||'签位调整失败。','error');}}
  async function setStatus(id,status){try{const {error}=await client.rpc('staff_set_tournament_status',{p_tournament_id:id,p_status:status});if(error)throw error;await refreshTournaments(id);toast(status==='completed'?'赛事已结束。':'赛事已取消。');}catch(e){toast(e.message||'赛事状态更新失败。','error');}}

  function bind(){
    if(els.createBtn)els.createBtn.addEventListener('click',openCreateTournament);
    if(els.createClose)els.createClose.addEventListener('click',closeCreateTournament);
    if($('tournamentCreateClose2'))$('tournamentCreateClose2').addEventListener('click',closeCreateTournament);
    if(els.createBackdrop)els.createBackdrop.addEventListener('click',e=>{if(e.target===els.createBackdrop)closeCreateTournament();});
    if(els.createForm)els.createForm.addEventListener('submit',submitCreateTournament);
    if(els.createFormat)els.createFormat.addEventListener('change',updateCreateFormatUI);
    if(els.search)els.search.addEventListener('input',renderTournamentList);
    if(els.formatFilter)els.formatFilter.addEventListener('change',renderTournamentList);
    if(els.playerFilter)els.playerFilter.addEventListener('change',()=>{state.playerFilter=els.playerFilter.value;renderTournamentList();});
    document.addEventListener('click',e=>{
      const nav=e.target.closest('[data-view="tournaments"]');if(nav){e.preventDefault();navigateTournaments();return;}
      const sel=e.target.closest('[data-tournament-select]');if(sel){loadTournament(sel.dataset.tournamentSelect).catch(err=>toast(err.message||'赛事加载失败。','error'));return;}
      const save=e.target.closest('[data-save-tm]');if(save){saveResult(save.dataset.saveTm);return;}
      const clear=e.target.closest('[data-clear-tm]');if(clear){if(confirm('确定清除本场结果吗？对应积分比赛会被撤销，系统会重新计算排行榜。'))saveResult(clear.dataset.clearTm,true);return;}
      const status=e.target.closest('[data-tour-status]');if(status){if(confirm(`确定${status.dataset.tourStatus==='completed'?'结束':'取消'}该赛事吗？`))setStatus(state.selectedId,status.dataset.tourStatus);return;}
      const del=e.target.closest('[data-delete-tournament]');if(del){deleteTournament();return;}
      const gg=e.target.closest('[data-generate-groups]');if(gg&&!gg.disabled){generateGroupMatches();return;}
      const gk=e.target.closest('[data-generate-knockout]');if(gk){generateKnockoutFramework();return;}
      const bye=e.target.closest('[data-manual-bye]');if(bye){if(confirm('确定将本场设置为轮空并手动推进吗？'))manualBye(bye.dataset.manualBye);return;}
      const pt=e.target.closest('[data-player-tournaments]');if(pt){state.playerFilter=pt.dataset.playerTournaments;if(els.playerFilter)els.playerFilter.value=pt.dataset.playerTournaments;navigateTournaments();return;}
    });
    document.addEventListener('change',e=>{
      const slot=e.target.closest('[data-tm-slot]');if(slot)setSlot(slot.dataset.tmSlot,slot.value);
      const group=e.target.closest('[data-entry-group]');if(group){
        const playerId=group.dataset.entryGroup;
        const entry=state.entries.find(x=>x.player_id===playerId);
        const slotEl=document.querySelector(`[data-entry-slot="${playerId}"]`);
        if(slotEl)slotEl.disabled=!group.value;
        if(entry) setEntryPlacement(playerId,group.value,group.value ? null : null);
      }
      const entrySlot=e.target.closest('[data-entry-slot]');if(entrySlot){
        const playerId=entrySlot.dataset.entrySlot;
        const groupEl=document.querySelector(`[data-entry-group="${playerId}"]`);
        setEntryPlacement(playerId,groupEl?.value||null,entrySlot.value||null);
      }
    });
    window.addEventListener('cyez-tournament-refresh',()=>refreshTournaments().catch(e=>toast(e.message||'赛事加载失败。','error')));
  }

  function renderConfig(){if(els.detail)els.detail.innerHTML='<div class="card config-warning"><strong>赛事系统尚未连接 Supabase。</strong><span>请先填写 supabase-config.js，并执行 tournament-migration.sql。</span></div>';}

  async function init(){
    if(!els.view)return;
    bind();
    if(!client){renderConfig();return;}
    try{await refreshProfile();updateStaffButton();renderCreatePlayers();await refreshTournaments();
      state.realtime=client.channel('cyez-tournaments-live').on('postgres_changes',{event:'*',schema:'public',table:'tournaments'},()=>refreshTournaments().catch(console.error)).on('postgres_changes',{event:'*',schema:'public',table:'tournament_entries'},()=>refreshTournaments(state.selectedId).catch(console.error)).on('postgres_changes',{event:'*',schema:'public',table:'tournament_matches'},()=>refreshTournaments(state.selectedId).catch(console.error)).subscribe();
      client.auth.onAuthStateChange(async()=>{try{await refreshProfile();updateStaffButton();renderCreatePlayers();renderTournamentList();renderTournamentDetail();}catch(e){console.error(e);}});
    }catch(e){toast(e.message||'赛事系统加载失败。','error');}
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
