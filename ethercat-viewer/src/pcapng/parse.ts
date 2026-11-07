// PCAPNG 文件解析。
//
// 参考：IETF draft "PCAP Next Generation (pcapng) Capture File Format"
//      https://www.ietf.org/archive/id/draft-tuexen-opsawg-pcapng-05.html
//
// 支持块：SHB / IDB / EPB / SPB；其它块在长度合法时安全跳过，
// 对可能包含报文的旧版 Packet Block 明确告警，不静默漏掉报文。

import { DataReader, asSigned64 } from "./reader";
import type { InterfaceInfo, PacketRecord, TsResol, Warning } from "../types";

/** LINKTYPE_ETHERNET = 1。 */
export const LINKTYPE_ETHERNET = 1;

// 块类型。
const BT_SHB = 0x0a0d0d0a;
const BT_IDB = 0x00000001;
const BT_PACKET = 0x00000002; // 已废弃的 Packet Block，含报文但无时间戳语义
const BT_SPB = 0x00000003;
const BT_EPB = 0x00000006;

// 选项代码。
const OPT_END = 0;
const OPT_IF_NAME = 2;
const OPT_IF_DESCRIPTION = 3;
const OPT_IF_TSRESOL = 9;
const OPT_IF_TSOFFSET = 14;

/** 默认时间分辨率：10^-6（微秒）。 */
export const DEFAULT_TSRESOL: TsResol = { base: 10, exponent: 6 };

/** 报文数量上限，防止恶意/异常文件导致资源耗尽。 */
const MAX_PACKETS = 2_000_000;

export interface PcapngParseOptions {
  /** 进度回调：已读取字节 / 总字节。 */
  onProgress?: (offset: number, total: number) => void;
  /** 取消信号。返回 true 表示应中止。 */
  shouldCancel?: () => boolean;
}

export interface PcapngParseResult {
  interfaces: InterfaceInfo[];
  packets: PacketRecord[];
  warnings: Warning[];
  sections: number;
}

/** 若被取消则抛出该错误。 */
export class CancelledError extends Error {
  constructor() {
    super("解析已取消");
    this.name = "CancelledError";
  }
}

interface SectionState {
  index: number; // 1 起
  localInterfaces: (InterfaceInfo | undefined)[];
  endian: boolean; // true = 小端
}

export function parsePcapng(
  buffer: ArrayBuffer,
  options: PcapngParseOptions = {},
): PcapngParseResult {
  const reader = new DataReader(buffer, true);
  const total = buffer.byteLength;

  const interfaces: InterfaceInfo[] = [];
  const packets: PacketRecord[] = [];
  const warnings: Warning[] = [];

  let offset = 0;
  let sections = 0;

  // 当前 section 状态。首个 SHB 之前处于“未初始化”状态。
  let section: SectionState | null = null;

  const pushWarning = (w: Warning) => warnings.push(w);

  // 读取一个选项，返回其值在块内相对 body 的偏移与长度；失败返回 null。
  const parseIdbOptions = (
    optStart: number,
    bodyEnd: number,
    info: InterfaceInfo,
  ): void => {
    let p = optStart;
    while (p + 4 <= bodyEnd) {
      const code = reader.u16(p);
      const len = reader.u16(p + 2);
      if (code === OPT_END) return;
      const valueOffset = p + 4;
      // 值必须在块体内，避免越界读取。
      const valueEnd = Math.min(valueOffset + len, bodyEnd);
      if (code === OPT_IF_TSRESOL && len >= 1 && valueOffset + 1 <= bodyEnd) {
        const v = reader.u8(valueOffset);
        if ((v & 0x80) === 0) {
          info.tsResol = { base: 10, exponent: v };
        } else {
          info.tsResol = { base: 2, exponent: v & 0x7f };
        }
      } else if (code === OPT_IF_TSOFFSET && len >= 8 && valueOffset + 8 <= bodyEnd) {
        info.tsOffsetSec = asSigned64(reader.u64(valueOffset));
      } else if (code === OPT_IF_NAME && len >= 1) {
        info.name = decodeUtf8(reader.bytes(valueOffset, valueEnd - valueOffset));
      } else if (code === OPT_IF_DESCRIPTION && len >= 1) {
        info.description = decodeUtf8(reader.bytes(valueOffset, valueEnd - valueOffset));
      }
      const padded = (len + 3) & ~3;
      p += 4 + padded;
      if (p > bodyEnd) {
        pushWarning({
          severity: "warning",
          message: "IDB 选项数据越界。",
          offset,
        });
        return;
      }
    }
  };

  // 处理一个 SHB，设置字节序并开始新的 section。
  const beginSection = (blockOffset: number): void => {
    const bom = reader.bytes(blockOffset + 8, 4);
    let littleEndian: boolean;
    if (bom[0] === 0x1a && bom[1] === 0x2b && bom[2] === 0x3c && bom[3] === 0x4d) {
      littleEndian = false; // 大端
    } else if (
      bom[0] === 0x4d && bom[1] === 0x3c && bom[2] === 0x2b && bom[3] === 0x1a
    ) {
      littleEndian = true; // 小端
    } else {
      pushWarning({
        severity: "error",
        message: "SHB 字节序魔数无效，无法确定字节序。",
        offset: blockOffset,
      });
      // 回退为小端，尽力继续。
      littleEndian = true;
    }
    reader.setEndian(littleEndian);
    sections += 1;
    section = {
      index: sections,
      localInterfaces: [],
      endian: littleEndian,
    };
  };

  // 处理一个 IDB，在 section 中登记接口。
  const handleIdb = (blockOffset: number, bodyEnd: number): void => {
    if (!section) {
      pushWarning({
        severity: "warning",
        message: "IDB 出现在 SHB 之前，已忽略。",
        offset: blockOffset,
      });
      return;
    }
    // IDB 固定字段需 8 字节块体（LinkType + Reserved + SnapLen）。
    if (blockOffset + 16 > bodyEnd) {
      pushWarning({
        severity: "error",
        message: "IDB 块体被截断，无法读取接口信息。",
        offset: blockOffset,
      });
      return;
    }
    const linkType = reader.u16(blockOffset + 8);
    const snapLen = reader.u32(blockOffset + 12);
    const localId = section.localInterfaces.length;

    const info: InterfaceInfo = {
      id: interfaces.length,
      section: section.index,
      localId,
      linkType,
      snapLen,
      tsResol: { ...DEFAULT_TSRESOL },
      tsOffsetSec: 0n,
    };
    parseIdbOptions(blockOffset + 16, bodyEnd, info);
    section.localInterfaces.push(info);
    interfaces.push(info);

    if (linkType !== LINKTYPE_ETHERNET) {
      pushWarning({
        severity: "warning",
        message: `接口 ${formatInterfaceRef(info)} 的 LinkType=${linkType}，本版本仅解析 Ethernet，该接口的报文将仅记录、不解析 EtherCAT。`,
        offset: blockOffset,
      });
    }
  };

  // 处理一个 EPB。
  const handleEpb = (blockOffset: number, bodyEnd: number): void => {
    if (!section) {
      pushWarning({
        severity: "warning",
        message: "EPB 出现在 SHB 之前，已忽略。",
        offset: blockOffset,
      });
      return;
    }
    // EPB 固定字段需 20 字节块体。
    if (blockOffset + 28 > bodyEnd) {
      pushWarning({
        severity: "error",
        message: "EPB 块体被截断，无法读取报文头信息。",
        offset: blockOffset,
      });
      return;
    }
    const ifId = reader.u32(blockOffset + 8);
    const tsHigh = reader.u32(blockOffset + 12);
    const tsLow = reader.u32(blockOffset + 16);
    const capturedLen = reader.u32(blockOffset + 20);
    const originalLen = reader.u32(blockOffset + 24);
    const dataStart = blockOffset + 28;
    const ticks = (BigInt(tsHigh) << 32n) | BigInt(tsLow);

    const info = section.localInterfaces[ifId];
    if (!info) {
      pushWarning({
        severity: "warning",
        message: `EPB 引用了不存在的接口编号 ${ifId}（第 ${section.index} 节），该报文已记录但无法关联接口。`,
        offset: blockOffset,
        frameIndex: packets.length + 1,
      });
    }

    if (capturedLen > originalLen) {
      pushWarning({
        severity: "warning",
        message: `捕获长度 ${capturedLen} 大于原始长度 ${originalLen}。`,
        offset: blockOffset,
        frameIndex: packets.length + 1,
      });
    }

    const dataLength = Math.min(capturedLen, bodyEnd - dataStart);
    if (dataLength < capturedLen) {
      pushWarning({
        severity: "error",
        message: `EPB 报文数据被截断：声明 ${capturedLen} 字节，实际可用 ${bodyEnd - dataStart} 字节。`,
        offset: blockOffset,
        frameIndex: packets.length + 1,
      });
    }

    packets.push({
      frameIndex: packets.length + 1,
      interfaceId: info ? info.id : -1,
      linkType: info ? info.linkType : -1,
      tsTicks: ticks,
      capturedLength: dataLength,
      originalLength: originalLen,
      dataOffset: dataStart,
      dataLength,
    });
  };

  // 处理一个 SPB（无时间戳）。
  const handleSpb = (blockOffset: number, bodyEnd: number): void => {
    if (!section) {
      pushWarning({
        severity: "warning",
        message: "SPB 出现在 SHB 之前，已忽略。",
        offset: blockOffset,
      });
      return;
    }
    // SPB 固定字段需 4 字节块体（Original Packet Length）。
    if (blockOffset + 12 > bodyEnd) {
      pushWarning({
        severity: "error",
        message: "SPB 块体被截断，无法读取报文长度。",
        offset: blockOffset,
      });
      return;
    }
    const originalLen = reader.u32(blockOffset + 8);
    const dataStart = blockOffset + 12;
    const dataLength = Math.min(originalLen, bodyEnd - dataStart);
    if (dataLength < originalLen) {
      pushWarning({
        severity: "error",
        message: `SPB 报文数据被截断：声明 ${originalLen} 字节，实际可用 ${bodyEnd - dataStart} 字节。`,
        offset: blockOffset,
        frameIndex: packets.length + 1,
      });
    }
    // SPB 使用当前 section 的接口 0。
    const info = section.localInterfaces[0];
    if (!info) {
      pushWarning({
        severity: "warning",
        message: `SPB 引用了不存在的接口 0（第 ${section.index} 节）。`,
        offset: blockOffset,
        frameIndex: packets.length + 1,
      });
    }

    packets.push({
      frameIndex: packets.length + 1,
      interfaceId: info ? info.id : -1,
      linkType: info ? info.linkType : -1,
      tsTicks: null, // SPB 无时间戳，不伪造
      capturedLength: dataLength,
      originalLength: originalLen,
      dataOffset: dataStart,
      dataLength,
    });
  };

  // 主循环。
  while (offset + 12 <= total) {
    if (options.shouldCancel?.()) {
      throw new CancelledError();
    }
    if (packets.length > MAX_PACKETS) {
      pushWarning({
        severity: "warning",
        message: `报文数量超过上限 ${MAX_PACKETS}，已停止解析。`,
        offset,
      });
      break;
    }

    // 首先检查块类型字节（SHB 的块类型是字节对称的）。
    const blockTypeRaw = reader.u32(offset);
    const blockType = blockTypeRaw;

    // 仅 SHB 需要特殊处理字节序：其余块沿用当前 section 的字节序。
    const isShb =
      reader.u8(offset) === 0x0a &&
      reader.u8(offset + 1) === 0x0d &&
      reader.u8(offset + 2) === 0x0d &&
      reader.u8(offset + 3) === 0x0a;

    if (isShb) {
      beginSection(offset);
    }

    const totalLen = reader.u32(offset + 4);

    // 校验块长度。
    if (totalLen < 12 || totalLen % 4 !== 0) {
      pushWarning({
        severity: "error",
        message: `块长度非法：${totalLen}（应 ≥12 且为 4 的倍数），无法继续解析。`,
        offset,
        blockType,
      });
      break;
    }
    if (offset + totalLen > total) {
      pushWarning({
        severity: "error",
        message: `块长度 ${totalLen} 超出文件边界（文件剩余 ${total - offset} 字节），文件可能被截断。`,
        offset,
        blockType,
      });
      break;
    }

    // 校验首尾块长度一致性。
    const trailingLen = reader.u32(offset + totalLen - 4);
    if (trailingLen !== totalLen) {
      pushWarning({
        severity: "warning",
        message: `块首尾长度不一致：起始 ${totalLen}，结束 ${trailingLen}。`,
        offset,
        blockType,
      });
    }

    const bodyEnd = offset + totalLen - 4; // 排除末尾重复长度

    if (blockType === BT_SHB) {
      // 固定字段已在 beginSection 中处理；其余无需额外动作。
    } else if (blockType === BT_IDB) {
      handleIdb(offset, bodyEnd);
    } else if (blockType === BT_EPB) {
      handleEpb(offset, bodyEnd);
    } else if (blockType === BT_SPB) {
      handleSpb(offset, bodyEnd);
    } else if (blockType === BT_PACKET) {
      // 已废弃的 Packet Block：含报文但无接口/时间戳语义，明确告警。
      pushWarning({
        severity: "warning",
        message:
          "检测到已废弃的 Packet Block（块类型 0x00000002），其中可能包含报文，本工具不会静默跳过：请使用支持该块的工具（如 tshark -r ... 重新保存为 pcapng）转换后再分析。",
        offset,
        blockType,
      });
    } else {
      // 未知块：长度合法则安全跳过。
      pushWarning({
        severity: "warning",
        message: `跳过未知块类型 0x${blockType.toString(16).padStart(8, "0")}（长度 ${totalLen} 字节）。`,
        offset,
        blockType,
      });
    }

    // 前进到下一块。
    offset += totalLen;

    if (options.onProgress) {
      // 节流：每 1024 字节或每块回调一次。
      options.onProgress(offset, total);
    }
  }

  // 文件末尾若有残留但不足一个完整块头，说明被截断。
  if (offset < total && sections > 0) {
    pushWarning({
      severity: "warning",
      message: `文件末尾有 ${total - offset} 字节无法构成完整块，已忽略。`,
      offset,
    });
  }

  return { interfaces, packets, warnings, sections };
}

function decodeUtf8(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  } catch {
    return "";
  }
}

function formatInterfaceRef(info: InterfaceInfo): string {
  return `S${info.section}#${info.localId}`;
}
