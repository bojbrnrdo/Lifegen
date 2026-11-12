import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,webcrypto} from 'node:crypto';
import {verifyPackageFiles} from '../public/admin/js/packageVerification.js';

const zip=new TextEncoder().encode('sample ZIP bytes for test only');
const sha=createHash('sha256').update(zip).digest('hex');
const sum=sha+'  LIFEGEN-source.zip\n';
const manifest={format:'lifegen-source-v1',source_branch:'feature/package-test',
 source_commit:'a'.repeat(40),mode:'selected-files',selected_paths:['src/example.js'],
 archive_file:'LIFEGEN-source.zip',sha256:sha};

test('Local package verification accepts matching SHA-256 and provenance',async()=>{
 if(!globalThis.crypto)globalThis.crypto=webcrypto;
 const result=await verifyPackageFiles(zip,sum,JSON.stringify(manifest));
 assert.equal(result.sha256,sha);
 assert.equal(result.branch,'feature/package-test');
 assert.equal(result.fileCount,1);
});

test('Local package verification rejects mismatched ZIP bytes',async()=>{
 if(!globalThis.crypto)globalThis.crypto=webcrypto;
 await assert.rejects(verifyPackageFiles(new TextEncoder().encode('tampered'),sum,JSON.stringify(manifest)),/SHA-256 mismatch/);
});

test('Local package verification rejects modified manifest and unsafe paths',async()=>{
 if(!globalThis.crypto)globalThis.crypto=webcrypto;
 await assert.rejects(verifyPackageFiles(zip,sum,JSON.stringify({...manifest,sha256:'b'.repeat(64)})),/checksum does not match/);
 await assert.rejects(verifyPackageFiles(zip,sum,JSON.stringify({...manifest,selected_paths:['../secret.txt']})),/Invalid selected-file metadata/);
 await assert.rejects(verifyPackageFiles(zip,sum,JSON.stringify({...manifest,source_branch:'main'})),/Invalid source branch/);
});

test('Local package verification rejects absent archive and malformed checksum',async()=>{
 if(!globalThis.crypto)globalThis.crypto=webcrypto;
 await assert.rejects(verifyPackageFiles(new Uint8Array(0),sum,JSON.stringify(manifest)),/nonempty ZIP/);
 await assert.rejects(verifyPackageFiles(zip,'invalid checksum',JSON.stringify(manifest)),/checksum does not match/);
});
