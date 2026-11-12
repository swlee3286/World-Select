// 데이터 생성: data/countries-ko.json, data/world.topo.json
// 실행: npm run build:data
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as tc from 'topojson-client';
import * as ts from 'topojson-server';
import { geoArea, geoCentroid, geoDistance } from 'd3';

const require = createRequire(import.meta.url);
const wc = require('world-countries');
const t50 = require('world-atlas/countries-50m.json');
const t10 = require('world-atlas/countries-10m.json');

// UN 회원국 193 + 바티칸, 팔레스타인, 대만, 코소보 = 197
const EXTRA = ['VAT', 'PSE', 'TWN', 'UNK'];
const selected = wc.filter((c) => c.unMember || EXTRA.includes(c.cca3));

// 규칙: 수도가 있는 대륙 (docs/PLAN.md 7절)
// world-countries의 지역 분류와 다른 나라만 덮어써요.
const CONTINENT_OVERRIDE = {
  RUS: 'europe', // 모스크바
  EGY: 'africa', // 카이로
  TUR: 'asia', KAZ: 'asia', AZE: 'asia', GEO: 'asia', ARM: 'asia',
  CYP: 'asia', // 니코시아
  IDN: 'asia', TLS: 'asia',
  PNG: 'oceania',
  PAN: 'north-america',
  TTO: 'south-america', // 포트오브스페인
};

const NAME_OVERRIDE = {
  TUR: '튀르키예', KOR: '대한민국', PRK: '북한', UNK: '코소보', COD: '콩고민주공화국',
  COG: '콩고공화국', CZE: '체코', GBR: '영국', USA: '미국', VAT: '바티칸',
  PSE: '팔레스타인', TWN: '대만', CIV: '코트디부아르', MKD: '북마케도니아', SWZ: '에스와티니',
  DMA: '도미니카 연방', MNG: '몽골', ZAF: '남아프리카공화국', CAF: '중앙아프리카공화국',
};

function continentOf(c) {
  if (CONTINENT_OVERRIDE[c.cca3]) return CONTINENT_OVERRIDE[c.cca3];
  switch (c.region) {
    case 'Asia': return 'asia';
    case 'Europe': return 'europe';
    case 'Africa': return 'africa';
    case 'Oceania': return 'oceania';
    case 'Americas': return c.subregion === 'South America' ? 'south-america' : 'north-america';
  }
  throw new Error(`대륙 없음: ${c.cca3}`);
}

const code = (c) => (c.cca3 === 'UNK' ? 'XKX' : c.cca3);

const countries = selected
  .map((c) => ({
    code: code(c),
    name: NAME_OVERRIDE[c.cca3] ?? c.translations.kor.common,
    area: c.area,
    continent: continentOf(c),
  }))
  .sort((a, b) => b.area - a.area || a.code.localeCompare(b.code));

// 지도 모양
const f50 = tc.feature(t50, t50.objects.countries).features;
const f10 = tc.feature(t10, t10.objects.countries).features;
const byNum = new Map(selected.map((c) => [c.ccn3, code(c)]));
// 국제적으로 한 나라로 보는 지역은 합쳐요.
const MERGE_BY_NAME = { Somaliland: 'SOM', 'N. Cyprus': 'CYP', Kosovo: 'XKX' };

function assign(features) {
  const out = new Map();
  const background = [];
  for (const f of features) {
    const id = byNum.get(f.id) ?? MERGE_BY_NAME[f.properties.name];
    if (id) {
      if (!out.has(id)) out.set(id, []);
      out.get(id).push(f.geometry);
    } else if (f.properties.name !== 'Antarctica') {
      background.push(f.geometry);
    }
  }
  return { out, background };
}

// 본토에서 멀리 떨어진 해외 영토는 빼요. 그리기 대상은 본토예요.
// (프랑스령 기아나·레위니옹, 네덜란드령 카리브, 칠레의 이스터섬 등)
const DROP_OVERSEAS = ['FRA', 'NLD', 'NZL', 'ZAF', 'CHL'];
const OVERSEAS_KM = 2000;
function dropOverseas(code, polys) {
  if (!DROP_OVERSEAS.includes(code)) return polys;
  const poly = (c) => ({ type: 'Polygon', coordinates: c });
  const main = polys.reduce((a, b) => (geoArea(poly(a)) >= geoArea(poly(b)) ? a : b));
  const center = geoCentroid(poly(main));
  return polys.filter((c) => geoDistance(center, geoCentroid(poly(c))) * 6371 <= OVERSEAS_KM);
}

const a50 = assign(f50);
const a10 = assign(f10);
const playable = {};
for (const c of countries) {
  const geoms = a50.out.get(c.code) ?? a10.out.get(c.code);
  if (!geoms) throw new Error(`모양 없음: ${c.code}`);
  const polys = [];
  for (const g of geoms) {
    if (g.type === 'Polygon') polys.push(g.coordinates);
    else polys.push(...g.coordinates);
  }
  playable[c.code] = { type: 'MultiPolygon', coordinates: dropOverseas(c.code, polys) };
}

const objects = {
  countries: {
    type: 'FeatureCollection',
    features: countries.map((c) => ({ type: 'Feature', id: c.code, properties: {}, geometry: playable[c.code] })),
  },
  land: {
    type: 'FeatureCollection',
    features: a50.background.map((g) => ({ type: 'Feature', properties: {}, geometry: g })),
  },
};
const topo = ts.topology(objects, 1e5);

writeFileSync('data/countries-ko.json', JSON.stringify(countries, null, 1) + '\n');
writeFileSync('data/world.topo.json', JSON.stringify(topo));

const count = {};
for (const c of countries) count[c.continent] = (count[c.continent] ?? 0) + 1;
console.log(countries.length, count);
