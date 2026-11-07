// 按需生成帧详情（协议树 + 原始字节），仅在选中报文时调用，避免常驻内存。

import type { FieldNode, FrameDetail, FrameIndex } from './types';
import { buildEthernetTree } from './ethernet/ethernet';
import { buildEthercatTree } from './ethercat/ethercat';

export function buildFrameDetail(frame: FrameIndex, bytes: Uint8Array): FrameDetail {
  const eth: FieldNode[] = frame.eth ? buildEthernetTree(frame.eth) : [];
  let ecatFrame: FieldNode[] | null = null;
  let ecatDatagrams: FieldNode[][] = [];

  if (frame.ecat && frame.eth) {
    const payload = bytes.subarray(frame.eth.payloadOffset);
    const built = buildEthercatTree(
      payload,
      frame.eth.payloadOffset,
      frame.ecat,
      bytes.length,
    );
    ecatFrame = built.frameTree;
    ecatDatagrams = built.datagramTrees;
  }

  return {
    seq: frame.seq,
    interfaceId: frame.interfaceId,
    capturedLen: frame.capturedLen,
    origLen: frame.origLen,
    timestampRaw: frame.timestampRaw,
    tsResol: frame.tsResol,
    tsOffset: frame.tsOffset,
    intervalSec: frame.intervalSec,
    relativeSec: frame.relativeSec,
    eth,
    ecatFrame,
    ecatDatagrams,
    rawHex: { offset: 0, bytes },
    anomalies: frame.anomalies,
  };
}
