import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { spawn, type ChildProcess } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sign } from '../../server/http.mjs';

const port = 22000 + (process.pid % 1000);
const directory = mkdtempSync(join(tmpdir(), 'platform-auth-'));
const base = `http://127.0.0.1:${port}`;
let server: ChildProcess;

async function request(path: string, init: RequestInit = {}) {
  const response = await fetch(`${base}${path}`, { ...init, headers: { 'content-type': 'application/json', ...init.headers } });
  const setCookie = response.headers.get('set-cookie');
  return { status: response.status, body: await response.json(), setCookie, cookie: setCookie?.split(';')[0] };
}

before(async () => {
  server = spawn(process.execPath, ['platform-server.mjs'], { env: { ...process.env, OPERATOR_PORT: String(port), DATA_DIR: directory }, stdio: 'ignore' });
  for (let i = 0; i < 30; i += 1) { if ((await fetch(`${base}/health`).catch(() => null))?.ok) return; await new Promise((resolve) => setTimeout(resolve, 100)); }
  throw new Error('platform server did not start');
});
after(async () => { server.kill(); await new Promise((resolve) => server.once('exit', resolve)); rmSync(directory, { recursive: true, force: true }); });

describe('玩家认证接口', () => {
  it('拒绝重复用户名且数据库不保存明文密码', async () => {
    const first = await request('/auth/register', { method: 'POST', body: JSON.stringify({ username: 'alice', password: 'secure-pass-1' }) });
    assert.equal(first.status, 201);
    assert.equal((await request('/auth/register', { method: 'POST', body: JSON.stringify({ username: 'alice', password: 'secure-pass-2' }) })).status, 409);
    const dump = readFileSync(join(directory, 'platform.sqlite'));
    assert.equal(dump.includes(Buffer.from('secure-pass-1')), false);
  });

  it('拒绝错误密码并限制连续失败登录', async () => {
    for (let i = 0; i < 4; i += 1) assert.equal((await request('/auth/login', { method: 'POST', body: JSON.stringify({ username: 'alice', password: 'wrong-pass-1' }) })).status, 401);
    assert.equal((await request('/auth/login', { method: 'POST', body: JSON.stringify({ username: 'alice', password: 'wrong-pass-1' }) })).status, 429);
    assert.equal((await request('/auth/login', { method: 'POST', body: JSON.stringify({ username: 'alice', password: 'secure-pass-1' }) })).status, 429);
  });

  it('使用 httpOnly cookie 保持会话，并可退出', async () => {
    await request('/auth/register', { method: 'POST', body: JSON.stringify({ username: 'cookieuser', password: 'secure-pass-4' }) });
    const login = await request('/auth/login', { method: 'POST', body: JSON.stringify({ username: 'cookieuser', password: 'secure-pass-4' }) });
    assert.equal(login.status, 200);
    assert.match(login.setCookie ?? '', /HttpOnly/);
    assert.match(login.cookie ?? '', /^platform_session=/);
    assert.match(String(login.cookie), /platform_session=/);
    const me = await request('/auth/me', { headers: { cookie: login.cookie! } });
    assert.equal(me.status, 200);
    assert.equal(me.body.player.username, 'cookieuser');
    const balance = await request('/games/wild-frontier/balance', { headers: { cookie: login.cookie! } });
    assert.equal(balance.status, 200);
    assert.equal(balance.body.balance, 10_000);
    assert.equal((await request('/auth/logout', { method: 'POST', headers: { cookie: login.cookie! } })).status, 200);
    assert.equal((await request('/auth/me', { headers: { cookie: login.cookie! } })).status, 401);
  });

  it('拒绝超出可用余额的提现，并且冻结金额不能下注', async () => {
    await request('/auth/register', { method: 'POST', body: JSON.stringify({ username: 'walletuser', password: 'secure-pass-5' }) });
    const login = await request('/auth/login', { method: 'POST', body: JSON.stringify({ username: 'walletuser', password: 'secure-pass-5' }) });
    assert.equal(login.status, 200);
    assert.equal((await request('/api/withdrawal-requests', { method: 'POST', headers: { cookie: login.cookie! }, body: JSON.stringify({ amount: 10_001 }) })).status, 400);
    const freeze = await request('/api/withdrawal-requests', { method: 'POST', headers: { cookie: login.cookie! }, body: JSON.stringify({ amount: 9_980 }) });
    assert.equal(freeze.status, 201);
    const wallet = await request('/api/wallet', { headers: { cookie: login.cookie! } });
    assert.deepEqual({ balance: wallet.body.balance, frozen: wallet.body.frozen_balance }, { balance: 20, frozen: 9_980 });
    const payload = JSON.stringify({ playerId: wallet.body.playerId, transactionId: 'frozen-funds-bet', roundId: 'wallet-round', amount: 21 });
    const bet = await request('/wallet/bet', { method: 'POST', headers: { 'x-operator-id': 'demo-operator', 'x-signature': sign(payload, 'local-demo-secret') }, body: payload });
    assert.equal(bet.status, 402);
    assert.equal(bet.body.code, 'INSUFFICIENT_FUNDS');
  });

  it('未登录不能读取受保护接口，冻结账号不能登录或下注', async () => {
    assert.equal((await request('/auth/me')).status, 401);
    await request('/auth/register', { method: 'POST', body: JSON.stringify({ username: 'frozenuser', password: 'secure-pass-3' }) });
    const database = (await import('../../server/platform/db.mjs')).openPlatformDatabase(join(directory, 'platform.sqlite'));
    const player = database.prepare("SELECT id FROM players WHERE username = 'frozenuser'").get();
    database.prepare("UPDATE players SET status = 'frozen' WHERE id = ?").run(player.id); database.close();
    assert.equal((await request('/auth/login', { method: 'POST', body: JSON.stringify({ username: 'frozenuser', password: 'secure-pass-3' }) })).status, 403);
    const payload = JSON.stringify({ playerId: player.id, transactionId: 'frozen-bet', roundId: 'r', amount: 1 });
    const wallet = await request('/wallet/bet', { method: 'POST', headers: { 'x-operator-id': 'demo-operator', 'x-signature': sign(payload, 'local-demo-secret') }, body: payload });
    assert.equal(wallet.status, 403);
  });
});
