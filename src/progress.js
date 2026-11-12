// 진행과 저장 (docs/PLAN.md 4절). DOM에 의존하지 않는 순수 함수들이에요.
import { gradeOf } from './scoring.js';

export const SAVE_KEY = 'world-draw.save';
export const SAVE_VERSION = 2;
export const WORLD = 'world';

export function emptySave() {
  return { version: SAVE_VERSION, results: {}, current: {}, skipped: {}, celebrated: {}, hint: null };
}

// 저장된 문자열(또는 객체)을 현재 구조로 읽어요. 이전 버전은 결과만 옮겨요.
export function loadSave(raw) {
  let data = raw;
  if (typeof raw === 'string') {
    try { data = JSON.parse(raw); } catch { data = null; }
  }
  if (!data || typeof data !== 'object') return emptySave();
  const save = emptySave();
  if (data.results && typeof data.results === 'object') save.results = { ...data.results };
  if (data.version === SAVE_VERSION) {
    save.current = { ...(data.current ?? {}) };
    save.skipped = { ...(data.skipped ?? {}) };
    save.celebrated = { ...(data.celebrated ?? {}) };
    save.hint = data.hint ?? null;
  }
  return save;
}

export function inMode(country, mode) {
  return mode === WORLD || country.continent === mode;
}

// 모드에서 아직 안 그린 나라. 면적순, 건너뛴 나라는 뒤로.
export function remaining(save, countries, mode) {
  const left = countries
    .filter((c) => inMode(c, mode) && !save.results[c.code])
    .sort((a, b) => b.area - a.area);
  const skipped = (save.skipped[mode] ?? []).filter((code) => left.some((c) => c.code === code));
  const front = left.filter((c) => !skipped.includes(c.code)).map((c) => c.code);
  return [...front, ...skipped];
}

// 지금 출제할 나라. 다른 모드에서 이미 그렸으면 다음 나라로 넘어가요.
export function currentQuestion(save, countries, mode) {
  const left = remaining(save, countries, mode);
  const cur = save.current[mode];
  const code = cur && left.includes(cur) ? cur : (left[0] ?? null);
  save.current[mode] = code;
  return code;
}

export function skip(save, countries, mode) {
  const code = currentQuestion(save, countries, mode);
  if (!code) return null;
  const list = (save.skipped[mode] ?? []).filter((c) => c !== code);
  list.push(code);
  save.skipped[mode] = list;
  save.current[mode] = null;
  if (save.hint?.code === code) save.hint = null;
  return currentQuestion(save, countries, mode);
}

export function record(save, code, result) {
  save.results[code] = result;
  for (const mode of Object.keys(save.current)) {
    if (save.current[mode] === code) save.current[mode] = null;
  }
  for (const mode of Object.keys(save.skipped)) {
    save.skipped[mode] = save.skipped[mode].filter((c) => c !== code);
  }
  if (save.hint?.code === code) save.hint = null;
}

export function progress(save, countries, mode) {
  const list = countries.filter((c) => inMode(c, mode));
  const done = list.filter((c) => save.results[c.code]);
  const total = list.length;
  const complete = total > 0 && done.length === total;
  const avg = done.length ? done.reduce((s, c) => s + save.results[c.code].score, 0) / done.length : null;
  return {
    done: done.length,
    total,
    complete,
    average: avg === null ? null : Math.round(avg),
    grade: complete ? gradeOf(avg) : null,
  };
}

// 아직 보여주지 않은 완성 화면들. 대륙들 먼저, 세계는 마지막.
export function pendingCelebrations(save, countries, continentIds) {
  const out = [];
  for (const id of continentIds) {
    if (!save.celebrated[id] && progress(save, countries, id).complete) out.push(id);
  }
  if (!save.celebrated[WORLD] && continentIds.every((id) => progress(save, countries, id).complete)) {
    out.push(WORLD);
  }
  return out;
}

export function markCelebrated(save, id) {
  save.celebrated[id] = true;
}

// 잘 그린 / 못 그린 나라
export function ranking(save, countries, mode, n) {
  const done = countries
    .filter((c) => inMode(c, mode) && save.results[c.code])
    .map((c) => ({ ...c, score: save.results[c.code].score, grade: save.results[c.code].grade }));
  const best = [...done].sort((a, b) => b.score - a.score || b.area - a.area).slice(0, n);
  const worst = [...done].sort((a, b) => a.score - b.score || b.area - a.area).slice(0, n);
  return { best, worst };
}

export function resetContinent(save, countries, id) {
  for (const c of countries) {
    if (inMode(c, id)) delete save.results[c.code];
  }
  save.celebrated[id] = false;
  save.celebrated[WORLD] = false;
  save.current[id] = null;
  save.skipped[id] = [];
}
