// Minimal ZIP codec — stored (uncompressed) entries only, no dependency.
//
// The History Vault needs exactly two operations: pack one JSON snapshot into
// a .zip the user can keep anywhere, and unpack a vault .zip back. Pulling a
// full archive library for that would triple the shipped bytes, so this file
// implements the smallest correct subset of the format instead:
//
//   writer: local file headers + central directory, method 0 (stored),
//           CRC-32 (IEEE), UTF-8 names (bit 11), data descriptors unused.
//   reader: central-directory walk, stored entries only, CRC verified.
//           Anything else (deflated entries, encryption, multi-disk, foreign
//           archives) is refused with a plain message — this reader only ever
//           opens files our own writer produced.

const te = new TextEncoder();
const td = new TextDecoder();

let CRC_TABLE: Uint32Array | null = null;
function crcTable(): Uint32Array {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c >>> 0;
    }
  }
  return CRC_TABLE;
}

export function crc32(data: Uint8Array): number {
  const t = crcTable();
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = t[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

function u16(v: number): Uint8Array {
  return new Uint8Array([v & 0xff, (v >>> 8) & 0xff]);
}

function u32(v: number): Uint8Array {
  return new Uint8Array([v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff]);
}

function concat(parts: Uint8Array[]): Uint8Array {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

const SIG_LOCAL = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
const SIG_CENTRAL = new Uint8Array([0x50, 0x4b, 0x01, 0x02]);
const SIG_END = new Uint8Array([0x50, 0x4b, 0x05, 0x06]);

export function zipStore(files: ZipEntry[]): Uint8Array {
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = te.encode(f.name);
    if (name.length > 0xffff) throw new Error(`Vault file name too long: ${f.name}`);
    if (f.data.length > 0xffffffff) throw new Error(`Vault file too large: ${f.name}`);
    const crc = crc32(f.data);
    const dosTime = 0x645f; // fixed stamp: content carries its own dates
    const dosDate = 0x5681;
    locals.push(concat([
      SIG_LOCAL, u16(20), u16(0x0800), u16(0), u16(dosTime), u16(dosDate),
      u32(crc), u32(f.data.length), u32(f.data.length), u16(name.length), u16(0),
      name, f.data,
    ]));
    const headerLen = 30 + name.length + f.data.length;
    centrals.push(concat([
      SIG_CENTRAL, u16(20), u16(20), u16(0x0800), u16(0), u16(dosTime), u16(dosDate),
      u32(crc), u32(f.data.length), u32(f.data.length), u16(name.length),
      u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name,
    ]));
    offset += headerLen;
  }
  const central = concat(centrals);
  const end = concat([
    SIG_END, u16(0), u16(0), u16(files.length), u16(files.length),
    u32(central.length), u32(offset), u16(0),
  ]);
  return concat([...locals, central, end]);
}

class Cursor {
  constructor(private b: Uint8Array, public o = 0) {}
  bytes(n: number): Uint8Array {
    if (this.o + n > this.b.length) throw new Error('Vault file is truncated or not ours.');
    const s = this.b.slice(this.o, this.o + n);
    this.o += n;
    return s;
  }
  u16(): number {
    const b = this.bytes(2);
    return b[0] | (b[1] << 8);
  }
  u32(): number {
    const b = this.bytes(4);
    return (b[0] | (b[1] << 8) | (b[2] << 16) | (b[3] << 24)) >>> 0;
  }
  sig(expect: Uint8Array, what: string): void {
    const b = this.bytes(4);
    for (let i = 0; i < 4; i++) {
      if (b[i] !== expect[i]) throw new Error(`Not a MetaIoid vault file (bad ${what}).`);
    }
  }
}

export function zipRead(bytes: Uint8Array): ZipEntry[] {
  // End record lives at the tail (no comment is ever written).
  if (bytes.length < 22) throw new Error('Not a MetaIoid vault file.');
  const end = new Cursor(bytes, bytes.length - 22);
  end.sig(SIG_END, 'end record');
  end.u16(); end.u16();
  const count = end.u16();
  end.u16();
  const centralSize = end.u32();
  const centralOffset = end.u32();
  end.u16();
  if (count > 64) throw new Error('Vault file holds more entries than this app writes.');
  const c = new Cursor(bytes, centralOffset);
  const entries: { name: string; crc: number; size: number; localOffset: number }[] = [];
  for (let i = 0; i < count; i++) {
    c.sig(SIG_CENTRAL, 'central entry');
    c.u16(); c.u16();
    const flags = c.u16();
    const method = c.u16();
    c.u16(); c.u16();
    const crc = c.u32();
    c.u32();
    const size = c.u32();
    const nameLen = c.u16();
    const extraLen = c.u16();
    const commentLen = c.u16();
    c.u16(); c.u16(); c.u32();
    const localOffset = c.u32();
    const name = td.decode(c.bytes(nameLen));
    c.bytes(extraLen + commentLen);
    if (method !== 0) throw new Error('Vault file uses compression this app cannot open.');
    if (flags & 0x0001) throw new Error('Vault file is encrypted and cannot be opened.');
    entries.push({ name, crc, size, localOffset });
  }
  void centralSize;
  const out: ZipEntry[] = [];
  for (const e of entries) {
    const l = new Cursor(bytes, e.localOffset);
    l.sig(SIG_LOCAL, 'local entry');
    l.u16(); l.u16();
    const method = l.u16();
    l.u16(); l.u16();
    const crc = l.u32();
    l.u32();
    const size = l.u32();
    const nameLen = l.u16();
    const extraLen = l.u16();
    const name = td.decode(l.bytes(nameLen));
    l.bytes(extraLen);
    // The local header must agree with the central directory on every field
    // that matters: a file edited by hand (or by another archiver) is refused
    // instead of being trusted on one copy and read from the other.
    if (method !== 0 || crc !== e.crc || size !== e.size || name !== e.name) {
      throw new Error('Vault file is inconsistent.');
    }
    const data = l.bytes(size);
    if (crc32(data) !== e.crc) throw new Error(`Vault entry failed its integrity check: ${e.name}`);
    out.push({ name: e.name, data });
  }
  return out;
}
