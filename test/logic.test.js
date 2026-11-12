import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { feature } from 'topojson-client';
import * as P from '../src/progress.js';
import { scoreDrawing, drawingToGeometry, gradeOf, finalScore } from '../src/scoring.js';
import { hintCircle } from '../src/hint.js';

const countries = JSON.parse(readFileSync('data/countries-ko.json', 'utf8'));
const continents = JSON.parse(readFileSync('data/continents.json', 'utf8'));
const topo = JSON.parse(readFileSync('data/world.topo.json', 'utf8'));
const shapes = new Map(feature(topo, topo.objects.countries).features.map((f) => [f.id, f.geometry]));
const ids = continents.map((c) => c.id);
const res = (score) => ({ score, grade: gradeOf(score), hintUsed: false, drawing: [] });

test('데이터: 197개국, 대륙 6개, 두 대륙 걸친 나라는 수도 기준', () => {
  assert.equal(countries.length, 197);
  const by = Object.fromEntries(countries.map((c) => [c.code, c.continent]));
  assert.equal(by.RUS, 'europe');
  assert.equal(by.EGY, 'africa');
  assert.equal(by.TUR, 'asia');
  assert.equal(by.CYP, 'asia');
  assert.equal(by.TTO, 'south-america');
  assert.equal(by.PAN, 'north-america');
  assert.equal(by.PNG, 'oceania');
  for (const c of countries) assert.ok(ids.includes(c.continent), c.code);
  for (const c of countries) assert.ok(shapes.has(c.code), c.code);
  assert.equal(new Set(countries.map((c) => c.name)).size, 197, '이름 중복 없음');
});

test('대륙 모드는 그 대륙 나라만 면적순으로', () => {
  const s = P.emptySave();
  const left = P.remaining(s, countries, 'europe');
  assert.equal(left[0], 'RUS');
  assert.ok(left.every((code) => countries.find((c) => c.code === code).continent === 'europe'));
  assert.equal(P.remaining(s, countries, 'world').length, 197);
});

test('유럽에서 그린 나라는 전 세계에서 다시 나오지 않아요', () => {
  const s = P.emptySave();
  assert.equal(P.currentQuestion(s, countries, 'world'), 'RUS');
  P.record(s, 'RUS', res(80));
  assert.equal(P.currentQuestion(s, countries, 'world'), 'CAN');
  assert.ok(!P.remaining(s, countries, 'world').includes('RUS'));
  assert.equal(P.progress(s, countries, 'world').done, 1);
  assert.equal(P.progress(s, countries, 'europe').done, 1);
});

test('대륙을 바꿨다 돌아오면 그 나라부터', () => {
  const s = P.emptySave();
  P.currentQuestion(s, countries, 'europe');
  P.record(s, 'RUS', res(80));
  assert.equal(P.currentQuestion(s, countries, 'europe'), 'UKR');
  assert.equal(P.currentQuestion(s, countries, 'asia'), 'CHN');
  P.record(s, 'CHN', res(70));
  assert.equal(P.currentQuestion(s, countries, 'europe'), 'UKR');
  // 다른 모드에서 그 나라를 그려 버리면 다음 나라로
  P.record(s, 'UKR', res(70));
  assert.equal(P.currentQuestion(s, countries, 'europe'), 'FRA');
});

test('건너뛴 나라는 뒤로', () => {
  const s = P.emptySave();
  P.currentQuestion(s, countries, 'south-america');
  assert.equal(P.skip(s, countries, 'south-america'), 'ARG');
  assert.equal(P.remaining(s, countries, 'south-america').at(-1), 'BRA');
});

test('완성: 전 세계 모드에서 대륙 마지막 나라를 그려도 대륙 완성, 대륙과 세계 동시 완성은 순서대로', () => {
  const s = P.emptySave();
  for (const c of countries) if (c.code !== 'NRU') P.record(s, c.code, res(90));
  let pend = P.pendingCelebrations(s, countries, ids);
  assert.deepEqual(pend, ['asia', 'europe', 'africa', 'north-america', 'south-america']);
  pend.forEach((id) => P.markCelebrated(s, id));
  P.record(s, 'NRU', res(50));
  assert.deepEqual(P.pendingCelebrations(s, countries, ids), ['oceania', 'world']);
  ['oceania', 'world'].forEach((id) => P.markCelebrated(s, id));
  const again = P.loadSave(JSON.stringify(s));
  assert.deepEqual(P.pendingCelebrations(again, countries, ids), []);
  const p = P.progress(s, countries, 'oceania');
  assert.equal(p.complete, true);
  assert.equal(p.grade, gradeOf(p.average));
});

test('평균 등급은 점수 평균으로', () => {
  const s = P.emptySave();
  const sa = countries.filter((c) => c.continent === 'south-america');
  sa.forEach((c, i) => P.record(s, c.code, res(i % 2 ? 100 : 60)));
  const p = P.progress(s, countries, 'south-america');
  assert.equal(p.average, Math.round((7 * 60 + 6 * 100) / 13));
  assert.equal(p.grade, 'B');
});

test('이전 저장 데이터를 불러와도 기록 유지', () => {
  const old = JSON.stringify({ results: { FRA: res(77) }, somethingOld: 1 });
  const s = P.loadSave(old);
  assert.equal(s.version, 2);
  assert.equal(s.results.FRA.score, 77);
  assert.deepEqual(P.loadSave('깨진 데이터'), P.emptySave());
});

test('대륙 다시 그리기는 그 대륙 기록만 지워요', () => {
  const s = P.emptySave();
  P.record(s, 'FRA', res(80));
  P.record(s, 'CHN', res(80));
  P.markCelebrated(s, 'world');
  P.resetContinent(s, countries, 'europe');
  assert.ok(!s.results.FRA);
  assert.ok(s.results.CHN);
  assert.equal(s.celebrated.world, false);
});

test('힌트: 감점 정확히 20%', () => {
  assert.equal(finalScore(90, true), 72);
  assert.equal(finalScore(90, false), 90);
});

test('힌트 원은 나라를 포함하고 섬나라에도 충분히 커요', () => {
  const vp = { width: 1000, height: 600 };
  for (const box of [[[500, 300], [502, 301]], [[100, 100], [400, 300]]]) {
    for (let i = 0; i < 200; i++) {
      const c = hintCircle(box, vp);
      assert.ok(c.r >= 72);
      for (const [x, y] of [box[0], box[1], [box[0][0], box[1][1]], [box[1][0], box[0][1]]]) {
        assert.ok(Math.hypot(x - c.cx, y - c.cy) <= c.r + 1e-9);
      }
    }
  }
});

function ringOf(geom) {
  // 가장 큰 고리를 그림처럼 사용
  return geom.coordinates.map((p) => p[0]).sort((a, b) => b.length - a.length)[0];
}

test('채점: 정답 모양은 높고, 엉뚱한 곳은 낮아요', () => {
  const fra = shapes.get('FRA');
  const good = scoreDrawing(drawingToGeometry([ringOf(fra)]), fra);
  assert.ok(good >= 85, `good=${good}`);
  const rev = scoreDrawing(drawingToGeometry([[...ringOf(fra)].reverse()]), fra);
  assert.equal(rev, good, '그리는 방향과 상관없음');
  const far = scoreDrawing(drawingToGeometry([[[100, 10], [110, 10], [110, 20], [100, 20]]]), fra);
  assert.equal(far, 0);
  const box = scoreDrawing(drawingToGeometry([[[-4, 43], [8, 43], [8, 51], [-4, 51]]]), fra);
  assert.ok(box > 40 && box < good, `box=${box}`);
  const rus = shapes.get('RUS');
  assert.ok(scoreDrawing(drawingToGeometry([ringOf(rus)]), rus) >= 80);
});

test('채점: 작은 나라는 위치로', () => {
  const vat = shapes.get('VAT');
  assert.equal(scoreDrawing(drawingToGeometry([[[12.3, 41.8], [12.6, 41.8], [12.6, 42], [12.3, 42]]]), vat), 100);
  const near = scoreDrawing(drawingToGeometry([[[14, 41], [14.5, 41], [14.5, 41.5], [14, 41.5]]]), vat);
  assert.ok(near > 30 && near < 100, `near=${near}`);
});
