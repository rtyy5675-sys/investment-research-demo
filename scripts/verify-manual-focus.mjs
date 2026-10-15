import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {once} from 'node:events';
import {setTimeout as wait} from 'node:timers/promises';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';

const root=fileURLToPath(new URL('../',import.meta.url));
const evidence=join(root,'docs/evidence/system-acceptance-2026-10-15');
const runId=`${Date.now()}-${process.pid}`;
const profile=join(root,'artifacts/system-acceptance-2026-10-15/manual-focus',runId);
const data=join(profile,'artifacts');
await mkdir(data,{recursive:true});await mkdir(evidence,{recursive:true});
const socket=createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));assert(![8791,8797].includes(port));
const child=spawn(process.execPath,['--import',new URL('../tests/fixtures/runtime-fetch-stub.mjs',import.meta.url).href,'server.mjs'],{cwd:root,env:{...process.env,NODE_ENV:'test',HOST:'127.0.0.1',PORT:String(port),PREVIEW_ACCESS_PASSWORD:'',APP_DATA_DIR:data,RESEARCH_MEMORY_DIRECTORY:join(profile,'memory'),RESEARCH_OWNER_ID:`manual-focus-${runId}`,MODEL_SETTINGS_FILE:join(profile,'model-settings.json'),MODEL_PROVIDER:'openai-compatible',MODEL_BASE_URL:'https://runtime-model.invalid',MODEL_NAME:'synthetic-runtime-test',MODEL_API_KEY:'synthetic-only',FUYAO_API_KEY:'synthetic-only',STUB_CASE:'memory',RESEARCH_MAX_MODEL_CALLS:'4',RESEARCH_MAX_KNOWN_TOKENS:'120000',RESEARCH_MAX_DURATION_MS:'30000',RESEARCH_MAX_INPUT_CHARS:'100000'},stdio:['ignore','pipe','pipe']});
let log='';child.stdout.on('data',chunk=>{log+=chunk;});child.stderr.on('data',chunk=>{log+=chunk;});
const report={checkedAt:new Date().toISOString(),runId,scope:'Isolated real localhost HTTP with synthetic model/MCP. No external fetch or personal user data.',profile,port,userPortsUntouched:[8791,8797],status:'pending'};
const request=async(path,body)=>{const response=await fetch(`http://127.0.0.1:${port}${path}`,{...(body!==undefined?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(10000)});const value=await response.json();assert(response.ok,`HTTP ${response.status}: ${JSON.stringify(value)}`);return value;};
const poll=async(id,predicate)=>{let task;for(let i=0;i<150;i++){task=await request(`/api/tasks/${id}`);if(predicate(task))return task;await wait(20);}throw Error(`Manual focus did not complete: ${JSON.stringify({status:task?.status,error:task?.error,clarification:task?.clarification})}`);};
const done=t=>t.status==='complete'&&t.storage?.status==='saved'&&t.memoryStatus!=='saving';
try{
  let ready=false;for(let i=0;i<150;i++){try{await request('/api/health');ready=true;break;}catch{if(child.exitCode!==null)throw Error(log);await wait(20);}}assert(ready);
  const created=await request('/api/tasks',{input:'[手动关注合成验收]合成验收虚构公司（999999.SZ）2024年利润',autoSupplement:false});
  await poll(created.id,done);
  const entry=(await request('/api/memories')).entries[0];assert(entry);
  const longTerm='长期默认关注：理解合成公司的现金支持条件';
  const unfinished='历史未决：合成经营现金的资料还缺少什么';
  const corrected=(await request(`/api/memories/${entry.id}`,{expectedVersion:entry.version,focusText:longTerm,unresolvedQuestion:unfinished})).entry;
  const before=await request(`/api/tasks/${created.id}`);
  // No temporary/future marker in the text: scope must come from the /focus API.
  const temporary='了解2024年利润变化';
  const queued=await request(`/api/tasks/${before.id}/focus`,{expectedRevision:before.revision,expectedFocusVersion:before.focus?.version||0,text:temporary,operationId:randomUUID()});
  const task=await poll(before.id,t=>t.revision===queued.revision&&done(t));
  assert.equal(task.result.focus.scope,'turn');assert.equal(task.result.focus.text,temporary);
  assert.equal(task.memoryUsed.id,corrected.id);assert.equal(task.memoryUsed.usage.focus,false);assert.equal(task.memoryUsed.usage.progress,true);
  const after=(await request('/api/memories')).entries[0];
  assert.equal(after.focus.text,longTerm);assert.equal(after.focus.source,'user');
  assert(after.open_questions.some(q=>q.question===unfinished||q.text===unfinished));
  const inputs=[];
  for(const metric of task.metrics.filter(m=>m.revision===task.revision)){
    const trace=JSON.parse(await readFile(join(data,'model-runs',`${metric.runId}.json`),'utf8'));
    const input=JSON.parse(trace.input.slice(trace.input.indexOf('\n')+1));
    assert.equal(input.personalResearchMemory.id,corrected.id);
    assert.equal(input.personalResearchMemory.focus,null);
    assert.equal('researchGoal' in input.personalResearchMemory,false);
    assert.equal(input.personalResearchMemory.usage.progress,true);
    assert(input.personalResearchMemory.open_questions.some(q=>q.question===unfinished||q.text===unfinished));
    assert.equal(input.currentFocus.text,temporary);
    assert.equal(input.currentFocus.scope,'turn');
    inputs.push({runId:metric.runId,role:metric.role,focus:null,usage:input.personalResearchMemory.usage,openQuestionIds:input.personalResearchMemory.open_questions.map(q=>q.id)});
  }
  assert.equal(inputs.length,3);
  Object.assign(report,{status:'pass',taskId:task.id,revision:task.revision,resultFocus:task.result.focus,memoryId:after.id,longTermFocusUnchanged:true,oldProgressRetained:true,allModelInputsExcludeOldFocus:true,inputs});
}catch(error){Object.assign(report,{status:'fail',error:error.message});process.exitCode=1;}
finally{
  child.kill('SIGTERM');if(child.exitCode===null)await once(child,'exit');
  await writeFile(join(profile,'server.log'),log);
  await writeFile(join(evidence,'manual-focus.json'),JSON.stringify(report,null,2)+'\n');
  await writeFile(join(evidence,'manual-focus.log'),log+'\n'+JSON.stringify(report,null,2)+'\n');
}
console.log(JSON.stringify(report,null,2));
