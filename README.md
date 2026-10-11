# Wild Frontier 1024 Ways（本机测试版）

5 × 4、1024 Ways 老虎机网页游戏，加一个**模拟博彩平台**（玩家网站 + 管理后台），只在本机运行，**只用虚拟积分**：不接任何真实支付、银行或加密货币，充值和提现都是"提交申请 → 后台审核"的演示流程。

按"游戏供应商"的方式搭建：游戏服务器只决定结果、记录每一局；玩家和余额在平台那边，每转一次游戏服务器都带签名去平台钱包扣款、派彩。接口见 [docs/PROVIDER_API.md](docs/PROVIDER_API.md)，平台设计见 [docs/PLATFORM_DESIGN.md](docs/PLATFORM_DESIGN.md)。

- 开发计划与进度：[docs/DEVELOPMENT_PLAN.md](docs/DEVELOPMENT_PLAN.md)
- 开发日志：[docs/DEVLOG.md](docs/DEVLOG.md)

## 运行

建议使用 Node.js 24（平台数据库用的是 Node 内置的 `node:sqlite`）。

```bash
npm install
npm start     # 一条命令同时启动平台服务（8788）、游戏服务器（8787）和网页（4173）
```

启动后终端会打印两个网址：

- **玩家网站** http://127.0.0.1:4173/ ：注册账号（送 10,000 演示积分）→ 登录 → 大厅进入游戏；还有我的钱包（充值/提现申请、资金记录）、游戏记录（点局号看回放）、个人中心（改密码）。
- **管理后台** http://127.0.0.1:4173/admin ：概览、玩家管理（搜索、冻结/解冻、填原因手动调整余额）、充值审核、提现审核、交易流水、游戏记录、对账、故障模拟、操作日志。

**管理员密码在哪看**：用户名是 `admin`。第一次启动（还没有管理员时）平台会生成一个随机密码，只在终端打印一次，那一行以 `[平台] 首次启动：已创建管理员账号 admin，初始密码 …` 开头。忘了就运行：

```bash
npm run admin:password
```

它会给 `admin` 重新生成一个随机密码并打印出来，立即生效。

其他说明：

- 玩家、钱包、流水、审核、操作日志存在 `data/platform.sqlite`；每一局的永久记录在 `data/*.rounds.jsonl`。`data/` 不进 Git。
- 按 Ctrl+C 全部停止。已经有最新版本在运行时会直接复用，重复运行不会冲突；端口被旧版本占着时会给出关闭它的命令。
- 改了 `src/engine/`、`server.mjs`、`platform-server.mjs` 或 `server/` 下的代码后，要先 Ctrl+C 再 `npm start`，才会用上新代码。
- 也可以分开启动：`npm run platform`、`npm run api` 和 `npm run dev`。
- `npm run operator` 是早期的简易模拟平台（`mock-operator.mjs`，自带大厅页面），和上面的平台二选一，不要同时占用 8788 端口。

## 检查

```bash
npm test                 # 单元测试和接口测试
npm run build            # TypeScript 检查 + 生产构建
npm run check:provider   # 供应商端到端：签名、去重、连转对账、回放、派彩故障、扣款超时、余额不足
npm run check:platform   # 平台端到端：注册 → 充值申请 → 后台通过 → 玩 50 局 → 提现 → 后台通过 → 对账一致，
                         # 另测余额不足不能提现、冻结金额不能下注、同一提现不能通过两次、同时 20 次下注不会扣成负数
npm run rtp              # 返奖率报告（改了 src/engine/ 后运行）
```

两个端到端检查都用临时端口和临时数据，不影响你的存档。

## 自动开发（Codex 写，Claude Code 审计）

```bash
npm run autopilot
```

按 `docs/WORKFLOW_PLAN.md` 一步一步来：Codex 写完一步 → 自动提交 Git → Claude Code 审计 → 通过就打标签 `STEP-xx-passed` 进入下一步，不通过就把审计报告交回 Codex 重做。

- 需要先安装并登录 Codex CLI（`codex`）和 Claude Code（`claude`）。
- 进度：`docs/workflow/PROGRESS.md`；审计报告：`docs/audits/`；运行日志：`.autopilot/logs/`。
- 中途停止：Ctrl+C，或新建空文件 `.autopilot/STOP`（做完当前这步再停）。再运行就接着做。
- 同一步连续 4 次不通过会停下，写 `docs/workflow/BLOCKED.md`；看完删掉它再运行即可。Codex 运行环境出错或用量额度用完时也会停下写 `BLOCKED.md`，这种情况不计入尝试次数。
- 人工开发模式：`AUTOPILOT_DEV=manual npm run autopilot` 不调用 Codex，只审计已经提交的代码（总结写在 `.autopilot/manual-summary.md`）；不通过就停下，不自动重试。
- 回退到某一步通过时：`git reset --hard STEP-xx-passed`（会丢掉之后的改动）。

## 目录

```
src/engine/        游戏规则（纯逻辑 + 单元测试）
src/               React 界面：App.tsx 玩家网站，GameApp.tsx 游戏，admin/ 管理后台，ui/ 与 game/ 为游戏界面和转动逻辑
src/platform/      平台的接口测试
server.mjs         游戏服务器（供应商）：出结果、记录每一局、调平台钱包
platform-server.mjs  平台服务：玩家账号、钱包接口、玩家网站和后台的接口
server/            辅助模块（签名、局记录、回放页面）；server/platform/ 为平台的数据库、记账、登录、后台
mock-operator.mjs  早期的简易模拟平台（npm run operator）
scripts/           工具脚本（启动、RTP 报告、两个端到端检查、管理员密码、自动开发）
docs/              计划、设计、日志、审计报告
public/            运行时用到的图片（符号）
reference/         参考素材（不进 Git）
```
