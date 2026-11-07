// 时间信息补充：相对时间、同接口帧间隔、时间戳倒退/相同标记。
// 无时间戳（SPB）的帧不参与时间统计。
// 相对时间优先用 BigInt 差值计算，避免把 64 位时间戳合并进 Number 丢精度。

import type { EtherCATFrame, InterfaceInfo, PacketRecord, TsResol } from "../types";
import { ticksToSeconds, absoluteSeconds } from "../utils/format";

export function enrichTime(
  packets: PacketRecord[],
  interfaces: InterfaceInfo[],
  frames: EtherCATFrame[],
): void {
  const ifaceById = new Map<number, InterfaceInfo>();
  for (const info of interfaces) ifaceById.set(info.id, info);

  // 全文件最早带时间戳的报文（任意链路类型）作为相对时间基准。
  let ref: { ticks: bigint; resol: TsResol; tsoffset: bigint; abs: number } | null = null;
  for (const pkt of packets) {
    if (pkt.tsTicks === null) continue;
    const info = ifaceById.get(pkt.interfaceId);
    if (!info) continue;
    const abs = absoluteSeconds(pkt.tsTicks, info.tsResol, info.tsOffsetSec);
    if (ref === null || abs < ref.abs) {
      ref = { ticks: pkt.tsTicks, resol: info.tsResol, tsoffset: info.tsOffsetSec, abs };
    }
  }

  // 按接口记录上一条带时间戳 EtherCAT 帧。
  const lastTicks = new Map<number, bigint>();

  for (const frame of frames) {
    const pkt = packets[frame.packetIndex];
    if (!pkt || pkt.tsTicks === null) {
      frame.relSeconds = null;
      frame.prevIntervalSeconds = null;
      frame.timeAnomaly = null;
      continue;
    }
    const info = ifaceById.get(pkt.interfaceId);
    if (!info) {
      frame.relSeconds = null;
      frame.prevIntervalSeconds = null;
      frame.timeAnomaly = null;
      continue;
    }

    // 相对时间：与基准同分辨率/时移时用 BigInt 差值精确计算。
    if (
      ref &&
      ref.resol.base === info.tsResol.base &&
      ref.resol.exponent === info.tsResol.exponent &&
      ref.tsoffset === info.tsOffsetSec
    ) {
      frame.relSeconds = ticksToSeconds(pkt.tsTicks - ref.ticks, info.tsResol);
    } else {
      const abs = absoluteSeconds(pkt.tsTicks, info.tsResol, info.tsOffsetSec);
      frame.relSeconds = ref === null ? null : abs - ref.abs;
    }

    const prev = lastTicks.get(pkt.interfaceId);
    if (prev === undefined) {
      frame.prevIntervalSeconds = null;
      frame.timeAnomaly = null;
    } else {
      const dt = pkt.tsTicks - prev;
      const sec = ticksToSeconds(dt, info.tsResol);
      frame.prevIntervalSeconds = sec;
      frame.timeAnomaly = sec < 0 ? "backward" : sec === 0 ? "same" : null;
    }
    lastTicks.set(pkt.interfaceId, pkt.tsTicks);
  }
}
