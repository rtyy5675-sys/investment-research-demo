import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as wait } from 'node:timers/promises';
const base = 'http://127.0.0.1:8791';
async function request(path, body) {
  const response = await fetch(base + path, body === undefined ? {} : {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const data = await response.json(); if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`); return data;
}
async function terminal(id, expected = 'complete') {
  for (let i=0;i<250;i++) { const task=await request(`/api/tasks/${id}`); if(task.status!=='running'){ assert.equal(task.status,expected,JSON.stringify({error:task.error,supplement:task.supplement,review:task.answerReview})); return task; } await wait(1000); }
  throw new Error('Real disclosure acceptance timed out');
}
async function upload(task, filename, expectedRevision=task.revision) {
  const query=new URLSearchParams({filename:filename.split('/').at(-1),expectedRevision:String(expectedRevision),operationId:randomUUID()});
  const response=await fetch(`${base}/api/tasks/${task.id}/documents?${query}`,{method:'POST',headers:{'Content-Type':'application/pdf'},body:await readFile(filename)});
  return {status:response.status,task:await response.json()};
}
const memoryPath=new URL('../artifacts/personal-memory/personal-research-memory.json',import.meta.url);
const hash=async()=>createHash('sha256').update(await readFile(memoryPath)).digest('hex');
const before=await hash();
const cases=[{name:'贵州茅台',code:'600519.SH',method:'search',expectedNetDelta:-30941487179.08},{name:'美的集团',code:'000333.SZ',method:'upload',expectedNetDelta:-7165642000}];
const results=await Promise.all(cases.map(async scenario=>{
  const resumedId = process.env[scenario.method === 'search' ? 'RESUME_SEARCH_TASK' : 'RESUME_UPLOAD_TASK'];
  const created=resumedId ? {id:resumedId} : await request('/api/tasks',{input:`【通用补查验收，不代表真实投资偏好】请研究${scenario.name}（${scenario.code}）2025年全年经营现金流净额相对2024年的变化。我想弄清主要是流入变化还是流出变化造成；先基于当前结构化报表回答，缺少分项时保留这个未决问题。`,isEvaluation:true,memoryEnabled:false,autoSupplement:false,dataSource:'fuyao',operationId:randomUUID()});
  console.log(JSON.stringify({scenario:scenario.code,stage:'baseline_started',taskId:created.id}));
  let initial=await request(`/api/tasks/${created.id}`);
  if(initial.status==='running') initial=await terminal(created.id);
  assert.ok(initial.result);
 assert.equal(initial.result.cashBridge,null); assert.ok(initial.result.keyCondition.question);
  if(scenario.method==='search')await request(`/api/tasks/${initial.id}/supplement`,{expectedRevision:initial.revision,operationId:randomUUID()});
  else {const posted=await upload(initial,fileURLToPath(new URL(`../artifacts/disclosure-probe/${scenario.code.slice(0,6)}-2025-annual.pdf`,import.meta.url)));assert.equal(posted.status,202,JSON.stringify(posted.task));}
  const next=await terminal(initial.id);
  assert.ok(next.result.cashBridge);assert.equal(next.answerReview.status,'passed');assert.notEqual(next.result.progress.status,'blocked');
  assert.ok(Math.abs(next.result.cashBridge.netDelta-scenario.expectedNetDelta)<.02);assert.ok(Math.abs(next.result.cashBridge.arithmeticResidual)<.02);
  const doc=next.evidence.find(item=>item.provider==='disclosure-pdf');assert.ok(doc);assert.equal(doc.companyCode,scenario.code);assert.equal(doc.scopeKey,initial.researchScope.scopeKey);
  assert.ok(next.result.analyses.some(item=>item.evidenceIds.includes(doc.id)));assert.ok(doc.citations.length>=5);
  assert.equal(next.memoryStatus,'skipped');assert.equal(next.userView,undefined);
  const pdf=await fetch(`${base}/api/tasks/${next.id}/documents/${doc.documentId}.pdf`);assert.equal(pdf.status,200);assert.equal(pdf.headers.get('content-type'),'application/pdf');assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0,5).toString(),'%PDF-');
  console.log(JSON.stringify({scenario:scenario.code,stage:'supplement_passed',taskId:next.id,revision:next.revision,bridge:next.result.cashBridge}));
  return {scenario,taskId:next.id,initial:{revision:initial.revision,summary:initial.result.summary,progress:initial.result.progress,evidenceIds:initial.evidence.map(item=>item.id)},updated:{revision:next.revision,summary:next.result.summary,progress:next.result.progress,cashBridge:next.result.cashBridge,analyses:next.result.analyses,evidenceActivity:next.result.evidenceActivity,document:{id:doc.documentId,sourceUrl:doc.sourceUrl,citations:doc.citations},review:next.answerReview},task:next};
}));
// Wrong-company upload is a real rejection before using any unverified numbers.
const testTask=results.find(item=>item.scenario.method==='search').task;
const original=structuredClone(testTask.result);
const stale=await upload(testTask,fileURLToPath(new URL('../artifacts/disclosure-probe/000333-2025-annual.pdf',import.meta.url)),testTask.revision-1);assert.equal(stale.status,409);
const wrong=await upload(testTask,fileURLToPath(new URL('../artifacts/disclosure-probe/000333-2025-annual.pdf',import.meta.url)));assert.equal(wrong.status,202);
const rejected=await terminal(testTask.id,'partial');assert.deepEqual(rejected.result,original);assert.equal(rejected.supplement.status,'failed');
const report={checkedAt:new Date().toISOString(),scope:'Two real companies; one official disclosure search and one PDF upload; deterministic provenance/arithmetic plus real model answer and final review. Not investment advice or broad reliability proof.',personalMemoryUnchanged:before===await hash(),cases:results.map(({task,...item})=>item),failure:{taskId:rejected.id,staleUploadRejected:true,wrongCompanyRejected:true,priorResultPreserved:true,error:rejected.error}};
assert.ok(report.personalMemoryUnchanged);await writeFile(new URL('../docs/evidence/disclosure-real-checks.json',import.meta.url),JSON.stringify(report,null,2));
console.log(JSON.stringify({status:'pass',tasks:report.cases.map(item=>({company:item.scenario.name,taskId:item.taskId})),failure:report.failure,personalMemoryUnchanged:true}));
