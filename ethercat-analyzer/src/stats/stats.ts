// 统计：相对时间、帧间隔（同接口有效时间戳）、命令分布、时间范围、区间统计。
// 帧间隔基于完整序列计算，筛选仅影响展示，不改变计算基准。

import type {
  CaptureStats,
  CommandCount,
  FrameIndex,
  IntervalStats,
  TimeResol,
} from '../types';
import { rawDeltaToSeconds, rawToSecondsDouble } from '../lib/time';

// 计算每帧的相对时间（全局零点 = 最早的时间戳）与 EtherCAT 帧间隔，并返回统计。
export function finalizeFrames(
  frames: FrameIndex[],
  interfaceNames: Map<number, string>,
): { stats: CaptureStats; intervalStats: IntervalStats[] } {
  // 1) 相对时间：每个接口取首个时间戳作为局部基准，再对齐到全局最早时间。
  const firstPerIface = new Map<number, { raw: bigint; resol: TimeResol; absSec: number }>();
  for (const f of frames) {
    if (f.timestampRaw === null) continue;
    if (!firstPerIface.has(f.interfaceId)) {
      firstPerIface.set(f.interfaceId, {
        raw: f.timestampRaw,
        resol: f.tsResol,
        absSec: rawToSecondsDouble(f.timestampRaw, f.tsResol),
      });
    }
  }

  let globalZeroSec = Number.POSITIVE_INFINITY;
  for (const v of firstPerIface.values()) {
    if (v.absSec < globalZeroSec) globalZeroSec = v.absSec;
  }
  if (!Number.isFinite(globalZeroSec)) globalZeroSec = 0;

  for (const f of frames) {
    if (f.timestampRaw === null) continue;
    const base = firstPerIface.get(f.interfaceId);
    if (!base) continue;
    const offset = base.absSec - globalZeroSec;
    f.relativeSec = offset + rawDeltaToSeconds(f.timestampRaw - base.raw, f.tsResol);
  }

  // 2) EtherCAT 帧间隔：同接口、有效时间戳的相邻 EtherCAT 帧。
  const lastPerIface = new Map<number, { raw: bigint; resol: TimeResol }>();
  const intervalAcc = new Map<
    number,
    { values: number[]; regressions: number; equal: number; first: number; last: number }
  >();

  for (const f of frames) {
    if (f.ecat === null || f.timestampRaw === null) continue;
    const prev = lastPerIface.get(f.interfaceId);
    if (prev) {
      const delta = f.timestampRaw - prev.raw;
      const sec = rawDeltaToSeconds(delta, f.tsResol);
      f.intervalSec = sec;
      let acc = intervalAcc.get(f.interfaceId);
      if (!acc) {
        acc = { values: [], regressions: 0, equal: 0, first: 0, last: 0 };
        intervalAcc.set(f.interfaceId, acc);
      }
      acc.values.push(sec);
      acc.last = f.relativeSec ?? 0;
      if (delta < 0n) acc.regressions++;
      if (delta === 0n) acc.equal++;
    } else {
      let acc = intervalAcc.get(f.interfaceId);
      if (!acc) {
        acc = { values: [], regressions: 0, equal: 0, first: 0, last: 0 };
        intervalAcc.set(f.interfaceId, acc);
      }
      acc.first = f.relativeSec ?? 0;
      acc.last = f.relativeSec ?? 0;
    }
    lastPerIface.set(f.interfaceId, { raw: f.timestampRaw, resol: f.tsResol });
  }

  // 3) 区间统计（按接口）。
  const intervalStats: IntervalStats[] = [];
  for (const [ifaceId, acc] of intervalAcc) {
    const n = acc.values.length;
    let minSec: number | null = null;
    let maxSec: number | null = null;
    let meanSec: number | null = null;
    let stddevSec: number | null = null;
    let totalSec: number | null = null;

    if (n > 0) {
      let sum = 0;
      minSec = Infinity;
      maxSec = -Infinity;
      for (const v of acc.values) {
        sum += v;
        if (v < minSec) minSec = v;
        if (v > maxSec) maxSec = v;
      }
      meanSec = sum / n;
      let sq = 0;
      for (const v of acc.values) {
        const d = v - meanSec;
        sq += d * d;
      }
      stddevSec = Math.sqrt(sq / n);
      totalSec = acc.last - acc.first;
    }

    intervalStats.push({
      interfaceId: ifaceId,
      name: interfaceNames.get(ifaceId) ?? `接口 ${ifaceId}`,
      count: n,
      minSec,
      maxSec,
      meanSec,
      stddevSec,
      regressions: acc.regressions,
      equalTimestamps: acc.equal,
      totalSec,
    });
  }
  intervalStats.sort((a, b) => a.interfaceId - b.interfaceId);

  const stats = computeStats(frames);
  return { stats, intervalStats };
}

function computeStats(frames: FrameIndex[]): CaptureStats {
  let ethercatFrames = 0;
  let totalDatagrams = 0;
  let hasTimestampFrames = 0;
  let anomalyCount = 0;
  let rangeStart: number | null = null;
  let rangeEnd: number | null = null;
  const cmdCount = new Map<number, CommandCount>();

  for (const f of frames) {
    if (f.anomalies.length > 0) anomalyCount++;
    if (f.ecat === null) continue;
    ethercatFrames++;
    totalDatagrams += f.ecat.datagrams.length;
    if (f.timestampRaw !== null && f.relativeSec !== null) {
      hasTimestampFrames++;
      if (rangeStart === null || f.relativeSec < rangeStart) rangeStart = f.relativeSec;
      if (rangeEnd === null || f.relativeSec > rangeEnd) rangeEnd = f.relativeSec;
    }
    for (const d of f.ecat.datagrams) {
      let c = cmdCount.get(d.cmdRaw);
      if (!c) {
        c = { cmdRaw: d.cmdRaw, cmdName: d.cmdName, count: 0 };
        cmdCount.set(d.cmdRaw, c);
      }
      c.count++;
    }
  }

  const commandDistribution = Array.from(cmdCount.values()).sort(
    (a, b) => b.count - a.count || a.cmdRaw - b.cmdRaw,
  );

  return {
    totalFrames: frames.length,
    ethercatFrames,
    totalDatagrams,
    hasTimestampFrames,
    timeRangeStartSec: rangeStart,
    timeRangeEndSec: rangeEnd,
    commandDistribution,
    anomalyCount,
  };
}
