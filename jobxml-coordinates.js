/* Local repair of unreduced Field Data JobXML. No constant geoid offsets.
 * GGF layout validated against the bundled files and the Access reference.
 * Transverse Mercator: sixth-order Krueger series, PROJ mathematical definition:
 * https://proj.org/en/stable/operations/projections/tmerc.html
 */
(() => {
  "use strict";
  const kids = (n, name) => Array.from(n?.childNodes || []).filter(c => c.nodeType === 1 && (!name || c.localName === name));
  const one = (n, name) => kids(n, name)[0];
  const text = (n, name) => one(n, name)?.textContent.trim() || "";
  function number(n, name) {
    const s = text(n, name), v = Number(s);
    if (!s || !Number.isFinite(v)) throw new Error(`Koordinatberegning: mangler gyldig ${name}.`);
    return v;
  }
  const registry = [
    { key: "Norway18B", name: "NN2000 (Norway18B)", aliases: ["norway18b", "nn200018b", "nn2000norway18b"], flags: 0x84, sha256: "cdc3e37e4887a4f2d034ed91b360e8f17d75e2b3515ee426ce32f769f16c0417" },
    { key: "Norway25A", name: "NN2000 (Norway25A)", aliases: ["norway25a", "nn200025a", "nn2000norway25a"], flags: 0x484, sha256: "3d83548ee6556f858d93e4e7f9c8408fcc381ed38379bec861221f6730a5ae49" }
  ];
  const key = s => s.toLowerCase().replace(/\.ggf$/i, "").replace(/[^a-z0-9]/g, "");
  function modelFor(name) {
    const model = registry.find(m => m.aliases.includes(key(name)));
    if (!model) throw new Error(`Geoidemodellen «${name || "ikke angitt"}» støttes ikke. Eksporten er stoppet.`);
    return model;
  }
  function readGrid(buffer, model) {
    const d = new DataView(buffer), ascii = (o, len) => new TextDecoder("ascii").decode(new Uint8Array(buffer, o, len)).replace(/\0.*$/s, "");
    if (d.byteLength < 146 || d.getUint16(0, true) !== 1 || ascii(2, 14) !== "TNL GRID FILE" || ascii(16, 32) !== model.name || d.getUint16(138, true) !== model.flags) throw new Error("Geoid: ukjent eller ugyldig GGF-format.");
    const south = d.getFloat64(48, true), north = d.getFloat64(56, true), west = d.getFloat64(64, true), east = d.getFloat64(72, true);
    const dy = d.getFloat64(80, true), dx = d.getFloat64(88, true), rows = d.getUint32(96, true), cols = d.getUint32(100, true);
    if (rows !== 711 || cols !== 701 || d.byteLength !== 146 + rows * cols * 4 + 16 || Math.abs(south - 57.8) > 1e-9 || north !== 72 || west !== 4 || east !== 32 || Math.abs(dy - 0.02) > 1e-9 || Math.abs(dx - 0.04) > 1e-9) throw new Error("Geoid: gridoppsettet samsvarer ikke med den kontrollerte modellen.");
    return (lat, lon) => {
      // These two GGF files store west-to-east rows, from north to south.
      const rawX = (lon - west) / dx, rawY = (north - lat) / dy;
      if (!Number.isFinite(rawX + rawY) || rawX < -1e-9 || rawY < -1e-9 || rawX > cols - 1 + 1e-9 || rawY > rows - 1 + 1e-9) throw new Error(`Geoid: punkt ${lat}, ${lon} ligger utenfor ${model.key}.`);
      const x = Math.max(0, Math.min(cols - 1, rawX)), y = Math.max(0, Math.min(rows - 1, rawY));
      const c = Math.min(Math.floor(x), cols - 2), r = Math.min(Math.floor(y), rows - 2), fx = x - c, fy = y - r;
      const at = (row, col) => {
        const v = d.getFloat32(146 + 4 * (row * cols + col), true);
        if (!Number.isFinite(v) || Math.abs(v) > 200) throw new Error(`Geoid: manglende gridverdi i ${model.key} ved ${lat}, ${lon}.`);
        return v;
      };
      return (1 - fy) * ((1 - fx) * at(r, c) + fx * at(r, c + 1)) + fy * ((1 - fx) * at(r + 1, c) + fx * at(r + 1, c + 1));
    };
  }
  const cache = new Map();
  async function load(model) {
    if (!cache.has(model.key)) cache.set(model.key, (async () => {
      const response = await fetch(`geoids/${model.key}.ggf?v=1`);
      if (!response.ok) throw new Error(`Kunne ikke hente innebygd geoid ${model.key}.`);
      const buffer = await response.arrayBuffer();
      const digest = await crypto.subtle.digest("SHA-256", buffer);
      const hash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
      if (hash !== model.sha256) throw new Error(`Kontrollsummen til geoid ${model.key} er feil. Eksporten er stoppet.`);
      return readGrid(buffer, model);
    })().catch(err => { cache.delete(model.key); throw err; }));
    return cache.get(model.key);
  }
  function geodetic(x, y, z, a, f) {
    const e2 = f * (2 - f), p = Math.hypot(x, y);
    if (p < 1 || Math.hypot(p, z) < 6e6 || Math.hypot(p, z) > 7e6) throw new Error("Koordinatberegning: ugyldig ECEF-posisjon.");
    let lat = Math.atan2(z, p * (1 - e2));
    for (let i = 0; i < 12; i++) {
      const n = a / Math.sqrt(1 - e2 * Math.sin(lat) ** 2);
      const next = Math.atan2(z + e2 * n * Math.sin(lat), p);
      if (Math.abs(next - lat) < 1e-15) { lat = next; break; }
      lat = next;
    }
    const n = a / Math.sqrt(1 - e2 * Math.sin(lat) ** 2);
    return { lat: lat * 180 / Math.PI, lon: Math.atan2(y, x) * 180 / Math.PI, height: p / Math.cos(lat) - n };
  }
  function project(latDeg, lonDeg, p) {
    const n = p.f / (2 - p.f), e = Math.sqrt(p.f * (2 - p.f));
    const powers = [n, n ** 2, n ** 3, n ** 4, n ** 5, n ** 6];
    const matrix = [
      [1/2, -2/3, 5/16, 41/180, -127/288, 7891/37800],
      [0, 13/48, -3/5, 557/1440, 281/630, -1983433/1935360],
      [0, 0, 61/240, -103/140, 15061/26880, 167603/181440],
      [0, 0, 0, 49561/161280, -179/168, 6601661/7257600],
      [0, 0, 0, 0, 34729/80640, -3418889/1995840],
      [0, 0, 0, 0, 0, 212378941/319334400]
    ];
    const alpha = matrix.map(row => row.reduce((sum, v, i) => sum + v * powers[i], 0));
    const A = p.a / (1 + n) * (1 + n ** 2 / 4 + n ** 4 / 64 + n ** 6 / 256);
    function forward(phi, lambda) {
      const chi = Math.atan(Math.sinh(Math.asinh(Math.tan(phi)) - e * Math.atanh(e * Math.sin(phi))));
      const xi = Math.atan2(Math.tan(chi), Math.cos(lambda));
      const eta = Math.asinh(Math.sin(lambda) / Math.hypot(Math.tan(chi), Math.cos(lambda)));
      let north = xi, east = eta;
      alpha.forEach((a, i) => { const j = 2 * (i + 1); north += a * Math.sin(j * xi) * Math.cosh(j * eta); east += a * Math.cos(j * xi) * Math.sinh(j * eta); });
      return { north: p.scale * A * north, east: p.scale * A * east };
    }
    const delta = (lonDeg - p.lon0) * Math.PI / 180;
    if (Math.abs(delta) > 10 * Math.PI / 180 || latDeg < 55 || latDeg > 73) throw new Error("Koordinatberegning: punkt utenfor støttet norsk TM-område.");
    const out = forward(latDeg * Math.PI / 180, delta), origin = forward(p.lat0 * Math.PI / 180, 0);
    return { north: out.north - origin.north + p.north0, east: out.east + p.east0 };
  }
  function parse(xml) {
    if (/<!DOCTYPE/i.test(xml)) throw new Error("JobXML: DOCTYPE støttes ikke.");
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    if (doc.getElementsByTagName("parsererror").length || doc.documentElement.localName !== "JOBFile" || doc.documentElement.namespaceURI) throw new Error("Ugyldig JobXML.");
    return doc;
  }
  async function prepare(xml, options = {}) {
    const doc = parse(xml), root = doc.documentElement, field = one(root, "FieldBook"), reductions = one(root, "Reductions");
    const points = kids(field, "PointRecord").filter(p => text(p, "Deleted") !== "true");
    const reduced = kids(reductions, "Point");
    const validGrid = n => ["North", "East", "Elevation"].every(k => text(n, k) !== "" && Number.isFinite(Number(text(n, k))));
    const complete = points.length && points.every(p => reduced.some(r => text(r, "ID") === p.getAttribute("ID") && validGrid(one(r, "Grid"))));
    if (!reductions?.hasAttribute("error") && complete) return { text: xml, repaired: false, points: 0 };
    if (!reductions?.hasAttribute("error") && points.length && points.every(p => validGrid(one(p, "ComputedGrid")))) {
      // Authoritative local coordinates already present: no geoid calculation needed.
      const container = reductions || doc.createElement("Reductions");
      for (const p of points) {
        const matches = reduced.filter(r => text(r, "ID") === p.getAttribute("ID"));
        if (matches.length > 1) throw new Error(`Flere koordinatposter for punkt ${text(p, "Name")}.`);
        if (matches.length && validGrid(one(matches[0], "Grid"))) continue;
        const r = matches[0] || doc.createElement("Point");
        if (!matches.length) {
          const id = doc.createElement("ID"); id.textContent = p.getAttribute("ID"); r.appendChild(id);
          for (const k of ["Name", "Code", "SurveyMethod", "Classification", "Features"]) if (one(p, k)) r.appendChild(one(p, k).cloneNode(true));
        }
        const g = doc.createElement("Grid");
        for (const c of kids(one(p, "ComputedGrid"))) g.appendChild(c.cloneNode(true));
        const old = one(r, "Grid"); if (old) r.replaceChild(g, old); else r.appendChild(g);
        if (!matches.length) container.appendChild(r);
      }
      if (!reductions) root.insertBefore(container, one(root, "Environment") || null);
      return { text: new XMLSerializer().serializeToString(doc), repaired: true, model: null, points: points.length };
    }
    // Repair is deliberately limited to validated GNSS and uncalibrated EUREF89 TM jobs.
    const coordinate = one(field, "CoordinateSystemRecord"), datum = one(field, "DatumRecord"), ellipsoid = one(field, "EllipsoidRecord");
    const projectionRecord = one(field, "ProjectionRecord"), projection = one(projectionRecord, "Projection"), local = one(projectionRecord, "LocalSite");
    const vertical = one(field, "VerticalAdjustmentRecord"), horizontal = one(field, "HorizontalAdjustmentRecord");
    const reject = reason => { throw new Error(`Kan ikke fullføre JobXML-koordinater: ${reason}`); };
    if (!points.length) reject("ingen aktive punkter.");
    for (const name of ["CoordinateSystemRecord", "DatumRecord", "EllipsoidRecord", "ProjectionRecord", "VerticalAdjustmentRecord", "HorizontalAdjustmentRecord"]) if (kids(field, name).length !== 1) reject(`mangler entydig ${name}.`);
    if (text(coordinate, "DatumName") !== "EUREF89" || text(datum, "Type") !== "ThreeParameter" || text(datum, "ReferenceGlobalFrameID") !== "205" || text(datum, "Direction") !== "WGS84ToLocal" || ["TranslationX", "TranslationY", "TranslationZ"].some(k => number(datum, k) !== 0)) reject("datumtransformasjonen støttes ikke av den innebygde beregningen.");
    if (text(projection, "Type") !== "TransverseMercator" || text(projection, "ShiftGridFileName") || text(horizontal, "Type") !== "NoAdjustment" || text(vertical, "Type") !== "GeoidModel" || text(local, "Type") !== "Grid") reject("projeksjon eller lokal kalibrering støttes ikke av den innebygde beregningen.");
    const envProjection = one(one(one(root, "Environment"), "CoordinateSystem"), "Projection");
    if ((text(envProjection, "SouthAzimuth") && text(envProjection, "SouthAzimuth") !== "false") || (text(envProjection, "GridOrientation") && text(envProjection, "GridOrientation") !== "IncreasingNorthEast") || (text(envProjection, "ApplySeaLevelCorrection") && text(envProjection, "ApplySeaLevelCorrection") !== "false")) reject("projeksjonens orientering eller havnivåkorreksjon støttes ikke.");
    const model = modelFor(text(vertical, "GeoidName"));
    const sample = options.loadGrid ? await options.loadGrid(model) : await load(model);
    const globalA = number(datum, "EarthRadius"), globalF = number(datum, "Flattening");
    const params = { a: number(ellipsoid, "EarthRadius"), f: number(ellipsoid, "Flattening"), lat0: number(projection, "CentralLatitude"), lon0: number(projection, "CentralLongitude"), scale: number(projection, "Scale"), north0: number(projection, "FalseNorthing"), east0: number(projection, "FalseEasting") };
    if (Math.abs(globalA - 6378137) > 1e-6 || globalF < .00335 || globalF > .00336 || Math.abs(params.a - 6378137) > 1e-6 || Math.abs(params.f - .00335281068118) > 1e-12 || params.scale <= 0) reject("ellipsoide eller målestokk støttes ikke.");
    const idCounts = new Map(), nameCounts = new Map();
    for (const p of points) { const id = p.getAttribute("ID"), name = text(p, "Name"); idCounts.set(id, (idCounts.get(id) || 0) + 1); nameCounts.set(name, (nameCounts.get(name) || 0) + 1); }
    const calculated = [];
    for (const p of points) {
      const name = text(p, "Name"), id = p.getAttribute("ID");
      try {
        if (!id || !name || idCounts.get(id) !== 1 || nameCounts.get(name) !== 1) reject("tomme eller tvetydige punktnavn/ID-er.");
        const ecef = one(p, "ECEF");
        if (!["GpsRTKQuickMark", "GpsRTK"].includes(text(p, "Method")) || !["NetworkRTK", "RTK"].includes(text(p, "SurveyMethod")) || !ecef) reject("punktets målemetode støttes ikke for rekonstruksjon.");
        const orientation = one(p, "DeviceAxisOrientation"), attitude = one(orientation, "Attitude");
        if (orientation && (text(orientation, "Type") !== "VerticalTiltError" || number(attitude, "Pitch") !== 0 || number(attitude, "Roll") !== 0)) reject("tiltkorrigerte målinger støttes ikke for rekonstruksjon.");
        const antennae = kids(field, "AntennaRecord").filter(a => a.getAttribute("ID") === text(p, "AntennaID"));
        if (antennae.length !== 1) reject("mangler entydig antennehøyde.");
        const antenna = number(antennae[0], "ReducedHeight");
        if (antenna < 0 || antenna > 20) reject("ugyldig redusert antennehøyde.");
        const llh = geodetic(number(ecef, "X"), number(ecef, "Y"), number(ecef, "Z"), globalA, globalF);
        llh.height -= antenna;
        const grid = project(llh.lat, llh.lon, params);
        grid.elevation = llh.height - sample(llh.lat, llh.lon);
        calculated.push({ p, id, name, llh, grid });
      } catch (error) { throw new Error(`Punkt «${name}»: ${error.message}`); }
    }
    // No XML is changed until every point and every geoid sample is valid.
    const make = (name, val) => { const n = doc.createElement(name); if (val != null) n.textContent = typeof val === "number" ? val.toFixed(12).replace(/0+$/, "").replace(/\.$/, "") : val; return n; };
    const container = reductions || make("Reductions");
    const gridNode = g => { const n = make("Grid"); for (const [k, v] of [["North", g.north], ["East", g.east], ["Elevation", g.elevation]]) n.appendChild(make(k, v)); return n; };
    for (const item of calculated) {
      const { p, id, name, llh, grid } = item;
      const computed = gridNode(grid), cg = make("ComputedGrid");
      while (computed.firstChild) cg.appendChild(computed.firstChild);
      const existingGrid = one(p, "ComputedGrid");
      if (existingGrid && validGrid(existingGrid) && ["North", "East", "Elevation"].some(k => Math.abs(number(existingGrid, k) - number(cg, k)) > .001)) reject(`beregningen avviker fra eksisterende koordinater for punkt ${name}.`);
      if (!existingGrid) p.insertBefore(cg, one(p, "DeviceAxisOrientation") || one(p, "Precision") || null);
      else if (!validGrid(existingGrid)) p.replaceChild(cg, existingGrid);
      const matches = reduced.filter(r => text(r, "ID") === id);
      if (matches.length > 1) reject(`flere koordinatposter for punkt ${name}.`);
      const old = matches[0];
      if (old && validGrid(one(old, "Grid")) && ["North", "East", "Elevation"].some(k => Math.abs(number(one(old, "Grid"), k) - number(cg, k)) > .001)) reject(`beregningen avviker fra eksisterende Reductions for punkt ${name}.`);
      // Preserve all metadata on any existing reduced point, update only coordinates.
      const r = old || make("Point");
      if (!old) {
        r.appendChild(make("ID", id)); r.appendChild(make("Name", name));
        for (const k of ["Code", "SurveyMethod", "Classification"]) if (one(p, k)) r.appendChild(one(p, k).cloneNode(true));
        if (one(p, "Features")) r.appendChild(one(p, "Features").cloneNode(true));
      }
      const wgs = make("WGS84");
      for (const [k, v] of [["Latitude", llh.lat], ["Longitude", llh.lon], ["Height", llh.height]]) wgs.appendChild(make(k, v));
      for (const replacement of [wgs, gridNode(grid)]) { const prior = one(r, replacement.localName); if (prior) r.replaceChild(replacement, prior); else r.appendChild(replacement); }
      if (!old) container.appendChild(r);
    }
    container.removeAttribute("error");
    if (!reductions) root.insertBefore(container, one(root, "Environment") || null);
    return { text: new XMLSerializer().serializeToString(doc), repaired: true, model: model.key, points: calculated.length };
  }
  globalThis.JobXmlCoordinates = { prepare, modelFor, readGrid, geodetic, project };
})();
