/* JobXML zigzag: DOM translation of the verified Access XSLT rules. */
(() => {
  "use strict";
  const children = (n, name) => Array.from(n?.childNodes || []).filter(c => c.nodeType === 1 && (!name || c.localName === name));
  const child = (n, name) => children(n, name)[0];
  const value = (n, name) => child(n, name)?.textContent || "";
  const descendants = n => Array.from(n.getElementsByTagName("*"));
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
      const code = d.getAttribute("Code").trimEnd();
      if (!code || /[\s|]/.test(code) || all.has(code)) throw new Error(`FXL: tom, duplisert eller ustøttet fagkode: ${code}`);
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
    const lib = library(fxlText), doc = parse(text, "JobXML");
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
    function base(p, token) {
      if (!token) return "";
      if (lib.lines.has(token)) return token;
      if (lib.all.has(token)) return "";
      const features = children(child(p, "Features"), "Feature").filter(n => n.hasAttribute("Name"));
      if (!features.length) return "";
      const name = features[0].getAttribute("Name");
      if (features.length === 1 && lib.lines.has(name) && token.startsWith(name) && /^[0-9]+$/.test(token.slice(name.length))) return name;
      fail(p, token, "ukjent eller tvetydig fagkode. Kontroller valgt FXL.");
    }
    for (const p of active) {
      const tokens = value(p, "Code").trim().split(/[\t\r\n ]+/), token = tokens[0], b = base(p, token);
      if (!b) continue;
      for (const t of tokens.slice(1)) if (!Object.values(lib.controls).includes(t)) fail(p, token, `ustøttet kontrollkode eller flere fagkoder: ${t}`);
      if (!streams.has(token)) streams.set(token, []);
      streams.get(token).push({ p, base: b, controls: tokens.slice(1) });
    }
    const signature = n => JSON.stringify([n.nodeName, Array.from(n.attributes || []).map(a => [a.name, a.value]).sort(), Array.from(n.childNodes || []).filter(c => c.nodeType === 1 || (c.nodeType === 3 && c.textContent.trim())).map(c => c.nodeType === 1 ? signature(c) : c.textContent)]);
    const make = (name, content) => { const n = doc.createElement(name); if (content != null) n.textContent = content; return n; };
    let lineCount = 0, partsCount = 0;
    function emit(run, stream) {
      const first = run[0].p, b = run[0].base;
      if (run.length < 2) fail(first, stream, "linjen har bare ett punkt.");
      const featureGroup = child(first, "Features"), expected = featureGroup && signature(featureGroup);
      for (const item of run) {
        const p = item.p, features = children(child(p, "Features"), "Feature");
        if (item.base !== b || features.length !== 1 || features[0].getAttribute("Name") !== b) fail(p, stream, "inkonsistent grunnkode eller attributtgruppe.");
        if (signature(child(p, "Features")) !== expected) fail(p, stream, "attributtkonflikt mellom punktene i linjen.");
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
      if (run[run.length - 1].controls.includes(lib.controls.Close) && ends[ends.length - 1] !== name) ends.push(name);
      for (const end of ends) { const part = make("LinePart"); part.appendChild(make("EndPoint", end)); parts.appendChild(part); }
      line.appendChild(parts); line.appendChild(featureGroup.cloneNode(true)); field.appendChild(line);
      run.forEach(i => converted.add(i.p)); lineCount++; partsCount += ends.length;
    }
    for (const [stream, items] of streams) {
      let run = [];
      for (const item of items) {
        if (run.length && item.controls.includes(lib.controls.Start)) { emit(run, stream); run = []; }
        run.push(item);
        if (item.controls.includes(lib.controls.End) || item.controls.includes(lib.controls.Close)) { emit(run, stream); run = []; }
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
      children(p, "Features").forEach(n => p.removeChild(n));
    }
    return { text: new XMLSerializer().serializeToString(doc), stats: { lines: lineCount, points: converted.size, parts: partsCount } };
  }
  globalThis.GeminiJxl = { convert, library };
})();
