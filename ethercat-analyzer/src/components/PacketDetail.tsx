import { useState } from 'react';
import type { FieldNode, FrameDetail, FrameIndex } from '../types';
import { toHexLines } from '../lib/hex';
import { formatDuration, describeResol } from '../lib/time';

export interface Highlight {
  offset: number;
  length: number;
}

interface Props {
  detail: FrameDetail | null;
  frame: FrameIndex | null;
  highlight: Highlight | null;
  onHighlight: (h: Highlight | null) => void;
}

export function PacketDetail({ detail, frame, highlight, onHighlight }: Props) {
  if (!detail || !frame) {
    return (
      <section className="card">
        <h2>4. 协议详情</h2>
        <div className="muted pad">选择左侧报文查看协议详情与十六进制视图。</div>
      </section>
    );
  }

  const bytes = detail.rawHex?.bytes ?? new Uint8Array(0);

  return (
    <section className="card detail">
      <h2>4. 协议详情（帧 #{frame.seq}）</h2>
      <div className="detail-meta">
        <span>接口 {frame.interfaceId}</span>
        <span>长度 {frame.capturedLen}（原始 {frame.origLen}）</span>
        <span>相对时间 {frame.relativeSec === null ? '—' : formatDuration(frame.relativeSec)}</span>
        <span>间隔 {frame.intervalSec === null ? '—' : formatDuration(frame.intervalSec)}</span>
        <span>分辨率 {describeResol(frame.tsResol)}</span>
      </div>
      {frame.anomalies.length > 0 && (
        <div className="alert-warn">
          {frame.anomalies.map((a, i) => (
            <div key={i}>⚠ {a}</div>
          ))}
        </div>
      )}

      <div className="detail-split">
        <div className="tree-pane">
          <div className="tree-group-title">以太网</div>
          {detail.eth.map((f, i) => (
            <FieldRow key={`eth-${i}`} field={f} highlight={highlight} onHighlight={onHighlight} />
          ))}

          {detail.ecatFrame && (
            <>
              <div className="tree-group-title">EtherCAT 帧头</div>
              {detail.ecatFrame.map((f, i) => (
                <FieldRow key={`ecatf-${i}`} field={f} highlight={highlight} onHighlight={onHighlight} />
              ))}
            </>
          )}

          {detail.ecatDatagrams.map((tree, di) => (
            <div key={`dg-${di}`}>
              <div className="tree-group-title">数据报 #{di + 1}</div>
              {tree.map((f, i) => (
                <FieldRow key={`dg-${di}-${i}`} field={f} highlight={highlight} onHighlight={onHighlight} />
              ))}
            </div>
          ))}

          {detail.ecatDatagrams.length === 0 && !detail.ecatFrame && (
            <div className="muted pad">非 EtherCAT 帧或非数据报类型，无数据报详情。</div>
          )}
        </div>

        <div className="hex-pane">
          <div className="hex-toolbar">
            <span>十六进制</span>
            <button className="btn btn-sm" onClick={() => copyHex(bytes)}>
              复制 HEX
            </button>
          </div>
          <HexView bytes={bytes} highlight={highlight} />
        </div>
      </div>
    </section>
  );
}

function FieldRow({
  field,
  depth = 0,
  highlight,
  onHighlight,
}: {
  field: FieldNode;
  depth?: number;
  highlight: Highlight | null;
  onHighlight: (h: Highlight | null) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = !!field.children && field.children.length > 0;
  const clickable = field.length > 0;
  const isActive =
    highlight !== null &&
    field.length > 0 &&
    highlight.offset === field.offset &&
    highlight.length === field.length;

  const handleClick = () => {
    if (!clickable) return;
    if (isActive) onHighlight(null);
    else onHighlight({ offset: field.offset, length: field.length });
  };

  return (
    <div className="field">
      <div
        className={`field-row ${clickable ? 'clickable' : ''} ${isActive ? 'active' : ''}`}
        style={{ paddingLeft: depth * 14 + 8 }}
        onClick={handleClick}
      >
        <span className="field-arrow" onClick={(e) => { e.stopPropagation(); if (hasChildren) setExpanded(!expanded); }}>
          {hasChildren ? (expanded ? '▾' : '▸') : '·'}
        </span>
        <span className="field-offset">{field.length > 0 ? `${field.offset}` : ''}</span>
        <span className="field-name">{field.name}</span>
        <span className="field-value mono" title={field.value}>
          {field.value}
        </span>
      </div>
      {hasChildren &&
        expanded &&
        field.children!.map((c, i) => (
          <FieldRow key={i} field={c} depth={depth + 1} highlight={highlight} onHighlight={onHighlight} />
        ))}
    </div>
  );
}

function HexView({ bytes, highlight }: { bytes: Uint8Array; highlight: Highlight | null }) {
  const lines = toHexLines(bytes, 0, 16);

  const inHighlight = (byteIndex: number): boolean => {
    if (!highlight) return false;
    return byteIndex >= highlight.offset && byteIndex < highlight.offset + highlight.length;
  };

  return (
    <div className="hex-view">
      {lines.map((line) => (
        <div className="hex-line" key={line.offset}>
          <span className="hex-offset">{line.offset.toString(16).padStart(8, '0')}</span>
          <span className="hex-bytes">
            {line.hex.map((h, i) => {
              const byteIndex = line.offset + i;
              return (
                <span key={i} className={`hex-byte ${inHighlight(byteIndex) ? 'hl' : ''}`}>
                  {h}
                </span>
              );
            })}
          </span>
          <span className="hex-ascii">
            {line.ascii.split('').map((ch, i) => {
              const byteIndex = line.offset + i;
              return (
                <span key={i} className={inHighlight(byteIndex) ? 'hl' : ''}>
                  {ch}
                </span>
              );
            })}
          </span>
        </div>
      ))}
    </div>
  );
}

async function copyHex(bytes: Uint8Array): Promise<void> {
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i]!.toString(16).padStart(2, '0');
    if ((i + 1) % 2 === 0) hex += ' ';
  }
  try {
    await navigator.clipboard.writeText(hex.trim());
  } catch {
    const ta = document.createElement('textarea');
    ta.value = hex.trim();
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  }
}
