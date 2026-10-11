import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { spawn, type ChildProcess } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const port = 24000 + (process.pid % 1000);
const directory = mkdtempSync(join(tmpdir(), 'platform-admin-'));
const base = `http://127.0.0.1:${port}`;
const ADMIN_PASSWORD = 'admin-test-pass-1';
let server: ChildProcess;

async function request(path: string, init: RequestInit = {}, cookie = '') {
  const response = await fetch(`${base}${path}`, { ...init, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...init.headers } });
  const setCookie = response.headers.get('set-cookie');
  return { status: response.status, body: await response.json().catch(() => ({})), setCookie, cookie: setCookie?.split(';')[0] ?? '' };
}
const post = (path: string, body: unknown, cookie = '') => request(path, { method: 'POST', body: JSON.stringify(body) }, cookie);

async function waitForServer(url: string) {
  for (let i = 0; i < 50; i += 1) {
    if ((await fetch(url).catch(() => null))?.ok) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`${url} did not start`);
}

let adminCookie = '';
let playerCookie = '';
let playerId = '';

before(async () => {
  server = spawn(process.execPath, ['platform-server.mjs'], { env: { ...process.env, OPERATOR_PORT: String(port), DATA_DIR: directory, ADMIN_PASSWORD }, stdio: 'ignore' });
  await waitForServer(`${base}/health`);
  const registered = await post('/auth/register', { username: 'bob-player', password: 'player-pass-1' });
  playerId = registered.body.player.id;
  playerCookie = (await post('/auth/login', { username: 'bob-player', password: 'player-pass-1' })).cookie;
  adminCookie = (await post('/api/admin/auth/login', { username: 'admin', password: ADMIN_PASSWORD })).cookie;
});
after(async () => { server.kill(); await new Promise((resolve) => server.once('exit', resolve)); rmSync(directory, { recursive: true, force: true }); });

describe('后台管理员', () => {
  it('首次启动没有管理员时生成随机密码并打印在终端，用它可以登录', async () => {
    const fresh = mkdtempSync(join(tmpdir(), 'platform-admin-fresh-'));
    const freshPort = port + 500;
    const env = { ...process.env, OPERATOR_PORT: String(freshPort), DATA_DIR: fresh };
    delete env.ADMIN_PASSWORD;
    const child = spawn(process.execPath, ['platform-server.mjs'], { env, stdio: ['ignore', 'pipe', 'ignore'] });
    let output = '';
    child.stdout!.on('data', (chunk) => { output += chunk; });
    try {
      await waitForServer(`http://127.0.0.1:${freshPort}/health`);
      const password = output.match(/初始密码 (\S+)（/)?.[1];
      assert.ok(password && password.length >= 12, output);
      const login = await fetch(`http://127.0.0.1:${freshPort}/api/admin/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin', password }) });
      assert.equal(login.status, 200);
    } finally {
      child.kill();
      await new Promise((resolve) => child.once('exit', resolve));
      rmSync(fresh, { recursive: true, force: true });
    }
  });

  it('管理员账号与玩家分开：玩家密码不能登录后台，管理员会话用 httpOnly cookie', async () => {
    assert.equal((await post('/api/admin/auth/login', { username: 'bob-player', password: 'player-pass-1' })).status, 401);
    assert.equal((await post('/api/admin/auth/login', { username: 'admin', password: 'wrong-pass-1' })).status, 401);
    const login = await post('/api/admin/auth/login', { username: 'admin', password: ADMIN_PASSWORD });
    assert.match(login.setCookie ?? '', /^admin_session=.*HttpOnly/);
    assert.equal((await request('/api/admin/auth/me', {}, login.cookie)).body.admin.username, 'admin');
  });

  it('所有后台接口都检查管理员身份：没有登录或用玩家 cookie 都返回 401', async () => {
    const routes: [string, string][] = [
      ['GET', '/api/admin/auth/me'], ['POST', '/api/admin/auth/logout'], ['GET', '/api/admin/overview'],
      ['GET', '/api/admin/players'], ['GET', `/api/admin/players/${playerId}`], ['POST', `/api/admin/players/${playerId}/freeze`],
      ['POST', `/api/admin/players/${playerId}/unfreeze`], ['POST', `/api/admin/players/${playerId}/adjustment`],
      ['GET', '/api/admin/audit-logs'], ['GET', '/admin/state'], ['POST', '/admin/fault'],
    ];
    for (const [method, path] of routes) {
      for (const cookie of ['', playerCookie]) {
        const init = method === 'POST' ? { method, body: JSON.stringify({ amount: 1_000_000, reason: '越权测试' }) } : { method };
        assert.equal((await request(path, init, cookie)).status, 401, `${method} ${path} ${cookie ? '玩家 cookie' : '未登录'}`);
      }
    }
    assert.equal((await request('/api/wallet', {}, playerCookie)).body.balance, 10_000);
  });

  it('玩家列表、搜索与详情', async () => {
    const all = await request('/api/admin/players', {}, adminCookie);
    assert.ok(all.body.players.some((p: { id: string }) => p.id === playerId));
    const found = await request('/api/admin/players?q=bob', {}, adminCookie);
    assert.deepEqual(found.body.players.map((p: { username: string }) => p.username), ['bob-player']);
    assert.equal((await request('/api/admin/players?q=nobody-here', {}, adminCookie)).body.players.length, 0);
    const detail = await request(`/api/admin/players/${playerId}`, {}, adminCookie);
    assert.equal(detail.body.player.username, 'bob-player');
    assert.equal(detail.body.wallet.balance, 10_000);
    assert.equal(detail.body.reconciled, true);
    assert.equal((await request('/api/admin/players/no-such-player', {}, adminCookie)).status, 404);
  });

  it('手动调整余额必须填原因，并出现在资金流水和操作日志里', async () => {
    assert.equal((await post(`/api/admin/players/${playerId}/adjustment`, { amount: 500 }, adminCookie)).status, 400);
    assert.equal((await post(`/api/admin/players/${playerId}/adjustment`, { amount: 500, reason: '   ' }, adminCookie)).status, 400);
    assert.equal((await post(`/api/admin/players/${playerId}/adjustment`, { amount: 0, reason: '无效' }, adminCookie)).status, 400);
    assert.equal((await post(`/api/admin/players/${playerId}/adjustment`, { amount: -20_000, reason: '扣成负数' }, adminCookie)).status, 400);

    const added = await post(`/api/admin/players/${playerId}/adjustment`, { amount: 500, reason: '活动补偿' }, adminCookie);
    assert.equal(added.status, 200);
    assert.equal(added.body.balance, 10_500);
    const removed = await post(`/api/admin/players/${playerId}/adjustment`, { amount: -200, reason: '误发收回' }, adminCookie);
    assert.equal(removed.body.balance, 10_300);

    const detail = await request(`/api/admin/players/${playerId}`, {}, adminCookie);
    const adjustments = detail.body.ledger.filter((entry: { kind: string }) => entry.kind === 'manual_adjustment');
    assert.deepEqual(adjustments.map((entry: { balanceDelta: number; reason: string }) => [entry.balanceDelta, entry.reason]), [[-200, '误发收回'], [500, '活动补偿']]);
    assert.equal(detail.body.reconciled, true);

    const playerRecords = await request('/api/wallet/records', {}, playerCookie);
    assert.deepEqual(playerRecords.body.records.filter((r: { kind: string }) => r.kind === 'manual_adjustment').map((r: { amount: number }) => r.amount).sort((a: number, b: number) => a - b), [-200, 500]);

    const logs = (await request('/api/admin/audit-logs', {}, adminCookie)).body.logs.filter((log: { action: string }) => log.action === 'adjust_balance');
    assert.deepEqual(logs.map((log: { admin: string; targetId: string; reason: string; details: { amount: number } }) => [log.admin, log.targetId, log.reason, log.details.amount]),
      [['admin', playerId, '误发收回', -200], ['admin', playerId, '活动补偿', 500]]);
  });

  it('冻结后玩家立即无法使用、不能登录；解冻后恢复；两次操作都写入操作日志', async () => {
    assert.equal((await post(`/api/admin/players/${playerId}/freeze`, { reason: '风控检查' }, adminCookie)).status, 200);
    assert.equal((await request('/api/wallet', {}, playerCookie)).status, 401);
    assert.equal((await post('/auth/login', { username: 'bob-player', password: 'player-pass-1' })).status, 403);
    assert.equal((await post(`/api/admin/players/${playerId}/unfreeze`, { reason: '检查完毕' }, adminCookie)).status, 200);
    playerCookie = (await post('/auth/login', { username: 'bob-player', password: 'player-pass-1' })).cookie;
    assert.equal((await request('/api/wallet', {}, playerCookie)).status, 200);
    const actions = (await request('/api/admin/audit-logs', {}, adminCookie)).body.logs.map((log: { action: string; reason: string }) => `${log.action}:${log.reason}`);
    assert.ok(actions.includes('freeze_player:风控检查'));
    assert.ok(actions.includes('unfreeze_player:检查完毕'));
    assert.ok(actions.includes('login:null'));
  });

  it('概览：玩家数、今日充值/提现、今日下注、今日派彩、平台盈亏', async () => {
    const { body } = await request('/api/admin/overview', {}, adminCookie);
    for (const key of ['players', 'depositsApproved', 'withdrawalsApproved', 'bets', 'wins', 'platformProfit']) assert.equal(typeof body[key], 'number', key);
    assert.ok(body.players >= 3);
    assert.equal(body.platformProfit, body.bets - body.wins);
  });

  it('退出后管理员 cookie 失效', async () => {
    const login = await post('/api/admin/auth/login', { username: 'admin', password: ADMIN_PASSWORD });
    assert.equal((await post('/api/admin/auth/logout', {}, login.cookie)).status, 200);
    assert.equal((await request('/api/admin/overview', {}, login.cookie)).status, 401);
  });
});
