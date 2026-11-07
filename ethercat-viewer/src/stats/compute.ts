// 统计计算：命令分布、帧间隔统计、时间戳异常标记、降采样。
// 统计基于完整有效数据；降采样只影响曲线展示，不影响统计值。
// 帧间隔使用 enrichTime 已计算的 prevIntervalSeconds（捕获顺序，BigInt 差值），
// 因此时间戳倒退/相同能被正确标记。

import type { EtherCATFrame, PacketRecord, Warning } from "../types";
import { commandName } from "../ethercat/commands";

export interface CommandStat {
  cmd: number;
  cmdName: string;
  count: number;
}

export interface SeriesPoint {
  /** 帧序号（1 起）。 */
  x: number;
  /** 间隔（秒，可能为负/零）。 */
  y: number;
}

export interface InterfaceIntervalStat {
  interfaceId: number;
  /** 参与统计的有效间隔数（间隔 > 0）。 */
  sampleCount: number;
  /** 参与统计的（带时间戳）EtherCAT 帧数。 */
  frameCount: number;
  min: number;
  max: number;
  mean: number;
  stddev: number;
  /** 时间戳倒退次数（间隔 < 0）。 */
  backwardCount: number;
  /** 相同时间戳次数（间隔 = 0）。 */
  zeroCount: number;
  /** 降采样后的间隔曲线（含倒退/相同）。 */
  series: SeriesPoint[];
}

export interface StatsResult {
  totalPackets: number;
  ethercatFrames: number;
  datagrams: number;
  /** 具有时间戳的 EtherCAT 帧覆盖的相对时间范围（秒，相对基准）。 */
  timeRange: { start: number; end: number } | null;
  commandDistribution: CommandStat[];
  intervalStats: InterfaceIntervalStat[];
  anomalyCount: number;
  warningCount: number;
  errorCount: number;
}

/** 曲线降采样阈值。 */
const MAX_SERIES_POINTS = 2000;

interface Acc {
  frameCount: number;
  intervals: number[];
  backwardCount: number;
  zeroCount: number;
  series: SeriesPoint[];
}

export function computeStats(
  packets: PacketRecord[],
  frames: EtherCATFrame[],
  warnings: Warning[],
): StatsResult {
  const commandMap = new Map<number, number>();
  let datagrams = 0;
  let anomalyCount = 0;

  let minRel = Infinity;
  let maxRel = -Infinity;
  let hasTimestamp = false;

  const byInterface = new Map<number, Acc>();

  for (const frame of frames) {
    anomalyCount += frame.anomalies.length;
    const pkt = packets[frame.packetIndex];
    if (!pkt) continue;

    for (const dg of frame.datagrams) {
      anomalyCount += dg.anomalies.length;
      commandMap.set(dg.cmd, (commandMap.get(dg.cmd) ?? 0) + 1);
      datagrams += 1;
    }

    if (pkt.tsTicks !== null) {
      let acc = byInterface.get(pkt.interfaceId);
      if (!acc) {
        acc = {
          frameCount: 0,
          intervals: [],
          backwardCount: 0,
          zeroCount: 0,
          series: [],
        };
        byInterface.set(pkt.interfaceId, acc);
      }
      acc.frameCount += 1;
      if (frame.relSeconds !== null) {
        if (frame.relSeconds < minRel) minRel = frame.relSeconds;
        if (frame.relSeconds > maxRel) maxRel = frame.relSeconds;
        hasTimestamp = true;
      }
    }

    // 帧间隔统计（仅同接口、带时间戳、有前一帧的）。
    if (frame.prevIntervalSeconds !== null) {
      const acc = byInterface.get(pkt.interfaceId)!;
      const sec = frame.prevIntervalSeconds;
      acc.series.push({ x: pkt.frameIndex, y: sec });
      if (sec < 0) acc.backwardCount += 1;
      else if (sec === 0) acc.zeroCount += 1;
      else acc.intervals.push(sec);
    }
  }

  // 命令分布（按命令码排序）。
  const commandDistribution: CommandStat[] = Array.from(commandMap.entries())
    .map(([cmd, count]) => ({ cmd, cmdName: commandName(cmd), count }))
    .sort((a, b) => a.cmd - b.cmd);

  // 帧间隔统计（按接口）。
  const intervalStats: InterfaceIntervalStat[] = Array.from(byInterface.entries()).map(
    ([interfaceId, acc]) => {
      const n = acc.intervals.length;
      let min = Infinity;
      let max = -Infinity;
      let sum = 0;
      for (const v of acc.intervals) {
        if (v < min) min = v;
        if (v > max) max = v;
        sum += v;
      }
      const mean = n > 0 ? sum / n : 0;
      let variance = 0;
      for (const v of acc.intervals) variance += (v - mean) * (v - mean);
      const stddev = n > 0 ? Math.sqrt(variance / n) : 0;

      return {
        interfaceId,
        sampleCount: n,
        frameCount: acc.frameCount,
        min: n > 0 ? min : 0,
        max: n > 0 ? max : 0,
        mean,
        stddev,
        backwardCount: acc.backwardCount,
        zeroCount: acc.zeroCount,
        series: downsample(acc.series, MAX_SERIES_POINTS),
      };
    },
  );

  const warningCount = warnings.filter((w) => w.severity === "warning").length;
  const errorCount = warnings.filter((w) => w.severity === "error").length;

  return {
    totalPackets: packets.length,
    ethercatFrames: frames.length,
    datagrams,
    timeRange: hasTimestamp ? { start: minRel, end: maxRel } : null,
    commandDistribution,
    intervalStats,
    anomalyCount,
    warningCount,
    errorCount,
  };
}

/** 均匀降采样，保留首尾点与整体形状。 */
function downsample(points: SeriesPoint[], maxPoints: number): SeriesPoint[] {
  if (points.length <= maxPoints) return points;
  const step = (points.length - 1) / (maxPoints - 1);
  const out: SeriesPoint[] = [];
  for (let i = 0; i < maxPoints; i++) {
    const idx = Math.round(i * step);
    out.push(points[idx]!);
  }
  return out;
}
