// Server-side PPTX builder — same engine as the frontend pptxPackager
// (stored-method ZIP + PresentationML), ported so AgentRuntime missions
// and tools can produce REAL .pptx bytes. No new engine, no dependency.

import zlib from 'node:zlib';

function crc32(buf) {
  let tab = crc32.t;
  if (!tab) {
    tab = crc32.t = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      tab[n] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = tab[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildZip(files) {
  // files: [{path, data: Buffer}] — stored (method 0)
  const parts = [];
  const central = [];
  let off = 0;
  for (const f of files) {
    const nameB = Buffer.from(f.path, 'utf8');
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt32LE(crc32(f.data), 14);
    lh.writeUInt32LE(f.data.length, 18);
    lh.writeUInt32LE(f.data.length, 22);
    lh.writeUInt16LE(nameB.length, 26);
    parts.push(lh, nameB, f.data);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt32LE(crc32(f.data), 16);
    ch.writeUInt32LE(f.data.length, 20);
    ch.writeUInt32LE(f.data.length, 24);
    ch.writeUInt16LE(nameB.length, 28);
    ch.writeUInt32LE(off, 42);
    central.push(ch, nameB);
    off += 30 + nameB.length + f.data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cd, end]);
}

function slideXml(title, bullets, accent) {
  const bulletsXml = bullets
    .map(
      (b) => `<a:p><a:pPr lvl="0"/><a:r><a:rPr lang="en-US" sz="1800"/><a:t>${esc(b)}</a:t></a:r></a:p>`
    )
    .join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
<p:cSld><p:spTree>
<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>
<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title 1"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="838200" y="533400"/><a:ext cx="10515600" cy="1143000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="${accent}"/></a:solidFill></p:spPr>
<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" sz="3600" b="1"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:rPr><a:t>${esc(title)}</a:t></a:r></a:p></p:txBody></p:sp>
<p:sp><p:nvSpPr><p:cNvPr id="3" name="Content 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="838200" y="1981200"/><a:ext cx="10515600" cy="4114800"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>
<p:txBody><a:bodyPr wrap="square"/><a:lstStyle/>${bulletsXml}</p:txBody></p:sp>
</p:spTree></p:cSld></p:sld>`;
}

function relationships(rows) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rows.join('')}</Relationships>`;
}

function masterXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
<p:cSld name="MetaIoid"><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld>
<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>
<p:txStyles><p:titleStyle><a:lvl1pPr algn="l"><a:defRPr sz="4400" kern="1200"/></a:lvl1pPr></p:titleStyle><p:bodyStyle><a:lvl1pPr marL="342900" indent="-285750"><a:defRPr sz="1800"/></a:lvl1pPr></p:bodyStyle><p:otherStyle><a:defPPr/><a:lvl1pPr/><a:defRPr lang="en-US"/></p:otherStyle></p:txStyles>
</p:sldMaster>`;
}

function layoutXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="titleAndContent" preserve="1">
<p:cSld name="Title and Content"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;
}

function themeXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="MetaIoid"><a:themeElements><a:clrScheme name="MetaIoid"><a:dk1><a:sysClr val="windowText" lastClr="1F2937"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="374151"/></a:dk2><a:lt2><a:srgbClr val="F9FAFB"/></a:lt2><a:accent1><a:srgbClr val="1F6B3A"/></a:accent1><a:accent2><a:srgbClr val="A16207"/></a:accent2><a:accent3><a:srgbClr val="78716C"/></a:accent3><a:accent4><a:srgbClr val="2563EB"/></a:accent4><a:accent5><a:srgbClr val="7C3AED"/></a:accent5><a:accent6><a:srgbClr val="DC2626"/></a:accent6><a:hlink><a:srgbClr val="2563EB"/></a:hlink><a:folHlink><a:srgbClr val="7C3AED"/></a:folHlink></a:clrScheme><a:fontScheme name="MetaIoid"><a:majorFont><a:latin typeface="Aptos Display"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Aptos"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="MetaIoid"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;
}

function appPropsXml(slideCount) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>MetaIoid</Application><PresentationFormat>On-screen Show (16:9)</PresentationFormat><Slides>${slideCount}</Slides><Notes>0</Notes><HiddenSlides>0</HiddenSlides><MMClips>0</MMClips></Properties>`;
}

/**
 * deck: { title, slides: [{title, bullets: string[]}], accent?: hex (no #) }
 * Returns Buffer of a genuine .pptx. Throws on bad input (never fake bytes).
 */
export function buildPptx(deck) {
  const title = String(deck?.title || '').trim().slice(0, 120);
  const slides = Array.isArray(deck?.slides) ? deck.slides : [];
  if (!title) throw new Error('Deck needs a title.');
  if (!slides.length || slides.length > 40) throw new Error('Deck needs 1–40 slides.');
  const accent = /^[0-9a-fA-F]{6}$/.test(deck?.accent || '') ? deck.accent.toUpperCase() : '1F6B3A';
  const clean = slides.map((s, i) => ({
    n: i + 1,
    title: String(s.title || `Slide ${i + 1}`).slice(0, 120),
    bullets: (Array.isArray(s.bullets) ? s.bullets : []).map((b) => String(b).slice(0, 300)).slice(0, 8),
  }));
  const files = [];
  const B = (s) => Buffer.from(s, 'utf8');
  files.push({
    path: '[Content_Types].xml',
    data: B(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
${clean.map((s) => `<Override PartName="/ppt/slides/slide${s.n}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('\n')}
</Types>`),
  });
  files.push({
    path: '_rels/.rels',
    data: B(relationships([
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>',
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>',
      '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>',
    ])),
  });
  files.push({
    path: 'ppt/presentation.xml',
    data: B(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>
<p:sldIdLst>
${clean.map((s, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 2}"/>`).join('\n')}
</p:sldIdLst>
<p:sldSz cx="12192000" cy="6858000" type="screen16x9"/>
<p:notesSz cx="6858000" cy="9144000"/><p:defaultTextStyle><a:defPPr><a:defRPr lang="en-US"/></a:defPPr></p:defaultTextStyle></p:presentation>`),
  });
  files.push({
    path: 'ppt/_rels/presentation.xml.rels',
    data: B(relationships([
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>',
      ...clean.map((s, i) => `<Relationship Id="rId${i + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${s.n}.xml"/>`),
    ])),
  });
  files.push({ path: 'ppt/slideMasters/slideMaster1.xml', data: B(masterXml()) });
  files.push({ path: 'ppt/slideMasters/_rels/slideMaster1.xml.rels', data: B(relationships([
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>',
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>',
  ])) });
  files.push({ path: 'ppt/slideLayouts/slideLayout1.xml', data: B(layoutXml()) });
  files.push({ path: 'ppt/slideLayouts/_rels/slideLayout1.xml.rels', data: B(relationships([
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>',
  ])) });
  files.push({ path: 'ppt/theme/theme1.xml', data: B(themeXml()) });
  files.push({ path: 'docProps/core.xml', data: B(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/"><dc:title>${esc(title)}</dc:title><dc:creator>MetaIoid</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">${new Date().toISOString()}</dcterms:created></cp:coreProperties>`) });
  files.push({ path: 'docProps/app.xml', data: B(appPropsXml(clean.length)) });
  for (const s of clean) {
    files.push({ path: `ppt/slides/slide${s.n}.xml`, data: B(slideXml(s.title, s.bullets, accent)) });
    files.push({ path: `ppt/slides/_rels/slide${s.n}.xml.rels`, data: B(relationships([
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>',
    ])) });
  }
  return buildZip(files);
}

/** Structural validation of a .pptx buffer (never just the extension). */
export function validatePptxBytes(buf) {
  const issues = [];
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf || []);
  if (b.length < 100) issues.push('too small to be a package');
  if (b.readUInt32LE(0) !== 0x04034b50) issues.push('missing PKZIP signature');
  let entries = [];
  try {
    entries = centralEntries(b);
  } catch (e) {
    issues.push('invalid ZIP central directory: ' + String(e.message || e).slice(0, 80));
  }
  const names = new Set(entries.map((e) => e.name));
  const required = [
    '[Content_Types].xml', '_rels/.rels', 'ppt/presentation.xml', 'ppt/_rels/presentation.xml.rels',
    'ppt/slideMasters/slideMaster1.xml', 'ppt/slideMasters/_rels/slideMaster1.xml.rels',
    'ppt/slideLayouts/slideLayout1.xml', 'ppt/slideLayouts/_rels/slideLayout1.xml.rels',
    'ppt/theme/theme1.xml', 'docProps/core.xml', 'docProps/app.xml',
  ];
  for (const name of required) if (!names.has(name)) issues.push(`missing required package part: ${name}`);
  const slideNames = [...names].filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name));
  const slideCount = slideNames.length;
  if (!slideCount) issues.push('no slides found');
  for (const slide of slideNames) {
    const n = slide.match(/slide(\d+)\.xml$/)?.[1];
    if (!names.has(`ppt/slides/_rels/slide${n}.xml.rels`)) issues.push(`missing layout relationship for slide ${n}`);
  }
  // Every internal relationship must resolve to an existing package part.
  for (const entry of entries.filter((e) => e.name.endsWith('.rels'))) {
    try {
      const xml = extractEntry(b, entry).toString('utf8');
      if (!wellFormedXml(xml)) issues.push(`malformed XML: ${entry.name}`);
      for (const target of relationshipTargets(xml)) {
        if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('/')) continue;
        const resolved = resolveRelationshipTarget(entry.name, target);
        if (!names.has(resolved)) issues.push(`broken relationship: ${entry.name} → ${target}`);
      }
    } catch (e) {
      issues.push(`unreadable relationship part ${entry.name}: ${String(e.message || e).slice(0, 60)}`);
    }
  }
  // XML well-formedness + slide content inspection through actual ZIP entries.
  try {
    const slides = extractSlides(b);
    if (slides.length !== slideCount) issues.push(`slide file/XML count mismatch (${slides.length}/${slideCount})`);
    for (const s of slides) if (!wellFormedXml(s.xml)) issues.push(`malformed XML: ${s.name}`);
    const empty = slides.filter((s) => !/<a:t>[^<]+<\/a:t>/.test(s.xml));
    if (empty.length) issues.push(`${empty.length} slide(s) with no text`);
    const over = slides.filter((s) => (s.xml.match(/<a:p>/g) || []).length > 10);
    if (over.length) issues.push(`${over.length} slide(s) overcrowded (>10 paragraphs)`);
  } catch (e) {
    issues.push('unreadable slide XML: ' + String(e.message || e).slice(0, 80));
  }
  return { ok: issues.length === 0, issues, slideCount, bytes: b.length };
}

function centralEntries(b) {
  // locate EOCD
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 66000); i--) {
    if (b.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('no end-of-central-directory');
  const count = b.readUInt16LE(eocd + 10);
  const off = b.readUInt32LE(eocd + 16);
  const out = [];
  let p = off;
  for (let i = 0; i < count; i++) {
    if (b.readUInt32LE(p) !== 0x02014b50) throw new Error('corrupt central directory');
    out.push({
      method: b.readUInt16LE(p + 10),
      compSize: b.readUInt32LE(p + 20),
      uncompSize: b.readUInt32LE(p + 24),
      nameLen: b.readUInt16LE(p + 28),
      extraLen: b.readUInt16LE(p + 30),
      commentLen: b.readUInt16LE(p + 32),
      localOff: b.readUInt32LE(p + 42),
      name: b.toString('utf8', p + 46, p + 46 + b.readUInt16LE(p + 28)),
    });
    p += 46 + out[out.length - 1].nameLen + out[out.length - 1].extraLen + out[out.length - 1].commentLen;
  }
  return out;
}

function extractEntry(b, e) {
  if (b.readUInt32LE(e.localOff) !== 0x04034b50) throw new Error('bad local header');
  const nl = b.readUInt16LE(e.localOff + 26);
  const el = b.readUInt16LE(e.localOff + 28);
  const data = b.subarray(e.localOff + 30 + nl + el, e.localOff + 30 + nl + el + e.compSize);
  if (e.method === 0) return data;
  if (e.method === 8) return zlib.inflateRawSync(data, { maxOutputLength: 20_000_000 });
  throw new Error('unsupported method ' + e.method);
}

export function extractSlides(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  return centralEntries(b)
    .filter((e) => /^ppt\/slides\/slide\d+\.xml$/.test(e.name))
    .map((e) => ({ name: e.name, xml: extractEntry(b, e).toString('utf8') }));
}

function relationshipTargets(xml) {
  return [...xml.matchAll(/<Relationship\b[^>]*\bTarget="([^"]+)"[^>]*\/?>(?:<\/Relationship>)?/g)].map((m) => m[1]);
}

function resolveRelationshipTarget(relPath, target) {
  const source = relPath
    .replace(/_rels\//, '')
    .replace(/\.rels$/, '');
  const base = source.split('/').slice(0, -1);
  const out = [...base, ...target.split('/')];
  const normalized = [];
  for (const segment of out) {
    if (!segment || segment === '.') continue;
    if (segment === '..') normalized.pop();
    else normalized.push(segment);
  }
  return normalized.join('/');
}

/** Strict enough for generated OOXML: detects unbalanced tags/attributes before delivery. */
function wellFormedXml(xml) {
  const source = String(xml || '').replace(/<\?[^>]*\?>|<!--[^]*?-->/g, '');
  const stack = [];
  for (const token of source.match(/<[^>]+>/g) || []) {
    if (/^<\//.test(token)) {
      const name = token.slice(2, -1).trim();
      if (stack.pop() !== name) return false;
    } else if (!/\/>$/.test(token) && !/^<!/.test(token)) {
      const name = token.slice(1).trim().split(/[\s>]/)[0];
      if (!name || /["']/.test(name)) return false;
      stack.push(name);
    }
  }
  return stack.length === 0;
}
