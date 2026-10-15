import test from 'node:test';
import assert from 'node:assert/strict';
import { createRunControl, interruption } from '../lib/run-control.mjs';
import { createTaskStore } from '../lib/task-store.mjs';
import { checkpointForResume } from '../lib/checkpoints.mjs';

const limits = { durationMs: 100000, modelCalls: 1, toolCalls: 1, knownTokens: 100, inputChars: 1000 };
test('预算约束模型、工具、总时长，取消保留明确原因', () => {
  for (const action of ['model', 'tool', 'time', 'cancel']) {
    let time = 0; const control = createRunControl({}, 1, { limits, now: () => time });
    if (action === 'model') { control.reserveModel('hi'); assert.throws(() => control.reserveModel('hi'), { code: 'BUDGET_EXHAUSTED' }); }
    if (action === 'tool') { control.beforeTool(); assert.throws(() => control.beforeTool(), { code: 'BUDGET_EXHAUSTED' }); }
    if (action === 'time') { time = 100001; assert.throws(() => control.check(), { code: 'BUDGET_EXHAUSTED' }); }
    if (action === 'cancel') { control.abort(interruption('CANCELLED', '用户停止')); assert.throws(() => control.check(), { code: 'CANCELLED' }); }
    control.finish('stopped', action);
  }
});
test('未知用量不当作零；超额已知用量阻止下一步', () => {
  const control = createRunControl({}, 1, { limits });
  control.recordMetric({ usage: null }); assert.equal(control.execution.used.unknownUsageCalls, 1);
  control.recordMetric({ usage: { input_tokens: 90, output_tokens: 20 } }); assert.equal(control.execution.used.knownTokens, 110);
  assert.throws(() => control.check(), { code: 'BUDGET_EXHAUSTED' }); control.finish('budget_exhausted', 'known_tokens');
});
test('模型输入预算包含Schema，并记录调用前拒绝的字符统计',()=>{
  const control=createRunControl({},1,{limits:{...limits,inputChars:40}});
  assert.throws(()=>control.reserveModel({instructions:'固定指令',input:'当前问题'},{type:'object',properties:{longField:{type:'string'}}}),{code:'BUDGET_EXHAUSTED'});
  assert.equal(control.execution.used.modelCalls,0);assert.equal(control.execution.lastInputBudget.includesSchema,true);assert(control.execution.lastInputBudget.chars>40);
  control.finish('budget_exhausted','input_chars');
});
test('保存失败明确可见且再次保存可以恢复，不产生重复业务操作', async () => {
  let fail = true; let saved;
  const store = createTaskStore('/unused', { write: async (_id, snapshot) => { if (fail) throw new Error('disk full'); saved = JSON.parse(snapshot); } });
  const task = { id: 'one', value: '用户原话' };
  await assert.rejects(store.save(task), { code: 'STORAGE_ERROR' }); assert.equal(task.storage.status, 'error');
  fail = false; await store.save(task); assert.equal(task.storage.status, 'saved'); assert.equal(saved.value, task.value);
});
test('重试只恢复同一次操作的检查点，同公司旧年份不能覆盖新请求', () => {
  const task = { checkpoint: { operationKey: '2024-op', scope: { thscode: '999999.SZ', year: 2024 } }, lastOperation: { operationKey: '2025-op' } };
  assert.equal(checkpointForResume(task, true), null);
  task.lastOperation.operationKey = '2024-op'; assert.equal(checkpointForResume(task, true).scope.year, 2024);
  assert.equal(checkpointForResume(task, false), null);
});
