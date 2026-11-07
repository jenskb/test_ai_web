// EtherCAT 帧头 + 数据报解析。
// 依据：ETG.1000.4 与 Wireshark plugins/epan/ethercat/packet-ethercat-datagram.c、
// packet-ethercat-frame.c。字段布局逐字节核对，不凭记忆。

import type { DatagramSummary, EcatFrameSummary, FieldNode } from '../types';
import { u16le, u32le, u8 } from '../lib/bytes';
import { commandAddressing, commandName, frameTypeName } from './commands';
import { toHexString } from '../lib/hex';

const DATAGRAM_HEADER_LEN = 10; // Cmd(1) + Idx(1) + Address(4) + LenWord(2) + IRQ(2)

export interface EthercatParseResult {
  ecat: EcatFrameSummary;
}

// payload 从 EtherCAT 帧头起始；payloadOffset 是其在以太网帧内的偏移。
export function parseEthercat(payload: Uint8Array, payloadOffset: number): EthercatParseResult {
  const anomalies: string[] = [];

  if (payload.length < 2) {
    return {
      ecat: {
        frameType: -1,
        frameTypeName: '帧头不完整',
        headerLength: 0,
        isDatagram: false,
        datagrams: [],
        headerOffset: payloadOffset,
        error: `EtherCAT 帧头不完整（仅 ${payload.length} 字节）`,
      },
    };
  }

  const hdr = u16le(payload, 0);
  const headerLength = hdr & 0x07ff;
  const reserved = (hdr >> 11) & 0x1;
  const frameType = (hdr >> 12) & 0xf;
  void reserved;

  if (frameType !== 1) {
    return {
      ecat: {
        frameType,
        frameTypeName: frameTypeName(frameType),
        headerLength,
        isDatagram: false,
        datagrams: [],
        headerOffset: payloadOffset,
        error: `非数据报类型（${frameTypeName(frameType)}），不按数据报解析`,
      },
    };
  }

  const datagrams: DatagramSummary[] = [];
  const available = payload.length - 2; // 帧头后的可用字节（含可能的填充）
  const declared = headerLength; // 帧头声明的数据报区长度

  let off = 2; // 相对 payload 起始
  let more = true;
  let first = true;

  while (more) {
    const rem = payload.length - off;
    if (rem < DATAGRAM_HEADER_LEN) {
      if (first) {
        anomalies.push('数据报区过短，无完整数据报头');
      } else {
        anomalies.push('M 标志指示有后续数据报，但剩余字节不足一个数据报头');
      }
      break;
    }

    const cmd = u8(payload, off);
    const idx = u8(payload, off + 1);
    const address = u32le(payload, off + 2);
    const lenWord = u16le(payload, off + 6);
    const dlen = lenWord & 0x07ff;
    const circulating = ((lenWord >> 14) & 0x1) === 1;
    const moreFlag = ((lenWord >> 15) & 0x1) === 1;
    const irq = u16le(payload, off + 8);

    const need = DATAGRAM_HEADER_LEN + dlen + 2; // 头 + 数据 + WKC
    if (need > rem) {
      const d = makeDatagram(
        payload,
        payloadOffset,
        off,
        cmd,
        idx,
        address,
        dlen,
        circulating,
        moreFlag,
        irq,
        `数据报声明长度 ${dlen} 字节超出捕获边界（剩余 ${rem} 字节）`,
      );
      datagrams.push(d);
      anomalies.push(`数据报 #${datagrams.length} 长度越界（声明 ${need} 字节，剩余 ${rem} 字节）`);
      break;
    }

    datagrams.push(
      makeDatagram(payload, payloadOffset, off, cmd, idx, address, dlen, circulating, moreFlag, irq),
    );

    first = false;
    off += need;
    if (!moreFlag) {
      more = false;
    } else if (off - 2 >= available) {
      anomalies.push('M 标志指示有后续数据报，但帧头声明长度已耗尽');
      more = false;
    }
  }

  // 帧头声明长度与实际数据报总长一致性校验。
  const consumed = off - 2; // 实际被数据报占用的字节数
  if (declared > 0 && consumed !== declared) {
    if (consumed > declared) {
      anomalies.push(`数据报总长 ${consumed} 字节超出帧头声明长度 ${declared} 字节`);
    } else {
      anomalies.push(`帧头声明长度 ${declared} 字节，实际数据报总长 ${consumed} 字节，不一致`);
    }
  }

  return {
    ecat: {
      frameType,
      frameTypeName: frameTypeName(frameType),
      headerLength,
      isDatagram: true,
      datagrams,
      headerOffset: payloadOffset,
      error: anomalies.length > 0 ? anomalies.join('；') : undefined,
    },
  };
}

function makeDatagram(
  payload: Uint8Array,
  payloadOffset: number,
  off: number,
  cmd: number,
  idx: number,
  address: number,
  dlen: number,
  circulating: boolean,
  moreFlag: boolean,
  irq: number,
  error?: string,
): DatagramSummary {
  const addrKind = commandAddressing(cmd);
  const isLogical = addrKind === 'logical';
  const isPhysical = addrKind === 'physical';
  const dataOffset = payloadOffset + off + DATAGRAM_HEADER_LEN;
  const wkcOffset = dataOffset + dlen;
  // payload 从帧头开始，读取 WKC 需换算为相对 payload 的偏移。
  const wkcRel = wkcOffset - payloadOffset;
  const wkcAvailable = wkcRel + 2 <= payload.length;
  const wkc = wkcAvailable ? u16le(payload, wkcRel) : 0;
  const d: DatagramSummary = {
    cmdRaw: cmd,
    cmdName: commandName(cmd),
    idx,
    address,
    adp: (address >>> 16) & 0xffff,
    ado: address & 0xffff,
    logicalAddress: address,
    length: dlen,
    circulating,
    more: moreFlag,
    irq,
    wkc,
    offset: payloadOffset + off,
    dataOffset,
    wkcOffset,
    isPhysical,
    isLogical,
    error,
  };
  if (!wkcAvailable) {
    d.error = d.error ? `${d.error}；WKC 越界` : 'WKC 越界（捕获数据不足）';
  }
  return d;
}

// 构建 EtherCAT 帧头 + 数据报协议树（字段带真实字节偏移）。
export function buildEthercatTree(
  payload: Uint8Array,
  payloadOffset: number,
  ecat: EcatFrameSummary,
  frameTotalLen: number,
): { frameTree: FieldNode[]; datagramTrees: FieldNode[][] } {
  const hdr = u16le(payload, 0);
  const headerLength = hdr & 0x07ff;
  const reserved = (hdr >> 11) & 0x1;
  const frameType = (hdr >> 12) & 0xf;

  const frameTree: FieldNode[] = [
    { name: '长度（Length）', value: String(headerLength), offset: payloadOffset, length: 2 },
    { name: '保留位（Reserved）', value: String(reserved), offset: payloadOffset, length: 2 },
    {
      name: '类型（Type）',
      value: `${frameTypeName(frameType)} (${frameType})`,
      offset: payloadOffset,
      length: 2,
    },
  ];

  // 以太网填充：帧头声明长度 + 2 之后仍有多余字节。
  const ethercatTotal = 2 + headerLength;
  const remainder = frameTotalLen - payloadOffset - ethercatTotal;
  if (remainder > 0) {
    frameTree.push({
      name: '以太网填充（不含 FCS 假设）',
      value: `${remainder} 字节`,
      offset: payloadOffset + ethercatTotal,
      length: remainder,
    });
  }

  const datagramTrees: FieldNode[][] = [];
  for (const d of ecat.datagrams) {
    const tree: FieldNode[] = [];
    tree.push({ name: '命令（Cmd）', value: `${d.cmdName} (0x${d.cmdRaw.toString(16).padStart(2, '0')})`, offset: d.offset, length: 1 });
    tree.push({ name: '索引（Idx）', value: `0x${d.idx.toString(16).padStart(2, '0')}`, offset: d.offset + 1, length: 1 });

    if (d.isLogical) {
      tree.push({
        name: '逻辑地址（LAD）',
        value: `0x${d.logicalAddress.toString(16).padStart(8, '0')}`,
        offset: d.offset + 2,
        length: 4,
      });
    } else if (d.isPhysical) {
      tree.push({
        name: '物理地址（ADP/ADO）',
        value: `ADP 0x${d.adp.toString(16).padStart(4, '0')}, ADO 0x${d.ado.toString(16).padStart(4, '0')}`,
        offset: d.offset + 2,
        length: 4,
        children: [
          { name: 'ADP', value: `0x${d.adp.toString(16).padStart(4, '0')}`, offset: d.offset + 2, length: 2 },
          { name: 'ADO', value: `0x${d.ado.toString(16).padStart(4, '0')}`, offset: d.offset + 4, length: 2 },
        ],
      });
    } else {
      tree.push({
        name: '地址（Address）',
        value: `0x${d.address.toString(16).padStart(8, '0')}`,
        offset: d.offset + 2,
        length: 4,
      });
    }

    tree.push({
      name: '长度（Len）',
      value: String(d.length),
      offset: d.offset + 6,
      length: 2,
      children: [
        { name: '数据长度', value: String(d.length), offset: d.offset + 6, length: 2 },
        { name: '保留位', value: '0b000', offset: d.offset + 6, length: 2 },
        { name: '循环帧（C）', value: d.circulating ? '1（已循环一次）' : '0', offset: d.offset + 6, length: 2 },
        { name: '后续数据报（M）', value: d.more ? '1（有后续）' : '0（最后一个）', offset: d.offset + 6, length: 2 },
      ],
    });

    tree.push({
      name: '中断（IRQ）',
      value: `0x${d.irq.toString(16).padStart(4, '0')}`,
      offset: d.offset + 8,
      length: 2,
    });

    if (d.length > 0) {
      const dataAvailable = d.dataOffset + d.length <= payload.length;
      const hex = dataAvailable
        ? toHexString(payload, d.dataOffset - payloadOffset, Math.min(d.length, 256))
        : '（数据越界，无法读取）';
      tree.push({
        name: '数据（Data）',
        value: d.length > 256 ? `${hex}…（共 ${d.length} 字节，截断显示）` : hex,
        offset: d.dataOffset,
        length: d.length,
      });
    } else {
      tree.push({ name: '数据（Data）', value: '（空）', offset: d.dataOffset, length: 0 });
    }

    tree.push({
      name: '工作计数器（WKC）',
      value: `${d.wkc}${d.wkc === 0 ? '（需检查）' : ''}`,
      offset: d.wkcOffset,
      length: 2,
    });

    if (d.error) {
      tree.push({ name: '异常', value: d.error, offset: d.offset, length: 0 });
    }

    datagramTrees.push(tree);
  }

  return { frameTree, datagramTrees };
}
