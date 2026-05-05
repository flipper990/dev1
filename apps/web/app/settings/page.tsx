'use client';

import { useState } from 'react';
import { TopNav } from '../../components/dashboard/TopNav';
import { Card } from '../../components/ui/Card';
import { Sparkle } from '../../components/ui/Sparkle';

const SECTIONS = [
  { id: 'general',     label: 'General' },
  { id: 'workspace',   label: 'Workspace' },
  { id: 'agents',      label: 'Agents & Models' },
  { id: 'billing',     label: 'Billing' },
  { id: 'integrations',label: 'Integrations' },
  { id: 'security',    label: 'Security' },
  { id: 'danger',      label: 'Danger Zone' },
];

export default function SettingsPage() {
  const [active, setActive] = useState('general');
  return (
    <div className="cosmic-root">
      <TopNav />
      <main className="max-w-[1280px] mx-auto px-7 pb-16">
        <section className="pt-6 pb-8">
          <h1 className="font-display text-5xl text-primary leading-tight tracking-[-0.02em]">
            Settings
          </h1>
          <p className="text-secondary mt-2 max-w-xl">
            Configure how your workspace looks, behaves, and bills.
          </p>
        </section>

        <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-7">
          {/* Settings nav */}
          <aside className="cn-card p-2 h-fit">
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setActive(s.id)}
                className={
                  'w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors ' +
                  (active === s.id
                    ? 'bg-gold-500/12 text-gold-200 border border-gold-300/30'
                    : s.id === 'danger'
                      ? 'text-error/80 hover:bg-error/10'
                      : 'text-secondary hover:bg-white/[0.04]')
                }
              >
                <span>{s.label}</span>
                {s.id === 'danger' && <Sparkle size={11} />}
              </button>
            ))}
          </aside>

          <div className="flex flex-col gap-5">
            {active === 'danger' ? (
              <Card>
                <div className="flex items-center gap-2 mb-1 text-error">
                  <span className="text-[11px] uppercase tracking-[0.18em]">Danger Zone</span>
                </div>
                <div className="font-display text-2xl text-primary mb-1">Delete workspace</div>
                <p className="text-xs text-secondary mb-4 max-w-md">
                  This permanently removes every project, generated artifact, and
                  preview container. There is no undo.
                </p>
                <button className="cn-btn !bg-error/15 !text-error !border-error/40 hover:!bg-error/25">
                  Delete this workspace
                </button>
              </Card>
            ) : (
              <Card>
                <div className="font-display text-2xl text-primary mb-5">
                  {SECTIONS.find((s) => s.id === active)?.label}
                </div>

                <div className="cn-form-row">
                  <div>
                    <div className="cn-form-label">Workspace name</div>
                    <div className="cn-form-help">Shown in the top bar and on shared links.</div>
                  </div>
                  <input className="cn-input" defaultValue="DEVteam" />
                </div>

                <div className="cn-form-row">
                  <div>
                    <div className="cn-form-label">Default stack</div>
                    <div className="cn-form-help">Picked by spec when nothing is specified.</div>
                  </div>
                  <select className="cn-input">
                    <option>Next.js + Fastify + Postgres</option>
                    <option>Next.js + tRPC + Prisma</option>
                    <option>Vite + Express</option>
                  </select>
                </div>

                <div className="cn-form-row">
                  <div>
                    <div className="cn-form-label">Timezone</div>
                    <div className="cn-form-help">For build timestamps and analytics.</div>
                  </div>
                  <input className="cn-input" defaultValue="UTC" />
                </div>

                <div className="cn-form-row">
                  <div>
                    <div className="cn-form-label">Language</div>
                    <div className="cn-form-help">Interface + system prompts language.</div>
                  </div>
                  <select className="cn-input">
                    <option>English</option>
                    <option>Spanish</option>
                    <option>German</option>
                  </select>
                </div>

                <div className="cn-form-row">
                  <div>
                    <div className="cn-form-label">Avatar</div>
                    <div className="cn-form-help">Used across nav and project cards.</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-full bg-gradient-to-br from-gold-300 to-gold-600 grid place-items-center text-ink font-semibold">
                      A
                    </div>
                    <button className="cn-btn cn-btn--ghost">Upload</button>
                    <button className="cn-btn cn-btn--ghost">Remove</button>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-3 pt-5">
                  <button className="cn-btn cn-btn--ghost">Cancel</button>
                  <button className="cn-btn cn-btn--gold">Save Changes</button>
                </div>
              </Card>
            )}

            <Card>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="font-display text-lg text-primary mb-1">Export data</div>
                  <div className="text-xs text-secondary max-w-md">
                    Download a zip of every project, including generated source code,
                    spec history, and prompt logs.
                  </div>
                </div>
                <button className="cn-btn cn-btn--ghost">Request export</button>
              </div>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}
