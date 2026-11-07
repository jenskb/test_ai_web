// 解析 Worker：在后台线程解析 PCAPNG，避免阻塞界面。
// 协议：接收 { type:"parse", id, buffer, fileName }，转发进度，
//       完成后返回 { type:"done", id, result, stats, buffer }（buffer 零拷贝转回）。

import { parseBuffer, CancelledError } from "../core/parse";
import { computeStats } from "../stats/compute";
import type { ParseResult } from "../types";
import type { StatsResult } from "../stats/compute";

interface ParseRequest {
  type: "parse";
  id: number;
  buffer: ArrayBuffer;
  fileName: string;
}

interface CancelRequest {
  type: "cancel";
  id: number;
}

let cancelled = false;

self.onmessage = (event: MessageEvent<ParseRequest | CancelRequest>) => {
  const msg = event.data;

  if (msg.type === "cancel") {
    cancelled = true;
    return;
  }

  if (msg.type === "parse") {
    const { id, buffer, fileName } = msg;
    cancelled = false;

    try {
      // 进度节流。
      let lastReport = 0;
      const result: ParseResult = parseBuffer(buffer, {
        fileName,
        onProgress: (offset, total) => {
          const now = Date.now();
          if (now - lastReport >= 50) {
            lastReport = now;
            (self as unknown as Worker).postMessage({
              type: "progress",
              id,
              offset,
              total,
            });
          }
        },
        shouldCancel: () => cancelled,
      });

      const stats: StatsResult = computeStats(
        result.packets,
        result.ethercatFrames,
        result.warnings,
      );

      (self as unknown as Worker).postMessage(
        { type: "done", id, result, stats, buffer },
        { transfer: [buffer] },
      );
    } catch (err) {
      if (err instanceof CancelledError) {
        (self as unknown as Worker).postMessage({ type: "cancelled", id });
      } else {
        const message = err instanceof Error ? err.message : String(err);
        (self as unknown as Worker).postMessage({ type: "error", id, message });
      }
    }
  }
};
