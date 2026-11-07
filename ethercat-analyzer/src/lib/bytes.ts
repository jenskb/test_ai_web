// 字节读取辅助：显式指定大小端，避免 DataView 的样板代码。

export function u8(buf: Uint8Array, off: number): number {
  return buf[off] as number;
}

export function u16le(buf: Uint8Array, off: number): number {
  return ((buf[off] as number) | ((buf[off + 1] as number) << 8)) >>> 0;
}

export function u16be(buf: Uint8Array, off: number): number {
  return (((buf[off] as number) << 8) | (buf[off + 1] as number)) >>> 0;
}

export function u32le(buf: Uint8Array, off: number): number {
  return (
    ((buf[off] as number) |
      ((buf[off + 1] as number) << 8) |
      ((buf[off + 2] as number) << 16) |
      ((buf[off + 3] as number) << 24)) >>>
    0
  );
}

export function u32be(buf: Uint8Array, off: number): number {
  return (
    (((buf[off] as number) << 24) |
      ((buf[off + 1] as number) << 16) |
      ((buf[off + 2] as number) << 8) |
      (buf[off + 3] as number)) >>>
    0
  );
}

export function u16(buf: Uint8Array, off: number, littleEndian: boolean): number {
  return littleEndian ? u16le(buf, off) : u16be(buf, off);
}

export function u32(buf: Uint8Array, off: number, littleEndian: boolean): number {
  return littleEndian ? u32le(buf, off) : u32be(buf, off);
}

export function u64le(buf: Uint8Array, off: number): bigint {
  const lo = u32le(buf, off);
  const hi = u32le(buf, off + 4);
  return (BigInt(hi) << 32n) | BigInt(lo);
}

export function u64be(buf: Uint8Array, off: number): bigint {
  const hi = u32be(buf, off);
  const lo = u32be(buf, off + 4);
  return (BigInt(hi) << 32n) | BigInt(lo);
}

export function u64(buf: Uint8Array, off: number, littleEndian: boolean): bigint {
  return littleEndian ? u64le(buf, off) : u64be(buf, off);
}

// 有符号 64 位（用于 if_tsoffset）。
export function i64(buf: Uint8Array, off: number, littleEndian: boolean): bigint {
  const u = u64(buf, off, littleEndian);
  return u >= 1n << 63n ? u - (1n << 64n) : u;
}
