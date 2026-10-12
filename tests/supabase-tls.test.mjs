// Focused tests for the Supabase TLS handling behind the Vercel error
// "self-signed certificate in certificate chain".
//
// The certificate and key in tests/fixtures are a throwaway loopback pair generated only
// for these tests (CN=localhost, SAN localhost/127.0.0.1/::1). They are not credentials
// for any real service and are excluded from the release ZIP.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import tls from 'node:tls';
import pg from 'pg';
import { zipSync, strToU8 } from 'fflate';
import {
  connectionHint, connectionOptions, databaseSslOptions, databaseTrustStore, extraRootCertificates, supabaseRootCertificate,
} from '../src/db.js';
import { createDeploymentService, supabaseDeploymentVariables } from '../src/deployment.js';

const fixtures = path.join(import.meta.dirname, 'fixtures');
const TEST_CERT_PATH = path.join(fixtures, 'loopback-test.crt');
const TEST_CERT = fs.readFileSync(TEST_CERT_PATH, 'utf8').trim();
const TEST_KEY = fs.readFileSync(path.join(fixtures, 'loopback-test.key'), 'utf8').trim();
// The suite controls these variables itself so its expectations do not depend on the shell.
delete process.env.NODE_EXTRA_CA_CERTS;
delete process.env.DATABASE_SSL_ROOT_CERT;

const pooled = 'postgresql://postgres.abcdefghijklmnopqrst:secret@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres';
const session = 'postgresql://postgres.abcdefghijklmnopqrst:secret@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres';
const direct = 'postgresql://postgres:secret@db.abcdefghijklmnopqrst.supabase.co:5432/postgres';

test('the Supabase project CA is added to the system roots and verification stays enabled', () => {
  const store = databaseTrustStore({ rootCert: TEST_CERT });
  assert.equal(store[0], TEST_CERT);
  assert.equal(store.length, tls.rootCertificates.length + 1);
  assert.deepEqual(store.slice(1), tls.rootCertificates);

  const ssl = databaseSslOptions({ rootCert: TEST_CERT });
  assert.equal(ssl.rejectUnauthorized, true);
  assert.equal(ssl.ca[0], TEST_CERT);
  assert.ok(ssl.ca.includes(tls.rootCertificates[0]));
});

test('without the variable the system roots are still used and verification is still enabled', () => {
  assert.equal(supabaseRootCertificate(undefined), null);
  assert.equal(supabaseRootCertificate(''), null);
  const ssl = databaseSslOptions({ rootCert: null });
  assert.deepEqual(ssl.ca, [...tls.rootCertificates]);
  assert.equal(ssl.rejectUnauthorized, true);
  assert.notEqual(ssl.rejectUnauthorized, false);
});

test('a one-line, escaped-newline certificate value is accepted and anything else fails loudly', () => {
  const escaped = TEST_CERT.replace(/\n/g, '\\n');
  const normalized = supabaseRootCertificate(escaped);
  assert.equal(normalized, TEST_CERT);
  assert.equal(supabaseRootCertificate(TEST_CERT.replace(/\n/g, '\r\n')), TEST_CERT);

  const hostile = 'not-a-certificate-secret-value';
  assert.throws(() => supabaseRootCertificate(hostile), error => {
    assert.equal(error.status, 503);
    assert.match(error.message, /PEM-encoded Supabase project CA/);
    assert.doesNotMatch(error.message, /not-a-certificate-secret-value/);
    return true;
  });
});

test('remote connections verify the chain, while local hosts and sslmode=disable opt out', () => {
  const remote = connectionOptions(pooled, { rootCert: TEST_CERT });
  assert.equal(remote.ssl.rejectUnauthorized, true);
  assert.equal(remote.ssl.ca[0], TEST_CERT);
  assert.equal(remote.enableChannelBinding, true);
  assert.doesNotMatch(remote.connectionString, /sslmode|ssl=/);

  // sslmode=require is Supabase's usual URL suffix; it must not downgrade verification.
  const required = connectionOptions(direct + '?sslmode=require', { rootCert: TEST_CERT });
  assert.equal(required.ssl.rejectUnauthorized, true);
  assert.equal(required.ssl.ca[0], TEST_CERT);

  const noVerify = connectionOptions(direct + '?sslmode=no-verify', { rootCert: TEST_CERT });
  assert.equal(noVerify.ssl.rejectUnauthorized, true);

  assert.equal(connectionOptions('postgresql://postgres@127.0.0.1:5433/lifegen').ssl, false);
  assert.equal(connectionOptions('postgresql://postgres@localhost:5432/postgres').ssl, false);
  assert.equal(connectionOptions('postgresql://postgres@[::1]:5432/postgres').ssl, false);

  const plaintext = connectionOptions(direct + '?sslmode=disable');
  assert.equal(plaintext.ssl, false);
  assert.equal(plaintext.enableChannelBinding, false);
});

test('the pg driver receives the trust store from the connection options', () => {
  const client = new pg.Client({ ...connectionOptions(session, { rootCert: TEST_CERT }), password: 'secret' });
  assert.equal(client.connectionParameters.ssl.rejectUnauthorized, true);
  assert.equal(client.connectionParameters.ssl.ca[0], TEST_CERT);
  assert.equal(client.connectionParameters.ssl.ca.length, tls.rootCertificates.length + 1);
  // A connection string can never reset verification to a weaker mode.
  const pooledClient = new pg.Client({ ...connectionOptions(pooled + '?sslmode=require', { rootCert: TEST_CERT }), password: 'secret' });
  assert.equal(pooledClient.connectionParameters.ssl.rejectUnauthorized, true);
});

test('a real TLS handshake to the fixture certificate succeeds only when the CA is trusted', async () => {
  const server = tls.createServer({ key: TEST_KEY, cert: TEST_CERT }, socket => socket.end('ok'));
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  const connect = options => new Promise((resolve, reject) => {
    const socket = tls.connect({ host: '127.0.0.1', port, timeout: 8000, ...options }, () => { socket.end(); resolve(socket.authorized); });
    socket.once('timeout', () => socket.destroy(new Error('TLS handshake timed out.')));
    socket.once('error', reject);
  });
  try {
    assert.equal(await connect(databaseSslOptions({ rootCert: TEST_CERT })), true);
    await assert.rejects(connect(databaseSslOptions({ rootCert: null })), error => {
      assert.match(String(error.code || error.message), /SELF_SIGNED|UNABLE_TO_VERIFY|DEPTH_ZERO/);
      return true;
    });
    // A host that was already fixed with NODE_EXTRA_CA_CERTS keeps working.
    process.env.NODE_EXTRA_CA_CERTS = TEST_CERT_PATH;
    try { assert.equal(await connect(databaseSslOptions({ rootCert: null })), true); }
    finally { delete process.env.NODE_EXTRA_CA_CERTS; }
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('NODE_EXTRA_CA_CERTS roots stay trusted next to the project CA', () => {
  // An explicit ca list replaces Node's default store, so LIFEGEN re-adds this file itself.
  assert.deepEqual(extraRootCertificates(undefined), []);
  assert.deepEqual(extraRootCertificates('/nonexistent/lifegen-ca.pem'), []);
  process.env.NODE_EXTRA_CA_CERTS = TEST_CERT_PATH;
  try {
    assert.deepEqual(extraRootCertificates(), [TEST_CERT + '\n']);
    const store = databaseTrustStore({ rootCert: TEST_CERT });
    assert.deepEqual(store, [TEST_CERT, ...tls.rootCertificates, TEST_CERT + '\n']);
    const connection = connectionOptions(direct, { rootCert: TEST_CERT });
    assert.equal(connection.ssl.rejectUnauthorized, true);
    assert.equal(connection.ssl.ca.length, tls.rootCertificates.length + 2);
  } finally {
    delete process.env.NODE_EXTRA_CA_CERTS;
  }
  assert.equal(databaseTrustStore({ rootCert: TEST_CERT }).length, tls.rootCertificates.length + 1);
});

test('the migration and health paths explain the two common connection failures', () => {
  const expired = Object.assign(new Error('self-signed certificate in certificate chain'), { code: 'SELF_SIGNED_CERT_IN_CHAIN' });
  assert.match(connectionHint(expired), /DATABASE_SSL_ROOT_CERT/);
  const unreachable = Object.assign(new Error('connect ENETUNREACH 2600:1f18::1:5432'), { code: 'ENETUNREACH' });
  assert.match(connectionHint(unreachable), /Session Pooler URL on port 5432/);
  assert.equal(connectionHint(new Error('relation "people" does not exist')), null);
});

test('the deployment helper forwards the CA as a sensitive variable and rejects a broken one', () => {
  const variables = supabaseDeploymentVariables({
    DATABASE_URL: pooled, DATABASE_DIRECT_URL: session, DATABASE_SSL_ROOT_CERT: TEST_CERT, SETUP_KEY: 's'.repeat(40),
  });
  const entry = variables.find(v => v.key === 'DATABASE_SSL_ROOT_CERT');
  assert.deepEqual(entry, { key: 'DATABASE_SSL_ROOT_CERT', value: TEST_CERT, type: 'sensitive', target: ['production', 'preview'] });

  const withoutCa = supabaseDeploymentVariables({ DATABASE_URL: pooled, DATABASE_DIRECT_URL: session });
  assert.equal(withoutCa.some(v => v.key === 'DATABASE_SSL_ROOT_CERT'), false);
  assert.equal(new Set(withoutCa.map(v => v.key)).size, withoutCa.length);

  assert.throws(() => supabaseDeploymentVariables({ DATABASE_URL: pooled, DATABASE_DIRECT_URL: session, DATABASE_SSL_ROOT_CERT: 'oops' }), /PEM-encoded Supabase project CA/);
});

test('publishing sends DATABASE_SSL_ROOT_CERT to Vercel and no secret is returned', async () => {
  const workspace = await fsp.mkdtemp(path.join(os.tmpdir(), 'lifegen-tls-'));
  const zipPath = path.join(workspace, 'LIFEGEN-Vercel-Deploy.zip');
  const archive = zipSync({
    'package.json': strToU8(JSON.stringify({ name: 'lifegen-neon', version: '2.2.11', dependencies: { express: '5.2.1' } })),
    'package-lock.json': strToU8('{}'),
    'vercel.json': strToU8(JSON.stringify({ framework: 'express', outputDirectory: null })),
    'src/app.js': strToU8('export default {};\n'),
    'public/lifegen/index.html': strToU8('<!doctype html><title>LIFEGEN</title>'),
    'public/admin/index.html': strToU8('<!doctype html><title>LIFEGEN Admin</title>'),
    'database/001_init.sql': strToU8('SELECT 1;\n'),
    'scripts/migrate.mjs': strToU8('// migration entry point\n'),
  });
  await fsp.writeFile(zipPath, Buffer.from(archive));

  const publish = async env => {
    const calls = [];
    const fetchImpl = async (url, init = {}) => {
      const pathname = new URL(url).pathname;
      calls.push({ pathname, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null });
      const data = pathname === '/v2/teams' ? { teams: [] }
        : pathname === '/v10/projects' ? { projects: [{ id: 'prj_lifegen', name: 'lifegen', accountId: 'personal' }] }
        : pathname === '/v13/deployments' ? { id: 'dpl_lifegen', readyState: 'QUEUED', url: 'lifegen.vercel.app' }
        : {};
      return new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const service = createDeploymentService({ fetchImpl, approvedZipPaths: [zipPath], config: () => env });
    await service.connect('session-1', 'vercel_token_123456');
    const uploaded = await service.upload('session-1', Buffer.from(archive));
    const result = await service.publish('session-1', { project_id: 'prj_lifegen', archive_hash: uploaded.hash, confirm: true });
    return { calls, result };
  };

  try {
    const withCa = await publish({ DATABASE_URL: pooled, DATABASE_DIRECT_URL: session, DATABASE_SSL_ROOT_CERT: TEST_CERT, SETUP_KEY: 's'.repeat(40) });
    const environment = withCa.calls.find(call => call.pathname === '/v10/projects/prj_lifegen/env');
    assert.equal(environment.method, 'POST');
    const entry = environment.body.find(variable => variable.key === 'DATABASE_SSL_ROOT_CERT');
    assert.equal(entry.value, TEST_CERT);
    assert.equal(entry.type, 'sensitive');
    assert.equal(entry.target.includes('production'), true);
    assert.equal(withCa.result.environment_saved, true);

    const withoutCa = await publish({ DATABASE_URL: pooled, DATABASE_DIRECT_URL: session });
    const environmentWithoutCa = withoutCa.calls.find(call => call.pathname === '/v10/projects/prj_lifegen/env');
    assert.equal(environmentWithoutCa.body.some(variable => variable.key === 'DATABASE_SSL_ROOT_CERT'), false);
    assert.doesNotMatch(JSON.stringify(withoutCa.result), /secret/);
  } finally {
    await fsp.rm(workspace, { recursive: true, force: true });
  }
});

test('server code never disables TLS certificate verification', () => {
  const roots = ['src', 'scripts'];
  const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]);
  // scripts/check.mjs is the scanner that enforces this rule, so its own pattern is skipped.
  const files = roots.flatMap(walk).filter(file => /\.m?js$/.test(file) && file !== path.join('scripts', 'check.mjs'));
  assert.ok(files.length > 15);
  for (const file of files) {
    const code = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(code, /NODE_TLS_REJECT_UNAUTHORIZED/, `${file} must not disable TLS verification`);
    assert.doesNotMatch(code, /rejectUnauthorized\s*[:=]\s*false/, `${file} must not disable TLS verification`);
  }
});
