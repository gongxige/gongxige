# 供应商接口说明（provider-v1）

> 本项目里，**游戏服务器**（`server.mjs`）扮演"游戏供应商"，**模拟平台**（`mock-operator.mjs`）扮演"博彩平台 / 运营商"。
> 两边都只用虚拟积分，只在本机运行。本文件就是供应商写给平台看的"对接文档"。

## 一、谁负责什么

| | 游戏服务器（供应商） | 平台（运营商） |
|---|---|---|
| 玩家账号、余额 | 不保存 | **保存**（钱包） |
| 每局结果 | **决定**（随机停点 + 引擎计算） | 不参与 |
| 每局记录、回放 | **保存**（局号、停点、倍数、赢分） | 保存交易流水 |
| 免费游戏进度 | **保存**（刷新、重新进入都能接着转） | 不管 |

## 二、一局的流程

```
玩家在平台大厅点"进入游戏"
  平台 ──POST /provider/launch──▶ 游戏服务器      返回 gameUrl（带 token）
  浏览器打开 gameUrl
  浏览器 ──GET /api/session?token=…──▶ 游戏服务器 ──POST /wallet/balance──▶ 平台

玩家按"旋转"
  浏览器 ──POST /api/spin──▶ 游戏服务器
      1. ──POST /wallet/bet──▶ 平台          扣投注（免费游戏跳过这一步）
      2. 游戏服务器算结果
      3. 把这一局写进永久记录
      4. ──POST /wallet/win──▶ 平台          派彩（0 也发，表示这一局结束）
  ◀── 结果（停点、中奖、局号、余额）
```

## 三、平台调用游戏服务器

### POST /provider/launch（需签名）

请求：`{ "playerId": "player-001", "playerName": "玩家一", "currency": "DEMO" }`
返回：`{ "token": "…", "gameUrl": "http://127.0.0.1:4173/?token=…", "expiresInSeconds": 86400 }`

平台把玩家的浏览器带到 `gameUrl`。token 24 小时内有效；过期后要从大厅重新进入。

### GET /api/rounds/{roundId}、GET /api/replay/{roundId}

按局号查这一局：前者返回 JSON（含"重新计算是否一致"），后者是给人看的回放页面。
（本机演示没有加权限；正式系统里只能由平台后台或客服带签名访问。）

## 四、游戏服务器调用平台（平台要实现的钱包接口）

全部是 `POST`，JSON 格式，地址前缀 `{平台}/wallet`。

| 接口 | 请求 | 成功返回 |
|---|---|---|
| `/wallet/balance` | `{ playerId }` | `{ balance }` |
| `/wallet/bet` | `{ playerId, transactionId, roundId, amount }` | `{ transactionId, balance }` |
| `/wallet/win` | `{ playerId, transactionId, roundId, amount }` | `{ transactionId, balance }` |
| `/wallet/refund` | `{ playerId, transactionId, refTransactionId, roundId }` | `{ transactionId, balance }` |

失败时返回 HTTP 4xx/5xx 和 `{ code, error }`：

| code | HTTP | 含义 | 游戏服务器怎么做 |
|---|---|---|---|
| `INSUFFICIENT_FUNDS` | 402 | 余额不足 | 告诉玩家，不开这一局 |
| `PLAYER_NOT_FOUND` | 404 | 没有这个玩家 | 报错 |
| `BAD_SIGNATURE` | 401 | 签名不对 | 报错（配置问题） |
| `TRANSACTION_CANCELLED` | 409 | 这笔扣款已被回滚 | 不再重试 |
| 其他 | 5xx | 平台临时故障 | 重试 |

## 五、规则（双方都必须遵守）

1. **签名**：每个请求带 `X-Operator-Id` 和 `X-Signature`。`X-Signature` = 用双方约定的密钥对**原始请求体**做 HMAC-SHA256，十六进制。签名不对一律拒绝（401）。
2. **交易号唯一、可重发**：`transactionId` 由游戏服务器生成，格式 `{局号}-bet` / `{局号}-win` / `{局号}-refund`。平台收到**重复的交易号**时，不能再扣或再加一次，只返回当前余额。这样游戏服务器遇到超时可以放心重发。
3. **扣款没有确认就回滚**：扣款请求两次都没有得到答复（每次 3 秒超时），游戏服务器取消这一局，并发 `refund`。平台如果其实已经扣了，就退回；如果根本没收到这笔扣款，就把这个交易号记为"已作废"，之后迟到的同号扣款要拒绝（409）。
4. **派彩必须送到**：派彩先当场重试 3 次；还失败就放进"待派彩队列"，每隔几秒到一分钟自动重发，直到平台确认。玩家照常看到结果，提示"派彩稍有延迟"。
5. **每局都有永久记录**：记录在派彩之前写入，文件只追加不修改（`data/*.rounds.jsonl`）。凭停点和百搭倍数可以 100% 重现这一局（引擎 `replaySpin`）。
6. **对账**：平台任何时候都应满足 `余额 = 充值 − 扣款 + 派彩 + 回滚`。模拟平台大厅每个玩家旁边都显示对账结果。

## 六、本机地址和密钥

| | 默认 | 环境变量 |
|---|---|---|
| 模拟平台（大厅 + 钱包） | http://127.0.0.1:8788 | `OPERATOR_PORT` |
| 游戏服务器 | http://127.0.0.1:8787 | `API_PORT` |
| 游戏网页 | http://127.0.0.1:4173 | `WEB_PORT` |
| 平台编号 / 密钥 | `demo-operator` / `local-demo-secret` | `OPERATOR_ID` / `OPERATOR_SECRET` |

## 七、离"真实供应商"还差什么（本项目不做）

- 数据库代替 JSON 文件；多台服务器时的会话和锁
- 多个平台、多币种、多档 RTP
- 平台后台访问回放、报表接口要签名或登录
- 第三方检测认证、牌照（只有真钱运营才需要；本项目只用虚拟积分）
