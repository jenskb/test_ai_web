# EtherCAT 抓包分析（离线 PCAPNG 解析）

一个完全在浏览器本地运行的离线 EtherCAT 抓包分析网页。React + TypeScript + Vite，
使用 Web Worker 解析、虚拟滚动列表，运行时无 CDN / 远程字体 / 在线 API / 后端依赖。

> 本目录是独立子项目，与仓库根目录的 XML→BIN 工具互不影响。

## 功能

- **文件导入**：选择或拖放 PCAPNG 文件，本地解析不上传；支持进度、取消、错误/告警摘要。
- **概览**：报文总数、EtherCAT 帧数、数据报总数、时间范围、命令分布、解析异常数。
- **报文列表**：虚拟滚动，按命令、WKC、接口、帧序号范围、异常筛选；显示相对时间、同接口帧间隔、MAC、帧长、命令/WKC 摘要、异常标识。
- **协议详情**：以太网 / EtherCAT 帧头 / 数据报树形展开，十六进制视图（偏移 + HEX + ASCII），点击字段高亮对应字节，原始数据可复制。
- **时间统计**：按接口展示捕获帧间隔曲线与分布、最小值/最大值/均值/标准差；标记时间戳倒退与相同时间戳；大数据量降采样。
- **导出**：筛选后的数据报详情 / 帧摘要导出为 CSV（UTF-8，兼容 Windows Excel）。

## 安装与开发

需要 Node.js ≥ 18。

```bash
cd ethercat-viewer
npm install
npm run dev        # 开发服务器
npm run build      # 类型检查 + 构建到 dist/
npm run preview    # 本地预览构建产物
npm test           # 运行 Vitest 测试
```

## 构建与离线使用

```bash
npm run build
```

构建产物在 `dist/`。它是纯静态资源，可通过任意本地静态服务离线使用，例如：

```bash
# 方式一：使用内置 preview
npm run preview

# 方式二：任意静态服务器
npx serve dist            # 或 python -m http.server -d dist 8080
```

不要求双击 HTML 后通过 `file://` 运行。运行时无需网络。

## 目录结构

```
src/
  types.ts            # 共享类型
  pcapng/             # PCAPNG 解析（SHB/IDB/EPB/SPB、字节序、tsresol、BigInt）
  ethernet/           # 以太网解析（MAC、EtherType、VLAN 叠加）
  ethercat/           # EtherCAT 解析（帧头、数据报、命令、WKC）
  stats/              # 统计（命令分布、帧间隔、降采样）
  core/               # 编排（parse）与时间补充（time）
  worker/             # 解析 Web Worker
  utils/              # 格式化、CSV、筛选
  hooks/              # 解析生命周期 hook
  components/         # 界面组件
  test/               # 测试辅助（手工构造字节）
```

## 文档

- [架构与设计](docs/architecture.md)
- [协议支持范围与依据](docs/protocol-support.md)
- [验证与真实文件](docs/validation.md)

## 已知限制

- 首版仅支持 Ethernet LinkType（`LINKTYPE_ETHERNET = 1`），其它链路类型仅记录报文并给出提示，不解析 EtherCAT。
- 不解析 PDO 语义、邮箱协议（CoE/SoE/EoE/FoE）与 ESI 映射；ESI/PDO 映射扩展点以接口形式预留。
- 不实现实时抓包。
