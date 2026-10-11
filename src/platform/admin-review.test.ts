import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { spawn, type ChildProcess } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const port = 26000 + (process.pid % 1000);
const apiPort = port + 1000;
const directory = mkdtempSync(join(tmpdir(), 'platform-review-'));
const base = `http://127.0.0.1:${port}`;
const apiBase = `http://127.0.0.1:${apiPort}`;
const ADMIN_PASSWORD = 'admin-review-pass-1';
let server: ChildProcess;
let apiServer: ChildProcess;

type Json = Record<string, any>;
async function request(path: string, init: RequestInit = {}, cookie = '') {
  const response = await fetch(`${base}${path}`, { ...init, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...init.headers } });
  const text = await response.text();
  let body: Json = {};
  try { body = JSON.parse(text); } catch { body = { text }; }
  return { status: response.status, body, cookie: response.headers.get('set-cookie')?.split(';')[0] ?? '' };
}
const post = (path: string, body: unknown, cookie = '') => request(path, { method: 'POST', body: JSON.stringify(body) }, cookie);

let admin = '';
async function newPlayer(username: string) {
  const { body } = await post('/auth/register', { username, password: 'player-pass-1' });
  const cookie = (await post('/auth/login', { username, password: 'player-pass-1' })).cookie;
  return { id: body.player.id as string, cookie };
}
const wallet = async (cookie: string) => (await request('/api/wallet', {}, cookie)).body;
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

before(async () => {
  const env = { ...process.env, API_PORT: String(apiPort), OPERATOR_PORT: String(port), PROVIDER_URL: apiBase, DATA_DIR: directory, ADMIN_PASSWORD };
  apiServer = spawn(process.execPath, ['server.mjs'], { env, stdio: 'ignore' });
  server = spawn(process.execPath, ['platform-server.mjs'], { env, stdio: 'ignore' });
  for (let i = 0; i < 50; i += 1) {
    const [platform, provider] = await Promise.all([fetch(`${base}/health`).catch(() => null), fetch(`${apiBase}/api/health`).catch(() => null)]);
    if (platform?.ok && provider?.ok) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  admin = (await post('/api/admin/auth/login', { username: 'admin', password: ADMIN_PASSWORD })).cookie;
  assert.ok(admin, 'admin login');
});
after(async () => { server.kill(); apiServer.kill(); await Promise.all([new Promise((resolve) => server.once('exit', resolve)), new Promise((resolve) => apiServer.once('exit', resolve))]); rmSync(directory, { recursive: true, force: true }); });

describe('后台审核、流水、游戏记录、对账、故障模拟', () => {
  it('新增的后台接口都要求管理员：未登录和玩家 cookie 都返回 401', async () => {
    const player = await newPlayer('review-guard');
    const routes: [string, string][] = [
      ['GET', '/api/admin/deposit-requests'], ['POST', '/api/admin/deposit-requests/x/approve'], ['POST', '/api/admin/deposit-requests/x/reject'],
      ['GET', '/api/admin/withdrawal-requests'], ['POST', '/api/admin/withdrawal-requests/x/approve'], ['POST', '/api/admin/withdrawal-requests/x/reject'],
      ['GET', '/api/admin/transactions'], ['GET', '/api/admin/rounds'], ['GET', '/api/admin/rounds/x/replay'],
      ['GET', '/api/admin/reconciliation'], ['GET', '/api/admin/faults'], ['POST', '/api/admin/faults'],
    ];
    for (const [method, path] of routes) {
      for (const cookie of ['', player.cookie]) {
        const init = method === 'POST' ? { method, body: JSON.stringify({ kind: 'win-down' }) } : { method };
        assert.equal((await request(path, init, cookie)).status, 401, `${method} ${path} ${cookie ? '玩家 cookie' : '未登录'}`);
      }
    }
  });

  it('充值审核：通过后加积分并写日志；同一申请不能再通过或拒绝；拒绝不动余额', async () => {
    const player = await newPlayer('review-deposit');
    const first = (await post('/api/deposit-requests', { amount: 700 }, player.cookie)).body.request;
    const pending = (await request('/api/admin/deposit-requests?status=pending', {}, admin)).body.requests;
    assert.ok(pending.some((r: Json) => r.id === first.id && r.username === 'review-deposit' && r.amount === 700));
    const approved = await post(`/api/admin/deposit-requests/${first.id}/approve`, { note: '核对无误' }, admin);
    assert.equal(approved.status, 200);
    assert.equal((await wallet(player.cookie)).balance, 10_700);
    assert.equal((await post(`/api/admin/deposit-requests/${first.id}/approve`, {}, admin)).status, 409);
    assert.equal((await post(`/api/admin/deposit-requests/${first.id}/reject`, {}, admin)).status, 409);
    assert.equal((await wallet(player.cookie)).balance, 10_700);

    const second = (await post('/api/deposit-requests', { amount: 300 }, player.cookie)).body.request;
    assert.equal((await post(`/api/admin/deposit-requests/${second.id}/reject`, { note: '金额不符' }, admin)).status, 200);
    assert.equal((await wallet(player.cookie)).balance, 10_700);
    assert.equal((await post('/api/admin/deposit-requests/no-such-id/approve', {}, admin)).status, 404);

    const rows = (await request('/api/admin/deposit-requests', {}, admin)).body.requests.filter((r: Json) => r.playerId === player.id);
    assert.deepEqual(rows.map((r: Json) => [r.amount, r.status, r.reviewedBy]).sort(), [[300, 'rejected', 'admin'], [700, 'approved', 'admin']]);
    const logs = (await request('/api/admin/audit-logs', {}, admin)).body.logs.map((log: Json) => `${log.action}:${log.targetId}:${log.reason}`);
    assert.ok(logs.includes(`approve_deposit:${first.id}:核对无误`));
    assert.ok(logs.includes(`reject_deposit:${second.id}:金额不符`));
  });

  it('并发审核同一充值申请：10 个请求同时发出，只有 1 个成功，只加一次积分', async () => {
    const player = await newPlayer('review-race-dep');
    const { id } = (await post('/api/deposit-requests', { amount: 1_000 }, player.cookie)).body.request;
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => post(`/api/admin/deposit-requests/${id}/${i % 2 ? 'reject' : 'approve'}`, {}, admin)));
    assert.equal(results.filter((r) => r.status === 200).length, 1);
    assert.equal(results.filter((r) => r.status === 409).length, 9);
    const status = (await request('/api/admin/deposit-requests', {}, admin)).body.requests.find((r: Json) => r.id === id).status;
    assert.equal((await wallet(player.cookie)).balance, status === 'approved' ? 11_000 : 10_000);
    const ledger = (await request(`/api/admin/transactions?player=${player.id}&kind=deposit_approved`, {}, admin)).body.transactions;
    assert.equal(ledger.length, status === 'approved' ? 1 : 0);
  });

  it('提现审核：拒绝时退回冻结金额；并发通过同一提现只扣一次', async () => {
    const player = await newPlayer('review-withdraw');
    const rejected = (await post('/api/withdrawal-requests', { amount: 2_000 }, player.cookie)).body.request;
    assert.deepEqual([(await wallet(player.cookie)).balance, (await wallet(player.cookie)).frozen_balance], [8_000, 2_000]);
    assert.equal((await post(`/api/admin/withdrawal-requests/${rejected.id}/reject`, { note: '资料不全' }, admin)).status, 200);
    assert.deepEqual([(await wallet(player.cookie)).balance, (await wallet(player.cookie)).frozen_balance], [10_000, 0]);
    assert.equal((await post(`/api/admin/withdrawal-requests/${rejected.id}/approve`, {}, admin)).status, 409);

    const raced = (await post('/api/withdrawal-requests', { amount: 3_000 }, player.cookie)).body.request;
    const results = await Promise.all(Array.from({ length: 10 }, () => post(`/api/admin/withdrawal-requests/${raced.id}/approve`, {}, admin)));
    assert.equal(results.filter((r) => r.status === 200).length, 1);
    assert.deepEqual([(await wallet(player.cookie)).balance, (await wallet(player.cookie)).frozen_balance], [7_000, 0]);
    const kinds = (await request(`/api/admin/transactions?player=${player.id}`, {}, admin)).body.transactions.map((t: Json) => t.kind).sort();
    assert.deepEqual(kinds, ['registration_credit', 'withdrawal_approved', 'withdrawal_freeze', 'withdrawal_freeze', 'withdrawal_rejected']);
  });

  it('交易流水可按玩家、类型、日期筛选', async () => {
    const player = await newPlayer('review-filter');
    await post(`/api/admin/players/${player.id}/adjustment`, { amount: 50, reason: '筛选测试' }, admin);
    const byPlayer = (await request(`/api/admin/transactions?player=review-filter`, {}, admin)).body.transactions;
    assert.deepEqual(byPlayer.map((t: Json) => t.kind).sort(), ['manual_adjustment', 'registration_credit']);
    assert.ok(byPlayer.every((t: Json) => t.playerId === player.id && t.username === 'review-filter'));
    const byKind = (await request('/api/admin/transactions?kind=manual_adjustment', {}, admin)).body.transactions;
    assert.ok(byKind.length >= 1 && byKind.every((t: Json) => t.kind === 'manual_adjustment'));
    assert.ok((await request(`/api/admin/transactions?player=${player.id}&from=${today()}&to=${today()}`, {}, admin)).body.transactions.length === 2);
    assert.equal((await request(`/api/admin/transactions?player=${player.id}&to=2000-01-01`, {}, admin)).body.transactions.length, 0);
    assert.equal((await request(`/api/admin/transactions?player=${player.id}&from=2999-01-01`, {}, admin)).body.transactions.length, 0);
  });

  it('游戏记录：后台能看到所有玩家的局，点局号打开回放', async () => {
    const player = await newPlayer('review-rounds');
    const { gameUrl } = (await post('/games/wild-frontier/launch', {}, player.cookie)).body;
    const token = new URL(gameUrl).searchParams.get('token');
    const spin = await (await fetch(`${apiBase}/api/spin`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, bet: 80 }) })).json();
    assert.ok(spin.roundId);
    const rounds = (await request('/api/admin/rounds', {}, admin)).body.rounds;
    const mine = rounds.find((r: Json) => r.roundId === spin.roundId);
    assert.equal(mine.username, 'review-rounds');
    assert.equal(mine.bet, 80);
    const replay = await request(`/api/admin/rounds/${spin.roundId}/replay`, {}, admin);
    assert.equal(replay.status, 200);
    assert.ok(replay.body.text.includes('完全一致'));
    assert.equal((await request('/api/admin/rounds/no-such-round/replay', {}, admin)).status, 404);
  });

  it('对账页数字与资金流水一致；被改动的钱包标出差额', async () => {
    const report = (await request('/api/admin/reconciliation', {}, admin)).body.players;
    assert.ok(report.length >= 5);
    for (const row of report) {
      const entries = (await request(`/api/admin/transactions?player=${row.playerId}`, {}, admin)).body.transactions;
      assert.equal(row.ledgerBalance, entries.reduce((sum: number, t: Json) => sum + t.balanceDelta, 0), row.username);
      assert.equal(row.ledgerFrozen, entries.reduce((sum: number, t: Json) => sum + t.frozenDelta, 0), row.username);
      assert.equal(row.entries, entries.length);
      assert.equal(row.balance, row.ledgerBalance);
      assert.equal(row.ok, true, row.username);
    }

    const player = await newPlayer('review-broken');
    const db = new DatabaseSync(join(directory, 'platform.sqlite'));
    try {
      db.prepare('UPDATE wallets SET balance = balance + 123 WHERE player_id = ?').run(player.id);
      const broken = (await request('/api/admin/reconciliation', {}, admin)).body.players.find((r: Json) => r.playerId === player.id);
      assert.deepEqual([broken.ok, broken.balanceDiff, broken.balance, broken.ledgerBalance], [false, 123, 10_123, 10_000]);
    } finally {
      db.prepare('UPDATE wallets SET balance = balance - 123 WHERE player_id = ?').run(player.id);
      db.close();
    }
  });

  it('故障模拟：设置派彩连续失败、扣款超时、恢复，每次都写操作日志', async () => {
    assert.equal((await post('/api/admin/faults', { kind: 'nonsense' }, admin)).status, 400);
    assert.equal((await post('/api/admin/faults', { kind: 'win-down' }, admin)).body.kind, 'win-down');
    assert.deepEqual([(await request('/api/admin/faults', {}, admin)).body.kind, (await request('/api/admin/faults', {}, admin)).body.remaining], ['win-down', 4]);
    assert.equal((await post('/api/admin/faults', { kind: 'slow-bet' }, admin)).body.kind, 'slow-bet');
    assert.equal((await post('/api/admin/faults', { kind: 'none' }, admin)).body.kind, 'none');
    const faults = (await request('/api/admin/audit-logs', {}, admin)).body.logs.filter((log: Json) => log.action === 'set_fault').map((log: Json) => log.targetId);
    assert.deepEqual(faults.slice(0, 3), ['none', 'slow-bet', 'win-down']);
  });
});
