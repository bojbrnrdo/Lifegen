import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('Lifegroup integration refuses remote direct database URLs before connecting', () => {
  const result=spawnSync(process.execPath,['tests/lifegroup-integration.mjs'],{
    cwd:process.cwd(),
    env:{
      ...process.env,
      LIFEGEN_INTEGRATION_DATABASE_URL:'postgres://postgres@127.0.0.1:5433/lifegen_test',
      LIFEGEN_INTEGRATION_DIRECT_URL:'postgres://postgres@db.production.example:5432/lifegen',
      LIFEGEN_INTEGRATION_ADMIN_PASSWORD:'config-validation-only',
    },
    encoding:'utf8',timeout:10000,
  });
  assert.equal(result.status,2,result.stderr);
  assert.match(result.stderr,/LIFEGEN_INTEGRATION_DIRECT_URL must be local/);
});
