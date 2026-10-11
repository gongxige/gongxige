// End-to-end check of the provider setup: starts a mock operator and the game
// server on spare ports with a throw-away data folder, plays real rounds
// through the HTTP APIs and checks that the money always adds up — also when
// the operator's wallet fails. Usage: npm run check:provider [-- <spins>]

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sign, signedPost } from '../server/http.mjs';

const SPINS = Number(process.argv[2] ?? 300);
const OP_PORT = 8898;
const API_PORT = 8897;
const OP = `http://127.0.0.1:${OP_PORT}`;
const API = `http://127.0.0.1:${API_PORT}`;
const env = { ...process.env, DATA_DIR: mkdtempSync(join(tmpdir(), 'provider-check-')), OPERATOR_PORT: String(OP_PORT), API_PORT: String(API_PORT), OPERATOR_URL: OP, PROVIDER_URL: API, STATE_FILE: 'game-server-state.json' };
const children = [spawn(process.execPath, ['mock-operator.mjs'], { env, stdio: 'ignore' }), spawn(process.execPath, ['server.mjs'], { env, stdio: 'ignore' })];
process.on('exit', () => children.forEach((c) => c.kill()));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const getJson = async (url, init) => { const r = await fetch(url, init); return { status: r.status, body: await r.json().catch(() => ({})) }; };
const spinOnce = (token, bet) => getJson(`${API}/api/spin`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, bet }) });
const opState = async () => (await getJson(`${OP}/admin/state`)).body;
const setFault = (kind) => fetch(`${OP}/admin/fault`, { method: 'POST', body: new URLSearchParams({ kind }), redirect: 'manual' });
const step = (text) => console.log(`✓ ${text}`);

for (let i = 0; i < 50; i += 1) { if ((await getJson(`${API}/api/health`).catch(() => null))?.status === 200 && (await getJson(`${OP}/health`).catch(() => null))?.status === 200) break; await sleep(200); }

// Launch: the operator asks the game server for a session (signed).
const launched = await signedPost(`${API}/provider/launch`, { playerId: 'player-002', playerName: '玩家二' }, { secret: 'local-demo-secret', operatorId: 'demo-operator' });
assert.equal(launched.status, 200);
const token = launched.body.token;
assert.ok(launched.body.gameUrl.includes(token));
const forged = await signedPost(`${API}/provider/launch`, { playerId: 'player-002' }, { secret: 'wrong-secret', operatorId: 'demo-operator' });
assert.equal(forged.status, 401);
assert.equal((await spinOnce('not-a-token', 80)).status, 401);
step('启动游戏需要正确签名；没有有效会话不能旋转');

// Wallet rejects unsigned or forged calls, and never charges the same transaction twice.
const forgedBet = await fetch(`${OP}/wallet/bet`, { method: 'POST', headers: { 'x-operator-id': 'demo-operator', 'x-signature': sign('{}', 'nope') }, body: JSON.stringify({ playerId: 'player-002', transactionId: 'x', roundId: 'x', amount: 40 }) });
assert.equal(forgedBet.status, 401);
const before = (await opState()).players['player-002'].balance;
const dup = { playerId: 'player-002', transactionId: 'dup-check-bet', roundId: 'dup-check', amount: 40 };
const opts = { secret: 'local-demo-secret', operatorId: 'demo-operator' };
await signedPost(`${OP}/wallet/bet`, dup, opts);
await signedPost(`${OP}/wallet/bet`, dup, opts);
await signedPost(`${OP}/wallet/refund`, { playerId: 'player-002', transactionId: 'dup-check-refund', refTransactionId: 'dup-check-bet', roundId: 'dup-check' }, opts);
assert.equal((await opState()).players['player-002'].balance, before);
step('钱包拒绝伪造签名；同一交易号重发只扣一次；回滚退回原额');

// Normal play.
const session = (await getJson(`${API}/api/session?token=${token}`)).body;
let balance = session.credits;
const roundIds = [];
let free = 0;
for (let i = 0; i < SPINS; i += 1) {
  const { status, body } = await spinOnce(token, 80);
  assert.equal(status, 200, body.error);
  roundIds.push(body.roundId);
  if (body.mode === 'free') free += 1;
  const expected = balance - (body.mode === 'paid' ? body.bet : 0) + body.payout;
  assert.equal(body.credits, expected, `round ${body.roundId}`);
  balance = body.credits;
}
let s = await opState();
assert.equal(s.players['player-002'].balance, balance);
assert.ok(s.players['player-002'].ok, 'reconciliation');
step(`连转 ${SPINS} 局（含 ${free} 局免费游戏）：每局余额变化 = −投注 + 赢分，与平台余额一致，对账一致`);

const byRound = new Map();
for (const tx of s.transactions) { if (!byRound.has(tx.roundId)) byRound.set(tx.roundId, []); byRound.get(tx.roundId).push(tx); }
for (const id of roundIds) {
  const { body } = await getJson(`${API}/api/rounds/${id}`);
  assert.ok(body.replay.matches, `replay ${id}`);
  assert.equal(body.round.status, 'settled');
  const txs = byRound.get(id);
  assert.equal(txs.filter((t) => t.type === 'win').length, 1);
  assert.equal(txs.filter((t) => t.type === 'bet').length, body.round.mode === 'base' ? 1 : 0);
  assert.equal(txs.find((t) => t.type === 'win').amount, body.round.payout);
}
const page = await fetch(`${API}/api/replay/${roundIds[0]}`).then((r) => r.text());
assert.ok(page.includes('完全一致'));
step('每一局都能按局号查到、回放结果一致；每局正好 1 笔派彩，付费局正好 1 笔扣款');

// Fault 1: wins fail for a while → the round still counts, the win is delivered later.
async function playUntilPaid() { while (true) { const r = await spinOnce(token, 80); assert.equal(r.status, 200); if (r.body.mode === 'paid') return r.body; } }
while ((await getJson(`${API}/api/session?token=${token}`)).body.freeSpins) await spinOnce(token, 80);
await setFault('win-down');
const late = await playUntilPaid();
assert.equal(late.settlementPending, true);
assert.equal((await getJson(`${API}/api/rounds/${late.roundId}`)).body.round.status, 'win-pending');
for (let i = 0; i < 40 && (await getJson(`${API}/api/rounds/${late.roundId}`)).body.round.status !== 'settled'; i += 1) await sleep(500);
assert.equal((await getJson(`${API}/api/rounds/${late.roundId}`)).body.round.status, 'settled');
s = await opState();
assert.ok(s.players['player-002'].ok);
assert.equal(s.players['player-002'].balance, late.credits);
step('派彩接口连续失败：玩家照常看到结果，派彩进入待发队列，几秒后自动补发成功，余额和对账一致');

// Fault 2: the bet is taken but the answer never comes in time → the round is cancelled and refunded.
while ((await getJson(`${API}/api/session?token=${token}`)).body.freeSpins) await spinOnce(token, 80);
const beforeSlow = (await opState()).players['player-002'].balance;
await setFault('slow-bet');
const slow = await spinOnce(token, 80);
assert.equal(slow.status, 502);
assert.equal(slow.body.code, 'BET_UNCONFIRMED');
await sleep(4000); // let the late answer arrive; it must not change anything
s = await opState();
assert.equal(s.players['player-002'].balance, beforeSlow);
assert.ok(s.players['player-002'].ok);
assert.ok(s.transactions.some((t) => t.type === 'refund' && t.amount === 80));
step('扣款超时：本局取消、自动回滚，玩家余额不变，对账一致');

// Not enough money: the operator refuses, nothing is recorded as played.
await signedPost(`${OP}/wallet/bet`, { playerId: 'player-002', transactionId: 'drain', roundId: 'drain', amount: (await opState()).players['player-002'].balance }, opts);
const broke = await spinOnce(token, 80);
assert.equal(broke.status, 402);
step('平台余额不足时拒绝下注');

console.log('\n全部通过。');
process.exit(0);
