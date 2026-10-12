# 审计报告：STEP-51 规则页和赔付表按参考整理（第 2 次）

- 时间：2026/10/13 04:03:04
- 审计的提交：8b39fec（比较起点 STEP-50-passed）
- 结果：**通过**

---

## 结论
第 1 次审计的修改要求都已落实。焦点停在游戏按钮上时，空格也会旋转：先点过「旋转」后按住空格能连转，先点过「极速」后按空格不会再把极速关掉。规则页不再出现「0（）」，旧样式已删，字号已调大。我实测了 6 种空格情况，没有发现新问题：规则弹窗、下拉框、转动中立即停止、玉兔模式和叠加动画、按住时的重复间隔、窗口失焦。`npm test` 和 `npm run build` 都通过，规则页在两种尺寸下都能完整滚动阅读，数值和引擎 1.3.0 一致。本次通过。

## 运行的检查
- `npm run build` → 通过。
- `npm test` → 120/120 通过。
- `git diff --check STEP-50-passed..HEAD` → 无问题；工作区干净。
- `src/engine/`、`src/rabbit/engine/` 都没有改动。
- 第 2 次尝试（8b39fec）只改了 `src/rabbit/JadeRabbitApp.tsx`、`src/styles.css`、DEVLOG 和 DEVELOPMENT_PLAN。流程文件 WORKFLOW_PLAN 这次没有再改。
- `harness/spacecheck.mjs`（1366×768）：
  - 页面没有焦点时按住空格 3.5 秒 → 转 3 局，松开后 0 局。
  - 先点「旋转」（焦点在 `.rabbit-spin`）再按住空格 → 转 3 局，松开后 0 局。
  - 先点「极速」再按一次空格 → 转 1 局，aria-pressed 前后都是 true。
  - 和 DEVLOG 写的一致。
- 自写 `harness/audit51b.mjs rules`（规则弹窗）：
  - 点「?」打开规则后，焦点留在「?」按钮上，按住空格 2 秒 → 0 局，弹窗保持打开。原因是 `spin()` 里有 `rules` 判断，直接返回。
  - 焦点在「知道了」上按空格 → 弹窗关闭，0 局。弹窗内按钮保留了浏览器默认行为。
  - 关闭后再按空格 → 正常转 1 局。
- `audit51b.mjs select`（自动次数下拉框获得焦点）：按空格 → 0 局，选项值没有被改。用 selectOption 选过次数后焦点仍在下拉框上，按空格同样 0 局，没有误发请求。
- `audit51b.mjs stop`（立即停止）：
  - 按空格开始，250ms 后再按 → 435ms 停下，只有 1 个请求；不按时一局约 1160ms。
  - 转动中按住空格 → 只停止，不额外开新局，总共 1 个请求。
- `audit51b.mjs repeat`（重复间隔与失焦）：
  - 按住空格 8 秒 → 6 局，间隔约 1.51～1.52 秒。也就是每局结束后，最多等到下一次 760ms 的计时再开新局，不会叠加请求。
  - 按住时发出 window blur → 失焦时 1 局，之后 5 秒内没有新增，重复确实停止了。
- `restart.sh … 0` 加 `audit51b.mjs mode`（强制触发玉兔模式）：一局付费后，在 mode-trigger、mode-intro、mode-collect 等锁定画面期间，每 250ms 按一次空格，共 120 次 → 锁定画面期间发出的请求数是 0。
  - 只有在 mode-spin 空闲时才发出 free 请求，请求顺序正常：上一次残留的 free、paid、8 次 free。
  - 换同一个玩家重进时，没转完的财富旋转确实接着转了，这证实了规则里新补的那句话。
- `rulescheck.mjs`（规则页，390×844 和 1366×768）：
  - 8 个分节齐全。赔付表读出「百搭200 元宝100 福袋50 红包10 铜钱5 鞭炮3 胡萝卜2」，和引擎一致。
  - 7 个符号图、3 个牌匾都显示。没有横向溢出，分别 4 屏和 5 屏能滚到底，「知道了」完整可见。
  - 截图在 scratchpad/audit51b/，逐张看过：排版正常，按钮说明和附加信息的文字和实测行为一致。
- 读代码核对：bets 为空时整段「总投注可选 … （…）」不渲染。`.rabbit-rule-tabs`、`.rabbit-rule-subtitle`、`.rabbit-rule-note` 在 src 里已经没有引用了。
- 收尾：已用 restart.sh 不带第二个参数重启一次。

## 问题
- [轻微] src/rabbit/JadeRabbitApp.tsx:552 — 规则弹窗打开时，如果点的是弹窗里的正文（焦点回到 body），空格会被 `preventDefault()` 吃掉，不能用空格滚动弹窗。实测 scrollTop 前后都是 0。这是 STEP-51 之前就有的行为，不影响规则描述 — 可以在 `rules` 为 true 时让 keydown 直接 return，不调用 preventDefault。
- [轻微] src/rabbit/JadeRabbitApp.tsx:552 — 用鼠标选完自动次数后，焦点留在下拉框上，这时按空格只会打开下拉框，不会旋转。这和按钮说明「按一下空格键旋转」略有出入，不过属于合理的输入框例外 — 可以在按钮说明里补一句「下拉框选中时除外」，或者选完后让下拉框失去焦点。
- [轻微] src/styles.css:467 — 删掉 `.rabbit-rule-subtitle` 后留了一个空行，可以顺手去掉。

## 给 Codex 的修改要求
（PASS，无必须修改项）

VERDICT: PASS
