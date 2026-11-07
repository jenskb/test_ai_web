// 通用格式化辅助。

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(2)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function formatCount(n: number): string {
  return n.toLocaleString('zh-CN');
}

export function hex32(n: number): string {
  return '0x' + (n >>> 0).toString(16).padStart(8, '0');
}

export function hex16(n: number): string {
  return '0x' + (n & 0xffff).toString(16).padStart(4, '0');
}

export function hex8(n: number): string {
  return '0x' + (n & 0xff).toString(16).padStart(2, '0');
}

export function formatMac(bytes: Uint8Array): string {
  const parts: string[] = [];
  for (let i = 0; i < 6; i++) {
    parts.push((bytes[i] as number).toString(16).padStart(2, '0'));
  }
  return parts.join(':');
}

export function formatTimestampRaw(raw: bigint): string {
  return raw.toString();
}
