// 将 XML 文本解析并转换为 BIN（二进制）数据。
// 先验证 XML 合法性，再编码为 UTF-8 二进制数据返回（Uint8Array）。
function xmlToBin(xmlString) {
  if (typeof xmlString !== 'string') {
    throw new TypeError('xmlToBin 需要字符串类型的 XML 内容');
  }

  // 解析 XML，验证其合法性
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlString, 'application/xml');
  if (doc.documentElement && doc.documentElement.nodeName === 'parsererror') {
    throw new Error('XML 解析失败：' + doc.documentElement.textContent.trim());
  }

  // 编码为 UTF-8 二进制数据
  return new TextEncoder().encode(xmlString);
}

// 根据 BOM 与 XML 声明（<?xml ... encoding="..."?>）检测编码，
// 将字节内容解码为字符串。未显式声明时默认 UTF-8。
function decodeXmlBytes(bytes) {
  // 检测 BOM
  if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
    return new TextDecoder('utf-8').decode(bytes);
  }
  if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE) {
    return new TextDecoder('utf-16le').decode(bytes);
  }
  if (bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF) {
    return new TextDecoder('utf-16be').decode(bytes);
  }

  // 读取头部（按单字节映射为字符）解析 encoding 属性
  const head = String.fromCharCode.apply(null, bytes.subarray(0, 512));
  const match = head.match(/^\s*<\?xml[^>]*\bencoding\s*=\s*["']([^"']+)["']/i);
  const encoding = match ? match[1] : 'utf-8';

  try {
    return new TextDecoder(encoding).decode(bytes);
  } catch (error) {
    // 不支持的编码回退为 UTF-8
    return new TextDecoder('utf-8').decode(bytes);
  }
}

// 将二进制数据下载为 .bin 文件
function downloadBin(binData, filename) {
  const blob = new Blob([binData], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename || 'output.bin';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } finally {
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 0);
  }
}
