import assert from 'node:assert/strict';
import test from 'node:test';
import { sanitizeUIFoundation } from './ui-foundation.js';
import type { ProjectFile } from './generator-types.js';

function file(path: string, content: string): ProjectFile {
  return { path, content, language: 'typescriptreact' };
}

test('sanitizeUIFoundation repairs broken Alert contract missing className support', () => {
  const fileMap = new Map<string, ProjectFile>([
    ['src/app/page.tsx', file('src/app/page.tsx', 'export default function Page(){ return <main>ok</main>; }\n')],
    ['src/components/ui/Alert.tsx', file(
      'src/components/ui/Alert.tsx',
      [
        'import type { ReactNode } from "react";',
        '',
        'export interface AlertProps {',
        '  children: ReactNode;',
        '  variant?: "default" | "destructive";',
        '}',
        '',
        'export function Alert({ children, variant = "default" }: AlertProps) {',
        '  return <div>{children}</div>;',
        '}',
        '',
      ].join('\n'),
    )],
  ]);

  sanitizeUIFoundation(fileMap);
  const alert = fileMap.get('src/components/ui/Alert.tsx')?.content ?? '';
  assert.match(alert, /AlertProps extends React\.HTMLAttributes<\s*HTMLDivElement\s*>/);
  assert.match(alert, /function Alert\(\{ className, variant, \.\.\.props \}: AlertProps\)/);
});

test('sanitizeUIFoundation keeps compatible Alert contract unchanged', () => {
  const original = [
    "import * as React from 'react';",
    "import { cva, type VariantProps } from 'class-variance-authority';",
    "import { cn } from '@/lib/cn';",
    '',
    "const alertVariants = cva('relative w-full rounded-lg border p-4 text-sm', {",
    '  variants: { variant: {',
    "    default: 'bg-background text-foreground border-border',",
    "    destructive: 'bg-destructive/5 text-foreground border-destructive/40',",
    '  } },',
    "  defaultVariants: { variant: 'default' },",
    '});',
    '',
    'export interface AlertProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof alertVariants> {}',
    'export function Alert({ className, variant, ...props }: AlertProps) {',
    '  return <div role="alert" className={cn(alertVariants({ variant }), className)} {...props} />;',
    '}',
    '',
  ].join('\n');

  const fileMap = new Map<string, ProjectFile>([
    ['src/app/page.tsx', file('src/app/page.tsx', 'export default function Page(){ return <main>ok</main>; }\n')],
    ['src/components/ui/Alert.tsx', file('src/components/ui/Alert.tsx', original)],
  ]);

  sanitizeUIFoundation(fileMap);
  const alert = fileMap.get('src/components/ui/Alert.tsx')?.content ?? '';
  assert.equal(alert, original);
});

test('sanitizeUIFoundation repairs Button contract to support link-like usage', () => {
  const fileMap = new Map<string, ProjectFile>([
    ['src/app/page.tsx', file('src/app/page.tsx', 'export default function Page(){ return <main>ok</main>; }\n')],
    ['src/components/ui/Button.tsx', file(
      'src/components/ui/Button.tsx',
      [
        "import * as React from 'react';",
        'export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {',
        '  loading?: boolean;',
        '}',
        'export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(',
        '  ({ children, ...props }, ref) => <button ref={ref} {...props}>{children}</button>,',
        ');',
        '',
      ].join('\n'),
    )],
  ]);

  sanitizeUIFoundation(fileMap);
  const button = fileMap.get('src/components/ui/Button.tsx')?.content ?? '';
  assert.match(button, /type ButtonAsAnchorProps/);
  assert.match(button, /as: 'a'/);
  assert.match(button, /variant: 'primary'/);
  assert.match(button, /size: 'md'/);
});

test('sanitizeUIFoundation rewrites unsafe asChild polymorphic Button contract', () => {
  const fileMap = new Map<string, ProjectFile>([
    ['src/app/page.tsx', file('src/app/page.tsx', 'export default function Page(){ return <main>ok</main>; }\n')],
    ['src/components/ui/Button.tsx', file(
      'src/components/ui/Button.tsx',
      [
        "import * as React from 'react';",
        "import Link from 'next/link';",
        "import { cn } from '@/lib/cn';",
        "type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean; className?: string };",
        'export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(',
        '  ({ asChild, className, ...props }, ref) => {',
        "    const Comp = asChild ? Link : 'button';",
        '    return (',
        '      <Comp ref={ref as any} className={cn("btn", className)} {...props} />',
        '    );',
        '  }',
        ');',
        '',
      ].join('\n'),
    )],
  ]);

  sanitizeUIFoundation(fileMap);
  const button = fileMap.get('src/components/ui/Button.tsx')?.content ?? '';
  assert.match(button, /type ButtonAsAnchorProps/);
  assert.match(button, /as: 'a'/);
  assert.match(button, /export type ButtonProps = ButtonAsButtonProps \| ButtonAsAnchorProps/);
  assert.doesNotMatch(button, /\basChild\b/);
  assert.doesNotMatch(button, /\bconst\s+Comp\s*=\s*asChild/);
});

test('sanitizeUIFoundation rewrites Alert contract when variant prop is missing', () => {
  const fileMap = new Map<string, ProjectFile>([
    ['src/app/page.tsx', file('src/app/page.tsx', 'export default function Page(){ return <main>ok</main>; }\n')],
    ['src/components/ui/Alert.tsx', file(
      'src/components/ui/Alert.tsx',
      [
        "import * as React from 'react';",
        "import { cn } from '@/lib/cn';",
        'export interface AlertProps extends React.HTMLAttributes<HTMLDivElement> {}',
        'export function Alert({ className, ...props }: AlertProps) {',
        '  return <div className={cn("border p-2", className)} {...props} />;',
        '}',
        '',
      ].join('\n'),
    )],
  ]);

  sanitizeUIFoundation(fileMap);
  const alert = fileMap.get('src/components/ui/Alert.tsx')?.content ?? '';
  assert.match(alert, /const alertVariants = cva\(/);
  assert.match(alert, /VariantProps<typeof alertVariants>/);
  assert.match(alert, /function Alert\(\{ className, variant, \.\.\.props \}: AlertProps\)/);
  assert.match(alert, /alertVariants\(\{ variant \}\)/);
});

test('sanitizeUIFoundation repairs dashboard ActivityItem contract when feed passes activity prop', () => {
  const fileMap = new Map<string, ProjectFile>([
    ['src/app/page.tsx', file('src/app/page.tsx', 'export default function Page(){ return <main>ok</main>; }\n')],
    ['src/components/dashboard/ActivityFeed.tsx', file(
      'src/components/dashboard/ActivityFeed.tsx',
      [
        "import { ActivityItem } from './ActivityItem';",
        'type Activity = { id: string; label: string };',
        'export function ActivityFeed({ items }: { items: Activity[] }) {',
        '  return <ul>{items.map((activity) => <li key={activity.id}><ActivityItem activity={activity} /></li>)}</ul>;',
        '}',
        '',
      ].join('\n'),
    )],
    ['src/components/dashboard/ActivityItem.tsx', file(
      'src/components/dashboard/ActivityItem.tsx',
      [
        "import * as React from 'react';",
        'export interface ActivityItemProps extends React.HTMLAttributes<HTMLDivElement> {',
        '  item: { id: string; label: string };',
        '}',
        'export function ActivityItem({ item }: ActivityItemProps) {',
        '  return <div>{item.label}</div>;',
        '}',
        '',
      ].join('\n'),
    )],
  ]);

  sanitizeUIFoundation(fileMap);
  const activityItem = fileMap.get('src/components/dashboard/ActivityItem.tsx')?.content ?? '';
  assert.match(activityItem, /\bactivity\?: ActivityRecord;/);
  assert.match(activityItem, /\bitem\?: ActivityRecord;/);
  assert.match(activityItem, /export function ActivityItem\(\{ activity, item, className, \.\.\.props \}: ActivityItemProps\)/);
});

test('sanitizeUIFoundation replaces unsafe tailwind typography fontWeight alias', () => {
  const unsafeTailwind = [
    "import type { Config } from 'tailwindcss';",
    "import { typography } from './src/lib/design-tokens';",
    '',
    'const config: Config = {',
    "  content: ['./src/**/*.{ts,tsx}'],",
    '  theme: {',
    '    extend: {',
    '      fontWeight: typography.fontWeight,',
    '    },',
    '  },',
    '};',
    '',
    'export default config;',
    '',
  ].join('\n');

  const fileMap = new Map<string, ProjectFile>([
    ['src/app/page.tsx', file('src/app/page.tsx', 'export default function Page(){ return <main>ok</main>; }\n')],
    ['tailwind.config.ts', { path: 'tailwind.config.ts', content: unsafeTailwind, language: 'typescript' }],
  ]);

  sanitizeUIFoundation(fileMap);
  const patched = fileMap.get('tailwind.config.ts')?.content ?? '';
  assert.match(patched, /\bcontent\s*:\s*\[/);
  assert.doesNotMatch(patched, /\bfontWeight\s*:\s*typography\.fontWeight\b/);
});
