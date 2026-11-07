// 全项目共享的类型定义。

/** 时间分辨率：if_tsresol 的一种规范表示。 */
export interface TsResol {
  /** 基数：10 表示十进制（10^-exponent），2 表示二进制（2^-exponent）。 */
  base: 10 | 2;
  /** 指数（非负）。 */
  exponent: number;
}

/** 捕获接口信息（来自 Interface Description Block）。 */
export interface InterfaceInfo {
  /** 全局唯一编号（跨 section）。 */
  id: number;
  /** 所属 section 序号（1 起）。 */
  section: number;
  /** section 内局部接口编号（EPB 引用它）。 */
  localId: number;
  /** 链路类型（LINKTYPE_*）。1 = Ethernet。 */
  linkType: number;
  /** 快照长度 SnapLen。 */
  snapLen: number;
  /** 时间分辨率。 */
  tsResol: TsResol;
  /** if_tsoffset，有符号 64 位秒。 */
  tsOffsetSec: bigint;
  name?: string;
  description?: string;
}

/** 解析过程中产生的一条错误或警告。 */
export interface Warning {
  severity: "error" | "warning";
  /** 人类可读的中文描述。 */
  message: string;
  /** 文件中对应的字节偏移（可选）。 */
  offset?: number;
  /** 块类型（可选）。 */
  blockType?: number;
  /** 捕获帧序号（1 起，可选）。 */
  frameIndex?: number;
}

/** 一条原始捕获报文（不包含报文内容拷贝，仅记录偏移）。 */
export interface PacketRecord {
  /** 原始捕获帧序号（1 起，所有链路类型的报文统一计数）。 */
  frameIndex: number;
  /** 所属接口编号。 */
  interfaceId: number;
  /** 所属链路类型。 */
  linkType: number;
  /** 原始 64 位时间戳（timestamp units）。无时间戳（SPB）时为 null。 */
  tsTicks: bigint | null;
  /** 捕获长度（字节）。 */
  capturedLength: number;
  /** 原始长度（字节）。 */
  originalLength: number;
  /** 报文数据在原始文件 ArrayBuffer 中的起始偏移。 */
  dataOffset: number;
  /** 报文数据长度（等于 capturedLength，用于边界校验）。 */
  dataLength: number;
}

/** 以太网 VLAN 标签。 */
export interface VlanTag {
  /** TPID（0x8100、0x88A8、0x9100 等）。 */
  tpid: number;
  /** TCI（优先级 + DEI + VLAN ID）。 */
  tci: number;
  /** VLAN ID（低 12 位）。 */
  vid: number;
}

/** 协议解析异常标记。 */
export type AnomalyKind =
  | "truncated"
  | "length-out-of-bounds"
  | "more-flag-mismatch"
  | "frame-type-not-datagram"
  | "unknown-command"
  | "wkc-zero"
  | "padding"
  | "unknown-ethertype";

export interface Anomaly {
  kind: AnomalyKind;
  /** 中文描述。 */
  message: string;
}

/** EtherCAT 数据报。 */
export interface Datagram {
  /** 数据报在帧内的序号（1 起）。 */
  indexInFrame: number;
  /** 数据报起始处在报文数据内的字节偏移。 */
  offsetInPacket: number;
  /** 命令码。 */
  cmd: number;
  /** 命令名（标准命令或 "UNKNOWN"）。 */
  cmdName: string;
  /** Index 字段。 */
  idx: number;
  /** 物理寻址：ADP（自动递增地址 / 配置地址高位）。 */
  adp?: number;
  /** 物理寻址：ADO（寄存器偏移）。 */
  ado?: number;
  /** 逻辑寻址：32 位逻辑地址。 */
  logicalAddr?: number;
  /** 地址原始 32 位值。 */
  rawAddr: number;
  /** 数据长度（字节，来自 11 位长度字段）。 */
  length: number;
  /** 保留位（3 位）。 */
  reservedBits: number;
  /** 是否已环回（circulating / roundtrip）。 */
  circulating: boolean;
  /** 是否还有后续数据报。 */
  more: boolean;
  /** IRQ 字段。 */
  irq: number;
  /** 数据区在报文数据内的字节偏移。 */
  dataOffsetInPacket: number;
  /** WKC 在报文数据内的字节偏移。 */
  wkcOffsetInPacket: number;
  /** Working Counter。 */
  wkc: number;
  /** 解析异常。 */
  anomalies: Anomaly[];
}

/** 一条 EtherCAT 帧（含以太网层解析结果）。 */
export interface EtherCATFrame {
  /** 对应 packets 数组中的序号。 */
  packetIndex: number;
  /** 以太网头部在报文数据内的偏移（通常为 0）。 */
  ethOffsetInPacket: number;
  /** 目的 MAC。 */
  dstMac: string;
  /** 源 MAC。 */
  srcMac: string;
  /** VLAN 标签（含叠加）。 */
  vlanTags: VlanTag[];
  /** 最终 EtherType（0x88A4）。 */
  etherType: number;
  /** EtherCAT 帧头在报文数据内的偏移。 */
  ecatHeaderOffsetInPacket: number;
  /** EtherCAT 帧头 Length 字段（11 位）。 */
  frameLength: number;
  /** EtherCAT 帧头保留位。 */
  frameReserved: number;
  /** EtherCAT 帧头类型字段。 */
  frameType: number;
  /** 是否可按数据报解析（frameType === 1）。 */
  isDatagram: boolean;
  /** 数据报列表（按帧内顺序）。 */
  datagrams: Datagram[];
  /** 以太网填充字节数。 */
  paddingLength: number;
  /** 帧级异常。 */
  anomalies: Anomaly[];
  /** 相对秒（相对全文件最早带时间戳的报文），无时间戳为 null。 */
  relSeconds: number | null;
  /** 与上一条同接口、带时间戳 EtherCAT 帧的间隔秒；无则为 null。 */
  prevIntervalSeconds: number | null;
  /** 时间戳异常：倒退 / 相同 / 无。 */
  timeAnomaly: "backward" | "same" | null;
}

/** 解析完成后的整体结果。 */
export interface ParseResult {
  fileName: string;
  fileSize: number;
  /** 接口列表。 */
  interfaces: InterfaceInfo[];
  /** 全部捕获报文。 */
  packets: PacketRecord[];
  /** EtherCAT 帧（仅含 EtherType 0x88A4 的报文）。 */
  ethercatFrames: EtherCATFrame[];
  /** 错误与警告。 */
  warnings: Warning[];
  /** section 数量。 */
  sections: number;
  /** 解析耗时（毫秒）。 */
  elapsedMs: number;
}
