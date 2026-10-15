import { randomUUID } from 'node:crypto';
export function newTask(input,mode='single') {return {id:randomUUID(),revision:0,input,mode,status:'idle',messages:[],result:null,evidence:[],history:[],error:null,metrics:[],updatedAt:new Date().toISOString()};}
export function beginRevision(task,{message,kind='chat',bot='main'}) {
  if(task.result) task.history.push({result:structuredClone(task.result),evidence:structuredClone(task.evidence),savedAt:new Date().toISOString()});
  task.revision++; task.status='running'; task.error=null; task.errorInfo=null; task.endReason=null; task.answerReview=null; task.contextPreparationFailure=null;
  if(kind==='revise') {task.input=message;task.focus=null;task.checkpoint=null;}
  if(kind==='chat') task.focus=null;
  task.researchClosure=null;
  task.messages.push({id:randomUUID(),bot,from:'user',to:bot,text:message,revision:task.revision,kind,timestamp:new Date().toISOString()});
  task.updatedAt=new Date().toISOString();return task.revision;
}
export function appendMessage(task,revision,from,to,text,kind='work') {
  task.messages.push({id:randomUUID(),bot:from==='main'?to:from,from,to,text,revision,kind:revision===task.revision?kind:'superseded',timestamp:new Date().toISOString()});
}
export function publish(task,revision,result,evidence) {
  // 同一Node进程内同步检查和写入，无await穿插；迟到任务只保留历史消息。
  if(task.revision!==revision||['cancelled','budget_exhausted'].includes(task.status))return false;
  task.result={...result,revision};task.evidence=evidence;task.status='complete';task.error=null;task.errorInfo=null;task.endReason='answer_generated';task.researchOutcome=result.nextAction?.kind==='external'?'waiting_external_evidence':result.keyCondition?.question?'partial_answer':'answered';task.updatedAt=new Date().toISOString();return true;
}
export function fail(task,revision,message) {
  if(task.revision!==revision)return false;
  task.status=task.result?'partial':'failed';task.error=message;task.updatedAt=new Date().toISOString();return true;
}
export function uniqueEvidence(items) {return [...new Map(items.map(e=>[e.id,e])).values()];}
