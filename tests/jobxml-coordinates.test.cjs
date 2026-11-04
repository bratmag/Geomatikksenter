const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const tcPath = 'C:/Users/mb/Downloads/asfalt 5 - Gemini.jxl';
const taPath = 'C:/ProgramData/Trimble/Trimble Access Emulator 2026.10/Trimble Data/Projects/TA2026.10/asfalt 5 Files/asfalt 5_TA.jxl';
(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  try {
    const page = await browser.newPage();
    await page.route('https://coordinates.test/**', async route => {
      const url = new URL(route.request().url());
      if (url.pathname.startsWith('/geoids/')) return route.fulfill({ body: fs.readFileSync(path.resolve(url.pathname.slice(1))), contentType: 'application/octet-stream' });
      return route.fulfill({ body: '<html><body></body></html>', contentType: 'text/html' });
    });
    await page.goto('https://coordinates.test/');
    await page.addScriptTag({ path: path.resolve('jobxml-coordinates.js') });
    await page.addScriptTag({ path: path.resolve('gemini-jxl.js') });
    const input = {
      tc: fs.readFileSync(tcPath, 'utf8'), ta: fs.readFileSync(taPath, 'utf8'),
      grids: Object.fromEntries(['Norway18B', 'Norway25A'].map(key => [key, fs.readFileSync(`geoids/${key}.ggf`).toString('base64')])),
      fxl: fs.readFileSync(path.resolve('..', 'Support', 'Kaare Mortensen AS', 'SV__Gemini,_segmenterte_linjer', 'Gemini VA kodeliste 20251210 med farger.fxl'), 'utf8')
    };
    const result = await page.evaluate(async ({ tc, ta, grids, fxl }) => {
      const loadGrid = async model => JobXmlCoordinates.readGrid(Uint8Array.from(atob(grids[model.key]), c => c.charCodeAt(0)).buffer, model);
      const actual = await JobXmlCoordinates.prepare(tc, { loadGrid });
      const parser = new DOMParser(), doc = parser.parseFromString(actual.text, 'application/xml'), ref = parser.parseFromString(ta, 'application/xml');
      const errors = [];
      for (const expected of ref.querySelectorAll('Reductions > Point')) {
        const id = expected.querySelector('ID').textContent;
        const p = Array.from(doc.querySelectorAll('Reductions > Point')).find(p => p.querySelector('ID').textContent === id);
        for (const k of ['North', 'East', 'Elevation', 'Latitude', 'Longitude', 'Height']) errors.push({ point: expected.querySelector('Name').textContent, field: k, error: Math.abs(Number(p.querySelector(k).textContent) - Number(expected.querySelector(k).textContent)) });
      }
      const second = await JobXmlCoordinates.prepare(actual.text, { loadGrid: () => { throw Error('should not load'); } });
      const updated = await JobXmlCoordinates.prepare(tc.replace(/NN2000_18B/g, 'NN2000 (Norway25A)'));
      const failures = [];
      const expectFailure = async (name, xml) => {
        try { await JobXmlCoordinates.prepare(xml, { loadGrid }); failures.push({ name, error: '' }); }
        catch (e) { failures.push({ name, error: e.message }); }
      };
      await expectFailure('unknown model', tc.replace(/NN2000_18B/g, 'Unknown'));
      await expectFailure('missing antenna', tc.replace(/<ReducedHeight>[^<]*<\/ReducedHeight>/, '<ReducedHeight/>'));
      await expectFailure('tilt', tc.replace(/<Pitch>0<\/Pitch>/g, '<Pitch>1</Pitch>'));
      await expectFailure('datum', tc.replace('<TranslationX>0</TranslationX>', '<TranslationX>1</TranslationX>'));
      await expectFailure('calibration', tc.replace('<Type>NoAdjustment</Type>', '<Type>Calibration</Type>'));
      const grid = await loadGrid(JobXmlCoordinates.modelFor('norway18b.ggf'));
      for (const [name, lat, lon] of [['outside', 0, 0], ['nodata', 72, 4]]) {
        try { grid(lat, lon); failures.push({ name, error: '' }); } catch (e) { failures.push({ name, error: e.message }); }
      }
      // Reconstruct the pre-zigzag point coding, then exercise fetch -> repair -> zigzag.
      const source = parser.parseFromString(tc, 'application/xml');
      for (const line of Array.from(source.querySelectorAll('LivePolylineRecord'))) {
        const names = [line.querySelector('StartPoint').textContent, ...Array.from(line.querySelectorAll('EndPoint'), n => n.textContent)];
        for (const p of source.querySelectorAll('FieldBook > PointRecord')) if (names.includes(p.querySelector('Name').textContent)) p.appendChild(line.querySelector('Features').cloneNode(true));
        line.remove();
      }
      for (const p of source.querySelectorAll('FieldBook > PointRecord')) {
        const marker = Array.from(p.childNodes).find(n => n.nodeType === 8 && n.data.startsWith(' JobXML zigzag original Code: '));
        if (marker) { p.querySelector('Code').textContent = marker.data.slice(' JobXML zigzag original Code: '.length, -1); marker.remove(); }
      }
      const prepared = await JobXmlCoordinates.prepare(new XMLSerializer().serializeToString(source));
      const pipeline = GeminiJxl.convert(prepared.text, fxl);
      return { actual, errors, unchanged: !second.repaired && second.text === actual.text, updated, failures, pipeline };
    }, input);
    console.log('Maximum differences against TA:', Object.fromEntries(['North', 'East', 'Elevation', 'Latitude', 'Longitude', 'Height'].map(k => [k, Math.max(...result.errors.filter(e => e.field === k).map(e => e.error))])));
    for (const error of result.errors) assert.ok(error.error < (['Latitude', 'Longitude'].includes(error.field) ? 1e-9 : 0.0001), JSON.stringify(error));
    assert.equal(result.actual.points, 12);
    assert.equal(result.actual.model, 'Norway18B');
    assert.equal(result.updated.model, 'Norway25A');
    assert.equal(result.unchanged, true);
    for (const failure of result.failures) assert.ok(failure.error, `Must reject ${failure.name}`);
    assert.deepEqual(result.pipeline.stats, { lines: 5, points: 12, parts: 7 });
    fs.mkdirSync('.local-gemini-test', { recursive: true });
    fs.writeFileSync('.local-gemini-test/asfalt 5 - geoid-kontrollert.jxl', result.pipeline.text);
    console.log('PASS: both models selected, 12 TA reference points, valid reductions preserved, unsupported jobs rejected, complete fetch/repair/zigzag pipeline');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
