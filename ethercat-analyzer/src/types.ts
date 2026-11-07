// 全局共享类型定义。

export type TimeResol =
  | { kind: 'decimal'; exp: number } // 10^-exp 秒
  | { kind: 'binary'; exp: number }; // 2^-exp 秒

export interface InterfaceInfo {
  id: number; // 接口 ID（IDB 顺序，从 0 开始）
  linkType: number;
  snapLen: number;
  tsResol: TimeResol; // 已解析（未指定时用默认值）
  tsResolRaw: number | null; // 原始 if_tsresol 选项字节（null = 未指定）
  tsOffset: bigint; // if_tsoffset，单位秒（有符号），未指定为 0
  name: string; // if_name，缺失为空串
}

export interface VlanTag {
  tci: number;
  pcp: number;
  dei: number;
  vid: number;
  innerEtherType: number; // 该 VLAN 标签之后的 EtherType
  offset: number; // 该 VLAN 标签首字节（TCI 高字节）在帧内的偏移
}

export interface EthSummary {
  dstMac: string;
  srcMac: string;
  etherType: number; // 剥掉 VLAN 后的最终 EtherType
  vlanTags: VlanTag[];
  isEtherCAT: boolean; // etherType === 0x88A4
  payloadOffset: number; // EtherCAT 帧头在帧内的偏移
  paddingDetected: boolean; // EtherCAT 帧长字段小于剩余负载，提示存在以太网填充
}

export interface DatagramSummary {
  cmdRaw: number;
  cmdName: string; // 标准命令名，未知则为 "未知(0x..)"
  idx: number;
  address: number; // 原始 32 位地址（无符号）
  adp: number; // 物理寻址：ADP（地址高 16 位）
  ado: number; // 物理寻址：ADO（地址低 16 位）
  logicalAddress: number; // 逻辑寻址：完整 32 位
  length: number; // 数据长度（11 位）
  circulating: boolean; // C 位
  more: boolean; // M 位（后续数据报标志）
  irq: number;
  wkc: number;
  offset: number; // 数据报头在帧内的偏移
  dataOffset: number; // 数据在帧内的偏移
  wkcOffset: number; // WKC 在帧内的偏移
  isPhysical: boolean; // 物理寻址命令
  isLogical: boolean; // 逻辑寻址命令
  error?: string; // 异常描述
}

export interface EcatFrameSummary {
  frameType: number; // 帧头类型（1..5）
  frameTypeName: string;
  headerLength: number; // 帧头长度字段（11 位）
  isDatagram: boolean; // frameType === 1
  datagrams: DatagramSummary[];
  headerOffset: number; // EtherCAT 帧头在帧内的偏移
  error?: string;
}

export interface FrameIndex {
  seq: number; // 1-based 捕获帧序号
  interfaceId: number; // SPB 无接口时为 -1
  fileOffset: number; // 报文数据（以太网帧）在文件中的字节偏移
  capturedLen: number; // 捕获长度
  origLen: number; // 原始长度
  timestampRaw: bigint | null; // null = 无时间戳（SPB）
  tsResol: TimeResol;
  tsOffset: bigint;
  intervalSec: number | null; // 与同接口上一条有效时间戳 EtherCAT 帧的间隔（秒），基于完整序列计算
  relativeSec: number | null; // 相对全局零点的秒数（浮点，仅展示）
  eth: EthSummary | null;
  ecat: EcatFrameSummary | null;
  anomalies: string[]; // 该帧的解析异常/警告
  notEthernet?: string; // 非以太网 linktype 说明
}

export interface CommandCount {
  cmdRaw: number;
  cmdName: string;
  count: number;
}

export interface CaptureStats {
  totalFrames: number;
  ethercatFrames: number;
  totalDatagrams: number;
  hasTimestampFrames: number;
  timeRangeStartSec: number | null; // 相对时间基准（通常 0）
  timeRangeEndSec: number | null;
  commandDistribution: CommandCount[];
  anomalyCount: number;
}

export interface ParseResult {
  interfaces: InterfaceInfo[];
  frames: FrameIndex[];
  sectionCount: number;
  warnings: string[]; // 全局警告（未知块、旧块类型、截断等）
  truncated: boolean;
  stats: CaptureStats;
  intervalStats: IntervalStats[];
  fileSize: number;
}

// 按接口的 EtherCAT 帧间隔统计。
export interface IntervalStats {
  interfaceId: number;
  name: string;
  count: number;
  minSec: number | null;
  maxSec: number | null;
  meanSec: number | null;
  stddevSec: number | null;
  regressions: number; // 时间戳倒退
  equalTimestamps: number; // 相同时间戳
  totalSec: number | null; // 区间总跨度
}

// 协议详情树的字段节点（用于协议树 + 十六进制高亮）。
export interface FieldNode {
  name: string;
  value: string;
  offset: number; // 相对帧起始的字节偏移，-1 表示无字节关联
  length: number; // 字节长度，0 表示无字节关联
  children?: FieldNode[];
}

// Worker 与主线程之间的消息协议。
export type WorkerRequest =
  | { type: 'parse'; file: File }
  | { type: 'readFrame'; seq: number; fileOffset: number; capturedLen: number }
  | { type: 'cancel' };

export type WorkerResponse =
  | { type: 'progress'; bytesRead: number; fileSize: number; framesSoFar: number }
  | { type: 'done'; result: ParseResult }
  | { type: 'error'; message: string }
  | { type: 'cancelled' }
  | { type: 'frameDetail'; seq: number; detail: FrameDetail };

export interface FrameDetail {
  seq: number;
  interfaceId: number;
  capturedLen: number;
  origLen: number;
  timestampRaw: bigint | null;
  tsResol: TimeResol;
  tsOffset: bigint;
  intervalSec: number | null;
  relativeSec: number | null; // 相对时间（秒）
  eth: FieldNode[]; // 以太网协议树
  ecatFrame: FieldNode[] | null; // EtherCAT 帧头协议树
  ecatDatagrams: FieldNode[][]; // 每个数据报一棵子树
  rawHex: { offset: number; bytes: Uint8Array } | null; // 原始字节（供 HEX/ASCII 视图），null 表示读取失败
  anomalies: string[];
}
