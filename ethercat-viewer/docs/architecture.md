# 架构与设计

## 总体结构

```
浏览器主线程                         Web Worker
┌─────────────────────────────┐     ┌──────────────────────────────┐
│ UI (React)                  │     │ parseWorker.ts               │
│  FileImport / Overview /    │ ──▶ │  parseBuffer()               │
│  PacketList / ProtocolDetail│     │   ├─ pcapng/parse            │
│  / TimeStats                │ ◀── │   ├─ ethernet/parse          │
│  useParser (hook)           │     │   ├─ ethercat/parse          │
└─────────────────────────────┘     │   ├─ core/time (相对时间/间隔)│
                                    │   └─ stats/compute           │
                                    └──────────────────────────────┘
```

- **文件读取**：主线程 `file.arrayBuffer()` 读取后，通过 `postMessage(..., [buffer])`
  零拷贝转移给 Worker。
- **解析**：Worker 单线程解析 PCAPNG → 以太网 → EtherCAT，进度消息节流回传主线程。
- **回传**：结果与原始 `ArrayBuffer` 一起以 `transfer` 零拷贝转回主线程，供十六进制视图
  按需生成，避免每条报文保存一份十六进制字符串。
- **取消**：主线程向 Worker 发送 `cancel`，Worker 在块边界检查 `shouldCancel()`，
  及时中止并释放资源；重新导入时旧任务会被新的 `id` 覆盖，不会污染新界面。

## 模块职责

| 模块 | 职责 |
| --- | --- |
| `pcapng/parse.ts` | 文件格式：SHB（字节序/多 section/接口重映射）、IDB（LinkType/SnapLen/`if_tsresol`/`if_tsoffset`）、EPB（多接口/时间戳/捕获与原始长度）、SPB（无时间戳）、未知块跳过、废弃 Packet Block 告警、块长度/对齐/边界校验。 |
| `pcapng/reader.ts` | 字节序感知读取；64 位字段返回 `BigInt`。 |
| `ethernet/parse.ts` | 目的/源 MAC、EtherType、VLAN（含叠加）、过滤 `0x88A4`。 |
| `ethercat/parse.ts` | 帧头协议类型判断、逐数据报解析、命令/地址/长度/标志/IRQ/WKC/偏移、边界与后续标志一致性校验。 |
| `ethercat/commands.ts` | 命令码 ↔ 名称、逻辑寻址判断、帧类型名称。 |
| `stats/compute.ts` | 命令分布、帧间隔 min/max/均值/标准差、降采样、时间戳倒退/相同标记。 |
| `core/parse.ts` | 顶层编排，产出 `ParseResult`。 |
| `core/time.ts` | 相对时间、同接口帧间隔、时间戳异常标记。 |
| `worker/parseWorker.ts` | Worker 入口与消息协议。 |
| `utils/` | 格式化、CSV 转义、筛选。 |

## 关键设计决策

### 时间精度

- 原始 64 位时间戳（`tsHigh << 32 | tsLow`）以 `BigInt` 存储，不合并进 JS `Number`。
- 时间戳分辨率 `if_tsresol` 以 `{ base: 10|2, exponent }` 表达，支持十进制与二进制。
- 帧间隔使用 `BigInt` 差值计算后再转 `Number`，仅用于展示/绘图；显示精度不代表抓包实际精度。

### 内存上限

- 仅保留一份原始 `ArrayBuffer`（Worker 与主线程之间转移，不复制）。
- 报文记录只存偏移/长度，不存报文内容与十六进制字符串。
- 协议详情与十六进制文本按需生成。
- 报文数量上限 `MAX_PACKETS = 2_000_000`，超出告警并停止。

### 填充与 FCS

- 以太网最小帧填充（< 60 字节补齐）通过 EtherCAT 帧头 `Length` 字段与报文长度共同判定，
  不把填充当作 EtherCAT 数据。
- 不假设每个捕获帧都含 FCS；解析仅依赖 `capturedLength` 与协议字段声明的长度。

### WKC 与解释边界

- 展示 WKC 实际值与变化；WKC=0 高亮为“需检查”，不自动判定通信故障。
- 未知拓扑/配置时不计算期望 WKC。
- 不因帧间隔增大断言丢帧（可能捕获侧丢包）；不臆测 PDO 语义。
