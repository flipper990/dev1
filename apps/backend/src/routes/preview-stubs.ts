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
