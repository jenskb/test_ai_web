这是一个云端 AI 测试项目，包含两个相互独立的离线前端工具。

## 工具与入口

| 工具 | 位置 | 访问入口 | 说明 |
| --- | --- | --- | --- |
| XML 转 BIN | 仓库根目录 `index.html` + `app.js` | 直接双击 `index.html`，或用静态服务仓库根目录 | ESI XML → EtherCAT SII `.bin` 转换（vanilla JS） |
| EtherCAT 抓包分析 | `ethercat-analyzer/` | `npm run build` 后用静态服务 `ethercat-analyzer/dist/` | 离线 PCAPNG / EtherCAT 帧与数据报解析（React + TS + Vite + Web Worker） |

两个工具互不影响：EtherCAT 抓包分析在独立子目录 `ethercat-analyzer/`，不修改根目录的 `app.js` / `index.html`。

## EtherCAT 抓包分析（新）

安装、开发、测试、构建与离线使用说明见 [`ethercat-analyzer/README.md`](ethercat-analyzer/README.md)。

```bash
cd ethercat-analyzer
npm install
npm run dev          # 开发
npm test             # 自动化测试（44 个用例）
npm run build        # 生产构建（产物不依赖 CDN / 远程字体 / 在线接口）
```

构建后离线使用：

```bash
cd ethercat-analyzer
npm run build
npx serve dist -l 8080        # 或 python3 -m http.server 8080 -d dist
```
