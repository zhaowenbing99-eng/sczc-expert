/* ══════════════════════════════════════════════════════════════
   四川政府采购评审专家 · 考前一站式冲刺
   纯前端单文件应用：无依赖、无网络、localStorage 持久化
   ══════════════════════════════════════════════════════════════ */
(() => {
'use strict';

const DB = window.DB || { kps: [], questions: [], chapters: [], numbers: [], confusions: [], laws: [], plan: [], meta: {} };
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const shuffle = (a) => { const r = a.slice(); for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [r[i], r[j]] = [r[j], r[i]]; } return r; };
const pad2 = (n) => String(n).padStart(2, '0');
const fmtTime = (s) => `${pad2(Math.floor(s / 60))}:${pad2(s % 60)}`;

/* ═══════════ 索引 ═══════════ */
const CH = new Map(DB.chapters.map((c) => [c.id, c]));
const KP = new Map(DB.kps.map((k) => [k.id, k]));
const Q = new Map(DB.questions.map((q) => [q.id, q]));
const chapOrder = DB.chapters.map((c) => c.id);
// 构建期已折叠跨块重复考点（dup=true），学习流只看正本
const KPS = DB.kps.filter((k) => !k.dup);
const byChap = new Map(chapOrder.map((id) => [id, { kps: [], qs: [] }]));
KPS.forEach((k) => { (byChap.get(k.chapter) || byChap.get('C13')).kps.push(k); });
DB.questions.forEach((q) => { (byChap.get(q.chapter) || byChap.get('C13')).qs.push(q); });
const chColor = (id) => (CH.get(id) || {}).color || 'var(--accent)';
const chName = (id) => (CH.get(id) || {}).name || id;

/* ═══════════ 状态 ═══════════ */
const LS = 'sczc_expert_v1';
const DEF = { view: 'dash', theme: 'light', prog: {}, wrong: {}, star: {}, exams: [], seen: {} };
let state = Object.assign({}, DEF);

function load() {
  try {
    const raw = localStorage.getItem(LS);
    if (raw) state = Object.assign({}, DEF, JSON.parse(raw));
  } catch (e) { /* 忽略损坏数据 */ }
  state.prog = state.prog || {};
  state.wrong = state.wrong || {};
  state.star = state.star || {};
  state.exams = state.exams || [];
  state.seen = state.seen || {};
}
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(LS, JSON.stringify(state)); } catch (e) { /* 配额满 */ }
  }, 180);
}

/* 纯运行时 UI 状态（不持久化） */
const ui = {
  learnQueue: null, learnIdx: 0,
  flashQueue: null, flashIdx: 0, flashFlipped: false,
  quiz: null, exam: null,
  filters: { chapter: 'all', onlyNew: false, onlyRed: false, onlyStar: false, onlyOfficial: false },
  searchSel: 0,
};

/* ═══════════ 进度统计 ═══════════ */
const progOf = (id) => state.prog[id] || 0;          // 0 未学 1 模糊 2 掌握
const masteredCount = () => KPS.filter((k) => progOf(k.id) === 2).length;
const touchedCount = () => KPS.filter((k) => progOf(k.id) > 0).length;
const overallPct = () => KPS.length ? Math.round(masteredCount() / KPS.length * 100) : 0;
const wrongIds = () => Object.keys(state.wrong).filter((id) => Q.has(id));

function chapStat(id) {
  const list = (byChap.get(id) || { kps: [] }).kps;
  const m = list.filter((k) => progOf(k.id) === 2).length;
  const t = list.filter((k) => progOf(k.id) > 0).length;
  return { total: list.length, mastered: m, touched: t, pct: list.length ? Math.round(m / list.length * 100) : 0 };
}

/* ═══════════ 通用 UI ═══════════ */
function toast(msg, ms = 1800) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), ms);
}
function modal(html) {
  $('#modalBox').innerHTML = html;
  $('#modal').hidden = false;
}
function closeModal() { $('#modal').hidden = true; }
$('#modal')?.addEventListener('click', (e) => { if (e.target.dataset.close !== undefined) closeModal(); });

function hlBadge(hl) {
  if (hl === 'R') return '<span class="hl-dot R" title="教材红字标注：必背原文关键词">红字重点</span>';
  if (hl === 'B') return '<span class="hl-dot B" title="教材蓝字标注：重点句">蓝字重点</span>';
  return '';
}
function starStr(n) { return '★'.repeat(n) + '☆'.repeat(5 - n); }

/* ═══════════ 路由 ═══════════ */
const VIEWS = {
  dash: renderDash, learn: renderLearn, flash: renderFlash, numbers: renderNumbers,
  confuse: renderConfuse, quiz: renderQuiz, exam: renderExam, wrong: renderWrong, laws: renderLaws,
};
const VIEW_NAME = {
  dash: '总览', learn: '考点卡片', flash: '闪卡自测', numbers: '数字速记',
  confuse: '易混辨析', quiz: '刷题', exam: '模拟考', wrong: '错题本', laws: '法规速查',
};

function go(view) {
  if (!VIEWS[view]) view = 'dash';
  state.view = view; save();
  $$('.nav-item').forEach((b) => b.classList.toggle('on', b.dataset.view === view));
  syncTabbar(view);
  $('#crumbs').innerHTML = `<b>${esc(VIEW_NAME[view])}</b>`;
  render();
  $('#view').scrollTop = 0;
  $('#rail').classList.remove('open');
}

function render() {
  const fn = VIEWS[state.view] || renderDash;
  $('#view').innerHTML = fn();
  bindView();
  syncRail();
}

const TAB_VIEWS = ['dash', 'learn', 'quiz', 'numbers'];
const MORE_VIEWS = [
  { v: 'flash', n: '闪卡自测', d: '只给标题回忆答案，翻面自评' },
  { v: 'confuse', n: '易混辨析', d: '26 组对比，专治多选第二个干扰项' },
  { v: 'exam', n: '模拟考', d: '90 分钟 / 100 分 / 60 分合格' },
  { v: 'wrong', n: '错题本', d: '答错的题自动收集' },
  { v: 'laws', n: '法规速查', d: '49 部法规与考点索引' },
];
function syncTabbar(view) {
  const bar = $('#tabbar'); if (!bar) return;
  const inTab = TAB_VIEWS.includes(view);
  $$('button', bar).forEach((b) => {
    b.classList.toggle('on', inTab && b.dataset.view === view);
    if (b.dataset.more && !inTab) b.classList.add('on');
  });
  if (view === 'wrong') {
    const wc = wrongIds().length;
    let badge = $('#tabWrong');
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'badge'; badge.id = 'tabWrong';
      const moreBtn = $('button[data-more]', bar);
      moreBtn.appendChild(badge);
    }
    badge.textContent = wc; badge.classList.toggle('show', wc > 0);
  }
}

function syncRail() {
  const pct = overallPct();
  const mr = $('#mRatio'); if (mr) mr.textContent = pct + '%';
  $('#railPct').textContent = pct + '%';
  $('#railBar').style.width = pct + '%';
  $('#railSub').textContent = `${masteredCount()} / ${KPS.length} 考点已掌握`;
  const wc = wrongIds().length;
  const b = $('#wrongCount');
  if (b) { b.textContent = wc; b.classList.toggle('show', wc > 0); }
}

/* ═══════════════════════════════════════════════════
   总览
   ═══════════════════════════════════════════════════ */
function renderDash() {
  const meta = DB.meta || {};
  const kpN = KPS.length, qN = DB.questions.length;
  const mastered = masteredCount(), pct = overallPct();
  const last = state.exams[state.exams.length - 1];
  const todayPlan = buildPlan();

  return `<div class="wrap">
    <div class="hero">
      <h1>把 550 页培训资料压成一张能带进考场的脑图</h1>
      <p>全库已拆成 ${kpN} 个可独立作答的考点、${qN} 道题、${DB.numbers.length} 个数字点。红字＝教材原文必背关键词，蓝字＝配套重点句。先刷卡片建立框架，再用数字表和易混辨析补刀，最后两轮模拟考定分数。</p>
      <div class="hero-stats">
        <div class="hero-stat"><b>${mastered}<span style="font-size:14px;opacity:.6">/${kpN}</span></b><span>已掌握考点</span></div>
        <div class="hero-stat"><b>${pct}%</b><span>总掌握度</span></div>
        <div class="hero-stat"><b>${qN}</b><span>题库总量</span></div>
        <div class="hero-stat"><b>${last ? last.score : '—'}</b><span>最近模考得分</span></div>
      </div>
      <div class="hero-cta">
        <button class="btn solid-white lg" data-act="start-learn">▶ 开始学考点</button>
        <button class="btn lg" data-act="start-exam">⏱ 直接模拟考</button>
        <button class="btn lg" data-act="start-quiz">✎ 刷 20 题</button>
        <button class="btn lg" data-act="print-manual">🖨 导出速记手册</button>
      </div>
    </div>

    <div class="grid4">
      <div class="card stat-card"><div class="k">考点总数</div><div class="v">${kpN}</div><div class="s">${touchedCount()} 个已开始</div></div>
      <div class="card stat-card"><div class="k">题目总数</div><div class="v">${qN}</div><div class="s">单选 ${DB.stats.byType.single} · 多选 ${DB.stats.byType.multi} · 判断 ${DB.stats.byType.judge} · 案例 ${DB.stats.byType.case}</div></div>
      <div class="card stat-card"><div class="k">数字考点</div><div class="v">${DB.numbers.length}</div><div class="s">时限 · 比例 · 金额 · 人数</div></div>
      <div class="card stat-card"><div class="k">错题待清</div><div class="v" style="color:${wrongIds().length ? 'var(--red)' : 'inherit'}">${wrongIds().length}</div><div class="s">易混 ${DB.confusions.length} 组</div></div>
    </div>

    <div class="section-head"><h2>${escape(meta.examDurationMin || 90)} 分钟冲刺路线</h2><span class="hint">按下面的顺序走，比从头读到尾快 3 倍</span></div>
    <div class="card pad" style="padding:0;overflow:hidden">
      <div class="plan-list">
        ${todayPlan.map((d, i) => `<div class="plan-day" style="border-bottom:1px solid var(--line-2)">
          <div class="plan-idx">${d.step}</div>
          <div class="plan-body"><strong>${esc(d.title)}</strong><span>${esc(d.desc)}</span></div>
          <div class="plan-load">${esc(d.load)}</div>
        </div>`).join('')}
      </div>
    </div>

    <div class="section-head"><h2>章节地图</h2><span class="hint">点任一章进入该章卡片</span></div>
    <div class="chapter-matrix">
      ${DB.chapters.map((c) => {
        const s = chapStat(c.id);
        return `<div class="card chap-card" data-chapter="${c.id}" style="--cc:${c.color}">
          <div class="cn">${esc(c.name)}<span class="cid">${c.id}</span></div>
          <div class="cdesc">${esc(c.desc || '')}</div>
          <div class="cbar"><i style="width:${s.pct}%"></i></div>
          <div class="cmeta"><span>${s.mastered}/${s.total} 掌握</span><span>${(byChap.get(c.id) || {}).qs?.length || 0} 题</span></div>
        </div>`;
      }).join('')}
    </div>

    ${renderExamHistory()}
  </div>`;
}
function escape(s) { return esc(s == null ? '' : s); }

function renderExamHistory() {
  if (!state.exams.length) return '';
  return `<div class="section-head"><h2>模考记录</h2><span class="hint">最近 ${Math.min(5, state.exams.length)} 次</span></div>
    <div class="card" style="overflow:hidden">
      ${state.exams.slice(-5).reverse().map((e) => `<div class="list-item" data-act="exam-detail" data-i="${state.exams.indexOf(e)}">
        <div class="li-main"><div class="t">${e.score} 分 · ${e.pass ? '<span class="pass">合格</span>' : '<span class="fail">未达标</span>'}</div>
        <div class="s">${new Date(e.ts).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })} · 用时 ${fmtTime(e.used || 0)} · 答对 ${e.correct}/${e.total}</div></div>
        <div style="font-size:20px;font-weight:700" class="${e.pass ? 'pass' : 'fail'}">${e.score}</div>
      </div>`).join('')}
    </div>`;
}

function buildPlan() {
  const redN = KPS.filter((k) => k.hl === 'R').length;
  if (DB.plan && DB.plan.length) {
    return DB.plan.map((d) => ({ step: d.step, title: d.title, desc: d.desc, load: d.load }));
  }
  const steps = [
    { step: '1', title: '考点卡片过一遍（不求记住）', desc: '一章一章往下翻，会就点「掌握」，不会点「不会」。目标是建立坐标系，不是背。', load: `${KPS.length} 张卡 · 约 90 分钟` },
    { step: '2', title: '红字重点 + 数字速记（背这两张表）', desc: `红字 ${redN} 条是出题人挖空的词；数字考点 ${DB.numbers.length} 条几乎每次都考，用遮罩模式自测。`, load: '约 40 分钟' },
    { step: '3', title: '易混辨析（专治选择题第二选项）', desc: '公开/邀请招标、废标/终止、谈判/磋商、74/87/214 号令——每组只用记一句差异。', load: `${DB.confusions.length} 组 · 约 25 分钟` },
    { step: '4', title: '刷题 + 错题本（只做错的）', desc: '先按章节刷，错题自动进本；第二遍只做错题，直到全对。', load: `${DB.questions.length} 题` },
    { step: '5', title: '模拟考 ×2（90 分钟 / 100 分 / 60 分合格）', desc: '第一轮找薄弱章，回去补卡片；第二轮只看错题与红字。', load: '各 90 分钟' },
  ];
  return steps;
}

/* ═══════════════════════════════════════════════════
   考点卡片
   ═══════════════════════════════════════════════════ */
function buildLearnQueue() {
  const f = ui.filters;
  let list = KPS.slice();
  if (f.chapter !== 'all') list = list.filter((k) => k.chapter === f.chapter);
  if (f.onlyNew) list = list.filter((k) => progOf(k.id) !== 2);
  if (f.onlyRed) list = list.filter((k) => k.hl === 'R');
  if (f.onlyStar) list = list.filter((k) => state.star[k.id]);
  if (f.onlyOfficial) list = list.filter((k) => (k.tags || []).includes('官方教材2026'));
  // 排序：未学优先 → 模糊 → 掌握；同组内按 star 降序、章节序
  const rank = (k) => (progOf(k.id) === 0 ? 0 : progOf(k.id) === 1 ? 1 : 2);
  const ci = (k) => chapOrder.indexOf(k.chapter);
  list.sort((a, b) => rank(a) - rank(b) || (b.star - a.star) || (ci(a) - ci(b)));
  return list;
}

function renderLearn() {
  if (!ui.learnQueue) ui.learnQueue = buildLearnQueue();
  const q = ui.learnQueue;
  if (!q.length) {
    return `<div class="wrap"><div class="empty"><div class="ico">✓</div>
      <h3>这个筛选条件下没有考点了</h3><p>换个章节，或关掉筛选开关。</p>
      <button class="btn" data-act="reset-filter" style="margin-top:14px">清除筛选</button></div></div>`;
  }
  ui.learnIdx = clamp(ui.learnIdx, 0, q.length - 1);
  const k = q[ui.learnIdx];
  const p = progOf(k.id);
  const c = CH.get(k.chapter) || {};
  const idx = KPS.indexOf(k) + 1;

  return `<div class="wrap">
    <div class="learn-bar">
      <div class="row wrap" style="gap:6px">
        <button class="chip chip-btn ${ui.filters.chapter === 'all' ? 'on' : ''}" data-act="filter-ch" data-ch="all">全部章节</button>
        ${DB.chapters.map((c2) => `<button class="chip chip-btn ${ui.filters.chapter === c2.id ? 'on' : ''}" data-act="filter-ch" data-ch="${c2.id}">${esc(c2.short || c2.name)}</button>`).join('')}
      </div>
      <div class="spacer"></div>
      <button class="chip chip-btn ${ui.filters.onlyNew ? 'on' : ''}" data-act="toggle-new">未掌握</button>
      <button class="chip chip-btn ${ui.filters.onlyRed ? 'on' : ''}" data-act="toggle-red">只看红字</button>
      <button class="chip chip-btn ${ui.filters.onlyStar ? 'on' : ''}" data-act="toggle-star">★ 收藏</button>
      <button class="chip chip-btn ${ui.filters.onlyOfficial ? 'on' : ''}" data-act="toggle-official" title="只显示来自官方 2026 版培训资料的新增考点">官方2026</button>
      <div class="learn-progress"><div class="lp-track"><i style="width:${(ui.learnIdx + 1) / q.length * 100}%"></i></div><span>${ui.learnIdx + 1}/${q.length}</span></div>
    </div>

    <div class="card kp-card" style="--cc:${c.color}">
      <div class="kp-top">
        <span class="chip solid" style="background:${c.color}">${esc(c.name)}</span>
        ${hlBadge(k.hl)}
        <span class="chip dot" title="重要度">${starStr(k.star)}</span>
        ${(k.tags || []).map((t) => `<span class="chip">${esc(t)}</span>`).join('')}
        <div class="spacer"></div>
        <button class="btn sm ghost" data-act="star-kp" title="收藏">${state.star[k.id] ? '★ 已收藏' : '☆ 收藏'}</button>
        <span class="tiny muted">全库第 ${idx} / ${KPS.length} 条</span>
      </div>

      <h2 class="kp-topic">${esc(k.topic)}</h2>
      <div class="kp-core">${emph(k.core)}</div>
      ${k.detail ? `<div class="kp-detail">${emph(k.detail)}</div>` : ''}

      ${(k.bullets || []).length ? `<div class="kp-sec"><div class="kp-sec-t">要点</div>
        <ul class="dots">${k.bullets.map((b) => `<li>${emph(b)}</li>`).join('')}</ul></div>` : ''}

      ${(k.numbers || []).length ? `<div class="kp-sec"><div class="kp-sec-t">必须记住的数字</div>
        <div class="num-list">${k.numbers.map((n) => `<div class="num-pill"><span>${esc(n.k)}</span><b>${esc(n.v)}</b></div>`).join('')}</div></div>` : ''}

      ${k.mnemonic ? `<div class="mnemo">🧠 <b>口诀</b>　${esc(k.mnemonic)}</div>` : ''}
      ${k.trap ? `<div class="trap-box">⚠ ${emph(k.trap)}</div>` : ''}
      <div class="cite">📖 ${esc(k.cite)}</div>

      <div class="rate-bar">
        <button class="rate-btn ${p === 0 ? 'on' : ''}" data-act="rate" data-r="0">不会 <kbd>1</kbd></button>
        <button class="rate-btn ${p === 1 ? 'on' : ''}" data-act="rate" data-r="1">模糊 <kbd>2</kbd></button>
        <button class="rate-btn ${p === 2 ? 'on' : ''}" data-act="rate" data-r="2">掌握 <kbd>3</kbd></button>
      </div>
    </div>

    <div class="learn-nav">
      <button class="btn" data-act="prev-kp">← 上一张</button>
      <button class="btn ghost sm" data-act="random-kp">随机</button>
      <button class="btn primary" data-act="next-kp">下一张 →</button>
    </div>
  </div>`;
}

/* 把正文中的数字与「应当/不得/必须」高亮，便于扫读 */
function emph(txt) {
  let s = esc(txt);
  // 轻量 markdown：**粗体** / *斜体*
  s = s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  s = s.replace(/【(.*?)】/g, '<b>$1</b>');
  s = s.replace(/(\d+(?:\.\d+)?\s*(?:%|％|个工作日|工作日|日|天|年|个月|人|家|万元|元|倍))/g,
    '<b class="num">$1</b>');
  return s;
}

/* ═══════════════════════════════════════════════════
   闪卡
   ═══════════════════════════════════════════════════ */
function buildFlashQueue() {
  let list = KPS.filter((k) => progOf(k.id) !== 2 || k.star >= 5);
  if (ui.filters.chapter !== 'all') list = list.filter((k) => k.chapter === ui.filters.chapter);
  // 加权：未学/模糊优先，红字优先，重要度高的优先
  const w = (k) => (progOf(k.id) === 0 ? 3 : progOf(k.id) === 1 ? 2 : 0) + (k.hl === 'R' ? 1.5 : 0) + k.star * 0.3;
  return list.sort((a, b) => w(b) - w(a));
}

function renderFlash() {
  if (!ui.flashQueue) ui.flashQueue = buildFlashQueue();
  const q = ui.flashQueue;
  if (!q.length) return `<div class="wrap"><div class="empty"><div class="ico">✓</div><h3>全部考点都已掌握</h3>
    <p>可以去做模拟考检验了。</p><button class="btn primary" data-act="start-exam" style="margin-top:14px">进入模拟考</button></div></div>`;
  ui.flashIdx = clamp(ui.flashIdx, 0, q.length - 1);
  const k = q[ui.flashIdx];
  const c = CH.get(k.chapter) || {};
  const flipped = ui.flashFlipped;

  return `<div class="wrap"><div class="flash-stage">
    <div class="row" style="width:100%;max-width:640px;margin-bottom:14px">
      <span class="chip solid" style="background:${c.color}">${esc(c.name)}</span>
      ${hlBadge(k.hl)}
      <div class="spacer"></div>
      <span class="tiny muted">${ui.flashIdx + 1} / ${q.length}</span>
    </div>

    <div class="flash-card card ${flipped ? 'flipped' : ''}" data-act="flip" style="--cc:${c.color}">
      ${flipped ? `<div class="fc-a">
          <span class="chip" style="margin-bottom:10px">答案</span>
          <div>${emph(k.core)}</div>
          ${(k.numbers || []).length ? `<div class="num-list" style="margin-top:14px">${k.numbers.map((n) => `<div class="num-pill"><span>${esc(n.k)}</span><b>${esc(n.v)}</b></div>`).join('')}</div>` : ''}
          ${k.trap ? `<div class="trap-box" style="margin-top:14px;font-size:12.5px">⚠ ${esc(k.trap)}</div>` : ''}
          <div class="cite" style="margin-top:12px">${esc(k.cite)}</div>
        </div>`
      : `<div class="fc-q">${esc(k.topic)}</div>
         <div class="fc-hint">先在心里说一遍答案，轻点卡片翻面<br><span style="opacity:.7">（左右滑动可切换 · 电脑按空格）</span></div>`}
    </div>

    ${flipped ? `<div class="flash-rate">
        <button class="btn" style="flex:1;background:var(--red-soft);border-color:var(--red);color:var(--red)" data-act="flash-rate" data-r="0">忘了</button>
        <button class="btn" style="flex:1;background:var(--amber-soft);border-color:var(--amber);color:var(--amber)" data-act="flash-rate" data-r="1">勉强</button>
        <button class="btn" style="flex:1;background:var(--green-soft);border-color:var(--green);color:var(--green)" data-act="flash-rate" data-r="2">记得</button>
      </div>` : `<div class="flash-nav">
        <button class="btn" data-act="flash-prev">← 上一张</button>
        <button class="btn primary" data-act="flip">翻面 <kbd style="opacity:.6;font-size:10px">空格</kbd></button>
        <button class="btn ghost" data-act="flash-skip">跳过 →</button>
      </div>`}
  </div></div>`;
}

/* ═══════════════════════════════════════════════════
   数字速记
   ═══════════════════════════════════════════════════ */
const NUMCATS = [
  { id: 'time', name: '时限/期限', re: /(工作日|期限|时限|日内|日起|个月|天|年|小时)/ },
  { id: 'ratio', name: '比例/百分比', re: /(％|%|比例|分之|比重|份额|优惠)/ },
  { id: 'money', name: '金额/罚款', re: /(元|万元|亿|罚款|金额|预算)/ },
  { id: 'people', name: '人数/家数', re: /(人|家|名|单数)/ },
  { id: 'other', name: '其他', re: /./ },
];
function numCat(n) {
  const s = (n.k + ' ' + n.v);
  for (const c of NUMCATS) if (c.re.test(s)) return c.id;
  return 'other';
}
let numFilter = { q: '', cat: 'all', ch: 'all', masked: false };

function renderNumbers() {
  let list = DB.numbers.slice();
  if (numFilter.cat !== 'all') list = list.filter((n) => numCat(n) === numFilter.cat);
  if (numFilter.ch !== 'all') list = list.filter((n) => n.chapter === numFilter.ch);
  if (numFilter.q) {
    const q = numFilter.q.toLowerCase();
    list = list.filter((n) => (n.k + n.v + n.topic + n.cite).toLowerCase().includes(q));
  }
  const cnt = {};
  DB.numbers.forEach((n) => { const c = numCat(n); cnt[c] = (cnt[c] || 0) + 1; });

  return `<div class="wrap wide">
    <div class="card pad" style="margin-bottom:16px">
      <div class="row wrap" style="justify-content:space-between">
        <div><h2 style="font-size:16px;margin-bottom:4px">数字考点总表 · ${DB.numbers.length} 条</h2>
        <p class="tiny muted">考试里 90% 的送分题和 90% 的失分题都在这一页。开「遮罩自测」，逐个点开。</p></div>
        <button class="btn ${numFilter.masked ? 'primary' : ''}" data-act="toggle-mask">${numFilter.masked ? '✓ 遮罩中' : '遮罩自测'}</button>
      </div>
    </div>

    <div class="numtool">
      <button class="chip chip-btn ${numFilter.cat === 'all' ? 'on' : ''}" data-act="num-cat" data-c="all">全部 ${DB.numbers.length}</button>
      ${NUMCATS.map((c) => `<button class="chip chip-btn ${numFilter.cat === c.id ? 'on' : ''}" data-act="num-cat" data-c="${c.id}">${c.name} ${cnt[c.id] || 0}</button>`).join('')}
      <div class="spacer"></div>
      <select id="numCh" class="btn sm" style="height:30px">
        <option value="all">全部章节</option>
        ${DB.chapters.map((c) => `<option value="${c.id}" ${numFilter.ch === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
      </select>
      <input id="numQ" class="btn sm" style="height:30px;width:170px;cursor:text" placeholder="搜索关键词…" value="${esc(numFilter.q)}">
    </div>

    <div class="card" style="overflow:hidden">
      <table class="numtable ${numFilter.masked ? 'masked' : ''}">
        <thead><tr><th class="nk">考点</th><th class="nv">答案</th><th class="nc">出处</th></tr></thead>
        <tbody>
        ${list.length ? list.map((n) => `<tr data-act="reveal">
          <td class="nk"><span class="chip dot" style="background:${chColor(n.chapter)}22;color:${chColor(n.chapter)}">${esc((CH.get(n.chapter) || {}).short || n.chapter)}</span> ${esc(n.k)}</td>
          <td class="nv">${esc(n.v)}</td>
          <td class="nc">${esc(n.cite || '')}</td>
        </tr>`).join('') : `<tr><td colspan="3" style="text-align:center;padding:40px;color:var(--ink-3)">没有匹配的数字考点</td></tr>`}
        </tbody>
      </table>
    </div>
  </div>`;
}

/* ═══════════════════════════════════════════════════
   易混辨析
   ═══════════════════════════════════════════════════ */
let confuseFilter = 'all';
function renderConfuse() {
  const list = DB.confusions.filter((x) => confuseFilter === 'all' || x.chapter === confuseFilter);
  return `<div class="wrap wide">
    <div class="card pad" style="margin-bottom:16px">
      <h2 style="font-size:16px;margin-bottom:4px">易混对比 · ${DB.confusions.length} 组</h2>
      <p class="tiny muted">多选题的第二个错误选项，几乎全出自这里。每组只记「差异一句」。</p>
    </div>
    <div class="numtool">
      <button class="chip chip-btn ${confuseFilter === 'all' ? 'on' : ''}" data-act="conf-cat" data-c="all">全部</button>
      ${DB.chapters.filter((c) => DB.confusions.some((x) => x.chapter === c.id)).map((c) =>
        `<button class="chip chip-btn ${confuseFilter === c.id ? 'on' : ''}" data-act="conf-cat" data-c="${c.id}">${esc(c.short || c.name)}</button>`).join('')}
    </div>
    ${list.length ? `<div class="confuse-grid">
      ${list.map((x) => `<div class="card vs-card">
        <div class="vs-head"><span class="chip solid" style="background:${chColor(x.chapter)}">${esc((CH.get(x.chapter) || {}).short || '')}</span><h3>${esc(x.title)}</h3></div>
        <div class="vs-body">
          <div class="vs-side"><b>${esc(x.left.name)}</b>${(x.left.points || []).map((p) => `<div>· ${emph(p)}</div>`).join('')}</div>
          <div class="vs-side"><b>${esc(x.right.name)}</b>${(x.right.points || []).map((p) => `<div>· ${emph(p)}</div>`).join('')}</div>
        </div>
        <div class="vs-foot"><b>只记这句：</b>${emph(x.key || '')}${x.cite ? `<span class="muted">　（${esc(x.cite)}）</span>` : ''}</div>
      </div>`).join('')}
    </div>` : `<div class="empty"><div class="ico">⇄</div><h3>暂无易混对比数据</h3></div>`}
  </div>`;
}

/* ═══════════════════════════════════════════════════
   刷题
   ═══════════════════════════════════════════════════ */
const TYPE_NAME = { single: '单选', multi: '多选', judge: '判断', case: '案例' };

function renderQuiz() {
  if (ui.quiz && ui.quiz.phase === 'run') return renderQuizRun();
  if (ui.quiz && ui.quiz.phase === 'done') return renderQuizDone();
  return renderQuizSetup();
}

function renderQuizSetup() {
  const wrongN = wrongIds().length;
  const poolN = buildQuizPool().length;
  return `<div class="wrap">
    <div class="card exam-setup">
      <h2 style="font-size:19px;margin-bottom:6px">刷题</h2>
      <p class="muted tiny">选好范围就开始，答错自动进错题本。</p>

      <div class="section-head" style="margin:22px 0 10px"><h2 style="font-size:13px;color:var(--ink-3)">章节范围（可多选）</h2></div>
      <div class="row wrap" style="gap:7px">
        <button class="chip chip-btn ${quizCfg.chapters.includes('all') ? 'on' : ''}" data-act="quiz-ch" data-ch="all">全部章节</button>
        ${DB.chapters.map((c) => `<button class="chip chip-btn ${quizCfg.chapters.includes(c.id) ? 'on' : ''}" data-act="quiz-ch" data-ch="${c.id}">${esc(c.name)} <span class="muted" style="opacity:.6">${(byChap.get(c.id) || {}).qs?.length || 0}</span></button>`).join('')}
      </div>

      <div class="section-head" style="margin:22px 0 10px"><h2 style="font-size:13px;color:var(--ink-3)">题型</h2></div>
      <div class="row wrap" style="gap:7px">
        ${Object.keys(TYPE_NAME).map((t) => `<button class="chip chip-btn ${quizCfg.types.includes(t) ? 'on' : ''}" data-act="quiz-type" data-t="${t}">${TYPE_NAME[t]} <span class="muted" style="opacity:.6">${DB.questions.filter((q) => q.type === t).length}</span></button>`).join('')}
      </div>

      <div class="section-head" style="margin:22px 0 10px"><h2 style="font-size:13px;color:var(--ink-3)">题量与模式</h2></div>
      <div class="row wrap" style="gap:7px">
        ${[10, 20, 40, 0].map((n) => `<button class="chip chip-btn ${quizCfg.n === n ? 'on' : ''}" data-act="quiz-n" data-n="${n}">${n === 0 ? '全部' : n + ' 题'}</button>`).join('')}
        <span style="width:14px"></span>
        <button class="chip chip-btn ${quizCfg.wrongOnly ? 'on' : ''}" data-act="quiz-wrong">只做错题（${wrongN}）</button>
        <button class="chip chip-btn ${quizCfg.shuffle ? 'on' : ''}" data-act="quiz-shuffle-on">乱序 ${quizCfg.shuffle ? '✓' : '✗'}</button>
      </div>

      <div class="row" style="margin-top:26px;gap:14px">
        <button class="btn primary lg" data-act="quiz-start" ${poolN ? '' : 'disabled'}>开始刷题</button>
        <span class="tiny muted">按当前条件将出 <b>${poolN}</b> 题</span>
      </div>
    </div>
    ${renderLawsTeaser()}
  </div>`;
}

function renderLawsTeaser() {
  return `<div class="card pad" style="margin-top:16px">
    <h3 style="font-size:13.5px;margin-bottom:8px">这份题库覆盖的法规</h3>
    <div class="row wrap" style="gap:6px">${DB.laws.slice(0, 30).map((l) => `<span class="chip">${esc(l.short || l.name)}</span>`).join('') || '<span class="tiny muted">见「法规速查」</span>'}</div>
  </div>`;
}

let quizCfg = { chapters: ['all'], types: ['single', 'multi', 'judge'], n: 10, wrongOnly: false, shuffle: true };

function buildQuizPool() {
  let pool = DB.questions.slice();
  if (quizCfg.wrongOnly) { const w = new Set(wrongIds()); pool = pool.filter((q) => w.has(q.id)); }
  if (!quizCfg.chapters.includes('all')) { const s = new Set(quizCfg.chapters); pool = pool.filter((q) => s.has(q.chapter)); }
  const ts = new Set(quizCfg.types); pool = pool.filter((q) => ts.has(q.type));
  if (quizCfg.shuffle) pool = shuffle(pool);
  if (quizCfg.n > 0) pool = pool.slice(0, quizCfg.n);
  return pool;
}

function startQuiz(list, label) {
  if (!list.length) { toast('这个条件下没有题目，换个范围试试'); return; }
  ui.quiz = { phase: 'run', list, i: 0, ans: new Array(list.length).fill(null), judged: new Array(list.length).fill(false), right: 0, label, ts: Date.now() };
  go('quiz');
}

function renderQuizRun() {
  const s = ui.quiz, q = s.list[s.i];
  const sel = s.ans[s.i], judged = s.judged[s.i];
  const isMulti = q.type === 'multi';
  const correct = q.answer || [];

  return `<div class="wrap">
    <div class="quiz-head">
      <span class="chip solid" style="background:${chColor(q.chapter)}">${esc(chName(q.chapter))}</span>
      <span class="q-type ${q.type}">${TYPE_NAME[q.type]}</span>
      <div class="q-progress-track"><i style="width:${(s.i + 1) / s.list.length * 100}%"></i></div>
      <span class="q-counter">${s.i + 1} / ${s.list.length}　正确 ${s.right}</span>
      <button class="btn sm ghost" data-act="quiz-exit">退出</button>
    </div>

    <div class="card q-card">
      <div class="q-stem">${esc(q.stem)}</div>
      <div class="q-opts">
        ${q.options.map((o, oi) => {
          let cls = 'opt';
          if (!judged && sel && sel.includes(oi)) cls += ' sel';
          if (judged) {
            cls += ' locked';
            if (correct.includes(oi)) cls += ' right';
            else if (sel && sel.includes(oi)) cls += ' wrong';
          }
          return `<div class="${cls}" data-act="pick" data-i="${oi}">
            <span class="ok">${String.fromCharCode(65 + oi)}</span><span>${esc(o)}</span></div>`;
        }).join('')}
      </div>

      ${judged ? `<div class="explain">
        <div class="verdict ${sel && sameSet(sel, correct) ? 'ok' : 'no'}">
          ${sel && sameSet(sel, correct) ? '✓ 正确' : '✗ 错误'}
          <span class="muted" style="font-weight:400;font-size:12px">正确答案：${correct.map((i) => String.fromCharCode(65 + i)).join('')}</span>
        </div>
        <div>${emph(q.explain)}</div>
        <div class="src">📖 ${esc(q.cite || '')}</div>
      </div>` : ''}

      <div class="q-actions">
        ${!judged
          ? `<button class="btn primary" data-act="submit-q" ${(!sel || !sel.length) ? 'disabled' : ''}>${isMulti ? '提交答案' : '确认'}</button>
             <span class="tiny muted">${isMulti ? '多选题：选全再提交' : '点击选项直接判定'}</span>`
          : `<button class="btn primary" data-act="next-q">${s.i + 1 < s.list.length ? '下一题 →' : '看结果 →'}</button>
             <span class="tiny muted">快捷键：空格</span>`}
        <div class="spacer"></div>
        <button class="btn ghost sm" data-act="prev-q" ${s.i === 0 ? 'disabled' : ''}>← 上一题</button>
      </div>
    </div>
  </div>`;
}
function sameSet(a, b) { if (!a || !b || a.length !== b.length) return false; const x = a.slice().sort(), y = b.slice().sort(); return x.every((v, i) => v === y[i]); }

function renderQuizDone() {
  const s = ui.quiz;
  const total = s.list.length;
  const pct = Math.round(s.right / total * 100);
  const wrongs = s.list.filter((q, i) => !sameSet(s.ans[i], q.answer));
  return `<div class="wrap">
    <div class="card pad">
      <div class="result-score">
        <div class="big ${pct >= 80 ? 'pass' : pct >= 60 ? '' : 'fail'}">${pct}%</div>
        <div class="lbl">本轮 ${total} 题，答对 ${s.right} 题，用时 ${fmtTime(Math.round((Date.now() - s.ts) / 1000))}</div>
      </div>
      <div class="res-grid">
        <div class="card res-item"><b>${s.right}</b><span>答对</span></div>
        <div class="card res-item"><b style="color:var(--red)">${total - s.right}</b><span>答错</span></div>
        <div class="card res-item"><b>${wrongs.length}</b><span>进错题本</span></div>
      </div>
      <div class="row" style="margin-top:20px;justify-content:center;gap:10px">
        <button class="btn primary" data-act="quiz-again">再来一轮</button>
        <button class="btn" data-act="quiz-back">重选范围</button>
        ${wrongs.length ? `<button class="btn danger" data-act="quiz-redo-wrong">只做这 ${wrongs.length} 道错题</button>` : ''}
      </div>
    </div>

    <div class="section-head"><h2>逐题回顾</h2></div>
    <div class="card" style="overflow:hidden">
      ${s.list.map((q, i) => {
        const ok = sameSet(s.ans[i], q.answer);
        return `<div class="list-item" data-act="rev-q" data-i="${i}">
          <span style="width:22px;height:22px;border-radius:6px;display:grid;place-items:center;font-size:11px;font-weight:700;flex:0 0 22px;background:${ok ? 'var(--green-soft)' : 'var(--red-soft)'};color:${ok ? 'var(--green)' : 'var(--red)'}">${ok ? '✓' : '✗'}</span>
          <div class="li-main"><div class="t">${esc(q.stem.slice(0, 52))}${q.stem.length > 52 ? '…' : ''}</div>
          <div class="s">你的答案 ${(s.ans[i] || []).map((x) => String.fromCharCode(65 + x)).join('') || '未答'} ｜ 正确 ${q.answer.map((x) => String.fromCharCode(65 + x)).join('')}</div></div>
          <span class="chip">${TYPE_NAME[q.type]}</span>
        </div>`;
      }).join('')}
    </div>
  </div>`;
}

/* ═══════════════════════════════════════════════════
   模拟考
   ═══════════════════════════════════════════════════ */
const EXAM_SPEC = [
  { type: 'single', n: 55, score: 1 },
  { type: 'multi', n: 10, score: 2 },
  { type: 'judge', n: 10, score: 1 },
  { type: 'case', n: 1, score: 15 },
];

function renderExam() {
  if (ui.exam && ui.exam.phase === 'run') return renderExamRun();
  if (ui.exam && ui.exam.phase === 'done') return renderExamDone();
  const avail = {};
  EXAM_SPEC.forEach((s) => { avail[s.type] = DB.questions.filter((q) => q.type === s.type).length; });
  const totalScore = EXAM_SPEC.reduce((a, s) => a + s.n * s.score, 0);
  const feasible = EXAM_SPEC.every((s) => avail[s.type] >= s.n);

  return `<div class="wrap">
    <div class="card exam-setup">
      <h2 style="font-size:19px;margin-bottom:6px">模拟考</h2>
      <p class="muted tiny">${DB.meta.examDurationMin || 90} 分钟 · 满分 ${DB.meta.examFullScore || 100} 分 · ${DB.meta.passScore || 60} 分合格。交卷后给出逐题解析与薄弱章节建议。</p>

      <div class="res-grid" style="margin-top:22px">
        ${EXAM_SPEC.map((s) => `<div class="card res-item">
          <b>${Math.min(s.n, avail[s.type])}<span style="font-size:12px;color:var(--ink-3)">题</span></b>
          <span>${TYPE_NAME[s.type]} · 每题 ${s.score} 分</span></div>`).join('')}
      </div>
      ${feasible ? '' : `<p class="tiny" style="color:var(--amber);margin-top:14px">⚠ 题库某类题量不足，本次按实际可用题量组卷，得分按百分制折算。</p>`}

      <div class="row" style="margin-top:24px;gap:10px;flex-wrap:wrap">
        <button class="btn primary lg" data-act="exam-start">开始考试（${DB.meta.examDurationMin || 90} 分钟）</button>
        <button class="btn" data-act="exam-practice">练习模式（不计时）</button>
        <span class="tiny muted">提示：考试中可用题号面板跳转、标记疑难题</span>
      </div>
    </div>

    <div class="card pad" style="margin-top:16px">
      <h3 style="font-size:13.5px;margin-bottom:10px">评分规则</h3>
      <table class="kbd-table">
        <tr><td>单选题</td><td>每题 1 分，选错不得分</td></tr>
        <tr><td>多选题</td><td>每题 2 分，<b>多选、少选、错选均不得分</b></td></tr>
        <tr><td>判断题</td><td>每题 1 分</td></tr>
        <tr><td>案例题</td><td>15 分，交卷时对照参考答案自评</td></tr>
        <tr><td>合格线</td><td>${DB.meta.passScore || 60} 分（满分 100）</td></tr>
      </table>
    </div>
    ${renderExamHistory()}
  </div>`;
}

function buildExamPaper() {
  const paper = [];
  const perChapter = {};
  const pick = (type, n, score) => {
    let pool = DB.questions.filter((q) => q.type === type);
    // 尽量跨章节均衡：轮转抽取
    const byC = new Map();
    pool.forEach((q) => { if (!byC.has(q.chapter)) byC.set(q.chapter, []); byC.get(q.chapter).push(q); });
    byC.forEach((v) => shuffle(v));
    shuffle(Array.from(byC.keys()));
    const out = [];
    let guard = 0;
    while (out.length < n && guard++ < 500) {
      const keys = Array.from(byC.keys());
      if (!keys.length) break;
      const k = keys[out.length % keys.length];
      const arr = byC.get(k);
      if (arr && arr.length) out.push(arr.pop());
      if (out.length >= n) break;
      if (keys.every((kk) => !(byC.get(kk) || []).length)) break;
    }
    return out.slice(0, n).map((q) => ({ q, score, got: 0, ans: null }));
  };
  EXAM_SPEC.forEach((s) => { paper.push(...pick(s.type, s.n, s.score)); });
  return paper;
}

function startExam(timed = true) {
  const paper = buildExamPaper();
  if (!paper.length) { toast('题库为空'); return; }
  const dur = (DB.meta.examDurationMin || 90) * 60;
  ui.exam = {
    phase: 'run', paper, i: 0, left: timed ? dur : null, timed,
    flags: new Set(), ts: Date.now(), startAt: Date.now(),
    timer: null, selfCase: 0,
  };
  go('exam');
  if (timed) {
    clearInterval(ui.exam.timer);
    ui.exam.timer = setInterval(() => {
      if (!ui.exam || ui.exam.phase !== 'run') { clearInterval(ui.exam.timer); return; }
      ui.exam.left--;
      const t = $('#examTimer');
      if (t) { t.textContent = fmtTime(Math.max(0, ui.exam.left)); t.classList.toggle('warn', ui.exam.left < 300); }
      if (ui.exam.left <= 0) { clearInterval(ui.exam.timer); toast('时间到，自动交卷'); submitExam(); }
    }, 1000);
  }
}

function renderExamRun() {
  const s = ui.exam, it = s.paper[s.i];
  const q = it.q;
  const isMulti = q.type === 'multi';
  const sel = it.ans;
  const total = s.paper.length;

  return `<div class="wrap">
    <div class="quiz-head">
      <span class="exam-timer" id="examTimer">${s.left == null ? '练习' : fmtTime(Math.max(0, s.left))}</span>
      <span class="q-type ${q.type}">${TYPE_NAME[q.type]}</span>
      <span class="chip solid" style="background:${chColor(q.chapter)}">${esc(chName(q.chapter))}</span>
      <div class="q-progress-track"><i style="width:${(s.i + 1) / total * 100}%"></i></div>
      <span class="q-counter">${s.i + 1} / ${total}</span>
      <button class="btn sm" data-act="exam-submit">交卷</button>
    </div>

    <div class="card q-card">
      <div class="row" style="justify-content:space-between;margin-bottom:4px">
        <span class="tiny muted">本卷第 ${s.i + 1} 题 · ${it.score} 分</span>
        <button class="btn sm ghost" data-act="exam-flag">${s.flags.has(s.i) ? '⚑ 已标记' : '⚐ 标记'}</button>
      </div>
      <div class="q-stem">${esc(q.stem)}</div>
      ${q.type === 'case'
        ? `<div class="explain" style="border-color:var(--amber);background:var(--amber-soft)">案例题：先在本机纸上（或心里）写出答案要点，交卷后再对照参考答案自评。</div>`
        : `<div class="q-opts">
          ${q.options.map((o, oi) => `<div class="opt ${sel && sel.includes(oi) ? 'sel' : ''}" data-act="exam-pick" data-i="${oi}">
            <span class="ok">${String.fromCharCode(65 + oi)}</span><span>${esc(o)}</span></div>`).join('')}
          </div>`}
      <div class="q-actions">
        <button class="btn" data-act="exam-prev" ${s.i === 0 ? 'disabled' : ''}>← 上一题</button>
        <button class="btn primary" data-act="exam-next">${s.i + 1 < total ? '下一题 →' : '交卷'}</button>
        ${isMulti ? '<span class="tiny muted">多选题：选完自动记录，不需提交</span>' : ''}
        <div class="spacer"></div>
        <button class="btn ghost sm" data-act="exam-panel">题号面板</button>
      </div>
    </div>
    ${renderExamPanel()}
  </div>`;
}
function renderExamPanel() {
  const s = ui.exam;
  return `<div class="card pad" style="margin-top:16px">
    <div class="row" style="margin-bottom:10px"><h3 style="font-size:13px">答题卡</h3>
      <div class="spacer"></div>
      <span class="tiny muted">${s.paper.filter((x) => x.ans && x.ans.length).length} / ${s.paper.length} 已答</span></div>
    <div class="sheet">
      ${s.paper.map((x, i) => `<div class="sheet-i ${x.ans && x.ans.length ? 'ans' : ''} ${s.flags.has(i) ? 'flag' : ''} ${i === s.i ? 'cur' : ''}" data-act="exam-jump" data-i="${i}">${i + 1}</div>`).join('')}
    </div>
  </div>`;
}

function submitExam() {
  const s = ui.exam; if (!s) return;
  clearInterval(s.timer);
  let totalScore = 0, maxScore = 0, correct = 0;
  s.paper.forEach((it) => {
    maxScore += it.score;
    if (it.q.type === 'case') return;
    const ok = sameSet(it.ans, it.q.answer);
    it.ok = ok;
    if (ok) { it.got = it.score; totalScore += it.score; correct++; }
    else if (!ok) {
      // 记入错题本
      state.wrong[it.q.id] = { n: (state.wrong[it.q.id]?.n || 0) + 1, ts: Date.now() };
    }
  });
  const norm = Math.round(totalScore / (maxScore || 1) * 100);
  s.phase = 'done';
  s.rawScore = totalScore; s.maxScore = maxScore; s.score = norm; s.correct = correct;
  s.used = Math.round((Date.now() - s.startAt) / 1000);
  state.exams.push({ ts: Date.now(), score: norm, pass: norm >= (DB.meta.passScore || 60), used: s.used, correct, total: s.paper.length, detail: s.paper.map((it) => ({ id: it.q.id, ok: !!it.ok })) });
  if (state.exams.length > 40) state.exams = state.exams.slice(-40);
  save();
  render();
}

function renderExamDone() {
  const s = ui.exam;
  const pass = s.score >= (DB.meta.passScore || 60);
  // 章节命中率
  const byC = {};
  s.paper.forEach((it) => {
    if (it.q.type === 'case') return;
    if (!byC[it.q.chapter]) byC[it.q.chapter] = { n: 0, ok: 0 };
    byC[it.q.chapter].n++; if (it.ok) byC[it.q.chapter].ok++;
  });
  const weak = Object.entries(byC).map(([c, v]) => ({ c, ...v, r: v.ok / v.n })).sort((a, b) => a.r - b.r).slice(0, 3);
  const wrongItems = s.paper.filter((it) => it.q.type !== 'case' && !it.ok);

  return `<div class="wrap">
    <div class="card pad">
      <div class="result-score">
        <div class="big ${pass ? 'pass' : 'fail'}">${s.score}</div>
        <div class="lbl">${pass ? '✓ 达到合格线' : `差 ${(DB.meta.passScore || 60) - s.score} 分`} · 用时 ${fmtTime(s.used)} · 原始得分 ${s.rawScore}/${s.maxScore}</div>
      </div>
      <div class="res-grid">
        ${EXAM_SPEC.map((sp) => {
          const items = s.paper.filter((it) => it.q.type === sp.type);
          if (!items.length) return '';
          const got = items.reduce((a, it) => a + (it.got || 0), 0);
          const max = items.reduce((a, it) => a + it.score, 0);
          return `<div class="card res-item"><b>${got}<span style="font-size:12px;color:var(--ink-3)">/${max}</span></b><span>${TYPE_NAME[sp.type]}</span></div>`;
        }).join('')}
        <div class="card res-item"><b>${s.correct}/${s.paper.filter((i) => i.q.type !== 'case').length}</b><span>客观题答对</span></div>
      </div>
      <div class="row" style="margin-top:20px;justify-content:center;gap:10px;flex-wrap:wrap">
        <button class="btn primary" data-act="exam-retry">再考一次</button>
        <button class="btn" data-act="dashboard">回总览</button>
        ${wrongItems.length ? `<button class="btn danger" data-act="exam-review-wrong">复盘 ${wrongItems.length} 道错题</button>` : ''}
      </div>
    </div>

    <div class="section-head"><h2>薄弱章节</h2><span class="hint">按本卷得分率排序</span></div>
    <div class="card pad">
      ${weak.map((w) => `<div style="margin-bottom:12px">
        <div class="row" style="justify-content:space-between;font-size:13px;margin-bottom:4px">
          <span><span class="chip dot" style="color:${chColor(w.c)}">${esc(chName(w.c))}</span></span>
          <span class="muted">${w.ok}/${w.n} · ${Math.round(w.r * 100)}%</span></div>
        <div class="cbar" style="--cc:${chColor(w.c)}"><i style="width:${Math.round(w.r * 100)}%"></i></div>
      </div>`).join('')}
      <button class="btn sm" data-act="exam-goto-weak" data-c="${weak[0]?.c || 'C6'}">去补 ${esc(chName(weak[0]?.c || 'C6'))} 的卡片</button>
    </div>

    <div class="section-head"><h2>逐题解析</h2></div>
    <div class="card" style="overflow:hidden">
      ${s.paper.map((it, i) => {
        const ok = it.ok, q = it.q;
        return `<div style="border-bottom:1px solid var(--line-2);padding:14px 16px">
          <div class="row" style="align-items:flex-start;gap:9px">
            <span style="width:22px;height:22px;border-radius:6px;display:grid;place-items:center;font-size:11px;font-weight:700;flex:0 0 22px;margin-top:2px;
              background:${q.type === 'case' ? 'var(--amber-soft)' : ok ? 'var(--green-soft)' : 'var(--red-soft)'};
              color:${q.type === 'case' ? 'var(--amber)' : ok ? 'var(--green)' : 'var(--red)'}">${q.type === 'case' ? '案' : ok ? '✓' : '✗'}</span>
            <div style="flex:1;min-width:0">
              <div style="font-size:13.5px;font-weight:550;margin-bottom:5px">${i + 1}. ${esc(q.stem)}</div>
              <div class="tiny muted" style="margin-bottom:5px">
                你的答案 <b style="color:${ok ? 'var(--green)' : 'var(--red)'}">${(it.ans || []).map((x) => String.fromCharCode(65 + x)).join('') || '未答'}</b>
                ｜ 正确 <b style="color:var(--green)">${q.answer.map((x) => String.fromCharCode(65 + x)).join('')}</b>
              </div>
              ${q.type === 'case'
                ? `<div class="tiny" style="line-height:1.7">${emph(q.caseAnswer || q.explain)}</div>
                   <div class="row" style="margin-top:8px;gap:6px"><span class="tiny muted">自评得分：</span>
                   ${[0, 5, 10, 15].map((v) => `<button class="chip chip-btn ${s.selfCase === v ? 'on' : ''}" data-act="self-score" data-v="${v}">${v}</button>`).join('')}</div>`
                : `<div class="tiny" style="color:var(--ink-2);line-height:1.7">${emph(q.explain)}</div>
                   <div class="tiny muted" style="margin-top:4px;font-family:var(--mono)">${esc(q.cite || '')}</div>`}
            </div>
          </div>
        </div>`;
      }).join('')}
    </div>
  </div>`;
}

/* ═══════════════════════════════════════════════════
   错题本
   ═══════════════════════════════════════════════════ */
function renderWrong() {
  const ids = wrongIds();
  if (!ids.length) return `<div class="wrap"><div class="empty"><div class="ico">✓</div><h3>错题本是空的</h3>
    <p>去刷题或模拟考，错的题会自动收进来。</p>
    <button class="btn primary" data-act="start-quiz" style="margin-top:14px">去刷题</button></div></div>`;
  const list = ids.map((id) => Q.get(id)).filter(Boolean);
  const byC = {};
  list.forEach((q) => { byC[q.chapter] = (byC[q.chapter] || 0) + 1; });

  return `<div class="wrap">
    <div class="card pad" style="margin-bottom:16px">
      <div class="row" style="justify-content:space-between;flex-wrap:wrap;gap:10px">
        <div><h2 style="font-size:17px;margin-bottom:3px">错题本 · ${list.length} 道</h2>
        <p class="tiny muted">按章节分布：${Object.entries(byC).map(([c, n]) => `${chName(c)} ${n}`).join(' · ')}</p></div>
        <div class="row" style="gap:8px">
          <button class="btn primary" data-act="wrong-practice">重做全部错题</button>
          <button class="btn danger" data-act="wrong-clear">清空</button>
        </div>
      </div>
    </div>
    <div class="card" style="overflow:hidden">
      ${list.map((q) => `<div class="list-item" data-act="wrong-q" data-id="${q.id}">
        <span class="chip solid" style="background:${chColor(q.chapter)}">${esc((CH.get(q.chapter) || {}).short || '')}</span>
        <div class="li-main"><div class="t">${esc(q.stem)}</div>
        <div class="s">正确答案 ${q.answer.map((x) => String.fromCharCode(65 + x)).join('')} ｜ 错过 ${state.wrong[q.id]?.n || 1} 次 ｜ ${esc(q.cite || '')}</div></div>
        <span class="q-type ${q.type}">${TYPE_NAME[q.type]}</span>
      </div>`).join('')}
    </div>
  </div>`;
}

/* ═══════════════════════════════════════════════════
   法规速查
   ═══════════════════════════════════════════════════ */
let lawQ = '';
function renderLaws() {
  const q = lawQ.toLowerCase();
  const laws = DB.laws.filter((l) => !q || (l.name + (l.short || '') + (l.no || '') + (l.note || '')).toLowerCase().includes(q));
  const kps = q ? KPS.filter((k) => (k.topic + k.core + k.cite + (k.detail || '')).toLowerCase().includes(q)).slice(0, 40) : [];

  return `<div class="wrap wide">
    <div class="card pad" style="margin-bottom:16px">
      <h2 style="font-size:16px;margin-bottom:6px">法规速查 · ${DB.laws.length} 部</h2>
      <p class="tiny muted">按层级排列。点任一条看它对应的考点。</p>
      <input id="lawQ" class="btn" style="height:36px;margin-top:12px;width:100%;max-width:420px;cursor:text;text-align:left;padding-left:12px"
             placeholder="输入法规名 / 文号 / 关键词…" value="${esc(lawQ)}">
    </div>

    ${kps.length ? `<div class="section-head"><h2>考点命中（${kps.length}）</h2></div>
      <div class="card" style="overflow:hidden;margin-bottom:16px">
        ${kps.map((k) => `<div class="list-item" data-act="open-kp" data-id="${k.id}">
          <div class="li-main"><div class="t">${esc(k.topic)}</div><div class="s">${esc(k.cite)}</div></div>
          ${hlBadge(k.hl)}
        </div>`).join('')}
      </div>` : ''}

    <div class="card" style="overflow:hidden">
      ${laws.length ? laws.map((l) => `<div class="list-item" data-act="law-detail" data-name="${esc(l.name)}">
        <div style="width:56px;flex:0 0 56px;font-size:10.5px;text-align:center;padding:3px 0;border-radius:5px;
          background:var(--bg-2);color:var(--ink-2)">${esc(l.level || '')}</div>
        <div class="li-main"><div class="t">${esc(l.name)}</div>
          <div class="s">${esc(l.no || '')}${l.date ? '　施行/发布：' + esc(l.date) : ''}</div></div>
        <span class="tiny muted">${(DB.kps.filter((k) => (k.cite || '').includes(l.short || l.name.slice(0, 6))).length)} 考点</span>
      </div>`).join('') : `<div class="empty"><div class="ico">§</div><h3>没有匹配的法规</h3></div>`}
    </div>
  </div>`;
}

/* ═══════════════════════════════════════════════════
   事件绑定
   ═══════════════════════════════════════════════════ */
function bindView() {
  const v = $('#view');
  v.onclick = (e) => {
    const t = e.target.closest('[data-act]');
    const ch = e.target.closest('[data-chapter]');
    const ni = e.target.closest('.nav-item');
    if (ni) { go(ni.dataset.view); return; }
    if (ch) { ui.filters.chapter = ch.dataset.chapter; ui.learnQueue = null; ui.learnIdx = 0; go('learn'); return; }
    if (!t) return;
    const act = t.dataset.act;
    const R = ACT[act];
    if (R) R(t, e);
  };
  // 输入框
  const nq = $('#numQ'); if (nq) nq.oninput = () => { numFilter.q = nq.value; const p = nq.selectionStart; render(); const el = $('#numQ'); if (el) { el.focus(); el.setSelectionRange(p, p); } };
  const nc = $('#numCh'); if (nc) nc.onchange = () => { numFilter.ch = nc.value; render(); };
  const lq = $('#lawQ'); if (lq) lq.oninput = () => { lawQ = lq.value; const p = lq.selectionStart; render(); const el = $('#lawQ'); if (el) { el.focus(); el.setSelectionRange(p, p); } };
}

const ACT = {
  /* 总览 */
  'start-learn': () => { ui.filters.chapter = 'all'; ui.learnQueue = null; ui.learnIdx = 0; go('learn'); },
  'start-exam': () => go('exam'),
  'start-quiz': () => { ui.quiz = null; go('quiz'); },
  'print-manual': () => printManual(),
  'dashboard': () => go('dash'),
  'exam-detail': (t) => showExamDetail(Number(t.dataset.i)),

  /* 卡片 */
  'filter-ch': (t) => { ui.filters.chapter = t.dataset.ch; ui.learnQueue = null; ui.learnIdx = 0; render(); },
  'toggle-new': () => { ui.filters.onlyNew = !ui.filters.onlyNew; ui.learnQueue = null; ui.learnIdx = 0; render(); },
  'toggle-red': () => { ui.filters.onlyRed = !ui.filters.onlyRed; ui.learnQueue = null; ui.learnIdx = 0; render(); },
  'toggle-star': () => { ui.filters.onlyStar = !ui.filters.onlyStar; ui.learnQueue = null; ui.learnIdx = 0; render(); },
  'toggle-official': () => { ui.filters.onlyOfficial = !ui.filters.onlyOfficial; ui.learnQueue = null; ui.learnIdx = 0; render(); },
  'reset-filter': () => { ui.filters = { chapter: 'all', onlyNew: false, onlyRed: false, onlyStar: false, onlyOfficial: false }; ui.learnQueue = null; ui.learnIdx = 0; render(); },
  'rate': (t) => { const k = curKP(); if (!k) return; const r = Number(t.dataset.r); state.prog[k.id] = r; save(); nextKP(); },
  'next-kp': () => nextKP(),
  'prev-kp': () => prevKP(),
  'random-kp': () => { const q = ui.learnQueue || buildLearnQueue(); if (q.length) { ui.learnIdx = Math.floor(Math.random() * q.length); render(); } },
  'star-kp': () => { const k = curKP(); if (!k) return; state.star[k.id] = !state.star[k.id]; if (!state.star[k.id]) delete state.star[k.id]; save(); render(); },
  'jump-quiz': () => { const k = curKP(); if (!k) return; quizCfg.chapters = [k.chapter]; quizCfg.wrongOnly = false; ui.quiz = null; startQuiz(buildQuizPool(), '本章刷题'); },
  'open-kp': (t) => {
    ui.filters.chapter = 'all'; ui.filters.onlyNew = false; ui.filters.onlyRed = false; ui.filters.onlyStar = false; ui.filters.onlyOfficial = false;
    ui.learnQueue = null; const q = buildLearnQueue();
    const raw = KP.get(t.dataset.id);
    const targetId = raw && raw.dup ? raw.dupOf : t.dataset.id;
    const i = q.findIndex((x) => x.id === targetId);
    ui.learnIdx = i < 0 ? 0 : i; go('learn');
  },

  /* 闪卡 */
  'flip': () => { ui.flashFlipped = !ui.flashFlipped; render(); },
  'flash-rate': (t) => { const q = ui.flashQueue || []; const k = q[ui.flashIdx]; if (!k) return; state.prog[k.id] = Number(t.dataset.r); save(); ui.flashFlipped = false; ui.flashIdx++; if (ui.flashIdx >= q.length) { ui.flashQueue = null; ui.flashIdx = 0; toast('本轮闪卡完成 🎉'); } render(); },
  'flash-prev': () => { ui.flashIdx = Math.max(0, ui.flashIdx - 1); ui.flashFlipped = false; render(); },
  'flash-skip': () => { const q = ui.flashQueue || []; ui.flashIdx = (ui.flashIdx + 1) % Math.max(1, q.length); ui.flashFlipped = false; render(); },

  /* 数字 */
  'toggle-mask': () => { numFilter.masked = !numFilter.masked; render(); },
  'num-cat': (t) => { numFilter.cat = t.dataset.c; render(); },
  'reveal': (t) => { const tr = t.closest('tr'); if (tr) tr.classList.toggle('reveal'); },

  /* 易混 */
  'conf-cat': (t) => { confuseFilter = t.dataset.c; render(); },

  /* 刷题 */
  'quiz-ch': (t) => {
    const ch = t.dataset.ch;
    if (ch === 'all') quizCfg.chapters = ['all'];
    else {
      quizCfg.chapters = quizCfg.chapters.filter((x) => x !== 'all');
      const i = quizCfg.chapters.indexOf(ch);
      if (i >= 0) quizCfg.chapters.splice(i, 1); else quizCfg.chapters.push(ch);
      if (!quizCfg.chapters.length) quizCfg.chapters = ['all'];
    }
    render();
  },
  'quiz-type': (t) => {
    const ty = t.dataset.t; const i = quizCfg.types.indexOf(ty);
    if (i >= 0) quizCfg.types.splice(i, 1); else quizCfg.types.push(ty);
    if (!quizCfg.types.length) quizCfg.types = ['single'];
    render();
  },
  'quiz-n': (t) => { quizCfg.n = Number(t.dataset.n); render(); },
  'quiz-wrong': () => { quizCfg.wrongOnly = !quizCfg.wrongOnly; render(); },
  'quiz-shuffle-on': () => { quizCfg.shuffle = !quizCfg.shuffle; render(); },
  'quiz-start': () => startQuiz(buildQuizPool(), '自由刷题'),
  'pick': (t) => pickOption(Number(t.dataset.i)),
  'submit-q': () => judgeCurrent(),
  'next-q': () => { const s = ui.quiz; if (s.i + 1 < s.list.length) { s.i++; render(); } else { s.phase = 'done'; render(); } },
  'prev-q': () => { const s = ui.quiz; if (s.i > 0) { s.i--; render(); } },
  'quiz-exit': () => { ui.quiz = null; go('quiz'); },
  'quiz-again': () => { const s = ui.quiz; const list = shuffle(s.list); startQuiz(list, s.label); },
  'quiz-back': () => { ui.quiz = null; go('quiz'); },
  'quiz-redo-wrong': () => { const s = ui.quiz; const w = s.list.filter((q, i) => !sameSet(s.ans[i], q.answer)); startQuiz(w, '错题重做'); },
  'rev-q': (t) => { showQuestion(ui.quiz.list[Number(t.dataset.i)], ui.quiz.ans[Number(t.dataset.i)]); },

  /* 模考 */
  'exam-start': () => startExam(true),
  'exam-practice': () => startExam(false),
  'exam-pick': (t) => examPick(Number(t.dataset.i)),
  'exam-prev': () => { ui.exam.i = Math.max(0, ui.exam.i - 1); render(); },
  'exam-next': () => { if (ui.exam.i + 1 < ui.exam.paper.length) { ui.exam.i++; render(); } else confirmSubmit(); },
  'exam-jump': (t) => { ui.exam.i = Number(t.dataset.i); render(); },
  'exam-flag': () => { const s = ui.exam; s.flags.has(s.i) ? s.flags.delete(s.i) : s.flags.add(s.i); render(); },
  'exam-panel': () => { const p = $('.sheet'); if (p) p.scrollIntoView({ behavior: 'smooth', block: 'center' }); },
  'exam-submit': () => confirmSubmit(),
  'exam-retry': () => { ui.exam = null; go('exam'); },
  'exam-review-wrong': () => { const w = ui.exam.paper.filter((it) => it.q.type !== 'case' && !it.ok).map((it) => it.q); startQuiz(shuffle(w), '模考错题'); },
  'exam-goto-weak': (t) => { ui.filters.chapter = t.dataset.c; ui.filters.onlyNew = true; ui.learnQueue = null; ui.learnIdx = 0; go('learn'); },
  'self-score': (t) => { ui.exam.selfCase = Number(t.dataset.v); render(); },

  /* 错题 */
  'wrong-practice': () => { const l = wrongIds().map((id) => Q.get(id)).filter(Boolean); startQuiz(shuffle(l), '错题本'); },
  'wrong-clear': () => { if (confirm('确定清空错题本？')) { state.wrong = {}; save(); render(); } },
  'wrong-q': (t) => showQuestion(Q.get(t.dataset.id), null),

  /* 法规 */
  'law-detail': (t) => showLaw(t.dataset.name),
};

function refreshQuizSetup() {
  $$('[data-act="quiz-ch"]').forEach((b) => b.classList.toggle('on', quizCfg.chapters.includes(b.dataset.ch) || (b.dataset.ch === 'all' && quizCfg.chapters.includes('all'))));
  updatePoolLabel();
}
function updatePoolLabel() {
  const el = $('#quizPool'); if (!el) return;
  const n = buildQuizPool().length;
  el.textContent = `按当前条件将出 ${n} 题`;
}
function curKP() { const q = ui.learnQueue; return q ? q[ui.learnIdx] : null; }
function nextKP() { const q = ui.learnQueue || []; if (ui.learnIdx + 1 < q.length) { ui.learnIdx++; render(); } else { toast('已到最后一张 🎉'); render(); } }
function prevKP() { if (ui.learnIdx > 0) { ui.learnIdx--; render(); } }

function pickOption(i) {
  const s = ui.quiz; if (!s) return;
  const q = s.list[s.i];
  if (s.judged[s.i]) return;
  if (q.type === 'multi') {
    let cur = s.ans[s.i] || [];
    cur = cur.includes(i) ? cur.filter((x) => x !== i) : cur.concat(i).sort();
    s.ans[s.i] = cur; render();
  } else {
    s.ans[s.i] = [i]; judgeCurrent(true);
  }
}
function judgeCurrent(auto) {
  const s = ui.quiz; if (!s) return;
  const q = s.list[s.i];
  if (s.judged[s.i]) return;
  const sel = s.ans[s.i];
  if (!sel || !sel.length) { if (!auto) toast('先选一个答案'); return; }
  s.judged[s.i] = true;
  const ok = sameSet(sel, q.answer);
  if (ok) s.right++;
  else { state.wrong[q.id] = { n: (state.wrong[q.id]?.n || 0) + 1, ts: Date.now() }; save(); }
  render();
}
function examPick(i) {
  const s = ui.exam; if (!s) return;
  const it = s.paper[s.i];
  if (it.q.type === 'multi') {
    let cur = it.ans || [];
    cur = cur.includes(i) ? cur.filter((x) => x !== i) : cur.concat(i).sort();
    it.ans = cur;
  } else {
    it.ans = [i];
  }
  render();
}
function confirmSubmit() {
  const s = ui.exam; if (!s) return;
  const un = s.paper.filter((x) => !x.ans || !x.ans.length).length;
  if (!confirm(un ? `还有 ${un} 题未作答，确定交卷？` : '确定交卷？')) return;
  submitExam();
}

/* ═══════════ 弹层内容 ═══════════ */
function showQuestion(q, userAns) {
  if (!q) return;
  const ok = userAns ? sameSet(userAns, q.answer) : null;
  modal(`<h2>${TYPE_NAME[q.type]}题</h2>
    <div style="font-size:15px;line-height:1.7;margin-bottom:14px">${esc(q.stem)}</div>
    ${q.type !== 'case' ? `<div style="display:flex;flex-direction:column;gap:7px">${q.options.map((o, i) =>
      `<div class="opt ${q.answer.includes(i) ? 'right' : (userAns && userAns.includes(i) ? 'wrong' : '')}" style="pointer-events:none">
        <span class="ok">${String.fromCharCode(65 + i)}</span><span>${esc(o)}</span></div>`).join('')}</div>` : ''}
    ${userAns ? `<p class="tiny" style="margin-top:10px">你的答案：<b style="color:${ok ? 'var(--green)' : 'var(--red)'}">${userAns.map((x) => String.fromCharCode(65 + x)).join('') || '未答'}</b></p>` : ''}
    <div class="explain"><div>${emph(q.caseAnswer || q.explain)}</div><div class="src">📖 ${esc(q.cite || '')}</div></div>
    <div class="row" style="margin-top:18px;justify-content:flex-end"><button class="btn" data-close>关闭</button></div>`);
  $('#modalBox [data-close]').onclick = closeModal;
}
function showLaw(name) {
  const l = DB.laws.find((x) => x.name === name);
  if (!l) return;
  const kps = DB.kps.filter((k) => (k.cite || '').includes(l.short || l.name.slice(0, 6)));
  modal(`<h2>${esc(l.name)}</h2>
    <div class="row wrap" style="gap:7px;margin-bottom:14px">
      <span class="chip on">${esc(l.level || '')}</span>
      ${l.no ? `<span class="chip">${esc(l.no)}</span>` : ''}
      ${l.date ? `<span class="chip">${esc(l.date)}</span>` : ''}
    </div>
    ${l.note ? `<p style="font-size:13.5px;line-height:1.8;color:var(--ink-2)">${esc(l.note)}</p>` : ''}
    <div class="section-head" style="margin:18px 0 8px"><h2 style="font-size:13px">关联考点 ${kps.length} 条</h2></div>
    <div style="max-height:320px;overflow-y:auto">
      ${kps.map((k) => `<div class="list-item" style="padding:9px 4px"><div class="li-main"><div class="t">${esc(k.topic)}</div>
        <div class="s">${esc(k.cite)}</div></div>${hlBadge(k.hl)}</div>`).join('') || '<p class="tiny muted">无</p>'}
    </div>
    <div class="row" style="margin-top:16px;justify-content:flex-end"><button class="btn" data-close>关闭</button></div>`);
  $('#modalBox [data-close]').onclick = closeModal;
}
function showExamDetail(i) {
  const e = state.exams[i]; if (!e) return;
  modal(`<h2>模考详情</h2>
    <div class="result-score"><div class="big ${e.pass ? 'pass' : 'fail'}" style="font-size:48px">${e.score}</div>
    <div class="lbl">${new Date(e.ts).toLocaleString('zh-CN')} · 用时 ${fmtTime(e.used || 0)} · 答对 ${e.correct}/${e.total}</div></div>
    <div class="row" style="margin-top:16px;justify-content:flex-end"><button class="btn" data-close>关闭</button></div>`);
  $('#modalBox [data-close]').onclick = closeModal;
}

function printManual() {
  const ch = ui.filters.chapter;
  const list = DB.kps.filter((k) => ch === 'all' || k.chapter === ch);
  const w = window.open('', '_blank');
  if (!w) { toast('浏览器拦截了弹窗，请允许弹窗后重试'); return; }
  let cur = '';
  let body = '';
  list.forEach((k) => {
    if (k.chapter !== cur) { cur = k.chapter; body += `<h1 class="ch">${esc(chName(cur))}</h1>`; }
    body += `<article><h2>${esc(k.topic)}</h2><p class="core">${esc(k.core)}</p>
      ${(k.bullets || []).length ? `<ul>${k.bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>` : ''}
      ${(k.numbers || []).length ? `<p class="nums">${k.numbers.map((n) => `<b>${esc(n.k)}：</b>${esc(n.v)}`).join('　｜　')}</p>` : ''}
      ${k.mnemonic ? `<p class="mn">口诀：${esc(k.mnemonic)}</p>` : ''}
      ${k.trap ? `<p class="tr">易错：${esc(k.trap.replace(/^易错：/, ''))}</p>` : ''}
      <p class="cite">${esc(k.cite)}</p></article>`;
  });
  w.document.write(`<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">
    <title>评审专家考点速记手册</title><style>
    body{font-family:"PingFang SC","Microsoft YaHei",sans-serif;max-width:820px;margin:30px auto;padding:0 24px;line-height:1.7;color:#111}
    h1{font-size:20px;border-bottom:2px solid #333;padding-bottom:6px;margin:34px 0 14px;page-break-before:auto}
    h2{font-size:14.5px;margin:16px 0 6px}
    article{border-bottom:1px dashed #ccc;padding-bottom:12px;margin-bottom:12px;page-break-inside:avoid}
    .core{background:#f3f5ff;border-left:3px solid #3b5bdb;padding:8px 12px;margin:6px 0;font-size:13.5px}
    ul{margin:4px 0;padding-left:20px;font-size:12.5px} li{margin:2px 0}
    .nums{font-size:12.5px;background:#fff8e6;padding:6px 10px;border-radius:5px}
    .mn{font-size:12.5px;color:#1a7a4a} .tr{font-size:12.5px;color:#b03030}
    .cite{font-size:11px;color:#888;font-family:monospace;margin-top:4px}
    @media print{ body{margin:0} h1{page-break-before:always} }
    </style></head><body><h1 style="text-align:center;border:none;font-size:22px">四川政府采购评审专家 · 考点速记手册</h1>
    <p style="text-align:center;color:#888;font-size:12px;margin-bottom:24px">共 ${list.length} 条考点 · 生成于 ${new Date().toLocaleString('zh-CN')}</p>
    ${body}</body></html>`);
  w.document.close();
  setTimeout(() => w.print(), 400);
}

/* ═══════════ 全局快捷键 ═══════════ */
document.addEventListener('keydown', (e) => {
  const tag = (e.target.tagName || '').toLowerCase();
  const typing = tag === 'input' || tag === 'textarea' || e.target.isContentEditable;

  if (e.key === 'Escape') { closeModal(); if (typing) e.target.blur(); return; }
  if (!typing && (e.key === '/' || (e.metaKey && e.key === 'k'))) { e.preventDefault(); $('#globalSearch').focus(); return; }
  if (!typing && e.key === '?') { e.preventDefault(); showHelp(); return; }
  if (!typing && e.key.toLowerCase() === 't' && !e.metaKey && !e.ctrlKey) { toggleTheme(); return; }
  if (e.key === 'Escape' && !$('#msearch').hidden) { $('#msearch').hidden = true; return; }
  if (typing) {
    // 搜索下拉里回车跳转
    if (e.key === 'Enter' && $('#globalSearch') === document.activeElement) {
      const first = $('.sd-item.sel') || $('.sd-item');
      if (first) first.click();
    }
    return;
  }

  const v = state.view;
  if (v === 'learn') {
    if (e.key === '1') { e.preventDefault(); ACT['rate']({ dataset: { r: '0' } }); }
    if (e.key === '2') { e.preventDefault(); ACT['rate']({ dataset: { r: '1' } }); }
    if (e.key === '3') { e.preventDefault(); ACT['rate']({ dataset: { r: '2' } }); }
    if (e.key === 'ArrowRight') { e.preventDefault(); nextKP(); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); prevKP(); }
  } else if (v === 'flash') {
    if (e.key === ' ') { e.preventDefault(); ACT['flip'](); }
    if (e.key === 'ArrowRight') { e.preventDefault(); if (ui.flashFlipped) ACT['flash-rate']({ dataset: { r: '2' } }); else ACT['flip'](); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); ACT['flash-prev'](); }
    if (ui.flashFlipped) {
      if (e.key === '1') ACT['flash-rate']({ dataset: { r: '0' } });
      if (e.key === '2') ACT['flash-rate']({ dataset: { r: '1' } });
      if (e.key === '3') ACT['flash-rate']({ dataset: { r: '2' } });
    }
  } else if (v === 'quiz' && ui.quiz && ui.quiz.phase === 'run') {
    const s = ui.quiz, q = s.list[s.i];
    if (/^[a-dA-D]$/.test(e.key)) { e.preventDefault(); pickOption(e.key.toUpperCase().charCodeAt(0) - 65); }
    if (/^[1-4]$/.test(e.key) && q.type !== 'judge') { e.preventDefault(); pickOption(Number(e.key) - 1); }
    if (e.key === ' ') { e.preventDefault(); if (s.judged[s.i]) ACT['next-q'](); else if (q.type === 'multi') judgeCurrent(); }
    if (e.key === 'Enter') { e.preventDefault(); if (s.judged[s.i]) ACT['next-q'](); else judgeCurrent(); }
  } else if (v === 'exam' && ui.exam && ui.exam.phase === 'run') {
    if (/^[a-dA-D]$/.test(e.key)) { e.preventDefault(); examPick(e.key.toUpperCase().charCodeAt(0) - 65); }
    if (/^[1-4]$/.test(e.key)) { e.preventDefault(); examPick(Number(e.key) - 1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); ACT['exam-next'](); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); ACT['exam-prev'](); }
    if (e.key === 'f') ACT['exam-flag']();
  }
});

function bindSwipe() {
  const view = $('#view');
  let x0 = 0, y0 = 0, t0 = 0, tracking = false;
  view.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) { tracking = false; return; }
    if (e.target.closest('.learn-bar, .numtool, .vs-body, .sheet, .modal-box, input, select, textarea')) { tracking = false; return; }
    tracking = true;
    x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; t0 = Date.now();
  }, { passive: true });
  view.addEventListener('touchend', (e) => {
    if (!tracking) return;
    tracking = false;
    const t = e.changedTouches[0];
    const dx = t.clientX - x0, dy = t.clientY - y0, dt = Date.now() - t0;
    if (dt > 700 || Math.abs(dx) < 55 || Math.abs(dy) > 60) return;
    if (state.view === 'learn' && ui.learnQueue) {
      if (dx < 0) nextKP(); else prevKP();
      if (navigator.vibrate) navigator.vibrate(6);
    } else if (state.view === 'flash' && ui.flashQueue) {
      if (dx < 0 && ui.flashFlipped) { ACT['flash-rate']({ dataset: { r: '2' } }); if (navigator.vibrate) navigator.vibrate(8); }
      else if (dx > 0 && ui.flashFlipped) { ACT['flash-rate']({ dataset: { r: '0' } }); if (navigator.vibrate) navigator.vibrate(20); }
      else { ACT['flip'](); }
    }
  }, { passive: true });
}

function showMore() {
  const wc = wrongIds().length;
  const lic = (window.__license && window.__license()) || null;
  const licTxt = lic ? `学习码已激活 · ${new Date(lic.ts).toLocaleDateString('zh-CN')}` : '学习码：未激活';
  modal(`<h2 style="margin-bottom:4px">更多</h2>
    <p class="tiny muted" style="margin-bottom:14px">总掌握度 ${overallPct()}% · ${masteredCount()}/${KPS.length} 考点</p>
    <div class="chip" style="margin-bottom:10px;${lic ? 'background:var(--green-soft);color:var(--green)' : 'background:var(--red-soft);color:var(--red)'}">${licTxt}</div>
    ${MORE_VIEWS.map((m) => `<div class="list-item" data-goto="${m.v}" style="border-radius:10px;border-bottom:1px solid var(--line-2)">
      <div class="li-main"><div class="t">${m.n}${m.v === 'wrong' && wc ? ` · ${wc} 道待清` : ''}</div><div class="s">${m.d}</div></div>
      <span class="muted">›</span>
    </div>`).join('')}
    <div class="hr"></div>
    <div class="row wrap" style="gap:8px">
      <button class="btn sm" data-act="print-manual">🖨 导出速记手册</button>
      <button class="btn sm" data-act="theme">◐ 切换主题</button>
      <button class="btn sm danger" data-act="reset">↺ 重置记录</button>
      ${lic ? '<button class="btn sm" data-act="deactivate">⏏ 停用本机</button>' : ''}
    </div>
    <div class="row" style="margin-top:16px;justify-content:flex-end"><button class="btn" data-close>关闭</button></div>`);
  $('#modalBox').onclick = (e) => {
    const g = e.target.closest('[data-goto]');
    if (g) { closeModal(); go(g.dataset.goto); return; }
    const a = e.target.closest('[data-act]');
    if (a) {
      const act = a.dataset.act;
      if (act === 'theme') { toggleTheme(); return; }
      if (act === 'reset') { closeModal(); doReset(); return; }
      if (act === 'deactivate') {
        if (!confirm('停用后需要重新输入学习码才能使用，确定？')) return;
        try { localStorage.removeItem('sczc_license_v1'); } catch (e) {}
        location.reload(); return;
      }
      if (act === 'print-manual') { closeModal(); printManual(); return; }
    }
    if (e.target.closest('[data-close]')) closeModal();
  };
}

function doReset() {
  if (!confirm('会清空所有学习记录（掌握度、错题本、模考成绩），确定？')) return;
  state = JSON.parse(JSON.stringify(DEF)); save(); applyTheme(); go('dash'); toast('已重置');
}

function showHelp() {
  modal(`<h2>快捷键</h2>
    <table class="kbd-table">
      <tr><td><kbd>/</kbd> 或 <kbd>⌘K</kbd></td><td>唤起全局搜索</td></tr>
      <tr><td><kbd>1</kbd><kbd>2</kbd><kbd>3</kbd></td><td>卡片页面：不会 / 模糊 / 掌握</td></tr>
      <tr><td><kbd>←</kbd> <kbd>→</kbd></td><td>上一张 / 下一张</td></tr>
      <tr><td><kbd>空格</kbd></td><td>闪卡翻面；刷题进入下一题</td></tr>
      <tr><td><kbd>A</kbd>–<kbd>D</kbd></td><td>选择选项</td></tr>
      <tr><td><kbd>Enter</kbd></td><td>确认 / 下一题</td></tr>
      <tr><td><kbd>T</kbd></td><td>切换深浅主题</td></tr>
      <tr><td><kbd>F</kbd></td><td>考试中标记题目</td></tr>
      <tr><td><kbd>Esc</kbd></td><td>关闭弹窗 / 退出输入</td></tr>
    </table>
    <h2 style="margin-top:22px">这个系统怎么用（最短路径）</h2>
    <ol style="font-size:13px;line-height:1.9;padding-left:20px;color:var(--ink-2)">
      <li><b>考点卡片</b>先过一遍：一章一章往下翻，只按「不会/模糊/掌握」，别停。目的是建立坐标系。</li>
      <li><b>数字速记</b>开遮罩自测两轮：所有时限、比例、金额、人数都在这一页。</li>
      <li><b>易混辨析</b>读一遍：多选题的错误选项几乎全在这里。</li>
      <li><b>刷题</b>按章节做，错的自动进错题本；然后只刷错题。</li>
      <li><b>模拟考</b>两轮 90 分钟：第一轮找薄弱章，回去补卡片；第二轮验分。</li>
      <li>考前 10 分钟只看：<b>数字表 + 红字考点 + 错题本</b>。</li>
    </ol>
    <div class="row" style="margin-top:18px;justify-content:flex-end"><button class="btn" data-close>知道了</button></div>`);
  $('#modalBox [data-close]').onclick = closeModal;
}

/* ═══════════ 主题 / 重置 ═══════════ */
function applyTheme() { document.documentElement.dataset.theme = state.theme === 'dark' ? 'dark' : 'light'; }
function toggleTheme() {
  state.theme = state.theme === 'dark' ? 'light' : 'dark';
  applyTheme(); save();
  const tc = document.querySelector('meta[name="theme-color"]');
  if (tc) tc.setAttribute('content', state.theme === 'dark' ? '#0e1116' : '#3b5bdb');
}

/* ═══════════ 全局搜索 ═══════════ */
let searchDrop = null;
function doSearch(kw) {
  kw = kw.trim().toLowerCase();
  if (searchDrop) { searchDrop.remove(); searchDrop = null; }
  if (!kw) return;
  const kps = KPS.filter((k) => (k.topic + k.core + (k.detail || '') + k.cite + (k.bullets || []).join('')).toLowerCase().includes(kw)).slice(0, 12);
  const qs = DB.questions.filter((q) => (q.stem + q.options.join('') + q.explain).toLowerCase().includes(kw)).slice(0, 8);
  const nums = DB.numbers.filter((n) => (n.k + n.v).toLowerCase().includes(kw)).slice(0, 5);
  if (!kps.length && !qs.length && !nums.length) return;

  const d = document.createElement('div');
  d.className = 'searchdrop';
  d.innerHTML = `
    ${kps.length ? `<div class="chip" style="margin:6px">考点 ${kps.length}</div>` + kps.map((k) => `<div class="sd-item" data-kind="kp" data-id="${k.id}">
      <span class="sd-tag" style="color:${chColor(k.chapter)}">${esc((CH.get(k.chapter) || {}).short || '')}</span>
      <div style="min-width:0;flex:1"><div class="k">${esc(k.topic)}</div><div class="d">${esc(k.core)}</div></div></div>`).join('') : ''}
    ${nums.length ? `<div class="chip" style="margin:6px">数字</div>` + nums.map((n) => `<div class="sd-item" data-kind="num" data-q="${esc(n.k)}">
      <span class="sd-tag">№</span><div style="flex:1"><div class="k">${esc(n.k)}</div><div class="d">${esc(n.v)}</div></div></div>`).join('') : ''}
    ${qs.length ? `<div class="chip" style="margin:6px">题目 ${qs.length}</div>` + qs.map((q) => `<div class="sd-item" data-kind="q" data-id="${q.id}">
      <span class="sd-tag">${TYPE_NAME[q.type]}</span>
      <div style="min-width:0;flex:1"><div class="k">${esc(q.stem.slice(0, 46))}${q.stem.length > 46 ? '…' : ''}</div><div class="d">${esc(q.cite || '')}</div></div></div>`).join('') : ''}
  `;
  document.body.appendChild(d);
  searchDrop = d;
  const first = d.querySelector('.sd-item'); if (first) first.classList.add('sel');
  d.onclick = (e) => {
    const it = e.target.closest('.sd-item'); if (!it) return;
    d.remove(); searchDrop = null; $('#globalSearch').blur();
    if (it.dataset.kind === 'kp') { ACT['open-kp']({ dataset: { id: it.dataset.id } }); }
    else if (it.dataset.kind === 'q') { showQuestion(Q.get(it.dataset.id), null); }
    else { numFilter.q = it.dataset.q; numFilter.cat = 'all'; go('numbers'); }
  };
}
document.addEventListener('click', (e) => {
  if (searchDrop && !searchDrop.contains(e.target) && e.target.id !== 'globalSearch') { searchDrop.remove(); searchDrop = null; }
});

/* ═══════════ 手机全屏搜索 ═══════════ */
function mSearchRender(kw) {
  const box = $('#msearchResults');
  kw = kw.trim().toLowerCase();
  if (!kw) {
    box.innerHTML = `<div class="empty"><div class="ico">⌕</div><h3>搜考点、法条或题目的原文</h3>
      <p class="tiny">例如：三分之二、质疑、报价修正、中小企业</p></div>`;
    return;
  }
  const kps = KPS.filter((k) => (k.topic + k.core + (k.detail || '') + k.cite + (k.bullets || []).join('')).toLowerCase().includes(kw)).slice(0, 20);
  const nums = DB.numbers.filter((n) => (n.k + n.v).toLowerCase().includes(kw)).slice(0, 8);
  const qs = DB.questions.filter((q) => (q.stem + q.options.join('') + q.explain).toLowerCase().includes(kw)).slice(0, 12);
  if (!kps.length && !nums.length && !qs.length) {
    box.innerHTML = `<div class="empty"><div class="ico">∅</div><h3>没有匹配</h3><p class="tiny">换个更短的关键词试试</p></div>`;
    return;
  }
  box.innerHTML =
    (kps.length ? `<div class="chip" style="margin:10px 6px 6px">考点 ${kps.length}</div>` + kps.map((k) =>
      `<div class="list-item" data-kp="${k.id}" style="border-radius:10px">
        <span class="sd-tag" style="color:${chColor(k.chapter)}">${esc((CH.get(k.chapter) || {}).short || '')}</span>
        <div class="li-main"><div class="t">${esc(k.topic)}</div><div class="s">${esc(k.core)}</div></div>
      </div>`).join('') : '') +
    (nums.length ? `<div class="chip" style="margin:14px 6px 6px">数字 ${nums.length}</div>` + nums.map((n) =>
      `<div class="list-item" data-num="${esc(n.k)}" style="border-radius:10px">
        <span class="sd-tag">№</span>
        <div class="li-main"><div class="t">${esc(n.k)}</div><div class="s">${esc(n.v)}</div></div>
      </div>`).join('') : '') +
    (qs.length ? `<div class="chip" style="margin:14px 6px 6px">题目 ${qs.length}</div>` + qs.map((q) =>
      `<div class="list-item" data-q="${q.id}" style="border-radius:10px">
        <span class="sd-tag">${TYPE_NAME[q.type]}</span>
        <div class="li-main"><div class="t">${esc(q.stem.slice(0, 50))}${q.stem.length > 50 ? '…' : ''}</div><div class="s">${esc(q.cite || '')}</div></div>
      </div>`).join('') : '');
}

function openMSearch() {
  const box = $('#msearch');
  box.hidden = false;
  const inp = $('#msearchInput');
  inp.value = '';
  mSearchRender('');
  setTimeout(() => inp.focus(), 60);
}

/* ═══════════ 启动 ═══════════ */
function boot() {
  // 门禁未通过时不启动（gate.js 解锁后会动态加载本文件并再次触发）
  if (window.__GATE && window.__GATE.locked) return;
  if (boot._done) return;
  boot._done = true;
  window.__appStarted = true;
  load(); applyTheme();
  if (!DB.kps.length) {
    $('#boot').innerHTML = '<div class="boot-inner"><p>考点数据未加载。请先在项目根目录运行 <code>node tools/build.mjs</code>。</p></div>';
    return;
  }
  $('#app').hidden = false;
  $('#boot').remove();

  $('#nav').onclick = (e) => { const b = e.target.closest('.nav-item'); if (b) go(b.dataset.view); };
  $('#btnTheme').onclick = toggleTheme;
  $('#btnMenu').onclick = () => $('#rail').classList.toggle('open');
  $('#btnHelp').onclick = showHelp;
  $('#btnReset').onclick = doReset;

  // ── 手机：底部标签栏 ──
  $('#tabbar').onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.more) { showMore(); return; }
    if (b.dataset.view) { go(b.dataset.view); }
  };

  // ── 手机：全屏搜索 ──
  $('#btnMobileSearch').onclick = openMSearch;
  $('#msearchClose').onclick = () => { $('#msearch').hidden = true; };
  const mi = $('#msearchInput');
  let mt = null;
  mi.oninput = () => { clearTimeout(mt); mt = setTimeout(() => mSearchRender(mi.value), 120); };
  mi.onkeydown = (e) => { if (e.key === 'Enter') { const f = $('.list-item', $('#msearchResults')); if (f) f.click(); } };
  $('#msearchResults').onclick = (e) => {
    const it = e.target.closest('[data-kp],[data-q],[data-num]');
    if (!it) return;
    $('#msearch').hidden = true;
    if (it.dataset.kp) { ACT['open-kp']({ dataset: { id: it.dataset.kp } }); return; }
    if (it.dataset.q) { showQuestion(Q.get(it.dataset.q), null); return; }
    if (it.dataset.num) { numFilter.q = it.dataset.num; numFilter.cat = 'all'; go('numbers'); }
  };

  // ── 手机：左右滑动切卡片 ──
  bindSwipe();
  const gs = $('#globalSearch');
  gs.oninput = () => doSearch(gs.value);
  gs.onfocus = () => { if (gs.value) doSearch(gs.value); };
  gs.onkeydown = (e) => {
    if (!searchDrop) return;
    const items = $$('.sd-item', searchDrop);
    if (!items.length) return;
    let idx = items.findIndex((x) => x.classList.contains('sel'));
    if (e.key === 'ArrowDown') { e.preventDefault(); idx = (idx + 1) % items.length; }
    else if (e.key === 'ArrowUp') { e.preventDefault(); idx = (idx - 1 + items.length) % items.length; }
    else return;
    items.forEach((x) => x.classList.remove('sel'));
    items[idx].classList.add('sel');
    items[idx].scrollIntoView({ block: 'nearest' });
  };

  // 注册 Service Worker（仅 https / localhost 生效；局域网 IP 会被浏览器拒绝，属正常）
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || /^(localhost|127\.0\.0\.1)$/.test(location.hostname))) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
    // 新版本接管后自动刷新一次，避免「刷新了还是旧版」
    let swReloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (swReloaded) return;
      swReloaded = true;
      location.reload();
    });
  }

  // 手机浏览器地址栏染色
  const tc = document.querySelector('meta[name="theme-color"]');
  if (tc) tc.setAttribute('content', state.theme === 'dark' ? '#0e1116' : '#3b5bdb');

  go(state.view || 'dash');
}
window.__startApp = boot;

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();

})();
