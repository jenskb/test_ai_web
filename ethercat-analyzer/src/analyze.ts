// 将 PCAPNG 解析出的原始报文（RawPacket）解析为 FrameIndex（以太网 + EtherCAT 摘要）。

import type { FrameIndex } from './types';
import { LINKTYPE_ETHERNET, type RawPacket } from './pcapng/parse';
import { parseEthernet } from './ethernet/ethernet';
import { parseEthercat } from './ethercat/ethercat';

export function dissectPacket(packet: RawPacket): FrameIndex {
  const anomalies: string[] = [];
  let eth = null;
  let ecat = null;
  let notEthernet: string | undefined;

  if (packet.linkType === -1) {
    notEthernet = '接口链路类型未知（SPB 引用的接口 0 未定义）';
  } else if (packet.linkType !== LINKTYPE_ETHERNET) {
    notEthernet = `接口链路类型 ${packet.linkType} 不支持（仅支持 Ethernet=1）`;
  } else {
    const r = parseEthernet(packet.data);
    if ('error' in r) {
      anomalies.push(r.error);
    } else {
      eth = r.eth;
      if (eth.isEtherCAT) {
        const payload = packet.data.subarray(eth.payloadOffset);
        const { ecat: e } = parseEthercat(payload, eth.payloadOffset);
        ecat = e;
        if (e.error) anomalies.push(e.error);
        // 以太网填充检测：帧头声明长度 + 2 之后仍有多余字节（可能含 FCS）。
        const ethercatTotal = 2 + e.headerLength;
        const remain = packet.capturedLen - eth.payloadOffset - ethercatTotal;
        if (remain > 0) eth.paddingDetected = true;
      }
    }
  }

  return {
    seq: packet.seq,
    interfaceId: packet.interfaceId,
    fileOffset: packet.fileOffset,
    capturedLen: packet.capturedLen,
    origLen: packet.origLen,
    timestampRaw: packet.timestampRaw,
    tsResol: packet.tsResol,
    tsOffset: packet.tsOffset,
    intervalSec: null,
    relativeSec: null,
    eth,
    ecat,
    anomalies,
    notEthernet,
  };
}
