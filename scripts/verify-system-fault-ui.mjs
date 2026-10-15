// Seeds genuine product states through HTTP with synthetic, intercepted upstreams.
// Leaves only the final isolated server running for browser screenshots.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { mkdir, open, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { setTimeout as wait } from 'node:timers/promises';

const root = fileURLToPath(new URL('../', import.meta.url));
const saveOnly = process.argv.includes('--save-only');
const profile = join(root, `artifacts/system-acceptance-2026-10-15/${saveOnly ? 'fault-ui-save-recheck' : 'fault-ui'}`);
try { await access(profile); throw new Error('Refusing to overwrite an existing fault-ui profile.'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
await mkdir(join(profile, 'artifacts'), { recursive: true });
const reports = [];
let displayedServer;
async function freePort() {
  const socket = createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening');
  const port = socket.address().port; await new Promise(resolve => socket.close(resolve)); return port;
}
async function start(label, settings = {}, persistent = false) {
  const port = persistent ? 8803 : await freePort();
  const logfile = join(profile, `${label}.log`), output = await open(logfile, 'a');
  const child = spawn(process.execPath, ['--import', new URL('../tests/fixtures/system-ui-stub.mjs', import.meta.url).href, 'server.mjs'], {
    cwd: root, detached: persistent,
    env: { ...process.env, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: String(port), PREVIEW_ACCESS_PASSWORD: '', APP_DATA_DIR: join(profile, 'artifacts'), RESEARCH_MEMORY_DIRECTORY: join(profile, 'memory'), MODEL_SETTINGS_FILE: join(profile, 'settings.json'), RESEARCH_OWNER_ID: 'system-ui-acceptance', RESEARCH_STORAGE_MODE: 'local', MODEL_PROVIDER: 'openai-compatible', MODEL_BASE_URL: 'https://runtime-model.invalid', MODEL_NAME: 'synthetic-ui-acceptance', MODEL_API_KEY: 'synthetic-only', FUYAO_API_KEY: 'synthetic-only', STUB_CASE: '', STUB_DELAY_MS: '5', ...settings },
    stdio: ['ignore', output.fd, output.fd],
  });
  await output.close();
  const base = `http://127.0.0.1:${port}`;
  const request = async (path, body) => {
    const response = await fetch(base + path, { ...(body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), signal: AbortSignal.timeout(10000) });
    const result = await response.json(); if (!response.ok) throw Object.assign(new Error(JSON.stringify(result)), { status: response.status }); return result;
  };
  const poll = async (id, predicate) => { for (let i = 0; i < 160; i++) { const task = await request(`/api/tasks/${id}`); if (predicate(task)) return task; await wait(30); } throw new Error(`State not reached for ${id}`); };
  try {
    for (let i = 0; i < 100; i++) { try { await request('/api/health'); break; } catch { if (child.exitCode !== null || i === 99) throw new Error(`Service ${label} did not start; see ${logfile}`); await wait(30); } }
  } catch (error) { if (child.exitCode === null) child.kill('SIGTERM'); throw error; }
  return { child, request, poll, base, async stop() { if (child.exitCode === null) { child.kill('SIGTERM'); await once(child, 'exit'); } } };
}
async function run(label, settings, check) { const service = await start(label, settings); try { await check(service); } finally { await service.stop(); } }
const create = (service, label) => service.request('/api/tasks', { input: `[合成界面验收]${label}；虚构公司（999999.SZ）2024年度，核对利润与现金流。`, isEvaluation: true, memoryEnabled: false, autoSupplement: false, operationId: randomUUID() });
async function record(name, task, assertions) {
  assert.equal(task.isEvaluation, true); assert.equal(task.ownerId, 'system-ui-acceptance');
  await writeFile(join(profile, `${name}.json`), JSON.stringify(task, null, 2));
  reports.push({ scenario: name, taskId: task.id, status: task.status, revision: task.revision, resultRevision: task.result?.revision ?? null, url: `http://127.0.0.1:8803/?task=${task.id}`, assertions });
}
if (!saveOnly) {
await run('model-rate-limit', { STUB_CASE: 'model_error' }, async s => {
  const created = await create(s, '模型429限流');
  const task = await s.poll(created.id, t => t.status === 'failed' && t.storage.status === 'saved');
  assert.equal(task.errorInfo.category, 'rate_limit'); assert.equal(task.result, null); assert.equal(task.metrics[0].status, 'failure');
  await record('model_429', task, ['rate_limit classification', 'no result published', 'failed call has metric']);
});
await run('tool-permission', { STUB_CASE: 'partial' }, async s => {
  const created = await create(s, '工具权限失败');
  const task = await s.poll(created.id, t => t.status === 'failed' && t.storage.status === 'saved');
  assert.equal(task.errorInfo.category, 'permission'); assert.equal(task.checkpoint.evidence.length, 1); assert.equal(task.result, null);
  await record('tool_permission_partial', task, ['permission classification', 'one evidence checkpoint retained', 'no unverified answer']);
});
await run('tool-permission-retry', { STUB_CASE: 'partial' }, async s => {
  const created = await create(s, '工具权限修复后重试');
  const failed = await s.poll(created.id, t => t.status === 'failed' && t.storage.status === 'saved');
  assert.equal(failed.checkpoint.evidence.length, 1);
  await s.request(`/api/tasks/${created.id}/retry`, { expectedRevision: failed.revision, operationId: randomUUID() });
  const task = await s.poll(created.id, t => t.status === 'complete' && t.storage.status === 'saved');
  assert.equal(task.evidence.length, 2);
  const tools = task.toolRuns.filter(t => t.revision === task.revision && t.status === 'complete');
  assert.equal(tools.filter(t => t.tool.includes('income_statements')).length, 0); assert.equal(tools.filter(t => t.tool.includes('cash_flow_statements')).length, 1);
  await record('tool_retry_recovered', task, ['complete after real retry endpoint', 'income evidence reused', 'only missing cash-flow tool retried']);
});
await run('prior-answer-preserved', {}, async s => {
  const created = await create(s, '有效结果后的补查失败');
  const first = await s.poll(created.id, t => t.status === 'complete' && t.storage.status === 'saved');
  await s.request(`/api/tasks/${first.id}/messages`, { message: '[合成界面验收]继续补查，主动注入故障。', kind: 'chat', bot: 'main', simulateFailure: true, operationId: randomUUID() });
  const task = await s.poll(first.id, t => t.status === 'partial' && t.storage.status === 'saved');
  assert.deepEqual(task.result, first.result); assert(task.revision > task.result.revision); assert.match(task.error, /演示故障/);
  await record('followup_failure_keeps_previous', task, ['actual simulateFailure path', 'previous valid result byte-equivalent', 'current and answer revisions differ visibly']);
});
await run('user-stop', { STUB_DELAY_MS: '2000' }, async s => {
  const created = await create(s, '主动停止'); await wait(50);
  await s.request(`/api/tasks/${created.id}/stop`, { expectedRevision: created.revision });
  const task = await s.poll(created.id, t => t.status === 'cancelled' && t.storage.status === 'saved' && t.metrics.length > 0);
  assert.equal(task.endReason, 'user_cancelled'); assert.equal(task.result, null); assert.equal(task.metrics[0].status, 'cancelled');
  await record('user_cancelled', task, ['stop endpoint aborts call', 'cancelled metric', 'no late answer']);
});
await run('budget-deadline', { STUB_DELAY_MS: '2000', RESEARCH_MAX_DURATION_MS: '100' }, async s => {
  const created = await create(s, '整轮预算到期');
  const task = await s.poll(created.id, t => t.status === 'budget_exhausted' && t.storage.status === 'saved');
  assert.equal(task.errorInfo.category, 'budget_exhausted'); assert.equal(task.result, null);
  await record('budget_exhausted', task, ['100ms test deadline enforced', 'no result published']);
});
}
try {
  displayedServer = await start('screenshot-service', { SYSTEM_UI_SAVE_FAILURE: 'true' }, true);
  for (const recover of [false, true]) {
    const created = await create(displayedServer, `[保存失败]${recover ? '保存重试恢复' : '保存失败仍可见'}`);
    let task = await displayedServer.poll(created.id, t => t.status === 'complete' && t.storage.status === 'error' && t.memoryStatus === 'failed');
    assert(task.result); const metricCount = task.metrics.length;
    if (recover) {
      task = await displayedServer.request(`/api/tasks/${created.id}/persist`, {});
      assert.equal(task.storage.status, 'saved'); assert.equal(task.metrics.length, metricCount);
      assert.equal(task.memoryWarning, null); assert.equal(task.memoryStatus, 'skipped');
    }
    await record(recover ? 'storage_retry_recovered' : 'storage_error_visible', task, recover ? ['persist endpoint succeeds', 'model calls unchanged', 'memoryWarning is null', 'evaluation memoryStatus is skipped'] : ['genuine ENOSPC save rejection', 'valid answer remains in live memory', 'storage status error']);
  }
  for (const report of reports) {
    const visible = await displayedServer.request(`/api/tasks/${report.taskId}`);
    assert.equal(visible.status, report.status);
  }
  const result = { createdAt: new Date().toISOString(), synthetic: true, externalFetch: 'blocked by imported runtime fixture', ownerId: 'system-ui-acceptance', profile, serverPid: displayedServer.child.pid, serverPort: 8803, reports };
  await writeFile(join(profile, 'manifest.json'), JSON.stringify(result, null, 2));
  await writeFile(join(profile, 'server.pid'), String(displayedServer.child.pid));
  displayedServer.child.unref();
  console.log(JSON.stringify(result, null, 2));
} catch (error) { await displayedServer?.stop(); throw error; }
