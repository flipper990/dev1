// UI Foundation injection — extracted from ProjectGenerator.
// Guarantees essential primitive files exist so generated frontends always compile.
// Called by assembleProject() only when frontend files are detected.

import type { AgentRole } from '../../../packages/agent-core/src/types.js';
import type { ProjectFile } from './generator-types.js';

export function injectUIFoundation(
  fileMap: Map<string, ProjectFile>,
  artifacts: Map<AgentRole, Record<string, unknown>>,
): void {
  const hasFrontend = [...fileMap.keys()].some(
    p => /\.(tsx|jsx|vue|svelte)$/.test(p) || /(\/app\/|\/pages\/|\/components\/)/.test(p),
  );
  if (!hasFrontend) return;

  const spec = artifacts.get('architect') as {
    designSystem?: {
      colorPalette?: Record<string, string>;
      typography?: { fontFamily?: string; fontFamilyMono?: string };
      borderRadius?: Record<string, string>;
      shadows?: Record<string, string>;
    };
  } | undefined;

  const colors = spec?.designSystem?.colorPalette ?? {};
  const fontFamily = spec?.designSystem?.typography?.fontFamily ?? 'Inter, system-ui, sans-serif';
  const fontFamilyMono = spec?.designSystem?.typography?.fontFamilyMono ?? 'ui-monospace, monospace';
  const radii = spec?.designSystem?.borderRadius ?? {};
  const shadows = spec?.designSystem?.shadows ?? {};

  if (!fileMap.has('src/lib/cn.ts')) {
    fileMap.set('src/lib/cn.ts', {
      path: 'src/lib/cn.ts',
      content: ["import { clsx, type ClassValue } from 'clsx';", "import { twMerge } from 'tailwind-merge';", '', 'export function cn(...inputs: ClassValue[]) {', '  return twMerge(clsx(inputs));', '}', ''].join('\n'),
      language: 'typescript',
    });
  }

  if (!fileMap.has('tailwind.config.ts')) {
    const colorEntries = Object.entries(colors).map(([k, v]) => `      '${k}': '${v}',`).join('\n');
    const radiusEntries = Object.entries(radii).map(([k, v]) => `      '${k}': '${v}',`).join('\n');
    const shadowEntries = Object.entries(shadows).map(([k, v]) => `      '${k}': '${v}',`).join('\n');

    fileMap.set('tailwind.config.ts', {
      path: 'tailwind.config.ts',
      content: [
        "import type { Config } from 'tailwindcss';", '',
        'const config: Config = {',
        "  content: ['./src/**/*.{ts,tsx}', './app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],",
        "  darkMode: 'class',",
        '  theme: { extend: {',
        '    colors: {', colorEntries, '    },',
        `    fontFamily: { sans: ['${fontFamily}'], mono: ['${fontFamilyMono}'] },`,
        '    borderRadius: {', radiusEntries, '    },',
        '    boxShadow: {', shadowEntries, '    },',
        '  } },',
        "  plugins: [require('tailwindcss-animate')],",
        '};', '', 'export default config;', '',
      ].join('\n'),
      language: 'typescript',
    });
  }

  if (!fileMap.has('src/components/ui/Button.tsx')) {
    fileMap.set('src/components/ui/Button.tsx', {
      path: 'src/components/ui/Button.tsx',
      content: [
        "import * as React from 'react';",
        "import { cva, type VariantProps } from 'class-variance-authority';",
        "import { cn } from '@/lib/cn';",
        "import { Spinner } from './Spinner';",
        '', 'const buttonVariants = cva(',
        "  'inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',",
        '  { variants: { variant: {',
        "    primary:     'bg-primary text-primary-foreground hover:bg-primary/90',",
        "    secondary:   'bg-secondary text-secondary-foreground hover:bg-secondary/80',",
        "    outline:     'border border-border bg-background hover:bg-muted hover:text-foreground',",
        "    ghost:       'hover:bg-muted hover:text-foreground',",
        "    destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',",
        "    link:        'text-primary underline-offset-4 hover:underline',",
        '  }, size: {',
        "    sm: 'h-8 px-3 text-xs', md: 'h-10 px-4 py-2', lg: 'h-11 px-6 text-base', icon: 'h-10 w-10',",
        "  } }, defaultVariants: { variant: 'primary', size: 'md' } },",
        ');', '',
        'export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {',
        '  loading?: boolean; leftIcon?: React.ReactNode; rightIcon?: React.ReactNode;',
        '}', '',
        'export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(',
        '  ({ className, variant, size, loading, leftIcon, rightIcon, children, disabled, ...props }, ref) => (',
        '    <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} disabled={disabled || loading} {...props}>',
        '      {loading ? <Spinner size="sm" /> : leftIcon}{children}{!loading && rightIcon}',
        '    </button>',
        '  ),',
        ");\nButton.displayName = 'Button';\n",
      ].join('\n'),
      language: 'typescriptreact',
    });
  }

  if (!fileMap.has('src/components/ui/Input.tsx')) {
    fileMap.set('src/components/ui/Input.tsx', {
      path: 'src/components/ui/Input.tsx',
      content: [
        "import * as React from 'react';", "import { cn } from '@/lib/cn';", '',
        'export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {',
        '  label?: string; error?: string; helperText?: string; leftElement?: React.ReactNode; rightElement?: React.ReactNode;',
        '}', '',
        'export const Input = React.forwardRef<HTMLInputElement, InputProps>(',
        '  ({ className, label, error, helperText, leftElement, rightElement, id, ...props }, ref) => {',
        '    const inputId = id ?? React.useId();',
        '    return (',
        '      <div className="flex flex-col gap-1.5">',
        '        {label && <label htmlFor={inputId} className="text-sm font-medium text-foreground">{label}{props.required && <span className="text-destructive ml-0.5">*</span>}</label>}',
        '        <div className="relative flex items-center">',
        '          {leftElement && <div className="absolute left-3 text-muted-foreground">{leftElement}</div>}',
        '          <input ref={ref} id={inputId}',
        "            className={cn('flex h-10 w-full rounded-md border border-border bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',",
        "              error && 'border-destructive focus-visible:ring-destructive/20', leftElement && 'pl-9', rightElement && 'pr-9', className)}",
        '            aria-invalid={!!error} aria-describedby={error ? `${inputId}-error` : helperText ? `${inputId}-helper` : undefined} {...props} />',
        '          {rightElement && <div className="absolute right-3 text-muted-foreground">{rightElement}</div>}',
        '        </div>',
        '        {error && <p id={`${inputId}-error`} role="alert" className="text-xs text-destructive">{error}</p>}',
        '        {!error && helperText && <p id={`${inputId}-helper`} className="text-xs text-muted-foreground">{helperText}</p>}',
        '      </div>',
        '    );',
        '  },',
        ");\nInput.displayName = 'Input';\n",
      ].join('\n'),
      language: 'typescriptreact',
    });
  }

  if (!fileMap.has('src/components/ui/Badge.tsx')) {
    fileMap.set('src/components/ui/Badge.tsx', {
      path: 'src/components/ui/Badge.tsx',
      content: [
        "import * as React from 'react';", "import { cva, type VariantProps } from 'class-variance-authority';", "import { cn } from '@/lib/cn';", '',
        "const badgeVariants = cva('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors', { variants: { variant: {",
        "  default: 'bg-primary/10 text-primary', secondary: 'bg-secondary text-secondary-foreground',",
        "  success: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',",
        "  warning: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',",
        "  destructive: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',",
        "  outline: 'border border-border text-foreground',",
        "} }, defaultVariants: { variant: 'default' } });", '',
        'export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}',
        'export function Badge({ className, variant, ...props }: BadgeProps) {',
        '  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;',
        '}', '',
      ].join('\n'),
      language: 'typescriptreact',
    });
  }

  if (!fileMap.has('src/components/ui/Card.tsx')) {
    fileMap.set('src/components/ui/Card.tsx', {
      path: 'src/components/ui/Card.tsx',
      content: [
        "import * as React from 'react';", "import { cn } from '@/lib/cn';", '',
        'export interface CardProps extends React.HTMLAttributes<HTMLDivElement> { hoverable?: boolean; }',
        'export function Card({ className, hoverable, ...props }: CardProps) {',
        "  return <div className={cn('rounded-lg border border-border bg-card text-card-foreground shadow-sm', hoverable && 'transition-shadow hover:shadow-md cursor-pointer', className)} {...props} />;",
        '}', '',
        'export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {',
        '  return <div className={cn("flex flex-col space-y-1.5 p-6", className)} {...props} />;',
        '}',
        'export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {',
        '  return <h3 className={cn("text-lg font-semibold leading-none tracking-tight", className)} {...props} />;',
        '}',
        'export function CardDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {',
        '  return <p className={cn("text-sm text-muted-foreground", className)} {...props} />;',
        '}',
        'export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {',
        '  return <div className={cn("p-6 pt-0", className)} {...props} />;',
        '}',
        'export function CardFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {',
        '  return <div className={cn("flex items-center p-6 pt-0", className)} {...props} />;',
        '}', '',
      ].join('\n'),
      language: 'typescriptreact',
    });
  }

  if (!fileMap.has('src/components/ui/Spinner.tsx')) {
    fileMap.set('src/components/ui/Spinner.tsx', {
      path: 'src/components/ui/Spinner.tsx',
      content: [
        "import * as React from 'react';", "import { cn } from '@/lib/cn';", '',
        "export interface SpinnerProps extends React.SVGAttributes<SVGElement> { size?: 'sm' | 'md' | 'lg'; }",
        "const sizeMap = { sm: 'w-4 h-4', md: 'w-6 h-6', lg: 'w-8 h-8' };",
        'export function Spinner({ size = "md", className, ...props }: SpinnerProps) {',
        '  return (',
        '    <svg className={cn("animate-spin text-current", sizeMap[size], className)} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true" {...props}>',
        '      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />',
        '      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />',
        '    </svg>',
        '  );',
        '}', '',
      ].join('\n'),
      language: 'typescriptreact',
    });
  }

  if (!fileMap.has('src/components/ui/Skeleton.tsx')) {
    fileMap.set('src/components/ui/Skeleton.tsx', {
      path: 'src/components/ui/Skeleton.tsx',
      content: ["import * as React from 'react';", "import { cn } from '@/lib/cn';", '', 'export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {', '  return <div className={cn("animate-pulse rounded-md bg-muted", className)} {...props} />;', '}', ''].join('\n'),
      language: 'typescriptreact',
    });
  }

  if (!fileMap.has('src/components/ui/EmptyState.tsx')) {
    fileMap.set('src/components/ui/EmptyState.tsx', {
      path: 'src/components/ui/EmptyState.tsx',
      content: [
        "import * as React from 'react';", "import { cn } from '@/lib/cn';", '',
        'export interface EmptyStateProps { icon?: React.ReactNode; title: string; description?: string; action?: React.ReactNode; className?: string; }',
        'export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {',
        '  return (',
        '    <div className={cn("flex flex-col items-center justify-center gap-3 py-12 text-center", className)}>',
        '      {icon && <div className="text-muted-foreground/50">{icon}</div>}',
        '      <div className="space-y-1">',
        '        <h3 className="text-sm font-semibold text-foreground">{title}</h3>',
        '        {description && <p className="text-sm text-muted-foreground max-w-xs mx-auto">{description}</p>}',
        '      </div>',
        '      {action && <div className="mt-2">{action}</div>}',
        '    </div>',
        '  );',
        '}', '',
      ].join('\n'),
      language: 'typescriptreact',
    });
  }
}
