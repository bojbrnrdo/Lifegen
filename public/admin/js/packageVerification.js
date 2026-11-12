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

// Inventory ZIP central-directory entries without decompressing or executing files.
// Reject unsupported archive structures and paths before considering a future import.
export function inspectPackageZip(zipBytes, selectedPaths=[]){
 if(!(zipBytes instanceof Uint8Array)||zipBytes.length<22||zipBytes.length>50*1024*1024)
  throw Error('Invalid ZIP size.');
 const view=new DataView(zipBytes.buffer,zipBytes.byteOffset,zipBytes.byteLength);
 const u16=i=>view.getUint16(i,true),u32=i=>view.getUint32(i,true);
 let end=-1;
 for(let i=zipBytes.length-22;i>=Math.max(0,zipBytes.length-22-65535);i--){
  if(u32(i)===0x06054b50&&i+22+u16(i+20)===zipBytes.length){end=i;break;}
 }
 if(end<0)throw Error('ZIP central directory was not found.');
 const count=u16(end+10),length=u32(end+12),offset=u32(end+16);
 if(u16(end+4)!==0||u16(end+6)!==0||u16(end+8)!==count||
    count===65535||length===0xffffffff||offset===0xffffffff)
  throw Error('Multi-disk or ZIP64 archives are not supported.');
 if(count<1||count>3000||offset+length>end)
  throw Error('ZIP has an invalid or excessive entry count.');
 const decoder=new TextDecoder('utf-8',{fatal:true}),files=[],seen=new Set(),entryRanges=[];
 let cursor=offset,totalUncompressed=0;
 for(let n=0;n<count;n++){
  if(cursor+46>offset+length||u32(cursor)!==0x02014b50)
   throw Error('Invalid ZIP file directory.');
  const flags=u16(cursor+8),method=u16(cursor+10),size=u32(cursor+24);
  const compressed=u32(cursor+20),versionNeeded=u16(cursor+6);
  const nameLength=u16(cursor+28),extra=u16(cursor+30),comment=u16(cursor+32);
  const extAttr=u32(cursor+38),localOffset=u32(cursor+42);
  const next=cursor+46+nameLength+extra+comment;
  if(next>offset+length||localOffset+30>offset||u32(localOffset)!==0x04034b50)throw Error('Invalid ZIP entry bounds.');
  const localFlags=u16(localOffset+6),localMethod=u16(localOffset+8);
  const localNameLength=u16(localOffset+26),localExtraLength=u16(localOffset+28);
  const dataStart=localOffset+30+localNameLength+localExtraLength;
  if(versionNeeded>45||flags!==localFlags||method!==localMethod||
     localNameLength!==nameLength||dataStart+compressed>offset||
     compressed===0&&size!==0||method===0&&compressed!==size||
     size>0&&compressed>0&&size/compressed>200||
     u32(cursor+24)===0xffffffff||compressed===0xffffffff)
   throw Error('ZIP local header, compression ratio or file bounds are invalid.');
  const crc=u32(cursor+16),dataEnd=dataStart+compressed;
  if(flags&8){
   // Streaming ZIP producers, including git archive, can put CRC and lengths
   // into a trailing descriptor rather than the local file header.
   const signature=dataEnd+4<=offset&&u32(dataEnd)===0x08074b50;
   const descriptor=dataEnd+(signature?4:0);
   if(descriptor+12>offset||u32(descriptor)!==crc||
      u32(descriptor+4)!==compressed||u32(descriptor+8)!==size)
    throw Error('ZIP data descriptor does not agree with the central directory.');
   entryRanges.push([localOffset,descriptor+12]);
  }else{
   if(u32(localOffset+14)!==crc||u32(localOffset+18)!==compressed||
      u32(localOffset+22)!==size)
    throw Error('ZIP local CRC or file sizes differ from the central directory.');
   entryRanges.push([localOffset,dataEnd]);
  }
  // The two ZIP headers must describe the same file path; otherwise tools
  // may extract a different file from the one the review interface displays.
  for(let j=0;j<nameLength;j++){
   if(zipBytes[localOffset+30+j]!==zipBytes[cursor+46+j])
    throw Error('ZIP local filename differs from the central directory.');
  }
  if(!(flags===0||flags===8||flags===0x800||flags===0x808))
   throw Error('ZIP flags contain unsupported features.');
  let name;
  try{name=decoder.decode(zipBytes.subarray(cursor+46,cursor+46+nameLength));}
  catch{throw Error('Invalid ZIP filename encoding.');}
  const directory=name.endsWith('/'),path=directory?name.slice(0,-1):name;
  if(!path||path.length>240||path.startsWith('/')||path.includes('\\')||
     !/^[A-Za-z0-9._/-]+$/.test(path)||
     path.split('/').some(part=>!part||part==='.'||part==='..')||
     seen.has(path)||flags&1||![0,8].includes(method))
   throw Error('ZIP contains an unsafe, encrypted, duplicate or unsupported entry: '+name.slice(0,100));
  const unixMode=(extAttr>>>16)&0xffff;
  if((unixMode&0xf000)===0xa000||((unixMode&0xf000)!==0&&
    (unixMode&0xf000)!==0x8000&&(unixMode&0xf000)!==0x4000))
   throw Error('ZIP contains an unsupported link or special file.');
  if(size>50*1024*1024||totalUncompressed+size>200*1024*1024)
   throw Error('ZIP entries exceed safe inspection size limits.');
  seen.add(path);totalUncompressed+=size;
  if(!directory)files.push({path,size});
  cursor=next;
 }
 if(cursor!==offset+length)throw Error('ZIP central directory length mismatch.');
 // Reject overlapping local file data ranges. File inventory views should
 // never accept one local archive member nested within another.
 entryRanges.sort((a,b)=>a[0]-b[0]);
 for(let i=1;i<entryRanges.length;i++)
  if(entryRanges[i][0]<entryRanges[i-1][1])
   throw Error('ZIP local file entries overlap.');

 if(selectedPaths.length){
  const expected=new Set(selectedPaths);
  if(files.length!==expected.size||files.some(file=>!expected.has(file.path)))
   throw Error('ZIP file inventory does not match the selected paths in the manifest.');
 }
 return {files,totalUncompressed};
}
