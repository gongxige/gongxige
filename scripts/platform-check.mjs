// End-to-end check of the demo platform: starts the platform service and the
// game server on spare ports with a throw-away data folder, then walks a new
// player through register → deposit request → admin approval → 50 rounds →
// withdrawal request → admin approval → reconciliation, and checks the money
// rules (no overdrawn withdrawals, frozen credits cannot be bet, one approval
// per request, concurrent bets never go negative). Usage: npm run check:platform [-- <rounds>]

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { signedPost } from '../server/http.mjs';

const ROUNDS = Number(process.argv[2] ?? 50);
const BET = 80;
// A per-process port pair keeps repeated checks independent (same idea as check:provider).
const OP_PORT = 19_000 + (process.pid % 500) * 2;
const API_PORT = OP_PORT + 1;
const OP = `http://127.0.0.1:${OP_PORT}`;
const API = `http://127.0.0.1:${API_PORT}`;
const ADMIN_PASSWORD = randomBytes(12).toString('base64url');
const SECRET = 'local-demo-secret';
const dataDir = mkdtempSync(join(tmpdir(), 'platform-check-'));
const env = { ...process.env, ADMIN_PASSWORD, DATA_DIR: dataDir, OPERATOR_PORT: String(OP_PORT), API_PORT: String(API_PORT), OPERATOR_URL: OP, PROVIDER_URL: API, OPERATOR_SECRET: SECRET, STATE_FILE: 'game-server-state.json', RABBIT_TRIGGER_ROLL: '0' };
const children = [spawn(process.execPath, ['platform-server.mjs'], { env, stdio: 'ignore' }), spawn(process.execPath, ['server.mjs'], { env, stdio: 'ignore' })];
process.on('exit', () => { children.forEach((c) => c.kill()); try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* still in use on Windows */ } });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const step = (text) => console.log(`✓ ${text}`);
async function call(url, { method = 'GET', body, cookie } = {}) {
  const r = await fetch(url, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => ({})), cookie: r.headers.get('set-cookie')?.split(';')[0] ?? '' };
}
const post = (url, body, cookie) => call(url, { method: 'POST', body, cookie });

for (let i = 0; i < 50; i += 1) { if ((await fetch(`${API}/api/health`).catch(() => null))?.ok && (await fetch(`${OP}/health`).catch(() => null))?.ok) break; await sleep(200); }

const admin = (await post(`${OP}/api/admin/auth/login`, { username: 'admin', password: ADMIN_PASSWORD })).cookie;
assert.ok(admin, '管理员登录');
const adminGet = (path) => call(`${OP}/api/admin${path}`, { cookie: admin });
const adminPost = (path, body = {}) => post(`${OP}/api/admin${path}`, body, admin);

// 1. Register and log in.
const username = `e2e-${randomBytes(3).toString('hex')}`;
const registered = await post(`${OP}/auth/register`, { username, password: 'e2e-player-pass-1' });
assert.equal(registered.status, 201);
const playerId = registered.body.player.id;
const player = (await post(`${OP}/auth/login`, { username, password: 'e2e-player-pass-1' })).cookie;
assert.ok(player);
const wallet = async () => (await call(`${OP}/api/wallet`, { cookie: player })).body;
const start = await wallet();
assert.deepEqual([start.balance, start.frozen_balance], [10_000, 0]);
step(`注册并登录新玩家 ${username}：初始演示积分 10,000`);

// 2. Deposit request → admin approves.
const deposit = (await post(`${OP}/api/deposit-requests`, { amount: 5_000 }, player)).body.request;
assert.equal(deposit.status, 'pending');
assert.equal((await wallet()).balance, 10_000, '未审核的充值不加积分');
assert.equal((await adminPost(`/deposit-requests/${deposit.id}/approve`)).status, 200);
assert.equal((await wallet()).balance, 15_000);
assert.equal((await adminPost(`/deposit-requests/${deposit.id}/approve`)).status, 409);
step('充值申请 5,000 → 后台通过后到账；再通过一次被拒绝');

// 3. Play rounds through the game server.
const { gameUrl } = (await post(`${OP}/games/wild-frontier/launch`, {}, player)).body;
const token = new URL(gameUrl).searchParams.get('token');
const spin = () => post(`${API}/api/spin`, { token, bet: BET });
let credits = (await wallet()).balance;
let free = 0;
let staked = 0;
let won = 0;
for (let i = 0; i < ROUNDS; i += 1) {
  const { status, body } = await spin();
  assert.equal(status, 200, body.error);
  const paid = body.mode === 'paid';
  if (!paid) free += 1;
  staked += paid ? body.bet : 0;
  won += body.payout;
  assert.equal(body.credits, credits - (paid ? body.bet : 0) + body.payout, `round ${body.roundId}`);
  credits = body.credits;
}
assert.equal((await wallet()).balance, credits);
assert.equal(credits, 15_000 - staked + won);
const rounds = (await adminGet('/rounds')).body.rounds.filter((r) => r.playerId === playerId);
assert.equal(rounds.length, ROUNDS);
step(`玩 ${ROUNDS} 局（含 ${free} 局免费游戏）：下注 ${staked}、赢分 ${won}，每局余额 = −投注 + 赢分，平台余额 ${credits} 一致，后台能看到全部 ${ROUNDS} 局`);

// 4. Withdrawal request → admin approves, only once.
const withdrawal = (await post(`${OP}/api/withdrawal-requests`, { amount: 1_000 }, player)).body.request;
assert.deepEqual([(await wallet()).balance, (await wallet()).frozen_balance], [credits - 1_000, 1_000]);
const approvals = await Promise.all([1, 2, 3].map(() => adminPost(`/withdrawal-requests/${withdrawal.id}/approve`)));
assert.deepEqual(approvals.map((r) => r.status).sort(), [200, 409, 409]);
assert.equal((await adminPost(`/withdrawal-requests/${withdrawal.id}/approve`)).status, 409);
assert.equal((await adminPost(`/withdrawal-requests/${withdrawal.id}/reject`)).status, 409);
credits -= 1_000;
assert.deepEqual([(await wallet()).balance, (await wallet()).frozen_balance], [credits, 0]);
step('提现申请 1,000 → 立即冻结 → 后台通过后从冻结中扣除；同一提现不能通过两次（同时发 3 次也只成功 1 次）');

// 5. Reconciliation.
const reconciled = async () => (await adminGet('/reconciliation')).body.players;
let report = (await reconciled()).find((r) => r.playerId === playerId);
assert.deepEqual([report.ok, report.balance, report.ledgerBalance, report.frozen, report.ledgerFrozen], [true, credits, credits, 0, 0]);
const ledger = (await adminGet(`/transactions?player=${playerId}`)).body.transactions;
assert.equal(ledger.reduce((sum, t) => sum + t.balanceDelta, 0), credits);
assert.ok((await reconciled()).every((r) => r.ok));
step(`对账一致：钱包 ${credits} = ${ledger.length} 条资金流水之和；所有玩家对账一致`);

// 6. Not enough balance: a withdrawal above the available credits is refused and changes nothing.
const overdraw = await post(`${OP}/api/withdrawal-requests`, { amount: credits + 1 }, player);
assert.equal(overdraw.status, 400);
assert.deepEqual([(await wallet()).balance, (await wallet()).frozen_balance], [credits, 0]);
step('余额不足不能提现：申请超过可用余额被拒绝，余额和冻结都不变');

// 7. Frozen credits cannot be bet: freeze all but 40, then an 80 bet is refused.
while ((await call(`${API}/api/session?token=${token}`)).body.freeSpins) credits = (await spin()).body.credits;
const hold = (await post(`${OP}/api/withdrawal-requests`, { amount: credits - 40 }, player)).body.request;
assert.deepEqual([(await wallet()).balance, (await wallet()).frozen_balance], [40, credits - 40]);
const blocked = await spin();
assert.equal(blocked.status, 402);
assert.deepEqual([(await wallet()).balance, (await wallet()).frozen_balance], [40, credits - 40]);
assert.equal((await adminPost(`/withdrawal-requests/${hold.id}/reject`, { note: '检查脚本退回' })).status, 200);
assert.deepEqual([(await wallet()).balance, (await wallet()).frozen_balance], [credits, 0]);
step(`冻结金额不能下注：冻结 ${credits - 40} 后只剩 40，下注 ${BET} 被拒绝；拒绝提现后冻结全部退回`);

// 8. 20 bets at the same time never overdraw the wallet.
const target = 500;
assert.equal((await adminPost(`/players/${playerId}/adjustment`, { amount: target - credits, reason: '检查脚本：把余额调到 500 测并发' })).status, 200);
const bets = await Promise.all(Array.from({ length: 20 }, (_, i) => signedPost(`${OP}/wallet/bet`, { playerId, transactionId: `e2e-race-${i}`, roundId: `e2e-race-${i}`, amount: BET }, { secret: SECRET, operatorId: 'demo-operator' })));
const accepted = bets.filter((r) => r.status === 200).length;
assert.equal(accepted, Math.floor(target / BET));
assert.ok(bets.every((r) => r.status === 200 || r.status === 402));
const afterRace = await wallet();
assert.equal(afterRace.balance, target - accepted * BET);
assert.ok(afterRace.balance >= 0);
const spins = await Promise.all(Array.from({ length: 20 }, () => spin()));
assert.ok(spins.every((r) => [200, 402, 409].includes(r.status)), spins.map((r) => r.status).join(','));
assert.ok((await wallet()).balance >= 0);
report = (await reconciled()).find((r) => r.playerId === playerId);
assert.equal(report.ok, true);
step(`同时 20 次下注不会扣成负数：余额 ${target} 时 20 笔 ${BET} 只成功 ${accepted} 笔，剩 ${afterRace.balance}；同时 20 次转动后余额仍 ≥ 0，对账一致`);

// 9. Mahjong Cascade end to end: new player → deposit → approved → 50+ rounds including a free-spin
//    feature → withdrawal → approved → reconciled. Add a small approved demo
//    deposit so a low-return random sample cannot make this check flaky.
const mjName = `e2e-mj-${randomBytes(3).toString('hex')}`;
assert.equal((await post(`${OP}/auth/register`, { username: mjName, password: 'e2e-player-pass-1' })).status, 201);
const mj = (await post(`${OP}/auth/login`, { username: mjName, password: 'e2e-player-pass-1' })).cookie;
const mjWallet = async () => (await call(`${OP}/api/wallet`, { cookie: mj })).body;
let mjCredits = (await mjWallet()).balance;
assert.equal(mjCredits, 10_000);
const mjDeposit = (await post(`${OP}/api/deposit-requests`, { amount: 5_000 }, mj)).body.request;
assert.equal(mjDeposit.status, 'pending');
assert.equal((await adminPost(`/deposit-requests/${mjDeposit.id}/approve`)).status, 200);
mjCredits = (await mjWallet()).balance;
assert.equal(mjCredits, 15_000);
const mjLaunch = await post(`${OP}/games/mahjong-cascade/launch`, {}, mj);
assert.equal(mjLaunch.status, 200);
const mjToken = new URL(mjLaunch.body.gameUrl).searchParams.get('token');
const mjSession = (await call(`${API}/api/session?token=${mjToken}`)).body;
const MJ_BET = mjSession.allowedBets[0];
assert.equal(MJ_BET, 100);
let mjRounds = 0; let mjPaid = 0; let mjFree = 0; let mjStaked = 0; let mjWon = 0; let mjCascades = 0;
while ((mjPaid < ROUNDS || mjFree === 0 || mjSession.freeSpins) && mjPaid < 1500) {
  const { status, body } = await post(`${API}/api/spin`, { token: mjToken, bet: MJ_BET });
  assert.equal(status, 200, body.error);
  assert.equal(body.gameId, 'mahjong-cascade');
  const paid = body.mode === 'paid';
  if (paid) { mjPaid += 1; mjStaked += body.bet; } else mjFree += 1;
  mjWon += body.payout; mjRounds += 1; mjCascades += body.cascadeSteps.length;
  assert.equal(body.credits, mjCredits - (paid ? body.bet : 0) + body.payout, `mahjong round ${body.roundId}`);
  mjCredits = body.credits;
  mjSession.freeSpins = body.freeSpins;
}
assert.ok(mjPaid >= ROUNDS, `mahjong paid rounds ${mjPaid}`);
assert.ok(mjFree > 0, `free spins were played within ${mjPaid} paid rounds`);
assert.equal((await mjWallet()).balance, mjCredits);
assert.equal(mjCredits, 15_000 - mjStaked + mjWon);
const mjRecords = (await call(`${OP}/api/game-records`, { cookie: mj })).body.records;
assert.ok(mjRecords.length > 0 && mjRecords.every((r) => r.gameId === 'mahjong-cascade'), 'player sees only own mahjong rounds');
step(`麻将连连胡：使用注册送的 10,000 积分玩 ${mjRounds} 局（付费 ${mjPaid}、免费 ${mjFree}，共 ${mjCascades} 段消除连锁）：下注 ${mjStaked}、赢分 ${mjWon}，每局余额 = −投注 + 赢分，平台余额 ${mjCredits} 一致`);
const mjWithdrawal = (await post(`${OP}/api/withdrawal-requests`, { amount: 1_000 }, mj)).body.request;
assert.equal((await adminPost(`/withdrawal-requests/${mjWithdrawal.id}/approve`)).status, 200);
mjCredits -= 1_000;
assert.deepEqual([(await mjWallet()).balance, (await mjWallet()).frozen_balance], [mjCredits, 0]);
const mjReport = (await reconciled()).find((r) => r.username === mjName);
assert.deepEqual([mjReport.ok, mjReport.balance, mjReport.ledgerBalance], [true, mjCredits, mjCredits]);
assert.ok((await reconciled()).every((r) => r.ok));
step(`麻将连连胡：提现 1,000 → 后台通过 → 对账一致（钱包 ${mjCredits} = 流水之和），所有玩家对账一致`);

// 10. Jade Rabbit end to end: register, approve a deposit, play 50 paid
// parent rounds plus every triggered eight-spin mode, then withdraw and reconcile.
const rabbitName = `e2e-rabbit-${randomBytes(3).toString('hex')}`;
assert.equal((await post(`${OP}/auth/register`, { username: rabbitName, password: 'e2e-player-pass-1' })).status, 201);
const rabbit = (await post(`${OP}/auth/login`, { username: rabbitName, password: 'e2e-player-pass-1' })).cookie;
assert.ok(rabbit);
const rabbitWallet = async () => (await call(`${OP}/api/wallet`, { cookie: rabbit })).body;
const rabbitDeposit = (await post(`${OP}/api/deposit-requests`, { amount: 5_000 }, rabbit)).body.request;
assert.equal(rabbitDeposit.status, 'pending');
assert.equal((await adminPost(`/deposit-requests/${rabbitDeposit.id}/approve`)).status, 200);
assert.equal((await rabbitWallet()).balance, 15_000);

const rabbitLaunch = await post(`${OP}/games/jade-rabbit/launch`, {}, rabbit);
assert.equal(rabbitLaunch.status, 200);
const rabbitToken = new URL(rabbitLaunch.body.gameUrl).searchParams.get('token');
assert.ok(rabbitToken);
const rabbitSpin = () => post(`${API}/api/spin`, { token: rabbitToken, bet: 100 });
let rabbitCredits = (await call(`${API}/api/session?token=${rabbitToken}`)).body.credits;
let rabbitPaid = 0;
let rabbitFree = 0;
let rabbitStaked = 0;
let rabbitWon = 0;
let rabbitModeRemaining = 0;
while (rabbitPaid < ROUNDS || rabbitModeRemaining > 0) {
  const { status, body } = await rabbitSpin();
  assert.equal(status, 200, body.error);
  assert.equal(body.gameId, 'jade-rabbit');
  const paid = body.mode === 'paid';
  if (paid) {
    rabbitPaid += 1;
    rabbitStaked += body.bet;
    if (rabbitPaid === 1) {
      assert.equal(body.triggered, true, 'fixed test trigger must enter Jade Rabbit mode');
      assert.equal(body.freeSpinsAwarded, 8);
    }
    rabbitModeRemaining = body.freeSpins?.remaining ?? 0;
  } else {
    rabbitFree += 1;
    rabbitModeRemaining = body.freeSpins?.remaining ?? 0;
  }
  rabbitWon += body.payout;
  assert.equal(body.credits, rabbitCredits - (paid ? body.bet : 0) + body.payout, `rabbit round ${body.roundId}`);
  rabbitCredits = body.credits;
}
assert.equal(rabbitPaid, ROUNDS);
assert.ok(rabbitFree >= 8, 'Jade Rabbit mode rounds were played');
assert.equal((await rabbitWallet()).balance, rabbitCredits);
assert.equal(rabbitCredits, 15_000 - rabbitStaked + rabbitWon);
const rabbitRecords = (await call(`${OP}/api/game-records`, { cookie: rabbit })).body.records;
assert.ok(rabbitRecords.length > 0, 'player has Jade Rabbit records');
assert.ok(rabbitRecords.every((r) => r.gameId === 'jade-rabbit'));
step(`Jade Rabbit: ${rabbitPaid} paid rounds + ${rabbitFree} mode rounds, staked ${rabbitStaked}, won ${rabbitWon}, balance ${rabbitCredits}`);

const rabbitWithdrawal = (await post(`${OP}/api/withdrawal-requests`, { amount: 1_000 }, rabbit)).body.request;
assert.equal((await adminPost(`/withdrawal-requests/${rabbitWithdrawal.id}/approve`)).status, 200);
rabbitCredits -= 1_000;
assert.deepEqual([(await rabbitWallet()).balance, (await rabbitWallet()).frozen_balance], [rabbitCredits, 0]);
const rabbitReport = (await reconciled()).find((r) => r.username === rabbitName);
assert.deepEqual([rabbitReport.ok, rabbitReport.balance, rabbitReport.ledgerBalance], [true, rabbitCredits, rabbitCredits]);
assert.ok((await reconciled()).every((r) => r.ok));
step(`Jade Rabbit withdrawal approved and reconciled: balance ${rabbitCredits}`);
console.log('\n全部通过。');

process.exit(0);
