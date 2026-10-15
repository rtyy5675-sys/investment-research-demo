import {readFileSync} from 'node:fs';
import {mkdir,writeFile,rename,rm} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';

const fail=(message,status=400)=>Object.assign(new Error(message),{status,category:'configuration'});
export function normalizeModelBaseUrl(value) {
  let url;
  try {url=new URL(String(value||'').trim());}catch{throw fail('请输入有效的模型 API 基础地址。');}
  const local=['localhost','127.0.0.1','[::1]'].includes(url.hostname);
  if(url.protocol!=='https:' && !(url.protocol==='http:'&&local))throw fail('模型 API 请使用 HTTPS；本机服务可使用 HTTP。');
  if(url.username||url.password||url.search||url.hash)throw fail('模型 API 地址不能包含账号、密码、查询参数或片段。');
  url.pathname=url.pathname.replace(/\/chat\/completions\/?$/,'').replace(/\/+$/,'');
  return url.href.replace(/\/$/,'');
}
const defaults=env=>({provider:env.MODEL_PROVIDER==='openai-compatible'?'openai-compatible':'codex',baseUrl:env.MODEL_BASE_URL||'https://api.openai.com/v1',modelName:env.MODEL_PROVIDER==='openai-compatible'?(env.MODEL_NAME||''):(env.CODEX_MODEL||''),apiKey:env.MODEL_API_KEY||'',version:0,verifiedAt:null,source:env.MODEL_PROVIDER||env.MODEL_API_KEY?'environment':'default'});
export function createModelSettingsStore(file,{env=process.env}={}) {
  let tail=Promise.resolve();
  const serialized=fn=>{const next=tail.then(fn);tail=next.catch(()=>{});return next;};
  function read() {
    let saved;
    try {saved=JSON.parse(readFileSync(file,'utf8'));}catch(error){if(error.code==='ENOENT')return defaults(env);throw fail('无法读取模型配置，请检查本机配置文件。',500);}
    if(!['codex','openai-compatible'].includes(saved.provider)||!Number.isSafeInteger(saved.version)||typeof saved.apiKey!=='string'||typeof saved.modelName!=='string'||typeof saved.baseUrl!=='string')throw fail('模型配置格式无效，请重新保存。',500);
    return {...saved,source:'local'};
  }
  const publicInfo=()=>{const s=read();return {provider:s.provider,baseUrl:s.baseUrl,modelName:s.modelName,keyConfigured:!!s.apiKey,source:s.source,version:s.version,verifiedAt:s.verifiedAt||null};};
  async function persist(settings) {
    const temp=`${file}.${randomUUID()}.tmp`;
    try {await mkdir(dirname(file),{recursive:true});await writeFile(temp,JSON.stringify(settings,null,2),{mode:0o600});await rename(temp,file);}
    catch{throw fail('模型配置保存失败，当前设置未改变。',500);}
    finally{await rm(temp,{force:true}).catch(()=>{});}
  }
  async function save(data) {return serialized(async()=>{
    const current=read();
    if(!Number.isSafeInteger(data.expectedVersion)||data.expectedVersion!==current.version)throw fail('模型配置已更新，请刷新后再保存。',409);
    if(!['codex','openai-compatible'].includes(data.provider))throw fail('请选择本机 Codex 或兼容 API。');
    const key=typeof data.apiKey==='string'?data.apiKey.trim():'';
    if(key.length>4096||/[\r\n\0]/.test(key))throw fail('API Key 格式无效。');
    let baseUrl=current.baseUrl, modelName=env.CODEX_MODEL||'';
    if(data.provider==='openai-compatible') {
      baseUrl=normalizeModelBaseUrl(data.baseUrl);
      modelName=typeof data.modelName==='string'?data.modelName.trim():'';
      if(!modelName||modelName.length>200||/[\r\n\0]/.test(modelName))throw fail('请填写有效的模型名称。');
      if(!key&&!current.apiKey)throw fail('请填写模型 API Key。');
      if(!key&&current.apiKey) {
        let oldOrigin;try{oldOrigin=new URL(current.baseUrl).origin;}catch{}
        if(new URL(baseUrl).origin!==oldOrigin)throw fail('更换服务地址后，请重新填写该服务对应的 Key。');
      }
    }
    const saved={provider:data.provider,baseUrl,modelName,apiKey:key||current.apiKey,version:current.version+1,verifiedAt:null};
    await persist(saved);return publicInfo();
  });}
  async function verify(version) {return serialized(async()=>{const s=read();if(s.version!==version)throw fail('验证期间配置已改变，请按最新配置重新验证。',409);await persist({...s,source:undefined,verifiedAt:new Date().toISOString()});return publicInfo();});}
  return {read,publicInfo,save,verify};
}
const stores=new Map();
export function modelSettingsStore(){const path=process.env.MODEL_SETTINGS_FILE||fileURLToPath(new URL('../artifacts/model-settings.json',import.meta.url));if(!stores.has(path))stores.set(path,createModelSettingsStore(path));return stores.get(path);}
export function modelSummary(settings=modelSettingsStore().read()) {return {available:settings.provider==='codex'||!!settings.apiKey&&!!settings.modelName,provider:settings.provider,label:settings.modelName||(settings.provider==='codex'?'Codex · 本机登录':'兼容 API 模型')};}
export function checkSettingsRequest(req) {
  const remote=req.socket?.remoteAddress;
  if(remote&&!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(remote))throw fail('模型配置仅允许从本机管理。',403);
  if(req.headers['sec-fetch-site']==='cross-site')throw fail('不接受跨站模型配置请求。',403);
  if(req.headers.origin) {
    let origin;try{origin=new URL(req.headers.origin);}catch{throw fail('模型配置请求来源无效。',403);}
    if(origin.host!==req.headers.host||!['http:','https:'].includes(origin.protocol))throw fail('不接受跨站模型配置请求。',403);
  }
  if(!String(req.headers['content-type']||'').startsWith('application/json'))throw fail('模型配置请求需要 JSON。',415);
}
