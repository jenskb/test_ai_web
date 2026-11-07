# 协议支持范围与依据

本文列出本工具实现的协议字段布局及其可核查依据，避免凭记忆猜测。

## PCAPNG

依据：IETF 草案
[pcapng](https://www.ietf.org/archive/id/draft-tuexen-opsawg-pcapng-05.html)（PCAP Next Generation
Capture File Format）。

支持块：

| 块 | 类型 | 说明 |
| --- | --- | --- |
| Section Header Block (SHB) | `0x0A0D0D0A` | 字节序魔数（`0x1A2B3C4D`=大端 / `0x4D3C2B1A`=小端）、主/次版本、Section 长度、多 section、新 section 重建接口映射。 |
| Interface Description Block (IDB) | `0x00000001` | LinkType、SnapLen、`if_tsresol`、`if_tsoffset`、`if_name`、`if_description`。 |
| Enhanced Packet Block (EPB) | `0x00000006` | 多接口、64 位时间戳、捕获/原始长度、报文内容。 |
| Simple Packet Block (SPB) | `0x00000003` | 无时间戳（不伪造）。 |

其它块在块长度合法时安全跳过；对已废弃的 Packet Block（`0x00000002`，含报文但无
时间戳语义）明确告警，不静默漏掉报文。

选项代码：`if_tsresol=9`、`if_tsoffset=14`、`if_name=2`、`if_description=3`、`opt_endofopt=0`。

- `if_tsresol`（1 字节）：MSB 为 0 表示十进制（`10^-value`），MSB 为 1 表示二进制
  （`2^-(value & 0x7F)`）；未指定时默认 `10^-6`（微秒）。
- `if_tsoffset`（8 字节）：有符号 64 位秒。
- 时间戳（秒）`= ((tsHigh<<32)|tsLow) × resolution + tsoffset`。

校验：块首尾长度一致、块长度 ≥ 12 且 4 字节对齐、读取边界；正确区分对齐填充与有效数据。

## 以太网

依据：IEEE 802.3 帧格式。

- 目的 MAC（6）、源 MAC（6）、EtherType/Length（2）。
- 常见 VLAN 标签 TPID：`0x8100`（802.1Q）、`0x88A8`（802.1ad S-TAG）、`0x9100`、`0x9200`；
  支持叠加（QinQ）标签。
- EtherCAT EtherType：`0x88A4`。
- 以太网最小帧填充与 EtherCAT 帧头 `Length` 字段共同判定填充，不假设存在 FCS。

## EtherCAT

依据：
- Wireshark EtherCAT dissector（Beckhoff Automation GmbH）：
  - `plugins/epan/ethercat/packet-ethercat-frame.c`（帧头）
  - `plugins/epan/ethercat/packet-ethercat-datagram.c`（数据报）
- EtherCAT 规范 ETG.1000.4（数据链路层）。

### 帧头（2 字节，小端）

| 位 | 字段 |
| --- | --- |
| 0–10 (0x07FF) | Length：数据报区字节数 |
| 11 (0x0800) | Reserved（应为 0） |
| 12–15 (0xF000) | Type：1=数据报、2=ADS、3=RAW-IO、4=NV、5=Mailbox |

仅当 `Type=1` 时按数据报解析；其它类型明确提示，不强行套用数据报格式。

### 数据报头（10 字节，小端）

| 偏移 | 字段 |
| --- | --- |
| 0 | Cmd |
| 1 | Idx |
| 2–3 | ADP（物理寻址）或逻辑地址低 16 位 |
| 4–5 | ADO（物理寻址）或逻辑地址高 16 位 |
| 6–7 | Len |
| 8–9 | IRQ |

Len（16 位，小端）：

| 位 | 字段 |
| --- | --- |
| 0–10 (0x07FF) | 数据长度 |
| 11–13 (0x3800) | Reserved |
| 14 (0x4000) | Circulating（环回 / roundtrip） |
| 15 (0x8000) | More（还有后续数据报） |

数据报 = 头(10) + 数据(Length) + WKC(2)。逻辑寻址命令（`LRD`/`LWR`/`LRW`）使用 32 位逻辑
地址，其余使用 `ADP`+`ADO`。

### 命令码

`NOP=0、APRD=1、APWR=2、APRW=3、FPRD=4、FPWR=5、FPRW=6、BRD=7、BWR=8、BRW=9、
LRD=10、LWR=11、LRW=12、ARMW=13、FRMW=14`。未知命令保留原始值，不导致整份文件解析失败。

### 一致性校验

- 数据报声明长度、后续数据报标志与帧边界共同校验，不一致时标记异常。
- 帧头 `Length` 与实际解析的数据报区长度不一致时标记异常。
