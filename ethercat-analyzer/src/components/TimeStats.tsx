import type { IntervalStats } from '../types';
import { formatDuration } from '../lib/time';

interface Props {
  intervalStats: IntervalStats[];
}

export function TimeStats({ intervalStats }: Props) {
  return (
    <section className="card">
      <h2>5. 捕获帧间隔统计（按接口）</h2>
      <div className="note">
        以下为“捕获帧间隔”：同一接口上、具有有效时间戳的相邻 EtherCAT 帧之间的时间间隔。
        该值反映抓包侧观测到的帧到达间隔，不能直接等同于总线周期或 EtherCAT DC 同步精度。
      </div>

      {intervalStats.length === 0 ? (
        <div className="muted pad">没有可计算间隔的 EtherCAT 帧（缺少有效时间戳）。</div>
      ) : (
        <table className="stats-table">
          <thead>
            <tr>
              <th>接口</th>
              <th>样本数</th>
              <th>最小</th>
              <th>最大</th>
              <th>平均值</th>
              <th>标准差</th>
              <th>总跨度</th>
              <th>时间戳倒退</th>
              <th>相同时间戳</th>
            </tr>
          </thead>
          <tbody>
            {intervalStats.map((s) => (
              <tr key={s.interfaceId}>
                <td>{s.name}</td>
                <td>{s.count}</td>
                <td>{s.minSec === null ? '—' : formatDuration(s.minSec)}</td>
                <td>{s.maxSec === null ? '—' : formatDuration(s.maxSec)}</td>
                <td>{s.meanSec === null ? '—' : formatDuration(s.meanSec)}</td>
                <td>{s.stddevSec === null ? '—' : formatDuration(s.stddevSec)}</td>
                <td>{s.totalSec === null ? '—' : formatDuration(s.totalSec)}</td>
                <td className={s.regressions > 0 ? 'warn' : ''}>{s.regressions}</td>
                <td>{s.equalTimestamps}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="note">
        抓包时间戳受采集设备与驱动影响，二进制分辨率（2^-N）无法表示为整数纳秒，展示值按浮点换算并受捕获分辨率限制。
        无时间戳的帧（如 Simple Packet Block）不参与统计。
      </div>
    </section>
  );
}
