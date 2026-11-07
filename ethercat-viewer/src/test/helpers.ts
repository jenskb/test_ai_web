// 测试辅助：手工构造字节序列（不依赖被测解析器的反向逻辑）。

export class ByteWriter {
  private bytes: number[] = [];

  u8(v: number): this {
    this.bytes.push(v & 0xff);
    return this;
  }

  raw(...vs: number[]): this {
    for (const v of vs) this.bytes.push(v & 0xff);
    return this;
  }

  u16le(v: number): this {
    this.bytes.push(v & 0xff, (v >> 8) & 0xff);
    return this;
  }

  u16be(v: number): this {
    this.bytes.push((v >> 8) & 0xff, v & 0xff);
    return this;
  }

  u32le(v: number): this {
    this.bytes.push(
      v & 0xff,
      (v >> 8) & 0xff,
      (v >> 16) & 0xff,
      (v >>> 24) & 0xff,
    );
    return this;
  }

  u32be(v: number): this {
    this.bytes.push(
      (v >>> 24) & 0xff,
      (v >> 16) & 0xff,
      (v >> 8) & 0xff,
      v & 0xff,
    );
    return this;
  }

  u64be(v: bigint): this {
    for (let i = 7; i >= 0; i--) {
      this.bytes.push(Number((v >> BigInt(i * 8)) & 0xffn));
    }
    return this;
  }

  u64le(v: bigint): this {
    for (let i = 0; i < 8; i++) {
      this.bytes.push(Number((v >> BigInt(i * 8)) & 0xffn));
    }
    return this;
  }

  /** 写入 n 个 0x00 填充字节。 */
  zero(n: number): this {
    for (let i = 0; i < n; i++) this.bytes.push(0);
    return this;
  }

  toUint8Array(): Uint8Array {
    return Uint8Array.from(this.bytes);
  }

  toArrayBuffer(): ArrayBuffer {
    return this.toUint8Array().buffer as ArrayBuffer;
  }

  get length(): number {
    return this.bytes.length;
  }
}

/** 组装一个块：类型 + 长度 + 内容 + 对齐填充 + 重复长度。 */
export function block(
  w: ByteWriter,
  blockType: number,
  body: (w: ByteWriter) => void,
  endian: "le" | "be" = "le",
): void {
  const bodyWriter = new ByteWriter();
  body(bodyWriter);
  const bodyLen = bodyWriter.length;
  // 块总长须为 4 的倍数：type(4) + len(4) + body + padding + len(4)。
  const padding = (4 - ((8 + bodyLen + 4) % 4)) % 4;
  const totalLen = 8 + bodyLen + padding + 4;
  if (endian === "le") {
    w.u32le(blockType);
    w.u32le(totalLen);
  } else {
    w.u32be(blockType);
    w.u32be(totalLen);
  }
  for (const b of bodyWriter.toUint8Array()) w.u8(b);
  w.zero(padding);
  if (endian === "le") {
    w.u32le(totalLen);
  } else {
    w.u32be(totalLen);
  }
}

/** 构造以太网 + EtherCAT 帧（无填充，小端 EtherCAT 字段）。 */
export function ethercatFrame(
  srcMac: number[],
  dstMac: number[],
  datagrams: DatagramSpec[],
  opts: { padTo?: number; vlan?: number[] } = {},
): Uint8Array {
  const w = new ByteWriter();
  // 目的 MAC（6）
  for (const b of dstMac) w.u8(b);
  // 源 MAC（6）
  for (const b of srcMac) w.u8(b);
  // VLAN 标签（可选，4 字节一个）。
  const vlans = opts.vlan ?? [];
  for (const tpid of vlans) {
    w.u16be(tpid);
    w.u16be(0x0000); // TCI
  }
  // EtherType = 0x88A4
  w.u16be(0x88a4);

  // EtherCAT 帧头：Length(11) | Reserved(1) | Type(4)
  let frameLength = 0;
  for (const d of datagrams) frameLength += 10 + d.data.length + 2;
  const header = (frameLength & 0x07ff) | (1 << 12);
  w.u16le(header);

  // 数据报。
  for (let i = 0; i < datagrams.length; i++) {
    const d = datagrams[i]!;
    // 未显式指定 more 时，默认「最后一个数据报 more=false，其余 more=true」。
    const more = d.more ?? i < datagrams.length - 1;
    w.u8(d.cmd);
    w.u8(d.idx ?? 0);
    // 地址（4 字节，小端）。逻辑地址 = 32 位；物理 = ADP(2)+ADO(2)。
    if (d.logical !== undefined) {
      w.u32le(d.logical);
    } else {
      w.u16le(d.adp ?? 0);
      w.u16le(d.ado ?? 0);
    }
    // Len：length(11) | reserved(3) | circulating(1,0x4000) | more(1,0x8000)
    let lenField = d.data.length & 0x07ff;
    lenField |= (d.reservedBits ?? 0) << 11;
    if (d.circulating) lenField |= 0x4000;
    if (more) lenField |= 0x8000;
    w.u16le(lenField);
    // IRQ
    w.u16le(d.irq ?? 0);
    // 数据
    for (const b of d.data) w.u8(b);
    // WKC
    w.u16le(d.wkc ?? 0);
  }

  // 以太网填充。
  if (opts.padTo) {
    while (w.length < opts.padTo) w.u8(0);
  }

  return w.toUint8Array();
}

export interface DatagramSpec {
  cmd: number;
  idx?: number;
  adp?: number;
  ado?: number;
  logical?: number;
  data: number[];
  wkc?: number;
  more?: boolean;
  circulating?: boolean;
  reservedBits?: number;
  irq?: number;
}
