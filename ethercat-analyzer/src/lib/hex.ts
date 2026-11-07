// 十六进制与 ASCII 视图的辅助函数。

export function toHexByte(b: number): string {
  return b.toString(16).padStart(2, '0');
}

export function toHexString(bytes: Uint8Array, offset = 0, length = bytes.length - offset): string {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += toHexByte(bytes[offset + i] as number);
  }
  return out;
}

export function toAsciiChar(b: number): string {
  return b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : '.';
}

export interface HexLine {
  offset: number; // 该行首字节在帧内的偏移
  hex: string[]; // 每字节两位 HEX
  ascii: string;
}

// 将字节按每行 16 字节切分为 HEX/ASCII 行。
export function toHexLines(bytes: Uint8Array, baseOffset = 0, bytesPerLine = 16): HexLine[] {
  const lines: HexLine[] = [];
  for (let i = 0; i < bytes.length; i += bytesPerLine) {
    const end = Math.min(i + bytesPerLine, bytes.length);
    const hex: string[] = [];
    let ascii = '';
    for (let j = i; j < end; j++) {
      const b = bytes[j] as number;
      hex.push(toHexByte(b));
      ascii += toAsciiChar(b);
    }
    lines.push({ offset: baseOffset + i, hex, ascii });
  }
  return lines;
}
