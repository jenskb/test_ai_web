# 验证与真实文件

## 测试覆盖（自动化，Vitest）

`npm test` 运行 33 个用例，覆盖：

- PCAPNG 大端与小端字节序。
- 多 Section、多接口、不同时间分辨率（十进制 / 二进制）、`if_tsoffset`。
- 无时间戳报文（SPB，不伪造时间戳）。
- 块对齐、未知块跳过、废弃 Packet Block 告警、损坏块长度、截断文件。
- 普通以太网、单/叠加 VLAN。
- 单数据报与多数据报 EtherCAT 帧。
- 物理寻址（ADP/ADO）与逻辑寻址（32 位逻辑地址）、数据长度、WKC。
- 未知命令。
- EtherCAT 长度越界、后续数据报标志不一致、WKC=0 标记、以太网填充。
- 命令分布、帧间隔统计（min/max/均值/标准差）、时间戳倒退标记。

测试数据为手工构造的固定字节样例（`src/test/helpers.ts`），并非由被测解析器的反向逻辑生成；
关键字段（命令码、帧头 Type、数据报 IRQ/标志位布局等）依据 Wireshark dissector 源码核对。

## 与 Wireshark / tshark 交叉核对

当前 Linux CI 环境未安装 `tshark`（`which tshark` 返回空），**未执行**与 Wireshark 的自动交叉核对。

字段布局依据已通过抓取 Wireshark 源码（`plugins/epan/ethercat/packet-ethercat-frame.c` 与
`packet-ethercat-datagram.c`）人工核对，见
[协议支持范围与依据](protocol-support.md)。

## 真实抓包文件（twincat.pcapng）

**未验证。**

- 需求中的 `twincat.pcapng` 位于 Windows 路径，在当前 Linux CI 环境不存在；浏览器也无法直接
  读取该本机路径。
- 因此未执行真实文件集成测试，也未报告任何虚构的验证结果。

如需真实文件验证，请将 `twincat.pcapng` 作为附件提供，或放入仓库外的本地目录后在本机
`npm install && npm run dev` 导入；若本机装有 Wireshark/`tshark`，可额外交叉核对：
EtherCAT 帧数量、代表性帧时间戳、数据报数量、命令、地址、数据长度与 WKC。

## 实测构建与运行环境

- Node.js `v24.22.1`，npm `11.19.1`，Linux x64（GitHub Actions）。
- 测试耗时约 0.5 s（33 用例）；生产构建约 0.65 s（42 模块）。
- 未在真实大抓包文件上做性能基准，故不做未经测量的性能保证。
