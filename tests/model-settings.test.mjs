import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createModelSettingsStore,normalizeModelBaseUrl,checkSettingsRequest,modelSummary} from '../lib/model-settings.mjs';
async function fixture(run){const dir=await mkdtemp(join(tmpdir(),'model-settings-'));try{await run(join(dir,'config.json'));}finally{await rm(dir,{recursive:true,force:true});}}
const initial={provider:'openai-compatible',baseUrl:'https://model.example/v1',modelName:'example-model',apiKey:'test-key-not-real',expectedVersion:0};
test('配置元数据不返回Key；保存后重建store仍可读且文件权限600',()=>fixture(async file=>{
  const store=createModelSettingsStore(file,{env:{}});assert.equal(store.publicInfo().provider,'codex');
  const saved=await store.save(initial);assert.equal(saved.keyConfigured,true);assert.equal(saved.version,1);assert.equal('apiKey' in saved,false);assert.ok(!JSON.stringify(saved).includes(initial.apiKey));
  assert.equal(createModelSettingsStore(file,{env:{}}).read().apiKey,initial.apiKey);assert.equal((await stat(file)).mode&0o777,0o600);
}));
test('空Key保留、旧版本冲突、并发仅一个保存成功，不丢已保存配置',()=>fixture(async file=>{
  const store=createModelSettingsStore(file,{env:{}});await store.save(initial);
  const outcomes=await Promise.allSettled([store.save({...initial,apiKey:'',expectedVersion:1,modelName:'next'}),store.save({...initial,apiKey:'',expectedVersion:1,modelName:'other'})]);
  assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);assert.equal(store.read().modelName,'next');assert.equal(store.read().apiKey,initial.apiKey);
  await assert.rejects(store.save({...initial,expectedVersion:0}),e=>e.status===409);
}));
test('更换API主机不能隐式转发旧Key，需重新填写对应Key',()=>fixture(async file=>{
  const store=createModelSettingsStore(file,{env:{}});await store.save(initial);
  await assert.rejects(store.save({...initial,baseUrl:'https://different.example/v1',apiKey:'',expectedVersion:1}),/重新填写/);
  await store.save({...initial,baseUrl:'https://different.example/v1',apiKey:'new-test-only',expectedVersion:1});assert.equal(store.read().apiKey,'new-test-only');
}));
test('环境默认不写盘；切回Codex不把API模型名传给CLI；验证有版本归属',()=>fixture(async file=>{
  const store=createModelSettingsStore(file,{env:{MODEL_PROVIDER:'openai-compatible',MODEL_API_KEY:'environment-test-only',MODEL_NAME:'api-name',CODEX_MODEL:'cli-name'}});
  assert.equal(store.publicInfo().source,'environment');await assert.rejects(readFile(file),e=>e.code==='ENOENT');
  await store.save({provider:'codex',modelName:'api-name',apiKey:'',expectedVersion:0});assert.equal(store.read().modelName,'cli-name');
  await store.verify(1);assert.ok(store.publicInfo().verifiedAt);await store.save({...initial,expectedVersion:1});assert.equal(store.publicInfo().verifiedAt,null);await assert.rejects(store.verify(1),e=>e.status===409);
}));
test('API地址校验及完整路径归一化；缺Key/模型不保存',()=>fixture(async file=>{
  assert.equal(normalizeModelBaseUrl('https://model.example/v1/chat/completions/'),'https://model.example/v1');
  assert.equal(normalizeModelBaseUrl('http://127.0.0.1:9000/v1/'),'http://127.0.0.1:9000/v1');
  for(const address of ['http://outside.example/v1','https://user:secret@model.example/v1','https://model.example/v1?key=secret','file:///private/config','not a url'])assert.throws(()=>normalizeModelBaseUrl(address));
  const store=createModelSettingsStore(file,{env:{}});await assert.rejects(store.save({...initial,apiKey:''}),/Key/);await assert.rejects(store.save({...initial,modelName:''}),/模型名称/);assert.equal(modelSummary({provider:'openai-compatible',apiKey:'x',modelName:''}).available,false);
}));
test('模型配置接口拒绝跨站、远程和非JSON请求，同源本机请求允许',()=>{
  const req={headers:{host:'127.0.0.1:8791',origin:'http://127.0.0.1:8791','content-type':'application/json'},socket:{remoteAddress:'127.0.0.1'}};assert.doesNotThrow(()=>checkSettingsRequest(req));
  for(const change of [{headers:{...req.headers,origin:'https://attacker.example'}},{headers:{...req.headers,'sec-fetch-site':'cross-site'}},{headers:{...req.headers,'content-type':'text/plain'}},{socket:{remoteAddress:'203.0.113.5'}}])assert.throws(()=>checkSettingsRequest({...req,...change}));
});
