# 审计报告：STEP-06 玩家网站：注册、登录、大厅、进入游戏（第 2 次）

- 时间：2026/10/11 11:04:34
- 审计的提交：9077cf9（比较起点 STEP-05-passed）
- 结果：**通过**

---

## 结论
STEP-06（第 2 次）验收标准均已达到：`npm run build`、`npm test`（43/43）、`npm run check:provider` 全部通过；代码静态审读确认"注册→登录→大厅→进入游戏→转一局→返回大厅余额已更新"这条链路逻辑自洽（新增 10,000 演示积分在同一事务内写入账本，大厅通过 `/games/wild-frontier/balance` 独立拉取余额，游戏页新增同源 `href="/"` 的"返回大厅"链接触发整页重新加载，不依赖浏览器后退缓存）。第 1 次审计提出的四项问题（DEVLOG 缺记录、DEVELOPMENT_PLAN 未勾选、无"返回大厅"入口、`/` 路由死代码）均已修复。未发现严重或中等问题，判定 **PASS**。

## 运行的检查
- `git log STEP-05-passed..HEAD` / `git diff --stat` → 确认本次改动范围（App.tsx 拆分出 GameApp.tsx、新增平台登录/大厅页、platform-server.mjs 新增 `/games/*` 路由与 `/` 重定向、ledger.mjs 注册赠送积分、vite.config.ts 新增代理、styles.css 新增平台页样式、workflow 工具与文档）
- `npm test` → 43/43 通过（含新增断言：注册账号余额为 10,000）
- `npm run build` → 通过（`tsc -b && vite build`）
- `npm run check:provider` → 全部通过（签名、幂等、对账、回放、派彩重试、扣款超时、余额不足）
- `git diff STEP-05-passed..HEAD --check` → 无空白字符问题
- 人工审读 `src/App.tsx`、`src/GameApp.tsx`（新建）、`platform-server.mjs`、`server/platform/ledger.mjs`、`server/platform/auth.mjs`、`vite.config.ts`、`src/styles.css`、`index.html`、`docs/DEVLOG.md`、`docs/DEVELOPMENT_PLAN.md`
- 尝试以隔离端口实际启动 `platform-server.mjs` / `server.mjs` 手工复现完整浏览器链路：该操作被本次审计沙箱的权限策略拒绝（仅 `npm test`/`npm run build`/`npm run check:provider`/`git diff`/`git log`/`git status` 等命令被放行），因此以静态代码追踪 + 现有自动化检查结果为依据，未能亲自用浏览器复核，与 Codex 在 DEVLOG 中说明的限制一致

## 问题
- [轻微] `vite.config.ts:12` — 新增的 `/auth`、`/games` 代理硬编码 `http://127.0.0.1:8788`，不像同文件 `/api` 代理那样读取环境变量（`API_PORT`）。默认端口下不影响验收，但若用 `OPERATOR_PORT` 自定义平台端口（项目其余脚本都支持），网页登录/大厅接口会连不上。
- [轻微] `platform-server.mjs:156` — `/` 重定向目标硬编码 `http://127.0.0.1:4173`，同样不跟随 `WEB_PORT` 环境变量，与上一条是同一类不一致。
- [轻微] `server/platform/auth.mjs:35` — 新注册账号固定获得 10,000 演示积分，是为弥补 STEP-07 充值页尚未上线的临时手段（已在代码注释和 DEVLOG 中说明，且全部走账本事务、不涉及真实货币）。等 STEP-07 充值/提现页面完成后，建议重新评估是否需要保留或改为按需发放，避免长期留有"无限重复注册即可无限领取演示积分"的设计，虚拟积分无资金风险，仅为设计整洁性建议。

## 给 Codex 的修改要求
无需修改（PASS）。上面三条轻微建议可在后续步骤（尤其 STEP-07 涉及端口/充值逻辑时）顺手处理，不阻塞本步通过。

VERDICT: PASS
