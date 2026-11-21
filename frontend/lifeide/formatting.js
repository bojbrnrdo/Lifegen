// Pure formatting operations shared by the editor and automated tests.
export function convertLeadingTabs(text,spaces=4){
 let changed=0;
 const content=String(text).replace(/^(\s*\t[\t ]*)/gm,indent=>{
  // Change only indentation, never tabs inside code or strings.
  changed++;
  return indent.replace(/\t/g,' '.repeat(spaces));
 });
 return {content,changed};
}
export function longLines(text,limit=80){
 return String(text).split('\n').flatMap((line,i)=>line.length>limit?[{line:i+1,length:line.length}]:[]);
}
export function jsonDiagnostic(text){
 try{JSON.parse(String(text));return null;}
 catch(error){return {message:'Invalid JSON: '+error.message};}
}
