import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveSecurity} from '../lib/finance-mcp.mjs';

async function scenario(t, {phase, failures=1, permission=false, cancel=false}) {
  const originalFetch=globalThis.fetch, originalKey=process.env.FUYAO_API_KEY;
  process.env.FUYAO_API_KEY='synthetic-mcp-discovery-key';
  t.after(()=>{globalThis.fetch=originalFetch;if(originalKey===undefined)delete process.env.FUYAO_API_KEY;else process.env.FUYAO_API_KEY=originalKey;});
  const events=[], counts={}; const controller=new AbortController();
  globalThis.fetch=async (url,init)=>{
    const req=new Request(url,init);
    if(req.method!=='POST')return new Response(null,{status:405});
    const body=await req.json();
    if(body.id==null)return new Response(null,{status:202});
    counts[body.method]=(counts[body.method]||0)+1;
    if(body.method===phase&&counts[body.method]<=failures){
      if(cancel)controller.abort(Object.assign(new Error('user stopped'),{code:'CANCELLED'}));
      if(permission)return new Response('denied',{status:403});
      throw new TypeError('fetch failed',{cause:Object.assign(new Error('connect timeout'),{code:'UND_ERR_CONNECT_TIMEOUT'})});
    }
    const result=body.method==='initialize'?{protocolVersion:'2025-03-26',capabilities:{tools:{}},serverInfo:{name:'synthetic',version:'1'}}:body.method==='tools/list'?{tools:[{name:'get_meta_tickers_search',inputSchema:{type:'object'}}]}:{content:[],structuredContent:{code:0,data:{item:[{name:'合成公司',thscode:'999999.SZ',asset_type:'a-share'}]}}};
    return new Response(JSON.stringify({jsonrpc:'2.0',id:body.id,result}),{headers:{'content-type':'application/json'}});
  };
  let result,error;
  try{result=await resolveSecurity('合成公司',{signal:controller.signal,onEvent:e=>events.push(e)});}catch(e){error=e;}
  return {result,error,events,counts};
}

test('MCP discovery retries one transient failure and records the native code',async t=>{
  const r=await scenario(t,{phase:'tools/list'});
  assert.equal(r.result.thscode,'999999.SZ');assert.equal(r.counts['tools/list'],2);
  const failed=r.events.find(e=>e.status==='failed');assert.equal(failed.networkCode,'UND_ERR_CONNECT_TIMEOUT');assert.equal(failed.retryScheduled,true);
  const done=r.events.find(e=>e.tool==='mcp/tools/list'&&e.status==='complete');assert.equal(done.attempt,2);assert.equal(done.callId,failed.callId);
});
test('MCP initialization retry uses a fresh transport',async t=>{
  const r=await scenario(t,{phase:'initialize'});assert.equal(r.result.thscode,'999999.SZ');assert.equal(r.counts.initialize,2);
});
test('MCP discovery stops after two transient failures',async t=>{
  const r=await scenario(t,{phase:'tools/list',failures:9});assert.ok(r.error);assert.equal(r.counts['tools/list'],2);assert.equal(r.events.filter(e=>e.retryScheduled===false).length,1);
});
test('MCP discovery does not retry a permission failure',async t=>{
  const r=await scenario(t,{phase:'tools/list',permission:true});assert.equal(r.error.category,'permission');assert.equal(r.counts['tools/list'],1);
});
test('MCP cancellation does not restart discovery',async t=>{
  const r=await scenario(t,{phase:'tools/list',cancel:true});assert.equal(r.error.category,'cancelled');assert.equal(r.counts['tools/list'],1);
});
