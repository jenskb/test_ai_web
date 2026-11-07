// 时间换算：64 位原始时间戳用 BigInt 精确表示，结合接口时间分辨率与偏移换算。
// 二进制分辨率（2^-N）无法表示为整数纳秒，这里保留有理数/浮点换算，不静默截断。

import type { TimeResol } from '../types';

export const DEFAULT_TS_RESOL: TimeResol = { kind: 'decimal', exp: 6 }; // 10^-6 秒 = 1 微秒

// 解析 PCAPNG if_tsresol 选项字节：
//   MSB=0 → 十进制分辨率 10^-(value)
//   MSB=1 → 二进制分辨率 2^-(value & 0x7F)
export function parseTsResol(raw: number): TimeResol {
  const v = raw & 0x7f;
  if (raw & 0x80) {
    return { kind: 'binary', exp: v };
  }
  return { kind: 'decimal', exp: v };
}

// 分辨率的分母：decimal → 10^exp，binary → 2^exp。
export function resolDenominator(resol: TimeResol): bigint {
  return resol.kind === 'decimal' ? 10n ** BigInt(resol.exp) : 1n << BigInt(resol.exp);
}

// 原始时间戳 → 秒（精确有理数 num/den）。不经过 Number，避免 64 位精度丢失。
export function rawToSecondsRational(raw: bigint, resol: TimeResol): { num: bigint; den: bigint } {
  return { num: raw, den: resolDenominator(resol) };
}

// 有理数 num/den 秒 → 纳秒（精确），返回商与余数，不截断。
export function rationalToNanos(
  num: bigint,
  den: bigint,
): { quotient: bigint; remainder: bigint } {
  const scaled = num * 1_000_000_000n;
  return { quotient: scaled / den, remainder: scaled % den };
}

// 原始时间戳差（小量）→ 秒（浮点）。差值在 BigInt 中先相减，再转 Number，
// 保证帧间隔这类小数值不会因 64 位原始值过大而丢精度。
export function rawDeltaToSeconds(delta: bigint, resol: TimeResol): number {
  return Number(delta) / Number(resolDenominator(resol));
}

// 原始时间戳 → 秒（浮点），采用 BigInt 整除 + 余数换算，避免 64 位原始值直接转 Number 丢精度。
export function rawToSecondsDouble(raw: bigint, resol: TimeResol): number {
  const den = resolDenominator(resol);
  const whole = raw / den;
  const frac = raw % den;
  return Number(whole) + Number(frac) / Number(den);
}

// 原始时间戳（相对某参考时间戳）→ 秒（浮点）。
export function rawRelativeToSeconds(raw: bigint, refRaw: bigint, resol: TimeResol): number {
  return rawDeltaToSeconds(raw - refRaw, resol);
}

// 分辨率的人类可读描述，用于 UI 与文档。
export function describeResol(resol: TimeResol): string {
  if (resol.kind === 'decimal') {
    return resol.exp === 6 ? '10^-6 s（1 µs，默认）' : `10^-${resol.exp} s`;
  }
  return `2^-${resol.exp} s（二进制，非整数纳秒）`;
}

// 将秒格式化为 ns/µs/ms/s，去除多余尾零。
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return '—';
  if (seconds === 0) return '0 s';
  const abs = Math.abs(seconds);
  if (abs < 1e-6) return trimZeros((seconds * 1e9).toFixed(3)) + ' ns';
  if (abs < 1e-3) return trimZeros((seconds * 1e6).toFixed(3)) + ' µs';
  if (abs < 1) return trimZeros((seconds * 1e3).toFixed(4)) + ' ms';
  return trimZeros(seconds.toFixed(6)) + ' s';
}

function trimZeros(s: string): string {
  if (!s.includes('.')) return s;
  let out = s.replace(/0+$/, '');
  if (out.endsWith('.')) out = out.slice(0, -1);
  return out === '-0' ? '0' : out;
}

// 相对秒 → 绝对 UTC 时间（含 if_tsoffset）。用于详情页展示“绝对时间”。
// 精度受 double 限制，仅作展示，不作为统计基准。
export function relativeToUtcString(relativeSec: number, refAbsSec: number, tsOffset: bigint): string {
  const abs = relativeSec + refAbsSec + Number(tsOffset);
  return new Date(abs * 1000).toISOString();
}
