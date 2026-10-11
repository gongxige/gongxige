# 任务说明：把游戏免费部署到云上（阶段 7）

> 给 Claude Code 的任务书。做完每个检查点就停下来，等用户把结果交给审计（Claude Cowork）看过再继续。
> 开工前先读 `CLAUDE.md`、`docs/DEVELOPMENT_PLAN.md`、`docs/PROVIDER_API.md`。

## 目标

用户在做调研和学习，想体验"游戏供应商把游戏放到公网、平台通过公网对接"的真实感觉。要求：

- **全部用免费额度**，不买域名、不买服务器。
- **仍然只用虚拟积分**，没有充值、提现、真实货币。
- 本机的 `npm start` 必须继续能用，并且不需要任何云账号。

## 选用的免费服务（2026-10 调研结果，开工时请到官网再确认一次）

| 用途 | 服务 | 免费额度要点 |
|---|---|---|
| 游戏服务器 + 游戏网页 | Render 免费 Web Service | 512 MB / 0.1 CPU；15 分钟没人访问就休眠，再次访问约 1 分钟唤醒；每个工作区每月 750 小时；硬盘是临时的，重启后文件全部丢失 |
| 模拟平台 | 第二个 Render 免费 Web Service | 同上 |
| 数据库 | Neon 免费 Postgres | 长期免费、不需要信用卡；每个项目 1 GB；5 分钟没用就自动暂停，下次查询自动唤醒 |
| 代码仓库 | GitHub（**私有**仓库） | Render 从这里拉代码部署 |

不要用 Render 自带的免费 Postgres：它 30 天后过期，数据会被删除。

## 目标架构

```
玩家浏览器 ──https──▶ game 服务（Render）：server.mjs 同时提供 /api/* 和打包好的网页（dist/）
                         │  ▲
            /wallet/*    │  │ /provider/launch
                         ▼  │
                     platform 服务（Render）：mock-operator.mjs
                         │
     两个服务各自连 Neon ─┘（同一个 Neon 项目里分两个数据库：game、platform）
```

## 第 0 步：先把阶段 6 收尾（检查点 0）

阶段 6（供应商对接）的代码在工作区里还**没有提交**，`npm run build` 也还没在本机跑过。

1. 运行 `npm install`、`npm run build`、`npm test`、`npm run check:provider`，修好所有错误。
2. 浏览器里走一遍：`npm start` → 打开 http://127.0.0.1:8788 → 进入游戏 → 转几局 → 点局号看回放。
3. 分几次小提交，把阶段 6 提交到 Git（提交说明写清楚做了什么）。

**停下，等审计。**

## 第 1 步：代码改造（检查点 1）

### 1. 存储层：JSON 和 Postgres 二选一

- 新建存储模块（例如 `server/store/`）：没有 `DATABASE_URL` 时用现在的 JSON 文件（本机模式），有就用 Postgres（云上模式）。游戏服务器和模拟平台都通过这个模块读写，不再直接读写文件。
- 用官方的 `pg` 包，锁定确切版本号（不用 `latest`、不用 `^`）。
- 表结构（名字可以调整，但要在文档里写清楚）：
  - game 库：`sessions`、`player_state`（免费游戏进度）、`rounds`（只插入，不更新、不删除）、`round_settlements`、`pending_wallet_calls`
  - platform 库：`players`、`transactions`（交易号作主键，保证同一交易号只处理一次）
- 涉及钱的操作要放在**数据库事务**里：扣款时检查余额和写流水必须是一个事务，并发时不能扣成负数，也不能重复扣（用 `SELECT … FOR UPDATE` 或带条件的 `UPDATE`）。
- 启动时自动建表（`CREATE TABLE IF NOT EXISTS`），或者写成一个 `npm run db:migrate` 脚本。
- 现在"同一玩家同时只处理一局"靠内存里的 `busy`，只在单进程有效。云上也只跑一个进程，保留即可，但要在文档里注明。

### 2. 能在 Render 上运行

- 监听 Render 给的 `PORT` 环境变量，地址用 `0.0.0.0`（本机仍是 `127.0.0.1`）。
- 生产模式下由 `server.mjs` 直接提供 `dist/` 里的网页（含 `/reels/*.png`），和 `/api` 同一个域名，不需要 Vite 开发服务器，也不需要 CORS。
- 地址全部由环境变量决定：`GAME_WEB_URL`（游戏公网地址）、`OPERATOR_URL`（平台公网地址）、`PROVIDER_URL`（平台眼中的游戏服务器地址）。
- 新增 `render.yaml`（Render Blueprint）：两个免费 Web Service，Node 24；build 命令和 start 命令写清楚；所有密钥标成"在 Render 后台填写"，不写进文件。

### 3. 上公网后的安全

- 生产环境下 `OPERATOR_SECRET` 必须通过环境变量设置，而且不能等于 `local-demo-secret`，否则拒绝启动。
- 模拟平台的大厅和 `/admin/*`（加积分、故障模拟、查看流水）要加登录保护：最简单的 HTTP Basic Auth，密码来自环境变量 `LOBBY_PASSWORD`。`/wallet/*` 继续用签名，不用密码。
- 游戏服务器的 `/api/rounds/*`、`/api/replay/*` 在生产环境也要保护（同样用 Basic Auth，或者只允许签名访问），因为里面有玩家编号。
- 请求体大小、错误信息不要泄露内部细节（堆栈、数据库连接串）。
- `.gitignore` 确认包含 `data/`、`reference/`、`.env*`，仓库里不能出现任何密钥或 `DATABASE_URL`。

### 4. 免费服务休眠带来的问题（必须处理）

两个服务 15 分钟没人用会休眠，唤醒要约 1 分钟：

- 平台调 `/provider/launch` 时，游戏服务器可能正在睡。启动游戏这一步的超时要放宽（例如 90 秒），或者大厅先显示"游戏服务器唤醒中…"并自动重试。
- 游戏服务器调钱包时，平台也可能在睡（例如玩家在游戏里停了很久）。扣款超时现在是 3 秒，会直接取消本局。要想一个合理的办法，例如：进入游戏时（`/api/session`）先唤醒平台；或者扣款前先 ping 一下平台。在文档里说明选了哪种、为什么。
- Neon 暂停后第一次查询也会慢几秒，数据库连接要设置合理的超时和重试。

### 5. 检查

- `npm test`、`npm run build` 通过。
- `npm run check:provider` 在本机 JSON 模式下通过；再加一种方式在 Postgres 模式下跑（例如环境变量指定一个测试用的 Neon 数据库），并补测：**同一玩家并发 20 次扣款不会扣成负数、不会重复扣**。
- 本机 `npm start` 不需要任何云账号，行为和阶段 6 一样。

**停下，等审计。**

## 第 2 步：部署（检查点 2）

这一步需要用户本人注册账号、点按钮。Claude Code 负责写一份**中文、一步一步、给新手看**的 `docs/DEPLOY.md`，并在用户操作时指导：

1. 注册 GitHub，建**私有**仓库，推送代码。
2. 注册 Neon，建项目，建 `game` 和 `platform` 两个数据库，复制连接串。
3. 注册 Render，用 `render.yaml` 创建两个服务，在后台填环境变量（连接串、`OPERATOR_SECRET`、`LOBBY_PASSWORD`、各服务的公网地址）。
4. 部署完成后验证：手机打开平台大厅 → 输入密码 → 进入游戏 → 转几局 → 看流水和对账 → 点局号回放 → 试一次故障模拟。
5. 记下两个服务的公网地址，写进 DEVLOG（不要写密码和连接串）。

**停下，等审计。**

## 注意

- 符号图片是从参考视频里截的（开发计划里已经写明"公开发布必须替换"）。公网地址只自己看、不要到处分享；仓库保持私有。如果要分享给别人看，先换成自己的素材。
- 每完成一步：更新 `docs/DEVELOPMENT_PLAN.md`（新增"阶段 7"）的勾选状态，并在 `docs/DEVLOG.md` 顶部记一笔（做了什么、怎么验证、遗留问题）。
- 遇到免费额度和本说明不一致（比如服务改了规则），先告诉用户，不要擅自换成收费方案。
