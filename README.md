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

## GitHub Pages 部署

仓库通过 GitHub Actions 自动构建并部署到 GitHub Pages（推送 `main` 后自动发布，见 `.github/workflows/deploy.yml`）。

| 页面 | 网址 |
| --- | --- |
| XML 转 BIN（原，保持不变） | https://jenskb.github.io/test_ai_web/ |
| EtherCAT 抓包分析 | https://jenskb.github.io/test_ai_web/ethercat-analyzer/ |

> 上表为部署后的目标地址：在合并到 `main`、完成下方 Pages 设置并触发一次部署后才会生效。
> EtherCAT 抓包分析使用 Vite 相对 `base: './'` 构建，JS / CSS / Web Worker 在该子路径下正常加载，同时仍可通过本地静态服务离线使用。

### 仓库所有者需要做的 Pages 设置（一次性）

若尚未启用，请在 GitHub 仓库页面完成以下设置，否则 Actions 部署无法发布：

1. 打开仓库 **Settings → Pages**。
2. **Source** 选择 **GitHub Actions**（当前为 `Deploy from a branch` 的 legacy 模式，需切换）。
3. 保存后，推送 `main`（或手动触发 `Deploy GitHub Pages` workflow）即会发布，地址见上表。
