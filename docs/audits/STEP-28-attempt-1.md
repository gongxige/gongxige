# 审计报告：STEP-28 麻将连连胡游戏画面：牌面和基本旋转（第 1 次）

- 时间：2026/10/12 05:57:12
- 审计的提交：a464545（比较起点 STEP-27-passed）
- 结果：**通过**

---

## 结论
STEP-28 第 1 次通过验收：新增的 `/mahjong` 页面（SVG 自绘牌面、4-5-5-5-4 盘面、余额/投注/赢分、旋转、规则赔付弹窗）范围没有越界，`src/engine/`（Wild Frontier）和 `src/mahjong/engine/`（本游戏数学）均未被改动；画面展示的牌面逐列落定后严格等于服务器 `/api/spin` 返回的 `initialBoard`/`finalBoard`，没有自造结果。`npm run build`、`npm test`（85/85）、`npm run check:provider` 全部通过。手工核算三种目标分辨率（1366×768、844×390、390×844）下的 CSS 尺寸公式，盘面与按钮都落在舞台范围内，不会出现滚动条。规则弹窗文案（倍数序列 ×1/2/3/5、×2/4/6/10，胡 10+2×(n-3) 次，上限 1708 倍）与 `docs/MAHJONG_DESIGN.md` 一致。没有发现使用参考游戏图片、标志或代码的痕迹。DEVLOG 和 DEVELOPMENT_PLAN 均已正确更新。

## 运行的检查
- `git diff STEP-27-passed..HEAD --stat` → 确认改动仅限 `src/mahjong/MahjongApp.tsx`（新）、`src/mahjong/MahjongTile.tsx`（新）、`src/App.tsx`（加一行路由）、`server.mjs`（`/api/session` 多返回 `allowedBets`）、`src/styles.css`（新增 `.mj-*` 样式块）、`docs/DEVLOG.md`、`docs/DEVELOPMENT_PLAN.md`、`docs/workflow/state.json`；`git diff --stat -- src/engine` 为空，确认 Wild Frontier 引擎未被动
- `npm run build` → 通过（`tsc -b && vite build` 无错误）
- `npm test` → 通过，85/85
- `npm run check:provider` → 全部通过（含"麻将连连胡连续旋转""派彩故障进入补发""扣款超时自动回滚"等既有断言，确认 `server.mjs` 的改动没有破坏多游戏会话、钱包对账逻辑）
- 对照 `docs/MAHJONG_DESIGN.md` 第 3.3/4 节核对 `MahjongApp.tsx` 引入的 `CASCADE_MULTIPLIERS`/`FREE_CASCADE_MULTIPLIERS`/`MAX_WIN_MULTIPLIER` 常量值（均来自 `src/mahjong/engine/index.ts` 的已有导出，未在本步重新定义或篡改）
- 手工按 `styles.css` 的 `cqw`/`cqh` 容器查询公式，分别推算 1366×768（桌面，`.stage` 为 min(100vw, dvh*16/9) ≈ 1365×768）、844×390（手机横屏，`.stage` 为 100dvw×100dvh）、390×844（手机竖屏，`.stage` 旋转 90° 后布局盒仍是 844×390）三种情形下 `--mj-cell`、`.mj-board`/`.mj-col` 的实际像素尺寸，确认 23 格牌面和底部/顶部控制条都落在舞台内，不会触发 `.stage` 的 `overflow:hidden` 裁切或页面滚动条

## 问题
无严重或中等问题。

轻微：
- [轻微] `src/styles.css`（`.mj-board` 规则，约对应新增块第 5 行）— `.mj-board` 的 `height` 用 `calc(5 * var(--mj-cell) + 4 * var(--mj-gap) + 2cqw)` 只补偿了上下 `padding`（`2cqw`），没有把自身 `.35cqw` 的上下 `border`（共 `0.7cqw`）算进去；由于全局 `box-sizing: border-box`，`.mj-col` 的实际内容区会比这个高度紧半个 `border` 宽度（约等于个位数像素），可能让牌面在顶/底边框内侧轻微顶出一点。不影响整局可玩性、不会出现滚动条，建议之后把该行改成 `+ 2cqw + .7cqw`（或给 `.mj-board` 加 `overflow: hidden` 裁掉这点溢出）。
- [轻微] `src/mahjong/MahjongApp.tsx:103`（`filler` 用 `useMemo(..., [])`）— 每次旋转时的"滚动中"填充牌固定不变，只靠 CSS 循环滚动，视觉上每次转动看到的都是同一批牌面图案；STEP-29 做逐列动画时建议改成每次旋转重新随机，手感会更真实（当前属于"基本旋转"范围内可接受的简化）。

## 给 Codex 的修改要求
无（PASS，上述两条轻微建议留给 STEP-29 或后续顺手处理即可，不要求本次返工）。

VERDICT: PASS
