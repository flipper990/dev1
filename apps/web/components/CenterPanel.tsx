'use client';

import { Bot, FolderOpen } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useStore } from '../lib/store';
import { cn } from '../lib/cn';
import { PromptPanel, type PromptPanelProps } from './PromptPanel';
import { PhaseProgress } from './PhaseProgress';
import { AgentPipeline } from './AgentPipeline';
import { FileExplorer } from './FileExplorer';

/**
 * CenterPanel — the "AI control" column of the dashboard.
 *
 *   ┌───────────────────────────┐
 *   │  PromptPanel  (chat)      │
 *   │  (Generate / Update /     │
 *   │   Fix Issues / Download)  │
 *   ├───────────────────────────┤
 *   │  PhaseProgress            │
 *   │  4 friendly phases        │
 *   ├───────────────────────────┤
 *   │  Tabs: Agents | Files     │
 *   │  (detail view)            │
 *   └───────────────────────────┘
 */
export function CenterPanel(props: PromptPanelProps) {
  const { rightPanelTab, setRightPanelTab } = useStore();

  return (
    <main className="main-workspace flex-1 flex flex-col overflow-hidden min-w-0">
      <PromptPanel {...props} />

      <PhaseProgress />

      {/* Agents / Files tabs */}
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

      <div className="flex-1 overflow-y-auto">
        <AnimatePresence mode="wait">
          <motion.div
            key={rightPanelTab}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className="h-full"
          >
            {rightPanelTab === 'agents' ? <AgentPipeline /> : <FileExplorer />}
          </motion.div>
        </AnimatePresence>
      </div>
    </main>
  );
}
