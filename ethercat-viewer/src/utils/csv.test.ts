import { describe, it, expect } from "vitest";
import { toCsv, csvEscape } from "./csv";

describe("csvEscape", () => {
  it("普通值不转义", () => {
    expect(csvEscape("abc")).toBe("abc");
    expect(csvEscape(123)).toBe("123");
  });

  it("含逗号/引号/换行的字段正确转义", () => {
    expect(csvEscape('a,b')).toBe('"a,b"');
    expect(csvEscape('a"b')).toBe('"a""b"');
    expect(csvEscape("a\nb")).toBe('"a\nb"');
  });
});

describe("toCsv", () => {
  it("带 UTF-8 BOM 且以 CRLF 结尾", () => {
    const csv = toCsv(["帧序号", "命令"], [[1, "LRD"]]);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toBe("\uFEFF帧序号,命令\r\n1,LRD\r\n");
  });

  it("包含逗号的字段被正确包裹", () => {
    const csv = toCsv(["异常"], [["长度越界, 已截断"]]);
    expect(csv).toBe('\uFEFF异常\r\n"长度越界, 已截断"\r\n');
  });
});
