import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { spawn, type ChildProcess } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const port = 28000 + (process.pid % 1000);
const apiPort = port + 1000;
const directory = mkdtempSync(join(tmpdir(), 'platform-mahjong-'));
const base = `http://127.0.0.1:${port}`;
const apiBase = `http://127.0.0.1:${apiPort}`;
const ADMIN_PASSWORD = 'admin-mahjong-pass-1';
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
async function newPlayer(username: string) {
  await post('/auth/register', { username, password: 'player-pass-1' });
  return (await post('/auth/login', { username, password: 'player-pass-1' })).cookie;
}
async function playMahjong(cookie: string) {
  const launch = await post('/games/mahjong-cascade/launch', {}, cookie);
  assert.equal(launch.status, 200, JSON.stringify(launch.body));
  assert.equal(launch.body.gameId, 'mahjong-cascade');
  const gameUrl = new URL(launch.body.gameUrl);
  assert.equal(gameUrl.pathname, '/mahjong');
  const token = gameUrl.searchParams.get('token');
  const session = await (await fetch(`${apiBase}/api/session?token=${token}`)).json();
  assert.equal(session.gameId, 'mahjong-cascade');
  const spin = await (await fetch(`${apiBase}/api/spin`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, bet: session.allowedBets[0] }) })).json();
  assert.ok(spin.roundId, JSON.stringify(spin));
  assert.equal(spin.gameId, 'mahjong-cascade');
  return spin as Json;
}

let admin = '';
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
});
after(async () => { server.kill(); apiServer.kill(); await Promise.all([new Promise((resolve) => server.once('exit', resolve)), new Promise((resolve) => apiServer.once('exit', resolve))]); rmSync(directory, { recursive: true, force: true }); });

describe('平台接入麻将连连胡', () => {
  it('大厅可以启动两款游戏，未知游戏 404，未登录 401', async () => {
    const cookie = await newPlayer('mj-launch');
    assert.equal((await post('/games/mahjong-cascade/launch', {})).status, 401);
    assert.equal((await post('/games/no-such-game/launch', {}, cookie)).status, 404);
    const wf = await post('/games/wild-frontier/launch', {}, cookie);
    assert.equal(wf.status, 200);
    assert.equal(new URL(wf.body.gameUrl).pathname, '/', 'Wild Frontier entry unchanged');
    assert.equal((await post('/games/mahjong-cascade/launch', {}, cookie)).status, 200);
  });

  it('玩家只能看到自己的麻将连连胡记录，别人的局号查不到也打不开回放', async () => {
    const alice = await newPlayer('mj-alice');
    const bob = await newPlayer('mj-bob');
    const spin = await playMahjong(alice);
    const aliceRecords = (await request('/api/game-records', {}, alice)).body.records as Json[];
    const mine = aliceRecords.find((r) => r.roundId === spin.roundId);
    assert.ok(mine, 'alice sees her round');
    assert.equal(mine!.gameId, 'mahjong-cascade');
    const bobRecords = (await request('/api/game-records', {}, bob)).body.records as Json[];
    assert.equal(bobRecords.some((r) => r.roundId === spin.roundId), false, 'bob does not see alice\'s round');
    assert.equal((await request(`/api/game-records/${spin.roundId}/replay`, {}, bob)).status, 404);
    const replay = await request(`/api/game-records/${spin.roundId}/replay`, {}, alice);
    assert.equal(replay.status, 200);
    assert.match(replay.body.text, /麻将|Mahjong/);
  });

  it('后台的游戏记录和概览区分两款游戏，点局号能回放麻将连连胡', async () => {
    const carol = await newPlayer('mj-carol');
    const spin = await playMahjong(carol);
    const rounds = (await request('/api/admin/rounds', {}, admin)).body.rounds as Json[];
    const row = rounds.find((r) => r.roundId === spin.roundId);
    assert.equal(row?.gameId, 'mahjong-cascade');
    assert.equal(row?.username, 'mj-carol');
    const replay = await request(`/api/admin/rounds/${spin.roundId}/replay`, {}, admin);
    assert.equal(replay.status, 200);
    const overview = (await request('/api/admin/overview', {}, admin)).body;
    const titles = (overview.games as Json[]).map((g) => g.title);
    assert.deepEqual(titles, ['Wild Frontier', '麻将连连胡']);
    const mj = (overview.games as Json[]).find((g) => g.title === '麻将连连胡')!;
    assert.ok(mj.rounds >= 2, `mahjong rounds today ${mj.rounds}`);
    assert.equal(overview.gamesAvailable, true);
  });
});
