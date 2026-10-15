import test from 'node:test';
import assert from 'node:assert/strict';
import {isPreviewRequestAuthorized,isPublicHealthRequest} from '../lib/preview-auth.mjs';

const env={NODE_ENV:'production',PREVIEW_ACCESS_USERNAME:'reviewer',PREVIEW_ACCESS_PASSWORD:'long:preview:password'};
const request=authorization=>({headers:authorization?{authorization}:{}});

test('preview auth requires the configured username and full password, including colons',()=>{
  const valid=`Basic ${Buffer.from(`${env.PREVIEW_ACCESS_USERNAME}:${env.PREVIEW_ACCESS_PASSWORD}`).toString('base64')}`;
  assert.equal(isPreviewRequestAuthorized(request(valid),env),true);
  assert.equal(isPreviewRequestAuthorized(request(),env),false);
  assert.equal(isPreviewRequestAuthorized(request(`Basic ${Buffer.from('reviewer:wrong').toString('base64')}`),env),false);
  assert.equal(isPreviewRequestAuthorized(request(`Basic ${Buffer.from('other:long:preview:password').toString('base64')}`),env),false);
});

test('local mode does not require preview credentials; only GET /healthz is a public health check',()=>{
  assert.equal(isPreviewRequestAuthorized(request(),{NODE_ENV:'development'}),true);
  assert.equal(isPublicHealthRequest('GET','/healthz'),true);
  assert.equal(isPublicHealthRequest('POST','/healthz'),false);
  assert.equal(isPublicHealthRequest('GET','/api/health'),false);
});
