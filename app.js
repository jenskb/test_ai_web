// EtherCAT SII 头部字段在 EEPROM 中的字地址（每个字 16 位 = 2 字节）。
// 字节偏移 = 字地址 × 2；所有多字节字段均按小端序（Little-Endian）存储。
const SII_WORD_ADDR = {
  VENDOR_ID: 0x0008,    // Vendor ID，32 位，占字地址 0x0008-0x0009
  PRODUCT_CODE: 0x000A, // Product Code，32 位，占字地址 0x000A-0x000B
  REVISION_NO: 0x000C,  // Revision Number，32 位，占字地址 0x000C-0x000D
  SERIAL_NO: 0x000E,    // Serial Number，32 位，占字地址 0x000E-0x000F
};

// SII 固定头部区域大小：字地址 0x0000-0x003F，共 64 个字（128 字节）。
const SII_HEADER_WORDS = 0x0040;

// 解析 ESI XML 中的整数字面量：支持十进制、0x 前缀和 #x 前缀的十六进制。
function parseIntLiteral(text) {
  const value = String(text).trim();
  const hex = value.match(/^(?:0x|#x)([0-9a-f]+)$/i);
  if (hex) {
    return parseInt(hex[1], 16);
  }
  return parseInt(value, 10);
}

// 从 <Vendor><Id> 提取 Vendor ID。
function parseVendorId(doc) {
  const vendor = doc.getElementsByTagName('Vendor')[0];
  const idNode = vendor && vendor.getElementsByTagName('Id')[0];
  if (!idNode) {
    throw new Error('缺少 <Vendor><Id> 节点，无法提取 Vendor ID');
  }
  const id = parseIntLiteral(idNode.textContent);
  if (!Number.isInteger(id) || id < 0 || id > 0xFFFFFFFF) {
    throw new Error('Vendor ID 格式无效：' + idNode.textContent.trim());
  }
  return id;
}

// 定位包含 ProductCode 属性的 <Type> 节点（优先在 <Device> 内查找），
// 确保 Product Code 与 Revision Number 取自同一节点，避免多设备 ESI 混用。
function findDeviceType(doc) {
  const devices = doc.getElementsByTagName('Device');
  for (let i = 0; i < devices.length; i++) {
    const types = devices[i].getElementsByTagName('Type');
    for (let j = 0; j < types.length; j++) {
      if (types[j].getAttribute('ProductCode')) {
        return types[j];
      }
    }
  }
  // 回退：整个文档范围内查找（兼容非标准结构）
  const allTypes = doc.getElementsByTagName('Type');
  for (let k = 0; k < allTypes.length; k++) {
    if (allTypes[k].getAttribute('ProductCode')) {
      return allTypes[k];
    }
  }
  return null;
}

// 从 <Device><Type ProductCode="..."> 提取 Product Code。
function parseProductCode(doc) {
  const type = findDeviceType(doc);
  if (!type) {
    throw new Error('缺少 <Type ProductCode="..."> 节点，无法提取 Product Code');
  }
  const raw = type.getAttribute('ProductCode');
  const code = parseIntLiteral(raw);
  if (!Number.isInteger(code) || code < 0 || code > 0xFFFFFFFF) {
    throw new Error('Product Code 格式无效：' + raw);
  }
  return code;
}

// 从同一 <Type> 节点提取 Revision Number，缺失时返回 0。
function parseRevisionNo(doc) {
  const type = findDeviceType(doc);
  if (!type) {
    return 0;
  }
  const raw = type.getAttribute('RevisionNo');
  if (raw === null || raw === '') {
    return 0;
  }
  const rev = parseIntLiteral(raw);
  if (!Number.isInteger(rev) || rev < 0 || rev > 0xFFFFFFFF) {
    throw new Error('Revision Number 格式无效：' + raw);
  }
  return rev;
}

// 将 XML 文本解析并转换为 EtherCAT SII 二进制数据。
// 先验证 XML 合法性，再从 ESI XML 提取 Vendor ID、Product Code 等字段，
// 按 SII 规范打包到 ArrayBuffer（小端序），返回其 Uint8Array 视图。
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

  // 提取 SII 字段
  const vendorId = parseVendorId(doc);
  const productCode = parseProductCode(doc);
  const revisionNo = parseRevisionNo(doc);

  // 打包为 SII 头部（字地址 0x0000-0x003F，共 128 字节）
  const buffer = new ArrayBuffer(SII_HEADER_WORDS * 2);
  const view = new DataView(buffer);
  // setUint32 第三个参数 true 表示按小端序写入
  view.setUint32(SII_WORD_ADDR.VENDOR_ID * 2, vendorId, true);
  view.setUint32(SII_WORD_ADDR.PRODUCT_CODE * 2, productCode, true);
  view.setUint32(SII_WORD_ADDR.REVISION_NO * 2, revisionNo, true);
  view.setUint32(SII_WORD_ADDR.SERIAL_NO * 2, 0, true);

  return new Uint8Array(buffer);
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
