import { useCallback, useRef, useState } from "react";
import type { ParserState } from "../hooks/useParser";
import { formatBytes } from "../utils/format";

interface Props {
  state: ParserState;
  onFile: (file: File) => void;
  onCancel: () => void;
}

export function FileImport({ state, onFile, onCancel }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const handleFiles = useCallback(
    (files: FileList | null) => {
      const file = files?.[0];
      if (file) onFile(file);
    },
    [onFile],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      handleFiles(e.dataTransfer.files);
    },
    [handleFiles],
  );

  const busy = state.status === "reading" || state.status === "parsing";
  const pct =
    state.progress && state.progress.total > 0
      ? Math.min(100, (state.progress.offset / state.progress.total) * 100)
      : 0;

  return (
    <section className="section">
      <div className="section-title">文件导入</div>
      <div className="section-body">
        <div
          className={`dropzone ${dragging ? "dragging" : ""}`}
          onClick={() => !busy && inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <div className="big">选择或拖放 PCAPNG 文件</div>
          <div className="muted">文件在浏览器本地解析，不会上传。</div>
          <input
            ref={inputRef}
            type="file"
            accept=".pcapng,.pcap,application/octet-stream"
            style={{ display: "none" }}
            onChange={(e) => {
              handleFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </div>

        {busy && (
          <div>
            <div className="file-meta">
              <span className="muted">
                {state.status === "reading" ? "读取中…" : "解析中…"}
              </span>
              <span className="muted">
                {state.progress
                  ? `${formatBytes(state.progress.offset)} / ${formatBytes(
                      state.progress.total,
                    )}`
                  : ""}
              </span>
              <span className="spacer" />
              <button className="btn" onClick={onCancel}>
                取消解析
              </button>
            </div>
            <div className="progress-wrap">
              <div className="progress-bar" style={{ width: `${pct}%` }} />
            </div>
          </div>
        )}

        {state.status === "done" && state.result && (
          <div className="file-meta">
            <span className="name">{state.result.fileName}</span>
            <span className="muted">{formatBytes(state.result.fileSize)}</span>
            <span className="muted">
              {state.result.packets.length} 条报文 ·{" "}
              {state.result.ethercatFrames.length} 条 EtherCAT 帧
            </span>
            <span className="muted">解析耗时 {state.result.elapsedMs.toFixed(0)} ms</span>
            <span className="spacer" />
            <span className="muted">可重新选择文件覆盖</span>
          </div>
        )}

        {state.status === "error" && (
          <div className="file-meta">
            <span style={{ color: "var(--error)" }}>解析失败：{state.error}</span>
          </div>
        )}

        {state.status === "cancelled" && (
          <div className="file-meta">
            <span className="muted">解析已取消。可重新选择文件。</span>
          </div>
        )}
      </div>
    </section>
  );
}
