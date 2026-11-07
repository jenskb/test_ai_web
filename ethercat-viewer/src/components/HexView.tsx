import { useMemo } from "react";

interface Props {
  buffer: ArrayBuffer;
  base: number;
  length: number;
  highlight: { offset: number; length: number } | null;
}

const BYTES_PER_LINE = 16;

/** 十六进制视图：偏移 + HEX + ASCII，支持高亮字段对应字节。仅渲染文本。 */
export function HexView({ buffer, base, length, highlight }: Props) {
  const bytes = useMemo(() => new Uint8Array(buffer), [buffer]);

  const lines = useMemo(() => {
    const out: { offset: number; values: number[] }[] = [];
    for (let i = 0; i < length; i += BYTES_PER_LINE) {
      const values: number[] = [];
      for (let j = 0; j < BYTES_PER_LINE && i + j < length; j++) {
        values.push(bytes[base + i + j] ?? 0);
      }
      out.push({ offset: base + i, values });
    }
    return out;
  }, [bytes, base, length]);

  const hlStart = highlight ? highlight.offset : -1;
  const hlEnd = highlight ? highlight.offset + highlight.length : -1;

  return (
    <div className="hexview">
      {lines.map((line) => {
        const ascii = line.values
          .map((v) => (v >= 0x20 && v <= 0x7e ? String.fromCharCode(v) : "."))
          .join("");
        return (
          <div className="hex-line" key={line.offset}>
            <span className="hex-offset">
              {line.offset.toString(16).padStart(8, "0")}
            </span>
            {"  "}
            {line.values.map((v, j) => {
              const abs = line.offset + j;
              const hl = abs >= hlStart && abs < hlEnd;
              return (
                <span key={j} className={hl ? "hex-byte highlight" : ""}>
                  {j > 0 ? " " : ""}
                  {v.toString(16).padStart(2, "0")}
                </span>
              );
            })}
            {"  "}
            <span className="muted">|{ascii}|</span>
          </div>
        );
      })}
    </div>
  );
}
