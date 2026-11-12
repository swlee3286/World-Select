// 힌트: 대략적인 위치를 큰 원으로 표시 (docs/PLAN.md 5절)
// 화면 좌표(px)로 나라 범위를 받아 원을 돌려줘요. 원은 나라를 반드시 포함해요.
export function hintCircle(countryBox, viewport, random = Math.random) {
  const [[x0, y0], [x1, y1]] = countryBox;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const enclose = Math.hypot(x1 - x0, y1 - y0) / 2;
  const r = Math.max(enclose * 2.5, Math.min(viewport.width, viewport.height) * 0.12);
  const angle = random() * Math.PI * 2;
  const dist = random() * (r - enclose) * 0.9;
  return { cx: cx + Math.cos(angle) * dist, cy: cy + Math.sin(angle) * dist, r };
}
