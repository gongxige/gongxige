# 审计报告：STEP-53 中奖展示按参考视频（第 1 次）

- 时间：2026/10/13 08:46:22
- 审计的提交：76b41cd（比较起点 4380ffc）
- 结果：**通过**

---

## 结论
STEP-53 的验收标准全部亲自验证通过。用服务器真实回包（不改盘面）测了两条线和三条线中奖的局，折线经过的格子和 `lineWins` 一一对应，亮起的线号正好是中奖线。自动旋转、玉兔模式、减少动态效果、后台标签页都能正常进行，不会卡住。和参考视频对照，各项效果基本一致。没有越界做 STEP-54 的内容，也没改两个 engine 目录。只有几条轻微建议。

## 运行的检查
- `git diff --stat 4380ffc..HEAD`：改了 6 个文件（DEVLOG、JADE_RABBIT_MOTION、JadeRabbitApp.tsx、新增的 winDisplay.ts 和 winDisplay.test.ts、styles.css）。`src/engine/`、`src/rabbit/engine/`、`scripts/`、`docs/workflow/` 都没改。`git diff --check` 通过，工作区干净。
- `npm test` → 128/128 通过，其中包括 2 个新的 STEP-53 测试。
- `npm run build` → 通过。
- 自写脚本 `scratchpad/audit53/reallines.mjs`：不改服务器回包，一直转到出现多条线中奖的局。核对方法：把每条折线的顶点换算成屏幕坐标，看它落在哪一格，再和 `lineWins.coordinates` 比较；同时核对线号。
  - 390×844、有背景图：线 3 和线 5，折线格子一致，立柱上是 L3、R3、L5、R5，结果为 true / true。
  - 1366×768：线 5、6、8 三条线，折线格子一致，6 个线号正确，结果为 true / true。
  - 没有本机素材（NOART=1）：线 9 和线 10，折线一致，左右两侧线号栏都只亮 9 和 10，结果为 true / true。
  - 截图里所有线同时画出，不中奖的格子压暗，中奖符号放大发光，底栏显示「赢得 X」。
- `win53.mjs`：
  - 满 5 牌匾（有背景图和 NOART 两种）：5 个牌匾有金框，其余 5 格压暗，底栏「赢得 900」，1.5 秒后已回到正常。
  - 7 条线（many）加减少动态效果：停稳后 20ms 就是最终样子，7 条折线、14 个线号都在。
- 和参考视频对照（ffmpeg 抽取 2.6～5.0 秒和 12.8～15.2 秒的帧）：
  - 两侧线号亮、不中奖压暗、光环按列出现、符号放大发光、发光折线、满 5 牌匾金框且其余压暗，和我们的截图一致。
- `auto53.mjs`（自动旋转 25 局）：中奖局停稳后 1494～1497ms 开始下一局，不中奖局 413～415ms，没有卡住。
- `hidden53.mjs`：起转后 200、700、1000ms 切到后台，三次都在后台停下，盘面和服务器结果一致。
- 自写脚本 `audit53/modewatch.mjs`（强制触发玉兔模式，正常动态和减少动态效果各跑一次）：
  - 8 次财富旋转都转完，经过 mode-collect、mode-finale、mode-total，回到 idle，最后提示「财富旋转结束」。
  - 各画面阶段（mode-trigger / intro / spin / finale / total）都没有折线和线号。
  - mode-collect 时 5 个牌匾带金框、其余 5 格压暗。
  - 回到主游戏后没有残留的中奖线。
- `reel52check.mjs`：普通、服务器慢、立即停止、极速、减少动态效果几种情况下，盘面全部一致（`boardMatches` 都是 true），STEP-52 的停轴没有被改坏。
- 代码审读结论：
  - `activeLine` 和 `modeSpinNumber` 删干净了，没有残留引用；旧的 `bonus-callout`、`rabbit-win-cell`、`rabbit-mode-collect` 样式也删了。
  - `jumpToResult` 的停点是 `floor(base)-rows-2`。卷轴往下转时位置 p 变小，所以停点落在当前视口和起点那段之外，不会重叠，起转上抬阶段也成立。它先 `motion.snap()` 再 `finish()`：会取消待执行的那一帧，并把 origin 更新为停点，Promise 一定会 resolve。在 `land` 里页面已在后台时直接走这条路径；停轴途中切到后台由 `visibilitychange` 接管，这时 `landing.current` 不为空，不会和正常停轴重复结束。卸载时会移除监听。
  - `overflow: visible` 只加在停着的列上，停着时滚动带是 `visibility: hidden`，不会露出上下多出的那两格。转动中的列仍然裁剪，并且有 `contain: layout paint`。
- 范围：没有新增触发画面或大奖画面，mode-trigger、mode-finale、mode-total 的遮罩没改。源码里没有参考游戏的名字、标志，也没有引用 `reference/`。

## 问题
- [轻微] src/rabbit/winDisplay.ts:273-282 和 docs/JADE_RABBIT_MOTION.md 第二节 — 文档表格写的是 0.15、0.2、0.45 秒，「我们采用」一栏写「同」，但代码是 0.03、0.08、0.33 秒。差的那 0.12 秒应该是因为代码从回弹结束算起，文档从最低点算起。实际效果和参考一致，但这个换算哪里都没写。另外 WIN_TIMING 里 dim、ring、glow 三个值在 TS 里没有用到，CSS 里又各写死了一遍。 — 建议在 WIN_TIMING 的注释和文档里写明计时起点（回弹结束），或者把这几个值通过 CSS 变量传进去，只保留一份。
- [轻微] src/rabbit/JadeRabbitApp.tsx:457（shownLines）— 触发玉兔模式的那一局如果也有线中奖（强制触发时遇到过：2 条线，triggered=true），会直接进入 mode-trigger，这些中奖线一次都不显示。以前也是这样，不算这一步引入的。 — 建议 STEP-54 做触发画面时考虑先展示中奖线，或者确认参考视频就是这样。
- [轻微] src/styles.css:339-343 — 把 `.rabbit-mode-overlay` 的公共规则单独挪出来时留下了多余空行，`rabbit-callout-in` 删掉的地方也留了空行。 — 下次顺手清理。
- [轻微] 没有背景图时：外层 `.rabbit-reels` 还是 `overflow: hidden`，最边上那几格的光环会被裁掉一点；压暗只作用在符号上，列底的金色渐变仍然很亮，压暗效果比有背景图时弱。这只是备用画面，不影响验收。

## 给 Codex 的修改要求
（PASS，不要求修改。上面的轻微建议可以在后面的步骤里顺手处理。）

VERDICT: PASS
