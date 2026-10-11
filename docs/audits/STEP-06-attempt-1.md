# 审计报告：STEP-06 玩家网站：注册、登录、大厅、进入游戏（第 1 次）

- 时间：2026/10/11 08:26:46
- 审计的提交：260e769（比较起点 STEP-05-passed）
- 结果：**不通过**

---

## 结论
STEP-06 的验收标准没有全部达到：验收标准明确要求"在 DEVLOG 写清楚怎么验证的"，但 `docs/DEVLOG.md` 顶部完全没有新增 STEP-06 的记录（最新一条仍是 STEP-05），`docs/DEVELOPMENT_PLAN.md` 的阶段 7 清单里也没有加上 STEP-06 这一行。此外游戏页面没有提供任何"返回大厅"的按钮/链接，"转一局 → 返回大厅余额已更新"这条流程缺乏可靠的实现和验证记录；`platform-server.mjs` 里新增的一行路由是永远跑不到的死代码。判定 **FAIL**。

## 运行的检查
- `git diff --stat STEP-05-passed..HEAD` → 只改了 `platform-server.mjs`、`src/App.tsx`（原游戏 UI 拆分出去）、`src/GameApp.tsx`（新建，承接原游戏 UI）、`src/styles.css`、`vite.config.ts`、`docs/workflow/state.json`，没有碰 `src/engine/` 或流程文件，范围正常
- `npm run build` → 通过（tsc -b && vite build 成功）
- `npm test` → 43/43 通过
- `npm run check:provider` → 全部通过（签名、幂等、对账、回放、派彩重试、扣款超时、余额不足）
- `git diff STEP-05-passed..HEAD --check` → 无空白字符问题
- 人工审读 `src/App.tsx`、`src/GameApp.tsx`、`platform-server.mjs`、`src/styles.css`、`vite.config.ts`、`index.html`、`docs/DEVLOG.md`、`docs/DEVELOPMENT_PLAN.md`
- 因沙箱不允许运行 `npm start`/`npm run dev`（不在审计允许的命令清单里），未能在浏览器里实测注册→登录→大厅→进入游戏→转一局→返回大厅的完整流程；这正是验收标准要求 Codex 自己验证并写进 DEVLOG 的内容，而 DEVLOG 里什么都没写

## 问题
- [严重] `docs/DEVLOG.md` — 没有新增 STEP-06 的记录，验收标准第 2 条明确要求"在 DEVLOG 写清楚怎么验证的"，完全没有做到；也违反 `CLAUDE.md`/`AGENTS.md`/`PLATFORM_TASK.md` 里"每完成一项都要在 DEVLOG 顶部记一笔"的强制要求 — 必须补上，写清楚具体怎么测的注册、登录、大厅、进入游戏、转一局、返回大厅余额更新。
- [严重] `docs/DEVELOPMENT_PLAN.md` — 阶段 7 的勾选列表里没有新增/勾选 STEP-06 对应的行，违反"每完成一项工作就更新勾选状态"的要求 — 必须补上。
- [中等] `src/GameApp.tsx`（整体）— 游戏画面里找不到任何"返回大厅"的按钮或链接（只有会话失效时才出现的 `打开平台大厅` 提示，且默认指向 `http://127.0.0.1:8788` 而不是真正提供登录/大厅页面的 `4173`）。正常对局结束后玩家唯一能回大厅的办法是浏览器"后退"，而进入游戏用的是 `location.assign(gameUrl)`（整页跳转，推入新的历史记录），后退命中浏览器 bfcache 时很可能直接恢复跳转前那一刻的大厅页面状态，而不会重新请求 `/games/wild-frontier/balance`，余额显示不一定是转完之后的最新值。验收标准明确要求"返回大厅余额已更新"这条链路，现在既没有在界面上提供可靠的返回方式，也没有在 DEVLOG 写验证过程，这条验收标准实质上没有被确认过。
- [轻微] `platform-server.mjs:156-157` — 新增的 `if (req.method === 'GET' && url.pathname === '/') { res.writeHead(302, { location: 'http://127.0.0.1:4173/' }); return res.end(); }` 紧跟在已存在的同条件 `if (...) return html(res, 200, '...演示平台...')` 之后，由于前一个 `if` 一定先匹配并 `return`，这一行新代码永远不会被执行，是死代码。应该删掉旧的占位 HTML 分支，让这行重定向真正生效（或者干脆删掉这个新增分支，说明为什么不需要）。

## 给 Codex 的修改要求
1. 在 `docs/DEVLOG.md` 顶部补一条 STEP-06 记录：写清楚做了什么、怎么手工验证了"注册 → 登录 → 大厅 → 进入游戏 → 转一局 → 返回大厅余额已更新"这条完整链路（包括具体用什么账号、投注、余额变化数字），以及还遗留什么问题。
2. 在 `docs/DEVELOPMENT_PLAN.md` 阶段 7 的清单里加上 STEP-06 对应的勾选行。
3. 在 `src/GameApp.tsx`（或 `TopBar`/`ControlBar`）里加一个明确的"返回大厅"按钮/链接，直接导航回大厅页面（`/`，不带 token，同源 4173），而不是只依赖浏览器后退；让"返回大厅余额已更新"这条验收标准有确定、可重复的实现，而不是依赖浏览器缓存行为。
4. 修掉 `platform-server.mjs:156-157` 的死代码：删除旧的占位 HTML 分支或删除新加的重定向分支，二者留一个能真正生效的。
5. 修完后重新跑 `npm run build`、`npm test`、`npm run check:provider`，并在浏览器里真的走一遍注册→登录→大厅→进入游戏→转一局→点"返回大厅"确认余额已更新，再把结果写进 DEVLOG。

VERDICT: FAIL
