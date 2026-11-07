// 解析 Worker 与主线程交互的 Hook：负责 worker 生命周期、进度、取消与详情读取。

import { useCallback, useEffect, useRef, useState } from 'react';
import type { FrameDetail, ParseResult, WorkerResponse } from '../types';

export type AnalyzerStatus = 'idle' | 'parsing' | 'done' | 'error' | 'cancelled';

export interface Progress {
  bytesRead: number;
  fileSize: number;
  framesSoFar: number;
}

export interface UseAnalyzer {
  status: AnalyzerStatus;
  progress: Progress;
  result: ParseResult | null;
  fileName: string;
  error: string;
  detail: FrameDetail | null;
  parseFile: (file: File) => void;
  cancel: () => void;
  readFrame: (seq: number, fileOffset: number, capturedLen: number) => void;
}

export function useAnalyzer(): UseAnalyzer {
  const workerRef = useRef<Worker | null>(null);
  const [status, setStatus] = useState<AnalyzerStatus>('idle');
  const [progress, setProgress] = useState<Progress>({ bytesRead: 0, fileSize: 0, framesSoFar: 0 });
  const [result, setResult] = useState<ParseResult | null>(null);
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState('');
  const [detail, setDetail] = useState<FrameDetail | null>(null);

  const parseFile = useCallback((file: File) => {
    // 取消旧任务，释放资源，避免旧结果污染新界面。
    workerRef.current?.terminate();
    workerRef.current = null;

    setResult(null);
    setDetail(null);
    setError('');
    setFileName(file.name);
    setStatus('parsing');
    setProgress({ bytesRead: 0, fileSize: file.size, framesSoFar: 0 });

    const worker = new Worker(new URL('../worker/parseWorker.ts', import.meta.url), {
      type: 'module',
    });
    workerRef.current = worker;

    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data;
      switch (msg.type) {
        case 'progress':
          setProgress({ bytesRead: msg.bytesRead, fileSize: msg.fileSize, framesSoFar: msg.framesSoFar });
          break;
        case 'done':
          setResult(msg.result);
          setStatus('done');
          break;
        case 'error':
          setError(msg.message);
          setStatus('error');
          break;
        case 'cancelled':
          setStatus('cancelled');
          break;
        case 'frameDetail':
          setDetail(msg.detail);
          break;
      }
    };
    worker.onerror = (e) => {
      setError(e.message || 'Worker 异常');
      setStatus('error');
    };

    worker.postMessage({ type: 'parse', file });
  }, []);

  const cancel = useCallback(() => {
    workerRef.current?.terminate();
    workerRef.current = null;
    setStatus('cancelled');
  }, []);

  const readFrame = useCallback((seq: number, fileOffset: number, capturedLen: number) => {
    workerRef.current?.postMessage({ type: 'readFrame', seq, fileOffset, capturedLen });
  }, []);

  useEffect(() => {
    return () => workerRef.current?.terminate();
  }, []);

  return { status, progress, result, fileName, error, detail, parseFile, cancel, readFrame };
}
