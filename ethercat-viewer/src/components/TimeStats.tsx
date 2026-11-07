import { useMemo, useState } from "react";
import type { InterfaceInfo } from "../types";
import type { StatsResult } from "../stats/compute";
import { formatInterval } from "../utils/format";

interface Props {
  stats: StatsResult;
  interfaces: InterfaceInfo[];
}

export function TimeStats({ stats, interfaces }: Props) {
  const [mode, setMode] = useState<"curve" | "histogram">("curve");

  const ifaceName = (id: number) => {
    const info = interfaces.find((i) => i.id === id);
    return info ? `接口 ${id}` : `接口 ${id}`;
  };

  return (
    <section className="section">
      <div className="section-title">
        时间统计
        <span className="muted">（称为“捕获帧间隔”，非总线周期）</span>
        <span className="spacer" />
        <button
          className={`btn ${mode === "curve" ? "primary" : ""}`}
          onClick={() => setMode("curve")}
        >
          间隔曲线
        </button>
        <button
          className={`btn ${mode === "histogram" ? "primary" : ""}`}
          onClick={() => setMode("histogram")}
        >
          分布
        </button>
      </div>
      <div className="section-body">
        {stats.intervalStats.length === 0 ? (
          <div className="muted">
            没有可用于时间统计的数据（需要至少两条同接口、带时间戳的 EtherCAT 帧）。
          </div>
        ) : (
          stats.intervalStats.map((s) => (
            <div key={s.interfaceId} style={{ marginBottom: 16 }}>
              <div className="interval-summary">
                <span className="item">
                  {ifaceName(s.interfaceId)}：<b>{s.frameCount}</b> 帧 ·{" "}
                  <b>{s.sampleCount}</b> 个间隔
                </span>
                <span className="item">
                  最小 <b>{formatInterval(s.min)}</b>
                </span>
                <span className="item">
                  最大 <b>{formatInterval(s.max)}</b>
                </span>
                <span className="item">
                  均值 <b>{formatInterval(s.mean)}</b>
                </span>
                <span className="item">
                  标准差 <b>{formatInterval(s.stddev)}</b>
                </span>
                <span className="item" style={s.backwardCount > 0 ? { color: "var(--error)" } : undefined}>
                  时间戳倒退 <b>{s.backwardCount}</b>
                </span>
                <span className="item" style={s.zeroCount > 0 ? { color: "var(--warn)" } : undefined}>
                  相同时间戳 <b>{s.zeroCount}</b>
                </span>
              </div>
              {mode === "curve" ? (
                <LineChart data={s.series} />
              ) : (
                <Histogram data={s.series} />
              )}
            </div>
          ))
        )}

        <div className="notice">
          注意：抓包时间戳受采集设备与驱动影响，不能直接用于证明 EtherCAT DC（分布式时钟）同步精度。
          帧间隔增大不代表总线丢帧，可能由采集侧丢包导致。
        </div>
      </div>
    </section>
  );
}

function LineChart({ data }: { data: { x: number; y: number }[] }) {
  const { path, viewBox } = useMemo(() => {
    const W = 800;
    const H = 220;
    const pad = 12;
    if (data.length === 0) return { path: "", viewBox: `0 0 ${W} ${H}` };
    const ys = data.map((d) => d.y);
    let min = Math.min(...ys);
    let max = Math.max(...ys);
    if (min === max) {
      min = min - 1;
      max = max + 1;
    }
    const xs = data.map((d) => d.x);
    const xMin = Math.min(...xs);
    const xMax = Math.max(...xs);
    const sx = (x: number) =>
      pad + ((x - xMin) / Math.max(1, xMax - xMin)) * (W - 2 * pad);
    const sy = (y: number) =>
      H - pad - ((y - min) / (max - min)) * (H - 2 * pad);
    const pts = data.map((d, i) => `${i === 0 ? "M" : "L"}${sx(d.x).toFixed(1)},${sy(d.y).toFixed(1)}`);
    return { path: pts.join(" "), viewBox: `0 0 ${W} ${H}` };
  }, [data]);

  return (
    <div className="chart">
      <svg viewBox={viewBox} style={{ width: "100%", height: 220, display: "block" }}>
        <path d={path} fill="none" stroke="var(--accent)" strokeWidth="1.5" />
      </svg>
    </div>
  );
}

function Histogram({ data }: { data: { x: number; y: number }[] }) {
  const { bars, viewBox, maxCount } = useMemo(() => {
    const W = 800;
    const H = 180;
    if (data.length === 0) return { bars: [], viewBox: `0 0 ${W} ${H}`, maxCount: 1 };
    const ys = data.map((d) => d.y).filter((y) => y > 0);
    if (ys.length === 0) return { bars: [], viewBox: `0 0 ${W} ${H}`, maxCount: 1 };
    let min = Math.min(...ys);
    let max = Math.max(...ys);
    if (min === max) max = min + 1e-9;
    const BINS = 50;
    const logMin = Math.log10(min);
    const logMax = Math.log10(max);
    const counts = new Array<number>(BINS).fill(0);
    for (const y of ys) {
      const t = (Math.log10(y) - logMin) / (logMax - logMin);
      const idx = Math.min(BINS - 1, Math.max(0, Math.floor(t * BINS)));
      counts[idx] = (counts[idx] ?? 0) + 1;
    }
    const maxCount = Math.max(...counts);
    const barW = W / BINS;
    const bars = counts.map((c, i) => ({
      x: i * barW,
      h: (c / maxCount) * (H - 10),
      c,
    }));
    return { bars, viewBox: `0 0 ${W} ${H}`, maxCount };
  }, [data]);

  return (
    <div className="chart">
      <svg viewBox={viewBox} style={{ width: "100%", height: 180, display: "block" }}>
        {bars.map((b, i) => (
          <rect
            key={i}
            x={b.x + 1}
            y={180 - 10 - b.h}
            width={Math.max(1, 800 / 50 - 2)}
            height={b.h}
            fill="var(--accent-dim)"
          />
        ))}
      </svg>
      <div className="muted" style={{ padding: "0 8px 8px" }}>
        对数坐标直方图（{data.length} 个间隔，最高柱 {maxCount} 次）。
      </div>
    </div>
  );
}
