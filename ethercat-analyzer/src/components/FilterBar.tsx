import type { CommandCount, InterfaceInfo } from '../types';

export interface FilterState {
  command: number | null; // 命令码
  wkc: 'all' | 'zero' | 'nonzero';
  interfaceId: number | null;
  seqMin: string;
  seqMax: string;
  anomalyOnly: boolean;
}

export const DEFAULT_FILTER: FilterState = {
  command: null,
  wkc: 'all',
  interfaceId: null,
  seqMin: '',
  seqMax: '',
  anomalyOnly: false,
};

interface Props {
  filter: FilterState;
  onChange: (f: FilterState) => void;
  commandOptions: CommandCount[];
  interfaces: InterfaceInfo[];
}

// 筛选仅影响展示，不改变帧间隔计算基准（间隔基于完整序列预计算）。
export function FilterBar({ filter, onChange, commandOptions, interfaces }: Props) {
  const set = (patch: Partial<FilterState>) => onChange({ ...filter, ...patch });

  return (
    <section className="card filter-bar">
      <div className="filter-title">3. 筛选（不改变帧间隔计算基准）</div>
      <div className="filter-row">
        <label>
          命令
          <select
            value={filter.command === null ? '' : String(filter.command)}
            onChange={(e) => set({ command: e.target.value === '' ? null : Number(e.target.value) })}
          >
            <option value="">全部</option>
            {commandOptions.map((c) => (
              <option key={c.cmdRaw} value={String(c.cmdRaw)}>
                {c.cmdName}（0x{c.cmdRaw.toString(16).toUpperCase()}）
              </option>
            ))}
          </select>
        </label>

        <label>
          WKC
          <select value={filter.wkc} onChange={(e) => set({ wkc: e.target.value as FilterState['wkc'] })}>
            <option value="all">全部</option>
            <option value="zero">WKC = 0（需检查）</option>
            <option value="nonzero">WKC &gt; 0</option>
          </select>
        </label>

        <label>
          接口
          <select
            value={filter.interfaceId === null ? '' : String(filter.interfaceId)}
            onChange={(e) => set({ interfaceId: e.target.value === '' ? null : Number(e.target.value) })}
          >
            <option value="">全部</option>
            {interfaces.map((i) => (
              <option key={i.id} value={String(i.id)}>
                接口 {i.id}{i.name ? `（${i.name}）` : ''}
              </option>
            ))}
          </select>
        </label>

        <label>
          帧序号从
          <input
            type="number"
            min={1}
            value={filter.seqMin}
            placeholder="最小"
            onChange={(e) => set({ seqMin: e.target.value })}
          />
        </label>
        <label>
          到
          <input
            type="number"
            min={1}
            value={filter.seqMax}
            placeholder="最大"
            onChange={(e) => set({ seqMax: e.target.value })}
          />
        </label>

        <label className="checkbox">
          <input
            type="checkbox"
            checked={filter.anomalyOnly}
            onChange={(e) => set({ anomalyOnly: e.target.checked })}
          />
          仅显示有异常的帧
        </label>
      </div>
    </section>
  );
}
