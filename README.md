# Wild Frontier 1024 Ways（本机测试版）

5 × 4、1024 Ways 老虎机网页游戏，只在本机运行，只用虚拟积分。

按"游戏供应商"的方式搭建：游戏服务器只决定结果、记录每一局；玩家和余额在**模拟平台**那边，每转一次游戏服务器都去平台钱包扣款、派彩。接口见 [docs/PROVIDER_API.md](docs/PROVIDER_API.md)。

- 开发计划与进度：[docs/DEVELOPMENT_PLAN.md](docs/DEVELOPMENT_PLAN.md)
- 开发日志：[docs/DEVLOG.md](docs/DEVLOG.md)

## 运行

```bash
npm install
npm start     # 一条命令同时启动模拟平台、游戏服务器和网页
```

然后打开**平台大厅** http://127.0.0.1:8788 ，选一个玩家点"进入游戏"。
大厅里能看到每笔扣款、派彩、对账结果，点局号可以看回放，还能模拟平台故障。

- 按 Ctrl+C 两个一起停止。
- 已经有最新版本在运行时会直接复用，重复运行不会冲突；如果端口被旧版本 API 占着，会给出关闭它的命令。
- 改了 `src/engine/`、`server.mjs` 或 `mock-operator.mjs` 后，要先 Ctrl+C 再 `npm start`，才会用上新代码。
- 也可以分开启动：`npm run operator`、`npm run api` 和 `npm run dev`。
- 端到端检查：`npm run check:provider`（用临时端口和临时数据，不影响存档）。

## 自动开发（Codex 写，Claude Code 审计）

```bash
npm run autopilot
```

按 `docs/WORKFLOW_PLAN.md` 一步一步来：Codex 写完一步 → 自动提交 Git → Claude Code 审计 → 通过就打标签 `STEP-xx-passed` 进入下一步，不通过就把审计报告交回 Codex 重做。

- 需要先安装并登录 Codex CLI（`codex`）和 Claude Code（`claude`）。
- 进度：`docs/workflow/PROGRESS.md`；审计报告：`docs/audits/`；运行日志：`.autopilot/logs/`。
- 中途停止：Ctrl+C，或新建空文件 `.autopilot/STOP`（做完当前这步再停）。再运行就接着做。
- 同一步连续 4 次不通过会停下，写 `docs/workflow/BLOCKED.md`；看完删掉它再运行即可。
- 回退到某一步通过时：`git reset --hard STEP-xx-passed`。

## 目录

```
src/engine/   游戏规则（纯逻辑 + 单元测试）
src/          React 界面（src/ui 为界面组件，src/game 为转动逻辑）
server.mjs    游戏服务器（供应商）：出结果、记录每一局、调平台钱包
server/       游戏服务器的辅助模块（签名、局记录、回放页面）
mock-operator.mjs  模拟平台：玩家、余额、钱包接口、大厅页面
scripts/      工具脚本（启动、RTP 报告、端到端检查）
docs/         计划、日志、归档
public/       运行时用到的图片（符号）
reference/    参考素材（不进 Git）
```
