const fs = require('fs');
const Babel = require('@babel/standalone');
const src = fs.readFileSync(require('path').join(__dirname, '..', '..', 'preview-src.js'), 'utf8');
try {
  const res = Babel.transform(src, {
    presets: [['react', {}], ['typescript', { allExtensions: true, isTSX: true }]],
    filename: 'preview.tsx',
    sourceType: 'unambiguous'
  });
  console.log('TRANSPILE OK, output length:', res.code.length);
  // Now try to eval to check runtime parse errors. Stub out window/document.
  const sandbox = { window:{__mkStub:()=>({}),__s_next_link:{},__s_next_router:{},__s_next_head:{},__s_next_image:{},__s_next_script:{},__s_next_dynamic:{},__s_next_app:{},__s_next_navigation:{},__s_react_redux:{Provider:(p)=>p.children,useSelector:()=>undefined,useDispatch:()=>()=>{},connect:()=>(C)=>C},__s__reduxjs_toolkit:{configureStore:()=>({getState:()=>({}),dispatch:()=>{}}),createSlice:()=>({actions:{},reducer:()=>({})}),createAsyncThunk:(t)=>Object.assign(()=>({}),{pending:{type:t+'/pending'},fulfilled:{type:t+'/fulfilled'},rejected:{type:t+'/rejected'}})},__s_redux:{createStore:()=>({})}}, document:{getElementById:()=>null}, React:{createElement:()=>null,useState:()=>[null,()=>{}],useEffect:()=>{},useSelector:()=>undefined,Children:{toArray:()=>[]}}, ReactDOM:{createRoot:()=>({render:()=>{}})}, console };
  try { new Function('window','document','React','ReactDOM','console', res.code)(sandbox.window,sandbox.document,sandbox.React,sandbox.ReactDOM,sandbox.console); console.log('RUNTIME OK'); } catch(e) { console.log('RUNTIME ERROR:', e.message); const lines = res.code.split('\n'); const m = e.stack && e.stack.match(/<anonymous>:(\d+):(\d+)/); if (m) { const ln = parseInt(m[1],10); console.log('Error context:'); for (let i=Math.max(0,ln-3); i<Math.min(lines.length,ln+2); i++) console.log((i+1===ln?'>':' ')+' '+(i+1)+': '+lines[i]); } }
} catch(e) { console.log('TRANSPILE ERROR:', e.message); }
