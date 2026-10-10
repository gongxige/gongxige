# Wild Frontier 1024 Ways（本机测试版）

5 × 4、1024 Ways 老虎机网页游戏，只在本机运行，只用虚拟积分。

- 开发计划与进度：[docs/DEVELOPMENT_PLAN.md](docs/DEVELOPMENT_PLAN.md)
- 开发日志：[docs/DEVLOG.md](docs/DEVLOG.md)

## 运行

```bash
npm install
npm start     # 一条命令同时启动本机测试服（API）和网页，然后打开 http://127.0.0.1:4173
```

- 按 Ctrl+C 两个一起停止。
- 已经有最新版本在运行时会直接复用，重复运行不会冲突；如果端口被旧版本 API 占着，会给出关闭它的命令。
- 改了 `src/engine/` 或 `server.mjs` 后，要先 Ctrl+C 再 `npm start`，API 才会用上新规则。
- 也可以分开启动：`npm run api` 和 `npm run dev`。

## 目录

```
src/engine/   游戏规则（纯逻辑 + 单元测试）
src/          React 界面（src/ui 为界面组件，src/game 为转动逻辑）
server.mjs    本机测试服（余额记账）
scripts/      工具脚本（RTP 报告）
docs/         计划、日志、归档
public/       运行时用到的图片（符号）
reference/    参考素材（不进 Git）
```
