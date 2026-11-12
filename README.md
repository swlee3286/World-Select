# 세계지도 그리기

나라 이름을 보고 지도 위에 그 나라를 그리는 게임이에요. 대륙을 골라서 그릴 수 있고, 어느 대륙에서 그리든 같은 세계지도가 채워져요.

기획: [docs/PLAN.md](docs/PLAN.md)

## 실행

빌드 없이 정적 파일로 동작해요. 모듈과 데이터를 `fetch`로 읽기 때문에 로컬 서버가 필요해요.

```sh
npm start          # python3 -m http.server 8000
# http://localhost:8000 열기
```

## 조작

- **그리기**: 지도 위를 드래그하면 닫힌 모양이 돼요. 섬나라는 여러 번 그려도 돼요.
- **이동**: `이동` 버튼, 스페이스바를 누른 채 드래그, 오른쪽/가운데 버튼 드래그, 두 손가락. 확대는 휠이나 핀치.
- `Enter` 제출/다음, `Ctrl+Z` 되돌리기

## 개발

```sh
npm install
npm test             # 진행·저장·채점·힌트 테스트
npm run build:data   # data/ 다시 만들기
npm run build:vendor # vendor/ (d3, topojson) 다시 만들기
```

| 경로 | 내용 |
|---|---|
| `data/countries-ko.json` | 나라 코드, 한국어 이름, 면적, 대륙 |
| `data/continents.json` | 대륙 이름과 확대 범위 |
| `data/world.topo.json` | 국경 모양 |
| `src/progress.js` | 진행·저장 (모드별 다음 문제, 완성 판정) |
| `src/scoring.js` | 채점과 등급 |
| `src/hint.js` | 힌트 원 |
| `src/map.js` | 지도 화면, 그리기 입력 |
| `src/main.js` | 화면 흐름 |
