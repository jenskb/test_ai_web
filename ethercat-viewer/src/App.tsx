import { useMemo, useState } from "react";
import { useParser } from "./hooks/useParser";
import { FileImport } from "./components/FileImport";
import { Overview } from "./components/Overview";
import { PacketList } from "./components/PacketList";
import { ProtocolDetail } from "./components/ProtocolDetail";
import { TimeStats } from "./components/TimeStats";
import { applyFilters, type Filters } from "./utils/filter";
import { toCsv, downloadText } from "./utils/csv";
import type { EtherCATFrame, ParseResult } from "./types";

const DEFAULT_FILTERS: Filters = {
  command: null,
  wkcZero: false,
  interfaceId: null,
  frameRangeMin: "",
  frameRangeMax: "",
  anomalyOnly: false,
};

export function App() {
  const { state, parse, cancel } = useParser();
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  const result = state.result;
  const stats = state.stats;

  const filtered = useMemo(
    () => (result ? applyFilters(result, filters) : []),
    [result, filters],
  );

  const selectedFrame = useMemo(() => {
    if (!result || selectedIndex === null) return null;
    return result.ethercatFrames.find((f) => f.packetIndex === selectedIndex) ?? null;
  }, [result, selectedIndex]);

  const onSelectCommand = (cmd: number | null) => {
    setFilters((f) => ({ ...f, command: cmd }));
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1>EtherCAT 抓包分析</h1>
        <span className="subtitle">离线 PCAPNG 解析 · 本地运行 · 不上传</span>
      </header>

      <div className="app-body">
        <div className="main-scroll">
          <FileImport state={state} onFile={parse} onCancel={cancel} />

          {result && stats && (
            <>
              <Overview
                result={result}
                stats={stats}
                activeCommand={filters.command}
                onSelectCommand={onSelectCommand}
              />

              <PacketList
                result={result}
                frames={filtered}
                total={result.ethercatFrames.length}
                filters={filters}
                onFilters={setFilters}
                selectedIndex={selectedIndex}
                onSelect={setSelectedIndex}
              />

              <section className="section">
                <div className="section-title">
                  导出
                  <span className="muted">筛选后的结果（{filtered.length} 条帧）</span>
                </div>
                <div className="section-body">
                  <button className="btn" onClick={() => exportDatagrams(result, filtered)}>
                    导出数据报详情 CSV
                  </button>{" "}
                  <button className="btn" onClick={() => exportFrames(result, filtered)}>
                    导出帧摘要 CSV
                  </button>
                  <span className="muted" style={{ marginLeft: 8 }}>
                    UTF-8 编码，兼容 Windows Excel。
                  </span>
                </div>
              </section>

              {selectedFrame && (
                <ProtocolDetail
                  buffer={state.buffer!}
                  frame={selectedFrame}
                  pkt={result.packets[selectedFrame.packetIndex]!}
                />
              )}

              <TimeStats stats={stats} interfaces={result.interfaces} />

              <section className="section">
                <div className="section-title">
                  告警与错误（{result.warnings.length}）
                </div>
                <div className="section-body">
                  {result.warnings.length === 0 ? (
                    <div className="muted">无。</div>
                  ) : (
                    <div className="warnings">
                      {result.warnings.map((w, i) => (
                        <div key={i} className={`w ${w.severity}`}>
                          [{w.severity === "error" ? "错误" : "告警"}]{" "}
                          {w.offset !== undefined ? `@0x${w.offset.toString(16)} ` : ""}
                          {w.message}
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="notice" style={{ marginTop: 12 }}>
                    说明：WKC 为 0 仅表示“需检查”，不能自动判定通信故障；未知拓扑/配置时
                    不计算期望 WKC；不把原始 PDO 字节臆测为位置、速度或控制字。
                  </div>
                </div>
              </section>
            </>
          )}

          {state.status === "idle" && (
            <div className="empty">
              导入一个 Wireshark 捕获的 PCAPNG 文件开始分析。
              <br />
              示例：twincat.pcapng（文件通过浏览器选择，不从本机路径直接读取）。
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function exportDatagrams(result: ParseResult, frames: EtherCATFrame[]): void {
  const header = [
    "帧序号",
    "数据报序号",
    "命令",
    "命令码",
    "Index",
    "ADP",
    "ADO",
    "逻辑地址",
    "数据长度",
    "IRQ",
    "WKC",
    "异常",
  ];
  const rows: (string | number)[][] = [];
  for (const f of frames) {
    const pkt = result.packets[f.packetIndex]!;
    f.datagrams.forEach((d) => {
      rows.push([
        pkt.frameIndex,
        d.indexInFrame,
        d.cmdName,
        d.cmd,
        d.idx,
        d.adp !== undefined ? `0x${d.adp.toString(16)}` : "",
        d.ado !== undefined ? `0x${d.ado.toString(16)}` : "",
        d.logicalAddr !== undefined ? `0x${d.logicalAddr.toString(16)}` : "",
        d.length,
        `0x${d.irq.toString(16)}`,
        d.wkc,
        d.anomalies.map((a) => a.message).join("; "),
      ]);
    });
  }
  downloadText("ethercat-datagrams.csv", toCsv(header, rows));
}

function exportFrames(result: ParseResult, frames: EtherCATFrame[]): void {
  const header = [
    "帧序号",
    "数据报序号",
    "接口",
    "相对时间(s)",
    "间隔(s)",
    "源MAC",
    "目的MAC",
    "帧长",
    "命令",
    "WKC",
    "异常",
  ];
  const rows: (string | number)[][] = [];
  for (const f of frames) {
    const pkt = result.packets[f.packetIndex]!;
    f.datagrams.forEach((d) => {
      rows.push([
        pkt.frameIndex,
        d.indexInFrame,
        pkt.interfaceId,
        f.relSeconds ?? "",
        f.prevIntervalSeconds ?? "",
        f.srcMac,
        f.dstMac,
        pkt.capturedLength,
        d.cmdName,
        d.wkc,
        d.anomalies.map((a) => a.message).join("; "),
      ]);
    });
  }
  downloadText("ethercat-frames.csv", toCsv(header, rows));
}
