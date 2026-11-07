import type { FrameIndex } from '../types';
import { formatDuration } from '../lib/time';
import { VirtualList } from './VirtualList';

interface Props {
  frames: FrameIndex[];
  selectedSeq: number | null;
  onSelect: (frame: FrameIndex) => void;
}

const COLS = '48px 48px 110px 110px 120px 120px 70px 70px 120px 90px 28px';
const ROW_HEIGHT = 30;

export function PacketList({ frames, selectedSeq, onSelect }: Props) {
  const header = (
    <div className="plist-header" style={{ gridTemplateColumns: COLS }}>
      <span>序号</span>
      <span>接口</span>
      <span>相对时间</span>
      <span>捕获帧间隔</span>
      <span>源 MAC</span>
      <span>目的 MAC</span>
      <span>帧长度</span>
      <span>数据报</span>
      <span>命令摘要</span>
      <span>WKC 摘要</span>
      <span>异常</span>
    </div>
  );

  return (
    <div className="plist">
      {header}
      {frames.length === 0 ? (
        <div className="muted pad">无匹配报文</div>
      ) : (
        <VirtualList<FrameIndex & { key: string }>
          items={frames.map((f) => ({ ...f, key: String(f.seq) }))}
          rowHeight={ROW_HEIGHT}
          height={420}
          renderRow={(f) => <Row frame={f} selected={f.seq === selectedSeq} />}
          onSelect={(f) => onSelect(f)}
        />
      )}
    </div>
  );
}

function Row({ frame, selected }: { frame: FrameIndex; selected: boolean }) {
  const eth = frame.eth;
  const ecat = frame.ecat;
  const cmds = ecat ? ecat.datagrams.map((d) => d.cmdName).join(' ') : '';
  const wkcs = ecat ? ecat.datagrams.map((d) => String(d.wkc)).join(' ') : '';

  let intervalClass = '';
  if (frame.intervalSec !== null && frame.intervalSec < 0) intervalClass = 'neg';
  else if (frame.intervalSec !== null && frame.intervalSec === 0) intervalClass = 'zero';

  return (
    <div
      className={`plist-row ${selected ? 'selected' : ''} ${ecat ? '' : 'non-ecat'}`}
      style={{ gridTemplateColumns: COLS, height: ROW_HEIGHT }}
    >
      <span>{frame.seq}</span>
      <span>{frame.interfaceId}</span>
      <span>{frame.relativeSec === null ? '—' : formatDuration(frame.relativeSec)}</span>
      <span className={intervalClass}>{frame.intervalSec === null ? '—' : formatDuration(frame.intervalSec)}</span>
      <span>{eth?.srcMac ?? '—'}</span>
      <span>{eth?.dstMac ?? '—'}</span>
      <span>{frame.capturedLen}</span>
      <span>{ecat ? ecat.datagrams.length : '—'}</span>
      <span className="mono" title={cmds}>
        {cmds || '—'}
      </span>
      <span className="mono" title={wkcs}>
        {wkcs || '—'}
      </span>
      <span className={frame.anomalies.length > 0 ? 'flag' : ''}>{frame.anomalies.length > 0 ? '⚠' : ''}</span>
    </div>
  );
}
