// npm start: run the local API and the web dev server together in one terminal.
// Anything already running on their ports is reused when it is up to date,
// so starting twice is harmless. Ctrl+C stops what this script started.

import { spawn } from 'node:child_process';
import { ENGINE_VERSION } from '../src/engine/index.ts';

const API_PORT = Number(process.env.API_PORT ?? 8787);
const WEB_PORT = Number(process.env.WEB_PORT ?? 4173);
const WEB_URL = `http://127.0.0.1:${WEB_PORT}`;

const get = (url) => fetch(url, { signal: AbortSignal.timeout(1500) }).then((r) => r).catch(() => null);

const children = [];

function run(name, args) {
  const child = spawn(process.execPath, args, { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  const prefix = (stream, out) => {
    let rest = '';
    stream.on('data', (chunk) => {
      const lines = (rest + chunk).split(/\r?\n/);
      rest = lines.pop();
      for (const line of lines) out.write(`[${name}] ${line}\n`);
    });
  };
  prefix(child.stdout, process.stdout);
  prefix(child.stderr, process.stderr);
  child.on('exit', (code) => {
    if (stopping) return;
    console.log(`[${name}] 已退出（代码 ${code}）。按 Ctrl+C 结束。`);
  });
  children.push(child);
}

let stopping = false;
function stopAll() {
  stopping = true;
  for (const child of children) child.kill();
  process.exit(0);
}
process.on('SIGINT', stopAll);
process.on('SIGTERM', stopAll);

// API
const api = await get(`http://127.0.0.1:${API_PORT}/api/config`);
if (!api) {
  run('api', ['server.mjs']);
} else {
  const { engineVersion } = await api.json().catch(() => ({}));
  if (engineVersion === ENGINE_VERSION) {
    console.log(`[api] 端口 ${API_PORT} 上已有最新版本在运行，直接使用。`);
  } else {
    console.log(`[api] 端口 ${API_PORT} 被旧版本占用。在 PowerShell 运行下面这行关掉它，再重新 npm start：`);
    console.log(`      Stop-Process -Id (Get-NetTCPConnection -LocalPort ${API_PORT} -State Listen).OwningProcess`);
    process.exit(1);
  }
}

// Web
if (await get(WEB_URL)) {
  console.log(`[web] 端口 ${WEB_PORT} 上的网页服务已在运行，直接使用。`);
} else {
  run('web', ['node_modules/vite/bin/vite.js']);
}

console.log(`\n游戏地址：${WEB_URL}    （按 Ctrl+C 停止）\n`);
if (children.length === 0) process.exit(0);
