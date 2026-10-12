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
  assert.deepEqual(session.allowedBets, [100, 200, 500, 1_000, 2_000]);
  const spin = await (await fetch(`${apiBase}/api/spin`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, bet: session.allowedBets[0] }) })).json();
  assert.ok(spin.roundId, JSON.stringify(spin));
  assert.equal(spin.gameId, 'mahjong-cascade');
  assert.equal(spin.mathConfigVersion, 'mahjong-math-2.0.0');
  return spin as Json;
}
async function playRabbit(cookie: string) {
  const launch = await post('/games/jade-rabbit/launch', {}, cookie);
  assert.equal(launch.status, 200, JSON.stringify(launch.body));
  assert.equal(launch.body.gameId, 'jade-rabbit');
  const gameUrl = new URL(launch.body.gameUrl);
  assert.equal(gameUrl.pathname, '/jade-rabbit');
  const token = gameUrl.searchParams.get('token');
  const session = await (await fetch(`${apiBase}/api/session?token=${token}`)).json();
  assert.equal(session.gameId, 'jade-rabbit');
  assert.deepEqual(session.allowedBets, [100, 200, 500, 1_000, 2_000]);
  const spin = await (await fetch(`${apiBase}/api/spin`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, bet: session.allowedBets[0] }) })).json();
  assert.ok(spin.roundId, JSON.stringify(spin));
  assert.equal(spin.gameId, 'jade-rabbit');
  return spin as Json;
}

let admin = '';
before(async () => {
  // RABBIT_TRIGGER_ROLL=0：玉兔送财每个付费局都触发玉兔模式，便于测试模式状态校验。
  const env = { ...process.env, API_PORT: String(apiPort), OPERATOR_PORT: String(port), PROVIDER_URL: apiBase, DATA_DIR: directory, ADMIN_PASSWORD, RABBIT_TRIGGER_ROLL: '0' };
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
    assert.deepEqual(titles, ['Wild Frontier', '麻将连连胡', '玉兔送财']);
    const mj = (overview.games as Json[]).find((g) => g.title === '麻将连连胡')!;
    assert.ok(mj.rounds >= 2, `mahjong rounds today ${mj.rounds}`);
    assert.equal(overview.gamesAvailable, true);
  });
});

describe('平台接入玉兔送财', () => {
  it('玩家只能看到自己的玉兔送财记录，别人的局号查不到也打不开回放', async () => {
    const alice = await newPlayer('rabbit-alice');
    const bob = await newPlayer('rabbit-bob');
    const spin = await playRabbit(alice);
    const aliceRecords = (await request('/api/game-records', {}, alice)).body.records as Json[];
    const mine = aliceRecords.find((r) => r.roundId === spin.roundId);
    assert.ok(mine, 'alice sees her rabbit round');
    assert.equal(mine!.gameId, 'jade-rabbit');
    const bobRecords = (await request('/api/game-records', {}, bob)).body.records as Json[];
    assert.equal(bobRecords.some((r) => r.roundId === spin.roundId), false, 'bob does not see alice\'s rabbit round');
    assert.equal((await request(`/api/game-records/${spin.roundId}/replay`, {}, bob)).status, 404);
    const replay = await request(`/api/game-records/${spin.roundId}/replay`, {}, alice);
    assert.equal(replay.status, 200);
    assert.match(replay.body.text, /玉兔送财/);
  });

  it('STEP-48：财富旋转请求和服务器状态对不上时返回 409、不扣款；不提前下发模式停点；玩家记录区分免费局', async () => {
    const dave = await newPlayer('rabbit-dave');
    const launch = await post('/games/jade-rabbit/launch', {}, dave);
    const token = new URL(launch.body.gameUrl).searchParams.get('token');
    const spinApi = async (body: Json) => {
      const response = await fetch(`${apiBase}/api/spin`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, bet: 100, ...body }) });
      return { status: response.status, body: await response.json() as Json };
    };
    const balance = async () => (await request('/api/wallet', {}, dave)).body.balance as number;

    const paid = await spinApi({ mode: 'paid' });
    assert.equal(paid.status, 200);
    assert.equal(paid.body.triggered, true);
    assert.equal(paid.body.roundTotalWin, paid.body.payout, '付费局回包只给本局赢分，不提前给整轮总赢分');
    assert.equal(JSON.stringify(paid.body.freeSpins).includes('modeStops'), false);
    const session = await (await fetch(`${apiBase}/api/session?token=${token}`)).json();
    assert.equal(JSON.stringify(session.freeSpins).includes('modeStops'), false, 'session 不带 8 组模式停点');
    assert.equal(session.freeSpins.parentRoundId, paid.body.roundId);

    const before = await balance();
    assert.equal((await spinApi({ mode: 'paid' })).body.code, 'MODE_STATE_CHANGED', '模式没打完时付费请求被拒绝');
    assert.equal((await spinApi({ mode: 'free', parentRoundId: 'someone-else' })).body.code, 'MODE_STATE_CHANGED');
    assert.equal(await balance(), before, '被拒绝的请求不扣款');

    for (let index = 0; index < 8; index += 1) {
      const free = await spinApi({ mode: 'free', parentRoundId: paid.body.roundId });
      assert.equal(free.status, 200);
      assert.equal(free.body.mode, 'free');
      assert.equal(free.body.modeIndex, index);
    }
    const afterMode = await balance();
    const late = await spinApi({ mode: 'free', parentRoundId: paid.body.roundId });
    assert.equal(late.status, 409, '最后一次财富旋转的回包丢失后重试，不会变成付费局');
    assert.equal(late.body.code, 'MODE_STATE_CHANGED');
    assert.equal(await balance(), afterMode, '重试不扣款');

    const records = (await request('/api/game-records', {}, dave)).body.records as Json[];
    const mine = records.filter((r) => r.roundId === paid.body.roundId || r.parentRoundId === paid.body.roundId);
    assert.equal(mine.length, 9);
    assert.equal(mine.filter((r) => r.mode === 'free').length, 8);
    assert.deepEqual(mine.filter((r) => r.mode === 'free').map((r) => r.modeIndex).sort(), [0, 1, 2, 3, 4, 5, 6, 7]);
    const replay = await request(`/api/game-records/${paid.body.roundId}/replay`, {}, dave);
    assert.match(replay.body.text, /已触发并转完 8 次财富旋转/);
  });

  it('后台的游戏记录和概览区分三款游戏，点局号能回放玉兔送财', async () => {
    const carol = await newPlayer('rabbit-carol');
    const spin = await playRabbit(carol);
    const rounds = (await request('/api/admin/rounds', {}, admin)).body.rounds as Json[];
    const row = rounds.find((r) => r.roundId === spin.roundId);
    assert.equal(row?.gameId, 'jade-rabbit');
    assert.equal(row?.username, 'rabbit-carol');
    const replay = await request(`/api/admin/rounds/${spin.roundId}/replay`, {}, admin);
    assert.equal(replay.status, 200);
    assert.match(replay.body.text, /玉兔送财/);
    const overview = (await request('/api/admin/overview', {}, admin)).body;
    const titles = (overview.games as Json[]).map((g) => g.title);
    assert.deepEqual(titles, ['Wild Frontier', '麻将连连胡', '玉兔送财']);
    const rabbit = (overview.games as Json[]).find((g) => g.title === '玉兔送财')!;
    assert.ok(rabbit.rounds >= 2, `rabbit rounds today ${rabbit.rounds}`);
    assert.equal(overview.gamesAvailable, true);
  });
});
