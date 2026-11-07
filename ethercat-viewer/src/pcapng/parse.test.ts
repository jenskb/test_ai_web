import { describe, it, expect } from "vitest";
import { parsePcapng } from "./parse";
import { ByteWriter, block } from "../test/helpers";

/** 构造 SHB 块体。 */
function shbBody(endian: "le" | "be"): (w: ByteWriter) => void {
  return (w) => {
    if (endian === "le") {
      w.raw(0x4d, 0x3c, 0x2b, 0x1a); // BOM：小端
      w.u16le(1); // major
      w.u16le(0); // minor
      w.u64le(0xffffffffffffffffn); // section length = -1
    } else {
      w.raw(0x1a, 0x2b, 0x3c, 0x4d); // BOM：大端
      w.u16be(1);
      w.u16be(0);
      w.u64be(0xffffffffffffffffn);
    }
    w.u16le(0).u16le(0); // opt_endofopt（2 字节码 + 2 字节长）
  };
}

/** 构造 IDB 块体（可选 tsresol / tsoffset 选项）。 */
function idbBody(
  linkType: number,
  snapLen: number,
  opts: { tsresol?: number; tsoffset?: bigint } = {},
): (w: ByteWriter) => void {
  return (w) => {
    w.u16le(linkType);
    w.u16le(0); // reserved
    w.u32le(snapLen);
    if (opts.tsresol !== undefined) {
      w.u16le(9).u16le(1).u8(opts.tsresol).zero(3); // if_tsresol
    }
    if (opts.tsoffset !== undefined) {
      w.u16le(14).u16le(8).u64le(opts.tsoffset);
    }
    w.u16le(0).u16le(0); // opt_endofopt
  };
}

/** 构造 EPB 块体。 */
function epbBody(
  ifId: number,
  tsHigh: number,
  tsLow: number,
  capLen: number,
  origLen: number,
  data: number[],
): (w: ByteWriter) => void {
  return (w) => {
    w.u32le(ifId);
    w.u32le(tsHigh);
    w.u32le(tsLow);
    w.u32le(capLen);
    w.u32le(origLen);
    for (const b of data) w.u8(b);
    // 报文数据按 4 字节对齐。
    const pad = (4 - (data.length % 4)) % 4;
    w.zero(pad);
  };
}

/** 构造 SPB 块体。 */
function spbBody(origLen: number, data: number[]): (w: ByteWriter) => void {
  return (w) => {
    w.u32le(origLen);
    for (const b of data) w.u8(b);
    const pad = (4 - (data.length % 4)) % 4;
    w.zero(pad);
  };
}

/** 一个完整的小端 PCAPNG 文件（SHB + IDB + 若干 EPB）。 */
function makePcapng(): ByteWriter {
  const w = new ByteWriter();
  block(w, 0x0a0d0d0a, shbBody("le"));
  block(w, 1, idbBody(1, 65535));
  return w;
}

describe("parsePcapng SHB 与字节序", () => {
  it("识别小端 SHB 并读取 IDB", () => {
    const w = makePcapng();
    const r = parsePcapng(w.toArrayBuffer());
    expect(r.interfaces).toHaveLength(1);
    expect(r.interfaces[0]!.linkType).toBe(1);
    expect(r.interfaces[0]!.snapLen).toBe(65535);
    expect(r.sections).toBe(1);
    expect(r.warnings).toHaveLength(0);
  });

  it("识别大端 SHB 并读取大端 IDB/EPB", () => {
    const w = new ByteWriter();
    block(w, 0x0a0d0d0a, shbBody("be"), "be");
    // 大端 IDB。
    block(
      w,
      1,
      (bw) => {
        bw.u16be(1).u16be(0).u32be(65535);
        bw.u16be(0).u16be(0); // opt_endofopt
      },
      "be",
    );
    // 大端 EPB：时间戳 ticks = 1000。
    block(
      w,
      6,
      (bw) => {
        bw.u32be(0).u32be(0).u32be(1000).u32be(10).u32be(10);
        bw.raw(1, 2, 3, 4, 5, 6, 7, 8, 9, 10); // 10 字节数据
        bw.zero(2); // 对齐
      },
      "be",
    );
    const r = parsePcapng(w.toArrayBuffer());
    expect(r.interfaces).toHaveLength(1);
    expect(r.interfaces[0]!.linkType).toBe(1);
    expect(r.packets).toHaveLength(1);
    expect(r.packets[0]!.tsTicks).toBe(1000n);
    expect(r.packets[0]!.capturedLength).toBe(10);
  });
});

describe("parsePcapng 时间戳与分辨率", () => {
  it("默认分辨率 10^-6，EPB 时间戳为微秒 ticks", () => {
    const w = makePcapng();
    block(w, 6, epbBody(0, 0, 1_500_000, 8, 8, [1, 2, 3, 4, 5, 6, 7, 8]));
    const r = parsePcapng(w.toArrayBuffer());
    expect(r.interfaces[0]!.tsResol).toEqual({ base: 10, exponent: 6 });
    expect(r.packets[0]!.tsTicks).toBe(1_500_000n);
  });

  it("if_tsresol 二进制分辨率（2^-9）", () => {
    const w = new ByteWriter();
    block(w, 0x0a0d0d0a, shbBody("le"));
    block(w, 1, idbBody(1, 65535, { tsresol: 0x80 | 9 }));
    block(w, 6, epbBody(0, 0, 1024, 8, 8, [1, 2, 3, 4, 5, 6, 7, 8]));
    const r = parsePcapng(w.toArrayBuffer());
    expect(r.interfaces[0]!.tsResol).toEqual({ base: 2, exponent: 9 });
  });

  it("if_tsoffset 被读取为有符号 64 位", () => {
    const w = new ByteWriter();
    block(w, 0x0a0d0d0a, shbBody("le"));
    block(w, 1, idbBody(1, 65535, { tsoffset: -5n }));
    const r = parsePcapng(w.toArrayBuffer());
    expect(r.interfaces[0]!.tsOffsetSec).toBe(-5n);
  });
});

describe("parsePcapng 报文块", () => {
  it("SPB 无时间戳，不伪造", () => {
    const w = makePcapng();
    block(w, 3, spbBody(8, [1, 2, 3, 4, 5, 6, 7, 8]));
    const r = parsePcapng(w.toArrayBuffer());
    expect(r.packets).toHaveLength(1);
    expect(r.packets[0]!.tsTicks).toBeNull();
    expect(r.packets[0]!.capturedLength).toBe(8);
    expect(r.packets[0]!.interfaceId).toBe(r.interfaces[0]!.id);
  });

  it("EPB 支持多接口", () => {
    const w = new ByteWriter();
    block(w, 0x0a0d0d0a, shbBody("le"));
    block(w, 1, idbBody(1, 65535));
    block(w, 1, idbBody(1, 65535)); // 接口 1
    block(w, 6, epbBody(0, 0, 100, 4, 4, [1, 2, 3, 4]));
    block(w, 6, epbBody(1, 0, 200, 4, 4, [5, 6, 7, 8]));
    const r = parsePcapng(w.toArrayBuffer());
    expect(r.interfaces).toHaveLength(2);
    expect(r.packets[0]!.interfaceId).toBe(r.interfaces[0]!.id);
    expect(r.packets[1]!.interfaceId).toBe(r.interfaces[1]!.id);
  });

  it("多 Section 时重新建立接口编号映射", () => {
    const w = new ByteWriter();
    block(w, 0x0a0d0d0a, shbBody("le"));
    block(w, 1, idbBody(1, 65535));
    block(w, 6, epbBody(0, 0, 1, 4, 4, [1, 1, 1, 1]));
    // 新 section：接口 0 重新编号。
    block(w, 0x0a0d0d0a, shbBody("le"));
    block(w, 1, idbBody(1, 65535));
    block(w, 6, epbBody(0, 0, 2, 4, 4, [2, 2, 2, 2]));
    const r = parsePcapng(w.toArrayBuffer());
    expect(r.sections).toBe(2);
    expect(r.interfaces).toHaveLength(2);
    expect(r.interfaces[0]!.section).toBe(1);
    expect(r.interfaces[1]!.section).toBe(2);
    expect(r.packets[0]!.interfaceId).toBe(r.interfaces[0]!.id);
    expect(r.packets[1]!.interfaceId).toBe(r.interfaces[1]!.id);
  });

  it("未知块在长度合法时安全跳过", () => {
    const w = makePcapng();
    block(w, 0x0000000a, (bw) => bw.raw(1, 2, 3, 4)); // 未知块
    block(w, 6, epbBody(0, 0, 1, 4, 4, [1, 2, 3, 4]));
    const r = parsePcapng(w.toArrayBuffer());
    expect(r.packets).toHaveLength(1);
    expect(r.warnings.some((x) => x.message.includes("未知块"))).toBe(true);
  });

  it("废弃 Packet Block 明确告警，不静默跳过", () => {
    const w = makePcapng();
    block(w, 0x00000002, (bw) => bw.raw(0, 0, 0, 0)); // Packet Block
    const r = parsePcapng(w.toArrayBuffer());
    expect(r.warnings.some((x) => x.blockType === 0x00000002)).toBe(true);
  });

  it("非以太网 LinkType 给出提示", () => {
    const w = new ByteWriter();
    block(w, 0x0a0d0d0a, shbBody("le"));
    block(w, 1, idbBody(113, 65535)); // LINKTYPE_LINUX_SLL = 113
    const r = parsePcapng(w.toArrayBuffer());
    expect(r.warnings.some((x) => x.message.includes("LinkType"))).toBe(true);
  });
});

describe("parsePcapng 损坏与截断", () => {
  it("块长度非法时给出错误并停止", () => {
    const w = makePcapng();
    // 写一个长度非法的块（长度 13，非 4 的倍数）。
    w.u32le(0x00000006).u32le(13).zero(20);
    const r = parsePcapng(w.toArrayBuffer());
    expect(r.warnings.some((x) => x.severity === "error")).toBe(true);
  });

  it("块长度超出文件边界时给出错误", () => {
    const w = makePcapng();
    w.u32le(0x00000006).u32le(0x7ffffff0).zero(20); // 超出文件
    const r = parsePcapng(w.toArrayBuffer());
    expect(r.warnings.some((x) => x.severity === "error" && x.message.includes("截断"))).toBe(
      true,
    );
  });

  it("首尾块长度不一致时给出告警", () => {
    const w = new ByteWriter();
    block(w, 0x0a0d0d0a, shbBody("le"));
    // 手工写一个首尾长度不一致的 IDB。
    w.u32le(1).u32le(20);
    w.u16le(1).u16le(0).u32le(65535);
    w.u16le(0).u16le(0);
    w.u32le(24); // 尾部长度错误
    const r = parsePcapng(w.toArrayBuffer());
    expect(r.warnings.some((x) => x.message.includes("首尾长度不一致"))).toBe(true);
  });

  it("IDB 块体截断时不越界读取并给出错误", () => {
    const w = makePcapng();
    // header-only IDB（总长 12，无固定字段）。
    w.u32le(0x00000001).u32le(12).u32le(12);
    const r = parsePcapng(w.toArrayBuffer());
    expect(r.interfaces).toHaveLength(1); // 原有 IDB 仍保留
    expect(r.warnings.some((x) => x.severity === "error" && x.message.includes("IDB"))).toBe(
      true,
    );
  });

  it("EPB 块体截断时不越界读取并给出错误", () => {
    const w = makePcapng();
    // header-only EPB（总长 12，无固定字段）。
    w.u32le(0x00000006).u32le(12).u32le(12);
    const r = parsePcapng(w.toArrayBuffer());
    expect(r.packets).toHaveLength(0);
    expect(r.warnings.some((x) => x.severity === "error" && x.message.includes("EPB"))).toBe(
      true,
    );
  });
});
