import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,readdir,chmod,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const prompt={instructions:'只输出测试 JSON',input:'local stub only',version:'trace-test-v1'};
const schema={type:'object',properties:{ok:{type:'boolean'}},required:['ok'],additionalProperties:false};
const keys=['MODEL_SETTINGS_FILE','MODEL_PROVIDER','MODEL_API_KEY','MODEL_BASE_URL','MODEL_NAME','MODEL_REASONING_EFFORT','CODEX_BIN','CODEX_MODEL','CODEX_REASONING_EFFORT','TRACE_STUB_MODE','MODEL_MAX_RESPONSE_BYTES','MODEL_MAX_OUTPUT_CHARS'];
async function fixture(run) {
  const saved=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
  const directory=await mkdtemp(join(tmpdir(),'model-trace-test-'));
  process.env.MODEL_SETTINGS_FILE=join(directory,'settings.json');
  try{await run(directory);}finally{for(const key of keys){if(saved[key]===undefined)delete process.env[key];else process.env[key]=saved[key];}await rm(directory,{recursive:true,force:true});}
}
async function model(){return import(`${new URL('../lib/model.mjs',import.meta.url).href}?test=${Math.random()}`);}
async function localApi(handler,run,{baseUrl='http://local-stub.invalid'}={}) {
  const originalFetch=globalThis.fetch;
  process.env.MODEL_PROVIDER='openai-compatible';process.env.MODEL_API_KEY='local-test-only';process.env.MODEL_NAME='local-stub';
  process.env.MODEL_BASE_URL=baseUrl;
  globalThis.fetch=async(url,request)=>new Promise((resolve,reject)=>{
    const abort=()=>reject(new DOMException('Aborted','AbortError'));
    request.signal.addEventListener('abort',abort,{once:true});
    if(request.signal.aborted){abort();return;}
    let status=200;
    handler(request,{setHeader(){},writeHead(value){status=value;},end(body=''){
      request.signal.removeEventListener('abort',abort);
      resolve(new Response(body,{status}));
    }});
  });
  try{await run();}finally{globalThis.fetch=originalFetch;}
}
function assertMetric(metric,status,endReason) {
  assert.match(metric.runId,/^[0-9a-f-]{36}$/);
  assert.equal(metric.taskId,'test-task');assert.equal(metric.revision,7);assert.equal(metric.role,'test-role');
  assert.equal(metric.status,status);assert.equal(metric.endReason,endReason);
  assert.equal(metric.promptVersion,'trace-test-v1');assert.match(metric.promptHash,/^[0-9a-f]{64}$/);
  assert.equal(typeof metric.durationMs,'number');assert.ok('usage' in metric);assert.ok('reasoningEffort' in metric);
}
function options(directory,seen,extra={}){return {taskId:'test-task',revision:7,role:'test-role',artifactDir:directory,onMetric:metric=>seen.push(metric),...extra};}

test('API success writes begin and final artifacts and emits one metric',()=>fixture(async directory=>{
  await localApi((req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:'{"ok":true}'}}],usage:{total_tokens:3}}));},async()=>{
    const seen=[];const {generate}=await model();const returned=await generate(prompt,schema,options(directory,seen));
    assert.deepEqual(returned.result,{ok:true});assert.equal(seen.length,1);assertMetric(seen[0],'success','completed');
    const names=await readdir(directory);assert.equal(names.length,2);
    const begin=JSON.parse(await readFile(join(directory,`${returned.metrics.runId}.begin.json`),'utf8'));
    const final=JSON.parse(await readFile(join(directory,`${returned.metrics.runId}.json`),'utf8'));
    assert.equal(begin.metrics.status,'running');assert.equal(final.metrics.status,'success');assert.deepEqual(final.result,{ok:true});
  });
}));

test('OpenAI uses strict JSON Schema and DeepSeek uses JSON Object plus local schema validation',()=>fixture(async directory=>{
  for(const provider of ['openai','deepseek']) {
    process.env.MODEL_BASE_URL=provider==='openai'?'https://api.openai.com/v1':'https://api.deepseek.com/v1';
    let requestBody;
    await localApi((req,res)=>{
      requestBody=JSON.parse(req.body);
      res.setHeader('Content-Type','application/json');
      res.end(JSON.stringify({choices:[{message:{content:'{"ok":true}'}}]}));
    },async()=>{
      const {generate}=await model();
      const returned=await generate(prompt,schema,options(directory,[]));
      assert.deepEqual(returned.result,{ok:true});
    },{baseUrl:provider==='openai'?'https://api.openai.com/v1':'https://api.deepseek.com/v1'});
    if(provider==='openai')assert.equal(requestBody.response_format.type,'json_schema');
    else {
      assert.deepEqual(requestBody.response_format,{type:'json_object'});
      assert.match(requestBody.messages[0].content,/JSON对象/);
    }
  }
  process.env.MODEL_BASE_URL='https://api.deepseek.com/v1';
  await localApi((_req,res)=>res.end(JSON.stringify({choices:[{message:{content:'{"ok":"wrong-type"}'}}]})),async()=>{
    const {generate}=await model();
    await assert.rejects(generate(prompt,schema,options(directory,[])),error=>error.endReason==='invalid_json');
  },{baseUrl:'https://api.deepseek.com/v1'});
}));

test('API response and final body limits reject rather than publish truncated JSON',()=>fixture(async directory=>{
  for(const kind of ['transport','body']){
    process.env.MODEL_MAX_RESPONSE_BYTES=kind==='transport'?'64':'10000';process.env.MODEL_MAX_OUTPUT_CHARS=kind==='body'?'20':'10000';
    await localApi((_req,res)=>res.end(JSON.stringify({choices:[{message:{content:JSON.stringify({ok:true,padding:'x'.repeat(100)})}}]})),async()=>{
      const seen=[];const {generate}=await model();
      await assert.rejects(generate(prompt,schema,options(directory,seen)),error=>error.endReason==='output_limit');
      assert.equal(seen.length,1);assert.equal(seen[0].status,'failure');assert.equal(seen[0].endReason,'output_limit');
      const trace=JSON.parse(await readFile(join(directory,`${seen[0].runId}.json`),'utf8'));assert.equal(trace.result,undefined);
    });
  }
}));

test('API HTTP, invalid output, timeout and external cancellation preserve failure metrics',()=>fixture(async directory=>{
  for(const scenario of ['http','invalid','timeout','cancel']) {
    await localApi((req,res)=>{
      if(scenario==='http'){res.writeHead(429);res.end();}
      else if(scenario==='invalid'){res.end(JSON.stringify({choices:[{message:{content:'not JSON'}}]}));}
      // Timeout and cancellation deliberately wait for the request abort signal; no network request is made.
    },async()=>{
      const controller=new AbortController(),seen=[];const {generate}=await model();
      const cancelTimer=scenario==='cancel'?setTimeout(()=>controller.abort(new Error('user stopped')),40):null;
      let caught;
      try{await generate(prompt,schema,options(directory,seen,{signal:controller.signal,timeoutMs:scenario==='timeout'?60:5000}));}catch(error){caught=error;}finally{clearTimeout(cancelTimer);}
      assert.ok(caught);assert.equal(seen.length,1);assert.equal(caught.metrics,seen[0]);
      const expected={http:['failure','http_error'],invalid:['failure','invalid_json'],timeout:['timeout','model_timeout'],cancel:['cancelled','external_abort']}[scenario];
      assertMetric(seen[0],...expected);assert.equal(seen[0].usage,null);
      const final=JSON.parse(await readFile(join(directory,`${seen[0].runId}.json`),'utf8'));assert.equal(final.metrics.status,expected[0]);assert.ok(final.error.message);
    });
  }
}));

test('API traces preserve budget/storage abort ownership and classify fetch failures as network',()=>fixture(async directory=>{
  for(const scenario of ['budget','storage','network']) {
    await localApi(()=>{if(scenario==='network')throw new TypeError('fetch failed',{cause:Object.assign(new Error('connection refused'),{code:'ECONNREFUSED'})});},async()=>{
      const controller=new AbortController(),seen=[];const {generate}=await model();
      const reason=scenario==='budget'?Object.assign(new Error('task token budget exhausted'),{code:'BUDGET_EXHAUSTED',category:'budget_exhausted'}):Object.assign(new Error('task persistence failed'),{code:'STORAGE_ERROR',category:'storage_error'});
      const timer=scenario==='network'?null:setTimeout(()=>controller.abort(reason),30);
      let caught;
      try{await generate(prompt,schema,options(directory,seen,{signal:controller.signal}));}catch(error){caught=error;}finally{clearTimeout(timer);}
      assert.equal(seen.length,1);assert.equal(caught.metrics,seen[0]);
      if(scenario==='network') {
        assertMetric(seen[0],'failure','network_error');assert.equal(seen[0].errorCategory,'network');
      } else {
        assertMetric(seen[0],'cancelled',reason.category);assert.equal(seen[0].errorCategory,reason.category);assert.equal(seen[0].error.code,reason.code);assert.equal(caught.code,reason.code);
      }
      const artifact=JSON.parse(await readFile(join(directory,`${seen[0].runId}.json`),'utf8'));
      assert.equal(artifact.metrics.errorCategory,seen[0].errorCategory);assert.equal(artifact.error.code,seen[0].error.code);
    });
  }
}));

test('artifact and metric callback failures cannot mask the original HTTP error',()=>fixture(async directory=>{
  const blocked=join(directory,'not-a-directory');await writeFile(blocked,'x');
  await localApi((req,res)=>{res.writeHead(503);res.end();},async()=>{
    let calls=0;const {generate}=await model();let caught;
    try{await generate(prompt,schema,options(blocked,[],{onMetric:()=>{calls++;throw new Error('sink failed');}}));}catch(error){caught=error;}
    assert.equal(calls,1);assert.match(caught.message,/HTTP 503/);assert.equal(caught.metrics.endReason,'http_error');
    assert.deepEqual(caught.metrics.warnings.map(item=>item.stage),['trace_begin_write','trace_final_write','metric_callback']);
  });
}));

test('CLI local stub covers success, exit failure, missing executable, timeout and cancellation',()=>fixture(async directory=>{
  const executable=join(directory,'codex-stub');
  await writeFile(executable,`#!/usr/bin/env node\nconst mode=process.env.TRACE_STUB_MODE;\nif(mode==='hang'){process.on('SIGTERM',()=>{});setInterval(()=>{},1000);}\nelse if(mode==='exit'){process.stderr.write('stub failure');process.exit(9);}\nelse{process.stdout.write(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'{"ok":true}'}})+'\\n');process.stdout.write(JSON.stringify({type:'turn.completed',usage:{input_tokens:2}})+'\\n');}\n`);
  await chmod(executable,0o700);process.env.MODEL_PROVIDER='codex';process.env.CODEX_BIN=executable;process.env.CODEX_REASONING_EFFORT='low';
  const {generate}=await model();
  for(const scenario of ['success','exit','missing','timeout','cancel']) {
    process.env.TRACE_STUB_MODE=['timeout','cancel'].includes(scenario)?'hang':scenario;
    process.env.CODEX_BIN=scenario==='missing'?join(directory,'missing-bin'):executable;
    const controller=new AbortController(),seen=[];
    // Give the stub time to install its SIGTERM handler, exercising SIGKILL fallback.
    const cancelTimer=scenario==='cancel'?setTimeout(()=>controller.abort(),300):null;
    let returned,caught;const started=Date.now();
    try{returned=await generate(prompt,schema,options(directory,seen,{signal:controller.signal,timeoutMs:scenario==='timeout'?300:5000}));}catch(error){caught=error;}finally{clearTimeout(cancelTimer);}
    assert.equal(seen.length,1);
    const expected={success:['success','completed'],exit:['failure','process_exit'],missing:['failure','spawn_error'],timeout:['timeout','model_timeout'],cancel:['cancelled','external_abort']}[scenario];
    assertMetric(seen[0],...expected);assert.equal(seen[0].reasoningEffort,'low');
    if(scenario==='success'){assert.deepEqual(returned.result,{ok:true});assert.deepEqual(returned.metrics.usage,{input_tokens:2});}
    else assert.equal(caught.metrics,seen[0]);
    if(['timeout','cancel'].includes(scenario))assert.ok(Date.now()-started<3000,'termination must be bounded');
  }
}));
