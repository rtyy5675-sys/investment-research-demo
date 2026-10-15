// Real local HTTP and model adapter, synthetic upstream. Never changes user settings.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {once} from 'node:events';
import {mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {setTimeout as wait} from 'node:timers/promises';

const socket=createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));
const directory=await mkdtemp(join(tmpdir(),'jianwei-api-settings-')),settingsFile=join(directory,'settings.json'),reports=[];
let child,logs='',createdTaskId;
const url=`http://127.0.0.1:${port}`;
async function request(path,data,extra={}){const response=await fetch(url+path,{...(data===undefined?{}:{method:'POST',headers:{'content-type':'application/json',...extra},body:JSON.stringify(data)}),signal:AbortSignal.timeout(10000)});return {status:response.status,data:await response.json()};}
async function start(){child=spawn(process.execPath,['--import',new URL('../tests/fixtures/runtime-fetch-stub.mjs',import.meta.url).href,'server.mjs'],{cwd:new URL('../',import.meta.url),env:{...process.env,HOST:'127.0.0.1',PORT:String(port),MODEL_SETTINGS_FILE:settingsFile,MODEL_PROVIDER:'openai-compatible',MODEL_BASE_URL:'https://runtime-model.invalid',MODEL_NAME:'initial-synthetic',MODEL_API_KEY:'environment-test-only',FUYAO_API_KEY:'synthetic-test-only',STUB_DELAY_MS:'60'},stdio:['ignore','pipe','pipe']});child.stdout.on('data',b=>logs+=b);child.stderr.on('data',b=>logs+=b);for(let i=0;i<100;i++){try{if((await request('/api/health')).status===200)return;}catch{}if(child.exitCode!==null)throw new Error(logs);await wait(30);}throw new Error('Local verification service did not start');}
async function stop(){if(child&&child.exitCode===null){child.kill('SIGTERM');await once(child,'exit');}}
try{
  await start();
  const metadata=await request('/api/model-settings');assert.equal(metadata.data.keyConfigured,true);assert.equal('apiKey' in metadata.data,false);assert.ok(!JSON.stringify(metadata.data).includes('environment-test-only'));reports.push('redacted_metadata');
  const saved=await request('/api/model-settings/save',{provider:'openai-compatible',baseUrl:'https://runtime-model.invalid/chat/completions',modelName:'saved-synthetic-model',apiKey:'saved-test-only',expectedVersion:0});assert.equal(saved.status,200);assert.equal(saved.data.version,1);assert.equal(saved.data.baseUrl,'https://runtime-model.invalid');assert.equal('apiKey' in saved.data,false);reports.push('save_and_normalize_endpoint');
  const verified=await request('/api/model-settings/check',{expectedVersion:1});assert.equal(verified.data.ok,true);assert.ok(verified.data.checkedAt);reports.push('actual_adapter_structured_check_with_synthetic_upstream');
  const csrf=await request('/api/model-settings/save',{provider:'codex',expectedVersion:1},{origin:'https://untrusted.example'});assert.equal(csrf.status,403);reports.push('cross_origin_write_rejected');
  const stale=await request('/api/model-settings/save',{provider:'codex',expectedVersion:0});assert.equal(stale.status,409);reports.push('stale_save_rejected');
  const task=await request('/api/tasks',{input:'[合成验收]虚构公司2024年度，核对利润与现金流。',isEvaluation:true,memoryEnabled:false,autoSupplement:false});createdTaskId=task.data.id;
  const busy=await request('/api/model-settings/save',{provider:'codex',expectedVersion:1});assert.equal(busy.status,409);reports.push('running_research_blocks_provider_switch');
  let finished;for(let i=0;i<150;i++){const current=await request(`/api/tasks/${createdTaskId}`);if(current.data.status!=='running'&&current.data.storage?.status==='saved'){finished=current.data;break;}await wait(30);}
  assert.equal(finished?.status,'complete');assert.ok(finished.metrics.length>=3);assert.ok(finished.metrics.every(item=>item.model==='saved-synthetic-model'&&item.provider==='openai-compatible'));assert.ok(!JSON.stringify(finished).includes('saved-test-only'));reports.push('saved_configuration_used_by_full_synthetic_research');
  await stop();await start();const afterRestart=await request('/api/model-settings');assert.equal(afterRestart.data.modelName,'saved-synthetic-model');assert.equal(afterRestart.data.version,1);assert.ok(afterRestart.data.verifiedAt);reports.push('configuration_and_verification_survive_restart');
  const report={checkedAt:new Date().toISOString(),scope:'Real local HTTP, persistence and complete research orchestration; synthetic model and MCP. Not a real external API credential check.',passed:reports.length,scenarios:reports};
  await mkdir(new URL('../docs/evidence/',import.meta.url),{recursive:true});await writeFile(new URL('../docs/evidence/model-settings-checks.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await stop();await rm(directory,{recursive:true,force:true});if(createdTaskId)await rm(new URL(`../artifacts/tasks/${createdTaskId}.json`,import.meta.url),{force:true});}
