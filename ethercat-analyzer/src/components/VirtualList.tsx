import { useRef, useState, type ReactNode } from 'react';

export interface VirtualListItem {
  key: string;
}

interface Props<T extends VirtualListItem> {
  items: T[];
  rowHeight: number;
  height: number;
  overscan?: number;
  renderRow: (item: T, index: number) => ReactNode;
  onSelect?: (item: T) => void;
}

// 固定行高的虚拟滚动列表：仅渲染可视区（含 overscan）行，支持大文件报文列表。
export function VirtualList<T extends VirtualListItem>({
  items,
  rowHeight,
  height,
  overscan = 12,
  renderRow,
  onSelect,
}: Props<T>) {
  const [scrollTop, setScrollTop] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  const totalHeight = items.length * rowHeight;
  const startIdx = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const endIdx = Math.min(items.length, Math.ceil((scrollTop + height) / rowHeight) + overscan);

  const visible: { item: T; index: number }[] = [];
  for (let i = startIdx; i < endIdx; i++) {
    const item = items[i];
    if (item) visible.push({ item, index: i });
  }

  return (
    <div
      ref={scrollRef}
      className="vlist"
      style={{ height, overflowY: 'auto', position: 'relative' }}
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
    >
      <div style={{ height: totalHeight, position: 'relative' }}>
        {visible.map(({ item, index }) => (
          <div
            key={item.key}
            className="vlist-row"
            style={{ position: 'absolute', top: index * rowHeight, left: 0, right: 0, height: rowHeight }}
            onClick={() => onSelect?.(item)}
          >
            {renderRow(item, index)}
          </div>
        ))}
      </div>
    </div>
  );
}
