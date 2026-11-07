// 以太网帧解析：目的/源 MAC、EtherType、VLAN（含叠加）、EtherCAT（0x88A4）过滤。
// 依据：IEEE 802.3 与 Wireshark epan/dissectors/packet-ethertype.c（VLAN/QinQ 识别）。

import type { EthSummary, FieldNode, VlanTag } from '../types';
import { u16be } from '../lib/bytes';
import { formatMac } from '../lib/format';

export const ETHERTYPE_VLAN = 0x8100; // 802.1Q
export const ETHERTYPE_QINQ = 0x88a8; // 802.1ad 运营商桥接
export const ETHERTYPE_QINQ_OLD = 0x9100; // 旧式 QinQ（部分厂商）
export const ETHERTYPE_ETHERCAT = 0x88a4;

const MIN_ETHERNET_HEADER = 14; // 目的 MAC(6) + 源 MAC(6) + EtherType(2)

function isVlanEtherType(et: number): boolean {
  return et === ETHERTYPE_VLAN || et === ETHERTYPE_QINQ || et === ETHERTYPE_QINQ_OLD;
}

// 解析以太网头部，返回摘要（含各字段偏移）。非以太网或长度不足时返回 null。
export function parseEthernet(bytes: Uint8Array): { eth: EthSummary } | { error: string } {
  if (bytes.length < MIN_ETHERNET_HEADER) {
    return { error: `以太网帧过短（${bytes.length} 字节 < ${MIN_ETHERNET_HEADER}）` };
  }

  const dstMac = formatMac(bytes.subarray(0, 6));
  const srcMac = formatMac(bytes.subarray(6, 12));

  const vlanTags: VlanTag[] = [];
  let etherType = u16be(bytes, 12);
  let off = 14;

  // 叠加 VLAN：依次剥掉 VLAN/QinQ 标签。
  while (isVlanEtherType(etherType) && off + 4 <= bytes.length) {
    const tci = u16be(bytes, off);
    const innerEtherType = u16be(bytes, off + 2);
    vlanTags.push({
      tci,
      pcp: (tci >> 13) & 0x7,
      dei: (tci >> 12) & 0x1,
      vid: tci & 0x0fff,
      innerEtherType,
      offset: off,
    });
    etherType = innerEtherType;
    off += 4;
  }

  const eth: EthSummary = {
    dstMac,
    srcMac,
    etherType,
    vlanTags,
    isEtherCAT: etherType === ETHERTYPE_ETHERCAT,
    payloadOffset: off,
    paddingDetected: false,
  };
  return { eth };
}

// 构建以太网协议树（供详情视图，字段带真实字节偏移）。
export function buildEthernetTree(eth: EthSummary): FieldNode[] {
  const nodes: FieldNode[] = [];
  nodes.push({ name: '目的 MAC', value: eth.dstMac, offset: 0, length: 6 });
  nodes.push({ name: '源 MAC', value: eth.srcMac, offset: 6, length: 6 });

  let off = 12;
  for (let i = 0; i < eth.vlanTags.length; i++) {
    const t = eth.vlanTags[i] as VlanTag;
    const tagName = eth.vlanTags.length > 1 ? `VLAN 标签（第 ${i + 1} 层）` : 'VLAN 标签';
    nodes.push({
      name: tagName,
      value: `VID ${t.vid}`,
      offset: t.offset,
      length: 4,
      children: [
        { name: 'PCP', value: String(t.pcp), offset: t.offset, length: 2 },
        { name: 'DEI', value: String(t.dei), offset: t.offset, length: 2 },
        { name: 'VID', value: String(t.vid), offset: t.offset, length: 2 },
        {
          name: '内部 EtherType',
          value: `0x${t.innerEtherType.toString(16).padStart(4, '0')}`,
          offset: t.offset + 2,
          length: 2,
        },
      ],
    });
    off += 4;
  }

  nodes.push({
    name: 'EtherType',
    value: `0x${eth.etherType.toString(16).padStart(4, '0')}`,
    offset: off,
    length: 2,
  });

  return nodes;
}
