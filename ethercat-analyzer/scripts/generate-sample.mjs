// 生成一个用于本地验证的样例 PCAPNG（3 个 EtherCAT 帧，小端，纳秒分辨率）。
// 用途：在没有真实抓包时验证工具的导入、解析、选择、筛选、高亮与 CSV 导出。
// 用法：node scripts/generate-sample.mjs  →  生成 ./sample.pcapng
import { writeFileSync } from 'node:fs';

function u16(v) { return [v & 0xff, (v >> 8) & 0xff]; }
function u32(v) { return [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff]; }

function block(type, body) {
  const total = 8 + body.length + 4;
  const b = new Uint8Array(total);
  b.set(u32(type), 0);
  b.set(u32(total), 4);
  b.set(body, 8);
  b.set(u32(total), total - 4);
  return b;
}

function shb() {
  const body = new Uint8Array(16);
  body.set(u32(0x1a2b3c4d), 0); // BOM 小端
  body.set(u16(1), 4); // 版本 1.0
  body.set(u16(0), 6);
  body.fill(0xff, 8, 16); // section length = -1
  return block(0x0a0d0d0a, body);
}

function idb() {
  const b = new Uint8Array(20);
  b.set(u16(1), 0); // linkType = Ethernet
  b.set(u16(0), 2);
  b.set(u32(65535), 4); // snapLen
  b.set([9, 0, 1, 0, 9, 0, 0, 0], 8); // if_tsresol = 9（纳秒）
  b.set([0, 0, 0, 0], 16); // opt_endofopt
  return block(0x00000001, b);
}

function epb(tsLow, frame) {
  const pad = (4 - (frame.length % 4)) % 4;
  const body = new Uint8Array(20 + frame.length + pad);
  body.set(u32(0), 0); // interface id
  body.set(u32(0), 4); // timestamp high
  body.set(u32(tsLow), 8); // timestamp low
  body.set(u32(frame.length), 12); // captured len
  body.set(u32(frame.length), 16); // original len
  body.set(frame, 20);
  return block(0x00000006, body);
}

// 单数据报 NOP 帧：以太网(14) + EtherCAT 帧头(2, len=12) + NOP 数据报(12)。
const FRAME_NOP = Uint8Array.from([
  0x01, 0x01, 0x05, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x88, 0xa4,
  0x0c, 0x10, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
]);
// 多数据报帧：LRD（逻辑地址 0x1234，len=2，WKC=1）+ NOP。
const FRAME_LRD_NOP = Uint8Array.from([
  0x01, 0x01, 0x05, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x88, 0xa4,
  0x1a, 0x10, 0x0a, 0x01, 0x34, 0x12, 0x00, 0x00, 0x02, 0x80, 0x00, 0x00, 0xaa, 0xbb, 0x01, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
]);
// 未知命令 0x7F 帧。
const FRAME_UNKNOWN = Uint8Array.from([
  0x01, 0x01, 0x05, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x88, 0xa4,
  0x0c, 0x10, 0x7f, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
]);

const parts = [shb(), idb(), epb(1000, FRAME_NOP), epb(2000, FRAME_LRD_NOP), epb(3000, FRAME_UNKNOWN)];
const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
let off = 0;
for (const p of parts) { out.set(p, off); off += p.length; }
writeFileSync(new URL('../sample.pcapng', import.meta.url), out);
console.log('已生成 sample.pcapng（' + out.length + ' 字节，3 帧）。');
