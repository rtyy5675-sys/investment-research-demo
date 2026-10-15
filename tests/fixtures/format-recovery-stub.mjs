// Isolated synthetic model/MCP only. The base fixture denies all other fetches.
import './runtime-fetch-stub.mjs';
import {setTimeout as wait} from 'node:timers/promises';
const baseFetch=globalThis.fetch;
let answers=0;
const json=data=>new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
globalThis.fetch=async(input,init)=>{
  const request=new Request(input,init);
  if(!request.url.startsWith('https://api.deepseek.com/v1/'))return baseFetch(input,init);
  const body=await request.json();
  const instructions=body.messages[0].content;
  const schemaText=instructions.match(/\n(\{"type":"object",.*\})(?:\n|$)/)?.[1];
  if(!schemaText)throw new Error('Synthetic DeepSeek request missing complete schema');
  const schema=JSON.parse(schemaText);
  const repair=instructions.includes('# 本次仅修复未发布的输出结构');
  if(schema.properties.analyses){
    if(!repair)answers++;
    const mode=process.env.FORMAT_RECOVERY_CASE;
    const bad=mode==='repeat_bad'?answers>1:!repair;
    if(mode==='stop_repair'&&repair){
      // Deliberately ignore AbortSignal to simulate an upstream late response.
      await wait(350);
    }
    const valid={resolvedQuestionIds:[],questionUnderstanding:'合成验收资料是否取得',summary:'合成格式恢复验收，不代表真实公司信息。',progress:{status:'answered',change:'合成资料取得；仅验证执行机制。',remainingQuestion:'',blocker:''},analyses:[{question:'合成资料是否取得',intent:'question',claim:'',claimSource:{messageId:'',quote:''},answer:'已取得合成资料，仅用于程序验收。',support:'not_applicable',evidenceIds:['FUYAO-INCOME','FUYAO-CASH']}],keyCondition:{question:'',whyItMatters:'',nextCheck:''},otherConditions:[],nextAction:{kind:'none',toolId:'',question:'',reason:'合成验收结束'},scope:'虚构公司及合成资料，非金融验证'};
    const content=bad?(mode==='bad_json'?'deliberately invalid JSON':'{}'):JSON.stringify(valid);
    return json({choices:[{message:{content},finish_reason:'stop'}],usage:{prompt_tokens:10,completion_tokens:5}});
  }
  // Reuse the existing synthetic planner/final-check and MCP fixture. No real network.
  const translated={...body,response_format:{type:'json_schema',json_schema:{name:'research',strict:true,schema}}};
  return baseFetch('https://runtime-model.invalid/chat/completions',{...init,body:JSON.stringify(translated)});
};
