// 解析 Web Worker：分块读取文件、流式解析 PCAPNG、按需读取帧详情。
// 避免阻塞主线程，支持取消与资源释放。

import type {
  FrameIndex,
  InterfaceInfo,
  ParseResult,
  WorkerRequest,
  WorkerResponse,
} from '../types';
import { PcapngParser } from '../pcapng/parse';
import { dissectPacket } from '../analyze';
import { finalizeFrames } from '../stats/stats';
import { buildFrameDetail } from '../dissect';

const ctx = self as unknown as {
  postMessage(message: WorkerResponse): void;
  onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null;
};

const CHUNK_SIZE = 1 * 1024 * 1024; // 1 MiB

let cancelled = false;
let currentFile: File | null = null;
let currentFrames: FrameIndex[] | null = null;

ctx.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  if (msg.type === 'parse') {
    cancelled = false;
    void runParse(msg.file);
  } else if (msg.type === 'readFrame') {
    void runReadFrame(msg.seq, msg.fileOffset, msg.capturedLen);
  } else if (msg.type === 'cancel') {
    cancelled = true;
  }
};

async function runParse(file: File): Promise<void> {
  currentFile = file;
  const frames: FrameIndex[] = [];
  const interfaces: InterfaceInfo[] = [];
  const warnings: string[] = [];
  const interfaceNames = new Map<number, string>();

  const parser = new PcapngParser({
    onInterface: (info) => {
      interfaces.push(info);
      interfaceNames.set(info.id, info.name);
    },
    onPacket: (p) => frames.push(dissectPacket(p)),
    onWarning: (m) => warnings.push(m),
  });

  try {
    const fileSize = file.size;
    let offset = 0;
    while (offset < fileSize) {
      if (cancelled) {
        ctx.postMessage({ type: 'cancelled' });
        return;
      }
      const end = Math.min(offset + CHUNK_SIZE, fileSize);
      const chunk = new Uint8Array(await file.slice(offset, end).arrayBuffer());
      if (cancelled) {
        ctx.postMessage({ type: 'cancelled' });
        return;
      }
      parser.push(chunk, offset);
      offset = end;
      ctx.postMessage({
        type: 'progress',
        bytesRead: offset,
        fileSize,
        framesSoFar: frames.length,
      });
    }
    parser.finish();
    currentFrames = frames;

    const { stats, intervalStats } = finalizeFrames(frames, interfaceNames);
    const result: ParseResult = {
      interfaces,
      frames,
      sectionCount: parser.sectionCount,
      warnings,
      truncated: parser.isTruncated,
      stats,
      intervalStats,
      fileSize,
    };
    ctx.postMessage({ type: 'done', result });
  } catch (err) {
    ctx.postMessage({
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

async function runReadFrame(seq: number, fileOffset: number, capturedLen: number): Promise<void> {
  try {
    if (!currentFile || !currentFrames) return;
    const frame = currentFrames.find((f) => f.seq === seq);
    if (!frame) return;
    const bytes = new Uint8Array(
      await currentFile.slice(fileOffset, fileOffset + capturedLen).arrayBuffer(),
    );
    if (cancelled) return;
    const detail = buildFrameDetail(frame, bytes);
    ctx.postMessage({ type: 'frameDetail', seq, detail });
  } catch (err) {
    ctx.postMessage({
      type: 'error',
      message: '读取帧详情失败：' + (err instanceof Error ? err.message : String(err)),
    });
  }
}
