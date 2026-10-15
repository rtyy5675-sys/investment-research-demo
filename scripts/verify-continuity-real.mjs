// A real-model/real-disclosure continuation check using an isolated local profile.
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {setTimeout as wait} from 'node:timers/promises';
import {createResearchMemoryStore} from '../lib/personal-research-memory.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),directory=join(root,'artifacts/continuity-verification');
const profile=join(directory,'real-profile'),ownerId='continuity-real-verification',port=8797,base=`http://127.0.0.1:${port}`;
await mkdir(join(profile,'tasks'),{recursive:true});await mkdir(join(profile,'disclosures'),{recursive:true});
const seed=JSON.parse(await readFile(join(root,'artifacts/tasks/744cd450-ae56-43da-9ff7-0df72df4dd54.json'),'utf8'));
seed.ownerId=ownerId;seed.memoryPolicy={enabled:true};seed.memoryUsed=null;seed.memorySaved=null;
await writeFile(join(profile,'tasks',`${seed.id}.json`),JSON.stringify(seed));
for(const d of seed.documents)for(const ext of ['pdf','json'])await copyFile(join(root,'artifacts/disclosures',`${d.id}.${ext}`),join(profile,'disclosures',`${d.id}.${ext}`));
const memories=createResearchMemoryStore(join(profile,'personal-memory'),{ownerId});
let entry=await memories.capture(seed);if(!entry)entry=(await memories.list())[0];
assert(entry.resolved_questions.some(q=>q.id.startsWith('cash-split:')));
assert(/具体|项目|回款/.test(entry.unresolved.question));
entry=await memories.update(entry.id,{expectedVersion:entry.version,focusText:'[演示关切]我想弄清经营现金变化，以及哪些证据能够或不能说明回款质量。'});
let child;
async function start(){child=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,PORT:String(port),HOST:'127.0.0.1',APP_DATA_DIR:profile,RESEARCH_OWNER_ID:ownerId,MODEL_SETTINGS_FILE:join(root,'artifacts/model-settings.json'),PREVIEW_ACCESS_PASSWORD:'',NODE_ENV:'development'},stdio:['ignore','pipe','pipe']});let logs='';child.stdout.on('data',d=>logs+=d);child.stderr.on('data',d=>logs+=d);for(let i=0;i<100;i++){try{await request('/api/health');return;}catch{if(child.exitCode!==null)throw new Error(logs);await wait(50);}}throw new Error('isolated server startup failed');}
async function stop(){if(child&&child.exitCode===null){child.kill('SIGTERM');await new Promise(r=>child.once('exit',r));}}
async function request(path,body){const r=await fetch(base+path,{...(body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(10000)});const data=await r.json();if(!r.ok)throw new Error(JSON.stringify(data));return data;}
async function done(id){for(let i=0;i<360;i++){const t=await request(`/api/tasks/${id}`);if(t.status!=='running'&&t.memoryStatus!=='saving')return t;await wait(500);}throw new Error('real run timed out');}
try{
await start();
const created=await request('/api/tasks',{input:'贵州茅台2025年年报，这份资料对我之前的问题有什么帮助？'});
console.log(JSON.stringify({stage:'started',taskId:created.id,sourceTask:seed.id,profile:'isolated'}));
const task=await done(created.id);await writeFile(join(directory,'real-task.json'),JSON.stringify(task,null,2));
assert.equal(task.status,'complete',task.error||task.clarification);assert.equal(task.memoryStatus,'saved',task.memoryWarning);
assert.equal(task.memoryUsed.id,entry.id);assert(task.contextAudit.some(e=>e.stage==='planning_read'&&e.memoryId===entry.id));
assert(task.result.evidenceActivity.reusedIds.includes('DOC-CASH-474905deeaf0'));
assert(task.evidence.some(e=>e.id.startsWith('DOC-NOTES-')));
assert(task.result.analyses.some(a=>a.evidenceIds.some(id=>id.startsWith('DOC-NOTES-'))));
assert(task.memorySaved.analysisRevision===task.revision);
await stop();await start();
const loaded=await request(`/api/tasks/${task.id}`),stored=(await request('/api/memories')).entries[0];
assert.equal(loaded.result.revision,task.revision);assert.equal(stored.source.taskId,task.id);
assert(stored.evidence_refs.some(r=>r.evidenceId.startsWith('DOC-NOTES-')&&r.pages.length));
const trace=await request(`/api/tasks/${task.id}/trace`);
const report={checkedAt:new Date().toISOString(),kind:'real model + real Fuyao + persisted original PDF; isolated constructed user focus',seedTaskId:seed.id,taskId:task.id,planningMemoryRead:task.contextAudit.find(e=>e.stage==='planning_read'),usedVersion:task.memoryUsed.version,restored:task.contextAudit.find(e=>e.stage==='evidence_restored'),newEvidence:task.result.evidenceActivity.fetchedIds,progress:task.result.progress,analyses:task.result.analyses,commit:task.memorySaved,restartPersisted:true,modelCalls:task.metrics.map(m=>({role:m.role,runId:m.runId})),traceAvailable:!!trace.personalMemory.audit.length};
await writeFile(join(directory,'real-checks.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await stop();}
