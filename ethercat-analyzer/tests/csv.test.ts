import { describe, expect, it } from 'vitest';
import { csvEscape, toCsv } from '../src/lib/csv';

describe('CSV 导出', () => {
  it('普通值不转义', () => {
    expect(csvEscape('abc')).toBe('abc');
    expect(csvEscape(123)).toBe('123');
  });

  it('含逗号、引号、换行时正确转义', () => {
    expect(csvEscape('a,b')).toBe('"a,b"');
    expect(csvEscape('a"b')).toBe('"a""b"');
    expect(csvEscape('a\nb')).toBe('"a\nb"');
  });

  it('空值输出空串', () => {
    expect(csvEscape(null)).toBe('');
    expect(csvEscape(undefined)).toBe('');
  });

  it('toCsv 带 BOM 且使用 CRLF（兼容 Windows Excel）', () => {
    const csv = toCsv([
      ['a', 'b'],
      ['1', '2'],
    ]);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('a,b\r\n1,2');
  });
});
