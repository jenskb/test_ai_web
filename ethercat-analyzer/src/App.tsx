import { useMemo, useState } from 'react';
import { useAnalyzer } from './hooks/useAnalyzer';
import { FileImport } from './components/FileImport';
import { Overview } from './components/Overview';
import { FilterBar, DEFAULT_FILTER, type FilterState } from './components/FilterBar';
import { PacketList } from './components/PacketList';
import { PacketDetail, type Highlight } from './components/PacketDetail';
import { TimeStats } from './components/TimeStats';
import { exportFramesCsv, exportDatagramsCsv } from './lib/exportCsv';
import type { FrameIndex } from './types';

function baseName(name: string): string {
  return name.replace(/\.[^.]+$/, '') || 'capture';
}

function applyFilter(frames: FrameIndex[], filter: FilterState): FrameIndex[] {
  return frames.filter((f) => {
    if (filter.command !== null) {
      if (!f.ecat || !f.ecat.datagrams.some((d) => d.cmdRaw === filter.command)) return false;
    }
    if (filter.wkc !== 'all') {
      if (!f.ecat) return false;
      if (filter.wkc === 'zero' && !f.ecat.datagrams.some((d) => d.wkc === 0)) return false;
      if (filter.wkc === 'nonzero' && !f.ecat.datagrams.some((d) => d.wkc !== 0)) return false;
    }
    if (filter.interfaceId !== null && f.interfaceId !== filter.interfaceId) return false;
    if (filter.seqMin !== '' && f.seq < Number(filter.seqMin)) return false;
    if (filter.seqMax !== '' && f.seq > Number(filter.seqMax)) return false;
    if (filter.anomalyOnly && f.anomalies.length === 0) return false;
    return true;
  });
}

export default function App() {
  const { status, progress, result, fileName, error, detail, parseFile, cancel, readFrame } =
    useAnalyzer();
  const [filter, setFilter] = useState<FilterState>(DEFAULT_FILTER);
  const [selectedSeq, setSelectedSeq] = useState<number | null>(null);
  const [highlight, setHighlight] = useState<Highlight | null>(null);

  const frames = result?.frames ?? [];

  const selectedFrame = useMemo(
    () => frames.find((f) => f.seq === selectedSeq) ?? null,
    [frames, selectedSeq],
  );

  const filtered = useMemo(() => applyFilter(frames, filter), [frames, filter]);

  const currentDetail = detail && selectedFrame && detail.seq === selectedFrame.seq ? detail : null;

  const handleFile = (file: File) => {
    setSelectedSeq(null);
    setHighlight(null);
    parseFile(file);
  };

  const handleSelect = (frame: FrameIndex) => {
    setSelectedSeq(frame.seq);
    setHighlight(null);
    readFrame(frame.seq, frame.fileOffset, frame.capturedLen);
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1>EtherCAT 抓包离线分析</h1>
        <p className="sub">
          PCAPNG 本地解析 · React + TypeScript + Vite + Web Worker · 完全离线，抓包内容不上传
        </p>
      </header>

      <FileImport
        status={status}
        fileName={fileName}
        progress={progress}
        error={error}
        warnings={result?.warnings ?? []}
        truncated={result?.truncated ?? false}
        onFile={handleFile}
        onCancel={cancel}
      />

      {status === 'done' && result && (
        <>
          <Overview stats={result.stats} />

          <FilterBar
            filter={filter}
            onChange={setFilter}
            commandOptions={result.stats.commandDistribution}
            interfaces={result.interfaces}
          />

          <div className="toolbar">
            <span>
              显示 {filtered.length} / {frames.length} 帧
            </span>
            <span className="spacer" />
            <button className="btn" onClick={() => exportFramesCsv(filtered, baseName(fileName))}>
              导出帧摘要 CSV
            </button>
            <button className="btn" onClick={() => exportDatagramsCsv(filtered, baseName(fileName))}>
              导出数据报详情 CSV
            </button>
          </div>

          <div className="split">
            <div className="split-left">
              <PacketList frames={filtered} selectedSeq={selectedSeq} onSelect={handleSelect} />
            </div>
            <div className="split-right">
              <PacketDetail
                detail={currentDetail}
                frame={selectedFrame}
                highlight={highlight}
                onHighlight={setHighlight}
              />
            </div>
          </div>

          <TimeStats intervalStats={result.intervalStats} />
        </>
      )}

      <footer className="app-footer">
        <p>
          本工具仅在浏览器本地解析文件，不依赖 CDN、远程字体或在线接口，不将抓包内容上传。
          抓包时间戳受采集设备与驱动影响，不能直接用于证明 EtherCAT DC 同步精度。
        </p>
      </footer>
    </div>
  );
}
