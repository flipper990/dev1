'use client';
import { Bot, FolderOpen } from 'lucide-react';
import { useStore } from '../lib/store';
import { AgentPipeline } from './AgentPipeline';
import { FileExplorer } from './FileExplorer';
import { cn } from '../lib/cn';

export function RightPanel() {
  const { rightPanelTab, setRightPanelTab } = useStore();

  return (
    <aside
      className="flex flex-col border-l border-white/[0.06] bg-[#0B0F19]/60 overflow-hidden flex-shrink-0"
      style={{ width: 'var(--right-w)' }}
    >
      {/* Tabs */}
      <div className="flex border-b border-white/[0.06] flex-shrink-0">
        {(['agents', 'files'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setRightPanelTab(tab)}
            className={cn(
              'flex-1 flex items-center justify-center gap-1.5 py-2.5 text-[12px] font-medium border-b-2 transition-colors',
              rightPanelTab === tab
                ? 'text-[#3B82F6] border-[#3B82F6]'
                : 'text-[#64748B] border-transparent hover:text-[#CBD5E1]',
            )}
          >
            {tab === 'agents' ? <Bot size={13} /> : <FolderOpen size={13} />}
            {tab === 'agents' ? 'Agents' : 'Files'}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {rightPanelTab === 'agents' ? <AgentPipeline /> : <FileExplorer />}
      </div>
    </aside>
  );
}
