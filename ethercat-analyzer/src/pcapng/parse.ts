// PCAPNG 流式解析器。
// 依据：draft-tuexen-opsawg-pcapng（pcapng 规范）与 Wireshark wiretap/pcapng.c。
// 关键点：
//   - Block Type / Block Total Length 使用「所属 section 的字节序」（非固定小端）；
//     SHB 的 Block Type 0x0A0D0D0A 为字节序回文，BOM 决定 section 字节序。
//   - 分块读取，仅保留当前块字节与必要的帧索引（偏移、长度、摘要），不保存全文件与 HEX 字符串。
//   - 首尾块长度一致性、4 字节对齐、读取边界、恶意长度限制。

import type { InterfaceInfo, TimeResol } from '../types';
import { i64, u16, u32 } from '../lib/bytes';
import { DEFAULT_TS_RESOL, parseTsResol } from '../lib/time';

export const BLOCK_TYPE_SHB = 0x0a0d0d0a;
export const BLOCK_TYPE_IDB = 0x00000001;
export const BLOCK_TYPE_PACKET = 0x00000002; // 已废弃 Packet Block，可能含报文
export const BLOCK_TYPE_SPB = 0x00000003;
export const BLOCK_TYPE_NRB = 0x00000004;
export const BLOCK_TYPE_ISB = 0x00000005;
export const BLOCK_TYPE_EPB = 0x00000006;
export const BLOCK_TYPE_OBSOLETE_PACKET = 0x00000008; // 已废弃 Packet Block，可能含报文
export const BLOCK_TYPE_DSB = 0x0000000a;

export const LINKTYPE_ETHERNET = 1;

const BOM_LE = 0x1a2b3c4d;
const BOM_BE = 0x4d3c2b1a;
const MIN_BLOCK_SIZE = 12; // type(4) + total len(4) + trailing total len(4)
const MAX_BLOCK_SIZE = 64 * 1024 * 1024; // 64 MB
const MAX_FRAMES = 5_000_000;

const OPT_ENDOFOPT = 0;
const OPT_IF_NAME = 2;
const OPT_IF_TSRESOL = 9;
const OPT_IF_TSOFFSET = 14;

export interface RawPacket {
  seq: number;
  interfaceId: number;
  fileOffset: number; // 报文数据（以太网帧）在文件中的字节偏移
  capturedLen: number;
  origLen: number;
  timestampRaw: bigint | null;
  tsResol: TimeResol;
  tsOffset: bigint;
  linkType: number; // -1 = 未知
  hasTimestamp: boolean;
  data: Uint8Array; // capturedLen 字节的报文数据视图
}

export interface ParserCallbacks {
  onInterface(info: InterfaceInfo): void;
  onPacket(packet: RawPacket): void;
  onWarning(message: string): void;
}

export class PcapngParser {
  private buf: Uint8Array = new Uint8Array(0);
  private pos = 0;
  private baseOffset = 0;

  private littleEndian = true;
  private sawSection = false;
  private sectionCountValue = 0;
  private interfaces: InterfaceInfo[] = [];
  private frameSeq = 0;
  private warnedBlockTypes = new Set<number>();
  private finished = false;
  private aborted = false;
  private truncated = false;

  constructor(private callbacks: ParserCallbacks) {}

  get sectionCount(): number {
    return this.sectionCountValue;
  }

  get isTruncated(): boolean {
    return this.truncated;
  }

  get frameCount(): number {
    return this.frameSeq;
  }

  push(chunk: Uint8Array, chunkBaseOffset: number): void {
    if (this.aborted) return;
    const consumed = this.pos;
    if (consumed >= this.buf.length) {
      this.buf = chunk;
      this.pos = 0;
      this.baseOffset = chunkBaseOffset;
    } else {
      const remaining = this.buf.subarray(consumed);
      const merged = new Uint8Array(remaining.length + chunk.length);
      merged.set(remaining, 0);
      merged.set(chunk, remaining.length);
      this.buf = merged;
      this.pos = 0;
      this.baseOffset = chunkBaseOffset - remaining.length;
    }
    this.parseLoop();
  }

  // 所有数据已推入后调用，处理截断残留。
  finish(): void {
    if (this.finished || this.aborted) return;
    this.finished = true;
    const leftover = this.buf.length - this.pos;
    if (leftover > 0) {
      this.truncated = true;
      this.callbacks.onWarning(`文件在块边界处被截断：剩余 ${leftover} 字节未构成完整块`);
    }
  }

  private parseLoop(): void {
    for (;;) {
      const avail = this.buf.length - this.pos;
      if (avail < 8) break; // 需要更多数据

      const blockFileOffset = this.baseOffset + this.pos;
      const typeRawLe = u32(this.buf, this.pos, true);
      const isSHB = typeRawLe === BLOCK_TYPE_SHB;

      let blockType: number;
      let totalLen: number;
      let le: boolean;

      if (isSHB) {
        if (avail < 12) break; // 需读取 BOM
        const bom = u32(this.buf, this.pos + 8, true);
        if (bom === BOM_LE) {
          le = true;
        } else if (bom === BOM_BE) {
          le = false;
        } else {
          this.callbacks.onWarning(
            `文件偏移 ${blockFileOffset} 处字节序魔数未知（0x${bom.toString(16)}），停止解析`,
          );
          this.aborted = true;
          return;
        }
        this.littleEndian = le;
        blockType = BLOCK_TYPE_SHB;
        totalLen = u32(this.buf, this.pos + 4, le);
      } else {
        if (!this.sawSection) {
          this.callbacks.onWarning(`首个块不是 Section Header Block（0x${typeRawLe.toString(16)}），文件可能损坏`);
          this.aborted = true;
          return;
        }
        le = this.littleEndian;
        blockType = u32(this.buf, this.pos, le);
        totalLen = u32(this.buf, this.pos + 4, le);
      }

      if (totalLen < MIN_BLOCK_SIZE) {
        this.callbacks.onWarning(
          `文件偏移 ${blockFileOffset} 处块长度 ${totalLen} 小于最小块长度 ${MIN_BLOCK_SIZE}，停止解析`,
        );
        this.aborted = true;
        return;
      }
      if (totalLen > MAX_BLOCK_SIZE) {
        this.callbacks.onWarning(
          `文件偏移 ${blockFileOffset} 处块长度 ${totalLen} 超过上限 ${MAX_BLOCK_SIZE}，停止解析`,
        );
        this.aborted = true;
        return;
      }

      // 4 字节对齐（宽容处理：未对齐时向上取整，与 Wireshark 一致）
      let paddedLen = totalLen;
      if (totalLen % 4 !== 0) {
        this.callbacks.onWarning(`文件偏移 ${blockFileOffset} 处块长度 ${totalLen} 非 4 字节对齐`);
        paddedLen = (totalLen + 3) & ~3;
      }

      if (avail < paddedLen) break; // 需要更多数据

      // 首尾块长度一致性校验
      const tailLen = u32(this.buf, this.pos + paddedLen - 4, le);
      const tailPadded = (tailLen % 4 !== 0 ? (tailLen + 3) & ~3 : tailLen);
      if (tailPadded !== paddedLen) {
        this.callbacks.onWarning(
          `文件偏移 ${blockFileOffset} 处块首尾长度不一致（首 ${totalLen}，尾 ${tailLen}）`,
        );
      }

      this.processBlock(blockType, totalLen, this.pos, blockFileOffset, le);
      this.pos += paddedLen;

      if (this.aborted) return;
    }
  }

  private processBlock(
    blockType: number,
    totalLen: number,
    relPos: number,
    blockFileOffset: number,
    le: boolean,
  ): void {
    switch (blockType) {
      case BLOCK_TYPE_SHB: {
        this.sawSection = true;
        this.sectionCountValue++;
        // 新 section：重新建立接口编号映射（帧序号保持全局递增）。
        this.interfaces = [];
        break;
      }
      case BLOCK_TYPE_IDB: {
        this.processIdb(relPos, totalLen, le);
        break;
      }
      case BLOCK_TYPE_EPB: {
        this.processEpb(relPos, totalLen, blockFileOffset, le);
        break;
      }
      case BLOCK_TYPE_SPB: {
        this.processSpb(relPos, totalLen, blockFileOffset, le);
        break;
      }
      case BLOCK_TYPE_PACKET:
      case BLOCK_TYPE_OBSOLETE_PACKET: {
        this.warnOnce(blockType, `发现已废弃的报文块类型 0x${blockType.toString(16)}，可能包含报文，本工具不解析，相关报文将被跳过`);
        break;
      }
      case BLOCK_TYPE_NRB:
      case BLOCK_TYPE_ISB:
      case BLOCK_TYPE_DSB:
        break; // 已知但无报文内容的块，安全跳过
      default: {
        this.warnOnce(blockType, `不支持的块类型 0x${blockType.toString(16)}，已跳过`);
        break;
      }
    }
  }

  private warnOnce(type: number, msg: string): void {
    if (this.warnedBlockTypes.has(type)) return;
    this.warnedBlockTypes.add(type);
    this.callbacks.onWarning(msg);
  }

  private processIdb(relPos: number, totalLen: number, le: boolean): void {
    const linkType = u16(this.buf, relPos + 8, le);
    const snapLen = u32(this.buf, relPos + 12, le);

    let tsResol: TimeResol = DEFAULT_TS_RESOL;
    let tsResolRaw: number | null = null;
    let tsOffset = 0n;
    let name = '';

    const optionsStart = relPos + 16;
    const optionsLen = totalLen - 20; // 16（头+固定） + 4（尾长度）
    this.parseOptions(optionsStart, optionsLen, le, (code, valOff, valLen) => {
      if (code === OPT_IF_TSRESOL && valLen >= 1) {
        tsResolRaw = this.buf[valOff] as number;
        tsResol = parseTsResol(tsResolRaw);
      } else if (code === OPT_IF_TSOFFSET && valLen >= 8) {
        tsOffset = i64(this.buf, valOff, le);
      } else if (code === OPT_IF_NAME) {
        name = decodeUtf8(this.buf.subarray(valOff, valOff + valLen));
      }
    });

    const info: InterfaceInfo = {
      id: this.interfaces.length,
      linkType,
      snapLen,
      tsResol,
      tsResolRaw,
      tsOffset,
      name,
    };
    this.interfaces.push(info);
    this.callbacks.onInterface(info);
  }

  private processEpb(relPos: number, totalLen: number, blockFileOffset: number, le: boolean): void {
    const interfaceId = u32(this.buf, relPos + 8, le);
    const tsHigh = u32(this.buf, relPos + 12, le);
    const tsLow = u32(this.buf, relPos + 16, le);
    const capturedLen = u32(this.buf, relPos + 20, le);
    const origLen = u32(this.buf, relPos + 24, le);

    const iface = this.interfaces[interfaceId];
    if (!iface) {
      this.callbacks.onWarning(`EPB 引用了未定义的接口 ID ${interfaceId}，按默认设置处理`);
    }

    let capLen = capturedLen;
    const maxDataLen = totalLen - 28; // 头(8) + 固定(20)
    if (capLen > maxDataLen) {
      this.callbacks.onWarning(
        `EPB 声明捕获长度 ${capLen} 超出块内可用字节 ${maxDataLen}，已截断`,
      );
      capLen = maxDataLen;
    }

    const packetData = this.buf.subarray(relPos + 28, relPos + 28 + capLen);
    this.emitPacket(
      interfaceId,
      iface?.linkType ?? -1,
      iface?.tsResol ?? DEFAULT_TS_RESOL,
      iface?.tsOffset ?? 0n,
      blockFileOffset + 28,
      capLen,
      origLen,
      (BigInt(tsHigh) << 32n) | BigInt(tsLow),
      true,
      packetData,
    );
  }

  private processSpb(relPos: number, totalLen: number, blockFileOffset: number, le: boolean): void {
    const origLen = u32(this.buf, relPos + 8, le);
    const iface = this.interfaces[0];

    let capLen = origLen;
    if (iface && iface.snapLen !== 0 && capLen > iface.snapLen) {
      capLen = iface.snapLen;
    }
    const maxDataLen = totalLen - 16; // 头(8) + 原始长度(4) + 尾长度(4)
    if (capLen > maxDataLen) {
      this.callbacks.onWarning(`SPB 原始长度 ${origLen} 超出块内可用字节 ${maxDataLen}，已截断`);
      capLen = maxDataLen;
    }

    const packetData = this.buf.subarray(relPos + 12, relPos + 12 + capLen);
    this.emitPacket(
      0,
      iface?.linkType ?? -1,
      iface?.tsResol ?? DEFAULT_TS_RESOL,
      iface?.tsOffset ?? 0n,
      blockFileOffset + 12,
      capLen,
      origLen,
      null,
      false,
      packetData,
    );
  }

  private emitPacket(
    interfaceId: number,
    linkType: number,
    tsResol: TimeResol,
    tsOffset: bigint,
    fileOffset: number,
    capturedLen: number,
    origLen: number,
    timestampRaw: bigint | null,
    hasTimestamp: boolean,
    data: Uint8Array,
  ): void {
    this.frameSeq++;
    if (this.frameSeq > MAX_FRAMES) {
      this.callbacks.onWarning(`报文数量超过上限 ${MAX_FRAMES}，停止解析`);
      this.aborted = true;
      return;
    }
    this.callbacks.onPacket({
      seq: this.frameSeq,
      interfaceId,
      fileOffset,
      capturedLen,
      origLen,
      timestampRaw,
      tsResol,
      tsOffset,
      linkType,
      hasTimestamp,
      data,
    });
  }

  private parseOptions(
    start: number,
    len: number,
    le: boolean,
    handler: (code: number, valOff: number, valLen: number) => void,
  ): void {
    let p = start;
    const end = start + len;
    while (p + 4 <= end) {
      const code = u16(this.buf, p, le);
      const olen = u16(this.buf, p + 2, le);
      p += 4;
      if (code === OPT_ENDOFOPT) break;
      if (p + olen > end) {
        this.callbacks.onWarning('选项值长度超出块边界，已跳过剩余选项');
        break;
      }
      handler(code, p, olen);
      p += olen;
      p += (4 - (olen % 4)) % 4;
    }
  }
}

function decodeUtf8(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8').decode(bytes);
  } catch {
    return '';
  }
}
