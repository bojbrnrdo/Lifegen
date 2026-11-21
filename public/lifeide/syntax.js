/* LifeIDE safe, dependency-free syntax mirror. The textarea is the source of truth. */
(function(root){
'use strict';
const escapeHTML=text=>String(text).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const KEYWORDS=new Set('async await break case catch class const continue default delete do else export extends finally for from function if import in instanceof interface let new of private protected public return static super switch this throw try type typeof var void while with yield as implements namespace readonly declare abstract def elif except lambda pass raise self and or not is global nonlocal SELECT FROM WHERE INSERT INTO UPDATE DELETE CREATE TABLE JOIN LEFT RIGHT INNER OUTER ON GROUP ORDER BY LIMIT AS NULL NOT AND OR VALUES SET PRIMARY KEY'.split(' '));
const LITERALS=new Set(['true','false','null','undefined','NaN','Infinity','None','True','False']);
const EXT={js:'code',mjs:'code',cjs:'code',jsx:'code',ts:'code',tsx:'code',py:'code',json:'json',jsonc:'code',html:'markup',htm:'markup',xml:'markup',svg:'markup',css:'css',scss:'css',sql:'sql',md:'markdown',mdx:'markdown',yml:'config',yaml:'config',sh:'config',bash:'config',zsh:'config',vue:'markup',svelte:'markup'};
function language(path){const name=String(path||'').toLowerCase().split('/').pop();return EXT[name.split('.').pop()]||(/^(?:dockerfile|makefile|\.env(?:\..*)?)$/.test(name)?'config':'plain');}
const color=(role,part)=>'<span class="syn-'+role+'">'+escapeHTML(part)+'</span>';
function tokenize(text,kind){
 let pattern=/\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\[\s\S]|[^"\\])*"?|'(?:\\[\s\S]|[^'\\])*'?|\x60(?:\\[\s\S]|[^\x60\\])*\x60?|\b(?:0x[\da-fA-F]+|\d+(?:\.\d+)?)\b|\b[A-Za-z_$][\w$]*\b/g;
 if(kind==='json')pattern=/"(?:\\[\s\S]|[^"\\])*"?|\b(?:true|false|null|\d+(?:\.\d+)?)\b/g;
 if(kind==='sql')pattern=/--[^\n]*|'(?:''|[^'])*'?|\b\d+(?:\.\d+)?\b|\b[A-Za-z_]\w*\b/g;
 if(kind==='config')pattern=/#[^\n]*|"(?:\\.|[^"\\])*"?|'(?:\\.|[^'\\])*'?|\b\d+(?:\.\d+)?\b|\b[A-Za-z_]\w*\b/g;
 let out='',index=0,match;
 while((match=pattern.exec(text))){
  const word=match[0];out+=escapeHTML(text.slice(index,match.index));
  let role='';
  if(word.startsWith('/*')||word.startsWith('//')||word.startsWith('#')||word.startsWith('--'))role='comment';
  else if(/^["'\x60]/.test(word))role='string';
  else if(/^(?:0x[\da-fA-F]+|\d+(?:\.\d+)?)$/.test(word))role='number';
  else if(LITERALS.has(word))role='literal';
  else if(KEYWORDS.has(word)||KEYWORDS.has(word.toUpperCase())&&kind==='sql')role='keyword';
  else if(/^[A-Za-z_$]/.test(word)&&/^\s*\(/.test(text.slice(pattern.lastIndex)))role='function';
  out+=role?color(role,word):escapeHTML(word);index=pattern.lastIndex;
 }
 return out+escapeHTML(text.slice(index));
}
function highlight(value,path){
 const text=String(value||''),kind=language(path);
 if(text.length>250000||kind==='plain')return escapeHTML(text);
 if(kind==='markup')return text.split(/(<!--[\s\S]*?-->|<\/?[A-Za-z][^>]*>)/g).map(p=>p.startsWith('<!--')?color('comment',p):/^<\/?[A-Za-z]/.test(p)?color('tag',p):escapeHTML(p)).join('');
 if(kind==='markdown')return text.split('\n').map(p=>/^#{1,6}\s/.test(p)?color('keyword',p):escapeHTML(p)).join('\n');
 if(kind==='css')return text.split(/(\/\*[\s\S]*?\*\/|#[a-fA-F0-9]{3,8}\b|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/g).map(p=>p.startsWith('/*')?color('comment',p):/^#[a-fA-F0-9]{3,8}$/.test(p)?color('number',p):/^["']/.test(p)?color('string',p):escapeHTML(p).replace(/\b([a-z-]+)(?=\s*:)/gi,'<span class="syn-keyword">$1</span>')).join('');
 return tokenize(text,kind);
}
function mount(editor){
 if(!editor||editor.dataset.syntaxMounted)return;
 const parent=editor.parentElement,surface=document.createElement('div'),mirror=document.createElement('pre');
 surface.className='code-surface';mirror.className='syntax-layer';mirror.setAttribute('aria-hidden','true');
 parent.insertBefore(surface,editor);surface.append(mirror,editor);
 editor.dataset.syntaxMounted='true';editor.setAttribute('wrap','off');parent.classList.add('syntax-enabled');
 const syncScroll=()=>{mirror.scrollTop=editor.scrollTop;mirror.scrollLeft=editor.scrollLeft;};
 let pending=false;
 const render=()=>{pending=false;mirror.innerHTML=highlight(editor.value,document.getElementById('fileTitle')?.textContent||'')+'\n';mirror.style.fontSize=getComputedStyle(editor).fontSize;syncScroll();};
 const schedule=()=>{if(!pending){pending=true;requestAnimationFrame(render);}};
 editor.addEventListener('input',schedule);editor.addEventListener('scroll',syncScroll);
 root.lifeideHighlight=schedule;render();
}
root.LifeIDESyntax={escapeHTML,highlight,language,mount};
if(typeof module!=='undefined'&&module.exports)module.exports=root.LifeIDESyntax;
if(typeof document!=='undefined'){if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>mount(document.getElementById('editor')));else mount(document.getElementById('editor'));}
})(typeof window!=='undefined'?window:globalThis);
