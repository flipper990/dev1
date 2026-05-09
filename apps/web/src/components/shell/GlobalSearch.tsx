'use client';

import { GlobalCommandBar } from './GlobalCommandBar';

interface GlobalSearchProps {
  value?: string;
  placeholder?: string;
  onChange?: (value: string) => void;
  onSubmit?: (value: string) => void;
  className?: string;
}

export function GlobalSearch(props: GlobalSearchProps) {
  return <GlobalCommandBar {...props} />;
}
