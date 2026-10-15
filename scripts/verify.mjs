import {writeFile,mkdir} from 'node:fs/promises';
const base=process.env.DEMO_URL||'http://127.0.0.1:8791';
const call=async(path,data)=>{const response=await fetch(base+path,data?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}:{});const json=await response.json();if(!response.ok)throw new Error(JSON.stringify(json));return json;};
const wait=async(id)=>{const start=Date.now();while(Date.now()-start<450000){const task=await call(`/api/tasks/${id}`);if(task.status!=='running')return task;await new Promise(r=>setTimeout(r,1000));}throw new Error('等待任务超过450秒');};
const config=await call('/api/config');
const input=process.env.DEMO_INPUT;
if(!input?.trim())throw new Error('请通过 DEMO_INPUT 提供一条通用研究问题，例如公司代码、报告期与需要核查的问题。');
const followupQuestion=process.env.DEMO_FOLLOWUP||'请接着本轮未解决的问题补查，说明新增资料改变了什么。';
const output={executedAt:new Date().toISOString(),scope:config.supportedScope,baseline:'same model, same evidence, same three stages; only role assignment changes',runs:[],failure:null};
for(const mode of ['roles','single']) {
  const start=Date.now();const created=await call('/api/tasks',{input:input.trim(),mode});console.log(`${mode}: created ${created.id}`);
  const initial=await wait(created.id);console.log(`${mode}: initial ${initial.status}`);
  if(initial.status!=='complete'){output.runs.push({mode,initial,durationMs:Date.now()-start});continue;}
  await call(`/api/tasks/${created.id}/messages`,{message:followupQuestion,bot:'research',kind:'followup',simulateFailure:false});
  const followup=await wait(created.id);console.log(`${mode}: followup ${followup.status}`);
  output.runs.push({mode,initial,followup,durationMs:Date.now()-start});
  if(mode==='roles'&&followup.status==='complete'){
    const previous=followup.result;
    const started=await call(`/api/tasks/${created.id}/messages`,{message:'再查一次产销存变化',bot:'research',kind:'followup',simulateFailure:true});
    const failed=await wait(created.id);
    const preserved=JSON.stringify(failed.result)===JSON.stringify(previous);
    output.failure={taskId:created.id,beforeRevision:previous.revision,afterRevision:started.revision,status:failed.status,error:failed.error,preserved,task:failed};console.log(`failure: ${failed.status}, preserved=${preserved}`);
  }
  await mkdir('artifacts',{recursive:true});await writeFile('artifacts/verification.json',JSON.stringify(output,null,2));
}
await mkdir('artifacts',{recursive:true});await writeFile('artifacts/verification.json',JSON.stringify(output,null,2));
console.log('saved artifacts/verification.json');
if(output.runs.some(r=>r.initial.status!=='complete'||r.followup?.status!=='complete')||!output.failure?.preserved)process.exitCode=1;
