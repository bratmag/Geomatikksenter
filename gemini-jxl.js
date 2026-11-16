/* JobXML zigzag: DOM translation of the verified Access XSLT rules. */
(() => {
  "use strict";
  const children = (n, name) => Array.from(n?.childNodes || []).filter(c => c.nodeType === 1 && (!name || c.localName === name));
  const child = (n, name) => children(n, name)[0];
  const value = (n, name) => child(n, name)?.textContent || "";
  const descendants = n => Array.from(n.getElementsByTagName("*"));
  const normalizeCode = code => code.trim().replace(/\s+/g, " ");
  function parse(text, label) {
    if (/<!DOCTYPE/i.test(text)) throw new Error(`${label}: DOCTYPE støttes ikke.`);
    const doc = new DOMParser().parseFromString(text, "application/xml");
    if (doc.getElementsByTagName("parsererror").length) throw new Error(`${label}: ugyldig XML.`);
    return doc;
  }
  function library(text) {
    const doc = parse(text, "FXL");
    const defs = descendants(doc).filter(n => n.parentNode?.localName === "FeatureDefinitions" && n.hasAttribute("Code"));
    const all = new Set(), lines = new Set(), controls = {};
    for (const d of defs) {
      const code = normalizeCode(d.getAttribute("Code"));
      if (!code || all.has(code)) throw new Error(`FXL: tom eller duplisert fagkode: ${code}`);
      all.add(code);
      if (d.localName === "LineFeatureDefinition") lines.add(code);
    }
    if (!all.size) throw new Error("FXL: ingen fagkoder funnet.");
    for (const d of descendants(doc).filter(n => n.localName === "ControlCodeDefinition")) {
      const type = d.getAttribute("Type"), code = d.getAttribute("Code");
      if (!["Start", "End", "Close"].includes(type)) continue;
      if (Object.hasOwn(controls, type)) throw new Error(`FXL: flere kontrollkoder for ${type}.`);
      if (!code || /\s/.test(code)) throw new Error(`FXL: ugyldig kontrollkode for ${type}.`);
      controls[type] = code;
    }
    return { all, lines, controls };
  }
  function convert(text, fxlText) {
    const doc = parse(text, "JobXML");
    const multiple = typeof fxlText !== "string";
    const libraries = multiple ? new Map(Object.entries(fxlText).map(([name, xml]) => [name.toLocaleLowerCase("nb"), library(xml)])) : null;
    const fallback = multiple ? null : library(fxlText);
    const history = codingHistory(doc);
    const field = child(doc.documentElement, "FieldBook");
    if (doc.documentElement.localName !== "JOBFile" || !field || doc.documentElement.namespaceURI) throw new Error("Forventet JobXML med JOBFile/FieldBook uten XML-navnerom.");
    function hasMarker(n) {
      return Array.from(n.childNodes || []).some(c => (c.nodeType === 8 && c.data.startsWith(" JobXML zigzag original Code: ")) || hasMarker(c));
    }
    if (hasMarker(doc)) throw new Error("Denne JXL-filen er allerede konvertert til Gemini.");
    const records = children(field, "PointRecord"), active = records.filter(p => value(p, "Deleted") !== "true");
    const names = new Map(), ids = new Map(), streams = new Map(), converted = new Set();
    const usedIds = new Set(descendants(doc).filter(n => n.hasAttribute("ID")).map(n => n.getAttribute("ID")));
    const lineNames = new Set(children(field).filter(n => n.localName !== "PointRecord").map(n => value(n, "Name")));
    const fail = (p, stream, reason) => { throw new Error(`Punkt «${value(p, "Name") || "uten navn"}», streng «${stream || "tom"}»: ${reason}`); };
    for (const p of active) {
      const name = value(p, "Name"), id = p.getAttribute("ID");
      names.set(name, (names.get(name) || 0) + 1);
      ids.set(id, (ids.get(id) || 0) + 1);
    }
    for (const p of active) {
      const code = normalizeCode(value(p, "Code"));
      if (!code) continue;
      const sourceLibrary = history.points.get(p) || history.fallback;
      const lib = multiple ? libraries.get(sourceLibrary.toLocaleLowerCase("nb")) : fallback;
      if (!lib) fail(p, code, `mangler kodeliste «${sourceLibrary}».`);
      const tokens = code.split(" ");
      const features = children(child(p, "Features"), "Feature").filter(n => n.hasAttribute("Name"));
      const featureName = features.length === 1 ? normalizeCode(features[0].getAttribute("Name")) : "";
      const aliases = Array.from(lib.all).filter(code => code.replace(/_/g, " ") === featureName.replace(/_/g, " "));
      const baseCode = lib.all.has(featureName) ? featureName : aliases.length === 1 ? aliases[0] : "";
      let count = tokens.length;
      let token, b;
      // Match the longest code first. Only the remaining words are control codes.
      for (; count > 0; count--) {
        token = tokens.slice(0, count).join(" ");
        if (lib.all.has(token)) {
          b = lib.lines.has(token) ? token : "";
          break;
        }
        const equivalent = token.replace(/_/g, " ");
        if (baseCode && aliases.length === 1 && (equivalent === baseCode.replace(/_/g, " ") || (equivalent.startsWith(baseCode.replace(/_/g, " ")) && /^[0-9]+$/.test(equivalent.slice(baseCode.length))))) {
          b = lib.lines.has(baseCode) ? baseCode : "";
          break;
        }
        if (lib.lines.has(baseCode) && token.startsWith(baseCode) && /^[0-9]+$/.test(token.slice(baseCode.length))) {
          b = baseCode;
          break;
        }
      }
      if (!count && features.length) fail(p, code, "ukjent eller tvetydig fagkode. Kontroller valgt FXL.");
      if (!b) continue;
      const controls = tokens.slice(count).map(t => {
        const type = Object.keys(lib.controls).find(type => lib.controls[type] === t);
        if (!type) fail(p, token, `ustøttet kontrollkode eller flere fagkoder: ${t}`);
        return type;
      });
      if (!streams.has(token)) streams.set(token, []);
      streams.get(token).push({ p, base: b, controls, sourceLibrary });
    }
    const signature = n => JSON.stringify([n.nodeName, Array.from(n.attributes || []).map(a => [a.name, a.value]).sort(), Array.from(n.childNodes || []).filter(c => c.nodeType === 1 || (c.nodeType === 3 && c.textContent.trim())).map(c => c.nodeType === 1 ? signature(c) : c.textContent)]);
    const make = (name, content) => { const n = doc.createElement(name); if (content != null) n.textContent = content; return n; };
    let lineCount = 0, partsCount = 0;
    function emit(run, stream) {
      const first = run[0].p, b = run[0].base;
      if (run.length < 2) return;
      const featureGroup = child(first, "Features");
      for (const item of run) {
        const p = item.p, features = children(child(p, "Features"), "Feature");
        if (item.base !== b || features.length !== 1) fail(p, stream, "inkonsistent grunnkode eller attributtgruppe.");
        if (!value(p, "Name") || names.get(value(p, "Name")) !== 1) fail(p, stream, "tomt eller tvetydig punktnavn.");
        if (!p.getAttribute("ID") || ids.get(p.getAttribute("ID")) !== 1) fail(p, stream, "tom eller duplisert punkt-ID.");
      }
      const name = value(first, "Name"), id = String(90000000 + records.indexOf(first)).padStart(8, "0");
      if (usedIds.has(id) || lineNames.has(name)) fail(first, stream, "kollisjon i linjenavn eller generert post-ID.");
      usedIds.add(id); lineNames.add(name);
      const line = make("LivePolylineRecord");
      line.setAttribute("ID", id); line.setAttribute("TimeStamp", run[run.length - 1].p.getAttribute("TimeStamp") || "");
      for (const [key, val] of [["Name", name], ["Code", b], ["Deleted", "false"], ["StartPoint", name]]) line.appendChild(make(key, val));
      const parts = make("Parts"), ends = run.slice(1).map(i => value(i.p, "Name"));
      if (run[run.length - 1].controls.includes("Close") && ends[ends.length - 1] !== name) ends.push(name);
      for (const end of ends) { const part = make("LinePart"); part.appendChild(make("EndPoint", end)); parts.appendChild(part); }
      const commonFeatures = featureGroup.cloneNode(true);
      const commonFeature = child(commonFeatures, "Feature");
      // The exact FXL code classifies the line. Stored point attributes can still
      // name an earlier feature definition after a code has been renamed.
      commonFeature.setAttribute("Name", b);
      for (const attribute of children(commonFeature, "Attribute")) {
        const name = value(attribute, "Name");
        const shared = run.every(({ p }) => {
          const matches = children(child(child(p, "Features"), "Feature"), "Attribute").filter(a => value(a, "Name") === name);
          return matches.length === 1 && signature(matches[0]) === signature(attribute);
        });
        if (!shared) commonFeature.removeChild(attribute);
      }
      line.appendChild(parts); line.appendChild(commonFeatures); field.appendChild(line);
      run.forEach(i => converted.add(i.p)); lineCount++; partsCount += ends.length;
    }
    for (const [stream, items] of streams) {
      let run = [];
      for (const item of items) {
        if (run.length && (item.controls.includes("Start") || item.base !== run[0].base)) { emit(run, stream); run = []; }
        run.push(item);
        if (item.controls.includes("End") || item.controls.includes("Close")) { emit(run, stream); run = []; }
      }
      if (run.length) emit(run, stream);
    }
    const convertedIds = new Set(Array.from(converted, p => p.getAttribute("ID")));
    const reductions = children(child(doc.documentElement, "Reductions"), "Point").filter(p => convertedIds.has(p.getAttribute("ID") || value(p, "ID")));
    for (const p of [...converted, ...reductions]) {
      for (const code of children(p, "Code")) {
        if (code.textContent.includes("--")) fail(p, code.textContent, "koden kan ikke arkiveres som XML-kommentar.");
        p.insertBefore(doc.createComment(` JobXML zigzag original Code: ${code.textContent} `), code);
        code.textContent = "";
      }
    }
    return { text: new XMLSerializer().serializeToString(doc), stats: { lines: lineCount, points: converted.size, parts: partsCount } };
  }
  function codingHistory(doc) {
    const associated = child(child(child(doc.documentElement, "Environment"), "AssociatedFiles"), "FeatureCodeLibrary");
    const fileName = path => String(path || "").trim().split(/[\\/]/).pop();
    const current = fileName(associated?.textContent);
    const extension = name => name && !/\.fxl$/i.test(name) ? `${name}.fxl` : name;
    let activeLibrary = "";
    const measuredLibraries = new Map();
    const points = new Map();
    for (const record of children(child(doc.documentElement, "FieldBook"))) {
      if (record.localName === "FeatureCodingRecord") {
        activeLibrary = extension(fileName(value(record, "SourceFilename") || value(record, "LibraryName")));
      } else if (record.localName === "PointRecord" && value(record, "Deleted") !== "true" && value(record, "Code").trim() && activeLibrary) {
        measuredLibraries.set(activeLibrary.toLocaleLowerCase("nb"), activeLibrary);
        points.set(record, activeLibrary);
      }
    }
    const fallback = extension(current || activeLibrary);
    return { points, names: Array.from(measuredLibraries.values()), fallback };
  }
  function referencedFxls(xml) {
    const history = codingHistory(parse(xml, "JobXML"));
    return history.names.length ? history.names : history.fallback ? [history.fallback] : [];
  }
  function referencedFxl(xml) {
    const names = referencedFxls(xml);
    if (names.length > 1) throw new Error(`Punktene er målt med flere kodelister: ${names.join(", ")}. Velg kodeliste manuelt.`);
    return names[0] || "";
  }
  globalThis.GeminiJxl = { convert, library, referencedFxl, referencedFxls };
})();
