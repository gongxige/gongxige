# 审计报告：STEP-49 转动更流畅（第 1 次）

- 时间：2026/10/13 01:47:44
- 审计的提交：7bec01a（比较起点 STEP-48-passed）
- 结果：**不通过**

---

## 结论
STEP-49 的主要目标做到了。滚动循环无缝，转动中不换图，停下时的盘面和服务器结果一致，原有节奏也都保留，DEVLOG 里的数字我复跑后能对上。但有一处回退：系统设为「减少动态效果」时，以前滚动带不动，现在照样每秒滚 10 格。原因是新加的样式盖掉了原来的关闭规则，DEVLOG 也没提这件事。这算中等问题，所以判为不通过。

## 运行的检查
- `npm test` → 118 个全部通过，0 失败；`npm run build` → 通过；`git diff --check STEP-48-passed..HEAD` → 通过。改动范围只有 `src/rabbit/JadeRabbitApp.tsx`、`src/styles.css` 和两份文档，`src/engine/` 没动。
- **卡顿原因分析**：对照新旧代码，DEVLOG 的说法成立。
  - 旧动画 `rabbit-roll .18s` 每次从 -28% 拉回 0，而内容每 3～4 格才重复一次，所以循环时画面会错位。
  - 旧滚动带内容取自 `board`；`animateResult` 先 `setBoard(result.grid)` 再逐列停，所以第 2、3 列会中途换图。
- **motionmeter（生产构建，390×844，5 局）**：
  - 改进后：loopResets 5，平均错位 0.004 格，最大 0.019 格，转动中换图 0 次，停轴回弹 126 帧。
  - 改进前（review 副本）：loopResets 24，平均错位 0.937 格，最大 1.153 格，回弹 0 帧。
  - 和 DEVLOG（平均 1.143 / 最大 1.149）方向和量级一致。
- **framemeter（生产构建，CPU 降速 4 倍，8 局）**：

  | 尺寸 | 改进后：平均 / 超过 50ms 的帧 | 改进前：平均 / 超过 50ms 的帧 |
  |---|---|---|
  | 390×844 | 16.79ms / 0 | 16.85ms / 1 |
  | 1366×768 | 16.76ms / 0 | 16.88ms / 0 |

  和 DEVLOG 吻合。
- **framemeter（开发模式）**：

  | 尺寸 | 改进后：平均 / 超过 50ms 的帧 | 改进前：平均 / 超过 50ms 的帧 |
  |---|---|---|
  | 390×844 | 19.46ms / 15 | 19.35ms / 13 |
  | 1366×768 | 20.14ms / 17 | 19.47ms / 10 |

  改进后略差。
- **framediag（开发模式，390×844）** → 长帧集中在每列停下（落地重渲染）和开始转的那一帧。
- **自写逐列探针**（scratchpad/audit49/probe.mjs）。每帧量三列的滚动带位移、格距、列高、滚动带高度、左右对齐和内容，并把每次停轴后的静止格和服务器 grid 逐格对比：
  - **几何**：3 行列格距 = 列高/3，4 行列格距 = 列高/4，滚动带高度 = 12 格，左右偏差 0。几何不符 0 帧，位移范围正好 [-6, 0] 格。三列都没有循环跳动（最大 0.003 格），中途换图 0 次。
  - **有背景的布局**：390×844、1366×768 都通过，且都是停下 12 次、和服务器不一致 0 次。
  - **极速**：14 格/秒，最大错位 0.012 格，不一致 0 次。
  - **立即停止**：不一致 0 次。
  - **无背景的布局**（素材目录临时改名，已改回）：390×844、1366×768 下三列几何都正确，不一致 0 次。
  - **转动时的显示**：转动中静止格可见 0 帧；停下后滚动带一直是隐藏状态。
- **玉兔模式**（roll=0，普通和极速各 1 轮）→ 1 次付费局 + 8 次财富旋转，27 次停轴和服务器回包不一致 0 次，滚动中换图 0 次。
- **bugcheck**：
  - mode-board → 35 次核对，不一致 0 次，模式后没有付费局。
  - lost-final、auto-trigger → 正常回到主游戏，自动旋转接着把模式转完。
  - stop-early → 结果回来前卷轴仍在转。
  - auto-collect、auto-error → 都正常，STEP-48 修过的状态机没有回退。
- **lines.mjs** → 高亮格和连线都正确，只连相邻格。**align.mjs（1366×768）** → 对齐偏差全为 0.0。**layoutcheck（390×844）** → 被裁的符号 0 个。**msgcheck pending** → 局号正常显示。
- **期待蓝光**（伪造前两列 4 个牌匾）：
  - 停轴顺序 0→1→2，间隔 220ms，第 3 列亮蓝光约 620ms 后停。
  - 极速时间隔 130ms，蓝光约 260ms。
  - 蓝光动画只改透明度。亮度和改进前截图差不多。
- **截图**（scratchpad/audit49/*-spin.png）→ 有背景、无背景两种布局下转动中都没有闪白，滚动带对齐列。
- **减少动态效果**（Playwright 设为 reduce）：
  - 改进后：滚动带 `animationName = rabbit-roll-loop`，300ms 内位移从 -242px 变到 -484px，仍在滚动。
  - 改进前：`animationName = none`，不动。
- 收尾 → 用 restart.sh 正常重启了 /home/user/gongxige（不带 PREVIEW、不带 roll）；`git status` 干净；素材目录已改回。

## 问题
- [中等] src/styles.css:510、523 — 新规则 `.rabbit-reel-column.is-spinning .rabbit-rolling-track { animation-name: rabbit-roll-loop; … }` 写在原来那条减少动态效果规则（第 396 行，`animation: none`）后面，两者优先级相同，于是覆盖了它。结果是设了「减少动态效果」的用户转动时滚动带仍然一直滚，比 STEP-48 退步了。DEVLOG 只写了「关闭回弹和蓝光动画」，没有说明这一变化。 — 在第 523 行的 `@media (prefers-reduced-motion: reduce)` 里加上 `.rabbit-reel-column.is-spinning .rabbit-rolling-track { animation: none; }`（这条要写在第 510 行之后才生效）。
- [轻微] src/rabbit/JadeRabbitApp.tsx:172 — `RollingColumn` 没有 memo，整个页面每次重渲染都要多渲染 36 个滚动符号。开发模式（用户平时用的 `npm start`）下每列停下都会出一个 50～117ms 的长帧。DEVLOG 把开发模式变差主要归因于容器抢占，不够准确。 — 用 `React.memo` 包住 `RollingColumn`，`segment`、`bet`、`fast`、`rows` 不变时就不重渲染。
- [轻微] src/styles.css:384、387、421 — 旧的 `rabbit-roll .18s` 动画、`@keyframes rabbit-roll` 和 `.rabbit-rolling-track .rabbit-symbol-image { aspect-ratio }` 都已经被覆盖或不再使用，留着容易造成和上面一样的覆盖冲突。 — 删掉旧规则。
- [轻微] src/styles.css:512 — 无背景布局的列有 `.55cqw` 的格间距，滚动格按「列高/行数」排列、没有间距，所以滚动格比静止格略高（约 2px）。几乎看不出来。 — 可以不改；要改的话，在无背景时滚动格也留出同样的间距。

## 给 Codex 的修改要求
1. 在 `src/styles.css` 第 523 行的 `@media (prefers-reduced-motion: reduce)` 规则里加上 `.rabbit-reel-column.is-spinning .rabbit-rolling-track { animation: none; }`。转动时滚动带静止显示（停在 -50%，正好显示一份完整符号），停轴的回弹和蓝光动画照旧关闭。
2. 用 Playwright `reducedMotion: 'reduce'` 验证：转动中滚动带的 `animationName` 是 `none`，位移不变；停下后的盘面仍和服务器 grid 一致。结果写进 DEVLOG，并把「减少动态效果时转动带静止」写清楚。
3. （建议）用 `React.memo` 包住 `RollingColumn`，删掉第 384、387、421 行已经不用的旧滚动样式。然后重跑一次开发模式 framemeter（390×844、1366×768），在 DEVLOG 里如实写明结果。
4. 重新运行 `npm test`、`npm run build`、`git diff --check`。

VERDICT: FAIL
