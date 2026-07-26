'use client';

import { Tabs, type TabItem } from '../../../../components/ui';

export const WORKSPACE_TABS: TabItem[] = [
  { id: 'code', label: 'Code' },
  { id: 'preview', label: 'Preview' },
  { id: 'logs', label: 'Logs' },
  { id: 'diagnostics', label: 'Diagnostics' },
];

export type WorkspaceTabId = (typeof WORKSPACE_TABS)[number]['id'];

interface WorkspaceTabsProps {
  value: WorkspaceTabId;
  onChange: (tab: WorkspaceTabId) => void;
}

export function normalizeWorkspaceTab(value: string | null): WorkspaceTabId {
  if (value === 'overview') return 'code';
  if (value === 'preview') return 'preview';
  if (value === 'build' || value === 'activity') return 'logs';
  if (value === 'verify' || value === 'export' || value === 'launch') return 'diagnostics';
  return WORKSPACE_TABS.some((tab) => tab.id === value) ? (value as WorkspaceTabId) : 'code';
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
