import { describe, it, expect } from "vitest";
import { parseBuffer } from "./parse";
import { computeStats } from "../stats/compute";
import { ByteWriter, block, ethercatFrame } from "../test/helpers";

const SRC = [0, 0, 0, 0, 0, 1];
const DST = [1, 1, 5, 1, 0, 0];

function buildPcapng(frames: Uint8Array[]): ArrayBuffer {
  const w = new ByteWriter();
  block(w, 0x0a0d0d0a, (bw) => {
    bw.raw(0x4d, 0x3c, 0x2b, 0x1a);
    bw.u16le(1).u16le(0);
    bw.u64le(0xffffffffffffffffn);
    bw.u16le(0).u16le(0);
  });
  block(w, 1, (bw) => {
    bw.u16le(1).u16le(0).u32le(65535);
    bw.u16le(0).u16le(0);
  });
  frames.forEach((f, i) => {
    block(w, 6, (bw) => {
      bw.u32le(0);
      bw.u32le(0);
      bw.u32le(i * 1000); // 时间戳 ticks（10^-6，间隔 1ms）
      bw.u32le(f.length);
      bw.u32le(f.length);
      for (const b of f) bw.u8(b);
      const pad = (4 - (f.length % 4)) % 4;
      bw.zero(pad);
    });
  });
  return w.toArrayBuffer();
}

describe("parseBuffer 端到端", () => {
  it("解析含 EtherCAT 帧的 PCAPNG 文件", () => {
    const frame = ethercatFrame(
      SRC,
      DST,
      [
        { cmd: 10, logical: 0x00000100, data: [1, 2, 3, 4, 5, 6], wkc: 1 },
        { cmd: 12, logical: 0x00000200, data: [7, 8], wkc: 2, more: false },
      ],
      { padTo: 60 },
    );
    const buf = buildPcapng([frame]);
    const r = parseBuffer(buf, { fileName: "test.pcapng" });

    expect(r.packets).toHaveLength(1);
    expect(r.ethercatFrames).toHaveLength(1);
    const f = r.ethercatFrames[0]!;
    expect(f.datagrams).toHaveLength(2);
    expect(f.datagrams[0]!.cmdName).toBe("LRD");
    expect(f.datagrams[1]!.cmdName).toBe("LRW");
    expect(f.srcMac).toBe("00:00:00:00:00:01");
    expect(f.dstMac).toBe("01:01:05:01:00:00");
    expect(f.paddingLength).toBeGreaterThan(0);
  });

  it("非 EtherCAT 报文不计入 EtherCAT 帧", () => {
    // 一个 IPv4 报文（EtherType 0x0800）。
    const w = new ByteWriter();
    w.raw(1, 1, 5, 1, 0, 0);
    w.raw(0, 0, 0, 0, 0, 1);
    w.u16be(0x0800);
    w.raw(0x45, 0, 0, 20, 0, 0, 0, 0, 64, 17, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
    const buf = buildPcapng([w.toUint8Array()]);
    const r = parseBuffer(buf);
    expect(r.packets).toHaveLength(1);
    expect(r.ethercatFrames).toHaveLength(0);
  });

  it("统计命令分布与数据报总数", () => {
    const f1 = ethercatFrame(SRC, DST, [
      { cmd: 10, logical: 0, data: [1], wkc: 1 },
      { cmd: 10, logical: 0, data: [2], wkc: 1 },
    ]);
    const f2 = ethercatFrame(SRC, DST, [
      { cmd: 11, logical: 0, data: [3], wkc: 1 },
    ]);
    const buf = buildPcapng([f1, f2]);
    const r = parseBuffer(buf);
    const stats = computeStats(r.packets, r.ethercatFrames, r.warnings);

    expect(stats.ethercatFrames).toBe(2);
    expect(stats.datagrams).toBe(3);
    expect(stats.commandDistribution.find((c) => c.cmd === 10)?.count).toBe(2);
    expect(stats.commandDistribution.find((c) => c.cmd === 11)?.count).toBe(1);
  });

  it("帧间隔统计基于完整有效数据", () => {
    const f1 = ethercatFrame(SRC, DST, [{ cmd: 10, logical: 0, data: [1], wkc: 1 }]);
    const f2 = ethercatFrame(SRC, DST, [{ cmd: 10, logical: 0, data: [2], wkc: 1 }]);
    const f3 = ethercatFrame(SRC, DST, [{ cmd: 10, logical: 0, data: [3], wkc: 1 }]);
    const buf = buildPcapng([f1, f2, f3]);
    const r = parseBuffer(buf);
    const stats = computeStats(r.packets, r.ethercatFrames, r.warnings);

    expect(stats.intervalStats).toHaveLength(1);
    const s = stats.intervalStats[0]!;
    expect(s.frameCount).toBe(3);
    expect(s.sampleCount).toBe(2);
    // 时间戳间隔 1000 ticks @ 10^-6 = 1ms。
    expect(s.min).toBeCloseTo(0.001, 6);
    expect(s.max).toBeCloseTo(0.001, 6);
    expect(s.mean).toBeCloseTo(0.001, 6);
    expect(s.stddev).toBeCloseTo(0, 6);
  });

  it("时间戳倒退被标记", () => {
    const w = new ByteWriter();
    block(w, 0x0a0d0d0a, (bw) => {
      bw.raw(0x4d, 0x3c, 0x2b, 0x1a);
      bw.u16le(1).u16le(0);
      bw.u64le(0xffffffffffffffffn);
      bw.u16le(0).u16le(0);
    });
    block(w, 1, (bw) => {
      bw.u16le(1).u16le(0).u32le(65535);
      bw.u16le(0).u16le(0);
    });
    const f = ethercatFrame(SRC, DST, [{ cmd: 10, logical: 0, data: [1], wkc: 1 }]);
    const addEpb = (ticksLow: number) =>
      block(w, 6, (bw) => {
        bw.u32le(0).u32le(0).u32le(ticksLow).u32le(f.length).u32le(f.length);
        for (const b of f) bw.u8(b);
        bw.zero((4 - (f.length % 4)) % 4);
      });
    addEpb(2000); // 先到
    addEpb(1000); // 后到（倒退）
    const r = parseBuffer(w.toArrayBuffer());
    expect(r.ethercatFrames[1]!.timeAnomaly).toBe("backward");
  });
});
