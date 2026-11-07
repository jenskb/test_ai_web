// 便捷入口：一次性解析完整 PCAPNG 缓冲区（用于测试与非分块场景）。

import type { FrameIndex, InterfaceInfo, ParseResult } from './types';
import { PcapngParser } from './pcapng/parse';
import { dissectPacket } from './analyze';
import { finalizeFrames } from './stats/stats';

export function parsePcapngBuffer(buffer: Uint8Array): ParseResult {
  const frames: FrameIndex[] = [];
  const interfaces: InterfaceInfo[] = [];
  const warnings: string[] = [];
  const interfaceNames = new Map<number, string>();

  const parser = new PcapngParser({
    onInterface: (i) => {
      interfaces.push(i);
      interfaceNames.set(i.id, i.name);
    },
    onPacket: (p) => frames.push(dissectPacket(p)),
    onWarning: (m) => warnings.push(m),
  });

  parser.push(buffer, 0);
  parser.finish();

  const { stats, intervalStats } = finalizeFrames(frames, interfaceNames);
  return {
    interfaces,
    frames,
    sectionCount: parser.sectionCount,
    warnings,
    truncated: parser.isTruncated,
    stats,
    intervalStats,
    fileSize: buffer.length,
  };
}
