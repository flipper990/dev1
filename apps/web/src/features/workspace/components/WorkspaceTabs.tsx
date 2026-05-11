'use client';

import { Tabs, type TabItem } from '../../../../components/ui';

export const WORKSPACE_TABS: TabItem[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'preview', label: 'Preview details' },
  { id: 'build', label: 'Build' },
  { id: 'verify', label: 'Verify' },
  { id: 'activity', label: 'Activity' },
  { id: 'logs', label: 'Logs' },
  { id: 'export', label: 'Export / Launch' },
];

export type WorkspaceTabId = (typeof WORKSPACE_TABS)[number]['id'];

interface WorkspaceTabsProps {
  value: WorkspaceTabId;
  onChange: (tab: WorkspaceTabId) => void;
}

export function normalizeWorkspaceTab(value: string | null): WorkspaceTabId {
  if (value === 'launch') return 'export';
  return WORKSPACE_TABS.some((tab) => tab.id === value) ? (value as WorkspaceTabId) : 'overview';
}

export function WorkspaceTabs({ value, onChange }: WorkspaceTabsProps) {
  return (
    <Tabs
      items={WORKSPACE_TABS}
      value={value}
      onChange={(tab) => onChange(normalizeWorkspaceTab(tab))}
      ariaLabel="Workspace sections"
    />
  );
}
