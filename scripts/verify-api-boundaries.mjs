import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {request as httpRequest} from 'node:http';
import {once} from 'node:events';
import {setTimeout as wait} from 'node:timers/promises';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';

const root=fileURLToPath(new URL('../',import.meta.url));
const evidence=join(root,'docs/evidence/system-acceptance-2026-10-15');
const runId=`${Date.now()}-${process.pid}`,profile=join(root,'artifacts/system-acceptance-2026-10-15/api-boundaries',runId),data=join(profile,'artifacts');
await mkdir(data,{recursive:true});await mkdir(evidence,{recursive:true});
const socket=createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));assert(![8791,8797].includes(port));
const secret='synthetic-api-boundary-only-do-not-expose';
const child=spawn(process.execPath,['--import',new URL('../tests/fixtures/runtime-fetch-stub.mjs',import.meta.url).href,'server.mjs'],{cwd:root,env:{...process.env,NODE_ENV:'test',PREVIEW_ACCESS_PASSWORD:'',HOST:'127.0.0.1',PORT:String(port),APP_DATA_DIR:data,RESEARCH_MEMORY_DIRECTORY:join(profile,'memory'),RESEARCH_OWNER_ID:`boundary-${runId}`,MODEL_SETTINGS_FILE:join(profile,'model-settings.json'),MODEL_PROVIDER:'openai-compatible',MODEL_BASE_URL:'https://runtime-model.invalid',MODEL_NAME:'synthetic-boundary',MODEL_API_KEY:secret,FUYAO_API_KEY:'synthetic-fuyao-only',RESEARCH_MAX_DURATION_MS:'30000',RESEARCH_MAX_INPUT_CHARS:'100000'},stdio:['ignore','pipe','pipe']});
let log='';child.stdout.on('data',b=>{log+=b;});child.stderr.on('data',b=>{log+=b;});
const outcomes=[];
async function send(path,{raw,body,headers={},method}={}){
  const response=await fetch(`http://127.0.0.1:${port}${path}`,{method:method||(raw!==undefined||body!==undefined?'POST':'GET'),headers:{...(raw!==undefined||body!==undefined?{'Content-Type':'application/json'}:{}),...headers},...(raw!==undefined?{body:raw}:body!==undefined?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(10000)});
  const text=await response.text();return {status:response.status,value:JSON.parse(text),text};
}
const friendly=(response,status)=>{assert.equal(response.status,status);assert.equal(typeof response.value.error,'string');assert(/[\u4e00-\u9fff]/.test(response.value.error));assert(!/TypeError|SyntaxError|Unexpected token|Unexpected end|JSON\.parse|Cannot read|\.trim|recordedRuns|not defined/i.test(response.text));};
const noSecrets=value=>{
  assert(!JSON.stringify(value).includes(secret));assert(!JSON.stringify(value).includes('synthetic-fuyao-only'));
  function visit(item){if(!item||typeof item!=='object')return;for(const [key,childValue] of Object.entries(item)){assert(!/^(api_?key|authorization|fuy[aao]*_?api_?key)$/i.test(key),`secret property ${key}`);visit(childValue);}}
  visit(value);
};
async function scenario(name,check){try{const details=await check();outcomes.push({scenario:name,status:'pass',...details});}catch(error){outcomes.push({scenario:name,status:'fail',error:error.message});}}
async function splitByteRequest(path,body){
  const bytes=Buffer.from(JSON.stringify(body));
  return new Promise((resolve,reject)=>{
    const req=httpRequest({hostname:'127.0.0.1',port,path,method:'POST',headers:{'Content-Type':'application/json','Content-Length':bytes.length}},res=>{const chunks=[];res.on('data',b=>chunks.push(b));res.on('end',()=>{try{resolve({status:res.statusCode,value:JSON.parse(Buffer.concat(chunks).toString('utf8')),sentBytes:bytes.length});}catch(error){reject(error);}});});
    req.on('error',reject);req.setTimeout(10000,()=>req.destroy(Error('split UTF8 request timed out')));
    void(async()=>{for(let i=0;i<bytes.length;i++){req.write(bytes.subarray(i,i+1));await wait(1);}req.end();})().catch(reject);
  });
}
try{
  let ready=false;for(let i=0;i<150;i++){try{assert.equal((await send('/api/health')).status,200);ready=true;break;}catch{if(child.exitCode!==null)throw Error(log);await wait(20);}}assert(ready,'isolated server failed to start');
  await scenario('unknown_task_returns_404_without_legacy_fallback_error',async()=>{const id=randomUUID();for(const [path,options] of [[`/api/tasks/${id}`,{}],[`/api/tasks/${id}/focus`,{body:{text:'中文输入'}}]])friendly(await send(path,options),404);return {getAndPost:404};});
  const invalid=[['malformed_json','{'],['null_json','null'],['array_json','[]'],['string_json','"中文字符串"'],['number_json','12'],['input_number',JSON.stringify({input:23})],['input_null',JSON.stringify({input:null})],['input_object',JSON.stringify({input:{text:'问题'}})],['input_array',JSON.stringify({input:['问题']})],['empty_input',JSON.stringify({input:''})],['blank_input',JSON.stringify({input:'  \n  '})]];
  for(const [name,raw] of invalid)await scenario(name,async()=>{const response=await send('/api/tasks',{raw});friendly(response,400);return {httpStatus:response.status,message:response.value.error};});
  await scenario('request_character_limit',async()=>{const response=await send('/api/tasks',{body:{input:'中'.repeat(12001)}});friendly(response,400);return {httpStatus:response.status,message:response.value.error};});
  await scenario('request_64kb_byte_limit',async()=>{const response=await send('/api/tasks',{body:{input:'x'.repeat(70000)}});friendly(response,413);return {httpStatus:response.status,message:response.value.error};});
  await scenario('cross_site_model_settings_blocked',async()=>{for(const headers of [{'Sec-Fetch-Site':'cross-site'},{Origin:'https://unrelated.invalid'}])friendly(await send('/api/model-settings/save',{body:{},headers}),403);return {httpStatus:403};});
  await scenario('model_settings_wrong_content_type',async()=>{const response=await send('/api/model-settings/save',{raw:'{}',headers:{'Content-Type':'text/plain'}});friendly(response,415);return {httpStatus:415};});
  await scenario('split_utf8_byte_json_decodes_exactly_without_model_call',async()=>{
    const modelName='中文逐字分片-🧭';
    const response=await splitByteRequest('/api/model-settings/save',{expectedVersion:0,provider:'openai-compatible',baseUrl:'https://runtime-model.invalid',modelName,apiKey:secret});
    assert.equal(response.status,200);assert.equal(response.value.modelName,modelName);assert.equal(response.value.version,1);noSecrets(response.value);
    const settings=JSON.parse(await readFile(join(profile,'model-settings.json'),'utf8'));assert.equal(settings.modelName,modelName);
    const health=await send('/api/health');assert.equal(health.value.active,0);
    return {httpStatus:200,modelName:response.value.modelName,sentBytes:response.sentBytes,chunkBytes:1,splitIncludesThreeAndFourByteCharacters:true,modelInvoked:false};
  });
  let done;
  await scenario('isolated_task_ready_for_revision_and_trace_checks',async()=>{
    const created=await send('/api/tasks',{body:{input:'[合成接口边界验收]虚构公司2024年度',isEvaluation:true,memoryEnabled:false,autoSupplement:false}});assert.equal(created.status,201);
    for(let i=0;i<150;i++){const response=await send(`/api/tasks/${created.value.id}`);done=response.value;if(done.status!=='running'&&done.execution?.endedAt&&done.storage?.status==='saved')break;await wait(20);}
    assert.equal(done.status,'complete');return {taskId:done.id,revision:done.revision};
  });
  await scenario('stale_revision_rejected',async()=>{assert(done);const response=await send(`/api/tasks/${done.id}/stop`,{body:{expectedRevision:done.revision-1}});friendly(response,409);return {httpStatus:409,taskId:done.id};});
  await scenario('public_configuration_and_trace_exclude_api_keys',async()=>{assert(done);const paths=['/api/config','/api/health','/api/model-settings','/api/data-sources',`/api/tasks/${done.id}/trace`];for(const path of paths){const response=await send(path);assert.equal(response.status,200);noSecrets(response.value);}return {paths,apiKeysAbsent:true};});
}catch(error){outcomes.push({scenario:'runner',status:'fail',error:error.message});}
finally{child.kill('SIGTERM');if(child.exitCode===null)await once(child,'exit');await writeFile(join(profile,'server.log'),log);}
const report={checkedAt:new Date().toISOString(),runId,scope:'Real isolated local HTTP, synthetic financial/model responses, no outbound fetch. Not production penetration or financial semantics testing.',profile,port,userPortsUntouched:[8791,8797],passed:outcomes.filter(o=>o.status==='pass').length,failed:outcomes.filter(o=>o.status==='fail').length,outcomes};
await writeFile(join(evidence,'api-boundaries-final.json'),JSON.stringify(report,null,2)+'\n');await writeFile(join(evidence,'api-boundaries-final.log'),log+'\n'+JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));process.exitCode=report.failed?1:0;
