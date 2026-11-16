// Run with NODE_PATH pointing to the bundled node_modules (Playwright).
// Fixtures remain outside the repository; pass their root as the first argument.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const read = p => fs.readFileSync(p, 'utf8');
const fixtureRoot = process.argv[2] || path.resolve('..', 'Trimble Access');
const support = path.resolve('..', 'Support', 'Kaare Mortensen AS');
const testdata = path.join(fixtureRoot, 'Gemini-JXL-normalisering', 'testdata');
(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  try {
    const page = await browser.newPage();
    await page.addScriptTag({ path: path.resolve('gemini-jxl.js') });
    const fxl = read(path.join(support, 'SV__Gemini,_segmenterte_linjer', 'Gemini VA kodeliste 20251210 med farger.fxl'));
    for (const [name, file] of [['original', path.join(support, 'SV__Gemini,_segmenterte_linjer', 'asfalt start 202611.jxl')], ['diagnose', path.join(support, 'zigzag diagnose.jxl')]]) {
      const result = await page.evaluate(({ source, fxl, expected }) => {
        const actual = GeminiJxl.convert(source, fxl);
        const parser = new DOMParser();
        const signature = n => [n.nodeType, n.nodeName, n.nodeType === 1 ? Array.from(n.attributes).map(a => [a.name, a.value]).sort() : n.nodeValue, Array.from(n.childNodes).map(signature)];
        const sig = xml => JSON.stringify(signature(parser.parseFromString(xml, 'application/xml').documentElement));
        const actualDoc = parser.parseFromString(actual.text, 'application/xml');
        const sourceDoc = parser.parseFromString(source, 'application/xml');
        const points = doc => Array.from(doc.querySelectorAll('FieldBook > PointRecord, Reductions > Point'));
        const preserved = points(sourceDoc).every((p, i) => {
          const before = p.querySelector('Features');
          const after = points(actualDoc)[i].querySelector('Features');
          return (before?.outerHTML || '') === (after?.outerHTML || '');
        });
        for (const p of points(actualDoc)) if (p.querySelector('Code')?.textContent === '') p.querySelector('Features')?.remove();
        return { equal: sig(new XMLSerializer().serializeToString(actualDoc)) === sig(expected), preserved, stats: actual.stats };
      }, { source: read(file), fxl, expected: read(path.join('.local-gemini-test', `${name}-expected.jxl`)) });
      assert.equal(result.equal, true, `${name}: complete XML must match verified XSLT`);
      assert.equal(result.preserved, true);
      assert.equal(result.stats.lines, 27);
      if (name === 'original') assert.deepEqual(result.stats, { lines: 27, points: 142, parts: 115 });
      console.log(`PASS ${name}: complete XML matches verified XSLT`, result.stats);
    }
    const library = read(path.join(testdata, 'test-library.fxl'));
    const interleaved = read(path.join(testdata, 'interleaved.jxl'));
    const conflict = await page.evaluate(({ xml, fxl }) => {
      const out = GeminiJxl.convert(xml, fxl);
      const parse = s => new DOMParser().parseFromString(s, 'application/xml');
      const source = parse(xml), doc = parse(out.text);
      const pointFeatures = d => Array.from(d.querySelectorAll('PointRecord > Features'), f => f.outerHTML);
      return { before: pointFeatures(source), after: pointFeatures(doc), lineAttributes: doc.querySelectorAll('LivePolylineRecord Attribute').length, lines: out.stats.lines };
    }, { xml: read(path.join(testdata, 'attribute-conflict.jxl')), fxl: library });
    assert.deepEqual(conflict.after, conflict.before);
    assert.equal(conflict.lines, 1);
    assert.equal(conflict.lineAttributes, 0);
    const singleton = await page.evaluate(({ xml, fxl }) => GeminiJxl.convert(xml, fxl), { xml: read(path.join(testdata, 'single-point.jxl')), fxl: library });
    assert.equal(singleton.stats.lines, 0);
    const orders = await page.evaluate(({ xml, fxl }) => {
      const out = GeminiJxl.convert(xml, fxl);
      const doc = new DOMParser().parseFromString(out.text, 'application/xml');
      return Array.from(doc.querySelectorAll('LivePolylineRecord')).map(n => [n.querySelector('StartPoint').textContent, ...Array.from(n.querySelectorAll('EndPoint'), p => p.textContent)].join(','));
    }, { xml: interleaved, fxl: library });
    assert.deepEqual(orders, ['P1,P3', 'P5,P6', 'P7,P8,P7', 'P2,P4']);
    const spacedCodes = await page.evaluate(({ xml, fxl }) => {
      const parser = new DOMParser();
      const job = parser.parseFromString(xml, 'application/xml');
      const definitions = parser.parseFromString(fxl, 'application/xml');
      for (const node of job.querySelectorAll('Code, Feature')) {
        if (node.localName === 'Code') node.textContent = node.textContent.replace(/^AB/, 'Eks kabel');
        else node.setAttribute('Name', node.getAttribute('Name').replace(/^AB/, 'Eks kabel'));
      }
      for (const node of definitions.querySelectorAll('[Code]')) {
        node.setAttribute('Code', node.getAttribute('Code').replace(/^AB/, 'Eks kabel'));
      }
      const serializer = new XMLSerializer();
      const out = GeminiJxl.convert(serializer.serializeToString(job), serializer.serializeToString(definitions));
      return Array.from(parser.parseFromString(out.text, 'application/xml').querySelectorAll('LivePolylineRecord'), line =>
        [line.querySelector('Code').textContent, line.querySelector('StartPoint').textContent,
          ...Array.from(line.querySelectorAll('EndPoint'), point => point.textContent)]);
    }, { xml: interleaved, fxl: library });
    assert.deepEqual(spacedCodes, orders.map(order => ['Eks kabel', ...order.split(',')]));
    const renamedCodes = await page.evaluate(({ xml, fxl }) => {
      const parser = new DOMParser(), job = parser.parseFromString(xml, 'application/xml');
      const definitions = parser.parseFromString(fxl, 'application/xml');
      for (const node of job.querySelectorAll('Code')) node.textContent = node.textContent.replace(/^AB/, 'Eks_kabel');
      for (const node of job.querySelectorAll('Feature')) node.setAttribute('Name', node.getAttribute('Name').replace(/^AB/, 'Eks kabel'));
      for (const node of definitions.querySelectorAll('[Code]')) node.setAttribute('Code', node.getAttribute('Code').replace(/^AB/, 'Eks_kabel'));
      const serializer = new XMLSerializer();
      const out = GeminiJxl.convert(serializer.serializeToString(job), serializer.serializeToString(definitions));
      const doc = parser.parseFromString(out.text, 'application/xml');
      return { lines: Array.from(doc.querySelectorAll('LivePolylineRecord > Features > Feature'), f => f.getAttribute('Name')), point: doc.querySelector('PointRecord > Features > Feature').getAttribute('Name'), realPointCode: doc.querySelector('PointRecord[ID="9"] > Code').textContent };
    }, { xml: interleaved, fxl: library });
    assert.deepEqual(renamedCodes.lines, ['Eks_kabel', 'Eks_kabel', 'Eks_kabel', 'Eks_kabel']);
    assert.equal(renamedCodes.point, 'Eks kabel');
    assert.equal(renamedCodes.realPointCode, 'Eks_kabel12');
    for (const name of ['unsupported-arc']) {
      const error = await page.evaluate(({ xml, fxl }) => { try { GeminiJxl.convert(xml, fxl); return ''; } catch (e) { return e.message; } }, { xml: read(path.join(testdata, `${name}.jxl`)), fxl: library });
      assert.match(error, /Punkt .*streng/);
      console.log(`PASS ${name}: ${error}`);
    }
    const rejected = await page.evaluate(({ xml, fxl }) => {
      const converted = GeminiJxl.convert(xml, fxl);
      try { GeminiJxl.convert(converted.text, fxl); return false; } catch { return true; }
    }, { xml: interleaved, fxl: library });
    assert.equal(rejected, true);
    console.log('PASS independent FXL, stream order, Start/End/Close, repeat conversion rejected');
    const actions = [], errors = [];
    let files = [{ id: 'fxl-1', name: 'library.fxl', path: 'Kodelister' }];
    let sourceXml = interleaved;
    let sources = [{ id: 'job', name: 'Testjobb', sourceType: 'field-data', modifiedOn: '2026-11-04T10:00:00Z', job: { id: 'job', name: 'Testjobb' } }];
    await page.addInitScript(() => {
      window.TrimbleConnectWorkspace = { connect: async () => ({
        extension: { requestPermission: async () => 'test-token', setStatusMessage: async () => {} },
        project: { getCurrentProject: async () => ({ id: 'project', name: 'Test', location: 'europe' }) }
      }) };
    });
    page.on('pageerror', e => errors.push(e.message));
    await page.route('http://geomatikksenter.test/**', async route => {
      const url = new URL(route.request().url());
      if (url.pathname === '/.netlify/functions/tc-proxy') {
        const body = route.request().postDataJSON(); actions.push(body);
        let result;
        if (body.action === 'listJxlSources') result = { ok: true, sources };
        else if (body.action === 'listProjectExplorer') result = { ok: true, files };
        else if (body.action === 'getFieldDataJxl') result = { ok: true, text: sourceXml, jxlFile: { fileName: 'testjobb.jxl' } };
        else if (body.action === 'downloadKofFile') result = { ok: true, text: library };
        else throw new Error(`Unexpected action: ${body.action}`);
        return route.fulfill({ json: result });
      }
      const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      if (['index.html', 'app.js', 'gemini-jxl.js', 'jobxml-coordinates.js'].includes(name)) return route.fulfill({ body: read(name), contentType: name.endsWith('.js') ? 'text/javascript' : 'text/html' });
      return route.fulfill({ status: 404, body: '' });
    });
    await page.route('https://components.connect.trimble.com/**', route => route.fulfill({ body: '', contentType: 'text/javascript' }));
    await page.goto('http://geomatikksenter.test/');
    await page.waitForFunction(() => window.kof2txt && !kof2txt.state.busy && kof2txt.state.geminiFxlFiles.length === 1);
    await page.getByRole('button', { name: 'Feltdata', exact: true }).click();
    const button = page.getByRole('button', { name: 'JobXML zigzag', exact: true });
    assert.equal(await button.isEnabled(), true);
    assert.equal(await page.getByLabel('Kodeliste for JobXML zigzag').inputValue(), '');
    const downloadPromise = page.waitForEvent('download');
    await button.click();
    assert.equal((await downloadPromise).suggestedFilename(), 'testjobb - Gemini.jxl');
    assert.equal(actions.some(a => /upload/i.test(a.action)), false);
    sources = [...sources, { id: 'old', name: 'Jobb 10', modifiedOn: '2026-10-01T10:00:00Z' }, { id: 'new', name: 'Asfalt 5', modifiedOn: '2026-11-04T12:00:00Z' }, { id: 'missing', name: 'Jobb 2', modifiedOn: null }];
    await page.getByRole('button', { name: 'Oppdater feltdata', exact: true }).click();
    await page.waitForFunction(() => !kof2txt.state.busy && kof2txt.state.jxlSources.length === 4);
    const names = () => page.locator('.file-list .file-item:visible .file-name').allTextContents();
    assert.deepEqual(await names(), ['Asfalt 5', 'Testjobb', 'Jobb 10', 'Jobb 2']);
    await page.getByRole('combobox', { name: 'Sorter feltjobber' }).selectOption('date-asc');
    assert.deepEqual(await names(), ['Jobb 10', 'Testjobb', 'Asfalt 5', 'Jobb 2']);
    await page.getByRole('combobox', { name: 'Sorter feltjobber' }).selectOption('name-asc');
    assert.deepEqual(await names(), ['Asfalt 5', 'Jobb 2', 'Jobb 10', 'Testjobb']);
    await page.getByRole('combobox', { name: 'Sorter feltjobber' }).selectOption('name-desc');
    assert.deepEqual(await names(), ['Testjobb', 'Jobb 10', 'Jobb 2', 'Asfalt 5']);
    await page.getByRole('searchbox', { name: 'Søk etter jobbnavn' }).fill('ASFALT');
    assert.deepEqual(await names(), ['Asfalt 5']);
    await page.getByRole('searchbox', { name: 'Søk etter jobbnavn' }).fill('');
    sources = sources.slice(0, 1);
    console.log('PASS sorting: date both directions, missing dates last, natural names both directions, search');
    files = [...files, { id: 'fxl-2', name: 'other.fxl', path: 'Andre' }];
    await page.getByRole('button', { name: 'Oppdater feltdata', exact: true }).click();
    await page.waitForFunction(() => !kof2txt.state.busy && kof2txt.state.geminiFxlFiles.length === 2);
    await page.getByLabel('Kodeliste for JobXML zigzag').selectOption('');
    await button.click();
    await page.getByText('JobXML zigzag: JXL mangler henvisning til kodeliste. Velg en FXL-kodeliste manuelt.', { exact: true }).waitFor();
    sourceXml = interleaved.replace('</JOBFile>', '<Environment><AssociatedFiles><FeatureCodeLibrary>C:\\Trimble Data\\other.fxl</FeatureCodeLibrary></AssociatedFiles></Environment></JOBFile>');
    const automaticDownload = page.waitForEvent('download');
    await button.click();
    await automaticDownload;
    assert.equal(actions.filter(a => a.action === 'downloadKofFile').at(-1).fileId, 'fxl-2');
    sourceXml = interleaved.replace('</JOBFile>', '<Environment><AssociatedFiles><FeatureCodeLibrary>missing.fxl</FeatureCodeLibrary></AssociatedFiles></Environment></JOBFile>');
    await button.click();
    await page.waitForFunction(() => !kof2txt.state.busy);
    assert.match(await page.locator('.status').textContent(), /Jobben bruker «missing.fxl»/);
    const reference = await page.evaluate(() => GeminiJxl.referencedFxl('<JOBFile><FieldBook><FeatureCodingRecord><SourceFilename>old.fxl</SourceFilename></FeatureCodingRecord><FeatureCodingRecord><SourceFilename>Latest.fxl</SourceFilename></FeatureCodingRecord></FieldBook></JOBFile>'));
    assert.equal(reference, 'Latest.fxl');
    await page.getByLabel('Kodeliste for JobXML zigzag').selectOption('fxl-2');
    sourceXml = read(path.join(testdata, 'unsupported-arc.jxl'));
    await button.click();
    await page.waitForFunction(() => !kof2txt.state.busy);
    assert.match(await page.locator('.status').textContent(), /ustøttet kontrollkode/);
    files = [];
    await page.getByRole('button', { name: 'Oppdater feltdata', exact: true }).click();
    await page.waitForFunction(() => !kof2txt.state.busy && !kof2txt.state.geminiFxlFiles.length);
    assert.equal(await button.isDisabled(), true);
    await page.getByText('Last opp kodelisten (.fxl) til Connect-prosjektet og oppdater feltdata.', { exact: true }).waitFor();
    assert.deepEqual(errors, []);
    console.log('PASS UI: Field Data download, automatic/explicit/missing FXL, readable conflict, no upload');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
