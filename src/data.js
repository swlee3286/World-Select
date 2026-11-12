// 데이터 읽기. 파일 하나로 묶을 때는 scripts/data-embedded.js로 바꿔 끼워요.
export async function loadData() {
  const [countries, continents, topo] = await Promise.all(
    ['data/countries-ko.json', 'data/continents.json', 'data/world.topo.json'].map((u) => fetch(u).then((r) => r.json())),
  );
  return { countries, continents, topo };
}
