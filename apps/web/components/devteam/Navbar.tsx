'use client';

import { Bell, Menu, Search } from 'lucide-react';
import { cn } from '../../lib/cn';
import { ProjectIdChip } from './ProjectIdChip';

const NAV_ITEMS = ['Home', 'Agents', 'Projects', 'Settings'] as const;

export interface NavbarProps {
  onMenuClick?: () => void;
  active?: (typeof NAV_ITEMS)[number];
  /** The currently-selected projectId, surfaced in the header so the
   *  user can confirm at a glance which backend record drives every
   *  panel below. Cross-checked against `[devteam] identity` console
   *  logs and the dev-only debug overlay in PreviewStage. */
  selectedProjectId?: string | null;
}

export function Navbar({ onMenuClick, active = 'Home', selectedProjectId }: NavbarProps) {
  return (
    <header
      className="fixed top-0 inset-x-0 z-50 flex items-center justify-between px-4 lg:px-6"
      style={{
        height: 56,
        background: 'rgba(13,15,18,0.85)',
        backdropFilter: 'blur(12px)',
        borderBottom: '1px solid var(--border-subtle)',
      }}
    >
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onMenuClick}
          className="lg:hidden rounded-md p-2 hover:bg-[var(--bg-elevated)]"
          aria-label="Open menu"
        >
          <Menu size={18} />
        </button>
        <div className="flex items-center gap-2">
          <div
            className="h-7 w-7 rounded-md grid place-items-center"
            style={{ background: 'linear-gradient(135deg,#F59E0B,#3B82F6)' }}
          >
            <span className="text-[11px] font-black text-[var(--bg-void)]">DT</span>
          </div>
          <span className="text-[15px] font-semibold tracking-tight">DEVteam</span>
        </div>
        <nav className="hidden md:flex items-center gap-1 ml-6">
          {NAV_ITEMS.map((item) => (
            <a
              key={item}
              href="#"
              className={cn(
                'px-3 py-1.5 rounded-md text-[13px] font-medium',
                item === active
                  ? 'text-[var(--text-primary)] bg-[var(--bg-elevated)]'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]',
              )}
            >
              {item}
            </a>
          ))}
        </nav>
      </div>

      <div className="flex items-center gap-2">
        {selectedProjectId && selectedProjectId !== '__new__' ? (
          <div className="hidden md:flex items-center gap-1.5 mr-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
              Active
            </span>
            <ProjectIdChip id={selectedProjectId} truncate size="sm" />
          </div>
        ) : null}
        <div className="hidden sm:flex items-center gap-2 px-3 h-8 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[12px] text-[var(--text-secondary)] w-56">
          <Search size={13} />
          <input
            type="text"
            placeholder="Search projects, agents…"
            className="bg-transparent outline-none flex-1 placeholder:text-[var(--text-secondary)]"
          />
        </div>
        <button
          type="button"
          aria-label="Notifications"
          className="relative h-9 w-9 rounded-md grid place-items-center hover:bg-[var(--bg-elevated)]"
        >
          <Bell size={16} />
          <span
            className="absolute top-2 right-2 h-1.5 w-1.5 rounded-full"
            style={{ background: 'var(--accent-amber)' }}
          />
        </button>
        <div
          className="h-8 w-8 rounded-full grid place-items-center text-[12px] font-bold text-[var(--bg-void)]"
          style={{ background: 'linear-gradient(135deg,#F59E0B,#3B82F6)' }}
        >
          AJ
        </div>
      </div>
    </header>
  );
}
