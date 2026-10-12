# 审计报告：STEP-45 玉兔送财使用本机符号图，修正开局全是空白格（第 1 次）

- 时间：2026/10/12 20:05:44
- 审计的提交：6131f01（比较起点 STEP-44-passed）
- 结果：**不通过**

---

## 结论
不通过。开局空白格、玉兔模式结束后卡住、缺图退回 SVG、规则页用图这几项都做到了，`npm test` 和 `npm run build` 也通过。但有一条验收标准没做到：有本机图片时，**转动中的滚轮完全看不到符号**。滚动条里的格子高度塌成 4～7px，画面只剩几条细点线。DEVLOG 写的「转动中普通符号都是图片」与实际不符。

## 运行的检查
- `git diff STEP-44-passed..HEAD`：这段范围里有 4 个提交。前 3 个是用户自己的文档提交（阶段 12 计划、.gitignore、AGENTS.md、AUDITOR.md、REPORT.md）。本步提交 6131f01 只改了 `src/rabbit/`（JadeRabbitApp.tsx 和新增的 localSymbolImages.ts、openingBoard.ts、openingBoard.test.ts）、styles.css、DEVLOG.md、DEVELOPMENT_PLAN.md。没有动 `src/engine/`、`src/rabbit/engine/`、服务器、脚本和 .gitignore，也没有提前做 STEP-46 的内容。
- `npm test`（Node 24，游戏服务器 8787 在跑）→ 111/111 通过，其中新增 2 个开局盘面测试。
- `npm run build` → 通过。`git diff --check` → 通过。
- `git status --short --ignored` → 工作区干净，`public/local-assets/` 只显示为已忽略（`!!`）。
- 浏览器检查，手机竖屏 390×844 和电脑 1366×768 各转 4 局：
  - 打开未转时 10 格全是图片，空白格 0 个；
  - 停下后普通符号都是图片，奖金牌匾仍是原创画法；
  - 规则页 7 个符号都是图片；
  - 没有失败的请求。
- 转动中检查（我自己写的脚本：把 /api/spin 拖慢 1.5 秒，在转动时暂停动画再量尺寸）：
  - 有图时，手机竖屏每格高 4px、整条滚动条高约 15px；电脑每格高 6～7px。截图里滚轮是空的，只有细点线。
  - 同样条件下改用 SVG，每格高 117～132px，符号正常可见。
- 改名 `public/local-assets/jade-rabbit` 后刷新 → 开局 10 格全是 SVG，转 4 局正常，规则页 7 个 SVG，没有失败的请求。之后已改回原名并确认。
- 用 `restart.sh … 0` 让付费局必定触发玉兔模式，在 1366×768 下观察：
  - 模式里是空白格加奖金牌匾；
  - 「共赢得」画面约 3 秒后回到主游戏（idle），10 格图片、空白格 0 个；
  - 之后点旋转能继续玩（这次又触发了模式）。
  - 检查完已用默认参数重启服务（新的 gameUrl 在 harness/stack.json）。
- 关于开发者另外修的「玉兔模式结束后 3 秒回主游戏」：原来停在 mode-total 时，`spin()` 和空格键都会直接返回，游戏没法继续，盘面也一直是空白格。这处修改改动很小，只恢复触发那一局的付费盘面（页面刷新后续玩模式时就用开局盘面），**属于本步「空白格只应该出现在玉兔模式里」和「游戏照样能玩」的合理范围**，不算超出范围。

## 问题
- [严重] src/styles.css:420 — `.rabbit-cell > .rabbit-symbol-image` 用了 `position: absolute; inset: 0`，图片因此不占格子的高度。转动中的格子在 `.rabbit-rolling-track`（高度由内容决定）里，规则是 `height: 24%`，这个百分比算不出来，格子高度就退成由内容决定，而里面只有一张绝对定位的图片，结果高度≈0。所以有图时转动中看不到任何符号，这条验收（「转动中、停下、中奖动画、规则页都用这些图」）没做到。改法任选一种：
  - 只对停下的盘面格子（`.rabbit-reel-column > .rabbit-cell > img`）使用绝对定位；
  - 或者给 `.rabbit-rolling-track .rabbit-cell` 一个明确高度（例如用 `aspect-ratio: 120 / 88`，或按列高算出的固定值），并让图片 `width: 100%; height: 100%` 留在正常排版里，和 SVG 撑开格子的方式一样。
- [中等] docs/DEVLOG.md（STEP-45 记录）— 写了「转动中和停下后普通符号都是图片」，但实际转动中看不到符号。修好后要按实际重新核对，并重写这一句。
- [轻微] src/rabbit/JadeRabbitApp.tsx:363 — 这是之前就有的行为，不是本步引入：玉兔模式里一局停下、牌匾不到 5 个时，presentation 保持 mode-spin，盘面全部显示成空白格，这一局实际出现的牌匾不会显示。不影响本步判定，可以在 STEP-46 或以后看看是不是有意这样设计。

## 给 Codex 的修改要求
1. 修 `src/styles.css` 里本机符号图的样式，让转动中格子的高度和用 SVG 时一致，并且滚动条里能看到图片：
   - 只给停下的盘面格子用绝对定位；
   - 或者给 `.rabbit-rolling-track .rabbit-cell` 设一个明确高度（或 `aspect-ratio`），让图片按格子完整缩放。
   - 不要影响缺图时退回的 SVG。
2. 在 390×844 和 1366×768 下，把 /api/spin 拖慢，然后在转动中截图并量格子高度：
   - 有图时每个滚动格子的高度要和用 SVG 时接近（约 100px 以上），而且能看到符号图；
   - 改名素材目录后，转动中仍显示 SVG。
3. 再确认一遍：开局空白格为 0、玉兔模式结束后回到主游戏、`npm test` 和 `npm run build` 通过、`git status` 看不到 `public/local-assets/`。
4. 按实际结果改写 DEVLOG 里 STEP-45 的验证描述，写明转动中的检查方法和结果。

VERDICT: FAIL
