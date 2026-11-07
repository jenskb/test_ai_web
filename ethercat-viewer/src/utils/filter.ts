// 报文筛选：按命令、WKC、接口、帧序号范围、异常筛选。
// 筛选只影响展示与导出，不改变时间间隔的计算基准（间隔在完整数据上计算）。

import type { EtherCATFrame, ParseResult } from "../types";

export interface Filters {
  command: number | null;
  wkcZero: boolean;
  interfaceId: number | null;
  frameRangeMin: string;
  frameRangeMax: string;
  anomalyOnly: boolean;
}

export function applyFilters(
  result: ParseResult,
  filters: Filters,
): EtherCATFrame[] {
  const min =
    filters.frameRangeMin.trim() === "" ? null : Number(filters.frameRangeMin);
  const max =
    filters.frameRangeMax.trim() === "" ? null : Number(filters.frameRangeMax);

  return result.ethercatFrames.filter((f) => {
    const pkt = result.packets[f.packetIndex];
    if (!pkt) return false;
    if (filters.interfaceId !== null && pkt.interfaceId !== filters.interfaceId) {
      return false;
    }
    if (min !== null && !Number.isNaN(min) && f.packetIndex + 1 < min) return false;
    if (max !== null && !Number.isNaN(max) && f.packetIndex + 1 > max) return false;
    if (filters.command !== null && !f.datagrams.some((d) => d.cmd === filters.command)) {
      return false;
    }
    if (filters.wkcZero && !f.datagrams.some((d) => d.wkc === 0)) return false;
    if (filters.anomalyOnly && !frameHasAnomaly(f)) return false;
    return true;
  });
}

export function frameHasAnomaly(f: EtherCATFrame): boolean {
  if (f.anomalies.length > 0) return true;
  if (f.datagrams.some((d) => d.anomalies.length > 0)) return true;
  if (f.timeAnomaly !== null) return true;
  return false;
}
