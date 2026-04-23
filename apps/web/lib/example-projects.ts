/**
 * Three pre-built example projects used by the Showcase panel.
 *
 * Each example is a set of source files that runs through the same
 * frontend-only preview pipeline as real generated projects — no backend
 * involvement. The mock layer inside the preview iframe intercepts any
 * fetch() calls with plausible JSON, so the apps feel alive.
 *
 * Keep each example self-contained (React + inline styles, no external
 * libraries beyond React itself) so Babel Standalone can compile and run
 * them in the sandboxed iframe without network dependencies beyond the
 * CDN scripts that the preview builder already loads.
 */

import type { PreviewFile } from './preview-build';

export interface ExampleProject {
  id: string;
  name: string;
  tagline: string;
  description: string;
  tags: string[];
  /** Inline SVG used as the card thumbnail (no external images). */
  thumbnail: string;
  /** React source files — rendered via buildPreviewHtml. */
  files: PreviewFile[];
}

// ─── Thumbnails (pure SVG so no network round-trips) ────────────────────────
const THUMB_SAAS = `<svg viewBox="0 0 400 240" xmlns="http://www.w3.org/2000/svg">
  <defs><linearGradient id="g1" x1="0" x2="1" y1="0" y2="1">
    <stop offset="0" stop-color="#6366F1"/><stop offset="1" stop-color="#8B5CF6"/>
  </linearGradient></defs>
  <rect width="400" height="240" fill="#0F172A"/>
  <rect x="0" y="0" width="80" height="240" fill="#1E293B"/>
  <circle cx="40" cy="30" r="10" fill="url(#g1)"/>
  <rect x="18" y="60" width="44" height="6" rx="3" fill="#334155"/>
  <rect x="18" y="78" width="44" height="6" rx="3" fill="#334155"/>
  <rect x="18" y="96" width="44" height="6" rx="3" fill="url(#g1)"/>
  <rect x="18" y="114" width="44" height="6" rx="3" fill="#334155"/>
  <rect x="100" y="20" width="280" height="60" rx="8" fill="#1E293B"/>
  <text x="114" y="46" fill="#F1F5F9" font-family="Inter,system-ui" font-size="14" font-weight="600">Revenue</text>
  <text x="114" y="68" fill="#8B5CF6" font-family="Inter,system-ui" font-size="20" font-weight="700">$48.2K</text>
  <rect x="100" y="100" width="135" height="120" rx="8" fill="#1E293B"/>
  <polyline points="115,180 140,160 165,170 190,140 215,150" stroke="url(#g1)" stroke-width="3" fill="none" stroke-linecap="round"/>
  <rect x="245" y="100" width="135" height="120" rx="8" fill="#1E293B"/>
  <rect x="260" y="180" width="15" height="25" fill="#6366F1"/>
  <rect x="285" y="160" width="15" height="45" fill="#8B5CF6"/>
  <rect x="310" y="145" width="15" height="60" fill="#6366F1"/>
  <rect x="335" y="170" width="15" height="35" fill="#8B5CF6"/>
  <rect x="360" y="155" width="15" height="50" fill="#6366F1"/>
</svg>`;

const THUMB_MARKET = `<svg viewBox="0 0 400 240" xmlns="http://www.w3.org/2000/svg">
  <rect width="400" height="240" fill="#0A0F1C"/>
  <rect x="0" y="0" width="400" height="48" fill="#0F172A"/>
  <circle cx="24" cy="24" r="8" fill="#EC4899"/>
  <rect x="40" y="20" width="60" height="8" rx="2" fill="#F1F5F9"/>
  <rect x="280" y="16" width="100" height="16" rx="8" fill="#1E293B"/>
  <rect x="20" y="70" width="110" height="150" rx="10" fill="#1E293B"/>
  <rect x="20" y="70" width="110" height="90" rx="10" fill="#EC4899" opacity="0.7"/>
  <rect x="30" y="170" width="60" height="6" rx="3" fill="#F1F5F9"/>
  <rect x="30" y="184" width="40" height="5" rx="2" fill="#64748B"/>
  <rect x="30" y="200" width="50" height="10" rx="5" fill="#EC4899"/>
  <rect x="145" y="70" width="110" height="150" rx="10" fill="#1E293B"/>
  <rect x="145" y="70" width="110" height="90" rx="10" fill="#F59E0B" opacity="0.7"/>
  <rect x="155" y="170" width="60" height="6" rx="3" fill="#F1F5F9"/>
  <rect x="155" y="184" width="40" height="5" rx="2" fill="#64748B"/>
  <rect x="155" y="200" width="50" height="10" rx="5" fill="#F59E0B"/>
  <rect x="270" y="70" width="110" height="150" rx="10" fill="#1E293B"/>
  <rect x="270" y="70" width="110" height="90" rx="10" fill="#06B6D4" opacity="0.7"/>
  <rect x="280" y="170" width="60" height="6" rx="3" fill="#F1F5F9"/>
  <rect x="280" y="184" width="40" height="5" rx="2" fill="#64748B"/>
  <rect x="280" y="200" width="50" height="10" rx="5" fill="#06B6D4"/>
</svg>`;

const THUMB_BOOKING = `<svg viewBox="0 0 400 240" xmlns="http://www.w3.org/2000/svg">
  <rect width="400" height="240" fill="#0E1525"/>
  <rect x="30" y="30" width="180" height="180" rx="12" fill="#1E293B"/>
  <rect x="30" y="30" width="180" height="36" rx="12" fill="#14B8A6"/>
  <text x="120" y="54" text-anchor="middle" fill="#0E1525" font-family="Inter,system-ui" font-size="13" font-weight="700">April 2026</text>
  <g fill="#64748B" font-family="Inter,system-ui" font-size="9">
    <text x="50" y="88">S</text><text x="76" y="88">M</text><text x="102" y="88">T</text><text x="128" y="88">W</text><text x="154" y="88">T</text><text x="180" y="88">F</text><text x="206" y="88">S</text>
  </g>
  <g fill="#CBD5E1" font-family="Inter,system-ui" font-size="10">
    <text x="50" y="108">1</text><text x="76" y="108">2</text><text x="102" y="108">3</text><text x="128" y="108">4</text><text x="154" y="108">5</text><text x="180" y="108">6</text><text x="206" y="108">7</text>
    <text x="50" y="128">8</text><text x="76" y="128">9</text><text x="100" y="128">10</text><text x="126" y="128">11</text><text x="152" y="128">12</text><text x="178" y="128">13</text><text x="204" y="128">14</text>
  </g>
  <circle cx="128" cy="145" r="12" fill="#14B8A6"/>
  <text x="128" y="149" text-anchor="middle" fill="#0E1525" font-family="Inter,system-ui" font-size="11" font-weight="700">15</text>
  <g fill="#CBD5E1" font-family="Inter,system-ui" font-size="10">
    <text x="50" y="168">16</text><text x="76" y="168">17</text><text x="102" y="168">18</text><text x="152" y="168">19</text><text x="178" y="168">20</text><text x="204" y="168">21</text>
  </g>
  <rect x="230" y="30" width="150" height="60" rx="8" fill="#1E293B"/>
  <rect x="240" y="42" width="80" height="8" rx="3" fill="#14B8A6"/>
  <rect x="240" y="58" width="120" height="5" rx="2" fill="#64748B"/>
  <rect x="240" y="70" width="90" height="5" rx="2" fill="#64748B"/>
  <rect x="230" y="100" width="150" height="50" rx="8" fill="#1E293B"/>
  <rect x="240" y="112" width="80" height="8" rx="3" fill="#F59E0B"/>
  <rect x="240" y="128" width="120" height="5" rx="2" fill="#64748B"/>
  <rect x="230" y="160" width="150" height="50" rx="8" fill="#14B8A6" opacity="0.85"/>
  <text x="305" y="192" text-anchor="middle" fill="#0E1525" font-family="Inter,system-ui" font-size="13" font-weight="700">Book now</text>
</svg>`;

// ─── Example #1: SaaS Dashboard ─────────────────────────────────────────────
const SAAS_DASHBOARD_APP = `
function Sparkline({ points, color }) {
  var w = 240, h = 60, max = Math.max.apply(null, points), min = Math.min.apply(null, points);
  var step = w / (points.length - 1);
  var path = points.map(function(p, i) {
    var x = i * step;
    var y = h - ((p - min) / (max - min || 1)) * (h - 6) - 3;
    return (i === 0 ? 'M' : 'L') + x.toFixed(1) + ',' + y.toFixed(1);
  }).join(' ');
  return (
    <svg width={w} height={h} style={{ display: 'block' }}>
      <path d={path} stroke={color} strokeWidth="2.5" fill="none" strokeLinecap="round" />
    </svg>
  );
}

function StatCard({ label, value, delta, color, series }) {
  return (
    <div style={{ background: '#111827', border: '1px solid #1F2937', borderRadius: 12, padding: 18 }}>
      <div style={{ color: '#94A3B8', fontSize: 12, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 6 }}>
        <div style={{ color: '#F8FAFC', fontSize: 26, fontWeight: 700 }}>{value}</div>
        <div style={{ color: delta.startsWith('-') ? '#F87171' : '#34D399', fontSize: 12, fontWeight: 600 }}>{delta}</div>
      </div>
      <div style={{ marginTop: 8 }}><Sparkline points={series} color={color} /></div>
    </div>
  );
}

function App() {
  var tabs = ['Overview', 'Customers', 'Subscriptions', 'Billing', 'Settings'];
  var active = 'Overview';
  var customers = [
    { id: 1, name: 'Acme Corp',     plan: 'Enterprise', mrr: '$8,400', status: 'active' },
    { id: 2, name: 'Globex',        plan: 'Pro',        mrr: '$1,200', status: 'active' },
    { id: 3, name: 'Soylent',       plan: 'Pro',        mrr: '$1,200', status: 'past_due' },
    { id: 4, name: 'Initech',       plan: 'Starter',    mrr: '$  49',  status: 'active' },
    { id: 5, name: 'Umbrella Corp', plan: 'Enterprise', mrr: '$12,000', status: 'active' },
  ];
  return (
    <div style={{ minHeight: '100vh', background: '#0B1120', color: '#E2E8F0', fontFamily: 'Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif', display: 'flex' }}>
      <aside style={{ width: 220, background: '#0A0F1D', borderRight: '1px solid #1F2937', padding: '24px 16px', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 28 }}>
          <div style={{ width: 30, height: 30, borderRadius: 8, background: 'linear-gradient(135deg,#6366F1,#8B5CF6)' }} />
          <div style={{ fontSize: 15, fontWeight: 700, color: '#F8FAFC' }}>Nebula</div>
        </div>
        <nav style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {tabs.map(function (t) {
            var a = t === active;
            return <div key={t} style={{ padding: '9px 12px', borderRadius: 6, fontSize: 13, color: a ? '#F8FAFC' : '#94A3B8', background: a ? 'rgba(99,102,241,0.15)' : 'transparent', borderLeft: a ? '2px solid #6366F1' : '2px solid transparent', cursor: 'pointer' }}>{t}</div>;
          })}
        </nav>
      </aside>
      <main style={{ flex: 1, padding: '24px 28px', overflow: 'auto' }}>
        <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: '#F8FAFC', margin: 0 }}>Overview</h1>
            <div style={{ color: '#64748B', fontSize: 13, marginTop: 4 }}>Your SaaS metrics at a glance.</div>
          </div>
          <button style={{ background: 'linear-gradient(135deg,#6366F1,#8B5CF6)', color: '#fff', border: 0, padding: '10px 16px', borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>+ Invite team</button>
        </header>
        <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14, marginBottom: 24 }}>
          <StatCard label="MRR"       value="$48.2K" delta="+12.4%" color="#8B5CF6" series={[12,15,18,17,22,25,28,30,34,38,42,48]} />
          <StatCard label="Customers" value="2,847"  delta="+4.8%"  color="#6366F1" series={[22,24,25,27,28,29,30,31,31,32,33,34]} />
          <StatCard label="Churn"     value="1.2%"   delta="-0.3%"  color="#34D399" series={[2.1,2.0,1.8,1.8,1.7,1.6,1.5,1.4,1.4,1.3,1.3,1.2]} />
          <StatCard label="ARR"       value="$578K"  delta="+11.2%" color="#F59E0B" series={[400,420,440,460,480,500,520,540,555,565,570,578]} />
        </section>
        <section style={{ background: '#111827', border: '1px solid #1F2937', borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid #1F2937', fontSize: 14, fontWeight: 600, color: '#F8FAFC' }}>Recent customers</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead><tr style={{ color: '#94A3B8', textAlign: 'left', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.06em' }}>
              <th style={{ padding: '10px 20px' }}>Customer</th><th>Plan</th><th>MRR</th><th>Status</th>
            </tr></thead>
            <tbody>
              {customers.map(function (c) {
                var color = c.status === 'active' ? '#34D399' : '#F87171';
                return (
                  <tr key={c.id} style={{ borderTop: '1px solid #1F2937' }}>
                    <td style={{ padding: '12px 20px', color: '#F8FAFC', fontWeight: 500 }}>{c.name}</td>
                    <td style={{ color: '#CBD5E1' }}>{c.plan}</td>
                    <td style={{ color: '#CBD5E1' }}>{c.mrr}</td>
                    <td><span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600, color: color, background: color + '22' }}>{c.status.replace('_',' ')}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      </main>
    </div>
  );
}

export default App;
`.trim();

// ─── Example #2: Marketplace ────────────────────────────────────────────────
const MARKETPLACE_APP = `
function Card({ p, onAdd }) {
  return (
    <div style={{ background: '#111827', border: '1px solid #1F2937', borderRadius: 14, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div style={{ height: 170, background: p.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 44 }}>{p.emoji}</div>
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontWeight: 600, color: '#F8FAFC', fontSize: 14 }}>{p.name}</div>
          <div style={{ color: '#EC4899', fontWeight: 700, fontSize: 14 }}>\${p.price}</div>
        </div>
        <div style={{ color: '#94A3B8', fontSize: 12 }}>{p.seller}</div>
        <div style={{ color: '#64748B', fontSize: 11, display: 'flex', gap: 4, alignItems: 'center', marginTop: 2 }}>
          <span style={{ color: '#F59E0B' }}>★</span> {p.rating.toFixed(1)} &middot; {p.reviews} reviews
        </div>
        <button onClick={function(){ onAdd(p); }} style={{ marginTop: 'auto', background: '#EC4899', color: '#fff', border: 0, padding: '9px 12px', borderRadius: 8, fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>Add to cart</button>
      </div>
    </div>
  );
}

function App() {
  var [cart, setCart] = React.useState([]);
  var [query, setQuery] = React.useState('');
  var products = [
    { id: 1, name: 'Aurora Sneaker',  seller: 'LumenWear',  price: 129, rating: 4.7, reviews: 342, emoji: '👟', color: '#EC4899' },
    { id: 2, name: 'Minimal Wallet',  seller: 'FoldCo',     price: 48,  rating: 4.4, reviews: 189, emoji: '👝', color: '#F59E0B' },
    { id: 3, name: 'Ceramic Mug',     seller: 'Morning',    price: 22,  rating: 4.9, reviews: 812, emoji: '☕', color: '#06B6D4' },
    { id: 4, name: 'Noise Earbuds',   seller: 'Silencio',   price: 189, rating: 4.6, reviews: 523, emoji: '🎧', color: '#6366F1' },
    { id: 5, name: 'Desk Plant',      seller: 'Vert',       price: 34,  rating: 4.3, reviews: 127, emoji: '🪴', color: '#10B981' },
    { id: 6, name: 'Linen Shirt',     seller: 'Atelier',    price: 78,  rating: 4.5, reviews: 246, emoji: '👔', color: '#8B5CF6' },
  ];
  var filtered = query ? products.filter(function (p) { return p.name.toLowerCase().indexOf(query.toLowerCase()) !== -1; }) : products;
  var total = cart.reduce(function (n, p) { return n + p.price; }, 0);

  return (
    <div style={{ minHeight: '100vh', background: '#0A0F1C', color: '#E2E8F0', fontFamily: 'Inter,system-ui,-apple-system,Segoe UI,Roboto,sans-serif' }}>
      <header style={{ display: 'flex', alignItems: 'center', padding: '14px 28px', background: '#0F172A', borderBottom: '1px solid #1F2937', gap: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 30, height: 30, background: '#EC4899', borderRadius: 8 }} />
          <div style={{ fontWeight: 700, fontSize: 16, color: '#F8FAFC' }}>Pink Market</div>
        </div>
        <input value={query} onChange={function (e) { setQuery(e.target.value); }} placeholder="Search products…"
          style={{ flex: 1, maxWidth: 480, background: '#1F2937', border: '1px solid #334155', color: '#F8FAFC', padding: '8px 12px', borderRadius: 999, fontSize: 13, outline: 'none' }} />
        <div style={{ fontSize: 13, color: '#F8FAFC', fontWeight: 600 }}>🛒 {cart.length} &middot; \${total}</div>
      </header>
      <main style={{ padding: '24px 28px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: '#F8FAFC', margin: 0 }}>Featured products</h2>
          <div style={{ color: '#94A3B8', fontSize: 13 }}>{filtered.length} results</div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
          {filtered.map(function (p) { return <Card key={p.id} p={p} onAdd={function (x) { setCart(cart.concat([x])); }} />; })}
        </div>
      </main>
    </div>
  );
}

export default App;
`.trim();

// ─── Example #3: Booking platform ───────────────────────────────────────────
const BOOKING_APP = `
function App() {
  var today = new Date();
  var [day, setDay] = React.useState(15);
  var [slot, setSlot] = React.useState(null);
  var [confirmed, setConfirmed] = React.useState(false);

  var experiences = [
    { id: 1, title: 'Sunset Kayak Tour',  provider: 'Bay Outfitters', price: 65, duration: '2h',   rating: 4.9 },
    { id: 2, title: 'City Food Walk',     provider: 'Tasting Co',     price: 48, duration: '3h',   rating: 4.8 },
    { id: 3, title: 'Pottery Workshop',   provider: 'Clay Studio',    price: 80, duration: '2.5h', rating: 4.7 },
  ];
  var [picked, setPicked] = React.useState(experiences[0]);
  var days = [];
  for (var i = 1; i <= 30; i++) days.push(i);
  var slots = ['09:00', '11:30', '14:00', '16:30', '19:00'];

  function book() {
    if (!slot) return;
    // The mocked fetch() resolves with success and is logged to the parent.
    fetch('/api/bookings', { method: 'POST', body: JSON.stringify({ experience: picked.id, day: day, slot: slot }) });
    setConfirmed(true);
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0E1525', color: '#E2E8F0', fontFamily: 'Inter,system-ui,-apple-system,Segoe UI,Roboto,sans-serif' }}>
      <header style={{ padding: '16px 32px', background: '#0A0F1C', borderBottom: '1px solid #1F2937', display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ width: 30, height: 30, background: '#14B8A6', borderRadius: 8 }} />
        <div style={{ fontWeight: 700, color: '#F8FAFC', fontSize: 16 }}>Wayfarer</div>
        <div style={{ flex: 1 }} />
        <div style={{ color: '#94A3B8', fontSize: 13 }}>Help &middot; Sign in</div>
      </header>
      <main style={{ maxWidth: 1100, margin: '0 auto', padding: 28, display: 'grid', gridTemplateColumns: '360px 1fr', gap: 24 }}>
        <aside>
          <div style={{ color: '#64748B', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: 8 }}>Experiences</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {experiences.map(function (e) {
              var a = e.id === picked.id;
              return (
                <button key={e.id} onClick={function(){ setPicked(e); setConfirmed(false); }}
                  style={{ textAlign: 'left', padding: 14, borderRadius: 12, border: '1px solid ' + (a ? '#14B8A6' : '#1F2937'), background: a ? 'rgba(20,184,166,0.08)' : '#111827', cursor: 'pointer', color: '#E2E8F0' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ fontWeight: 600, color: '#F8FAFC' }}>{e.title}</div>
                    <div style={{ color: '#14B8A6', fontWeight: 700 }}>\${e.price}</div>
                  </div>
                  <div style={{ color: '#94A3B8', fontSize: 12, marginTop: 4 }}>{e.provider} &middot; {e.duration}</div>
                  <div style={{ color: '#F59E0B', fontSize: 12, marginTop: 4 }}>★ {e.rating}</div>
                </button>
              );
            })}
          </div>
        </aside>
        <section style={{ background: '#111827', border: '1px solid #1F2937', borderRadius: 14, padding: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ margin: 0, color: '#F8FAFC', fontSize: 20, fontWeight: 700 }}>{picked.title}</h2>
            <div style={{ fontSize: 13, color: '#94A3B8' }}>{picked.duration} &middot; ★ {picked.rating}</div>
          </div>
          <p style={{ color: '#94A3B8', fontSize: 13, marginTop: 8, lineHeight: 1.5 }}>
            Join a small group and experience {picked.title.toLowerCase()} with {picked.provider}. Includes all equipment, a guided tour, and a complimentary local snack.
          </p>

          <div style={{ marginTop: 18, color: '#64748B', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.1em' }}>Pick a day — April 2026</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(10, 1fr)', gap: 4, marginTop: 8 }}>
            {days.map(function (d) {
              var a = d === day;
              return <button key={d} onClick={function(){ setDay(d); setConfirmed(false); }}
                style={{ padding: '8px 0', borderRadius: 6, border: 0, cursor: 'pointer', fontSize: 12, fontWeight: 600, background: a ? '#14B8A6' : '#1F2937', color: a ? '#0E1525' : '#CBD5E1' }}>{d}</button>;
            })}
          </div>

          <div style={{ marginTop: 18, color: '#64748B', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.1em' }}>Available times</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            {slots.map(function (s) {
              var a = s === slot;
              return <button key={s} onClick={function(){ setSlot(s); setConfirmed(false); }}
                style={{ padding: '9px 14px', borderRadius: 999, border: '1px solid ' + (a ? '#14B8A6' : '#334155'), background: a ? '#14B8A6' : 'transparent', color: a ? '#0E1525' : '#CBD5E1', cursor: 'pointer', fontWeight: 600, fontSize: 12 }}>{s}</button>;
            })}
          </div>

          <button onClick={book} disabled={!slot}
            style={{ marginTop: 22, width: '100%', padding: '14px 0', borderRadius: 10, border: 0, background: slot ? '#14B8A6' : '#334155', color: slot ? '#0E1525' : '#94A3B8', fontSize: 14, fontWeight: 700, cursor: slot ? 'pointer' : 'not-allowed' }}>
            {confirmed ? 'Booking confirmed ✓' : (slot ? 'Book for April ' + day + ' at ' + slot : 'Pick a time')}
          </button>
          {confirmed && <div style={{ color: '#34D399', fontSize: 12, marginTop: 10 }}>Confirmation sent to preview@wayfarer.local (mocked).</div>}
        </section>
      </main>
    </div>
  );
}

export default App;
`.trim();

// ─── Registry ───────────────────────────────────────────────────────────────
export const EXAMPLE_PROJECTS: ExampleProject[] = [
  {
    id: 'example-saas-dashboard',
    name: 'Nebula — SaaS Dashboard',
    tagline: 'Metrics, customers, revenue at a glance.',
    description:
      'A modern SaaS admin dashboard with MRR/ARR stat cards, an activity sparkline per metric, a customer table with status pills, and a left-rail navigation. Built as a single-file React app — no state management library needed.',
    tags: ['dashboard', 'analytics', 'internal-tool'],
    thumbnail: THUMB_SAAS,
    files: [{ path: 'src/App.jsx', content: SAAS_DASHBOARD_APP }],
  },
  {
    id: 'example-marketplace',
    name: 'Pink Market — Marketplace',
    tagline: 'Browse, search, and add products to cart.',
    description:
      'A product marketplace with a searchable catalog, grid of product cards with seller, rating, and pricing, and a header cart that updates in real time. Demonstrates controlled inputs, list filtering, and optimistic UI updates.',
    tags: ['e-commerce', 'storefront', 'consumer'],
    thumbnail: THUMB_MARKET,
    files: [{ path: 'src/App.jsx', content: MARKETPLACE_APP }],
  },
  {
    id: 'example-booking',
    name: 'Wayfarer — Booking Platform',
    tagline: 'Pick a day, pick a time, confirm a reservation.',
    description:
      'A reservation flow for local experiences: selectable experience list, a month calendar with active day highlighting, time-slot chips, and a mock confirmation step that POSTs to /api/bookings (intercepted by the preview mock layer).',
    tags: ['booking', 'calendar', 'consumer'],
    thumbnail: THUMB_BOOKING,
    files: [{ path: 'src/App.jsx', content: BOOKING_APP }],
  },
];
