import { feature } from 'topojson-client';
import * as P from './progress.js';
import { scoreDrawing, drawingToGeometry, finalScore, gradeOf } from './scoring.js';
import { hintCircle } from './hint.js';
import { MapView } from './map.js';

const GRADE_COLOR = {
  S: '#17784f', A: '#3c9a5f', B: '#6f9a2e', C: '#b88a0f', D: '#d0702a', F: '#c4453a',
};
const $ = (id) => document.getElementById(id);

let countries, continents, shapes, land, byCode, continentIds;
let save;
let mode = null;
let code = null;
let strokes = [];
let answered = false;
let view, celView;

// ---------- 저장 ----------
function readSave() {
  try { return P.loadSave(localStorage.getItem(P.SAVE_KEY)); } catch { return P.emptySave(); }
}
function persist() {
  try { localStorage.setItem(P.SAVE_KEY, JSON.stringify(save)); } catch { /* 저장 불가 환경 */ }
}

function modeName(id) {
  return id === P.WORLD ? '전 세계' : continents.find((c) => c.id === id).name;
}

function show(screen) {
  for (const id of ['start', 'game', 'celebrate']) $(id).hidden = id !== screen;
}

function gradeColors(filter = () => true) {
  const m = new Map();
  for (const [c, r] of Object.entries(save.results)) if (filter(c)) m.set(c, GRADE_COLOR[r.grade]);
  return m;
}

// ---------- 시작 화면 ----------
function renderStart() {
  const box = $('modes');
  box.replaceChildren();
  for (const id of [P.WORLD, ...continentIds]) {
    const p = P.progress(save, countries, id);
    const b = document.createElement('button');
    b.className = `mode${id === P.WORLD ? ' world' : ''}${p.complete ? ' complete' : ''}`;
    b.dataset.mode = id;
    if (p.complete) b.style.setProperty('--g', GRADE_COLOR[p.grade]);
    const pct = Math.round((p.done / p.total) * 100);
    b.innerHTML = `
      <span class="mode-name">${modeName(id)}</span>
      <span class="mode-count"><b>${p.done}</b> / ${p.total}</span>
      ${p.complete ? `<span class="grade-badge" style="--g:${GRADE_COLOR[p.grade]}" title="평균 ${p.average}점">${p.grade}</span>` : ''}
      <span class="meter"><span style="width:${pct}%"></span></span>`;
    b.setAttribute('aria-label', `${modeName(id)} ${p.done} / ${p.total}${p.complete ? `, 평균 등급 ${p.grade}` : ''}`);
    b.addEventListener('click', () => {
      if (p.complete) showCelebrations([id], { review: true });
      else startGame(id);
    });
    box.appendChild(b);
  }
  show('start');
}

// ---------- 게임 화면 ----------
function startGame(m) {
  mode = m;
  show('game');
  view.setMode(mode);
  view.paint(gradeColors());
  $('mode-name').textContent = modeName(mode);
  nextQuestion();
}

function updateBar() {
  const p = P.progress(save, countries, mode);
  $('mode-progress').textContent = `${p.done} / ${p.total}`;
  $('mode-meter').style.width = `${(p.done / p.total) * 100}%`;
}

function nextQuestion() {
  code = P.currentQuestion(save, countries, mode);
  persist();
  updateBar();
  if (!code) {
    renderStart();
    return;
  }
  answered = false;
  strokes = [];
  view.setStrokes([]);
  view.setAnswer(null);
  view.setHint(null);
  view.setDrawing(true);
  $('result').hidden = true;
  $('tools').hidden = false;
  $('question').innerHTML = `<b>${byCode.get(code).name}</b>${objectParticle(byCode.get(code).name)} 그려 보세요`;
  view.reset(false);
  // 대륙 화면 밖으로 나가는 나라(예: 유럽 모드의 러시아)는 그 나라가 다 보이게 넓혀요.
  const box = view.mainBounds(code);
  if (!view.isVisible(box)) {
    const { width, height } = view.size;
    view.fitBox(union(box, [[0, 0], [width, height]]), { animate: false, padding: 0.02 });
  }
  if (save.hint?.code === code) showHint();
  updateTools();
}

function updateTools() {
  $('undo').disabled = !strokes.length;
  $('clear').disabled = !strokes.length;
  $('submit').disabled = !strokes.length;
  $('hint').disabled = save.hint?.code === code;
}

function showHint() {
  const box = view.toScreen(view.mainBounds(code));
  const c = hintCircle(box, view.size);
  const t = view.transform;
  view.setHint({ cx: t.invertX(c.cx), cy: t.invertY(c.cy), r: c.r / t.k });
}

function useHint() {
  if (!code || answered) return;
  save.hint = { code };
  persist();
  showHint();
  updateTools();
}

function submit() {
  if (!code || answered) return;
  if (!strokes.length) return toast('먼저 지도에 그려 주세요');
  const hintUsed = save.hint?.code === code;
  const raw = scoreDrawing(drawingToGeometry(strokes), byCode.get(code).shape);
  const score = finalScore(raw, hintUsed);
  const grade = gradeOf(score);
  const name = byCode.get(code).name;
  P.record(save, code, { score, grade, raw, hintUsed, drawing: strokes, at: new Date().toISOString() });
  persist();
  answered = true;

  view.setDrawing(false);
  view.setAnswer(code);
  view.setHint(null);
  view.paint(gradeColors());
  const drawnBox = view.boundsOf(drawingToGeometry(strokes));
  view.fitBox(union(view.mainBounds(code), drawnBox), { padding: 0.12 });

  $('tools').hidden = true;
  $('result').hidden = false;
  $('result-grade').textContent = grade;
  $('result-grade').style.setProperty('--g', GRADE_COLOR[grade]);
  $('result-name').textContent = name;
  $('result-score').textContent = hintUsed ? `${score}점 (힌트 사용: ${raw}점의 80%)` : `${score}점`;
  $('question').innerHTML = `<b>${name}</b> · ${grade}`;
  updateBar();
  $('next').focus();
}

function afterAnswer() {
  const pending = P.pendingCelebrations(save, countries, continentIds);
  if (pending.length) showCelebrations(pending);
  else nextQuestion();
}

// ---------- 완성 화면 ----------
let celQueue = [];
let celReview = false;
let celId = null;

function showCelebrations(queue, { review = false } = {}) {
  celQueue = [...queue];
  celReview = review;
  showNextCelebration();
}

function showNextCelebration() {
  const id = celQueue.shift();
  if (!id) {
    // 대륙 완성 화면을 다 보면, 지금 모드에 남은 나라가 있으면 계속, 없으면 대륙 선택으로
    if (!celReview && mode && P.remaining(save, countries, mode).length) {
      show('game');
      nextQuestion();
    } else {
      renderStart();
    }
    return;
  }
  celId = id;
  P.markCelebrated(save, id);
  persist();
  show('celebrate');

  const isWorld = id === P.WORLD;
  const p = P.progress(save, countries, id);
  $('cel-kicker').textContent = celReview ? '다 그린 대륙' : '축하해요!';
  $('cel-title').textContent = isWorld ? '세계지도 완성' : `${modeName(id)} 완성`;
  $('cel-grade').textContent = p.grade;
  $('cel-grade').style.setProperty('--g', GRADE_COLOR[p.grade]);
  $('cel-avg').textContent = `평균 ${p.average}점 · ${p.total}개국`;

  const chips = $('cel-continents');
  chips.replaceChildren();
  chips.hidden = !isWorld;
  if (isWorld) {
    for (const cid of continentIds) {
      const cp = P.progress(save, countries, cid);
      const s = document.createElement('span');
      s.className = 'chip';
      s.innerHTML = `${modeName(cid)} <b style="--g:${GRADE_COLOR[cp.grade]}">${cp.grade}</b>`;
      chips.appendChild(s);
    }
  }

  const { best, worst } = P.ranking(save, countries, id, isWorld ? 5 : 3);
  fillRank($('cel-best'), best);
  fillRank($('cel-worst'), worst);

  celView.setMode(id, { highlight: true });
  const inMode = (c) => P.inMode(byCode.get(c), id);
  celView.paint(gradeColors(inMode));
  celView.setReviewDrawings(
    countries.filter((c) => P.inMode(c, id) && save.results[c.code]).map((c) => ({ code: c.code, strokes: save.results[c.code].drawing ?? [] })),
  );
  celView.setAnswer(null);
  $('cel-focus').textContent = '나라를 누르면 그 나라만 크게 비교해요.';

  $('cel-redo').hidden = isWorld;
  $('cel-next').textContent = celQueue.length ? '다음' : (!celReview && mode && P.remaining(save, countries, mode).length ? '계속 그리기' : '대륙 선택으로');
  $('cel-next').focus();
}

function fillRank(ol, list) {
  ol.replaceChildren();
  for (const c of list) {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.innerHTML = `<span class="grade-badge sm" style="--g:${GRADE_COLOR[c.grade]}">${c.grade}</span><span>${c.name}</span><span class="muted">${c.score}점</span>`;
    b.addEventListener('click', () => focusCel(c.code));
    li.appendChild(b);
    ol.appendChild(li);
  }
}

function focusCel(c) {
  const r = save.results[c];
  if (!r) return;
  celView.setAnswer(c);
  const strokesBox = r.drawing?.length ? celView.boundsOf(drawingToGeometry(r.drawing)) : null;
  const box = strokesBox ? union(celView.mainBounds(c), strokesBox) : celView.mainBounds(c);
  celView.fitBox(box, { padding: 0.15 });
  $('cel-focus').innerHTML = `<b>${byCode.get(c).name}</b> · ${r.grade} · ${r.score}점${r.hintUsed ? ' (힌트)' : ''} <button class="link" id="cel-all">전체 보기</button>`;
  $('cel-all').addEventListener('click', () => {
    celView.setAnswer(null);
    celView.reset();
    $('cel-focus').textContent = '나라를 누르면 그 나라만 크게 비교해요.';
  });
}

// ---------- 공통 ----------
function objectParticle(word) {
  const ch = word.charCodeAt(word.length - 1);
  if (ch < 0xac00 || ch > 0xd7a3) return '을(를)';
  return (ch - 0xac00) % 28 ? '을' : '를';
}

function union(a, b) {
  return [[Math.min(a[0][0], b[0][0]), Math.min(a[0][1], b[0][1])], [Math.max(a[1][0], b[1][0]), Math.max(a[1][1], b[1][1])]];
}

let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 1800);
}

function setPan(on) {
  view.setPanMode(on);
  $('tool-draw').classList.toggle('on', !on);
  $('tool-pan').classList.toggle('on', on);
  $('tool-draw').setAttribute('aria-pressed', String(!on));
  $('tool-pan').setAttribute('aria-pressed', String(on));
}

function bind() {
  view.onStrokesChange = (s) => { strokes = s.map((x) => x.slice()); updateTools(); };
  $('back').addEventListener('click', renderStart);
  $('tool-draw').addEventListener('click', () => setPan(false));
  $('tool-pan').addEventListener('click', () => setPan(true));
  $('undo').addEventListener('click', () => view.undo());
  $('clear').addEventListener('click', () => view.clear());
  $('fit').addEventListener('click', () => view.reset());
  $('hint').addEventListener('click', useHint);
  $('skip').addEventListener('click', () => {
    P.skip(save, countries, mode);
    nextQuestion();
  });
  $('submit').addEventListener('click', submit);
  $('next').addEventListener('click', afterAnswer);
  $('cel-next').addEventListener('click', showNextCelebration);
  $('cel-redo').addEventListener('click', () => {
    if (!confirm(`${modeName(celId)}의 기록을 지우고 처음부터 다시 그릴까요?`)) return;
    P.resetContinent(save, countries, celId);
    persist();
    celQueue = [];
    startGame(celId);
  });
  $('reset-all').addEventListener('click', () => {
    if (!confirm('모든 기록을 지울까요? 되돌릴 수 없어요.')) return;
    save = P.emptySave();
    persist();
    renderStart();
  });
  celView.onCountryClick = (c) => focusCel(c);

  let spacePan = false;
  document.addEventListener('keydown', (e) => {
    if ($('game').hidden) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      if (answered) afterAnswer();
      else submit();
    } else if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
      e.preventDefault();
      if (!answered) view.undo();
    } else if (e.key === ' ' && !spacePan) {
      e.preventDefault();
      spacePan = true;
      setPan(true);
    }
  });
  document.addEventListener('keyup', (e) => {
    if (e.key === ' ' && spacePan) {
      spacePan = false;
      setPan(false);
    }
  });
}

async function init() {
  const [c, k, topo] = await Promise.all(
    ['data/countries-ko.json', 'data/continents.json', 'data/world.topo.json'].map((u) => fetch(u).then((r) => r.json())),
  );
  countries = c;
  continents = k;
  continentIds = continents.map((x) => x.id);
  shapes = new Map(feature(topo, topo.objects.countries).features.map((f) => [f.id, f.geometry]));
  land = feature(topo, topo.objects.land).features.map((f) => f.geometry);
  byCode = new Map(countries.map((x) => [x.code, { ...x, shape: shapes.get(x.code) }]));
  save = readSave();

  const opts = { shapes, land, countries, continents };
  view = new MapView($('map'), opts);
  celView = new MapView($('cel-map'), { ...opts, interactive: false });
  bind();
  $('loading').remove();
  renderStart();
}

init();
