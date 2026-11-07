// 顶层编排：PCAPNG → 以太网 → EtherCAT，产出完整 ParseResult。
// 该函数被 Web Worker 与测试共用。

import type { EtherCATFrame, ParseResult } from "../types";
import { parsePcapng, LINKTYPE_ETHERNET, CancelledError } from "../pcapng/parse";
import { parseEthernet } from "../ethernet/parse";
import { parseEtherCAT } from "../ethercat/parse";
import { enrichTime } from "./time";

export interface ParseBufferOptions {
  fileName?: string;
  onProgress?: (offset: number, total: number) => void;
  shouldCancel?: () => boolean;
}

export { CancelledError };

/**
 * 解析整个 PCAPNG 文件。
 * 内存策略：仅保留一份原始 ArrayBuffer，报文内容按偏移引用、不复制；
 * 十六进制文本按需生成。
 */
export function parseBuffer(
  buffer: ArrayBuffer,
  options: ParseBufferOptions = {},
): ParseResult {
  const start = performance.now();

  const pcap = parsePcapng(buffer, {
    onProgress: options.onProgress,
    shouldCancel: options.shouldCancel,
  });

  const { interfaces, packets, warnings } = pcap;
  const bytes = new Uint8Array(buffer);

  const ethercatFrames: EtherCATFrame[] = [];

  for (const pkt of packets) {
    if (options.shouldCancel?.()) {
      throw new CancelledError();
    }
    // 首版仅解析 Ethernet；其它 LinkType 在 parsePcapng 已告警。
    if (pkt.linkType !== LINKTYPE_ETHERNET) continue;

    const eth = parseEthernet(bytes, pkt.dataOffset, pkt.dataLength);
    if (!eth.isEtherCAT) continue;

    const frame = parseEtherCAT(
      bytes,
      pkt.dataOffset,
      pkt.dataLength,
      pkt.frameIndex - 1,
      eth,
    );
    ethercatFrames.push(frame);
  }

  enrichTime(packets, interfaces, ethercatFrames);

  const elapsedMs = performance.now() - start;

  return {
    fileName: options.fileName ?? "",
    fileSize: buffer.byteLength,
    interfaces,
    packets,
    ethercatFrames,
    warnings,
    sections: pcap.sections,
    elapsedMs,
  };
}
