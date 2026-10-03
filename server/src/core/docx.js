// Minimal genuine .docx builder (WordprocessingML in a PKZIP package).
// Headings + paragraphs + bullet lists. Real file — opens in Word,
// LibreOffice, Google Docs. Stored (method 0), no dependencies.

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

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

function buildZip(files) {
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

/**
 * doc: { title, blocks: [{h?: 1|2|3, p?: string, bullets?: string[]}] }
 * Returns Buffer of a genuine .docx.
 */
export function buildDocx(doc) {
  const title = String(doc?.title || '').trim().slice(0, 150);
  const blocks = Array.isArray(doc?.blocks) ? doc.blocks.slice(0, 200) : [];
  if (!title) throw new Error('Document needs a title.');
  if (!blocks.length) throw new Error('Document needs at least one block.');
  const paras = [];
  paras.push(`<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t xml:space="preserve">${esc(title)}</w:t></w:r></w:p>`);
  for (const b of blocks) {
    if (b.h === 1 || b.h === 2 || b.h === 3) {
      paras.push(`<w:p><w:pPr><w:pStyle w:val="Heading${b.h}"/></w:pPr><w:r><w:t xml:space="preserve">${esc(String(b.text || b.p || '').slice(0, 500))}</w:t></w:r></w:p>`);
    } else if (Array.isArray(b.bullets)) {
      for (const li of b.bullets.slice(0, 30)) {
        paras.push(`<w:p><w:pPr><w:pStyle w:val="ListBullet"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t xml:space="preserve">${esc(String(li).slice(0, 500))}</w:t></w:r></w:p>`);
      }
    } else if (b.p) {
      paras.push(`<w:p><w:r><w:t xml:space="preserve">${esc(String(b.p).slice(0, 2000))}</w:t></w:r></w:p>`);
    }
  }
  const B = (s) => Buffer.from(s, 'utf8');
  return buildZip([
    {
      path: '[Content_Types].xml',
      data: B(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`),
    },
    {
      path: '_rels/.rels',
      data: B(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`),
    },
    {
      path: 'word/document.xml',
      data: B(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paras.join('')}
<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`),
    },
    {
      path: 'word/styles.xml',
      data: B(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:pPr><w:spacing w:after="240"/></w:pPr><w:rPr><w:b/><w:sz w:val="52"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="Heading 1"/><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="Heading 2"/><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="Heading 3"/><w:rPr><w:b/><w:sz w:val="24"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="ListBullet"><w:name w:val="List Bullet"/><w:pPr><w:ind w:left="720"/></w:pPr></w:style>
</w:styles>`),
    },
    {
      path: 'word/_rels/document.xml.rels',
      data: B(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/></Relationships>`),
    },
    {
      path: 'word/numbering.xml',
      data: B(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="singleLevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:tabs><w:tab w:val="num" w:pos="720"/></w:tabs><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`),
    },
    {
      path: 'docProps/core.xml',
      data: B(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"><dc:title xmlns:dc="http://purl.org/dc/elements/1.1/">${esc(title)}</dc:title><dc:creator xmlns:dc="http://purl.org/dc/elements/1.1/">Metaloid</dc:creator></cp:coreProperties>`),
    },
    {
      path: 'docProps/app.xml',
      data: B(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Metaloid</Application></Properties>`),
    },
  ]);
}

/** Structural validation of a .docx buffer. */
export function validateDocxBytes(buf) {
  const issues = [];
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf || []);
  if (b.length < 100) issues.push('too small to be a package');
  if (b.readUInt32LE(0) !== 0x04034b50) issues.push('missing PKZIP signature');
  let entries = [];
  try { entries = zipEntries(b); } catch (e) { issues.push('invalid ZIP central directory: ' + String(e.message || e).slice(0, 80)); }
  const names = new Set(entries.map((e) => e.name));
  for (const name of ['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/styles.xml', 'word/_rels/document.xml.rels', 'word/numbering.xml', 'docProps/core.xml', 'docProps/app.xml']) {
    if (!names.has(name)) issues.push(`missing required package part: ${name}`);
  }
  let documentXml = '';
  try { documentXml = zipRead(b, entries.find((e) => e.name === 'word/document.xml')); } catch (e) { issues.push('cannot reopen word/document.xml: ' + String(e.message || e).slice(0, 80)); }
  if (documentXml && !wellFormedXml(documentXml)) issues.push('malformed XML: word/document.xml');
  const paras = (documentXml.match(/<w:p[\s>]/g) || []).length;
  if (!paras) issues.push('no paragraphs found');
  const texts = (documentXml.match(/<w:t[^>]*>[^<]+<\/w:t>/g) || []).length;
  if (!texts) issues.push('no text runs found');
  return { ok: issues.length === 0, issues, paragraphs: paras, bytes: b.length };
}

function zipEntries(b) {
  let end = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 66000); i--) if (b.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  if (end < 0) throw new Error('no end-of-central-directory');
  const count = b.readUInt16LE(end + 10); let at = b.readUInt32LE(end + 16); const out = [];
  for (let i = 0; i < count; i++) {
    if (b.readUInt32LE(at) !== 0x02014b50) throw new Error('corrupt central directory');
    const n = b.readUInt16LE(at + 28), x = b.readUInt16LE(at + 30), c = b.readUInt16LE(at + 32);
    out.push({ name: b.toString('utf8', at + 46, at + 46 + n), size: b.readUInt32LE(at + 20), local: b.readUInt32LE(at + 42) });
    at += 46 + n + x + c;
  }
  return out;
}
function zipRead(b, entry) {
  if (!entry || b.readUInt32LE(entry.local) !== 0x04034b50) throw new Error('bad local file header');
  const n = b.readUInt16LE(entry.local + 26), x = b.readUInt16LE(entry.local + 28), start = entry.local + 30 + n + x;
  return b.subarray(start, start + entry.size).toString('utf8');
}
function wellFormedXml(xml) {
  const stack = [];
  for (const token of String(xml).replace(/<\?[^>]*\?>/g, '').match(/<[^>]+>/g) || []) {
    if (/^<\//.test(token)) { if (stack.pop() !== token.slice(2, -1).trim()) return false; }
    else if (!/\/>$/.test(token) && !/^<!/.test(token)) stack.push(token.slice(1).trim().split(/[\s>]/)[0]);
  }
  return stack.length === 0;
}
