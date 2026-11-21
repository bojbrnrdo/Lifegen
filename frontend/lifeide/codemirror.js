import {EditorState,Compartment} from '@codemirror/state';
import {EditorView,keymap,lineNumbers,highlightActiveLine,highlightActiveLineGutter,drawSelection,highlightSpecialChars} from '@codemirror/view';
import {defaultKeymap,history,historyKeymap,indentWithTab} from '@codemirror/commands';
import {indentOnInput,indentUnit,syntaxTree,bracketMatching,foldGutter,foldKeymap,syntaxHighlighting,defaultHighlightStyle} from '@codemirror/language';
import {closeBrackets,closeBracketsKeymap,autocompletion,completionKeymap} from '@codemirror/autocomplete';
import {searchKeymap,highlightSelectionMatches} from '@codemirror/search';
import {javascript} from '@codemirror/lang-javascript';
import {json} from '@codemirror/lang-json';
import {html} from '@codemirror/lang-html';
import {css} from '@codemirror/lang-css';
import {python} from '@codemirror/lang-python';
import {markdown} from '@codemirror/lang-markdown';
import {sql} from '@codemirror/lang-sql';
import {xml} from '@codemirror/lang-xml';
import {yaml} from '@codemirror/lang-yaml';
import {php} from '@codemirror/lang-php';
import {oneDark,oneDarkHighlightStyle} from '@codemirror/theme-one-dark';
import {linter,lintGutter,openLintPanel} from '@codemirror/lint';
import {convertLeadingTabs,longLines,jsonDiagnostic} from './formatting.js';

// Bridge CodeMirror 6 to LifeIDE's existing save, draft and file APIs.
// The hidden textarea remains the compatibility data source, never the UI.
const textarea=document.getElementById('editor');
const fileTitle=document.getElementById('fileTitle');
const wrap=document.getElementById('editorWrap');
if(textarea&&fileTitle&&wrap){
 const originalValue=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value');
 const editable=new Compartment(),language=new Compartment(),wrapping=new Compartment();
 let wrapEnabled=false,lastLongLine=0;
 let syncing=false;
 const extensionFor=name=>{
  const ext=String(name||'').split('/').pop().split('.').pop().toLowerCase();
  try{
   switch(ext){
    case 'js':case 'mjs':case 'cjs':return javascript();
    case 'jsx':return javascript({jsx:true});
    case 'ts':return javascript({typescript:true});
    case 'tsx':return javascript({typescript:true,jsx:true});
    case 'json':case 'jsonc':return json();
    case 'html':case 'htm':case 'vue':case 'svelte':return html();
    case 'css':case 'scss':return css();
    case 'py':return python();
    case 'md':case 'mdx':return markdown();
    case 'sql':return sql();
    case 'xml':case 'svg':return xml();
    case 'yml':case 'yaml':return yaml();
    case 'php':return php();
    default:return [];
   }
  }catch(err){console.warn('LifeIDE CodeMirror language unavailable',err);return [];}
 };
 const host=document.createElement('div');host.className='cm-host';
 const view=new EditorView({
  parent:host,
  state:EditorState.create({
   doc:textarea.value,
   extensions:[
    lineNumbers(),highlightActiveLineGutter(),highlightSpecialChars(),history(),foldGutter(),drawSelection(),lintGutter(),indentUnit.of('    '),
    indentOnInput(),bracketMatching(),closeBrackets(),autocompletion(),highlightActiveLine(),highlightSelectionMatches(),
    syntaxHighlighting(defaultHighlightStyle,{fallback:true}),syntaxHighlighting(oneDarkHighlightStyle),
    editable.of(EditorView.editable.of(!textarea.disabled)),language.of(extensionFor(fileTitle.textContent)),wrapping.of([]),oneDark,
    linter(v=>{
     const name=fileTitle.textContent.toLowerCase(),doc=v.state.doc.toString();
     if(/\.(?:json|jsonc)$/.test(name)){
      const issue=jsonDiagnostic(doc);
      return issue?[{from:0,to:Math.min(1,doc.length),severity:'error',message:issue.message}]:[];
     }
     if(!/\.(?:js|jsx|mjs|cjs|ts|tsx|css|html|htm|xml|svg|py|php|sql|yml|yaml)$/.test(name))return [];
     const problems=[];const tree=syntaxTree(v.state);
     tree.iterate({enter(node){if(node.type.isError&&problems.length<20){const from=Math.min(node.from,doc.length),to=Math.max(from,Math.min(node.to,doc.length));problems.push({from,to,severity:'error',message:'Syntax parser found an unexpected token or incomplete construct.'});}}});
     return problems;
    },{delay:450}),
    EditorView.updateListener.of(update=>{
     if(syncing)return;
     if(update.docChanged){
      originalValue.set.call(textarea,update.state.doc.toString());
      textarea.dispatchEvent(new Event('input',{bubbles:true}));
     }
     if(update.selectionSet||update.docChanged){
      const sel=update.state.selection.main;
      textarea.setSelectionRange(sel.from,sel.to);
      const line=update.state.doc.lineAt(sel.head);
      const pos=document.getElementById('position');
      if(pos)pos.textContent='Ln '+line.number+', Col '+(sel.head-line.from+1);
     }
    }),
    keymap.of([
     {key:'Mod-s',run:()=>{document.getElementById('saveFile')?.click();return true;}},
     ...closeBracketsKeymap,...defaultKeymap,...searchKeymap,...historyKeymap,...foldKeymap,...completionKeymap,indentWithTab
    ])
   ]
  })
 });
 wrap.appendChild(host);
 Object.defineProperty(textarea,'value',{
  configurable:true,
  get(){return originalValue.get.call(this);},
  set(next){
   const content=String(next??'');
   originalValue.set.call(this,content);
   if(view.state.doc.toString()===content)return;
   syncing=true;
   try{view.dispatch({changes:{from:0,to:view.state.doc.length,insert:content},selection:{anchor:0}});}
   finally{syncing=false;}
  }
 });
 const syncEditable=()=>{
  view.dispatch({effects:editable.reconfigure(EditorView.editable.of(!textarea.disabled))});
  view.dom.style.fontSize=textarea.style.fontSize||'14px';
 };
 const syncLanguage=()=>view.dispatch({effects:language.reconfigure(extensionFor(fileTitle.textContent))});
 const obs=new MutationObserver(records=>{
  if(records.some(x=>x.target===fileTitle))syncLanguage();
  if(records.some(x=>x.target===textarea))syncEditable();
 });
 obs.observe(fileTitle,{childList:true,characterData:true,subtree:true});
 obs.observe(textarea,{attributes:true,attributeFilter:['disabled','style']});
 textarea.focus=()=>view.focus();
 Object.defineProperty(textarea,'scrollTop',{
  configurable:true,get(){return view.scrollDOM.scrollTop;},set(n){view.scrollDOM.scrollTop=n;}
 });
 Object.defineProperty(textarea,'scrollLeft',{
  configurable:true,get(){return view.scrollDOM.scrollLeft;},set(n){view.scrollDOM.scrollLeft=n;}
 });
 const lines=document.getElementById('lineNumbers');
 if(lines)lines.style.display='none';
 wrap.classList.add('cm-active');
 syncEditable();syncLanguage();
 const report=message=>{const el=document.getElementById('formatMessage');if(el)el.textContent=message;};
 const canEdit=()=>!textarea.disabled&&view.state.readOnly===false;
 const tabAction=document.getElementById('formatTabs');
 tabAction?.addEventListener('click',()=>{
  if(!canEdit()){report('Open an editable file first.');return;}
  const result=convertLeadingTabs(view.state.doc.toString(),4);
  if(result.changed){view.dispatch({changes:{from:0,to:view.state.doc.length,insert:result.content}});report('Converted tabs on '+result.changed+' line(s). Save to keep the changes.');}
  else report('No leading tabs to convert.');
  view.focus();
 });
 document.getElementById('formatLongLine')?.addEventListener('click',()=>{
  const lines=longLines(view.state.doc.toString(),80);
  if(!lines.length){report('No lines over 80 characters.');return;}
  const next=lines.find(x=>x.line>lastLongLine)||lines[0];lastLongLine=next.line;
  const line=view.state.doc.line(next.line);
  view.dispatch({selection:{anchor:line.from,head:line.to},scrollIntoView:true});view.focus();
  report('Line '+next.line+' has '+next.length+' characters (80 recommended).');
 });
 document.getElementById('formatLint')?.addEventListener('click',()=>{
  openLintPanel(view);report('Syntax diagnostics are shown in the editor.');view.focus();
 });
 document.getElementById('formatWrap')?.addEventListener('click',event=>{
  wrapEnabled=!wrapEnabled;
  view.dispatch({effects:wrapping.reconfigure(wrapEnabled?EditorView.lineWrapping:[])});
  event.currentTarget.textContent='Wrap: '+(wrapEnabled?'On':'Off');
  event.currentTarget.setAttribute('aria-pressed',String(wrapEnabled));
  report(wrapEnabled?'Long lines are wrapped.':'Long lines are not wrapped.');view.focus();
 });
 const formatButtons=['formatTabs','formatLongLine','formatLint','formatWrap'].map(id=>document.getElementById(id));
 const updateControls=()=>{formatButtons.forEach(btn=>{if(btn)btn.disabled=textarea.disabled;});};
 updateControls();
 const controlObserver=new MutationObserver(updateControls);
 controlObserver.observe(textarea,{attributes:true,attributeFilter:['disabled']});
 window.lifeideFormatting={convertLeadingTabs,longLines};
 window.lifeideCodeMirror=view;
 window.lifeideHighlight=()=>{};
}
