import {createHash,timingSafeEqual} from 'node:crypto';

export function isPublicHealthRequest(method,path) {
  return method==='GET'&&path==='/healthz';
}

export function isPreviewRequestAuthorized(req,env=process.env) {
  if(env.NODE_ENV!=='production')return true;
  const header=req.headers?.authorization||'';
  let username='',password='';
  if(header.startsWith('Basic ')){
    try{
      const credentials=Buffer.from(header.slice(6),'base64').toString('utf8');
      const separator=credentials.indexOf(':');
      if(separator>=0){username=credentials.slice(0,separator);password=credentials.slice(separator+1);}
    }catch{}
  }
  const digest=value=>createHash('sha256').update(value).digest();
  const userOk=timingSafeEqual(digest(username),digest(env.PREVIEW_ACCESS_USERNAME||'reviewer'));
  const passwordOk=timingSafeEqual(digest(password),digest(env.PREVIEW_ACCESS_PASSWORD||''));
  return userOk&&passwordOk;
}
