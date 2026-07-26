import Link from 'next/link';
import {
  ArrowRight, Boxes, Check, CheckCircle2, ChevronRight, CircleDot, Code2,
  Database, Eye, FileCheck2, GitBranch, Globe2, KeyRound, Layers3, LockKeyhole,
  Menu, Network, Play, RefreshCw, Server, ShieldCheck, Sparkles, TerminalSquare,
  TestTube2, WandSparkles, Workflow, XCircle, Zap,
} from 'lucide-react';
import styles from './landing.module.css';

const nav = [['Product', '#product'], ['How it works', '#workflow'], ['Security', '#security'], ['Enterprise', '#enterprise'], ['Pricing', '#pricing']];

function Logo() {
  return <Link href="/" className={`${styles.logo} focus-visible:outline-none`} aria-label="DEVteam home"><span className={styles.logoMark}><span /></span><span>DEVteam</span></Link>;
}

function Button({ href, children, secondary = false }: { href: string; children: React.ReactNode; secondary?: boolean }) {
  return <Link href={href} className={secondary ? styles.buttonSecondary : styles.button}>{children}<ArrowRight aria-hidden="true" size={16} /></Link>;
}

function SectionHead({ eyebrow, title, copy }: { eyebrow: string; title: string; copy?: string }) {
  return <div className={styles.sectionHead}><p>{eyebrow}</p><h2>{title}</h2>{copy && <div>{copy}</div>}</div>;
}

function ProductMockup() {
  return <div className={styles.mockWrap} role="img" aria-label="DEVteam workspace coordinating agents, previewing an application, and reporting validation results">
    <div className={styles.mockGlow} />
    <div className={styles.mockWindow}>
      <div className={styles.mockTop}><div className={styles.traffic}><i /><i /><i /></div><span className={styles.mockProject}>acme-operations / build</span><span className={styles.live}><i /> LIVE</span></div>
      <div className={styles.mockBody}>
        <aside className={styles.mockRail}><Logo /><nav><span className={styles.railActive}><Sparkles size={15} />Build</span><span><Code2 size={15} />Code</span><span><Eye size={15} />Preview</span><span><TerminalSquare size={15} />Logs</span></nav><span className={styles.railUser}>AK</span></aside>
        <div className={styles.mockMain}>
          <header><div><small>BUILD 08</small><strong>Operations workspace</strong></div><span className={styles.verified}><ShieldCheck size={13} />Validated</span></header>
          <div className={styles.mockColumns}>
            <div className={styles.agentPanel}><span className={styles.panelLabel}>AGENT ACTIVITY</span>
              {[['Architecture', 'Schema and API contracts', 'done'], ['Frontend', 'Building dashboard views', 'active'], ['Security', 'Reviewing auth boundaries', 'waiting']].map(([a,b,s]) => <div className={`${styles.agentRow} ${s === 'active' ? styles.agentActive : ''}`} key={a}><span className={styles.agentIcon}>{s === 'done' ? <Check size={13}/> : s === 'active' ? <RefreshCw size={13}/> : <CircleDot size={13}/>}</span><div><strong>{a}</strong><small>{b}</small></div><em>{s}</em></div>)}
              <div className={styles.prompt}><span>Continue building</span><p>Add role-based approvals and an audit trail.</p><span className={styles.promptSend}><ArrowRight size={14}/></span></div>
            </div>
            <div className={styles.previewPanel}><div className={styles.previewBar}><span><i/><i/><i/></span><small>preview.devteam.app</small><Eye size={13}/></div><div className={styles.previewApp}><div className={styles.previewNav}><b>Northstar</b><span>Overview</span><span>Workflows</span><span>Reports</span></div><div className={styles.previewContent}><small>OPERATIONS</small><h3>Good morning, Alex</h3><div className={styles.miniStats}><i/><i/><i/></div><div className={styles.chart}><span/><span/><span/><span/><span/><span/><span/></div></div></div>
              <div className={styles.checkBar}><span><CheckCircle2 size={13}/> Build passed</span><span>18 tests</span><span>0 vulnerabilities</span></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>;
}

const features = [
  { icon: Network, title: 'Multi-agent by design', copy: 'Specialized agents coordinate architecture, implementation, testing, and security—working from the same project state.' },
  { icon: GitBranch, title: 'Build incrementally', copy: 'Continue from any previous prompt. Add a workflow, change the data model, or refine the interface without starting over.' },
  { icon: FileCheck2, title: 'Deterministic validation', copy: 'Every generation passes through explicit build, type, dependency, and runtime checks before it reaches preview.' },
  { icon: LockKeyhole, title: 'Security from the first file', copy: 'Authentication boundaries, dependency policy, input handling, and secrets hygiene are considered during generation.' },
  { icon: Boxes, title: 'A complete application', copy: 'Frontend, backend, database, and project configuration arrive as a coherent codebase—not disconnected snippets.' },
  { icon: Code2, title: 'Your code, your workflow', copy: 'Review every file, export the project, and continue in your repository with the tools your team already uses.' },
];

const faq = [
  ['Is DEVteam a website builder?', 'No. DEVteam generates full-stack application foundations—including interfaces, services, data models, configuration, and validation artifacts.'],
  ['Can I keep building after the first generation?', 'Yes. Follow-up prompts operate on the existing project, so you can add features and refine behavior without regenerating from scratch.'],
  ['Do I own the generated code?', 'Yes. The source is the product artifact. You can inspect it, export it, and continue development in your own repository and delivery workflow.'],
  ['How does validation work?', 'Generated projects pass through deterministic checks for types, builds, dependencies, runtime health, and configured security rules. Failed checks enter a repair cycle before preview.'],
  ['Is private or EU-hosted deployment available?', 'EU-hosted infrastructure and privacy-focused deployment options are on the roadmap. Talk with us about requirements and planned availability.'],
];

export function LandingPage() {
  return <div className={styles.page}>
    <header className={styles.header}><div className={styles.navbar}><Logo/><nav aria-label="Primary navigation">{nav.map(([l,h]) => <a key={h} href={h}>{l}</a>)}</nav><div className={styles.navActions}><Link href="/login">Sign in</Link><Link href="/request-demo" className={styles.navCta}>Request a demo <ArrowRight size={14}/></Link></div><details className={styles.mobileMenu}><summary aria-label="Open navigation"><Menu size={20}/></summary><div>{nav.map(([l,h]) => <a key={h} href={h}>{l}</a>)}<Link href="/login">Sign in</Link><Link href="/request-demo">Request a demo</Link></div></details></div></header>

    <main>

    <section className={styles.hero}><div className={styles.gridBg}/><div className={styles.heroInner}><div className={styles.heroCopy}><div className={styles.eyebrow}><span><Sparkles size={13}/></span>AI software engineering, with control</div><h1>Build complete software.<br/><span>Know exactly what ships.</span></h1><p>DEVteam turns requirements into production-ready full-stack applications using coordinated AI agents, deterministic validation, and automatic repair—while you keep control of the code.</p><div className={styles.heroActions}><Button href="/request-demo">Request a demo</Button><Button href="#workflow" secondary>See how it works</Button></div><div className={styles.heroChecks}><span><Check size={14}/>Full-stack generation</span><span><Check size={14}/>Exportable source</span><span><Check size={14}/>Validated previews</span></div></div><ProductMockup/></div></section>

    <section className={styles.proof} aria-label="Platform principles"><p>Built for teams that treat generated software like production software</p><div>{[['01','Reviewable at every stage'],['02','Validation before preview'],['03','No proprietary runtime lock-in'],['04','Security-aware generation']].map(([n,t]) => <span key={n}><small>{n}</small>{t}</span>)}</div></section>

    <section className={styles.section} id="product"><SectionHead eyebrow="A deeper generation model" title="From prompt to engineered system." copy="Most AI tools stop when the code appears. DEVteam coordinates the full path from intent to a working, verified application."/><div className={styles.whyGrid}><article className={styles.whyLarge}><div className={styles.cardIcon}><Layers3/></div><h3>One project state. Every agent aligned.</h3><p>Architecture decisions, data contracts, UI conventions, and validation results stay connected across the build.</p><div className={styles.stackVisual}><span>Product intent</span><ChevronRight/><span>Shared project state</span><ChevronRight/><span>Verified application</span></div></article><article><div className={styles.cardIcon}><Eye/></div><h3>Visible, not black box</h3><p>Follow agent activity, inspect generated files, review diagnostics, and see exactly what changed.</p><div className={styles.logVisual}><span><i className={styles.green}/>Schema validated</span><span><i className={styles.green}/>API routes compiled</span><span><i className={styles.blue}/>Building interface…</span></div></article><article><div className={styles.cardIcon}><RefreshCw/></div><h3>Continue, don’t restart</h3><p>Every follow-up builds on the existing codebase and its accumulated context.</p><div className={styles.commitVisual}><i/><i/><i/><span>prompt 04</span><i/><span>prompt 05</span></div></article></div></section>

    <section className={`${styles.section} ${styles.alt}`} id="workflow"><SectionHead eyebrow="How it works" title="A disciplined path from idea to codebase." copy="Clear stages keep the work inspectable and make validation a required part of generation."/><ol className={styles.timeline}>{[['01','Describe','Define the product, users, workflows, and technical constraints.'],['02','Plan','Agents map architecture, data, interfaces, and dependencies.'],['03','Generate','Specialists build frontend, backend, schema, and configuration.'],['04','Validate & repair','Deterministic checks identify failures and route them back for repair.'],['05','Review & continue','Use the live preview, inspect the code, then extend with another prompt.']].map(([n,t,c],i) => <li key={n}><span>{n}</span><div className={styles.timelineIcon}>{[WandSparkles,Workflow,Code2,ShieldCheck,Play].map((I,x)=>x===i?<I key={x}/>:null)}</div><h3>{t}</h3><p>{c}</p></li>)}</ol></section>

    <section className={styles.section}><SectionHead eyebrow="Coordinated intelligence" title="Specialists that work as one engineering team." copy="Each agent has a defined responsibility. The orchestrator manages dependencies, passes context, and prevents isolated decisions."/><div className={styles.orchestration}><div className={styles.orbit}><div className={styles.core}><Network/><strong>Orchestrator</strong><small>Shared context</small></div>{[['Architect',Layers3],['Frontend',Code2],['Backend',Server],['Data',Database],['QA',TestTube2],['Security',ShieldCheck]].map(([name,Icon],i) => { const I=Icon as typeof Layers3; return <div key={name as string} className={`${styles.node} ${styles[`node${i+1}`]}`}><I/><span>{name as string}</span></div>})}</div><div className={styles.orchestrationCopy}><span className={styles.statusPill}><i/>6 agents coordinated</span><h3>Parallel where it helps.<br/>Sequenced where it matters.</h3><p>The backend does not invent a contract the frontend never sees. Security does not arrive after implementation. Shared state keeps every decision connected.</p><ul><li><Check/>Explicit agent responsibilities</li><li><Check/>Dependency-aware execution</li><li><Check/>Traceable build activity</li></ul></div></div></section>

    <section className={`${styles.section} ${styles.alt}`} id="security"><SectionHead eyebrow="Validation and security" title="AI that checks its work before you see it." copy="Generation is only the first pass. Every build moves through deterministic gates and an automatic repair loop."/><div className={styles.validation}><div className={styles.loop}><div className={styles.loopStep}><Code2/><span><b>Generate</b><small>Application changes</small></span></div><ArrowRight/><div className={styles.loopStep}><TestTube2/><span><b>Validate</b><small>Build · type · runtime</small></span></div><ArrowRight/><div className={`${styles.loopStep} ${styles.fail}`}><XCircle/><span><b>Issue found</b><small>Structured diagnostics</small></span></div><div className={styles.repairArrow}><RefreshCw/><span>Automatic repair</span></div></div><div className={styles.gates}><h3>Built-in quality gates</h3>{[['Type and build checks','Compile-time integrity'],['Runtime health','Working preview evidence'],['Dependency policy','Known and compatible packages'],['Security rules','Auth, input, and secret boundaries']].map(([t,c]) => <div key={t}><span><CheckCircle2/></span><p><b>{t}</b><small>{c}</small></p><em>PASS</em></div>)}</div></div></section>

    <section className={styles.section}><SectionHead eyebrow="The platform" title="Professional workflows, accelerated."/><div className={styles.bento}>{features.map(({icon:Icon,title,copy},i)=><article key={title} className={i===0||i===5?styles.bentoWide:''}><Icon/><h3>{title}</h3><p>{copy}</p>{i===0&&<div className={styles.miniAgents}>{['Plan','Build','Test','Secure'].map(x=><span key={x}><i/>{x}</span>)}</div>}{i===5&&<div className={styles.codeLine}><span>git clone</span> your-production-code</div>}</article>)}</div></section>

    <section className={`${styles.section} ${styles.alt}`}><div className={styles.previewWorkflow}><div><SectionHead eyebrow="Live preview workflow" title="See the product. Inspect the evidence." copy="Preview the running application beside build health, logs, and source. When you are ready, continue from the same project state."/><ol>{[['1','Review the running application'],['2','Inspect checks and diagnostics'],['3','Prompt the next change']].map(([n,t])=><li key={n}><span>{n}</span>{t}</li>)}</ol><Button href="/product" secondary>Explore the product</Button></div><div className={styles.browser}><div className={styles.browserBar}><i/><i/><i/><span>localhost:3000/dashboard</span></div><div className={styles.browserBody}><aside><b>N</b><i/><i/><i/><i/></aside><div><small>DASHBOARD</small><h3>Team operations</h3><div className={styles.browserStats}><span/><span/><span/></div><div className={styles.browserTable}>{[1,2,3,4].map(x=><i key={x}/>)}</div></div></div><span className={styles.previewBadge}><CheckCircle2/> Preview healthy</span></div></div></section>

    <section className={styles.section} id="enterprise"><div className={styles.enterprise}><div><span className={styles.enterpriseTag}>FOR ENTERPRISE TEAMS</span><h2>Control for the teams that need more of it.</h2><p>Bring AI-assisted delivery into professional engineering environments with reviewable output, source ownership, and deployment options designed around organizational requirements.</p><Button href="/request-demo">Discuss your requirements</Button></div><div className={styles.enterpriseGrid}>{[[KeyRound,'Governance controls','Defined access and review boundaries.'],[Globe2,'EU-hosted infrastructure','Planned','Regional infrastructure is on our roadmap.'],[LockKeyhole,'Private deployment options','Planned','Privacy-focused deployment is in development.'],[Code2,'Source ownership','Export and operate the generated code yourself.']].map((item)=><article key={String(item[1])}><span>{item[2]==='Planned'?<em>PLANNED</em>:null}{(()=>{const I=item[0] as typeof Code2;return <I/>})()}</span><h3>{item[1] as string}</h3><p>{(item[3]||item[2]) as string}</p></article>)}</div></div></section>

    <section className={`${styles.section} ${styles.alt}`} id="pricing"><SectionHead eyebrow="Pricing" title="Choose the level of support your work requires." copy="Plans are being finalized for early access. No invented discounts or hidden feature gates."/><div className={styles.pricing}>{[['Early access','For individual builders and small teams evaluating the workflow.','Join waitlist','/waitlist'],['Studio','For teams building and iterating on full-stack applications.','Request pricing','/request-demo'],['Enterprise','For organizations with governance, security, and deployment requirements.','Talk to us','/request-demo']].map(([t,c,a,h],i)=><article key={t} className={i===1?styles.featuredPlan:''}>{i===1&&<span className={styles.planLabel}>TEAM WORKFLOW</span>}<h3>{t}</h3><p>{c}</p><div className={styles.price}>Custom <small>based on access and usage</small></div><Link href={h}>{a}<ArrowRight/></Link></article>)}</div></section>

    <section className={styles.section}><SectionHead eyebrow="FAQ" title="Straight answers for software teams."/><div className={styles.faq}>{faq.map(([q,a],i)=><details key={q} open={i===0}><summary>{q}<span>+</span></summary><p>{a}</p></details>)}</div></section>

    <section className={styles.finalCta}><div className={styles.finalGrid}/><span><Zap/>Build with more speed. Ship with more certainty.</span><h2>Your next application can start<br/>with a better engineering process.</h2><p>See how coordinated AI agents turn requirements into validated, full-stack software your team owns.</p><div><Button href="/request-demo">Request a demo</Button><Button href="/waitlist" secondary>Join early access</Button></div></section>
    </main>

    <footer className={styles.footer}><div className={styles.footerTop}><div><Logo/><p>AI software engineering for complete, controllable applications.</p></div><div><h3>Product</h3><a href="#product">Platform</a><a href="#workflow">How it works</a><a href="#security">Security</a><a href="#pricing">Pricing</a></div><div><h3>Resources</h3><Link href="/docs">Documentation</Link><Link href="/request-demo">Contact</Link><Link href="/waitlist">Early access</Link></div><div><h3>For teams</h3><Link href="/enterprise">Enterprise</Link><Link href="/security">Security</Link></div></div><div className={styles.footerBottom}><span>© {new Date().getFullYear()} DEVteam. All rights reserved.</span><span className={styles.systemStatus}><i/>All systems operational</span></div></footer>
  </div>;
}
