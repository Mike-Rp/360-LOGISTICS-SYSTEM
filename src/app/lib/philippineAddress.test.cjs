const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync, readdirSync } = require('node:fs');
const { join } = require('node:path');
const ts = require('typescript');

const index = require('../data/psgcIndex.json');
const source = ts.transpileModule(readFileSync(join(__dirname, 'philippineAddress.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;
const loaded = { exports: {} };
new Function('require', 'module', 'exports', source)((id) => {
  if (id !== '../data/psgcIndex.json') throw Error(`Unexpected import ${id}`);
  return index;
}, loaded, loaded.exports);
const geo = loaded.exports;
const areaDir = join(__dirname, '../../../public/psgc/areas');
const area = (code) => JSON.parse(readFileSync(join(areaDir, `${code}.json`), 'utf8'));

test('September 2026 reference covers all published geographic levels with unique codes and valid parents', () => {
  assert.equal(index.published, '30 September 2026');
  assert.equal(index.regions.length, 18);
  const provinceLike = index.regions.flatMap((region) => region.provinces);
  assert.equal(provinceLike.filter((item) => item.name !== 'Special Geographic Area').length, 82);
  assert.equal(provinceLike.filter((item) => item.name === 'Special Geographic Area').length, 1);
  const independents = index.regions.flatMap((region) => region.independent);
  const codes = [...provinceLike, ...independents].map((item) => item.code);
  assert.equal(new Set(codes).size, codes.length);
  assert.equal(readdirSync(areaDir).filter((name) => name.endsWith('.json')).length, codes.length);
  let cities = 0, municipalities = 0, barangays = 0;
  const allCityCodes = new Set(), allBarangayCodes = new Set();
  for (const code of codes) {
    const file = area(code);
    assert.equal(file.code, code);
    for (const city of file.cities) {
      assert.equal(allCityCodes.has(city.code), false, city.code);
      allCityCodes.add(city.code);
      if (city.type === 'city') cities++; else municipalities++;
      for (const [barangayCode] of city.barangays) {
        if (city.code !== '1380600000') assert.equal(barangayCode.slice(0, 7), city.code.slice(0, 7));
        assert.equal(allBarangayCodes.has(barangayCode), false, barangayCode);
        allBarangayCodes.add(barangayCode);
        barangays++;
      }
    }
  }
  assert.equal(cities, 149);
  assert.equal(municipalities, 1493);
  assert.equal(barangays, 42010);
  assert.equal(area('1001300000').cities.find((city) => city.code === '1001322000')
    .barangays.find(([code]) => code === '1001322005')[1], 'Lambagan');
});

test('cascades reset only their own children and preserve pickup/delivery independence', () => {
  const pickup = { regionCode: '0400000000', provinceCode: '0403400000', cityCode: '0403428000', barangayCode: '0403428002' };
  const delivery = { ...pickup };
  assert.deepEqual(geo.changeGeoSelection(pickup, 'regionCode', '1300000000'),
    { regionCode: '1300000000', provinceCode: '', cityCode: '', barangayCode: '' });
  assert.deepEqual(geo.changeGeoSelection(pickup, 'provinceCode', '0402100000'),
    { regionCode: '0400000000', provinceCode: '0402100000', cityCode: '', barangayCode: '' });
  assert.deepEqual(geo.changeGeoSelection(pickup, 'cityCode', '0403418000'),
    { ...pickup, cityCode: '0403418000', barangayCode: '' });
  assert.equal(delivery.barangayCode, '0403428002');
});

test('Laguna, Cavite, NCR and independent cities resolve with the correct barangay ancestry', () => {
  const santaRosa = { regionCode: '0400000000', provinceCode: '0403400000', cityCode: '0403428000', barangayCode: '0403428002' };
  assert.ok(geo.geoProvinceOptions('0400000000').some((province) => province.name === 'Laguna'));
  assert.equal(geo.geoProvinceOptions('1300000000').length, 0);
  assert.ok(geo.geoCityOptions(santaRosa, area('0403400000')).some((city) => city.name === 'City of Santa Rosa'));
  assert.equal(geo.geoCityOptions(santaRosa, area('0402100000')).length, 0);
  assert.ok(geo.geoCityOptions({ ...santaRosa, provinceCode: '' }, null, 'independent').some((city) => city.name === 'City of Lucena'));
  assert.ok(geo.geoBarangayOptions(santaRosa, area('0403400000')).some((barangay) => barangay.name === 'Balibago'));
  assert.equal(geo.geoBarangayOptions(santaRosa, area('0402100000')).length, 0);
  assert.equal(geo.resolveGeoSelection(santaRosa, area('0403400000')).barangay.name, 'Balibago');
  assert.equal(geo.formatGeoArea(santaRosa, area('0403400000')), 'City of Santa Rosa, Laguna');
  assert.equal(geo.formatGeoLocation('Warehouse A, Industrial Complex', santaRosa, area('0403400000')),
    'Warehouse A, Industrial Complex, Balibago, City of Santa Rosa, Laguna, Region IV-A (CALABARZON)');
  assert.equal(geo.resolveGeoSelection({ ...santaRosa, barangayCode: '1381300001' }, area('0403400000')), null);
  assert.equal(area('0402100000').cities.find((city) => city.code === '0402106000').name, 'City of Dasmariñas');
  const qc = { regionCode: '1300000000', provinceCode: '', cityCode: '1381300000', barangayCode: '1381300001' };
  assert.ok(geo.geoCityOptions(qc, null).some((city) => city.name === 'Quezon City'));
  assert.equal(geo.formatGeoArea(qc, area('1381300000')), 'Quezon City, National Capital Region (NCR)');
  assert.equal(geo.formatGeoLocation('Building 2', qc, area('1381300000')),
    'Building 2, Alicia, Quezon City, National Capital Region (NCR)');
});

test('incomplete or invalid geographic combinations cannot format dispatch fields', () => {
  const incomplete = { regionCode: '0400000000', provinceCode: '0403400000', cityCode: '0403428000', barangayCode: '' };
  assert.ok(geo.geoSelectionErrors(incomplete, area('0403400000'), 'pickup').pickupBarangay);
  assert.equal(geo.formatGeoArea(incomplete, area('0403400000')), '');
  assert.equal(geo.formatGeoLocation('Warehouse', incomplete, area('0403400000')), '');
  assert.ok(geo.geoSelectionErrors(geo.EMPTY_GEO_SELECTION, null, 'delivery').deliveryRegion);
  assert.equal(geo.resolveGeoSelection({ ...incomplete, barangayCode: '0403428002' }, area('0402100000')), null);
});

test('province cities wait for a province, while NCR and explicit independent cities remain available', () => {
  const calabarzon = { regionCode: '0400000000', provinceCode: '', cityCode: '', barangayCode: '' };
  assert.equal(geo.canSelectGeoCity(calabarzon, 'province'), false);
  assert.equal(geo.canSelectGeoCity({ ...calabarzon, provinceCode: '0403400000' }, 'province'), true);
  assert.equal(geo.canSelectGeoCity(calabarzon, 'independent'), true);
  const car = { ...calabarzon, regionCode: '1400000000' };
  assert.equal(geo.canSelectGeoCity(car, 'province'), false);
  assert.equal(geo.canSelectGeoCity(car, 'independent'), true);
  assert.ok(geo.geoCityOptions(car, null, 'independent').some((city) => city.code === '1430300000' && city.name === 'City of Baguio'));
  assert.equal(geo.canSelectGeoCity({ ...car, provinceCode: '1401100000' }, 'province'), true);
  const ncr = { ...car, regionCode: '1300000000' };
  assert.equal(geo.canSelectGeoCity(ncr, 'province'), true);
  assert.equal(geo.canSelectGeoCity(geo.EMPTY_GEO_SELECTION, 'province'), false);
  assert.deepEqual(geo.changeGeoSelection({ ...car, provinceCode: '1401100000', cityCode: 'x', barangayCode: 'y' }, 'provinceCode', ''),
    { ...car, provinceCode: '', cityCode: '', barangayCode: '' });
});

test('official HUC/ICC classification controls independent-city visibility and excludes component cities', () => {
  const options = geo.PSGC_REGIONS.flatMap((region) => geo.geoIndependentCityOptions(region.code));
  assert.equal(options.length, 38, '33 HUCs and five ICCs');
  assert.equal(new Set(options.map((city) => city.code)).size, 38);
  assert.equal(geo.geoIndependentCityOptions('0100000000').some((city) => city.name === 'City of Dagupan'), true);
  assert.equal(geo.geoIndependentCityOptions('0200000000').some((city) => city.name === 'City of Santiago'), true);
  assert.equal(geo.geoIndependentCityOptions('0500000000').some((city) => city.name === 'City of Naga'), true);
  assert.equal(geo.geoIndependentCityOptions('0800000000').some((city) => city.name === 'Ormoc City'), true);
  assert.equal(geo.geoIndependentCityOptions('1900000000').some((city) => city.name === 'City of Cotabato'), true);
  assert.equal(geo.geoIndependentCityOptions('0999999999').length, 0);
  assert.equal(geo.geoIndependentCityOptions('0200000000').some((city) => city.name === 'City of Cauayan'), false);
  assert.equal(geo.geoIndependentCityOptions('0900000000').some((city) => city.name === 'City of Isabela'), false);
  assert.equal(geo.geoRegionCityOptions('0900000000')[0].name, 'City of Isabela');
  assert.equal(geo.geoIndependentCityOptions('1300000000').some((city) => city.name === 'Pateros'), false);
});

test('ICC, NCR, and region-only component city paths retain correct barangays without invented provinces', () => {
  const dagupan = { regionCode: '0100000000', provinceCode: '', cityCode: '0105518000', barangayCode: '0105518001' };
  assert.equal(geo.selectedGeoAreaCode(dagupan), '0105500000');
  assert.ok(geo.geoCityOptions(dagupan, area('0105500000'), 'independent').some((city) => city.code === dagupan.cityCode));
  assert.equal(geo.confirmGeoAddress('Warehouse', dagupan, area('0105500000'), 'independent').areaLabel,
    'City of Dagupan, Region I (Ilocos Region)');
  assert.equal(geo.confirmGeoAddress('Warehouse', dagupan, area('0105500000'), 'province'), null);
  const isabela = { regionCode: '0900000000', provinceCode: '', cityCode: '0990101000', barangayCode: '0990101001' };
  assert.equal(geo.canSelectGeoCity(isabela, 'regionCity'), true);
  assert.equal(geo.geoCityOptions(isabela, area('0990101000'), 'independent').some((city) => city.code === isabela.cityCode), false);
  assert.equal(geo.geoCityOptions(isabela, area('0990101000'), 'regionCity').some((city) => city.code === isabela.cityCode), true);
});
