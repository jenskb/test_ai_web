// 格式化与时间换算工具。

import type { TsResol } from "../types";

/** 将 MAC 字节序列格式化为 "xx:xx:xx:xx:xx:xx"。 */
export function formatMac(bytes: Uint8Array, base: number): string {
  return Array.from(bytes.slice(base, base + 6))
    .map((v) => v.toString(16).padStart(2, "0"))
    .join(":");
}

/** 单字节十六进制字符串。 */
export function hexByte(v: number): string {
  return v.toString(16).padStart(2, "0");
}

/** 多字节十六进制字符串（空格分隔）。 */
export function hexBytes(bytes: Uint8Array, base: number, length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    if (i > 0) out += " ";
    out += hexByte(bytes[base + i] ?? 0);
  }
  return out;
}

/**
 * 将原始 64 位时间戳单位换算为相对秒（Number，用于展示/绘图）。
 * 精度受 Number 限制，仅用于显示，不代表抓包实际精度。
 */
export function ticksToSeconds(ticks: bigint, resol: TsResol): number {
  const exponent = Math.min(resol.exponent, 32); // 防止极端指数
  const divisor = BigInt(resol.base) ** BigInt(exponent);
  const neg = ticks < 0n;
  const abs = neg ? -ticks : ticks;
  const whole = abs / divisor;
  const frac = abs % divisor;
  let value = Number(whole) + Number(frac) / Number(divisor);
  return neg ? -value : value;
}

/**
 * 绝对时间（秒）= ticks * resolution + tsoffset（秒）。
 * 返回 Number，用于跨接口时间范围等展示场景。
 */
export function absoluteSeconds(
  ticks: bigint,
  resol: TsResol,
  tsoffsetSec: bigint,
): number {
  return ticksToSeconds(ticks, resol) + Number(tsoffsetSec);
}

/** 将时间间隔（秒）格式化为易读文本。 */
export function formatInterval(seconds: number): string {
  if (!Number.isFinite(seconds)) return "—";
  const abs = Math.abs(seconds);
  if (abs < 1e-6) return `${(seconds * 1e9).toFixed(0)} ns`;
  if (abs < 1e-3) return `${(seconds * 1e6).toFixed(1)} µs`;
  if (abs < 1) return `${(seconds * 1e3).toFixed(3)} ms`;
  return `${seconds.toFixed(6)} s`;
}

/** 将相对秒格式化为带精度的展示文本。 */
export function formatRelative(seconds: number): string {
  if (!Number.isFinite(seconds)) return "—";
  if (Math.abs(seconds) < 1e-6) return `${(seconds * 1e9).toFixed(0)} ns`;
  if (Math.abs(seconds) < 1e-3) return `${(seconds * 1e6).toFixed(2)} µs`;
  if (Math.abs(seconds) < 1) return `${(seconds * 1e3).toFixed(3)} ms`;
  return `${seconds.toFixed(6)} s`;
}

/** 文件大小格式化。 */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n;
  let i = -1;
  do {
    v /= 1024;
    i += 1;
  } while (v >= 1024 && i < units.length - 1);
  return `${v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2)} ${units[i]}`;
}
