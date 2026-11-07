// 解析生命周期管理：启动/进度/取消/结果。
// 文件读取在主线程完成，解析在 Web Worker 中完成。
// 取消通过终止 Worker 实现，可真正中断解析并释放资源；重新导入会先终止旧任务。

import { useCallback, useEffect, useRef, useState } from "react";
import type { ParseResult } from "../types";
import type { StatsResult } from "../stats/compute";

export type ParseStatus =
  | "idle"
  | "reading"
  | "parsing"
  | "done"
  | "error"
  | "cancelled";

export interface ParserState {
  status: ParseStatus;
  progress: { offset: number; total: number } | null;
  result: ParseResult | null;
  stats: StatsResult | null;
  buffer: ArrayBuffer | null;
  error: string | null;
}

interface WorkerDone {
  type: "done";
  id: number;
  result: ParseResult;
  stats: StatsResult;
  buffer: ArrayBuffer;
}

export function useParser() {
  const workerRef = useRef<Worker | null>(null);
  const idRef = useRef(0);
  const [state, setState] = useState<ParserState>({
    status: "idle",
    progress: null,
    result: null,
    stats: null,
    buffer: null,
    error: null,
  });

  // 组件卸载时清理 Worker。
  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  const terminate = useCallback(() => {
    workerRef.current?.terminate();
    workerRef.current = null;
  }, []);

  const parse = useCallback(
    (file: File) => {
      const id = ++idRef.current;
      // 取消进行中的旧任务，避免旧结果污染新界面。
      terminate();

      setState({
        status: "reading",
        progress: null,
        result: null,
        stats: null,
        buffer: null,
        error: null,
      });

      const worker = new Worker(new URL("../worker/parseWorker.ts", import.meta.url), {
        type: "module",
      });
      workerRef.current = worker;

      const onMessage = (event: MessageEvent) => {
        const msg = event.data as
          | { type: "progress"; id: number; offset: number; total: number }
          | WorkerDone
          | { type: "error"; id: number; message: string }
          | { type: "cancelled"; id: number };

        if (msg.id !== id) return;

        if (msg.type === "progress") {
          setState((s) =>
            s.status === "reading" || s.status === "parsing"
              ? { ...s, status: "parsing", progress: { offset: msg.offset, total: msg.total } }
              : s,
          );
        } else if (msg.type === "done") {
          setState({
            status: "done",
            progress: { offset: msg.result.fileSize, total: msg.result.fileSize },
            result: msg.result,
            stats: msg.stats,
            buffer: msg.buffer,
            error: null,
          });
        } else if (msg.type === "error") {
          setState((s) => ({ ...s, status: "error", error: msg.message }));
        } else if (msg.type === "cancelled") {
          setState((s) => ({ ...s, status: "cancelled" }));
        }
      };

      worker.addEventListener("message", onMessage);

      file
        .arrayBuffer()
        .then((buffer) => {
          worker.postMessage({ type: "parse", id, buffer, fileName: file.name }, [
            buffer,
          ]);
        })
        .catch((err) => {
          setState((s) => ({
            ...s,
            status: "error",
            error: err instanceof Error ? err.message : String(err),
          }));
        });
    },
    [terminate],
  );

  const cancel = useCallback(() => {
    // 终止 Worker，真正中止解析并释放资源。
    terminate();
    idRef.current += 1; // 使在途消息失效
    setState((s) =>
      s.status === "reading" || s.status === "parsing"
        ? { ...s, status: "cancelled", progress: null }
        : s,
    );
  }, [terminate]);

  return { state, parse, cancel };
}
