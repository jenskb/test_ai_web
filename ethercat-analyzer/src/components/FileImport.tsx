import { useCallback, useRef, useState } from 'react';
import type { AnalyzerStatus, Progress } from '../hooks/useAnalyzer';
import { formatBytes, formatCount } from '../lib/format';

interface Props {
  status: AnalyzerStatus;
  fileName: string;
  progress: Progress;
  error: string;
  warnings: string[];
  truncated: boolean;
  onFile: (file: File) => void;
  onCancel: () => void;
}

export function FileImport({ status, fileName, progress, error, warnings, truncated, onFile, onCancel }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const handleFiles = useCallback(
    (files: FileList | null) => {
      const file = files?.[0];
      if (file) onFile(file);
    },
    [onFile],
  );

  const percent = progress.fileSize > 0 ? (progress.bytesRead / progress.fileSize) * 100 : 0;

  return (
    <section className="card">
      <h2>1. 文件导入</h2>
      <div
        className={`dropzone ${dragOver ? 'drag-over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          handleFiles(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".pcapng,.pcap,.cap"
          style={{ display: 'none' }}
          onChange={(e) => {
            handleFiles(e.target.files);
            e.target.value = '';
          }}
        />
        <p>选择或拖放 PCAPNG 文件到此处（在浏览器本地解析，不上传）</p>
      </div>

      {fileName && (
        <div className="file-meta">
          <span className="file-name">{fileName}</span>
          <span className="file-size">{formatBytes(progress.fileSize)}</span>
        </div>
      )}

      {status === 'parsing' && (
        <div className="progress-area">
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: `${percent.toFixed(1)}%` }} />
          </div>
          <div className="progress-text">
            {percent.toFixed(1)}%（{formatBytes(progress.bytesRead)} / {formatBytes(progress.fileSize)}，已解析 {formatCount(progress.framesSoFar)} 帧）
          </div>
          <button className="btn" onClick={onCancel}>取消解析</button>
        </div>
      )}

      {status === 'error' && <div className="alert-error">解析失败：{error}</div>}
      {status === 'cancelled' && <div className="alert-warn">解析已取消。</div>}
      {truncated && <div className="alert-warn">文件不完整或被截断，部分报文未解析。</div>}
      {warnings.length > 0 && (
        <div className="warnings">
          <div className="warnings-title">警告（{warnings.length}）</div>
          <ul>
            {warnings.slice(0, 20).map((w, i) => (
              <li key={i}>{w}</li>
            ))}
            {warnings.length > 20 && <li>… 共 {warnings.length} 条，仅显示前 20 条</li>}
          </ul>
        </div>
      )}
    </section>
  );
}
