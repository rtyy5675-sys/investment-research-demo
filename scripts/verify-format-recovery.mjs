import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {once} from 'node:events';
import {setTimeout as wait} from 'node:timers/promises';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';

const root=fileURLToPath(new URL('../',import.meta.url));
const evidence=join(root,'docs/evidence/system-acceptance-2026-10-15');
const runId=`${Date.now()}-${process.pid}`;
const profiles=join(root,'artifacts/system-acceptance-2026-10-15/format-recovery',runId);
const reports=[],logs=[];
await mkdir(evidence,{recursive:true});
async function freePort(){const server=createServer();server.listen(0,'127.0.0.1');await once(server,'listening');const port=server.address().port;await new Promise(resolve=>server.close(resolve));assert(![8791,8797].includes(port));return port;}
async function withServer(name,extra,check){
  const profile=join(profiles,name),data=join(profile,'artifacts');
  await mkdir(data,{recursive:true});
  const port=await freePort();
  const child=spawn(process.execPath,['--import',new URL('../tests/fixtures/format-recovery-stub.mjs',import.meta.url).href,'server.mjs'],{cwd:root,env:{...process.env,NODE_ENV:'test',PREVIEW_ACCESS_PASSWORD:'',HOST:'127.0.0.1',PORT:String(port),APP_DATA_DIR:data,RESEARCH_MEMORY_DIRECTORY:join(profile,'memory'),RESEARCH_OWNER_ID:`synthetic-format-${runId}-${name}`,MODEL_SETTINGS_FILE:join(profile,'model-settings.json'),MODEL_PROVIDER:'openai-compatible',MODEL_BASE_URL:'https://api.deepseek.com/v1',MODEL_NAME:'synthetic-model',MODEL_API_KEY:'synthetic-only',FUYAO_API_KEY:'synthetic-only',RESEARCH_MAX_MODEL_CALLS:'4',RESEARCH_MAX_TOOL_CALLS:'8',RESEARCH_MAX_KNOWN_TOKENS:'120000',RESEARCH_MAX_DURATION_MS:'30000',RESEARCH_MAX_INPUT_CHARS:'100000',FORMAT_RECOVERY_CASE:name,...extra},stdio:['ignore','pipe','pipe']});
  let serverLog='';child.stdout.on('data',chunk=>{serverLog+=chunk;});child.stderr.on('data',chunk=>{serverLog+=chunk;});
  const request=async(path,body)=>{const response=await fetch(`http://127.0.0.1:${port}${path}`,{...(body!==undefined?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(10000)});const value=await response.json();assert(response.ok,`HTTP ${response.status}: ${JSON.stringify(value)}`);return value;};
  const poll=async(id,predicate)=>{let last;for(let i=0;i<150;i++){last=await request(`/api/tasks/${id}`);if(predicate(last))return last;await wait(20);}throw new Error(`Scenario ${name} did not reach expected state: ${JSON.stringify({status:last?.status,error:last?.error,stage:last?.execution?.stage})}`);};
  const create=()=>request('/api/tasks',{input:'[合成格式恢复验收]虚构公司2024年度资料是否取得',isEvaluation:true,memoryEnabled:false,autoSupplement:false,operationId:randomUUID()});
  const startedAt=new Date().toISOString();
  try{
    let ready=false;
    for(let i=0;i<150;i++){try{await request('/api/health');ready=true;break;}catch{if(child.exitCode!==null)throw Error(serverLog);await wait(20);}}
    assert(ready,'isolated server did not start');
    const details=await check({request,poll,create,data});
    reports.push({scenario:name,status:'pass',startedAt,endedAt:new Date().toISOString(),port,profile,...details});
  }catch(error){reports.push({scenario:name,status:'fail',startedAt,endedAt:new Date().toISOString(),port,profile,error:error.message});}
  finally{
    child.kill('SIGTERM');if(child.exitCode===null)await once(child,'exit');
    logs.push(`Scenario ${name}: ${reports.at(-1).status}\n${serverLog}`);
    await writeFile(join(profile,'server.log'),serverLog);
  }
}
const done=t=>t.status!=='running'&&t.execution?.endedAt&&t.storage?.status==='saved';
for(const name of ['bad_json','bad_schema'])await withServer(name,{},async({request,poll,create})=>{
  const created=await create(),task=await poll(created.id,done),trace=await request(`/api/tasks/${created.id}/trace`);
  assert.equal(task.status,'complete');assert.equal(task.result.revision,task.revision);
  assert.equal(task.answerReview.status,'passed');
  assert.deepEqual(task.metrics.map(m=>[m.role,m.status]),[['research-plan','success'],['research-answer','failure'],['research-answer-format-repair','success'],['research-final-check','success']]);
  assert.equal(trace.outputRecoveries.length,1);assert.equal(trace.outputRecoveries[0].status,'repaired');
  assert.equal(task.execution.used.modelCalls,4);
  return {taskId:task.id,roles:task.metrics.map(m=>m.role),recovery:trace.outputRecoveries[0],resultPublished:true,independentFinalReview:true};
});
await withServer('repeat_bad',{},async({request,poll,create})=>{
  const created=await create(),first=await poll(created.id,done);assert.equal(first.status,'complete');
  await request(`/api/tasks/${first.id}/messages`,{message:'请继续说明合成资料',kind:'chat',bot:'main',operationId:randomUUID()});
  const task=await poll(first.id,t=>t.revision>first.revision&&done(t));
  const trace=await request(`/api/tasks/${task.id}/trace`),calls=task.metrics.filter(m=>m.revision===task.revision);
  assert.equal(task.status,'partial');assert.equal(task.result.revision,first.result.revision);assert.equal(task.result.summary,first.result.summary);
  assert.deepEqual(calls.map(m=>m.role),['research-plan','research-answer','research-answer-format-repair']);
  assert.equal(calls.filter(m=>m.role==='research-answer-format-repair').length,1);
  assert.equal(trace.outputRecoveries.at(-1).status,'failed');
  return {taskId:task.id,roles:calls.map(m=>m.role),recovery:trace.outputRecoveries.at(-1),previousValidRevision:first.result.revision,currentRevision:task.revision,previousAnswerPreserved:true};
});
await withServer('budget',{RESEARCH_MAX_MODEL_CALLS:'3'},async({request,poll,create})=>{
  const created=await create(),task=await poll(created.id,done),trace=await request(`/api/tasks/${task.id}/trace`);
  assert.equal(task.status,'failed');assert.equal(task.result,null);assert.equal(task.execution.used.modelCalls,2);
  assert.equal(trace.outputRecoveries[0].status,'skipped');assert.equal(trace.outputRecoveries[0].reason,'insufficient_model_budget');
  assert(!task.metrics.some(m=>m.role==='research-answer-format-repair'));
  return {taskId:task.id,modelCalls:task.execution.used.modelCalls,remaining:1,recovery:trace.outputRecoveries[0],resultPublished:false};
});
await withServer('stop_repair',{},async({request,poll,create,data})=>{
  const created=await create();
  const running=await poll(created.id,t=>t.status==='running'&&t.outputRecoveries?.at(-1)?.status==='repairing'&&t.execution?.stage==='research-answer-format-repair');
  await request(`/api/tasks/${created.id}/stop`,{expectedRevision:running.revision});
  await wait(500); // Wait past the deliberate upstream late response.
  const task=await poll(created.id,done),trace=await request(`/api/tasks/${task.id}/trace`);
  assert.equal(task.status,'cancelled');assert.equal(task.result,null);assert.equal(task.endReason,'user_cancelled');
  assert.equal(trace.outputRecoveries.at(-1).status,'cancelled');
  assert.equal(typeof trace.outputRecoveries.at(-1).reason,'string');
  assert(trace.outputRecoveries.at(-1).reason.trim());
  assert(!task.metrics.some(m=>m.role==='research-final-check'));
  const repair=task.metrics.find(m=>m.role==='research-answer-format-repair');assert.equal(repair.status,'cancelled');
  const artifact=JSON.parse(await readFile(join(data,'model-runs',`${repair.runId}.json`),'utf8'));
  assert.equal(typeof artifact.rejectedOutput,'string','late returned draft should be recorded privately');assert(!Object.hasOwn(artifact,'result'));
  return {taskId:task.id,recovery:trace.outputRecoveries.at(-1),repairStatus:repair.status,lateResponseReturned:true,resultPublished:false,finalCheckCalled:false};
});
const report={checkedAt:new Date().toISOString(),runId,scope:'Isolated real localhost HTTP/server with in-process DeepSeek/MCP synthetic responses; all external fetches denied.',profiles,userPortsUntouched:[8791,8797],passed:reports.filter(r=>r.status==='pass').length,failed:reports.filter(r=>r.status==='fail').length,reports};
await writeFile(join(evidence,'format-recovery.json'),JSON.stringify(report,null,2)+'\n');
await writeFile(join(evidence,'format-recovery.log'),logs.join('\n')+'\n'+JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
process.exitCode=report.failed?1:0;
