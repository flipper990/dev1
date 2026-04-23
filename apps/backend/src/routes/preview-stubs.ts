// CDN library list and HTML stubs for the browser-based React preview renderer.

export interface CdnLib {
  pkg: string;
  cdn: string;
  global: string;
}

export const CDN_LIBS: CdnLib[] = [
  { pkg: 'yup',                   cdn: 'https://cdn.jsdelivr.net/npm/yup@0.32.11/dist/yup.umd.js',                                        global: 'Yup'           },
  { pkg: 'axios',                 cdn: 'https://cdn.jsdelivr.net/npm/axios@1.7.2/dist/axios.min.js',                                       global: 'axios'         },
  { pkg: 'react-hook-form',       cdn: 'https://cdn.jsdelivr.net/npm/react-hook-form@7.51.5/dist/index.umd.min.js',                        global: 'ReactHookForm' },
  { pkg: 'zod',                   cdn: 'https://cdn.jsdelivr.net/npm/zod@3.22.4/lib/umd.js',                                              global: 'Zod'           },
  { pkg: 'lucide-react',          cdn: 'https://cdn.jsdelivr.net/npm/lucide-react@0.390.0/dist/umd/lucide-react.min.js',                   global: 'LucideReact'   },
  { pkg: 'framer-motion',         cdn: 'https://cdn.jsdelivr.net/npm/framer-motion@10.18.0/dist/framer-motion.js',                        global: 'Motion'        },
  { pkg: 'recharts',              cdn: 'https://cdn.jsdelivr.net/npm/recharts@2.12.7/umd/Recharts.js',                                    global: 'Recharts'      },
  { pkg: 'date-fns',              cdn: 'https://cdn.jsdelivr.net/npm/date-fns@2.30.0/date_fns/index.js',                                  global: 'dateFns'       },
  { pkg: 'chart.js',              cdn: 'https://cdn.jsdelivr.net/npm/chart.js@4.4.3/dist/chart.umd.min.js',                              global: 'Chart'         },
  { pkg: 'react-chartjs-2',       cdn: 'https://cdn.jsdelivr.net/npm/react-chartjs-2@5.2.0/dist/index.umd.min.js',                       global: 'ReactChartJS2' },
  { pkg: 'clsx',                  cdn: 'https://cdn.jsdelivr.net/npm/clsx@2.1.1/dist/clsx.min.js',                                       global: 'clsx'          },
  { pkg: 'classnames',            cdn: 'https://cdn.jsdelivr.net/npm/classnames@2.5.1/index.js',                                         global: 'classNames'    },
  { pkg: 'lodash',                cdn: 'https://cdn.jsdelivr.net/npm/lodash@4.17.21/lodash.min.js',                                      global: '_'             },
  { pkg: 'moment',                cdn: 'https://cdn.jsdelivr.net/npm/moment@2.30.1/moment.min.js',                                       global: 'moment'        },
  { pkg: 'dayjs',                 cdn: 'https://cdn.jsdelivr.net/npm/dayjs@1.11.12/dayjs.min.js',                                        global: 'dayjs'         },
  { pkg: 'formik',                cdn: 'https://cdn.jsdelivr.net/npm/formik@2.4.6/dist/formik.umd.development.js',                       global: 'Formik'        },
  { pkg: '@tanstack/react-query', cdn: 'https://cdn.jsdelivr.net/npm/@tanstack/react-query@4.36.1/build/umd/index.development.js',        global: 'ReactQuery'    },
  { pkg: 'react-query',          cdn: 'https://cdn.jsdelivr.net/npm/react-query@3.39.3/reactQuery.development.js',                       global: 'ReactQuery'    },
  { pkg: 'react-spring',          cdn: 'https://cdn.jsdelivr.net/npm/react-spring@9.7.3/dist/react-spring.umd.js',                       global: 'ReactSpring'   },
  { pkg: 'uuid',                  cdn: 'https://cdn.jsdelivr.net/npm/uuid@9.0.1/dist/umd/uuid.min.js',                                   global: 'uuid'          },
  { pkg: 'nanoid',                cdn: 'https://cdn.jsdelivr.net/npm/nanoid@5.0.7/index.browser.js',                                     global: 'nanoid'        },
];

export function buildRouterStubs(usesRouter: boolean): string {
  if (!usesRouter) return '';
  return `<script>
var ReactRouterDOM=(function(){var R=React;function BrowserRouter(p){return p.children;}function MemoryRouter(p){return p.children;}function HashRouter(p){return p.children;}
function Routes(p){var kids=R.Children.toArray(p.children);var home=kids.find(function(c){return c&&c.props&&(c.props.path==='/'||c.props.index);});if(home)return home.props.element||null;return kids.length?(kids[0].props.element||null):null;}
function Route(p){return p.element||null;}function Link(p){var _p=Object.assign({},p,{href:p.to});delete _p.to;return R.createElement('a',_p,p.children);}function NavLink(p){var _p=Object.assign({},p,{href:p.to});delete _p.to;return R.createElement('a',_p,p.children);}
function Navigate(p){return null;}function Outlet(){return null;}function useNavigate(){return function(){};}function useLocation(){return{pathname:'/',search:'',hash:'',state:null};}function useParams(){return{};}function useMatch(){return null;}function useSearchParams(){return[{get:function(){return null;}},[function(){}]];}
return{BrowserRouter,MemoryRouter,HashRouter,Routes,Route,Link,NavLink,Navigate,Outlet,useNavigate,useLocation,useParams,useMatch,useSearchParams};})();
</script>`;
}

export function buildUILibraryStubs(usesIconLibs: boolean, usesHeadlessUI: boolean, usesChakra: boolean, usesMUI: boolean, usesAntd: boolean): string {
  if (!usesIconLibs && !usesHeadlessUI && !usesChakra && !usesMUI && !usesAntd) return '';
  return `<script>
window.__iconStub=typeof Proxy!=='undefined'?new Proxy({},{get:function(_,name){return function(props){var attrs=Object.assign({xmlns:'http://www.w3.org/2000/svg',width:props&&props.size||16,height:props&&props.size||16,viewBox:'0 0 24 24',fill:'currentColor','aria-hidden':'true'},props);delete attrs.size;delete attrs.children;return React.createElement('svg',attrs);};}}):{};\n
function __passThrough(p){if(!p)return null;var c=p.children;return(typeof c==='function')?(c({open:false,checked:false,selected:false,active:false,disabled:false,isOpen:false,value:''})||null):(c!==undefined?c:null);}\n
window.__headlessui=(function(){var base=typeof Proxy!=='undefined'?new Proxy({},{get:function(_,k){return k==='__esModule'?false:__passThrough;}}): {};['Dialog','Transition','Menu','Popover','Disclosure','Listbox','Combobox','RadioGroup','Switch','Tab','Tabs'].forEach(function(name){var c=function(p){return __passThrough(p);};c.displayName=name;['Panel','Title','Description','Button','Items','Item','Options','Option','Label','Group','List','Tab','Panels','Overlay','Backdrop','Arrow'].forEach(function(s){c[s]=function(p){return __passThrough(p);};});base[name]=c;});return base;})();\n
window.__chakra=(function(){function el(tag){return function(props){if(!props)return null;var{children,as:As,colorScheme,variant,size,isDisabled,isLoading,leftIcon,rightIcon,...rest}=props;var t=As||tag;return React.createElement(t,rest,leftIcon,children,rightIcon);};}var s=window.__mkStub('Chakra');['Box','Flex','Grid','GridItem','Stack','HStack','VStack','Center','Container','Divider','Spacer'].forEach(function(n){s[n]=el('div');});['Text','Heading','Link','Code','Kbd'].forEach(function(n){s[n]=el('p');});['Button','IconButton'].forEach(function(n){s[n]=el('button');});['Input','Textarea','Select'].forEach(function(n){s[n]=el('input');});['Image','Avatar'].forEach(function(n){s[n]=el('img');});['Modal','ModalOverlay','ModalContent','ModalHeader','ModalBody','ModalFooter','ModalCloseButton','Drawer','DrawerOverlay','DrawerContent','DrawerHeader','DrawerBody','DrawerFooter','DrawerCloseButton','Alert','AlertIcon','AlertTitle','AlertDescription','Popover','PopoverTrigger','PopoverContent','PopoverHeader','PopoverBody','Tooltip','Menu','MenuButton','MenuList','MenuItem','Tabs','TabList','Tab','TabPanels','TabPanel','Accordion','AccordionItem','AccordionButton','AccordionPanel'].forEach(function(n){s[n]=function(p){return __passThrough(p);};});s['ChakraProvider']=function(p){return __passThrough(p);};s['extendTheme']=function(t){return t||{};};s['useDisclosure']=function(){return{isOpen:false,onOpen:function(){},onClose:function(){},onToggle:function(){}};};s['useToast']=function(){return function(){};};s['useColorMode']=function(){return{colorMode:'light',toggleColorMode:function(){}};};s['useBreakpointValue']=function(v){return typeof v==='object'?(v.base||v.md||Object.values(v)[0]):v;};s['useColorModeValue']=function(l){return l;};s['Icon']=function(){return React.createElement('svg',{xmlns:'http://www.w3.org/2000/svg',width:16,height:16,viewBox:'0 0 24 24',fill:'currentColor'});};return s;})();window.__s__chakra_ui_react=window.__chakra;window.__s__chakra_ui_icons=window.__chakra;\n
window.__mui=window.__mkStub('MUI');window.__s__mui_material=window.__mui;window.__s__mui_icons_material=window.__iconStub;window.__s__mui_x_date_pickers=window.__mkStub('MUIDatePickers');window.__s__mui_x_data_grid=window.__mkStub('MUIDataGrid');\n
window.__s_antd=window.__mkStub('Antd');
</script>`;
}

/**
 * Stubs for Next.js runtime helpers (next/link, next/router, next/head, etc.).
 * These let preview-mode apps built with the Next.js pages router render as a
 * simple SPA without the actual Next framework being present.
 */
export function buildNextStubs(usesNext: boolean): string {
  if (!usesNext) return '';
  return `<script>
(function(){
  var R=React;
  // next/link — render as <a href=...>; intercept clicks so navigation updates URL hash only
  function NextLink(p){var _p=Object.assign({},p,{href:typeof p.href==='string'?p.href:(p.href&&p.href.pathname)||'#'});delete _p.to;var onClick=p.onClick;_p.onClick=function(e){if(e&&e.preventDefault)e.preventDefault();try{window.history.pushState({},'',_p.href);}catch(_){}if(onClick)onClick(e);};return R.createElement('a',_p,p.children);}
  window.__s_next_link=NextLink;window.__s_next_link.default=NextLink;
  // next/router — router object with no-op methods
  function __router(){return {push:function(u){try{window.history.pushState({},'',u);}catch(_){}return Promise.resolve(true);},replace:function(u){try{window.history.replaceState({},'',u);}catch(_){}return Promise.resolve(true);},back:function(){try{window.history.back();}catch(_){}},reload:function(){},prefetch:function(){return Promise.resolve();},events:{on:function(){},off:function(){},emit:function(){}},pathname:location.pathname||'/',route:location.pathname||'/',asPath:location.pathname||'/',query:{},isReady:true,isFallback:false,basePath:'',locale:'en'};}
  window.__s_next_router={useRouter:__router,withRouter:function(C){return function(p){return R.createElement(C,Object.assign({router:__router()},p));};},default:__router()};
  // next/navigation (App Router)
  window.__s_next_navigation={useRouter:__router,usePathname:function(){return location.pathname||'/';},useSearchParams:function(){return new URLSearchParams(location.search||'');},useParams:function(){return{};},redirect:function(){},notFound:function(){}};
  // next/head — render children into <head> would be nice, but null is safer
  function NextHead(p){return null;}window.__s_next_head=NextHead;window.__s_next_head.default=NextHead;
  // next/image — pass-through <img>
  function NextImage(p){var _p=Object.assign({},p);delete _p.priority;delete _p.placeholder;delete _p.blurDataURL;delete _p.quality;delete _p.fill;return R.createElement('img',_p);}window.__s_next_image=NextImage;window.__s_next_image.default=NextImage;
  // next/dynamic — synchronously return a loading placeholder; call loader and swap if sync
  function NextDynamic(loader,opts){var Comp=function(p){var r=R.useState(null);try{var m=loader();if(m&&m.then){m.then(function(mod){r[1](function(){return mod&&mod.default?mod.default:mod;});});return (opts&&opts.loading?R.createElement(opts.loading):null);}if(m&&m.default)return R.createElement(m.default,p);}catch(e){}return null;};return Comp;}window.__s_next_dynamic=NextDynamic;window.__s_next_dynamic.default=NextDynamic;
  // next/script — just render <script>
  function NextScript(p){return null;}window.__s_next_script=NextScript;window.__s_next_script.default=NextScript;
  // next/app — AppProps type only (stripped by TS); provide empty module
  window.__s_next_app={};
})();
</script>`;
}

/**
 * Stubs for Redux / Redux Toolkit / react-redux. Provider becomes a pass-through,
 * useSelector returns undefined, useDispatch returns a no-op. Good enough to
 * keep a preview alive without a real store.
 */
export function buildReduxStubs(usesRedux: boolean): string {
  if (!usesRedux) return '';
  return `<script>
(function(){
  var R=React;
  // Minimal store that accepts any actions and always returns empty state
  function makeStore(initialState){var state=initialState||{};var subs=[];return {getState:function(){return state;},dispatch:function(a){try{if(typeof a==='function')return a(this.dispatch,this.getState);}catch(_){}return a;},subscribe:function(fn){subs.push(fn);return function(){var i=subs.indexOf(fn);if(i>=0)subs.splice(i,1);};},replaceReducer:function(){}};}
  // react-redux
  window.__s_react_redux=(function(){
    function Provider(p){return p.children;}
    function useSelector(fn){try{return fn?fn({}):undefined;}catch(_){return undefined;}}
    function useDispatch(){return function(){};}
    function useStore(){return makeStore();}
    function connect(){return function(C){return C;};}
    var out={Provider:Provider,useSelector:useSelector,useDispatch:useDispatch,useStore:useStore,connect:connect,shallowEqual:function(a,b){return a===b;}};
    out.default=out;return out;
  })();
  // @reduxjs/toolkit
  window.__s__reduxjs_toolkit=(function(){
    function configureStore(opts){var initial={};if(opts&&opts.reducer){if(typeof opts.reducer==='function')initial=opts.reducer(undefined,{type:'@@INIT'});else{for(var k in opts.reducer){try{initial[k]=opts.reducer[k](undefined,{type:'@@INIT'});}catch(_){initial[k]={};}}}}return makeStore(initial);}
    function createSlice(opts){var name=opts&&opts.name||'slice';var initial=opts&&opts.initialState||{};var actions={};if(opts&&opts.reducers){for(var k in opts.reducers){(function(type){actions[type]=function(payload){return{type:name+'/'+type,payload:payload};};actions[type].type=name+'/'+type;actions[type].toString=function(){return name+'/'+type;};})(k);}}return {name:name,actions:actions,reducer:function(s,a){return s===undefined?initial:s;},caseReducers:opts&&opts.reducers||{}};}
    function createAsyncThunk(type,payloadCreator){var t=function(arg){return function(dispatch){try{var p=payloadCreator(arg,{dispatch:dispatch,getState:function(){return{};},rejectWithValue:function(v){return v;}});return Promise.resolve(p).then(function(r){dispatch({type:type+'/fulfilled',payload:r});return{type:type+'/fulfilled',payload:r};}).catch(function(e){dispatch({type:type+'/rejected',error:e});return{type:type+'/rejected',error:e};});}catch(e){return Promise.resolve({type:type+'/rejected',error:e});}};};t.pending={type:type+'/pending'};t.fulfilled={type:type+'/fulfilled'};t.rejected={type:type+'/rejected'};t.typePrefix=type;return t;}
    function createAction(type){var a=function(payload){return{type:type,payload:payload};};a.type=type;a.toString=function(){return type;};a.match=function(x){return x&&x.type===type;};return a;}
    function createReducer(initial,b){return function(s,a){return s===undefined?initial:s;};}
    function combineReducers(r){return function(s,a){s=s||{};var out={};for(var k in r){try{out[k]=r[k](s[k],a);}catch(_){out[k]=s[k]||{};}}return out;};}
    function createSelector(){var fns=Array.prototype.slice.call(arguments);var last=fns.pop();return function(s){try{return last.apply(null,fns.map(function(f){return f(s);}));}catch(_){return undefined;}};}
    var out={configureStore:configureStore,createSlice:createSlice,createAsyncThunk:createAsyncThunk,createAction:createAction,createReducer:createReducer,combineReducers:combineReducers,createSelector:createSelector,nanoid:function(){return Math.random().toString(36).slice(2,12);}};
    out.default=out;return out;
  })();
  // redux (classic)
  window.__s_redux=(function(){var out={createStore:function(reducer,preloaded){return makeStore(preloaded||(typeof reducer==='function'?reducer(undefined,{type:'@@INIT'}):{}));},combineReducers:window.__s__reduxjs_toolkit.combineReducers,applyMiddleware:function(){return function(cs){return cs;};},compose:function(){var fns=Array.prototype.slice.call(arguments);return function(x){return fns.reduceRight(function(acc,f){return f(acc);},x);};},bindActionCreators:function(ac,d){var o={};for(var k in ac){o[k]=function(){return d(ac[k].apply(null,arguments));};}return o;}};out.default=out;return out;})();
})();
</script>`;
}
