// 测试夹具：PCAPNG 块构建器（独立于被解析器，按规范逐字节写入），
// 以及人工核对的固定字节样例（协议帧与完整 pcapng）。

export function concat(...arrs: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const a of arrs) total += a.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrs) {
    out.set(a, off);
    off += a.length;
  }
  return out;
}

export function putU16(buf: Uint8Array, off: number, v: number, le: boolean): void {
  if (le) {
    buf[off] = v & 0xff;
    buf[off + 1] = (v >> 8) & 0xff;
  } else {
    buf[off] = (v >> 8) & 0xff;
    buf[off + 1] = v & 0xff;
  }
}

export function putU32(buf: Uint8Array, off: number, v: number, le: boolean): void {
  if (le) {
    buf[off] = v & 0xff;
    buf[off + 1] = (v >> 8) & 0xff;
    buf[off + 2] = (v >> 16) & 0xff;
    buf[off + 3] = (v >> 24) & 0xff;
  } else {
    buf[off] = (v >> 24) & 0xff;
    buf[off + 1] = (v >> 16) & 0xff;
    buf[off + 2] = (v >> 8) & 0xff;
    buf[off + 3] = v & 0xff;
  }
}

export function putI64(buf: Uint8Array, off: number, v: bigint, le: boolean): void {
  const u = v < 0n ? (1n << 64n) + v : v;
  putU32(buf, off, Number(u & 0xffffffffn), le);
  putU32(buf, off + 4, Number((u >> 32n) & 0xffffffffn), le);
}

function block(le: boolean, type: number, body: Uint8Array): Uint8Array {
  const totalLen = 8 + body.length + 4;
  const buf = new Uint8Array(totalLen);
  putU32(buf, 0, type, le);
  putU32(buf, 4, totalLen, le);
  buf.set(body, 8);
  putU32(buf, totalLen - 4, totalLen, le);
  return buf;
}

export const BT_SHB = 0x0a0d0d0a;
export const BT_IDB = 0x00000001;
export const BT_PACKET = 0x00000002;
export const BT_SPB = 0x00000003;
export const BT_EPB = 0x00000006;

export function shb(le: boolean, sectionLength = -1): Uint8Array {
  const body = new Uint8Array(16);
  putU32(body, 0, 0x1a2b3c4d, le);
  putU16(body, 4, 1, le); // major
  putU16(body, 6, 0, le); // minor
  if (sectionLength < 0) {
    body.fill(0xff, 8, 16);
  } else {
    putI64(body, 8, BigInt(sectionLength), le);
  }
  return block(le, BT_SHB, body);
}

export interface IdbOptions {
  linkType?: number;
  snapLen?: number;
  tsResol?: number; // 原始选项字节
  tsOffset?: bigint;
  name?: string;
}

export function idb(le: boolean, opts: IdbOptions = {}): Uint8Array {
  const { linkType = 1, snapLen = 65535, tsResol, tsOffset, name } = opts;
  const optParts: Uint8Array[] = [];
  if (name !== undefined) {
    const bytes = new TextEncoder().encode(name);
    const pad = (4 - (bytes.length % 4)) % 4;
    const o = new Uint8Array(4 + bytes.length + pad);
    putU16(o, 0, 2, le);
    putU16(o, 2, bytes.length, le);
    o.set(bytes, 4);
    optParts.push(o);
  }
  if (tsResol !== undefined) {
    const o = new Uint8Array(8);
    putU16(o, 0, 9, le);
    putU16(o, 2, 1, le);
    o[4] = tsResol;
    optParts.push(o);
  }
  if (tsOffset !== undefined) {
    const o = new Uint8Array(16);
    putU16(o, 0, 14, le);
    putU16(o, 2, 8, le);
    putI64(o, 4, tsOffset, le);
    optParts.push(o);
  }
  optParts.push(new Uint8Array(4)); // opt_endofopt

  let optLen = 0;
  for (const o of optParts) optLen += o.length;
  const body = new Uint8Array(8 + optLen);
  putU16(body, 0, linkType, le);
  putU16(body, 2, 0, le);
  putU32(body, 4, snapLen, le);
  let off = 8;
  for (const o of optParts) {
    body.set(o, off);
    off += o.length;
  }
  return block(le, BT_IDB, body);
}

export interface EpbOptions {
  ifid?: number;
  tsHigh?: number;
  tsLow?: number;
  caplen?: number;
  origlen?: number;
  data: Uint8Array;
}

export function epb(le: boolean, opts: EpbOptions): Uint8Array {
  const { ifid = 0, tsHigh = 0, tsLow = 0, data } = opts;
  const caplen = opts.caplen ?? data.length;
  const origlen = opts.origlen ?? data.length;
  const pad = (4 - (data.length % 4)) % 4;
  const body = new Uint8Array(20 + data.length + pad);
  putU32(body, 0, ifid, le);
  putU32(body, 4, tsHigh, le);
  putU32(body, 8, tsLow, le);
  putU32(body, 12, caplen, le);
  putU32(body, 16, origlen, le);
  body.set(data, 20);
  return block(le, BT_EPB, body);
}

export function spb(le: boolean, origlen: number, data: Uint8Array): Uint8Array {
  const pad = (4 - (data.length % 4)) % 4;
  const body = new Uint8Array(4 + data.length + pad);
  putU32(body, 0, origlen, le);
  body.set(data, 4);
  return block(le, BT_SPB, body);
}

export function rawBlock(le: boolean, type: number, body: Uint8Array): Uint8Array {
  return block(le, type, body);
}

// —— 人工核对的固定字节样例（手写，非由解析器反向生成）——

// 单数据报 NOP 帧：以太网(14) + EtherCAT 帧头(2, len=12, type=1) + NOP 数据报(12)。
// NOP 数据报：cmd=00 idx=00 addr=00000000 lenword=0000 irq=0000 wkc=0000。
export const FRAME_NOP = Uint8Array.from([
  0x01, 0x01, 0x05, 0x01, 0x00, 0x00, // dst
  0x00, 0x00, 0x00, 0x00, 0x00, 0x01, // src
  0x88, 0xa4, // EtherType
  0x0c, 0x10, // ECAT 帧头：len=12, type=1
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, // NOP
]);

// 多数据报帧：LRD(logical 0x00001234, len=2, M=1) + NOP(M=0)。
// LRD 数据报：cmd=0A idx=01 addr=34120000 lenword=8002(dlen=2,M=1) irq=0000 data=AABB wkc=0100。
// 帧头 len = 14 + 12 = 26 = 0x1A → hdr = 26 | 0x1000 = 0x101A。
export const FRAME_TWO_DATAGRAMS = Uint8Array.from([
  0x01, 0x01, 0x05, 0x01, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x01,
  0x88, 0xa4,
  0x1a, 0x10, // ECAT 帧头：len=26, type=1
  0x0a, 0x01, 0x34, 0x12, 0x00, 0x00, 0x02, 0x80, 0x00, 0x00, 0xaa, 0xbb, 0x01, 0x00, // LRD
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, // NOP
]);

// 未知命令 0x7F 数据报：cmd=7F idx=00 addr=00000000 lenword=0000 irq=0000 wkc=0000。
export const FRAME_UNKNOWN_CMD = Uint8Array.from([
  0x01, 0x01, 0x05, 0x01, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x01,
  0x88, 0xa4,
  0x0c, 0x10,
  0x7f, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
]);

// 叠加 VLAN 帧：VLAN(0x8100) + QinQ(0x88A8) + EtherCAT(0x88A4) + 帧头 + NOP。
export const FRAME_STACKED_VLAN = Uint8Array.from([
  0x01, 0x01, 0x05, 0x01, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x01,
  0x81, 0x00, 0x00, 0x20, // VLAN VID=0x20
  0x88, 0xa8, 0x00, 0x30, // QinQ VID=0x30
  0x88, 0xa4, // 内部 EtherType
  0x0c, 0x10,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
]);

// 完整手写小端 pcapng：SHB + IDB(tsresol=9ns) + EPB(ts=1000ns, NOP 帧)。
export const PCAPNG_LE_NOP = Uint8Array.from([
  // SHB（28 字节）
  0x0a, 0x0d, 0x0d, 0x0a,
  0x1c, 0x00, 0x00, 0x00,
  0x4d, 0x3c, 0x2b, 0x1a, // BOM LE
  0x01, 0x00, 0x00, 0x00, // 版本 1.0
  0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, // section length = -1
  0x1c, 0x00, 0x00, 0x00,
  // IDB（32 字节）：linkType=1, snapLen=65535, if_tsresol=9
  0x01, 0x00, 0x00, 0x00,
  0x20, 0x00, 0x00, 0x00,
  0x01, 0x00, 0x00, 0x00, 0xff, 0xff, 0x00, 0x00,
  0x09, 0x00, 0x01, 0x00, 0x09, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00,
  0x20, 0x00, 0x00, 0x00,
  // EPB（60 字节）：ifid=0, ts=1000ns, caplen=origlen=28, NOP 帧
  0x06, 0x00, 0x00, 0x00,
  0x3c, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00,
  0xe8, 0x03, 0x00, 0x00,
  0x1c, 0x00, 0x00, 0x00,
  0x1c, 0x00, 0x00, 0x00,
  0x01, 0x01, 0x05, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x88, 0xa4,
  0x0c, 0x10, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x3c, 0x00, 0x00, 0x00,
]);
