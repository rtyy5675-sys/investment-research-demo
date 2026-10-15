import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { setTimeout as wait } from 'node:timers/promises';
import { mkdir, writeFile, readFile, mkdtemp, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

const reports = [];
async function freePort() { const socket = createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening'); const port = socket.address().port; await new Promise(resolve => socket.close(resolve)); return port; }
async function withServer(settings, check) {
  const port = await freePort();
  const child = spawn(process.execPath, ['--import', new URL('../tests/fixtures/runtime-fetch-stub.mjs', import.meta.url).href, 'server.mjs'], { cwd: new URL('../', import.meta.url), env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), MODEL_SETTINGS_FILE: `/tmp/jianwei-model-settings-fixture-${process.pid}-${port}.json`, MODEL_PROVIDER: 'openai-compatible', MODEL_API_KEY: 'synthetic-test-only', MODEL_NAME: 'synthetic-runtime-test', MODEL_BASE_URL: 'https://runtime-model.invalid', FUYAO_API_KEY: 'synthetic-test-only', ...settings }, stdio: ['ignore','pipe','pipe'] });
  let logs = ''; child.stdout.on('data', data => { logs += data; }); child.stderr.on('data', data => { logs += data; });
  const request = async (path, body) => { const response = await fetch(`http://127.0.0.1:${port}${path}`, { ...(body !== undefined ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(10000) }); const result = await response.json(); if (!response.ok) throw Object.assign(new Error(JSON.stringify(result)), { status: response.status }); return result; };
  const poll = async (id, predicate) => { for (let attempt = 0; attempt < 100; attempt++) { const task = await request(`/api/tasks/${id}`); if (predicate(task)) return task; await wait(30); } throw new Error('Verification did not reach expected state'); };
  try {
    for (let i = 0; i < 100; i++) { try { await request('/api/health'); break; } catch { if (child.exitCode !== null) throw new Error(logs); if (i === 99) throw new Error(logs || 'server did not start'); await wait(30); } }
    await check(request, poll);
  } catch(error) { throw new Error(`${error.message}\n${logs}`, { cause: error }); }
  finally { child.kill('SIGTERM'); if (child.exitCode === null) await once(child, 'exit'); }
}

const directory = await mkdtemp(join(tmpdir(),'research-memory-http-'));
let unloadedTaskId;
try {
await withServer({STUB_CASE:'memory',RESEARCH_MEMORY_DIRECTORY:directory}, async(request,poll)=>{
 const create=async(input,options={})=>{const t=await request('/api/tasks',{input,...options});return poll(t.id,x=>x.status==='complete'&&x.storage.status==='saved'&&x.memoryStatus!=='saving');};
 const first=await create('[合成验收]研究合成验收虚构公司（999999.SZ）2024年利润。');
 let entries=(await request('/api/memories')).entries;assert.equal(entries.length,1);assert.equal(entries[0].focus.source,'ai');assert.equal(first.evidence.length,1);
 const entry=entries[0];const focus='我关注增长能否由经营现金支持，不只是利润增长。';
 await request(`/api/memories/${entry.id}`,{expectedVersion:entry.version,focusText:focus});
 const second=await create('[合成验收]合成验收虚构公司（999999.SZ）最新年报，这次怎么样？');
 assert.equal(second.metrics.length,3);assert(!second.metrics.some(m=>m.role==='research-memory-plan'));
 assert.equal(second.memoryUsed.focus.text,focus);assert.equal(second.memoryUsed.focus.source,'user');assert.equal(second.result.researchScope.year,2025);assert.equal(second.evidence.length,2);assert.equal(second.result.analyses[0].question,'接续上次的现金问题');assert.equal(second.memoryUsed.source.scope.year,2024);assert.equal(second.userView,undefined);
 const without=await create('[合成验收]合成验收虚构公司（999999.SZ）最新年报，这次怎么样？',{memoryEnabled:false});assert.equal(without.memoryUsed,null);assert.equal(without.evidence.length,1);
 const policyOff=await request(`/api/tasks/${second.id}/memory`,{enabled:false,expectedRevision:second.revision,operationId:randomUUID()});
 const off=await poll(second.id,x=>x.revision===policyOff.revision&&x.status==='complete'&&x.storage.status==='saved'&&x.memoryStatus!=='saving');assert.equal(off.memoryUsed,null);
 entries=(await request('/api/memories')).entries;const current=entries[0];
 const paused=(await request(`/api/memories/${current.id}`,{expectedVersion:current.version,disabled:true})).entry;
 const pausedFile=await readFile(join(directory,'personal-research-memory.json'),'utf8');
 const inactive=await create('[合成验收]合成验收虚构公司（999999.SZ）2024年利润。');assert.equal(inactive.memoryUsed,null);assert.equal(inactive.memoryStatus,'skipped');
 assert.deepEqual((await request('/api/memories')).entries[0],paused);assert.equal(await readFile(join(directory,'personal-research-memory.json'),'utf8'),pausedFile);
 const disabled=(await request('/api/memories')).entries[0];await request(`/api/memories/${disabled.id}`,{expectedVersion:disabled.version,disabled:false});
 const active=(await request('/api/memories')).entries[0];await request(`/api/memories/${active.id}`,{action:'remove',expectedVersion:active.version});assert.equal((await request('/api/memories')).entries.length,0);
 const after=await create('[合成验收]合成验收虚构公司（999999.SZ）2024年利润。',{memoryEnabled:false});assert.equal(after.memoryUsed,null);
 reports.push({scenario:'two_new_sessions_memory_changes_tool_plan',status:'pass',firstTask:first.id,secondTask:second.id,withMemoryTables:2,withoutMemoryTables:1});
 reports.push({scenario:'old_scope_not_reused_as_new_financial_evidence',status:'pass',memoryYear:2024,currentYear:2025});
 reports.push({scenario:'manual_correction_then_disable_enable_delete',status:'pass',userFocusPreserved:true,deleteStopsRecall:true,viewNotInvented:true});
 reports.push({scenario:'per_task_memory_opt_out_reanalysis',status:'pass',taskId:off.id});
});
let m09PausedEntry,m09PausedTask;
await withServer({STUB_CASE:'memory',RESEARCH_MEMORY_DIRECTORY:directory},async(request,poll)=>{
 const seed=await request('/api/tasks',{input:'[M09合成验收]合成验收虚构公司（999999.SZ）2024年利润。'});
 await poll(seed.id,t=>t.status==='complete'&&t.storage.status==='saved'&&t.memoryStatus==='saved');
 const entry=(await request('/api/memories')).entries[0];
 m09PausedEntry=(await request(`/api/memories/${entry.id}`,{expectedVersion:entry.version,disabled:true})).entry;
 const before=await readFile(join(directory,'personal-research-memory.json'),'utf8');
 const created=await request('/api/tasks',{input:'[M09合成验收]合成验收虚构公司（999999.SZ）最新年报，这次怎么样？'});
 m09PausedTask=await poll(created.id,t=>t.status==='complete'&&t.storage.status==='saved'&&t.memoryStatus==='skipped');
 assert.equal(m09PausedTask.memoryUsed,null);assert.equal(m09PausedTask.memoryPolicy.captureFence.enabled,false);
 assert.deepEqual((await request('/api/memories')).entries[0],m09PausedEntry);
 assert.equal(await readFile(join(directory,'personal-research-memory.json'),'utf8'),before);
 for(const metric of m09PausedTask.metrics){
   const trace=JSON.parse(await readFile(new URL(`../artifacts/model-runs/${metric.runId}.json`,import.meta.url),'utf8'));
   const input=JSON.parse(trace.input.slice(trace.input.indexOf('\n')+1));assert.equal(input.personalResearchMemory,null);
 }
});
await withServer({STUB_CASE:'memory',RESEARCH_MEMORY_DIRECTORY:directory},async(request,poll)=>{
 assert.deepEqual((await request('/api/memories')).entries[0],m09PausedEntry);
 const loaded=await request(`/api/tasks/${m09PausedTask.id}`);assert.equal(loaded.memoryUsed,null);assert.equal(loaded.memoryStatus,'skipped');
 const active=(await request(`/api/memories/${m09PausedEntry.id}`,{expectedVersion:m09PausedEntry.version,disabled:false})).entry;
 for(const field of ['focus','researchGoal','unresolved','progress','source'])assert.deepEqual(active[field],m09PausedEntry[field]);
 assert.equal(active.version,m09PausedEntry.version+1);
 const before=await readFile(join(directory,'personal-research-memory.json'),'utf8');
 await request(`/api/tasks/${m09PausedTask.id}/persist`,{});
 assert.equal(await readFile(join(directory,'personal-research-memory.json'),'utf8'),before);
 const fresh=await request('/api/tasks',{input:'[M09合成验收]合成验收虚构公司（999999.SZ）最新年报，继续研究。'});
 const done=await poll(fresh.id,t=>t.status==='complete'&&t.storage.status==='saved'&&t.memoryStatus==='saved');
 assert.equal(done.memoryUsed.id,active.id);
 const updated=(await request('/api/memories')).entries[0];assert.equal(updated.version,active.version+1);assert.equal(updated.source.taskId,done.id);
 reports.push({scenario:'M09_paused_no_recall_no_write_restart_enable_no_backfill',status:'pass',pausedTaskId:m09PausedTask.id,freshTaskId:done.id,pausedVersion:m09PausedEntry.version,enabledVersion:active.version,pausedFileUnchanged:true,allModelInputsExcludeMemory:true,persistDoesNotBackfill:true});
});
await withServer({STUB_CASE:'memory',STUB_MEMORY_DROP:'true',RESEARCH_MEMORY_DIRECTORY:directory}, async(request,poll)=>{
 const create=async(input)=>{const t=await request('/api/tasks',{input});return poll(t.id,x=>x.status==='complete'&&x.storage.status==='saved'&&x.memoryStatus!=='saving');};
 const first=await create('[合成验收]合成验收虚构公司（999999.SZ）2024年利润与现金支持关系。');
 const second=await create('[合成验收]合成验收虚构公司（999999.SZ）最新年报，接着上次研究。');
 assert.equal(second.metrics.length,3);
 assert(second.memoryUsed);assert.deepEqual(second.evidence.map(e=>e.id),['FUYAO-INCOME','FUYAO-CASH']);
 reports.push({scenario:'memory_plan_cannot_drop_current_question_evidence',status:'pass',firstTask:first.id,secondTask:second.id,evidenceIds:second.evidence.map(e=>e.id)});
 unloadedTaskId=second.id;
});
// Delete in a restarted service before loading the old task. This exercises
// persisted derivatives, rather than only the in-memory invalidation loop.
await withServer({STUB_CASE:'memory',RESEARCH_MEMORY_DIRECTORY:directory},async(request)=>{
 const entry=(await request('/api/memories')).entries[0];
 await request(`/api/memories/${entry.id}`,{action:'remove',expectedVersion:entry.version});
});
await withServer({STUB_CASE:'memory',RESEARCH_MEMORY_DIRECTORY:directory},async(request,poll)=>{
 const old=await request(`/api/tasks/${unloadedTaskId}`);
 assert.equal(old.memoryUsed,null);assert.equal(old.focus,null);assert.equal(old.memoryPolicy.enabled,false);
 assert(old.contextInvalidatedThroughRevision>=old.result.revision);
 await request(`/api/tasks/${old.id}/messages`,{message:'[合成验收]这次只看2024年利润，不沿用旧研究背景',kind:'chat',bot:'main',operationId:randomUUID()});
 const next=await poll(old.id,t=>t.status==='complete'&&t.storage.status==='saved');
 const run=next.metrics.findLast(m=>m.role==='research-answer');
 const trace=JSON.parse(await readFile(new URL(`../artifacts/model-runs/${run.runId}.json`,import.meta.url),'utf8'));
 const input=JSON.parse(trace.input.slice(trace.input.indexOf('\n')+1));
 assert.equal(input.personalResearchMemory,null);assert.equal(input.previousResult,null);assert.equal(input.taskContext.summary.unresolvedCondition,null);
 assert.equal((await request('/api/memories')).entries.length,0);
 reports.push({scenario:'restart_delete_before_loading_old_task_excludes_derived_context',status:'pass',taskId:old.id,answerRunId:run.runId});
});
await withServer({STUB_CASE:'memory',RESEARCH_MEMORY_DIRECTORY:join(directory,'corrections'),APP_DATA_DIR:join(directory,'correction-tasks')},async(request,poll)=>{
 const create=async(input)=>{const t=await request('/api/tasks',{input});return poll(t.id,t=>t.status==='complete'&&t.storage.status==='saved'&&t.memoryStatus!=='saving');};
 const focus='[合成验收]合成验收虚构公司（999999.SZ）2024年，我想弄清经营现金能否支持利润。';
 const first=await create(focus);const original=(await request('/api/memories')).entries[0];assert.equal(original.focus.text,focus);
 const next=await create('[合成验收]合成验收虚构公司（999999.SZ）2024年，这次怎么样？');
 assert.equal(next.memoryUsed.id,original.id);assert(next.contextAudit.some(e=>e.stage==='planning_read'&&e.memoryId===original.id));
 const temporaryInput='[合成验收]合成验收虚构公司（999999.SZ）2024年，这次先不看现金流，只看利润。';
 const temporary=await create(temporaryInput);
 assert.equal(temporary.memoryUsed.id,original.id);
 assert.equal(temporary.memoryUsed.usage.focus,false);assert.equal(temporary.memoryUsed.usage.progress,true);
 assert.equal((await request('/api/memories')).entries[0].focus.text,focus);
 for(const metric of temporary.metrics){
   const trace=JSON.parse(await readFile(join(directory,'correction-tasks','model-runs',`${metric.runId}.json`),'utf8'));
   const modelInput=JSON.parse(trace.input.slice(trace.input.indexOf('\n')+1));
   assert.equal(modelInput.personalResearchMemory.id,original.id);
   assert.equal(modelInput.personalResearchMemory.focus,null);
   assert.equal('researchGoal' in modelInput.personalResearchMemory,false);
   assert.equal(modelInput.personalResearchMemory.usage.progress,true);
   assert.equal(modelInput.currentFocus.text,temporaryInput);
 }
 assert(temporary.result.analyses[0].answer.includes(temporaryInput));
 assert(!temporary.result.analyses[0].answer.includes(focus));
 const changed='[合成验收]合成验收虚构公司（999999.SZ）2024年，以后不用这个关注点了，我现在主要研究利润变化。';
 const correction=await create(changed);assert(correction.contextAudit.some(e=>e.stage==='correction'&&e.kind==='case'));
 const current=(await request('/api/memories')).entries[0];assert.equal(current.focus.text,changed);assert.equal(current.focus.provenance.taskId,correction.id);
 const fresh=await create('[合成验收]合成验收虚构公司（999999.SZ）2024年，这次怎么样？');assert.equal(fresh.memoryUsed.focus.text,changed);
 const attribution=await create('[合成验收]合成验收虚构公司（999999.SZ）2024年，那个观点是我引用别人的，不是我的。');
 assert(attribution.contextAudit.some(e=>e.stage==='correction'&&e.kind==='attribution_correction'));
 assert((await request('/api/memories')).entries[0].attributionCorrections.length);
 reports.push({scenario:'natural_focus_turn_override_permanent_correction_and_attribution',status:'pass',planningReadBeforeModel:true,temporaryKeepsDefault:true,permanentCorrectionPersists:true,attributionCorrectionPersists:true,taskIds:[first.id,next.id,temporary.id,correction.id,fresh.id,attribution.id]});
});
await mkdir(new URL('../artifacts/memory-verification/',import.meta.url),{recursive:true});
await writeFile(new URL('../artifacts/memory-verification/http-checks.json',import.meta.url),JSON.stringify({evaluatedAt:new Date().toISOString(),scope:'Real local HTTP orchestration, synthetic model and data. No Claude or user-value comparison.',reports},null,2));
console.log(JSON.stringify({passed:reports.length,reports},null,2));
} finally {await rm(directory,{recursive:true,force:true});}
