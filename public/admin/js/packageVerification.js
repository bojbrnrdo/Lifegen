// Offline integrity check for LIFEGEN package exports. No uploads or deployment.
export async function verifyPackageFiles(zipBytes, checksumText, manifestText){
 if(!(zipBytes instanceof Uint8Array)||!zipBytes.length||zipBytes.byteLength>50*1024*1024)
  throw Error('Choose a nonempty ZIP file of at most 50 MB.');
 if(typeof checksumText!=='string'||checksumText.length>4096||typeof manifestText!=='string'||manifestText.length>65536)
  throw Error('Checksum or manifest file is missing or too large.');
 let manifest;
 try{manifest=JSON.parse(manifestText);}catch{throw Error('Package manifest is not valid JSON.');}
 if(!manifest||manifest.format!=='lifegen-source-v1'||manifest.archive_file!=='LIFEGEN-source.zip')
  throw Error('Unrecognized LIFEGEN source package manifest.');
 if(!/^(develop|(?:feature|fix)\/[A-Za-z0-9._-]{1,90})$/.test(manifest.source_branch||'')||
    !/^[a-f0-9]{40}$/.test(manifest.source_commit||'')||
    !['full-source','selected-files'].includes(manifest.mode))
  throw Error('Invalid source branch, commit or export mode.');
 if(!Array.isArray(manifest.selected_paths)||manifest.selected_paths.length>40||
    (manifest.mode==='full-source'&&manifest.selected_paths.length!==0)||
    (manifest.mode==='selected-files'&&manifest.selected_paths.length===0)||
    new Set(manifest.selected_paths).size!==manifest.selected_paths.length||
    manifest.selected_paths.some(p=>typeof p!=='string'||p.length>200||
      !/^[A-Za-z0-9._/-]+$/.test(p)||p.startsWith('/')||
      p.split('/').some(x=>!x||x==='.'||x==='..')))
  throw Error('Invalid selected-file metadata.');
 const match=checksumText.trim().match(/^([a-f0-9]{64})  LIFEGEN-source\.zip$/);
 if(!match||!/^[a-f0-9]{64}$/.test(manifest.sha256||'')||match[1]!==manifest.sha256)
  throw Error('Package checksum does not match the manifest.');
 if(!globalThis.crypto?.subtle)throw Error('Secure browser crypto is unavailable.');
 const hash=await globalThis.crypto.subtle.digest('SHA-256',zipBytes);
 const calculated=Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('');
 if(calculated!==match[1])throw Error('ZIP SHA-256 mismatch. The package may have changed or become corrupted.');
 return {branch:manifest.source_branch,commit:manifest.source_commit,
  mode:manifest.mode,fileCount:manifest.selected_paths.length,sha256:calculated};
}
