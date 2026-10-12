# 审计报告：STEP-49 转动更流畅（第 2 次）

- 时间：2026/10/13 02:01:18
- 审计的提交：8e7f590（比较起点 STEP-48-passed）
- 结果：**通过**

---

## 结论
第 1 次审计的修改要求都做到了。
- 「减少动态效果」时，转动中的滚动带不再滚动，停在 -50% 处，显示一份完整符号。
- `RollingColumn` 加了 memo，旧的滚动样式已删掉。
- 删样式、加 memo 之后，下面几项都没有回退：滚动无缝；停下时盘面和服务器一致（含玉兔模式、立即停止、极速）；有背景和无背景两种布局正常；STEP-48 修过的各个状态正常。开发模式的长帧比改进前还少。

判定为通过。

## 运行的检查
- **基本命令**
  - `npm test` → 118 个全部通过，0 失败。
  - `npm run build` → 通过。
  - `git diff --check STEP-48-passed..HEAD` → 通过。
- **改动范围**
  - 第 2 次提交（8e7f590）只改了 `src/rabbit/JadeRabbitApp.tsx`、`src/styles.css`、`docs/DEVLOG.md`、`docs/DEVELOPMENT_PLAN.md`。
  - `src/engine/` 没有改动，流程文件只有审计提交带进来的 PROGRESS、state.json 和第 1 次审计报告。
- **代码核对**
  - styles.css:527 新加的减少动态效果规则写在 509 行滚动规则之后，所以能生效。
  - 删掉了旧的 `rabbit-roll .18s`、`@keyframes rabbit-roll`、旧滚动带的 flex/gap/24% 高度和 `aspect-ratio`。
  - 滚动带需要的 `display:flex; flex-direction:column` 已经补进 508 行。全文搜索，旧动画已没有任何引用。
- **memo 安全性**
  - `RabbitSymbol` 通过 `useSyncExternalStore`（`useLocalSymbolSrc` / `useLocalArt`）读本机图片状态，所以加了 memo 之后，图片加载完成或失败时仍会更新。
  - `rollSegments` 只在空闲时整体替换，转动中引用不变，memo 能起作用。
- **自写探针 probe.mjs，开发模式**（逐帧量每列的位移、格距、几何、内容，并把每次停轴后的盘面和服务器 grid 逐格对比）：

  | 场景 | 循环最大错位（格） | 换图 | 几何不符 | 停轴和服务器不一致 |
  |---|---|---|---|---|
  | 有背景 390×844 | 0.003 | 0 | 0 | 0/12 |
  | 有背景 1366×768 | 0.003 | 0 | 0 | 0/12 |
  | 极速（14 格/秒） | 0.005 | 0 | 0 | 0/12 |
  | 立即停止 | 0.004 | 0 | 0 | 0/12 |

  四个场景转动中静止格可见都是 0 帧。
- **减少动态效果**
  - probe（390×844；以及 1366×768 加极速和立即停止）：转动中 `animationName` 都是 `none`，位移固定在 -6 格，停轴不一致 0 次。
  - `reducedmotion.mjs`：开发模式 6 局、生产构建 3 局，都是 `none`、位移 0px、和服务器一致。
- **无背景布局**（素材目录临时改名，已改回）
  - 390×844、1366×768 加极速、390×844 加减少动态效果，几何不符都是 0，停轴不一致都是 0/9，最大错位 0.022 格。
  - 截图（scratchpad/audit49b/noart390-spin.png 等）显示没有闪白，滚动带和列对齐。
- **玉兔模式（roll=0）** → 1 次付费局加 8 次财富旋转，27 次停轴不一致 0 次，滚动中换图 0 次。
- **bugcheck**
  - mode-board → 35 次核对，不一致 0 次，模式后没有付费局。
  - lost-final、auto-trigger → 正常结束，并回到主游戏。
  - stop-early → 结果回来前卷轴仍在转。
  - auto-collect、auto-error → 都正常。
- **motionmeter（开发模式）** → 平均和最大错位都是 0.003 格，换图 0 次，回弹 101 帧。
- **framemeter（CPU 降速 4 倍）**：

  | 构建 | 尺寸 | 平均帧间隔 | 超过 50ms | 超过 33ms |
  |---|---|---|---|---|
  | 开发模式 | 390×844 | 18.03ms | 4 | 9 |
  | 开发模式 | 1366×768 | 17.38ms | 2 | 5 |
  | 生产构建 | 390×844 | 16.73ms | 0 | 1（最长帧 33.4ms） |
  | 生产构建 | 1366×768 | 16.73ms | 0 | 0 |

  和 DEVLOG 的数字吻合：开发模式长帧比第 1 次少很多，也优于改进前。
- **记录** → DEVLOG 顶部新增了第 2 次记录，还更正了第 1 次记录里关于减少动态效果的错误说法；DEVELOPMENT_PLAN 已更新。
- **收尾**
  - 截图在 scratchpad/audit49b/。
  - 素材目录已改回。
  - 已用 restart.sh 不带参数、不带 PREVIEW 重启 /home/user/gongxige。
  - `git status` 干净。

## 问题
- [轻微] src/styles.css:396 — 原来那条减少动态效果规则里的 `.rabbit-reel-column.is-spinning .rabbit-rolling-track` 已经被 527 行接管，留着是多余的选择器，以后容易让人误以为是这条在起作用。 — 可以从 396 行删掉这个选择器，只保留 527 行。
- [轻微] src/styles.css:512 — 无背景布局中滚动格比静止格高约 2px，是上次就有的问题。DEVLOG 已经说明不改。 — 维持现状即可。

## 给 Codex 的修改要求
（无，通过）

VERDICT: PASS
