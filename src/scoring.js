// 채점 (docs/PLAN.md 9절)
import { geoAzimuthalEqualArea, geoCentroid, geoPath, geoArea } from 'd3';

export const GRADES = [
  ['S', 90], ['A', 80], ['B', 70], ['C', 55], ['D', 40], ['F', 0],
];
export const HINT_FACTOR = 0.8;
const EARTH_KM = 6371;
const SMALL_KM = 150; // 이보다 작은 나라는 위치만 채점
const GRID = 160;

export function gradeOf(score) {
  for (const [g, min] of GRADES) if (score >= min) return g;
  return 'F';
}

// 그린 고리(경위도)를 d3가 "작은 쪽"으로 해석하도록 방향을 맞춰요.
export function normalizeRing(ring) {
  const r = ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1] ? ring : [...ring, ring[0]];
  const poly = { type: 'Polygon', coordinates: [r] };
  return geoArea(poly) > 2 * Math.PI ? [...r].reverse() : r;
}

export function drawingToGeometry(strokes) {
  const rings = strokes.filter((s) => s.length >= 3).map(normalizeRing);
  return { type: 'MultiPolygon', coordinates: rings.map((r) => [r]) };
}

// 국가 중심 기준 등적 투영으로 평면 좌표(km) 고리를 얻어요.
function planarRings(geometry, projection) {
  const rings = [];
  let cur = null;
  const ctx = {
    moveTo(x, y) { cur = [[x, y]]; rings.push(cur); },
    lineTo(x, y) { cur.push([x, y]); },
    closePath() {},
    arc() {}, rect() {},
  };
  geoPath(projection, ctx)(geometry);
  return rings.filter((r) => r.length >= 3);
}

function bounds(rings) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of rings) for (const [x, y] of r) {
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return [[x0, y0], [x1, y1]];
}

// 짝홀 규칙으로 격자를 채워요.
function rasterize(rings, box, n) {
  const [[x0, y0], [x1, y1]] = box;
  const cw = (x1 - x0) / n, ch = (y1 - y0) / n;
  const cells = new Uint8Array(n * n);
  const xs = [];
  for (let j = 0; j < n; j++) {
    const y = y0 + (j + 0.5) * ch;
    xs.length = 0;
    for (const r of rings) {
      for (let i = 0, k = r.length - 1; i < r.length; k = i++) {
        const [ax, ay] = r[k], [bx, by] = r[i];
        if ((ay > y) !== (by > y)) xs.push(ax + ((y - ay) / (by - ay)) * (bx - ax));
      }
    }
    xs.sort((a, b) => a - b);
    for (let p = 0; p + 1 < xs.length; p += 2) {
      const from = Math.max(0, Math.ceil((xs[p] - x0) / cw - 0.5));
      const to = Math.min(n - 1, Math.floor((xs[p + 1] - x0) / cw - 0.5));
      for (let i = from; i <= to; i++) cells[j * n + i] ^= 1;
    }
  }
  return cells;
}

function cellCentroid(cells, box, n) {
  const [[x0, y0], [x1, y1]] = box;
  let sx = 0, sy = 0, c = 0;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) if (cells[j * n + i]) {
    sx += i; sy += j; c++;
  }
  if (!c) return null;
  return [x0 + ((sx / c + 0.5) * (x1 - x0)) / n, y0 + ((sy / c + 0.5) * (y1 - y0)) / n];
}

function contains(rings, [px, py]) {
  let inside = false;
  for (const r of rings) {
    for (let i = 0, k = r.length - 1; i < r.length; k = i++) {
      const [ax, ay] = r[k], [bx, by] = r[i];
      if ((ay > py) !== (by > py) && px < ax + ((py - ay) / (by - ay)) * (bx - ax)) inside = !inside;
    }
  }
  return inside;
}

// 0~100 점. 힌트 감점 전 점수예요.
export function scoreDrawing(drawing, country) {
  if (!drawing.coordinates.length) return 0;
  const center = geoCentroid(country);
  const projection = geoAzimuthalEqualArea()
    .rotate([-center[0], -center[1]])
    .scale(EARTH_KM)
    .translate([0, 0])
    .clipAngle(170);
  const target = planarRings(country, projection);
  const drawn = planarRings(drawing, projection);
  if (!drawn.length || !target.length) return 0;

  const tb = bounds(target);
  const radius = Math.hypot(tb[1][0] - tb[0][0], tb[1][1] - tb[0][1]) / 2;
  const tc = [(tb[0][0] + tb[1][0]) / 2, (tb[0][1] + tb[1][1]) / 2];

  // 작은 나라: 그린 영역 중심이 나라에서 얼마나 가까운지만 봐요.
  if (radius < SMALL_KM) {
    const db = bounds(drawn);
    const box = [[Math.min(db[0][0], tb[0][0]), Math.min(db[0][1], tb[0][1])], [Math.max(db[1][0], tb[1][0]), Math.max(db[1][1], tb[1][1])]];
    const dc = cellCentroid(rasterize(drawn, box, GRID), box, GRID) ?? [(db[0][0] + db[1][0]) / 2, (db[0][1] + db[1][1]) / 2];
    if (contains(drawn, tc)) return 100;
    const d = Math.hypot(dc[0] - tc[0], dc[1] - tc[1]);
    return clamp(Math.round(100 * (1 - d / (SMALL_KM * 3))));
  }

  // 큰 나라: 겹치는 정도(IoU)와 위치를 함께 봐요.
  const reach = radius * 4;
  const box = [[tc[0] - reach, tc[1] - reach], [tc[0] + reach, tc[1] + reach]];
  const a = rasterize(target, box, GRID);
  const b = rasterize(drawn, box, GRID);
  let inter = 0, union = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] & b[i]) inter++;
    if (a[i] | b[i]) union++;
  }
  const iou = union ? inter / union : 0;
  const ac = cellCentroid(a, box, GRID) ?? tc;
  const bc = cellCentroid(b, box, GRID);
  const proximity = bc ? Math.max(0, 1 - Math.hypot(bc[0] - ac[0], bc[1] - ac[1]) / (radius * 2)) : 0;
  return clamp(Math.round(100 * (0.7 * Math.sqrt(iou) + 0.3 * proximity)));
}

function clamp(x) {
  return Math.max(0, Math.min(100, x));
}

export function finalScore(raw, hintUsed) {
  return Math.round(hintUsed ? raw * HINT_FACTOR : raw);
}
