// build-single.mjs가 src/data.js 대신 넣어요. 데이터가 스크립트 안에 들어가요.
import countries from '../data/countries-ko.json';
import continents from '../data/continents.json';
import topo from '../data/world.topo.json';

export async function loadData() {
  return { countries, continents, topo };
}
