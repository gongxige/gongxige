# 审计报告：STEP-46 玉兔送财使用本机背景、中国结格子和奖金牌匾（第 1 次）

- 时间：2026/10/12 20:34:26
- 审计的提交：3411faf（比较起点 STEP-45-passed）
- 结果：**不通过**

---

## 结论
大部分已经做到：主背景、按 layout.json 对齐、主游戏的深蓝紫底板、玉兔模式的红底和中国结格子、牌匾底图、缺图时退回原画面。但手机横屏 844×390 下，底部的「演示平台 · 仅虚拟积分 · 不涉及真实货币」提示压在背景的底部紫色信息条上，盖住了「赢得 X」所在的那条，不符合计划里「不要盖住卷轴和底部信息条」。DEVLOG 写横屏截图核对没问题，和实际不符。本次判为不通过，需要小修一次。

## 运行的检查
- `npm run build` → 通过。
- `npm test` → 114/114 通过，其中新增 3 个 artLayout 测试。
- `git diff --stat STEP-45-passed..HEAD` → 只改了 `src/rabbit/`（JadeRabbitApp.tsx，新增 artLayout.ts、artLayout.test.ts、localArt.ts）、`src/styles.css`、DEVLOG、DEVELOPMENT_PLAN。没有动 `src/engine/`、`.gitignore` 和流程文件。
- `git status --short --ignored` → 工作区干净；`public/local-assets/` 只显示为已忽略（`.gitignore:16`）。
- `align.mjs`，主游戏，每个尺寸转 2 局：
  - 390×844、844×390、1366×768 下，卷轴、提示条、信息条、吉祥物与 layout.json 换算位置的误差都是 0.0px。
  - 控制栏都没有盖住背景，背景比例 0.7569。
- 把 layout.json 的矩形画在 bg-main.png 上核对 → 三个卷轴框、底部紫色条和背景本身的位置吻合。
- 截图看主游戏 → 深蓝紫底板盖住了背景上的格子，提示文字在顶部提示条，「赢得 60 / 640」在底部紫色条里。
- 玉兔模式（`restart.sh … 0`，390×844）→ 8 次财富旋转全部走完，最后回到主游戏。
  - 卷轴是红色底，没有格子图时显示 SVG 中国结。
  - 牌匾底图上的数值写在中间，例如 100、200。
  - 底部条显示「玉兔模式！剩余 n 次」或「赢得 700」。
- 临时放入 real/ 里的 bg-mode.png、knot-tile.png，在 844×390 和 1366×768 跑玉兔模式 → 空格全部显示格子图（blank 0 / images 10）。检查完已删除，目录恢复原状。
- 把 `public/local-assets/jade-rabbit` 整个改名后重启，转 3 局 → 没有 has-art，回到原来的屋顶、柱子和 SVG 符号，可以正常玩。已改回原名。
- 只把 bg-main.png 改名，转 2 局 → 回到原布局，符号仍用本机图，正常。已改回原名。
- 自写的 Playwright 测量：
  - 844×390：`.rabbit-demo-note` 的纵向范围是 379–389，`.rabbit-art-bar` 是 368.4–386.8，重叠约 8px（信息条高 18px）。
  - 同一尺寸下，背景底边在 390px，正好贴着视口底；提示条字号只有 8.5px。
  - 390×844 和 1366×768 下没有重叠。
- 最后用 `restart.sh /home/user/gongxige`（不带第二个参数）重启了一次。

## 问题
- [中等] src/styles.css:352-366（横屏 `has-art` 媒体查询）和 src/rabbit/JadeRabbitApp.tsx:441 — 手机横屏 844×390 下，`.rabbit-demo-note`（绝对定位在底部，z-index 8）叠在背景的底部紫色信息条上，压住信息条下半部分（重叠约 8px）。这既违反「信息栏不被盖住」，也让这条合规提示难以阅读。另外 `--art-top: 15cqh` 加 `--art-bottom: 0px`，使背景底边正好贴着视口底，没有给提示留位置。— 横屏 has-art 时给背景底部留出提示的高度，例如 `--art-bottom` 设为提示行高再加一点余量；或者把 `.has-art .rabbit-demo-note` 移到右侧控制栏底部，限制在 `.rabbit-bottom` 的横向范围内。
- [中等] docs/DEVLOG.md（STEP-46 记录的「对齐」段）— 写「三个尺寸……截图核对：……『赢得 X』在底部紫色条里」，没有提到横屏时演示提示压在信息条上，记录和实际不符。— 修复后重新截图核对，如实记录。
- [轻微] src/styles.css:332 — 横屏下背景只有 251px 宽，顶部提示文字约 8.5px，几乎看不清。— 可以给提示条和信息条的字号加下限，例如 `max(10px, 3.4cqw)`，或者横屏时让背景再大一些，例如缩小标题栏高度。
- [轻微] layout.json 的 `mascotArea`（330,0,270,230）正好是背景上「兔」字牌匾的位置，所以吉祥物盖住了「兔」字牌匾。这是计划要求的位置，不算违规；建议以后向用户确认，是否要把吉祥物移到牌匾一侧或让它小一些。
- [轻微] DEVLOG 里列的已知旧问题（模式中「第 n 次收集」等叠加动画偏左半屏）依然存在，截图可见。不属于本步范围。

## 给 Codex 的修改要求
1. 在 `src/styles.css` 的 `@media (max-height: 520px) and (orientation: landscape)` 里，处理 `.rabbit-stage.has-art` 的情况：
   - 让 `.rabbit-demo-note` 不再和 `.rabbit-art` 重叠。可以把 `--art-bottom` 设为提示行高度（约 3–4cqh），让背景整体缩小后底边留出这一行；或者把提示移到右侧控制栏 `.rabbit-bottom` 的范围内，例如 `left: calc(50% + var(--art-w) / 2 + 1.5%)`。
   - 验证标准：844×390 下 `.rabbit-demo-note` 的矩形与 `.rabbit-art-bar` 的矩形不相交，背景底边不超出视口。
2. 重新跑 `align.mjs`：390×844、844×390、1366×768，主游戏和玉兔模式都要跑。确认误差仍为 0、控制栏和演示提示都没有盖住背景，并截图核对横屏底部条。
3. 可选：给 `.rabbit-art-banner` 和 `.rabbit-art-bar` 的字号加像素下限，让横屏提示文字至少约 10px。
4. 如实更新 `docs/DEVLOG.md` 的 STEP-46 记录，写明这是第 2 次尝试和改了什么；`npm run build`、`npm test` 仍需通过。

VERDICT: FAIL
