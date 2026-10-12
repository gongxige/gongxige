// Mock operator ("模拟平台"): stands in for a casino platform that integrates
// our game. It owns the players and their balances (virtual credits only) and
// implements the wallet API the game server calls: balance / bet / win /
// refund. It also has a small lobby page to launch the game and watch every
// transaction. The protocol is documented in docs/PROVIDER_API.md.
//
// Run: npm run operator   (default http://127.0.0.1:8788)

import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { escapeHtml, html, json, parseJson, readRaw, signedPost, verify, writeJsonAtomic } from './server/http.mjs';
import { replayPage } from './server/replay-page.mjs';

export const OPERATOR_PROTOCOL = 'provider-v1';
const port = Number(process.env.OPERATOR_PORT ?? 8788);
const operatorId = process.env.OPERATOR_ID ?? 'demo-operator';
const secret = process.env.OPERATOR_SECRET ?? 'local-demo-secret';
const providerUrl = process.env.PROVIDER_URL ?? `http://127.0.0.1:${process.env.API_PORT ?? 8787}`;
const gameWebUrl = process.env.GAME_WEB_URL ?? `http://127.0.0.1:${process.env.WEB_PORT ?? 4173}`;
const dataDir = process.env.DATA_DIR ?? join(process.cwd(), 'data');
const statePath = join(dataDir, process.env.OPERATOR_STATE_FILE ?? 'operator-state.json');

// ---------- state ----------
// players[id] = { name, balance, deposits }  (deposits = every credit ever added, for reconciliation)
// transactions[txId] = { txId, type, playerId, roundId, amount, status, balanceAfter, at, refTransactionId? }
function initialState() {
  // Carry over the balance from the old stand-alone demo, so nothing is "lost".
  let carried = 10_000;
  const old = join(dataDir, 'local-slot-state.v2.json');
  if (existsSync(old)) {
    try { carried = JSON.parse(readFileSync(old, 'utf8')).sessions?.['local-browser-demo-v1']?.credits ?? carried; } catch { /* keep default */ }
  }
  return {
    players: {
      'player-001': { name: '玩家一', balance: carried, deposits: carried },
      'player-002': { name: '玩家二', balance: 10_000, deposits: 10_000 },
    },
    transactions: {},
    order: [],
  };
}
const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : initialState();
const save = () => writeJsonAtomic(statePath, state);
save();

// Fault injection (lobby page): lets you watch the game server recover.
// 'win-down'  : the next 4 win calls fail with HTTP 500 (more than the game server's immediate retries)
// 'slow-bet'  : the next bet is taken, but it and every retry of it are answered only after 8 s,
//               so the game server gives up, cancels the round and refunds it
let fault = { kind: 'none', remaining: 0 };
const SLOW_MS = 8000;
const slowTransactions = new Set();

const isAmount = (value) => Number.isSafeInteger(value) && value >= 0;
const fail = (res, status, code, error) => json(res, status, { code, error });

function record(tx) {
  state.transactions[tx.txId] = tx;
  state.order.push(tx.txId);
  save();
  return tx;
}

// ---------- wallet API (called by the game server) ----------
function walletBalance(input, res) {
  const player = state.players[input.playerId];
  if (!player) return fail(res, 404, 'PLAYER_NOT_FOUND', '平台上没有这个玩家');
  return json(res, 200, { playerId: input.playerId, balance: player.balance, currency: 'DEMO' });
}

function walletBet(input, res) {
  const { playerId, transactionId, roundId, amount } = input;
  const player = state.players[playerId];
  if (!player) return fail(res, 404, 'PLAYER_NOT_FOUND', '平台上没有这个玩家');
  if (!transactionId || !roundId || !isAmount(amount) || amount === 0) return fail(res, 400, 'BAD_REQUEST', '扣款参数不完整');
  const existing = state.transactions[transactionId];
  if (existing) {
    // Same transaction sent again (a retry): answer the same way, never charge twice.
    if (existing.status === 'cancelled') return fail(res, 409, 'TRANSACTION_CANCELLED', '这笔扣款已被回滚，不能再扣');
    const answer = () => json(res, 200, { transactionId, balance: player.balance, duplicate: true });
    if (slowTransactions.has(transactionId)) { setTimeout(answer, SLOW_MS); return; }
    return answer();
  }
  if (player.balance < amount) return fail(res, 402, 'INSUFFICIENT_FUNDS', '平台余额不足');
  player.balance -= amount;
  record({ txId: transactionId, type: 'bet', playerId, roundId, amount, status: 'ok', balanceAfter: player.balance, at: new Date().toISOString() });
  const answer = () => json(res, 200, { transactionId, balance: player.balance });
  if (fault.kind === 'slow-bet') {
    fault = { kind: 'none', remaining: 0 };
    slowTransactions.add(transactionId);
    setTimeout(() => slowTransactions.delete(transactionId), 60_000).unref();
    setTimeout(answer, SLOW_MS);
    return;
  }
  answer();
}

function walletWin(input, res) {
  const { playerId, transactionId, roundId, amount } = input;
  const player = state.players[playerId];
  if (!player) return fail(res, 404, 'PLAYER_NOT_FOUND', '平台上没有这个玩家');
  if (!transactionId || !roundId || !isAmount(amount)) return fail(res, 400, 'BAD_REQUEST', '派彩参数不完整');
  if (fault.kind === 'win-down' && fault.remaining > 0) {
    fault.remaining -= 1;
    if (!fault.remaining) fault = { kind: 'none', remaining: 0 };
    return fail(res, 500, 'TEMPORARY_ERROR', '（模拟故障）平台暂时无法派彩');
  }
  if (state.transactions[transactionId]) return json(res, 200, { transactionId, balance: player.balance, duplicate: true });
  player.balance += amount;
  record({ txId: transactionId, type: 'win', playerId, roundId, amount, status: 'ok', balanceAfter: player.balance, at: new Date().toISOString() });
  return json(res, 200, { transactionId, balance: player.balance });
}

function walletRefund(input, res) {
  const { playerId, transactionId, refTransactionId, roundId } = input;
  const player = state.players[playerId];
  if (!player) return fail(res, 404, 'PLAYER_NOT_FOUND', '平台上没有这个玩家');
  if (!transactionId || !refTransactionId) return fail(res, 400, 'BAD_REQUEST', '回滚参数不完整');
  if (state.transactions[transactionId]) return json(res, 200, { transactionId, balance: player.balance, duplicate: true });
  const bet = state.transactions[refTransactionId];
  let amount = 0;
  if (!bet) {
    // The bet never arrived (or arrives later): remember it as cancelled so a late copy is refused.
    record({ txId: refTransactionId, type: 'bet', playerId, roundId, amount: 0, status: 'cancelled', balanceAfter: player.balance, at: new Date().toISOString() });
  } else if (bet.type === 'bet' && bet.status === 'ok') {
    amount = bet.amount;
    player.balance += amount;
    bet.status = 'refunded';
  }
  record({ txId: transactionId, type: 'refund', playerId, roundId, amount, refTransactionId, status: 'ok', balanceAfter: player.balance, at: new Date().toISOString() });
  return json(res, 200, { transactionId, balance: player.balance });
}

const WALLET = { '/wallet/balance': walletBalance, '/wallet/bet': walletBet, '/wallet/win': walletWin, '/wallet/refund': walletRefund };

// ---------- lobby (for people) ----------
/** Balance should always equal deposits − bets + wins + refunds; any gap means money went missing. */
function reconcile(playerId) {
  const player = state.players[playerId];
  let bets = 0; let wins = 0; let refunds = 0;
  for (const id of state.order) {
    const tx = state.transactions[id];
    if (tx.playerId !== playerId) continue;
    if (tx.type === 'bet' && tx.status !== 'cancelled') bets += tx.amount;
    if (tx.type === 'win') wins += tx.amount;
    if (tx.type === 'refund') refunds += tx.amount;
  }
  const expected = player.deposits - bets + wins + refunds;
  return { bets, wins, refunds, expected, ok: expected === player.balance };
}

const TYPE_LABEL = { bet: '扣款', win: '派彩', refund: '回滚' };
const STATUS_LABEL = { ok: '成功', refunded: '已回滚', cancelled: '已作废' };
const fmt = (n) => Number(n).toLocaleString('zh-CN');

function tables() {
  const players = Object.entries(state.players).map(([id, p]) => {
    const r = reconcile(id);
    return `<tr><td>${escapeHtml(p.name)}<small>${id}</small></td><td class="num">${fmt(p.balance)}</td>
      <td class="num">${fmt(r.bets)}</td><td class="num">${fmt(r.wins)}</td><td class="num">${fmt(r.refunds)}</td>
      <td>${r.ok ? '<span class="ok">✓ 一致</span>' : `<span class="bad">✗ 应为 ${fmt(r.expected)}</span>`}</td>
      <td class="actions"><a class="button primary" href="/launch?player=${id}" target="_blank">进入游戏</a>
      <form method="post" action="/admin/topup"><input type="hidden" name="player" value="${id}"><button>+10,000</button></form></td></tr>`;
  }).join('');
  const txs = state.order.slice(-60).reverse().map((id) => {
    const t = state.transactions[id];
    return `<tr class="${t.type}"><td>${t.at.slice(11, 19)}</td><td>${TYPE_LABEL[t.type]}</td><td>${escapeHtml(state.players[t.playerId]?.name ?? t.playerId)}</td>
      <td class="num">${t.type === 'bet' ? '−' : '+'}${fmt(t.amount)}</td><td class="num">${fmt(t.balanceAfter)}</td>
      <td>${t.roundId ? `<a href="/admin/replay?player=${encodeURIComponent(t.playerId)}&round=${encodeURIComponent(t.roundId)}" target="_blank">${escapeHtml(t.roundId)}</a>` : ''}</td>
      <td>${STATUS_LABEL[t.status] ?? t.status}</td><td><small>${escapeHtml(t.txId)}</small></td></tr>`;
  }).join('') || '<tr><td colspan="8" class="empty">还没有交易。点上面的"进入游戏"转几局。</td></tr>';
  return { players, txs };
}

function lobby() {
  const { players, txs } = tables();
  const faultText = fault.kind === 'none' ? '无' : fault.kind === 'win-down' ? `派彩故障（还剩 ${fault.remaining} 次）` : '下一次扣款超时';
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>模拟平台 · 大厅</title><style>
:root{--bg:#f3efe7;--panel:#fff;--ink:#2a1d12;--muted:#7a6a58;--line:#e4dccd;--accent:#9a4a16;--ok:#1d7a45;--bad:#b3261e}
@media (prefers-color-scheme:dark){:root{--bg:#17110b;--panel:#231a12;--ink:#f1e6d6;--muted:#b5a28a;--line:#3e3022;--accent:#f0a160;--ok:#6fd39a;--bad:#ff8a80}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.6 "PingFang SC","Microsoft YaHei",system-ui,sans-serif}
main{max-width:1100px;margin:0 auto;padding:24px 16px 48px}h1{font-size:22px;margin:0}h2{font-size:16px;margin:0 0 10px}
.sub{color:var(--muted);margin:4px 0 20px}section{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:16px;margin-bottom:16px;overflow-x:auto}
table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}th,td{padding:7px 8px;border-bottom:1px solid var(--line);text-align:left;white-space:nowrap}
th{color:var(--muted);font-weight:600;font-size:12px}.num{text-align:right}small{color:var(--muted);margin-left:6px}td small{margin:0}
td:first-child small{display:block}a{color:var(--accent)}.ok{color:var(--ok)}.bad{color:var(--bad);font-weight:600}.empty{color:var(--muted);text-align:center;padding:20px}
.actions{display:flex;gap:8px;align-items:center}form{margin:0;display:inline}button,.button{font:inherit;border:1px solid var(--line);background:transparent;color:var(--ink);border-radius:8px;padding:5px 12px;cursor:pointer;text-decoration:none}
.primary{background:var(--accent);border-color:var(--accent);color:#fff}tr.refund td{background:rgba(179,38,30,.06)}
.fault{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.fault p{margin:0;color:var(--muted);flex-basis:100%}
</style></head><body><main>
<h1>模拟平台 · 大厅</h1>
<p class="sub">这里扮演"博彩平台"：玩家和余额都在平台这边（只有虚拟积分）。游戏服务器每转一次都来这里扣款、派彩。平台编号 <b>${escapeHtml(operatorId)}</b>，游戏服务器 ${escapeHtml(providerUrl)}</p>
<section><h2>玩家钱包</h2><table><thead><tr><th>玩家</th><th class="num">余额</th><th class="num">累计扣款</th><th class="num">累计派彩</th><th class="num">累计回滚</th><th>对账</th><th></th></tr></thead><tbody id="players">${players}</tbody></table></section>
<section><h2>故障模拟</h2><div class="fault">
<form method="post" action="/admin/fault"><input type="hidden" name="kind" value="win-down"><button>派彩接口连续失败 4 次</button></form>
<form method="post" action="/admin/fault"><input type="hidden" name="kind" value="slow-bet"><button>下一次扣款超时</button></form>
<form method="post" action="/admin/fault"><input type="hidden" name="kind" value="none"><button>恢复正常</button></form>
<span>当前：<b id="fault">${faultText}</b></span>
<p>派彩故障时，游戏服务器会先重试，失败就放进待派彩队列，几秒后自动补发；扣款超时时，游戏服务器取消这一局并发回滚，钱会退回。两种情况对账都应保持"一致"。</p></div></section>
<section><h2>最近交易</h2><table><thead><tr><th>时间</th><th>类型</th><th>玩家</th><th class="num">金额</th><th class="num">交易后余额</th><th>局号（点击回放）</th><th>状态</th><th>交易号</th></tr></thead><tbody id="txs">${txs}</tbody></table></section>
</main><script>
setInterval(async () => {
  try {
    const r = await fetch('/admin/tables'); if (!r.ok) return;
    const t = await r.json();
    document.getElementById('players').innerHTML = t.players;
    document.getElementById('txs').innerHTML = t.txs;
    document.getElementById('fault').textContent = t.fault;
  } catch {}
}, 2000);
</script></body></html>`;
}

async function launch(playerId, res) {
  const player = state.players[playerId];
  if (!player) return html(res, 404, '没有这个玩家');
  try {
    const { status, body } = await signedPost(`${providerUrl}/provider/launch`, { operatorId, playerId, playerName: player.name, currency: 'DEMO' }, { secret, operatorId });
    if (status !== 200 || !body.gameUrl) throw new Error(body.error || `HTTP ${status}`);
    res.writeHead(302, { location: body.gameUrl });
    res.end();
  } catch (error) {
    html(res, 502, `<meta charset="utf-8"><p style="font:16px sans-serif;padding:24px">游戏服务器没有响应（${escapeHtml(error.message)}）。请确认已经用 <code>npm start</code> 启动。</p>`);
  }
}

// ---------- server ----------
const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  try {
    if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, { ok: true, role: 'mock-operator', protocol: OPERATOR_PROTOCOL, operatorId });
    if (req.method === 'GET' && url.pathname === '/') return html(res, 200, lobby());
    if (req.method === 'GET' && url.pathname === '/launch') return launch(url.searchParams.get('player'), res);
    if (req.method === 'GET' && url.pathname === '/admin/tables') {
      const faultText = fault.kind === 'none' ? '无' : fault.kind === 'win-down' ? `派彩故障（还剩 ${fault.remaining} 次）` : '下一次扣款超时';
      return json(res, 200, { ...tables(), fault: faultText });
    }
    // Round replay: asks the game server with a signature, only for this operator's own player.
    if (req.method === 'GET' && url.pathname === '/admin/replay') {
      const { status, body } = await signedPost(`${providerUrl}/provider/rounds`, { playerId: url.searchParams.get('player'), roundId: url.searchParams.get('round') }, { secret, operatorId });
      return html(res, status, replayPage(status === 200 ? body.round : null, gameWebUrl, status === 200 ? body.replay : undefined));
    }
    if (req.method === 'GET' && url.pathname === '/admin/state') return json(res, 200, { players: Object.fromEntries(Object.keys(state.players).map((id) => [id, { ...state.players[id], ...reconcile(id) }])), transactions: state.order.map((id) => state.transactions[id]) });
    if (req.method === 'POST' && url.pathname.startsWith('/admin/')) {
      const form = new URLSearchParams(await readRaw(req));
      if (url.pathname === '/admin/topup') {
        const player = state.players[form.get('player')];
        if (player) { player.balance += 10_000; player.deposits += 10_000; save(); }
      } else if (url.pathname === '/admin/fault') {
        const kind = form.get('kind');
        fault = kind === 'win-down' ? { kind, remaining: 4 } : kind === 'slow-bet' ? { kind, remaining: 1 } : { kind: 'none', remaining: 0 };
      }
      res.writeHead(303, { location: '/' });
      return res.end();
    }

    const handler = WALLET[url.pathname];
    if (req.method === 'POST' && handler) {
      const raw = await readRaw(req);
      if (req.headers['x-operator-id'] !== operatorId || !verify(raw, req.headers['x-signature'], secret)) return fail(res, 401, 'BAD_SIGNATURE', '签名不对，拒绝处理');
      return handler(parseJson(raw), res);
    }
    json(res, 404, { error: 'Not found' });
  } catch (error) {
    json(res, 400, { code: 'BAD_REQUEST', error: error instanceof Error ? error.message : 'Bad request' });
  }
});

server.on('error', (error) => {
  if (error.code !== 'EADDRINUSE') throw error;
  console.log(`端口 ${port} 已被占用（可能模拟平台已经在运行）。`);
  process.exit(1);
});
server.listen(port, '127.0.0.1', () => console.log(`模拟平台（大厅）: http://127.0.0.1:${port}  平台编号 ${operatorId}`));
