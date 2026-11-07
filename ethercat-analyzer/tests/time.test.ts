import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TS_RESOL,
  formatDuration,
  parseTsResol,
  rawDeltaToSeconds,
  rawToSecondsDouble,
} from '../src/lib/time';

describe('时间换算', () => {
  it('解析十进制分辨率（MSB=0）', () => {
    expect(parseTsResol(6)).toEqual({ kind: 'decimal', exp: 6 });
    expect(parseTsResol(9)).toEqual({ kind: 'decimal', exp: 9 });
  });

  it('解析二进制分辨率（MSB=1）', () => {
    expect(parseTsResol(0x80 | 10)).toEqual({ kind: 'binary', exp: 10 });
    expect(parseTsResol(0x80 | 0)).toEqual({ kind: 'binary', exp: 0 });
  });

  it('默认分辨率为 10^-6（微秒）', () => {
    expect(DEFAULT_TS_RESOL).toEqual({ kind: 'decimal', exp: 6 });
  });

  it('原始时间戳 → 秒（浮点）保持大数精度', () => {
    // 1.6e18 纳秒量级原始值，直接 Number(raw) 会丢精度；rawToSecondsDouble 不应截断。
    const raw = 1600000000000000001n; // 1.6e18 + 1
    const sec = rawToSecondsDouble(raw, { kind: 'decimal', exp: 9 });
    expect(sec).toBeCloseTo(1600000000.000000001, 6);
  });

  it('二进制分辨率换算为秒（浮点，非整数纳秒）', () => {
    // 2^-10 分辨率：raw=1024 → 1 秒
    expect(rawDeltaToSeconds(1024n, { kind: 'binary', exp: 10 })).toBeCloseTo(1, 12);
    // raw=1 → 2^-10 秒 = 976562.5 纳秒，不应截断为整数纳秒
    expect(rawDeltaToSeconds(1n, { kind: 'binary', exp: 10 }) * 1e9).toBeCloseTo(976562.5, 4);
  });

  it('帧间隔（差值）换算', () => {
    expect(rawDeltaToSeconds(1000n, { kind: 'decimal', exp: 9 })).toBeCloseTo(1e-6, 12);
    expect(rawDeltaToSeconds(1000000n, { kind: 'decimal', exp: 6 })).toBeCloseTo(1, 12);
  });

  it('formatDuration 选择合适的单位', () => {
    expect(formatDuration(0)).toBe('0 s');
    expect(formatDuration(1)).toBe('1 s');
    expect(formatDuration(0.001)).toContain('ms');
    expect(formatDuration(1e-6)).toContain('µs');
    expect(formatDuration(1e-9)).toContain('ns');
    expect(formatDuration(-1)).toContain('-');
  });
});
