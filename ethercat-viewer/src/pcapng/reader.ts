// 字节序感知的读取器。所有多字节字段按捕获文件当前字节序读取。
// 时间戳等 64 位字段返回 BigInt，避免合并进 Number 后丢失精度。

const MIN_SAFE_INT64 = -(1n << 63n);
const MAX_SAFE_INT64 = (1n << 63n) - 1n;

export class DataReader {
  private view: DataView;
  private littleEndian: boolean;

  constructor(buffer: ArrayBuffer, littleEndian: boolean) {
    this.view = new DataView(buffer);
    this.littleEndian = littleEndian;
  }

  get byteLength(): number {
    return this.view.byteLength;
  }

  setEndian(littleEndian: boolean): void {
    this.littleEndian = littleEndian;
  }

  u8(offset: number): number {
    return this.view.getUint8(offset);
  }

  u16(offset: number): number {
    return this.view.getUint16(offset, this.littleEndian);
  }

  u32(offset: number): number {
    return this.view.getUint32(offset, this.littleEndian);
  }

  /** 有符号 32 位。 */
  i32(offset: number): number {
    return this.view.getInt32(offset, this.littleEndian);
  }

  /** 无符号 64 位，返回 BigInt。 */
  u64(offset: number): bigint {
    return this.view.getBigUint64(offset, this.littleEndian);
  }

  /** 有符号 64 位，返回 BigInt。 */
  i64(offset: number): bigint {
    return this.view.getBigInt64(offset, this.littleEndian);
  }

  /** 读取一段原始字节（返回副本）。 */
  bytes(offset: number, length: number): Uint8Array {
    return new Uint8Array(this.view.buffer.slice(offset, offset + length));
  }
}

/** 将无符号 64 位解释为有符号 64 位（用于 if_tsoffset 等字段）。 */
export function asSigned64(unsigned: bigint): bigint {
  if (unsigned > MAX_SAFE_INT64) {
    return unsigned - (1n << 64n);
  }
  return unsigned;
}

export { MIN_SAFE_INT64, MAX_SAFE_INT64 };
