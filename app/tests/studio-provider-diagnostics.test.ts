import assert from 'node:assert/strict';
import test from 'node:test';
import { renderImage } from '../src/lib/studio/providers';
import { StudioError } from '../src/lib/studio/errors';

test('provider rejection retains only safe diagnostics and distinguishes login from provider access', async () => {
  for (const status of [401, 402, 429]) {
    const fetcher = (async () => new Response(JSON.stringify({error:{message:'PRIVATE upstream text',metadata:{limit_source:'key',api_key:'PRIVATE'},secret:'PRIVATE'}}),{status,headers:{'x-request-id':'safe_request_123','retry-after':'12'}})) as typeof fetch;
    await assert.rejects(renderImage('nano-pro-2k','fixture',[],{OPENROUTER_API_KEY:'fixture',NODE_ENV:'test'},fetcher), error => {
      assert.ok(error instanceof StudioError);
      assert.equal(error.code,'provider_'+status);
      assert.equal(error.status,502);
      assert.deepEqual(error.diagnostic,{upstreamStatus:status,requestId:'safe_request_123',retryAfterSeconds:12,limitSource:'key'});
      assert.ok(!JSON.stringify(error).includes('PRIVATE'));
      if(status===401) assert.match(error.message,/app login/);
      if(status===402) assert.match(error.message,/does not establish an empty account/);
      return true;
    });
  }
});
