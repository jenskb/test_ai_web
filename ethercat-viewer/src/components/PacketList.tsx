import { useMemo, useRef, useState, useCallback } from "react";
import type { EtherCATFrame, ParseResult } from "../types";
import { formatRelative } from "../utils/format";
import { frameHasAnomaly, type Filters } from "../utils/filter";

const ROW_HEIGHT = 28;
const VIEWPORT = 360;
const OVERSCAN = 8;

interface Props {
  result: ParseResult;
  frames: EtherCATFrame[];
  total: number;
  filters: Filters;
  onFilters: (f: Filters) => void;
  selectedIndex: number | null;
  onSelect: (index: number | null) => void;
}

export function PacketList({
  result,
  frames,
  total,
  filters,
  onFilters,
  selectedIndex,
  onSelect,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);

  // 为表头预留一行高度，避免表头遮挡首行。
  const totalHeight = frames.length * ROW_HEIGHT + ROW_HEIGHT;
  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const endIndex = Math.min(
    frames.length,
    Math.ceil((scrollTop + VIEWPORT) / ROW_HEIGHT) + OVERSCAN,
  );
  const visible = frames.slice(startIndex, endIndex);

  const set = useCallback(
    (patch: Partial<Filters>) => onFilters({ ...filters, ...patch }),
    [filters, onFilters],
  );

  const onScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

  const interfaceOptions = useMemo(() => {
    const seen = new Set<number>();
    return result.packets
      .map((p) => p.interfaceId)
      .filter((id) => {
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      });
  }, [result.packets]);

  return (
    <section className="section">
      <div className="section-title">
        报文列表
        <span className="muted">
          {frames.length} / {total} 条 EtherCAT 帧
        </span>
      </div>
      <div className="section-body" style={{ padding: "8px 12px" }}>
        <div className="filters" style={{ marginBottom: 8 }}>
          <label>
            接口
            <select
              value={filters.interfaceId ?? ""}
              onChange={(e) =>
                set({ interfaceId: e.target.value === "" ? null : Number(e.target.value) })
              }
            >
              <option value="">全部</option>
              {interfaceOptions.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          </label>
          <label>
            帧序号
            <input
              type="number"
              placeholder="起"
              value={filters.frameRangeMin}
              onChange={(e) => set({ frameRangeMin: e.target.value })}
            />
            <input
              type="number"
              placeholder="止"
              value={filters.frameRangeMax}
              onChange={(e) => set({ frameRangeMax: e.target.value })}
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={filters.wkcZero}
              onChange={(e) => set({ wkcZero: e.target.checked })}
            />
            WKC=0
          </label>
          <label>
            <input
              type="checkbox"
              checked={filters.anomalyOnly}
              onChange={(e) => set({ anomalyOnly: e.target.checked })}
            />
            仅异常
          </label>
        </div>

        <div className="vlist" ref={scrollRef} onScroll={onScroll}>
          <div className="vlist-inner" style={{ height: totalHeight }}>
            <div className="vrow header" style={{ top: 0 }}>
              <span>帧序号</span>
              <span>接口</span>
              <span>相对时间</span>
              <span>间隔</span>
              <span>源 → 目的 MAC</span>
              <span>帧长</span>
              <span>数据报</span>
              <span>命令</span>
              <span>WKC</span>
              <span>异常</span>
            </div>
            {visible.map((f, i) => {
              const idx = startIndex + i;
              const pkt = result.packets[f.packetIndex]!;
              const selected = selectedIndex === f.packetIndex;
              const anomalies = frameHasAnomaly(f);
              return (
                <div
                  key={f.packetIndex}
                  className={`vrow ${selected ? "selected" : ""}`}
                  style={{ top: (idx + 1) * ROW_HEIGHT }}
                  onClick={() => onSelect(f.packetIndex)}
                >
                  <span>{pkt.frameIndex}</span>
                  <span>{pkt.interfaceId}</span>
                  <span>{f.relSeconds === null ? "—" : formatRelative(f.relSeconds)}</span>
                  <span
                    className={
                      f.timeAnomaly === "backward"
                        ? "time-back"
                        : f.timeAnomaly === "same"
                          ? "anomaly"
                          : ""
                    }
                  >
                    {f.prevIntervalSeconds === null
                      ? "—"
                      : formatRelative(f.prevIntervalSeconds)}
                  </span>
                  <span>
                    {f.srcMac} → {f.dstMac}
                  </span>
                  <span>{pkt.capturedLength}</span>
                  <span>{f.datagrams.length}</span>
                  <span>{f.datagrams.map((d) => d.cmdName).join(",")}</span>
                  <span className={f.datagrams.some((d) => d.wkc === 0) ? "wkc0" : ""}>
                    {f.datagrams.map((d) => d.wkc).join(",")}
                  </span>
                  <span className={anomalies ? "anomaly" : ""}>{anomalies ? "⚠" : ""}</span>
                </div>
              );
            })}
          </div>
        </div>
        {frames.length === 0 && (
          <div className="muted" style={{ padding: "12px 0" }}>
            没有符合条件的帧。
          </div>
        )}
      </div>
    </section>
  );
}
