import { spawn } from 'node:child_process';
import { mkdirSync, openSync, closeSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const port = Number(process.env.PORT || 8791);
const url = `http://127.0.0.1:${port}`;
async function healthy() {
  try {
    const response = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(800) });
    const data = await response.json();
    return response.ok && data.ok === true && !!data.model;
  } catch { return false; }
}
if (await healthy()) {
  console.log(`服务已在运行：${url}`);
} else {
  mkdirSync(new URL('../artifacts/', import.meta.url), { recursive: true });
  const logPath = fileURLToPath(new URL('../artifacts/local-server.log', import.meta.url));
  const output = openSync(logPath, 'a');
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: root,
    detached: true,
    stdio: ['ignore', output, output],
    env: { ...process.env, CODEX_MODEL: process.env.CODEX_MODEL || 'gpt-6-luna', HOST: '127.0.0.1', PORT: String(port) },
  });
  let startupError;
  child.on('error', error => { startupError = error; });
  child.unref();
  closeSync(output);
  for (let attempt = 0; attempt < 30; attempt++) {
    if (startupError) throw startupError;
    if (await healthy()) {
      writeFileSync(new URL('../artifacts/local-server.pid', import.meta.url), String(child.pid));
      console.log(`后台服务已启动：${url}\nPID：${child.pid}\n日志：${logPath}`);
      process.exit(0);
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  console.error(`启动未成功，请查看日志：${logPath}`);
  process.exitCode = 1;
}
