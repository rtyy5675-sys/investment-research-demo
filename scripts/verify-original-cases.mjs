// Original user-only ZIP cases. Evaluator rubric never enters requests.
import { readFile, writeFile, mkdir, appendFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { setTimeout as wait } from 'node:timers/promises';
const base = process.env.ORIGINAL_CASES_URL || 'http://127.0.0.1:8801';
const directory = new URL('../docs/evidence/system-acceptance-2026-10-15/', import.meta.url);
const inputs = new URL('../artifacts/system-acceptance-2026-10-15/original-inputs/', import.meta.url);
await mkdir(directory, { recursive: true });
const logFile = new URL('original-cases.log', directory);
const reportFile = new URL('original-cases.json', directory);
const report = { startedAt: new Date().toISOString(), base, scope: 'Original ZIP inputs verbatim; real current model/tools, isolated service/profile; no gold or rubric sent to model; no screenshots in this runner.', cases: [] };
const log = async value => { const line = JSON.stringify({ at: new Date().toISOString(), ...value }); console.log(line); await appendFile(logFile, line + '\n'); };
async function req(path, body) {
  const response = await fetch(base + path, { ...(body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000) });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error || data.message || `HTTP ${response.status}`), { status: response.status });
  return data;
}
async function terminal(id) {
  for (let i = 0; i < 620; i++) {
    const task = await req(`/api/tasks/${id}`);
    if (task.status !== 'running' && task.memoryStatus !== 'saving') return task;
    await wait(500);
  }
  throw new Error('Original case polling deadline exceeded');
}
let continuationTaskId;
for (const id of ['T01', 'T03', 'T06', 'T08A-0', 'T08A-1']) {
  const input = await readFile(new URL(`${id}.txt`, inputs), 'utf8');
  const row = { id, input, startedAt: new Date().toISOString(), taskId: null, executionStatus: 'running', assessmentStatus: 'pending', manualReview: null };
  report.cases.push(row);
  await writeFile(reportFile, JSON.stringify(report, null, 2));
  try {
    if (id === 'T08A-1') {
      if (!continuationTaskId) throw new Error('T08A-0 task was not created');
      const created = await req(`/api/tasks/${continuationTaskId}/messages`, { message: input, kind: 'chat', bot: 'main', operationId: randomUUID() });
      row.taskId = created.id;
    } else {
      const created = await req('/api/tasks', { input, isEvaluation: true, memoryEnabled: false, autoSupplement: false, operationId: randomUUID() });
      row.taskId = created.id;
      if (id === 'T08A-0') continuationTaskId = created.id;
    }
    await log({ caseId: id, stage: 'started', taskId: row.taskId });
    const task = await terminal(row.taskId);
    const trace = await req(`/api/tasks/${row.taskId}/trace`);
    row.finishedAt = new Date().toISOString();
    row.durationMs = Date.parse(row.finishedAt) - Date.parse(row.startedAt);
    row.executionStatus = task.status;
    row.task = task;
    row.trace = trace;
    row.url = `${base}/?task=${row.taskId}`;
    row.assessmentStatus = !task.result ? 'blocked' : 'pending';
    row.manualReview = !task.result ? { outcome: 'scenario_not_completed', reason: task.clarification || task.error || `No published result; state=${task.status}`, financialReasoningScore: null, note: 'Capability refusal is not scored as model financial incompetence; original task remains uncompleted.' } : null;
    await writeFile(new URL(`${id}-original-task.json`, directory), JSON.stringify(task, null, 2));
    await writeFile(new URL(`${id}-original-trace.json`, directory), JSON.stringify(trace, null, 2));
    await log({ caseId: id, stage: 'finished', taskId: row.taskId, state: task.status, result: !!task.result, reason: task.clarification || task.error || null });
  } catch (error) {
    row.executionStatus = 'runner_error'; row.assessmentStatus = 'blocked'; row.error = error.message;
    await log({ caseId: id, stage: 'error', taskId: row.taskId, error: error.message });
  }
  await writeFile(reportFile, JSON.stringify(report, null, 2));
}
report.finishedAt = new Date().toISOString();
await writeFile(reportFile, JSON.stringify(report, null, 2));
await log({ stage: 'all_finished', states: report.cases.map(row => ({ id: row.id, taskId: row.taskId, executionStatus: row.executionStatus, assessmentStatus: row.assessmentStatus })) });
