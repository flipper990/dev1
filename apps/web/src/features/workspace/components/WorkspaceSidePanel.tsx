import type { ReactNode } from 'react';

interface WorkspaceSidePanelProps {
  children: ReactNode;
}

export function WorkspaceSidePanel({ children }: WorkspaceSidePanelProps) {
  return <div className="space-y-4">{children}</div>;
}
