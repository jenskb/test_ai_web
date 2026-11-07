import { describe, it, expect } from "vitest";
import { parseEtherCAT } from "./parse";
import { parseEthernet } from "../ethernet/parse";
import { ethercatFrame } from "../test/helpers";

const SRC = [0, 0, 0, 0, 0, 1];
const DST = [1, 1, 5, 1, 0, 0];

function parseFrame(frame: Uint8Array) {
  const eth = parseEthernet(frame, 0, frame.length);
  return parseEtherCAT(frame, 0, frame.length, 0, eth);
}

describe("parseEtherCAT 数据报解析", () => {
  it("解析单个逻辑寻址 LRD 数据报", () => {
    const frame = ethercatFrame(SRC, DST, [
      { cmd: 10, logical: 0x00000100, data: [1, 2, 3, 4, 5, 6], wkc: 1 },
    ]);
    const f = parseFrame(frame);

    expect(f.isDatagram).toBe(true);
    expect(f.datagrams).toHaveLength(1);
    const d = f.datagrams[0]!;
    expect(d.cmdName).toBe("LRD");
    expect(d.cmd).toBe(10);
    expect(d.logicalAddr).toBe(0x00000100);
    expect(d.adp).toBeUndefined();
    expect(d.ado).toBeUndefined();
    expect(d.length).toBe(6);
    expect(d.wkc).toBe(1);
    expect(d.irq).toBe(0);
    expect(d.more).toBe(false);
    expect(f.frameLength).toBe(10 + 6 + 2);
  });

  it("解析物理寻址 APRD 数据报的 ADP/ADO", () => {
    const frame = ethercatFrame(SRC, DST, [
      { cmd: 1, adp: 0x1234, ado: 0x0010, data: [0xaa, 0xbb], wkc: 1 },
    ]);
    const f = parseFrame(frame);
    const d = f.datagrams[0]!;
    expect(d.cmdName).toBe("APRD");
    expect(d.adp).toBe(0x1234);
    expect(d.ado).toBe(0x0010);
    expect(d.logicalAddr).toBeUndefined();
    expect(d.length).toBe(2);
  });

  it("解析一帧中的多个数据报", () => {
    const frame = ethercatFrame(SRC, DST, [
      { cmd: 10, logical: 0x1000, data: [1, 2], wkc: 1, more: true },
      { cmd: 11, logical: 0x2000, data: [3, 4, 5], wkc: 2, more: false },
    ]);
    const f = parseFrame(frame);
    expect(f.datagrams).toHaveLength(2);
    expect(f.datagrams[0]!.more).toBe(true);
    expect(f.datagrams[1]!.more).toBe(false);
    expect(f.datagrams[1]!.cmdName).toBe("LWR");
    expect(f.datagrams[1]!.wkc).toBe(2);
    // 数据报区长度 = 两个数据报之和。
    expect(f.frameLength).toBe((10 + 2 + 2) + (10 + 3 + 2));
  });

  it("未知命令保留原始值，不导致解析失败", () => {
    const frame = ethercatFrame(SRC, DST, [
      { cmd: 99, logical: 0, data: [1], wkc: 0 },
    ]);
    const f = parseFrame(frame);
    expect(f.datagrams).toHaveLength(1);
    expect(f.datagrams[0]!.cmdName).toBe("UNKNOWN");
    expect(f.datagrams[0]!.cmd).toBe(99);
  });

  it("正确解析 circulating 与 more 标志位", () => {
    const frame = ethercatFrame(SRC, DST, [
      { cmd: 7, adp: 0, ado: 0, data: [], wkc: 3, circulating: true, more: true },
      { cmd: 8, adp: 0, ado: 0, data: [9], wkc: 1, circulating: false, more: false },
    ]);
    const f = parseFrame(frame);
    expect(f.datagrams[0]!.circulating).toBe(true);
    expect(f.datagrams[0]!.more).toBe(true);
    expect(f.datagrams[1]!.circulating).toBe(false);
    expect(f.datagrams[1]!.more).toBe(false);
  });

  it("WKC 为 0 时标记需检查", () => {
    const frame = ethercatFrame(SRC, DST, [
      { cmd: 10, logical: 0, data: [1, 2], wkc: 0 },
    ]);
    const f = parseFrame(frame);
    expect(f.datagrams[0]!.wkc).toBe(0);
    expect(f.datagrams[0]!.anomalies.some((a) => a.kind === "wkc-zero")).toBe(true);
  });

  it("偏移为报文内相对偏移（0 起）", () => {
    const frame = ethercatFrame(SRC, DST, [
      { cmd: 10, logical: 0, data: [1, 2], wkc: 1 },
    ]);
    const f = parseFrame(frame);
    // 无 VLAN：以太网头 14 字节。
    expect(f.ecatHeaderOffsetInPacket).toBe(14);
    const d = f.datagrams[0]!;
    expect(d.offsetInPacket).toBe(16); // 14 + 2 帧头
    expect(d.dataOffsetInPacket).toBe(26); // 16 + 10 数据报头
    expect(d.wkcOffsetInPacket).toBe(28); // 26 + 2 数据
  });
});

describe("parseEtherCAT 边界与异常", () => {
  it("非数据报类型明确提示且不强行解析", () => {
    // 构造一个 Type=2（ADS）的帧：修改 EtherCAT 帧头类型字段。
    const base = ethercatFrame(SRC, DST, [
      { cmd: 10, logical: 0, data: [1], wkc: 1 },
    ]);
    const bytes = new Uint8Array(base);
    const headerOffset = 14; // 6 + 6 + 2
    const length = bytes[headerOffset]! | (bytes[headerOffset + 1]! << 8);
    const newHeader = (length & 0x07ff) | (2 << 12);
    bytes[headerOffset] = newHeader & 0xff;
    bytes[headerOffset + 1] = (newHeader >> 8) & 0xff;

    const f = parseFrame(bytes);
    expect(f.isDatagram).toBe(false);
    expect(f.frameType).toBe(2);
    expect(f.datagrams).toHaveLength(0);
    expect(f.anomalies.some((a) => a.kind === "frame-type-not-datagram")).toBe(true);
  });

  it("以太网填充不被当作 EtherCAT 数据", () => {
    const frame = ethercatFrame(
      SRC,
      DST,
      [{ cmd: 10, logical: 0, data: [1, 2, 3, 4], wkc: 1 }],
      { padTo: 60 },
    );
    const f = parseFrame(frame);
    expect(f.datagrams).toHaveLength(1);
    // 60 字节帧：14(eth) + 2(ecat头) + 16(数据报) = 32，填充 28 字节。
    expect(f.paddingLength).toBe(60 - (14 + 2 + 16));
    expect(f.paddingLength).toBe(28);
  });

  it("数据报长度越界时标记异常", () => {
    // 数据报声明 6 字节数据，但截断到只剩 2 字节可用。
    const full = ethercatFrame(SRC, DST, [
      { cmd: 10, logical: 0, data: [1, 2, 3, 4, 5, 6], wkc: 1 },
    ]);
    // 截断：仅保留以太网头 + 帧头 + 数据报头 + 2 字节数据。
    const truncated = full.slice(0, 14 + 2 + 10 + 2);
    const f = parseFrame(truncated);
    expect(
      f.datagrams[0]!.anomalies.some((a) => a.kind === "length-out-of-bounds"),
    ).toBe(true);
  });

  it("最后一个数据报标记 more 但无后续时标记不一致", () => {
    const frame = ethercatFrame(SRC, DST, [
      { cmd: 10, logical: 0, data: [1], wkc: 1, more: true },
    ]);
    const f = parseFrame(frame);
    expect(f.anomalies.some((a) => a.kind === "more-flag-mismatch")).toBe(true);
  });
});
