import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileTaskMemory, isMemoryDerivedRevisionInvalid } from '../lib/memory-policy.mjs';

const entry = (patch = {}) => ({ id: 'memory-a', version: 2, disabled: false, ...patch });
const task = (patch = {}) => ({ revision: 3, result: { revision: 2, summary: '旧答案仍可展示' }, messages: [{ from: 'user', kind: 'chat', revision: 1, text: '原始问题' }], memoryUsed: entry(), memoryPolicy: { enabled: true, selectedMemoryId: 'memory-a' }, focus: { source: 'ai', text: '旧记忆衍生关注' }, contextSummary: { old: true }, ...patch });

test('有效记忆不改任务；自己新捕获版本不误判为过期', () => {
  const a = task(); const before = structuredClone(a);
  assert.equal(reconcileTaskMemory(a, entry()).invalidated, false);
  assert.deepEqual(a, before);
  const b = task({ memorySaved: { id: 'memory-a', version: 3 } });
  assert.equal(reconcileTaskMemory(b, entry({ version: 3 })).invalidated, false);
  const c = task({ memoryUsed: entry({ version: 3 }), memorySaved: { id: 'memory-a', version: 2 } });
  assert.equal(reconcileTaskMemory(c, entry({ version: 3 })).invalidated, false);
});

test('删除后清活跃指针与衍生关注，但保留原聊天、证据和旧答案', () => {
  const a = task({ evidence: [{ id: 'proof' }], lastOperation: { kind: 'focus', message: '旧关注', focus: { source: 'user', text: '旧关注' } } });
  const original = structuredClone(a);
  assert.deepEqual(reconcileTaskMemory(a, null), { invalidated: true, reason: 'removed' });
  assert.equal(a.focus, null); assert.equal(a.lastOperation, null); assert.equal(a.contextSummary, null);
  assert.equal(a.memoryUsed, null); assert.equal(a.memoryPolicy.enabled, false); assert.equal(a.memoryPolicy.selectedMemoryId, null);
  assert.deepEqual(a.result, original.result); assert.deepEqual(a.messages, original.messages); assert.deepEqual(a.evidence, original.evidence);
  assert.equal(isMemoryDerivedRevisionInvalid(a, 2), true);
  assert.equal(isMemoryDerivedRevisionInvalid(a, 3), false);
  assert.equal(a.memoryPolicy.captureBlockedRevision, 3);
});

test('修改和停用均失效旧衍生上下文，编辑后允许下一轮召回新版本', () => {
  const a = task(); assert.equal(reconcileTaskMemory(a, entry({ version: 3 })).reason, 'changed');
  assert.equal(a.memoryPolicy.enabled, true); assert.equal(a.memoryPolicy.selectedMemoryId, 'memory-a');
  const b = task(); assert.equal(reconcileTaskMemory(b, entry({ disabled: true })).reason, 'disabled');
  assert.equal(b.memoryPolicy.enabled, false);
});

test('读取失败本轮排除衍生输入，不假装删除或停用数据库记录', () => {
  const a = task(); assert.equal(reconcileTaskMemory(a, null, { readFailed: true }).reason, 'unavailable');
  assert.equal(a.memoryPolicy.enabled, true); assert.equal(a.memoryPolicy.selectedMemoryId, 'memory-a');
  assert.equal(a.memoryUsed, null); assert.match(a.memoryWarning, /无法校验/);
  assert.equal(a.memoryInvalidation.id, 'memory-a');
});

test('当前真实用户新关注保留；旧用户关注和重试载荷被清除', () => {
  const fresh = { source: 'user', text: '本次只研究现金回收' };
  const a = task({ focus: fresh, lastOperation: { kind: 'focus', focus: fresh }, messages: [{ from: 'user', kind: 'focus', revision: 3, text: fresh.text }] });
  reconcileTaskMemory(a, null);
  assert.deepEqual(a.focus, fresh); assert.deepEqual(a.lastOperation.focus, fresh);
  const b = task({ focus: fresh, lastOperation: { kind: 'focus', focus: fresh }, messages: [{ from: 'user', kind: 'focus', revision: 2, text: fresh.text }] });
  reconcileTaskMemory(b, null); assert.equal(b.focus, null); assert.equal(b.lastOperation, null);
});

test('保存任务重载仅有memorySaved指针也会校验；无关联任务不受影响', () => {
  const a = task({ memoryUsed: null, memorySaved: { id: 'memory-a', version: 2 } });
  assert.equal(reconcileTaskMemory(a, null).invalidated, true);
  const b = task({ memoryUsed: null, memoryPolicy: { enabled: true } }); const before = structuredClone(b);
  assert.equal(reconcileTaskMemory(b, null).invalidated, false); assert.deepEqual(b, before);
});

test('失效屏障单调递增，显式覆盖能覆盖正在运行的旧轮次', () => {
  const a = task({ contextInvalidatedThroughRevision: 4 });
  reconcileTaskMemory(a, entry({ version: 3 }), { throughRevision: 3 });
  assert.equal(a.contextInvalidatedThroughRevision, 4);
  const b = task(); reconcileTaskMemory(b, null, { throughRevision: 3 });
  assert.equal(isMemoryDerivedRevisionInvalid(b, 3), true);
});
