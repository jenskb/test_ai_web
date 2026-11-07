// EtherCAT 帧与数据报解析。
//
// 参考：Wireshark EtherCAT dissector（Beckhoff Automation GmbH）：
//   - plugins/epan/ethercat/packet-ethercat-frame.c  （帧头）
//   - plugins/epan/ethercat/packet-ethercat-datagram.c（数据报）
// 以及 EtherCAT 规范 ETG.1000.4。
//
// 帧头（2 字节，小端）：Length(11) | Reserved(1) | Type(4)，Type=1 为数据报。
// 数据报头（10 字节，小端）：Cmd(1) | Idx(1) | ADP(2) | ADO(2) | Len(2) | IRQ(2)。
// Len(2)：Length(11) | Reserved(3) | Circulating(1,0x4000) | More(1,0x8000)。
// 数据报 = 头(10) + 数据(Length) + WKC(2)。

import type { Anomaly, Datagram, EtherCATFrame } from "../types";
import { isLogicalCommand, commandName, frameTypeName } from "./commands";

const FRAME_HEADER_LEN = 2;
const DATAGRAM_HEADER_LEN = 10;
const WKC_LEN = 2;

/**
 * 解析一条 EtherCAT 帧（含帧头与数据报）。
 *
 * @param bytes  报文数据视图（通常是整个文件 buffer 的 Uint8Array）。
 * @param base   报文数据在视图内的文件偏移。
 * @param length 报文数据总长度。
 * @param packetIndex 对应 packets 数组中的序号。
 * @param ethernet 以太网解析结果（其 payloadOffset 为文件内偏移）。
 *
 * 输出中所有 `*OffsetInPacket` 均为报文内相对偏移（0 起）。
 */
export function parseEtherCAT(
  bytes: Uint8Array,
  base: number,
  length: number,
  packetIndex: number,
  ethernet: {
    dstMac: string;
    srcMac: string;
    vlanTags: import("../types").VlanTag[];
    etherType: number;
    payloadOffset: number;
  },
): EtherCATFrame {
  const anomalies: Anomaly[] = [];
  const packetEnd = base + length;
  const headerFileOffset = ethernet.payloadOffset;
  const headerOffset = headerFileOffset - base;

  const frame: EtherCATFrame = {
    packetIndex,
    ethOffsetInPacket: 0,
    dstMac: ethernet.dstMac,
    srcMac: ethernet.srcMac,
    vlanTags: ethernet.vlanTags,
    etherType: ethernet.etherType,
    ecatHeaderOffsetInPacket: headerOffset,
    frameLength: 0,
    frameReserved: 0,
    frameType: 0,
    isDatagram: false,
    datagrams: [],
    paddingLength: 0,
    anomalies,
    relSeconds: null,
    prevIntervalSeconds: null,
    timeAnomaly: null,
  };

  // 帧头需要 2 字节。
  if (headerFileOffset + FRAME_HEADER_LEN > packetEnd) {
    anomalies.push({ kind: "truncated", message: "EtherCAT 帧头被截断（不足 2 字节）。" });
    return frame;
  }

  const hdr = u16le(bytes, headerFileOffset);
  frame.frameLength = hdr & 0x07ff;
  frame.frameReserved = (hdr >> 11) & 0x1;
  frame.frameType = (hdr >> 12) & 0xf;

  if (frame.frameReserved !== 0) {
    anomalies.push({
      kind: "truncated",
      message: "EtherCAT 帧头保留位非零（应为 0）。",
    });
  }

  if (frame.frameType !== 1) {
    // 非数据报类型：ADS / RAW-IO / NV / Mailbox，不强行套用数据报格式。
    frame.isDatagram = false;
    anomalies.push({
      kind: "frame-type-not-datagram",
      message: `EtherCAT 帧类型为 ${frameTypeName(frame.frameType)}，不按数据报解析。`,
    });
    return frame;
  }

  frame.isDatagram = true;

  // 数据报区域：[headerFileOffset+2, headerFileOffset+2+frameLength)，但不超过报文边界。
  const regionStart = headerFileOffset + FRAME_HEADER_LEN;
  const regionEnd = Math.min(regionStart + frame.frameLength, packetEnd);

  let pos = regionStart; // 文件内偏移，用于读取 bytes。
  let datagramIndex = 0;
  let lastMore = true;
  let parsedAny = false;

  while (pos + DATAGRAM_HEADER_LEN + WKC_LEN <= regionEnd) {
    const cmd = bytes[pos]!;
    const idx = bytes[pos + 1]!;
    const adp = u16le(bytes, pos + 2);
    const ado = u16le(bytes, pos + 4);
    const lenField = u16le(bytes, pos + 6);
    const irq = u16le(bytes, pos + 8);

    const dlen = lenField & 0x07ff;
    const reservedBits = (lenField >> 11) & 0x7;
    const circulating = (lenField & 0x4000) !== 0;
    const more = (lenField & 0x8000) !== 0;

    const rawAddr = adp | (ado << 16);
    const logical = isLogicalCommand(cmd);

    const datagram: Datagram = {
      indexInFrame: datagramIndex + 1,
      offsetInPacket: pos - base,
      cmd,
      cmdName: commandName(cmd),
      idx,
      rawAddr,
      length: dlen,
      reservedBits,
      circulating,
      more,
      irq,
      dataOffsetInPacket: pos + DATAGRAM_HEADER_LEN - base,
      wkcOffsetInPacket: pos + DATAGRAM_HEADER_LEN + dlen - base,
      wkc: 0,
      anomalies: [],
    };

    if (logical) {
      datagram.logicalAddr = rawAddr;
    } else {
      datagram.adp = adp;
      datagram.ado = ado;
    }

    const totalSize = DATAGRAM_HEADER_LEN + dlen + WKC_LEN;

    // 越界校验：数据报须完整落在报文内。
    if (pos + totalSize > packetEnd) {
      datagram.anomalies.push({
        kind: "length-out-of-bounds",
        message: `数据报声明长度 ${dlen} 字节，但超出报文边界 ${packetEnd - pos - DATAGRAM_HEADER_LEN} 字节可用。`,
      });
      datagram.wkc = 0; // WKC 已超出报文边界，不可用。
      frame.datagrams.push(datagram);
      anomalies.push({
        kind: "length-out-of-bounds",
        message: `数据报 #${datagram.indexInFrame} 长度越界。`,
      });
      pos += totalSize;
      lastMore = more;
      parsedAny = true;
      break;
    }

    datagram.wkc = u16le(bytes, pos + DATAGRAM_HEADER_LEN + dlen);

    if (datagram.wkc === 0) {
      datagram.anomalies.push({
        kind: "wkc-zero",
        message: "WKC 为 0（需检查，不代表必然故障）。",
      });
    }

    if (datagram.cmdName === "UNKNOWN") {
      datagram.anomalies.push({
        kind: "unknown-command",
        message: `未知命令码 ${cmd}，已保留原始值。`,
      });
    }

    frame.datagrams.push(datagram);
    pos += totalSize;
    datagramIndex += 1;
    lastMore = more;
    parsedAny = true;

    if (!more) {
      break;
    }

    // 防止异常数据导致无限循环。
    if (datagramIndex > 1_000_000) {
      anomalies.push({
        kind: "length-out-of-bounds",
        message: "数据报数量异常，已停止解析该帧。",
      });
      break;
    }
  }

  // 一致性校验。
  if (!parsedAny && frame.frameLength > 0) {
    anomalies.push({
      kind: "truncated",
      message: `帧头声明数据报区 ${frame.frameLength} 字节，但不足以容纳一个完整数据报。`,
    });
  } else if (parsedAny && lastMore) {
    // 最后一个数据报仍声明还有后续，但已无可解析空间。
    anomalies.push({
      kind: "more-flag-mismatch",
      message: "最后一个数据报仍标记“还有后续数据报”，但帧内已无剩余空间。",
    });
  }

  const consumed = pos - regionStart;
  if (frame.frameLength !== 0 && consumed !== frame.frameLength) {
    anomalies.push({
      kind: "more-flag-mismatch",
      message: `帧头声明数据报区 ${frame.frameLength} 字节，实际解析 ${consumed} 字节，二者不一致。`,
    });
  }

  // 以太网填充：数据报区之后、报文末尾之前的字节。
  const afterDatagrams = Math.max(pos, regionEnd);
  frame.paddingLength = Math.max(0, packetEnd - afterDatagrams);

  return frame;
}

function u16le(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8);
}
