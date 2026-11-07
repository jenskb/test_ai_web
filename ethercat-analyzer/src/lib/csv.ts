// CSV 导出：正确处理转义，兼容 Windows Excel（BOM + CRLF）。

export function csvEscape(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (/[",\r\n]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

export function toCsv(rows: (string | number | null | undefined)[][]): string {
  const body = rows
    .map((row) => row.map((cell) => csvEscape(cell)).join(','))
    .join('\r\n');
  return '\uFEFF' + body + '\r\n';
}

export function downloadText(filename: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
