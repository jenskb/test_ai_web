// CSV 导出：正确处理转义，兼容 Windows Excel（UTF-8 BOM）。

/** 转义单个 CSV 字段（RFC 4180）。 */
export function csvEscape(value: string | number): string {
  const s = String(value);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** 将行数组导出为 CSV 文本（带 UTF-8 BOM）。 */
export function toCsv(header: string[], rows: (string | number)[][]): string {
  const lines = [header, ...rows].map((row) => row.map(csvEscape).join(","));
  // \uFEFF 便于 Excel 识别 UTF-8。
  return "\uFEFF" + lines.join("\r\n") + "\r\n";
}

/** 触发浏览器下载。 */
export function downloadText(
  filename: string,
  text: string,
  mime = "text/csv;charset=utf-8",
): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // 延迟释放，避免 Firefox 等浏览器在下载完成前回收对象 URL。
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
