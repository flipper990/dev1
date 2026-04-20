'use client';
import { useState } from 'react';
import { ChevronLeft, ChevronRight, Search, MoreVertical, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useStore } from '../lib/store';
import { cn } from '../lib/cn';
import type { GeneratedProject } from '../types/dashboard';

const STATUS_DOT: Record<GeneratedProject['status'], string> = {
  generating: '#3B82F6',
  completed:  '#22C55E',
  failed:     '#EF4444',
};

const STATUS_LABEL: Record<GeneratedProject['status'], string> = {
  generating: 'Building…',
  completed:  'Done',
  failed:     'Failed',
};

function fmt(ms: number): string {
  if (!ms) return '';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function Sidebar() {
  const {
    projects, selectedProjectId, sidebarCollapsed,
    setSelectedProjectId, toggleSidebar,
  } = useStore();

  const [search, setSearch] = useState('');
  const filtered = projects.filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase())
  );

  if (sidebarCollapsed) {
    return (
      <aside
        className="flex flex-col border-r border-white/[0.06] bg-[#0B0F19]/60 overflow-hidden flex-shrink-0 transition-all"
        style={{ width: 'var(--sidebar-collapsed-w)' }}
      >
        <div className="flex items-center justify-center p-2 border-b border-white/[0.06]" style={{ height: 'var(--header-h)' }}>
          <button
            onClick={toggleSidebar}
            title="Expand sidebar"
            className="flex items-center justify-center w-7 h-7 rounded text-[#64748B] hover:bg-white/[0.06] hover:text-[#F1F5F9] transition-colors"
          >
            <PanelLeftOpen size={15} />
          </button>
        </div>
      </aside>
    );
  }

  return (
    <aside
      className="flex flex-col border-r border-white/[0.06] bg-[#0B0F19]/60 overflow-hidden flex-shrink-0 transition-all"
      style={{ width: 'var(--sidebar-w)' }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 border-b border-white/[0.06] flex-shrink-0" style={{ height: 'var(--header-h)' }}>
        <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#64748B]">Projects</span>
        <button
          onClick={toggleSidebar}
          title="Collapse sidebar"
          className="flex items-center justify-center w-7 h-7 rounded text-[#64748B] hover:bg-white/[0.06] hover:text-[#F1F5F9] transition-colors"
        >
          <PanelLeftClose size={15} />
        </button>
      </div>

      {/* Search */}
      <div className="px-3 py-2 flex-shrink-0">
        <div className="relative">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#64748B] pointer-events-none" />
          <input
            className="w-full bg-white/[0.04] border border-white/[0.06] rounded pl-7 pr-2.5 py-1.5 text-[12px] text-[#F1F5F9] outline-none placeholder:text-[#64748B] focus:border-white/10 transition-colors"
            placeholder="Search projects…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-2 py-1 flex flex-col gap-0.5">
        {filtered.length === 0 && (
          <p className="px-3 py-8 text-center text-[#64748B] text-[12px] leading-relaxed">
            {projects.length === 0
              ? 'No projects yet.\nGenerate one to get started.'
              : 'No matches.'}
          </p>
        )}
        {filtered.map((project) => (
          <ProjectItem
            key={project.id}
            project={project}
            isActive={selectedProjectId === project.id}
            onClick={() => setSelectedProjectId(project.id)}
          />
        ))}
      </div>
    </aside>
  );
}

function ProjectItem({
  project, isActive, onClick,
}: {
  project: GeneratedProject;
  isActive: boolean;
  onClick: () => void;
}) {
  const [hover, setHover] = useState(false);

  return (
    <button
      className={cn(
        'group relative flex items-start gap-2 w-full text-left px-2.5 py-2 rounded border transition-all',
        isActive
          ? 'border-l-2 border-l-[#60A5FA] border-t-transparent border-r-transparent border-b-transparent bg-[#3B82F6]/10 pl-2'
          : 'border-transparent hover:bg-white/[0.04] hover:border-white/[0.06]',
      )}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {/* Status dot */}
      <span
        className="mt-1 w-1.5 h-1.5 rounded-full flex-shrink-0"
        style={{
          background: STATUS_DOT[project.status],
          boxShadow: project.status === 'generating' ? `0 0 6px ${STATUS_DOT[project.status]}` : undefined,
        }}
      />

      {/* Content */}
      <span className="flex-1 min-w-0">
        <span className={cn('block text-[12px] font-medium overflow-hidden text-ellipsis whitespace-nowrap', isActive ? 'text-[#F1F5F9]' : 'text-[#CBD5E1]')}>
          {project.name}
        </span>
        <span className="block text-[11px] text-[#64748B] mt-0.5">
          {project.status === 'generating' ? 'Building…' : fmt(project.durationMs)}
          {project.totalCostUsd ? ` · $${project.totalCostUsd.toFixed(4)}` : ''}
        </span>
      </span>

      {/* Hover menu */}
      {hover && (
        <span
          className="flex-shrink-0 flex items-center justify-center w-5 h-5 rounded text-[#64748B] hover:text-[#F1F5F9] hover:bg-white/[0.08] transition-colors"
          onClick={(e) => e.stopPropagation()}
          title="Options"
        >
          <MoreVertical size={13} />
        </span>
      )}
    </button>
  );
}

