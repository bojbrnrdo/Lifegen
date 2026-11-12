import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,webcrypto} from 'node:crypto';
import {verifyPackageFiles,inspectPackageZip} from '../public/admin/js/packageVerification.js';

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

function makeStoredZip(path='src/example.js'){
 const name=Buffer.from(path);
 const local=Buffer.alloc(30+name.length);local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(20,4);
 local.writeUInt16LE(name.length,26);name.copy(local,30);
 const central=Buffer.alloc(46+name.length);central.writeUInt32LE(0x02014b50,0);
 central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);
 central.writeUInt16LE(name.length,28);name.copy(central,46);
 const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(1,8);
 end.writeUInt16LE(1,10);end.writeUInt32LE(central.length,12);end.writeUInt32LE(local.length,16);
 return new Uint8Array(Buffer.concat([local,central,end]));
}

test('ZIP inventory lists only safe files and matches selected export manifest',()=>{
 const inventory=inspectPackageZip(makeStoredZip(),['src/example.js']);
 assert.deepEqual(inventory.files,[{path:'src/example.js',size:0}]);
 assert.throws(()=>inspectPackageZip(makeStoredZip(),['src/other.js']),/does not match/);
});

test('ZIP inventory rejects directory traversal, invalid archives and duplicate filenames',()=>{
 assert.throws(()=>inspectPackageZip(makeStoredZip('../evil.js')),/unsafe/);
 assert.throws(()=>inspectPackageZip(makeStoredZip('/evil.js')),/unsafe/);
 assert.throws(()=>inspectPackageZip(makeStoredZip('file\\name.js')),/unsafe/);
 assert.throws(()=>inspectPackageZip(new Uint8Array(32)),/central directory/);
});

test('ZIP inventory rejects ZIP entry encryption and unsupported archive methods',()=>{
 const encrypted=makeStoredZip();const flags=new DataView(encrypted.buffer);
 const offset=encrypted.length-22-('src/example.js'.length+46);
 flags.setUint16(offset+8,1,true);
 assert.throws(()=>inspectPackageZip(encrypted),/unsafe|encrypted/);
 const method=makeStoredZip();const dv=new DataView(method.buffer);
 dv.setUint16(offset+10,99,true);
 assert.throws(()=>inspectPackageZip(method),/unsupported/);
});

test('ZIP inspector rejects mismatched filenames in local file header',()=>{
 const invalid=makeStoredZip('src/example.js');
 invalid[30]='x'.charCodeAt(0);
 assert.throws(()=>inspectPackageZip(invalid),/local filename differs/);
});

test('ZIP inspector rejects incompatible local header flags and methods',()=>{
 const flags=makeStoredZip();
 new DataView(flags.buffer).setUint16(6,1,true);
 assert.throws(()=>inspectPackageZip(flags),/local header/);
 const method=makeStoredZip();
 new DataView(method.buffer).setUint16(8,8,true);
 assert.throws(()=>inspectPackageZip(method),/local header/);
});

test('ZIP inspector rejects central directory file sizes beyond archive data',()=>{
 const invalid=makeStoredZip();
 const nameSize=Buffer.byteLength('src/example.js');
 const directory=invalid.byteLength-22-46-nameSize;
 const view=new DataView(invalid.buffer);
 view.setUint32(directory+20,500,true);
 view.setUint32(directory+24,500,true);
 assert.throws(()=>inspectPackageZip(invalid),/file bounds/);
});

function makeDescriptorZip({signed=true,corrupt=false}={}){
 const path='src/example.js',name=Buffer.from(path);
 const local=Buffer.alloc(30+name.length);local.writeUInt32LE(0x04034b50,0);
 local.writeUInt16LE(20,4);local.writeUInt16LE(8,6);local.writeUInt16LE(name.length,26);name.copy(local,30);
 const descriptor=Buffer.alloc(signed?16:12);
 const crcAt=signed?4:0;
 if(signed)descriptor.writeUInt32LE(0x08074b50,0);
 descriptor.writeUInt32LE(corrupt?23:0,crcAt);
 const central=Buffer.alloc(46+name.length);central.writeUInt32LE(0x02014b50,0);
 central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt16LE(8,8);
 central.writeUInt16LE(name.length,28);name.copy(central,46);
 const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(1,8);
 end.writeUInt16LE(1,10);end.writeUInt32LE(central.length,12);
 end.writeUInt32LE(local.length+descriptor.length,16);
 return new Uint8Array(Buffer.concat([local,descriptor,central,end]));
}

test('ZIP inspector accepts signed and unsigned streaming descriptors',()=>{
 for(const signed of [true,false]){
  const result=inspectPackageZip(makeDescriptorZip({signed}),['src/example.js']);
  assert.equal(result.files.length,1);
 }
});

test('ZIP inspector rejects forged streaming descriptors and incorrect local CRC',()=>{
 assert.throws(()=>inspectPackageZip(makeDescriptorZip({corrupt:true})),/descriptor/);
 const bad=makeStoredZip();
 const view=new DataView(bad.buffer);
 view.setUint32(14,12345,true);
 assert.throws(()=>inspectPackageZip(bad),/CRC/);
});
