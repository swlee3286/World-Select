// 지도 하나를 그리는 화면 부품. 게임 화면과 완성 화면 비교 지도에 같이 써요.
import { geoPath, geoMercator, geoNaturalEarth1, geoArea, zoom, zoomIdentity, select } from 'd3';

const SVGNS = 'http://www.w3.org/2000/svg';
const WORLD_CENTER = 11; // 날짜변경선을 -169°에 둬서 러시아·피지가 갈라지지 않게

export class MapView {
  constructor(svg, { shapes, land, countries, continents, interactive = true }) {
    this.svg = svg;
    this.shapes = shapes; // code -> geometry
    this.land = land;
    this.info = new Map(countries.map((c) => [c.code, c]));
    this.continents = new Map(continents.map((c) => [c.id, c]));
    this.mode = 'world';
    this.strokes = [];
    this.drawEnabled = false;
    this.panMode = false;
    this.onStrokesChange = () => {};
    this.onCountryClick = null;

    svg.innerHTML = '';
    svg.classList.add('map');
    this.root = el('g', { class: 'zoom' }, svg);
    this.gLand = el('g', { class: 'land' }, this.root);
    this.gCountries = el('g', { class: 'countries' }, this.root);
    this.gOverlay = el('g', { class: 'overlay' }, this.root);
    this.gStrokes = el('g', { class: 'strokes' }, this.root);
    this.live = el('polyline', { class: 'stroke live' }, this.root);

    this.transform = zoomIdentity;
    this.zoom = zoom()
      .scaleExtent([0.5, 400])
      .filter((e) => {
        if (e.type === 'wheel' || e.type === 'dblclick') return true;
        if (e.touches) return e.touches.length >= 2 || this.panMode || !this.drawEnabled;
        return (this.panMode || !this.drawEnabled || e.button === 1 || e.button === 2) && !e.ctrlKey;
      })
      .on('zoom', (e) => {
        this.transform = e.transform;
        this.root.setAttribute('transform', e.transform.toString());
        this.svg.style.setProperty('--k', e.transform.k);
      });
    select(svg).call(this.zoom).on('dblclick.zoom', null);
    svg.addEventListener('contextmenu', (e) => e.preventDefault());
    if (interactive) this.#bindDrawing();
    this.#bindClick();

    this.resizeObserver = new ResizeObserver(() => this.#resize());
    this.resizeObserver.observe(svg);
  }

  get size() {
    const r = this.svg.getBoundingClientRect();
    return { width: Math.max(1, r.width), height: Math.max(1, r.height) };
  }

  // 모드(전 세계 / 대륙)에 맞춰 투영을 새로 만들고 다시 그려요.
  setMode(mode, { highlight = true } = {}) {
    this.mode = mode;
    this.highlight = highlight;
    this.#buildProjection();
    this.#render();
    this.reset(false);
  }

  #buildProjection() {
    const { width, height } = this.size;
    this.lastSize = { width, height };
    const pad = Math.min(width, height) * 0.04;
    const extent = [[pad, pad], [width - pad, height - pad]];
    if (this.mode === 'world') {
      this.center = WORLD_CENTER;
      this.projection = geoNaturalEarth1().rotate([-WORLD_CENTER, 0]).fitExtent(extent, { type: 'Sphere' });
    } else {
      const [w, s, e, n] = this.continents.get(this.mode).bounds;
      const corners = { type: 'MultiPoint', coordinates: [[w, s], [e, s], [e, n], [w, n], [(w + e) / 2, s], [(w + e) / 2, n]] };
      this.center = (w + e) / 2;
      this.projection = geoMercator().rotate([-this.center, 0]).fitExtent(extent, corners);
    }
    this.path = geoPath(this.projection);
  }

  #render() {
    this.gLand.replaceChildren();
    this.gCountries.replaceChildren();
    this.countryEls = new Map();
    for (const g of this.land) {
      const d = this.path(g);
      if (d) el('path', { d, class: this.mode === 'world' ? '' : 'dim' }, this.gLand);
    }
    for (const [code, geom] of this.shapes) {
      const d = this.path(geom);
      if (!d) continue;
      const c = this.info.get(code);
      const dim = this.highlight && this.mode !== 'world' && c.continent !== this.mode;
      const p = el('path', { d, class: `country${dim ? ' dim' : ''}`, 'data-code': code }, this.gCountries);
      this.countryEls.set(code, p);
    }
    if (this.colors) this.paint(this.colors);
    this.#renderStrokes();
  }

  #resize() {
    if (!this.projection) return;
    const { width, height } = this.size;
    if (this.lastSize && this.lastSize.width === width && this.lastSize.height === height) return;
    const geoStrokes = this.strokes;
    const t = this.transform;
    this.#buildProjection();
    this.#render();
    this.strokes = geoStrokes;
    this.#renderStrokes();
    this.#applyOverlays();
    select(this.svg).call(this.zoom.transform, t);
  }

  // 그린 나라 칠하기
  paint(colors) {
    this.colors = colors;
    for (const [code, p] of this.countryEls) {
      const color = colors.get(code);
      if (color) p.style.setProperty('--fill', color);
      else p.style.removeProperty('--fill');
      p.classList.toggle('done', !!color);
    }
  }

  // 대륙 맞춤(처음 화면)
  reset(animate = true) {
    this.#zoomTo(zoomIdentity, animate);
  }

  // 화면 좌표(기본 투영 기준) 범위를 꽉 차게 보여줘요.
  fitBox([[x0, y0], [x1, y1]], { animate = true, padding = 0.15, maxScale = 60 } = {}) {
    const { width, height } = this.size;
    const bw = Math.max(1, x1 - x0), bh = Math.max(1, y1 - y0);
    const k = Math.min(maxScale, Math.max(0.5, (1 - padding * 2) * Math.min(width / bw, height / bh)));
    const t = zoomIdentity.translate(width / 2, height / 2).scale(k).translate(-(x0 + x1) / 2, -(y0 + y1) / 2);
    this.#zoomTo(t, animate);
  }

  #zoomTo(t, animate) {
    const s = select(this.svg);
    if (animate) s.transition().duration(600).call(this.zoom.transform, t);
    else s.call(this.zoom.transform, t);
  }

  // 나라의 주요 부분 범위(작은 외딴 섬 제외). 기본 투영 좌표.
  mainBounds(code) {
    const geom = this.shapes.get(code);
    const polys = geom.coordinates.map((c) => ({ type: 'Polygon', coordinates: c }));
    const areas = polys.map(geoArea);
    const max = Math.max(...areas);
    const main = { type: 'MultiPolygon', coordinates: geom.coordinates.filter((_, i) => areas[i] >= max * 0.05) };
    return this.path.bounds(main);
  }

  boundsOf(geometry) {
    return this.path.bounds(geometry);
  }

  // 기본 투영 좌표 범위 → 지금 화면(px) 범위
  toScreen([[x0, y0], [x1, y1]]) {
    const t = this.transform;
    return [[t.applyX(x0), t.applyY(y0)], [t.applyX(x1), t.applyY(y1)]];
  }

  // 지금 화면에 다 보이는지
  isVisible(box) {
    const { width, height } = this.size;
    const [[x0, y0], [x1, y1]] = this.toScreen(box);
    return x0 >= 0 && y0 >= 0 && x1 <= width && y1 <= height;
  }

  // ---- 오버레이: 힌트 원, 정답 윤곽, 다른 그림들 ----
  setHint(circle) {
    this.hint = circle; // 기본 투영 좌표 {cx, cy, r}
    this.#applyOverlays();
  }

  setAnswer(code) {
    this.answer = code;
    this.#applyOverlays();
  }

  setReviewDrawings(list) {
    this.review = list; // [{code, strokes}]
    this.#applyOverlays();
  }

  #applyOverlays() {
    this.gOverlay.replaceChildren();
    if (this.hint) {
      el('circle', { class: 'hint', cx: this.hint.cx, cy: this.hint.cy, r: this.hint.r }, this.gOverlay);
    }
    if (this.answer) {
      el('path', { class: 'answer', d: this.path(this.shapes.get(this.answer)) }, this.gOverlay);
    }
    for (const r of this.review ?? []) {
      for (const s of r.strokes) el('polygon', { class: 'stroke review', points: this.#points(s), 'data-code': r.code }, this.gOverlay);
    }
  }

  // ---- 그리기 ----
  setDrawing(enabled) {
    this.drawEnabled = enabled;
    this.svg.classList.toggle('drawing', enabled && !this.panMode);
  }

  setPanMode(on) {
    this.panMode = on;
    this.svg.classList.toggle('drawing', this.drawEnabled && !on);
  }

  setStrokes(strokes) {
    this.strokes = strokes.map((s) => s.slice());
    this.#renderStrokes();
  }

  undo() {
    this.strokes.pop();
    this.#renderStrokes();
    this.onStrokesChange(this.strokes);
  }

  clear() {
    this.strokes = [];
    this.#renderStrokes();
    this.onStrokesChange(this.strokes);
  }

  #renderStrokes() {
    this.gStrokes.replaceChildren();
    for (const s of this.strokes) {
      el('polygon', { class: 'stroke', points: this.#points(s) }, this.gStrokes);
    }
  }

  // 화면 좌표 → 경위도. 지도 가장자리(날짜변경선) 밖은 가장자리에 붙여서 반대편으로 넘어가지 않게 해요.
  #invert([x, y]) {
    const mid = this.projection([this.center, 0])[0];
    let lat = this.projection.invert([mid, y])?.[1];
    if (!isFinite(lat)) lat = y < this.projection([this.center, 0])[1] ? 89.9 : -89.9;
    lat = Math.max(-89.9, Math.min(89.9, lat));
    const g = this.projection.invert([x, y]);
    if (g && isFinite(g[0])) {
      const back = this.projection(g);
      if (back && Math.hypot(back[0] - x, back[1] - y) < 1) return g;
    }
    const edge = this.center + (x > mid ? 179.9 : -179.9);
    return [((edge + 540) % 360) - 180, lat];
  }

  #points(ring) {
    return ring.map((p) => this.projection(p)).filter(Boolean).map((p) => p.join(',')).join(' ');
  }

  #bindDrawing() {
    let pts = null;
    let pointerId = null;
    const local = (e) => {
      const r = this.svg.getBoundingClientRect();
      return this.transform.invert([e.clientX - r.left, e.clientY - r.top]);
    };
    const touches = new Set();
    this.svg.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') touches.add(e.pointerId);
      if (!this.drawEnabled || this.panMode || e.button !== 0 || touches.size > 1) {
        pts = null;
        this.live.setAttribute('points', '');
        return;
      }
      pointerId = e.pointerId;
      pts = [local(e)];
      this.svg.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    this.svg.addEventListener('pointermove', (e) => {
      if (!pts || e.pointerId !== pointerId) return;
      const p = local(e);
      const last = pts.at(-1);
      // 화면 기준 2px 이상 움직였을 때만 점을 추가
      if (Math.hypot(p[0] - last[0], p[1] - last[1]) * this.transform.k < 2) return;
      pts.push(p);
      this.live.setAttribute('points', pts.map((q) => q.join(',')).join(' '));
    });
    const end = (e) => {
      if (e.pointerType === 'touch') touches.delete(e.pointerId);
      if (!pts || e.pointerId !== pointerId) return;
      const done = pts;
      pts = null;
      this.live.setAttribute('points', '');
      if (done.length < 3) return;
      const geo = done.map((p) => this.#invert(p)).filter((p) => p && isFinite(p[0]) && isFinite(p[1]));
      if (geo.length < 3) return;
      this.strokes.push(geo.map(([x, y]) => [round(x), round(y)]));
      this.#renderStrokes();
      this.onStrokesChange(this.strokes);
    };
    this.svg.addEventListener('pointerup', end);
    this.svg.addEventListener('pointercancel', end);
  }

  #bindClick() {
    this.svg.addEventListener('click', (e) => {
      if (!this.onCountryClick) return;
      const code = e.target.closest?.('[data-code]')?.dataset.code;
      if (code) this.onCountryClick(code);
    });
  }
}

function round(x) {
  return Math.round(x * 1e4) / 1e4;
}

function el(tag, attrs, parent) {
  const n = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  parent?.appendChild(n);
  return n;
}
