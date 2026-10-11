# 模拟博彩平台设计（阶段 7）

## 1. 范围与原则

本平台只在本机运行，所有金额均为 `DEMO` 虚拟积分；充值和提现均为演示申请与后台审核，绝不接入真实支付、银行、第三方支付、加密货币，也不保存银行卡或收款账号。所有玩家端和后台页面顶部固定显示：**“演示平台 · 仅虚拟积分 · 不涉及真实货币”**。

平台运行在 `127.0.0.1:8788`，替代 `mock-operator.mjs`；游戏供应商继续运行在 `8787`，游戏网页继续运行在 `4173`。持久化使用 Node 内置 `node:sqlite`，数据库文件为 `data/platform.sqlite`（`data/` 不入 Git）。`src/engine/` 不在本阶段改动。

金额使用安全整数积分，不使用浮点数；所有写入钱包的操作在 SQLite 事务中完成。`wallets.balance` 是可用余额，`wallets.frozen_balance` 是已为待处理提现保留的积分，二者均非负。

## 2. 页面清单

### 玩家端

| 路由/页面 | 功能 |
| --- | --- |
| `/register` 注册 | 用户名、密码、确认密码；用户名唯一。 |
| `/login` 登录 | 玩家登录、登录失败限流；登录后通过 httpOnly cookie 保持会话。 |
| `/logout` 退出 | 作废当前玩家会话。 |
| `/` 大厅 | 显示可用余额和 Wild Frontier 游戏卡；点击后由平台调用供应商 `/provider/launch`，跳转其返回的 `gameUrl`。 |
| `/wallet` 钱包 | 显示可用余额、冻结金额；提交充值申请、提现申请；查看充值、提现、下注、派彩、回滚、手动调整流水及状态。不能提现到真实账户。 |
| `/rounds` 游戏记录 | 只显示当前玩家的局号、时间、投注、赢分；点击局号查看回放。 |
| `/profile` 个人中心 | 修改密码。 |

### 管理后台

| 路由/页面 | 功能 |
| --- | --- |
| `/admin/login` 管理员登录 | 与玩家账号独立；首次启动无管理员时生成随机初始密码，仅打印到终端。 |
| `/admin` 概览 | 玩家数、今日已通过充值/提现、今日下注、今日派彩、平台盈亏（下注 − 派彩）。 |
| `/admin/players` 玩家 | 列表与搜索；查看玩家钱包、流水、游戏记录；冻结/解冻账号；填写原因后手动调整。 |
| `/admin/deposits` 充值审核 | 待审核充值申请；通过或拒绝。 |
| `/admin/withdrawals` 提现审核 | 待审核提现申请；通过或拒绝。拒绝时解除冻结。 |
| `/admin/transactions` 交易流水 | 按玩家、类型、日期筛选全部资金流水。 |
| `/admin/rounds` 游戏记录 | 查看所有局与回放。 |
| `/admin/reconciliation` 对账 | 每位玩家展示账面余额、流水计算余额和差额；不一致标红。 |
| `/admin/faults` 故障模拟 | 保留“派彩连续失败”“扣款超时”。 |
| `/admin/audit-logs` 操作日志 | 管理员的登录外关键操作：谁、何时、目标、操作、原因及结果。 |

所有 `/admin/*`（登录页除外）接口和页面均要求管理员会话；玩家 cookie 访问后台接口返回 401/403。被冻结玩家不能登录、进入游戏或下注。

## 3. 数据库结构

启用 `PRAGMA foreign_keys = ON` 与 WAL。时间统一为 UTC ISO-8601 文本；金额字段均为 `INTEGER`。以下为逻辑表结构（实现时可补充索引，但不能放宽这里的约束）。

### 3.1 身份、会话与钱包

| 表 | 字段 | 主键、唯一约束与说明 |
| --- | --- | --- |
| `players` | `id TEXT`, `username TEXT`, `password_hash TEXT`, `password_salt TEXT`, `status TEXT`, `created_at TEXT`, `updated_at TEXT` | `id` 主键；`username` 唯一；`status` 仅 `active`/`frozen`。只保存 scrypt 盐哈希，不保存明文密码。 |
| `admins` | `id TEXT`, `username TEXT`, `password_hash TEXT`, `password_salt TEXT`, `created_at TEXT`, `updated_at TEXT` | `id` 主键；`username` 唯一；独立于 `players`。 |
| `sessions` | `id TEXT`, `role TEXT`, `subject_id TEXT`, `token_hash TEXT`, `expires_at TEXT`, `revoked_at TEXT`, `created_at TEXT` | `id` 主键；`token_hash` 唯一；`role` 为 `player`/`admin`；cookie 内仅保存随机原始 token，库中只保存其哈希。 |
| `login_attempts` | `id TEXT`, `role TEXT`, `identifier TEXT`, `ip_hash TEXT`, `failed_at TEXT`, `succeeded_at TEXT` | `id` 主键；索引 `(role, identifier, failed_at)`，用于连续错误密码限流。 |
| `wallets` | `player_id TEXT`, `balance INTEGER`, `frozen_balance INTEGER`, `updated_at TEXT` | `player_id` 主键且外键至 `players`；`CHECK (balance >= 0)`、`CHECK (frozen_balance >= 0)`。`balance` 即可下注余额，冻结额不包含在内。 |

### 3.2 申请、流水与游戏数据

| 表 | 字段 | 主键、唯一约束与说明 |
| --- | --- | --- |
| `deposit_requests` | `id TEXT`, `request_no TEXT`, `player_id TEXT`, `amount INTEGER`, `status TEXT`, `reviewed_by TEXT`, `reviewed_at TEXT`, `review_note TEXT`, `created_at TEXT` | `id` 主键；`request_no` 唯一；`amount > 0`；状态 `pending`/`approved`/`rejected`。 |
| `withdrawal_requests` | `id TEXT`, `request_no TEXT`, `player_id TEXT`, `amount INTEGER`, `status TEXT`, `reviewed_by TEXT`, `reviewed_at TEXT`, `review_note TEXT`, `created_at TEXT` | `id` 主键；`request_no` 唯一；`amount > 0`；状态 `pending`/`approved`/`rejected`。申请创建时同一事务内将可用余额转为冻结。 |
| `ledger_entries` | `id TEXT`, `transaction_id TEXT`, `player_id TEXT`, `kind TEXT`, `amount INTEGER`, `balance_delta INTEGER`, `frozen_delta INTEGER`, `balance_after INTEGER`, `frozen_after INTEGER`, `status TEXT`, `round_id TEXT`, `request_id TEXT`, `ref_transaction_id TEXT`, `reason TEXT`, `created_at TEXT` | `id` 主键；`transaction_id` 唯一；`request_id` 外键可为空；`kind` 为下表定义的类型；`amount >= 0`。每个改变余额或冻结额的业务结果恰有一条成功流水。 |
| `game_rounds` | `round_id TEXT`, `player_id TEXT`, `bet_amount INTEGER`, `win_amount INTEGER`, `started_at TEXT`, `settled_at TEXT`, `provider_payload TEXT`, `replay_url TEXT` | `round_id` 主键；`player_id` 外键；供应商局号唯一，保存可查询的结果/回放定位信息。 |
| `provider_transactions` | `transaction_id TEXT`, `operation TEXT`, `player_id TEXT`, `round_id TEXT`, `status TEXT`, `ledger_entry_id TEXT`, `ref_transaction_id TEXT`, `request_hash TEXT`, `created_at TEXT`, `updated_at TEXT` | `transaction_id` 主键；供应商钱包幂等索引；`operation` 为 `bet`/`win`/`refund`/`balance`；记录已完成、已取消或重复响应。 |
| `admin_audit_logs` | `id TEXT`, `admin_id TEXT`, `action TEXT`, `target_type TEXT`, `target_id TEXT`, `reason TEXT`, `details_json TEXT`, `created_at TEXT` | `id` 主键；`admin_id` 外键；管理员审核、冻结、解冻、调整与故障模拟都必须写入。 |

`ledger_entries.transaction_id` 与 `provider_transactions.transaction_id` 共同保证供应商交易号在数据库层只能出现一次；`deposit_requests.request_no`、`withdrawal_requests.request_no` 使前端重发不会创建两张申请。审核更新必须以条件语句 `WHERE id = ? AND status = 'pending'` 执行，并检查受影响行数恰为 1；所以同一提现申请在并发下也只有一个审核者能成功处理。

## 4. 账本与资金变动

所有下列步骤都在单一 SQLite 事务中依次完成：读取并校验当前行 → 以条件更新钱包 → 插入唯一交易号流水 → 更新申请/供应商事务状态 → 提交。任何一步失败即回滚。禁止直接更新 `wallets` 而不插入 `ledger_entries`。

| 业务 | 前置条件与事务内钱包变化 | 流水 `kind` / 状态 |
| --- | --- | --- |
| 充值申请 | 仅创建 `deposit_requests(pending)`；余额不变。 | 不产生资金流水（可另记申请事件）。 |
| 充值通过 | 申请仍为 `pending`；`balance += amount`，标记申请 `approved`。 | `deposit_approved`，`balance_delta=+amount`。 |
| 充值拒绝 | 申请仍为 `pending`；标记 `rejected`，余额不变。 | 不产生资金流水。 |
| 提现申请 | 玩家可用余额足够；原子条件更新 `balance = balance - amount, frozen_balance = frozen_balance + amount`，创建 `pending` 申请。 | `withdrawal_freeze`，`balance_delta=-amount`，`frozen_delta=+amount`。 |
| 提现通过 | 申请仍为 `pending` 且冻结额足够；`frozen_balance -= amount`，标记 `approved`。 | `withdrawal_approved`，`frozen_delta=-amount`。这表示演示积分已扣除，不涉及任何真实出款。 |
| 提现拒绝 | 申请仍为 `pending`；`frozen_balance -= amount, balance += amount`，标记 `rejected`。 | `withdrawal_release`，`balance_delta=+amount`，`frozen_delta=-amount`。 |
| 下注 | 供应商签名正确、玩家存在且未冻结、交易号未处理；条件扣款 `UPDATE wallets SET balance=balance-? WHERE player_id=? AND balance>=?`。 | `bet`，`balance_delta=-amount`。余额不足返回 `402 INSUFFICIENT_FUNDS`。 |
| 派彩 | 签名正确且交易号未处理；`balance += amount`，金额可为 0。 | `win`，`balance_delta=+amount`。 |
| 回滚 | 签名正确且回滚交易号未处理；找到原成功下注则 `balance += 原下注额`，并将原下注标为已回滚；若原下注从未到达，则把原交易号登记为 `cancelled`，阻止迟到扣款。 | `refund`，`balance_delta=+原下注额`；无原扣款时为 0。 |
| 后台手动调整 | 管理员身份、非空原因；正向直接加余额；负向使用 `balance >= abs(amount)` 条件更新。 | `manual_adjustment`，正负 `balance_delta`；同时写 `admin_audit_logs`。 |

### 不变量与幂等

1. **余额不会为负数。** `wallets` 有 `CHECK (balance >= 0)`；所有会减少可用余额的 SQL 都额外以 `balance >= amount` 作为 `WHERE` 条件，并在同一事务插流水。因此并发下注、提现或手调时，只有一个请求能扣到最后一笔可用积分，失败请求不会留下半笔流水。
2. **冻结金额不能下注。** 提现申请先把 `balance` 转到 `frozen_balance`，下注接口只比较和扣减 `balance`；它没有可消费冻结额的 SQL 路径。冻结额只可由提现通过消耗或拒绝释放。
3. **同一交易号只处理一次。** 供应商每个 `transactionId` 先占用 `provider_transactions.transaction_id`（主键）及 `ledger_entries.transaction_id`（唯一）。重复请求返回首次处理后的余额/结果，不再次变更钱包；已被回滚的原扣款返回 `409 TRANSACTION_CANCELLED`。
4. **同一提现申请只审核一次。** `request_no` 唯一；审核通过/拒绝使用 `pending` 条件更新，并同钱包和流水放入一个事务。首个提交者将状态改出 `pending`，其余并发请求影响 0 行并返回冲突，不会二次扣冻结额或二次释放。

## 5. 对账

对账以成功/已生效流水为唯一事实来源，按玩家汇总：

```text
计算可用余额 = Σ(balance_delta)
计算冻结余额 = Σ(frozen_delta)
钱包总额 = wallets.balance + wallets.frozen_balance

可用余额公式 = 已通过充值 + 派彩 + 回滚 + 手动调整
              − 下注 − 提现冻结 + 提现拒绝释放
冻结余额公式 = 提现冻结 − 提现通过 − 提现拒绝释放

玩家总资产公式 = 已通过充值 − 已通过提现 − 下注 + 派彩 + 回滚 ± 手动调整
               = 计算可用余额 + 计算冻结余额
```

后台对账页同时比较 `wallets.balance` 与计算可用余额、`wallets.frozen_balance` 与计算冻结余额、总额与总资产公式。任一差额非零即标红，并显示差额和相关流水；待审核充值不计入、待审核提现已体现为可用转冻结但不改变总资产。

概览指标按当日成功流水汇总：今日充值=`deposit_approved`，今日提现=`withdrawal_approved`，今日下注=`bet`，今日派彩=`win`，平台盈亏=`今日下注−今日派彩`（回滚仅用于钱包正确性，不混入该运营指标）。

## 6. 接口列表

除健康检查和登录/注册外，均为 JSON API。玩家接口要求玩家 cookie；后台接口要求管理员 cookie；写接口验证 CSRF 来源/令牌。密码使用 `node:crypto` 的 scrypt 加盐哈希，失败登录按账户和来源限流。

### 6.1 玩家与平台

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| `GET` | `/health` | 无 | 平台健康状态。 |
| `POST` | `/api/auth/register` | 无 | 注册玩家。 |
| `POST` | `/api/auth/login` | 无 | 玩家登录，设置 httpOnly cookie。 |
| `POST` | `/api/auth/logout` | 玩家 | 作废当前会话。 |
| `GET` | `/api/me` | 玩家 | 当前玩家资料、状态与钱包摘要。 |
| `POST` | `/api/profile/password` | 玩家 | 校验旧密码并修改密码。 |
| `GET` | `/api/wallet` | 玩家 | 可用余额、冻结额。 |
| `POST` | `/api/deposit-requests` | 玩家 | 创建演示充值申请。 |
| `POST` | `/api/withdrawal-requests` | 玩家 | 创建提现申请并冻结积分。 |
| `GET` | `/api/transactions` | 玩家 | 仅当前玩家流水，支持分页/类型/日期。 |
| `GET` | `/api/rounds` | 玩家 | 仅当前玩家游戏记录。 |
| `GET` | `/api/rounds/:roundId` | 玩家 | 仅可读取本人的局记录/回放定位。 |
| `POST` | `/api/games/wild-frontier/launch` | 玩家 | 平台签名调用供应商 `/provider/launch`，返回或重定向 `gameUrl`。 |

### 6.2 供应商钱包兼容接口

供应商到平台的以下接口保留 `X-Operator-Id` 和原始请求体 HMAC-SHA256 `X-Signature` 校验；请求与响应格式、错误码保持 `docs/PROVIDER_API.md` 的 provider-v1 定义不变。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/wallet/balance` | 查询可用余额（不含冻结额）。 |
| `POST` | `/wallet/bet` | 用唯一交易号扣除下注。 |
| `POST` | `/wallet/win` | 用唯一交易号记派彩，0 金额也确认本局结束。 |
| `POST` | `/wallet/refund` | 幂等回滚原下注，或预先作废迟到扣款。 |

### 6.3 后台

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/api/admin/auth/login` | 管理员登录。 |
| `POST` | `/api/admin/auth/logout` | 管理员退出。 |
| `GET` | `/api/admin/overview` | 概览指标。 |
| `GET` | `/api/admin/players` | 玩家列表与搜索。 |
| `GET` | `/api/admin/players/:playerId` | 玩家、钱包、流水和局记录。 |
| `POST` | `/api/admin/players/:playerId/freeze` | 冻结玩家并审计。 |
| `POST` | `/api/admin/players/:playerId/unfreeze` | 解冻玩家并审计。 |
| `POST` | `/api/admin/players/:playerId/adjustment` | 带原因的正/负手动调整并审计。 |
| `GET` | `/api/admin/deposit-requests` | 充值申请筛选列表。 |
| `POST` | `/api/admin/deposit-requests/:id/approve` | 原子通过充值。 |
| `POST` | `/api/admin/deposit-requests/:id/reject` | 原子拒绝充值。 |
| `GET` | `/api/admin/withdrawal-requests` | 提现申请筛选列表。 |
| `POST` | `/api/admin/withdrawal-requests/:id/approve` | 原子通过提现。 |
| `POST` | `/api/admin/withdrawal-requests/:id/reject` | 原子拒绝提现并释放冻结额。 |
| `GET` | `/api/admin/transactions` | 全量流水及筛选。 |
| `GET` | `/api/admin/rounds` | 全量局记录。 |
| `GET` | `/api/admin/rounds/:roundId` | 局详情与供应商回放定位。 |
| `GET` | `/api/admin/reconciliation` | 每玩家对账结果、差额与流水汇总。 |
| `POST` | `/api/admin/faults` | 配置演示故障并审计。 |
| `GET` | `/api/admin/audit-logs` | 管理员操作日志。 |

## 7. 目录结构（目标）

```text
data/
  platform.sqlite                    # node:sqlite 本机数据库，不入 Git
server/
  platform/
    db.mjs                           # 建库、迁移、事务与连接
    schema.mjs                       # 表、索引和约束
    ledger.mjs                       # 唯一的余额/冻结额记账入口
    auth.mjs                         # scrypt、cookie、会话、限流
    wallet-api.mjs                   # provider-v1 签名钱包接口
    provider-client.mjs              # 调用 /provider/launch
    repositories.mjs                 # 玩家、申请、流水、局记录查询
    admin.mjs                        # 后台审核、玩家操作、对账
    faults.mjs                       # 故障模拟
    routes.mjs                       # HTTP 路由与权限守卫
src/
  platform/
    player/                          # 注册、登录、大厅、钱包、记录、个人中心
    admin/                           # 后台登录、概览、审核、对账、日志
    shared/                          # 演示提示条、API 客户端、表格等轻量组件
server.mjs                           # 既有供应商游戏服务，不改游戏规则
docs/
  PLATFORM_DESIGN.md                 # 本设计文档
```

实现时可将平台 React 页面做成 Vite 多入口或基于路由的入口，但不得引入大型 UI 框架；游戏现有 `src/engine/` 与其纯逻辑边界保持不变。
