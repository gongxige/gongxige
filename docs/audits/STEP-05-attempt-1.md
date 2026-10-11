# 审计报告：STEP-05 玩家注册、登录（接口）（第 1 次）

- 时间：2026/10/11 08:16:48
- 审计的提交：d2fde4e（比较起点 STEP-04-passed）
- 结果：**通过**

---

## 结论
STEP-05 验收标准全部达到：注册/登录/退出/当前玩家/改密接口齐备，密码用 scrypt 加盐哈希存储，登录态用 httpOnly cookie，连续 5 次失败锁定 15 分钟，冻结账号登录与下注均被拒绝（403），且有接口测试覆盖这些场景。实测命令全部通过，未发现严重或中等问题，判定 **PASS**。

## 运行的检查
- `npm test` → 43/43 全部通过（含新增 4 条认证接口测试：重复用户名+无明文密码、错误密码+限流 429、cookie 会话与退出、未登录 401+冻结拒绝 403）
- `npm run build` → 通过（tsc -b && vite build 成功）
- `npm run check:provider` → 通过（签名、幂等、对账、回放、派彩重试、扣款超时、余额不足全部通过）
- `git diff STEP-04-passed..HEAD --check` → 无空白字符问题
- `git status` → 工作区干净，改动已提交
- 人工审读 `server/platform/auth.mjs`、`platform-server.mjs`、`server/platform/ledger.mjs`（确认 `placeBet` 冻结检查原本就存在）、`schema.mjs`、`db.mjs`、`docs/DEVLOG.md`、`docs/DEVELOPMENT_PLAN.md`
- 范围核对：改动只涉及 `server/platform/auth.mjs`（新增）、`platform-server.mjs`、`server/platform/db.mjs`、`server/platform/schema.mjs`、测试文件及文档；未触碰 `src/engine/`、游戏规则或无关流程文件

## 问题
- [轻微] `server/platform/auth.mjs:2` — 导入了 `inTransaction` 但文件内从未使用（注册时 `createPlayer` 与紧随其后的密码哈希 `UPDATE` 之间没有 await，实际上不会被打断，不算正确性问题）——可删除此多余 import。
- [轻微] `server/platform/auth.mjs:28-31` — 用户名不存在时立即走 `INVALID_CREDENTIALS` 快速返回，而密码错误时要等 scrypt 计算完才返回，两条路径耗时不同，理论上可被用来猜用户名是否存在。本地虚拟积分演示场景下风险很低，可选优化：用户名不存在时也执行一次等量的哈希运算再返回错误。
- [轻微] `src/platform/auth.test.ts:16` — "数据库里没有明文密码"的检查只读取主 `.sqlite` 文件，WAL 模式下刚写入的数据可能还停留在 `-wal` 文件里；当前实现本身没有存明文所以不影响本次判定，但这条用例对"真的存了明文密码"的 bug 不一定能覆盖到，可考虑先 `PRAGMA wal_checkpoint` 再读取，或改查 `password_hash`/`password_salt` 字段。

以上均为建议性轻微问题，不影响通过。

## 给 Codex 的修改要求
无（PASS，不要求本次修改；以上轻微建议可在后续步骤顺手处理）。

VERDICT: PASS
