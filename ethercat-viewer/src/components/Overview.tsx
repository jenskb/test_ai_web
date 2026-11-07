import type { ParseResult } from "../types";
import type { StatsResult } from "../stats/compute";
import { formatRelative } from "../utils/format";

interface Props {
  result: ParseResult;
  stats: StatsResult;
  activeCommand: number | null;
  onSelectCommand: (cmd: number | null) => void;
}

export function Overview({ result, stats, activeCommand, onSelectCommand }: Props) {
  return (
    <section className="section">
      <div className="section-title">概览</div>
      <div className="section-body">
        <div className="stat-grid">
          <div className="stat">
            <div className="label">捕获报文总数</div>
            <div className="value">{stats.totalPackets}</div>
          </div>
          <div className="stat">
            <div className="label">EtherCAT 帧数</div>
            <div className="value">{stats.ethercatFrames}</div>
          </div>
          <div className="stat">
            <div className="label">数据报总数</div>
            <div className="value">{stats.datagrams}</div>
          </div>
          <div className="stat">
            <div className="label">解析异常</div>
            <div className={`value ${stats.anomalyCount > 0 ? "warn" : ""}`}>
              {stats.anomalyCount}
            </div>
          </div>
          <div className="stat">
            <div className="label">告警 / 错误</div>
            <div className="value">
              {stats.warningCount}
              <span className="muted"> / </span>
              <span className={stats.errorCount > 0 ? "error" : ""}>
                {stats.errorCount}
              </span>
            </div>
          </div>
          <div className="stat">
            <div className="label">时间范围（带时间戳 EtherCAT 帧）</div>
            <div className="value" style={{ fontSize: 13 }}>
              {stats.timeRange
                ? `${formatRelative(stats.timeRange.start)} → ${formatRelative(
                    stats.timeRange.end,
                  )}`
                : "—"}
            </div>
          </div>
          <div className="stat">
            <div className="label">接口数量</div>
            <div className="value">{result.interfaces.length}</div>
          </div>
          <div className="stat">
            <div className="label">Section 数量</div>
            <div className="value">{result.sections}</div>
          </div>
        </div>

        <div style={{ marginTop: 10, color: "var(--text-dim)" }}>
          命令分布（点击筛选）：
        </div>
        <div className="command-chips">
          <span
            className={`chip ${activeCommand === null ? "active" : ""}`}
            onClick={() => onSelectCommand(null)}
          >
            全部 <span className="cnt">{stats.datagrams}</span>
          </span>
          {stats.commandDistribution.map((c) => (
            <span
              key={c.cmd}
              className={`chip ${activeCommand === c.cmd ? "active" : ""}`}
              onClick={() => onSelectCommand(activeCommand === c.cmd ? null : c.cmd)}
            >
              {c.cmdName} <span className="cnt">{c.count}</span>
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
