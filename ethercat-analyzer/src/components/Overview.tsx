import type { CaptureStats } from '../types';
import { formatCount } from '../lib/format';
import { formatDuration } from '../lib/time';

interface Props {
  stats: CaptureStats;
}

export function Overview({ stats }: Props) {
  const rangeText =
    stats.timeRangeStartSec !== null && stats.timeRangeEndSec !== null
      ? `${formatDuration(stats.timeRangeStartSec)} ~ ${formatDuration(stats.timeRangeEndSec)}（跨度 ${formatDuration(
          stats.timeRangeEndSec - stats.timeRangeStartSec,
        )}）`
      : '—（无时间戳的 EtherCAT 帧）';

  const items: { label: string; value: string; hint?: string }[] = [
    { label: '捕获报文总数', value: formatCount(stats.totalFrames) },
    { label: 'EtherCAT 帧数', value: formatCount(stats.ethercatFrames) },
    { label: '数据报总数', value: formatCount(stats.totalDatagrams) },
    { label: '具有时间戳的 EtherCAT 帧', value: formatCount(stats.hasTimestampFrames) },
    { label: 'EtherCAT 时间范围', value: rangeText },
    { label: '解析异常数量', value: formatCount(stats.anomalyCount) },
  ];

  return (
    <section className="card">
      <h2>2. 概览</h2>
      <div className="overview-grid">
        {items.map((it) => (
          <div className="overview-item" key={it.label}>
            <div className="overview-label">{it.label}</div>
            <div className="overview-value">{it.value}</div>
          </div>
        ))}
      </div>
      <div className="cmd-dist">
        <div className="cmd-dist-title">命令分布</div>
        {stats.commandDistribution.length === 0 ? (
          <div className="muted">无 EtherCAT 数据报</div>
        ) : (
          <div className="cmd-chips">
            {stats.commandDistribution.map((c) => (
              <span className="chip" key={c.cmdRaw} title={`命令码 0x${c.cmdRaw.toString(16).toUpperCase()}`}>
                {c.cmdName} × {formatCount(c.count)}
              </span>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
