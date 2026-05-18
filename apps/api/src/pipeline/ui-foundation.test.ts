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
    'export interface AlertProps extends React.HTMLAttributes<HTMLDivElement> {',
    "  variant?: 'default' | 'destructive';",
    '}',
    'export function Alert({ className, ...props }: AlertProps) {',
    '  return <div className={className} {...props} />;',
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
