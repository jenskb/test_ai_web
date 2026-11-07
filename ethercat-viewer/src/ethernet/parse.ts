// 以太网帧解析：目的/源 MAC、EtherType、常见 VLAN 标签（含叠加 VLAN）。
//
// 参考：IEEE 802.3 帧格式。EtherType 0x88A4 = EtherCAT。

import type { VlanTag } from "../types";

/** EtherCAT EtherType。 */
export const ETHERTYPE_ECAT = 0x88a4;

/** 常见 VLAN TPID。 */
const VLAN_TPIDS = new Set<number>([0x8100, 0x88a8, 0x9100, 0x9200]);

export interface EthernetParseResult {
  dstMac: string;
  srcMac: string;
  /** 剥离 VLAN 标签后的最终 EtherType。 */
  etherType: number;
  vlanTags: VlanTag[];
  /** 有效载荷（EtherCAT 帧头）在报文数据内的偏移。 */
  payloadOffset: number;
  isEtherCAT: boolean;
}

/**
 * 解析以太网帧头。
 *
 * @param bytes 报文数据视图（可能是整个文件 buffer 的切片视图）。
 * @param base  报文数据在视图内的起始偏移。
 * @param length 报文数据长度。
 */
export function parseEthernet(
  bytes: Uint8Array,
  base: number,
  length: number,
): EthernetParseResult {
  if (length < 14) {
    return {
      dstMac: "",
      srcMac: "",
      etherType: 0,
      vlanTags: [],
      payloadOffset: base + length,
      isEtherCAT: false,
    };
  }

  const dstMac = formatMac(bytes, base);
  const srcMac = formatMac(bytes, base + 6);

  let offset = base + 12;
  const vlanTags: VlanTag[] = [];
  let etherType = (bytes[offset]! << 8) | bytes[offset + 1]!;
  offset += 2;

  // 剥离开头可能的 VLAN 标签（含叠加）。
  while (VLAN_TPIDS.has(etherType) && offset + 4 <= base + length) {
    const tpid = etherType;
    const tci = (bytes[offset]! << 8) | bytes[offset + 1]!;
    vlanTags.push({ tpid, tci, vid: tci & 0x0fff });
    offset += 2;
    if (offset + 2 > base + length) {
      // 标签被截断，无法继续读取真实 EtherType。
      etherType = 0;
      break;
    }
    etherType = (bytes[offset]! << 8) | bytes[offset + 1]!;
    offset += 2;
  }

  return {
    dstMac,
    srcMac,
    etherType,
    vlanTags,
    payloadOffset: offset,
    isEtherCAT: etherType === ETHERTYPE_ECAT,
  };
}

function formatMac(bytes: Uint8Array, base: number): string {
  const b = bytes;
  return [
    b[base],
    b[base + 1],
    b[base + 2],
    b[base + 3],
    b[base + 4],
    b[base + 5],
  ]
    .map((v) => v!.toString(16).padStart(2, "0"))
    .join(":");
}
