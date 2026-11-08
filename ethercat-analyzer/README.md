# EtherCAT 抓包离线分析

一个完全离线的 PCAPNG 抓包分析网页，用于解析 EtherCAT 帧与数据报。文件在浏览器本地解析，**不上传抓包内容**，运行时**不依赖 CDN、远程字体或在线接口**。

## 功能

- **PCAPNG 解析**：Section Header Block（字节序、多 Section、接口重映射）、Interface Description Block（LinkType / SnapLen / `if_tsresol` 十进制与二进制 / `if_tsoffset`）、Enhanced Packet Block、Simple Packet Block（无时间戳不伪造）、未知块安全跳过、已废弃报文块明确提示。
- **以太网解析**：目的/源 MAC、EtherType、VLAN（含叠加 QinQ）、EtherCAT（`0x88A4`）过滤、填充处理、不假设 FCS。
- **EtherCAT 解析**：帧头类型判断、逐数据报解析、15 个标准命令（含 NOP）、物理地址 ADP/ADO、逻辑地址、数据长度、C/M 标志、IRQ、WKC、字段与数据报在原始帧中的偏移。
- **界面**：文件选择/拖放、解析进度、取消；概览统计；虚拟滚动报文列表；按命令 / WKC / 接口 / 帧序号范围 / 异常筛选；协议树 + 十六进制视图（点击字段高亮对应字节）；按接口的帧间隔统计；CSV 导出。
- **性能与安全**：分块读取、仅保留帧偏移与必要索引（不常驻全文件与 HEX 字符串）、选中报文按需读取详情、取消与资源释放、恶意长度限制、抓包内容仅作文本渲染。

## 技术栈与架构

React + TypeScript + Vite + Web Worker + 虚拟滚动。模块职责单一：

```
src/
  lib/        bytes（大小端读取）、time（BigInt 时间换算）、hex、format、csv、exportCsv
  pcapng/     parse.ts（流式块解析）
  ethernet/   ethernet.ts（MAC / VLAN / EtherType）
  ethercat/   commands.ts（命令表）、ethercat.ts（帧头 + 数据报）
  analyze.ts  原始报文 → FrameIndex（摘要）
  dissect.ts  按需生成帧详情（协议树）
  stats/      stats.ts（命令分布、帧间隔统计）
  worker/     parseWorker.ts（Web Worker：分块解析、取消、按需读帧）
  hooks/      useAnalyzer.ts（Worker 生命周期）
  components/ 各 UI 组件
```

### 时间与精度

- 64 位原始时间戳内部用 `BigInt`，结合接口时间分辨率与偏移换算，不合并进 `Number` 丢精度。
- 二进制分辨率（`2^-N`）无法表示为整数纳秒，展示值按浮点换算并注明分辨率，不静默截断。
- 帧间隔按**同接口、有效时间戳的相邻 EtherCAT 帧**计算，基于完整序列；筛选仅影响展示，不改变计算基准。
- 默认称为“捕获帧间隔”，不能直接等同于总线周期或 DC 同步误差。

### WKC 解释边界

- 展示 WKC 实际值与变化；WKC 为 0 仅提示“需检查”，不自动判定通信故障。
- 无设备配置与预期参与数量时不推断期望 WKC；不臆测 PDO 内容。

## 协议依据

字段布局逐字节核对自权威来源，不凭记忆：

- EtherCAT 帧头 / 数据报头：ETG.1000.4 与 Wireshark `plugins/epan/ethercat/packet-ethercat-frame.c`、`packet-ethercat-datagram.c`。
  - 帧头 2 字节：Length（11 位，`0x07FF`）、Reserved（1 位，`0x0800`）、Type（4 位，`0xF000`）。
  - 数据报头 10 字节：Cmd(1) Idx(1) Address(4) LenWord(2) IRQ(2)；LenWord 中 Length（11 位）、C（位 14，循环帧）、M（位 15，后续数据报）；数据后跟 WKC（2 字节小端）。
  - 命令码 0x00–0x0E 为 15 个标准命令（NOP、APRD、APWR、APRW、FPRD、FPWR、FPRW、BRD、BWR、BRW、LRD、LWR、LRW、ARMW、FRMW）；0x0F 保留；0xFF 为扩展命令 EXT。命令字段共 1 字节（0x00–0xFF），其中低 16 个取值（0x00–0x0F）含保留值。未知命令保留原始值，不导致整份解析失败。
- PCAPNG：`draft-tuexen-opsawg-pcapng` 与 Wireshark `wiretap/pcapng.c`。Block Type 与 Block Total Length 使用所属 Section 的字节序；SHB 的 BOM 决定字节序。

## 安装与使用

### 开发

```bash
cd ethercat-analyzer
npm install
npm run dev        # 开发服务器
```

### 测试与构建

```bash
npm test           # Vitest 自动化测试
npm run build      # 类型检查 + 生产构建，产物在 dist/
```

### 离线使用（本地静态服务）

构建产物不依赖任何 CDN / 远程字体 / 在线接口，可通过任意静态服务器离线使用：

```bash
cd ethercat-analyzer
npm run build
npx serve dist -l 8080        # 或 python3 -m http.server 8080 -d dist
# 浏览器打开 http://localhost:8080/
```

> 不要求双击 HTML 通过 `file://` 运行（Worker 与模块加载需要 HTTP 服务）。

`vite.config.ts` 使用相对 `base: './'`：既保证部署到 GitHub Pages 子路径 `/test_ai_web/ethercat-analyzer/` 时 JS / CSS / Web Worker 正确加载，又不破坏上述本地静态服务离线使用。

### 在线访问（GitHub Pages）

仓库通过 GitHub Actions 构建并部署本工具到子路径（见仓库根目录 `.github/workflows/deploy.yml`）。部署后的目标地址（合并到 `main` 并启用 Pages 后生效）：

- https://jenskb.github.io/test_ai_web/ethercat-analyzer/

### 与现有工具（XML → BIN）的入口

本仓库包含两个相互独立的工具：

| 工具 | 位置 | 入口 | 说明 |
| --- | --- | --- | --- |
| XML → BIN 转换（原） | 仓库根目录 `index.html` + `app.js` | 直接双击打开，或静态服务仓库根目录 | 不受本工具影响 |
| EtherCAT 抓包分析（新） | `ethercat-analyzer/` | `npm run build` 后静态服务 `ethercat-analyzer/dist/` | 新增，二者互不影响 |

## 自动化测试

`npm test` 共 44 个用例，覆盖：

- PCAPNG 大端 / 小端、多 Section / 多接口 / 十进制与二进制时间分辨率、`if_tsoffset` / `if_name`。
- 无时间戳报文（SPB）、块对齐 / 未知块 / 已废弃报文块 / 损坏长度 / 截断文件 / 首尾长度不一致。
- 普通以太网、VLAN、叠加 VLAN、非 EtherCAT EtherType。
- 单数据报 / 多数据报 EtherCAT 帧、物理寻址（ADP/ADO）、逻辑寻址、数据长度、WKC、未知命令。
- EtherCAT 长度越界、后续数据报标志不一致。
- 帧间隔统计、时间戳倒退 / 相同时间戳、命令分布、CSV 转义。

测试数据包含**人工核对的固定字节样例**（`tests/fixtures.ts` 中的手写帧与完整 pcapng），并非仅由解析器反向生成。

## 已知限制

- 首版仅支持 Ethernet LinkType（`LINKTYPE_ETHERNET = 1`），其他链路类型明确提示，不默认当以太网。
- 本阶段不实现实时抓包、PDO 语义解码、完整邮箱协议（ADS/NV/RAW-IO）解析。
- 不假设捕获帧包含 FCS；以太网填充按 EtherCAT 帧头长度字段区分。
- 跨接口的相对时间对齐以每接口首个时间戳的浮点秒换算，仅作展示，不影响同接口帧间隔精度。

## 真实抓包验证（未完成，需用户本地执行）

当前 CI 环境无法访问 Windows 文件路径，且未提供 `twincat.pcapng`，因此以下项目**尚未用真实抓包验证**，不报告虚构结果：

- 真实 `twincat.pcapng` 的帧数、时间戳、数据报数量 / 命令 / 地址 / 数据长度 / WKC 与 Wireshark 的交叉核对。
- 真实文件下的性能（解析耗时、内存占用）。

**用户本地导入后验证步骤**：

> 没有真实抓包时，可先用 `node scripts/generate-sample.mjs` 生成样例 `sample.pcapng`（3 帧）验证工具可用。

1. 构建并启动本地服务（见上），浏览器打开页面。
2. 拖入或选择 `twincat.pcapng`，观察解析进度与概览统计（帧数、EtherCAT 帧数、数据报总数、命令分布）。
3. 在报文列表中随机选择若干帧，核对协议树中的 MAC、EtherCAT 帧头、数据报命令 / 地址 / 长度 / WKC 与 Wireshark 显示一致。
4. 点击协议字段，确认十六进制视图高亮到对应的原始字节。
5. 用命令 / WKC / 接口 / 帧序号范围 / 异常筛选，确认筛选不影响帧间隔值。
6. 导出帧摘要与数据报详情 CSV，用 Excel 打开确认无乱码、转义正确。
7. 解析中途点击“取消解析”，确认立即停止且资源释放；再次导入确认旧结果不残留。
8. （可选）本机若安装 `tshark`，用 `tshark -r twincat.pcapng -T fields -e frame.number -e eth.type -e ecat.cmd -e ecat.wkc` 交叉核对。

> 请勿将工业抓包上传到公开 Issue 或提交到仓库；本工具仅在本地解析。
