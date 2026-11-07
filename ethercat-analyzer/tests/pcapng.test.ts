import { describe, expect, it } from 'vitest';
import { PcapngParser, LINKTYPE_ETHERNET } from '../src/pcapng/parse';
import { dissectPacket } from '../src/analyze';
import { finalizeFrames } from '../src/stats/stats';
import type { FrameIndex, InterfaceInfo, ParseResult } from '../src/types';
import { parsePcapngBuffer } from '../src/parseBuffer';
import {
  BT_EPB,
  BT_PACKET,
  FRAME_NOP,
  PCAPNG_LE_NOP,
  concat,
  epb,
  idb,
  rawBlock,
  shb,
  spb,
} from './fixtures';

// 用极小分块推送，验证流式解析在块跨块边界时仍正确。
function parseStreaming(buffer: Uint8Array, chunkSize: number): ParseResult {
  const frames: FrameIndex[] = [];
  const interfaces: InterfaceInfo[] = [];
  const warnings: string[] = [];
  const names = new Map<number, string>();
  const parser = new PcapngParser({
    onInterface: (i) => {
      interfaces.push(i);
      names.set(i.id, i.name);
    },
    onPacket: (p) => frames.push(dissectPacket(p)),
    onWarning: (m) => warnings.push(m),
  });
  for (let off = 0; off < buffer.length; off += chunkSize) {
    parser.push(buffer.subarray(off, off + chunkSize), off);
  }
  parser.finish();
  const { stats, intervalStats } = finalizeFrames(frames, names);
  return {
    interfaces,
    frames,
    sectionCount: parser.sectionCount,
    warnings,
    truncated: parser.isTruncated,
    stats,
    intervalStats,
    fileSize: buffer.length,
  };
}

describe('PCAPNG 解析', () => {
  it('手写小端 pcapng：接口、时间戳、分辨率、帧解析正确', () => {
    const r = parsePcapngBuffer(PCAPNG_LE_NOP);
    expect(r.interfaces).toHaveLength(1);
    expect(r.interfaces[0]!.linkType).toBe(LINKTYPE_ETHERNET);
    expect(r.interfaces[0]!.tsResol).toEqual({ kind: 'decimal', exp: 9 });
    expect(r.frames).toHaveLength(1);
    const f = r.frames[0]!;
    expect(f.timestampRaw).toBe(1000n);
    expect(f.capturedLen).toBe(28);
    expect(f.eth?.isEtherCAT).toBe(true);
    expect(f.ecat?.datagrams).toHaveLength(1);
    expect(r.stats.ethercatFrames).toBe(1);
  });

  it('大端 pcapng 正确解析', () => {
    const buf = concat(
      shb(false),
      idb(false, { linkType: 1, tsResol: 6 }),
      epb(false, { ifid: 0, tsHigh: 0, tsLow: 1000000, data: FRAME_NOP }),
    );
    const r = parsePcapngBuffer(buf);
    expect(r.interfaces).toHaveLength(1);
    expect(r.interfaces[0]!.tsResol).toEqual({ kind: 'decimal', exp: 6 });
    expect(r.frames).toHaveLength(1);
    expect(r.frames[0]!.timestampRaw).toBe(1000000n);
    expect(r.frames[0]!.eth?.isEtherCAT).toBe(true);
  });

  it('流式分块（跨块边界）结果与整块一致', () => {
    const buf = concat(
      shb(true),
      idb(true, { tsResol: 9 }),
      epb(true, { tsLow: 1000, data: FRAME_NOP }),
      epb(true, { tsLow: 2000, data: FRAME_NOP }),
    );
    const whole = parsePcapngBuffer(buf);
    const streamed = parseStreaming(buf, 3);
    expect(streamed.frames).toHaveLength(whole.frames.length);
    expect(streamed.frames.map((f) => f.timestampRaw)).toEqual(
      whole.frames.map((f) => f.timestampRaw),
    );
    expect(streamed.stats.ethercatFrames).toBe(whole.stats.ethercatFrames);
  });

  it('多 Section：接口编号重新映射', () => {
    const buf = concat(
      shb(true),
      idb(true, { linkType: 1 }),
      epb(true, { ifid: 0, tsLow: 1, data: FRAME_NOP }),
      shb(true),
      idb(true, { linkType: 1 }),
      epb(true, { ifid: 0, tsLow: 2, data: FRAME_NOP }),
    );
    const r = parsePcapngBuffer(buf);
    expect(r.sectionCount).toBe(2);
    expect(r.frames).toHaveLength(2);
    // 两个 section 的接口 ID 都从 0 开始。
    expect(r.frames[0]!.interfaceId).toBe(0);
    expect(r.frames[1]!.interfaceId).toBe(0);
  });

  it('多接口与不同时间分辨率（十进制 + 二进制）', () => {
    const buf = concat(
      shb(true),
      idb(true, { linkType: 1, tsResol: 6 }), // 微秒
      idb(true, { linkType: 1, tsResol: 0x80 | 10 }), // 2^-10
      epb(true, { ifid: 0, tsLow: 1000000, data: FRAME_NOP }), // 1 秒
      epb(true, { ifid: 1, tsLow: 1024, data: FRAME_NOP }), // 1 秒
    );
    const r = parsePcapngBuffer(buf);
    expect(r.interfaces).toHaveLength(2);
    expect(r.interfaces[0]!.tsResol).toEqual({ kind: 'decimal', exp: 6 });
    expect(r.interfaces[1]!.tsResol).toEqual({ kind: 'binary', exp: 10 });
    expect(r.frames[0]!.tsResol).toEqual({ kind: 'decimal', exp: 6 });
    expect(r.frames[1]!.tsResol).toEqual({ kind: 'binary', exp: 10 });
  });

  it('if_tsoffset 与 if_name 被读取', () => {
    const buf = concat(
      shb(true),
      idb(true, { linkType: 1, tsOffset: 3600n, name: 'eth0' }),
      epb(true, { tsLow: 0, data: FRAME_NOP }),
    );
    const r = parsePcapngBuffer(buf);
    expect(r.interfaces[0]!.tsOffset).toBe(3600n);
    expect(r.interfaces[0]!.name).toBe('eth0');
  });

  it('SPB 无时间戳，不伪造', () => {
    const buf = concat(shb(true), idb(true, { linkType: 1, snapLen: 65535 }), spb(true, 28, FRAME_NOP));
    const r = parsePcapngBuffer(buf);
    expect(r.frames).toHaveLength(1);
    expect(r.frames[0]!.timestampRaw).toBeNull();
    expect(r.frames[0]!.hasTimestamp).toBeFalsy();
    expect(r.frames[0]!.interfaceId).toBe(0);
    expect(r.frames[0]!.eth?.isEtherCAT).toBe(true);
  });

  it('未知块类型安全跳过并给出警告', () => {
    const buf = concat(
      shb(true),
      idb(true, { linkType: 1 }),
      rawBlock(true, 0xdeadbeef, new Uint8Array(8)), // 未知块
      epb(true, { tsLow: 1, data: FRAME_NOP }),
    );
    const r = parsePcapngBuffer(buf);
    expect(r.frames).toHaveLength(1);
    expect(r.warnings.some((w) => w.includes('不支持的块类型'))).toBe(true);
  });

  it('已废弃 Packet Block 明确提示（不静默漏报文）', () => {
    const buf = concat(shb(true), idb(true, { linkType: 1 }), rawBlock(true, BT_PACKET, new Uint8Array(8)));
    const r = parsePcapngBuffer(buf);
    expect(r.warnings.some((w) => w.includes('废弃'))).toBe(true);
  });

  it('损坏块长度（小于最小长度）停止解析并警告', () => {
    // 合法 SHB 之后跟一个 total length = 8（非法）的 IDB。
    const bad = Uint8Array.from([0x01, 0x00, 0x00, 0x00, 0x08, 0x00, 0x00, 0x00]);
    const buf = concat(shb(true), bad);
    const r = parsePcapngBuffer(buf);
    expect(r.warnings.some((w) => w.includes('最小块长度'))).toBe(true);
  });

  it('截断文件被标记', () => {
    const full = concat(shb(true), idb(true, { linkType: 1 }), epb(true, { tsLow: 1, data: FRAME_NOP }));
    const truncated = full.subarray(0, full.length - 10);
    const r = parsePcapngBuffer(truncated);
    expect(r.truncated).toBe(true);
    expect(r.frames.length).toBeLessThanOrEqual(1);
  });

  it('块首尾长度不一致给出警告', () => {
    const buf = concat(shb(true), idb(true, { linkType: 1 }));
    // 篡改 IDB 尾部长度字段的最高字节（缓冲区的最后 1 字节）。
    const bad = new Uint8Array(buf);
    bad[bad.length - 1] = 0xff;
    const r = parsePcapngBuffer(bad);
    expect(r.warnings.some((w) => w.includes('首尾长度不一致'))).toBe(true);
  });

  it('非以太网 LinkType 明确提示而非默认当以太网', () => {
    const buf = concat(shb(true), idb(true, { linkType: 113 }), epb(true, { tsLow: 1, data: FRAME_NOP }));
    const r = parsePcapngBuffer(buf);
    expect(r.frames[0]!.notEthernet).toBeDefined();
    expect(r.frames[0]!.eth).toBeNull();
  });

  it('EPB 引用未定义接口给出警告', () => {
    const buf = concat(shb(true), idb(true, { linkType: 1 }), epb(true, { ifid: 5, tsLow: 1, data: FRAME_NOP }));
    const r = parsePcapngBuffer(buf);
    expect(r.warnings.some((w) => w.includes('未定义的接口'))).toBe(true);
  });
});
