// UI Foundation injection â€” extracted from ProjectGenerator.
// Guarantees essential primitive files exist so generated frontends always compile.
// Called by assembleProject() only when frontend files are detected.

import type { AgentRole } from '../../../../packages/agent-core/src/types.js';
import type { ProjectFile } from './generator-types.js';

export function injectUIFoundation(
  fileMap: Map<string, ProjectFile>,
  artifacts: Map<AgentRole, Record<string, unknown>>,
): void {
  const hasFrontend = [...fileMap.keys()].some(
    p => /\.(tsx|jsx|vue|svelte)$/.test(p) || /(\/app\/|\/pages\/|\/components\/)/.test(p),
  );
  if (!hasFrontend) return;

  const spec = artifacts.get('spec') as {
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
        '    colors: {',
        // Semantic tokens wired to CSS variables defined in globals.css.
        // Keep these BEFORE spec-derived colors so the spec can override.
        "      background:            'hsl(var(--background))',",
        "      foreground:            'hsl(var(--foreground))',",
        "      card:                  'hsl(var(--card))',",
        "      'card-foreground':     'hsl(var(--card-foreground))',",
        "      popover:               'hsl(var(--popover))',",
        "      'popover-foreground':  'hsl(var(--popover-foreground))',",
        "      primary:               'hsl(var(--primary))',",
        "      'primary-foreground':  'hsl(var(--primary-foreground))',",
        "      secondary:             'hsl(var(--secondary))',",
        "      'secondary-foreground':'hsl(var(--secondary-foreground))',",
        "      muted:                 'hsl(var(--muted))',",
        "      'muted-foreground':    'hsl(var(--muted-foreground))',",
        "      accent:                'hsl(var(--accent))',",
        "      'accent-foreground':   'hsl(var(--accent-foreground))',",
        "      destructive:           'hsl(var(--destructive))',",
        "      'destructive-foreground': 'hsl(var(--destructive-foreground))',",
        "      border:                'hsl(var(--border))',",
        "      input:                 'hsl(var(--input))',",
        "      ring:                  'hsl(var(--ring))',",
        colorEntries, '    },',
        `    fontFamily: { sans: ['${fontFamily}'], mono: ['${fontFamilyMono}'] },`,
        '    borderRadius: {',
        "      lg: 'var(--radius)',",
        "      md: 'calc(var(--radius) - 2px)',",
        "      sm: 'calc(var(--radius) - 4px)',",
        radiusEntries, '    },',
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

  // ── AppShell: sidebar + topbar layout primitive ──────────────────
  // Generated apps that don't ship their own shell can drop their pages
  // inside <AppShell> and immediately get a modern SaaS layout
  // (collapsing sidebar, sticky topbar, content area with proper spacing).
  if (!fileMap.has('src/components/ui/AppShell.tsx')) {
    fileMap.set('src/components/ui/AppShell.tsx', {
      path: 'src/components/ui/AppShell.tsx',
      content: [
        "import * as React from 'react';",
        "import { cn } from '@/lib/cn';",
        '',
        'export interface NavItem {',
        '  label: string;',
        '  href?: string;',
        '  icon?: React.ReactNode;',
        '  active?: boolean;',
        '  onClick?: () => void;',
        '  badge?: React.ReactNode;',
        '}',
        '',
        'export interface AppShellProps {',
        '  brand?: React.ReactNode;',
        '  nav?: NavItem[];',
        '  topbarLeft?: React.ReactNode;',
        '  topbarRight?: React.ReactNode;',
        '  sidebarFooter?: React.ReactNode;',
        '  children: React.ReactNode;',
        '  className?: string;',
        '}',
        '',
        '/**',
        ' * Modern SaaS shell: collapsible left sidebar, sticky topbar, scrollable',
        ' * content area. Mobile-first \u2014 sidebar collapses below md breakpoint and',
        ' * is toggled by a hamburger button in the topbar.',
        ' */',
        'export function AppShell({ brand, nav = [], topbarLeft, topbarRight, sidebarFooter, children, className }: AppShellProps) {',
        '  const [open, setOpen] = React.useState(false);',
        '  return (',
        '    <div className={cn("min-h-screen flex bg-background text-foreground", className)}>',
        '      {/* Mobile backdrop */}',
        '      {open && (',
        '        <div',
        '          className="fixed inset-0 z-30 bg-black/40 md:hidden"',
        '          onClick={() => setOpen(false)}',
        '          aria-hidden="true"',
        '        />',
        '      )}',
        '',
        '      {/* Sidebar */}',
        '      <aside',
        '        className={cn(',
        '          "fixed md:sticky top-0 left-0 z-40 h-screen w-64 shrink-0 border-r border-border bg-card transition-transform duration-200 ease-out flex flex-col",',
        '          open ? "translate-x-0" : "-translate-x-full md:translate-x-0",',
        '        )}',
        '        aria-label="Primary"',
        '      >',
        '        <div className="h-14 flex items-center px-4 border-b border-border font-semibold tracking-tight">',
        '          {brand ?? "App"}',
        '        </div>',
        '        <nav className="flex-1 overflow-y-auto p-2 space-y-0.5">',
        '          {nav.map((item, i) => {',
        '            const Tag: React.ElementType = item.href ? "a" : "button";',
        '            return (',
        '              <Tag',
        '                key={i}',
        '                href={item.href}',
        '                onClick={() => { item.onClick?.(); setOpen(false); }}',
        '                className={cn(',
        '                  "w-full flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors text-left",',
        '                  item.active',
        '                    ? "bg-primary/10 text-primary"',
        '                    : "text-muted-foreground hover:bg-muted hover:text-foreground",',
        '                )}',
        '                aria-current={item.active ? "page" : undefined}',
        '              >',
        '                {item.icon && <span className="shrink-0 [&>svg]:w-4 [&>svg]:h-4">{item.icon}</span>}',
        '                <span className="flex-1 truncate">{item.label}</span>',
        '                {item.badge && <span className="shrink-0 text-xs">{item.badge}</span>}',
        '              </Tag>',
        '            );',
        '          })}',
        '        </nav>',
        '        {sidebarFooter && (',
        '          <div className="border-t border-border p-3">{sidebarFooter}</div>',
        '        )}',
        '      </aside>',
        '',
        '      {/* Main column */}',
        '      <div className="flex-1 flex flex-col min-w-0 min-h-screen">',
        '        {/* Topbar */}',
        '        <header className="sticky top-0 z-20 h-14 flex items-center gap-3 px-4 md:px-6 border-b border-border bg-background/85 backdrop-blur">',
        '          <button',
        '            type="button"',
        '            className="md:hidden inline-flex items-center justify-center w-9 h-9 rounded-md hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"',
        '            onClick={() => setOpen((v) => !v)}',
        '            aria-label="Toggle navigation"',
        '            aria-expanded={open}',
        '          >',
        '            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg>',
        '          </button>',
        '          <div className="flex-1 min-w-0 flex items-center gap-3">{topbarLeft}</div>',
        '          <div className="flex items-center gap-2 shrink-0">{topbarRight}</div>',
        '        </header>',
        '',
        '        {/* Content */}',
        '        <main className="flex-1 overflow-y-auto px-4 md:px-6 lg:px-8 py-6 md:py-8">',
        '          <div className="mx-auto w-full max-w-screen-2xl">',
        '            {children}',
        '          </div>',
        '        </main>',
        '      </div>',
        '    </div>',
        '  );',
        '}',
        '',
      ].join('\n'),
      language: 'typescriptreact',
    });
  }

  // ── PageHeader: standard page-title block ────────────────────────
  if (!fileMap.has('src/components/ui/PageHeader.tsx')) {
    fileMap.set('src/components/ui/PageHeader.tsx', {
      path: 'src/components/ui/PageHeader.tsx',
      content: [
        "import * as React from 'react';",
        "import { cn } from '@/lib/cn';",
        '',
        'export interface PageHeaderProps {',
        '  title: string;',
        '  description?: string;',
        '  actions?: React.ReactNode;',
        '  className?: string;',
        '}',
        '',
        'export function PageHeader({ title, description, actions, className }: PageHeaderProps) {',
        '  return (',
        '    <div className={cn("flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6", className)}>',
        '      <div className="min-w-0">',
        '        <h1 className="text-xl md:text-2xl font-semibold tracking-tight text-foreground truncate">{title}</h1>',
        '        {description && <p className="text-sm text-muted-foreground mt-1">{description}</p>}',
        '      </div>',
        '      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}',
        '    </div>',
        '  );',
        '}',
        '',
      ].join('\n'),
      language: 'typescriptreact',
    });
  }

  // ── Textarea ────────────────────────────────────────────────────
  if (!fileMap.has('src/components/ui/Textarea.tsx')) {
    fileMap.set('src/components/ui/Textarea.tsx', {
      path: 'src/components/ui/Textarea.tsx',
      content: [
        "import * as React from 'react';",
        "import { cn } from '@/lib/cn';",
        '',
        'export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {',
        '  label?: string; error?: string; helperText?: string;',
        '}',
        '',
        'export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(',
        '  ({ className, label, error, helperText, id, ...props }, ref) => {',
        '    const inputId = id ?? React.useId();',
        '    return (',
        '      <div className="flex flex-col gap-1.5">',
        '        {label && <label htmlFor={inputId} className="text-sm font-medium text-foreground">{label}{props.required && <span className="text-destructive ml-0.5">*</span>}</label>}',
        '        <textarea ref={ref} id={inputId}',
        "          className={cn('flex min-h-[80px] w-full rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',",
        "            error && 'border-destructive focus-visible:ring-destructive/20', className)}",
        '          aria-invalid={!!error} aria-describedby={error ? `${inputId}-error` : helperText ? `${inputId}-helper` : undefined} {...props} />',
        '        {error && <p id={`${inputId}-error`} role="alert" className="text-xs text-destructive">{error}</p>}',
        '        {!error && helperText && <p id={`${inputId}-helper`} className="text-xs text-muted-foreground">{helperText}</p>}',
        '      </div>',
        '    );',
        '  },',
        ");\nTextarea.displayName = 'Textarea';\n",
      ].join('\n'),
      language: 'typescriptreact',
    });
  }

  // ── Select (native, themed) ─────────────────────────────────────
  if (!fileMap.has('src/components/ui/Select.tsx')) {
    fileMap.set('src/components/ui/Select.tsx', {
      path: 'src/components/ui/Select.tsx',
      content: [
        "import * as React from 'react';",
        "import { cn } from '@/lib/cn';",
        '',
        'export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {',
        '  label?: string; error?: string; helperText?: string;',
        '  options?: Array<{ value: string; label: string }>;',
        '}',
        '',
        'export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(',
        '  ({ className, label, error, helperText, options, children, id, ...props }, ref) => {',
        '    const selectId = id ?? React.useId();',
        '    return (',
        '      <div className="flex flex-col gap-1.5">',
        '        {label && <label htmlFor={selectId} className="text-sm font-medium text-foreground">{label}{props.required && <span className="text-destructive ml-0.5">*</span>}</label>}',
        '        <select ref={ref} id={selectId}',
        "          className={cn('flex h-10 w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',",
        "            error && 'border-destructive focus-visible:ring-destructive/20', className)}",
        '          aria-invalid={!!error} {...props}>',
        '          {options ? options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>) : children}',
        '        </select>',
        '        {error && <p role="alert" className="text-xs text-destructive">{error}</p>}',
        '        {!error && helperText && <p className="text-xs text-muted-foreground">{helperText}</p>}',
        '      </div>',
        '    );',
        '  },',
        ");\nSelect.displayName = 'Select';\n",
      ].join('\n'),
      language: 'typescriptreact',
    });
  }

  // ── Alert ───────────────────────────────────────────────────────
  if (!fileMap.has('src/components/ui/Alert.tsx')) {
    fileMap.set('src/components/ui/Alert.tsx', {
      path: 'src/components/ui/Alert.tsx',
      content: [
        "import * as React from 'react';",
        "import { cva, type VariantProps } from 'class-variance-authority';",
        "import { cn } from '@/lib/cn';",
        '',
        "const alertVariants = cva('relative w-full rounded-lg border p-4 text-sm [&>svg]:absolute [&>svg]:left-4 [&>svg]:top-4 [&>svg+div]:translate-y-[-3px] [&:has(svg)]:pl-11', {",
        '  variants: { variant: {',
        "    default: 'bg-background text-foreground border-border',",
        "    info: 'bg-primary/5 text-foreground border-primary/30 [&>svg]:text-primary',",
        "    success: 'bg-green-500/5 text-foreground border-green-500/30 [&>svg]:text-green-600',",
        "    warning: 'bg-amber-500/5 text-foreground border-amber-500/30 [&>svg]:text-amber-600',",
        "    destructive: 'bg-destructive/5 text-foreground border-destructive/40 [&>svg]:text-destructive',",
        "  } }, defaultVariants: { variant: 'default' },",
        '});',
        '',
        'export interface AlertProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof alertVariants> {}',
        'export function Alert({ className, variant, ...props }: AlertProps) {',
        '  return <div role="alert" className={cn(alertVariants({ variant }), className)} {...props} />;',
        '}',
        'export function AlertTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {',
        '  return <h5 className={cn("mb-1 font-medium leading-none tracking-tight", className)} {...props} />;',
        '}',
        'export function AlertDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {',
        '  return <div className={cn("text-sm text-muted-foreground [&_p]:leading-relaxed", className)} {...props} />;',
        '}',
        '',
      ].join('\n'),
      language: 'typescriptreact',
    });
  }

  // ── Separator ───────────────────────────────────────────────────
  if (!fileMap.has('src/components/ui/Separator.tsx')) {
    fileMap.set('src/components/ui/Separator.tsx', {
      path: 'src/components/ui/Separator.tsx',
      content: [
        "import * as React from 'react';",
        "import { cn } from '@/lib/cn';",
        '',
        "export interface SeparatorProps extends React.HTMLAttributes<HTMLDivElement> { orientation?: 'horizontal' | 'vertical'; }",
        "export function Separator({ className, orientation = 'horizontal', ...props }: SeparatorProps) {",
        '  return (',
        '    <div role="separator"',
        "      className={cn('shrink-0 bg-border', orientation === 'horizontal' ? 'h-px w-full' : 'w-px h-full', className)} {...props} />",
        '  );',
        '}',
        '',
      ].join('\n'),
      language: 'typescriptreact',
    });
  }

  // ── Avatar ──────────────────────────────────────────────────────
  if (!fileMap.has('src/components/ui/Avatar.tsx')) {
    fileMap.set('src/components/ui/Avatar.tsx', {
      path: 'src/components/ui/Avatar.tsx',
      content: [
        "import * as React from 'react';",
        "import { cn } from '@/lib/cn';",
        '',
        'export function Avatar({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {',
        "  return <span className={cn('relative flex h-10 w-10 shrink-0 overflow-hidden rounded-full bg-muted', className)} {...props} />;",
        '}',
        'export function AvatarImage({ className, alt = "", ...props }: React.ImgHTMLAttributes<HTMLImageElement>) {',
        '  return <img className={cn("aspect-square h-full w-full object-cover", className)} alt={alt} {...props} />;',
        '}',
        'export function AvatarFallback({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {',
        '  return <span className={cn("flex h-full w-full items-center justify-center text-sm font-medium text-muted-foreground", className)} {...props} />;',
        '}',
        '',
      ].join('\n'),
      language: 'typescriptreact',
    });
  }

  // ── Tabs (controlled, accessible) ───────────────────────────────
  if (!fileMap.has('src/components/ui/Tabs.tsx')) {
    fileMap.set('src/components/ui/Tabs.tsx', {
      path: 'src/components/ui/Tabs.tsx',
      content: [
        "import * as React from 'react';",
        "import { cn } from '@/lib/cn';",
        '',
        'interface TabsCtx { value: string; setValue: (v: string) => void; }',
        'const TabsContext = React.createContext<TabsCtx | null>(null);',
        '',
        'export interface TabsProps { defaultValue: string; value?: string; onValueChange?: (v: string) => void; className?: string; children: React.ReactNode; }',
        'export function Tabs({ defaultValue, value, onValueChange, className, children }: TabsProps) {',
        '  const [internal, setInternal] = React.useState(defaultValue);',
        '  const current = value ?? internal;',
        '  const setValue = (v: string) => { if (value == null) setInternal(v); onValueChange?.(v); };',
        '  return <TabsContext.Provider value={{ value: current, setValue }}><div className={cn("w-full", className)}>{children}</div></TabsContext.Provider>;',
        '}',
        'export function TabsList({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {',
        '  return <div role="tablist" className={cn("inline-flex h-10 items-center justify-center rounded-md bg-muted p-1 text-muted-foreground", className)} {...props} />;',
        '}',
        'export interface TabsTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> { value: string; }',
        'export function TabsTrigger({ value, className, ...props }: TabsTriggerProps) {',
        '  const ctx = React.useContext(TabsContext);',
        '  if (!ctx) throw new Error("TabsTrigger must be used inside Tabs");',
        '  const active = ctx.value === value;',
        '  return (',
        '    <button role="tab" type="button" aria-selected={active}',
        "      onClick={() => ctx.setValue(value)}",
        "      className={cn('inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',",
        "        active ? 'bg-background text-foreground shadow-sm' : 'hover:text-foreground', className)} {...props} />",
        '  );',
        '}',
        'export interface TabsContentProps extends React.HTMLAttributes<HTMLDivElement> { value: string; }',
        'export function TabsContent({ value, className, ...props }: TabsContentProps) {',
        '  const ctx = React.useContext(TabsContext);',
        '  if (!ctx) throw new Error("TabsContent must be used inside Tabs");',
        '  if (ctx.value !== value) return null;',
        '  return <div role="tabpanel" className={cn("mt-4 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2", className)} {...props} />;',
        '}',
        '',
      ].join('\n'),
      language: 'typescriptreact',
    });
  }

  // ── Dialog / Modal ──────────────────────────────────────────────
  if (!fileMap.has('src/components/ui/Dialog.tsx')) {
    fileMap.set('src/components/ui/Dialog.tsx', {
      path: 'src/components/ui/Dialog.tsx',
      content: [
        "'use client';",
        "import * as React from 'react';",
        "import { cn } from '@/lib/cn';",
        '',
        'interface DialogCtx { open: boolean; setOpen: (v: boolean) => void; }',
        'const DialogContext = React.createContext<DialogCtx | null>(null);',
        '',
        'export interface DialogProps { open?: boolean; defaultOpen?: boolean; onOpenChange?: (v: boolean) => void; children: React.ReactNode; }',
        'export function Dialog({ open, defaultOpen = false, onOpenChange, children }: DialogProps) {',
        '  const [internal, setInternal] = React.useState(defaultOpen);',
        '  const isOpen = open ?? internal;',
        '  const setOpen = (v: boolean) => { if (open == null) setInternal(v); onOpenChange?.(v); };',
        '  React.useEffect(() => {',
        '    if (!isOpen) return;',
        "    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };",
        "    document.addEventListener('keydown', onKey);",
        "    return () => document.removeEventListener('keydown', onKey);",
        '  }, [isOpen]);',
        '  return <DialogContext.Provider value={{ open: isOpen, setOpen }}>{children}</DialogContext.Provider>;',
        '}',
        '',
        'export interface DialogTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> { asChild?: boolean; }',
        'export function DialogTrigger({ asChild: _asChild, onClick, ...props }: DialogTriggerProps) {',
        '  const ctx = React.useContext(DialogContext);',
        '  if (!ctx) throw new Error("DialogTrigger must be used inside Dialog");',
        '  return <button type="button" onClick={(e) => { onClick?.(e); ctx.setOpen(true); }} {...props} />;',
        '}',
        '',
        'export interface DialogContentProps extends React.HTMLAttributes<HTMLDivElement> {}',
        'export function DialogContent({ className, children, ...props }: DialogContentProps) {',
        '  const ctx = React.useContext(DialogContext);',
        '  if (!ctx) throw new Error("DialogContent must be used inside Dialog");',
        '  if (!ctx.open) return null;',
        '  return (',
        '    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">',
        '      <div className="absolute inset-0 bg-black/50 animate-in fade-in" onClick={() => ctx.setOpen(false)} aria-hidden="true" />',
        '      <div role="dialog" aria-modal="true"',
        "        className={cn('relative z-10 w-full max-w-lg rounded-lg border border-border bg-card text-card-foreground shadow-lg p-6', className)} {...props}>",
        '        <button type="button" onClick={() => ctx.setOpen(false)} aria-label="Close"',
        '          className="absolute right-4 top-4 rounded-md p-1 text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">',
        '          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>',
        '        </button>',
        '        {children}',
        '      </div>',
        '    </div>',
        '  );',
        '}',
        '',
        'export function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {',
        '  return <div className={cn("flex flex-col space-y-1.5 text-left mb-4", className)} {...props} />;',
        '}',
        'export function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {',
        '  return <div className={cn("flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2 mt-6", className)} {...props} />;',
        '}',
        'export function DialogTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {',
        '  return <h2 className={cn("text-lg font-semibold leading-none tracking-tight", className)} {...props} />;',
        '}',
        'export function DialogDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {',
        '  return <p className={cn("text-sm text-muted-foreground", className)} {...props} />;',
        '}',
        '',
      ].join('\n'),
      language: 'typescriptreact',
    });
  }

  // ── Toast (provider + useToast hook) ────────────────────────────
  if (!fileMap.has('src/components/ui/Toast.tsx')) {
    fileMap.set('src/components/ui/Toast.tsx', {
      path: 'src/components/ui/Toast.tsx',
      content: [
        "'use client';",
        "import * as React from 'react';",
        "import { cn } from '@/lib/cn';",
        '',
        "type ToastVariant = 'default' | 'success' | 'error';",
        'export interface ToastItem { id: number; title?: string; description?: string; variant?: ToastVariant; }',
        '',
        'interface ToastCtx { toasts: ToastItem[]; toast: (t: Omit<ToastItem, "id">) => void; dismiss: (id: number) => void; }',
        'const ToastContext = React.createContext<ToastCtx | null>(null);',
        '',
        'export function ToastProvider({ children }: { children: React.ReactNode }) {',
        '  const [toasts, setToasts] = React.useState<ToastItem[]>([]);',
        '  const idRef = React.useRef(0);',
        '  const dismiss = React.useCallback((id: number) => {',
        '    setToasts((cur) => cur.filter((t) => t.id !== id));',
        '  }, []);',
        '  const toast = React.useCallback((t: Omit<ToastItem, "id">) => {',
        '    const id = ++idRef.current;',
        '    setToasts((cur) => [...cur, { id, ...t }]);',
        '    setTimeout(() => dismiss(id), 4000);',
        '  }, [dismiss]);',
        '  return (',
        '    <ToastContext.Provider value={{ toasts, toast, dismiss }}>',
        '      {children}',
        '      <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 w-80 max-w-[calc(100vw-2rem)]" aria-live="polite">',
        '        {toasts.map((t) => (',
        '          <div key={t.id} role="status"',
        "            className={cn('rounded-md border p-4 shadow-md bg-card text-card-foreground border-border',",
        "              t.variant === 'success' && 'border-green-500/40',",
        "              t.variant === 'error' && 'border-destructive/50')}>",
        '            {t.title && <div className="text-sm font-semibold">{t.title}</div>}',
        '            {t.description && <div className="text-sm text-muted-foreground mt-1">{t.description}</div>}',
        '          </div>',
        '        ))}',
        '      </div>',
        '    </ToastContext.Provider>',
        '  );',
        '}',
        '',
        'export function useToast(): ToastCtx {',
        '  const ctx = React.useContext(ToastContext);',
        '  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");',
        '  return ctx;',
        '}',
        '',
      ].join('\n'),
      language: 'typescriptreact',
    });
  }

  // ── ui/index.ts barrel ──────────────────────────────────────────
  // One-stop import for the LLM: `import { Button, Card, ... } from '@/components/ui';`
  if (!fileMap.has('src/components/ui/index.ts')) {
    fileMap.set('src/components/ui/index.ts', {
      path: 'src/components/ui/index.ts',
      content: [
        "export * from './Button';",
        "export * from './Input';",
        "export * from './Textarea';",
        "export * from './Select';",
        "export * from './Card';",
        "export * from './Badge';",
        "export * from './Alert';",
        "export * from './Dialog';",
        "export * from './Tabs';",
        "export * from './Separator';",
        "export * from './Avatar';",
        "export * from './Spinner';",
        "export * from './Skeleton';",
        "export * from './EmptyState';",
        "export * from './AppShell';",
        "export * from './PageHeader';",
        "export * from './Toast';",
        '',
      ].join('\n'),
      language: 'typescript',
    });
  }

  // ── DESIGN_SYSTEM.md — re-anchors the LLM on QA-feedback re-runs ────
  // The full builder spec is passed as `existingFiles` on every re-run, so
  // dropping a markdown contract here means the LLM literally re-reads the
  // rules each loop. Cheaper + more reliable than re-injecting a giant
  // system prompt.
  if (!fileMap.has('DESIGN_SYSTEM.md')) {
    fileMap.set('DESIGN_SYSTEM.md', {
      path: 'DESIGN_SYSTEM.md',
      content: [
        '# Design System (DO NOT EDIT)',
        '',
        'Every UI file in this project MUST follow these rules. The build pipeline',
        'sanitises violations and the QA agent flags any deviation as critical.',
        '',
        '## Allowed colour classes (semantic, themed)',
        '',
        '- Surfaces: `bg-background`, `bg-card`, `bg-popover`, `bg-muted`, `bg-accent`',
        '- Text: `text-foreground`, `text-card-foreground`, `text-popover-foreground`,',
        '  `text-muted-foreground`, `text-accent-foreground`',
        '- Brand: `bg-primary`, `text-primary`, `text-primary-foreground`,',
        '  `bg-secondary`, `text-secondary`, `text-secondary-foreground`',
        '- Status: `bg-destructive`, `text-destructive`, `text-destructive-foreground`',
        '- Borders/rings: `border-border`, `border-input`, `ring-ring`, `ring-primary`',
        '- Opacity modifiers: `/10 /20 /50 /80 /90` (e.g. `bg-primary/10`)',
        '',
        'Tailwind palette colours (`bg-green-500`, etc.) are allowed ONLY inside',
        '`Badge` / `Alert` variants for static status indicators.',
        '',
        '## Banned class patterns',
        '',
        '- Invented camelCase tokens: `bg-cardBackground`, `text-textPrimary`,',
        '  `border-borderColor`, `bg-mainBg`, `text-headingColor` — these do not',
        '  exist and produce invisible elements.',
        '- Raw hex / rgb anywhere in className or style.',
        '- Arbitrary values like `p-[13px]` or `w-[742px]` outside hero / chart code.',
        '',
        '## Allowed primitives (import, never redefine)',
        '',
        '```ts',
        "import { Button, Input, Textarea, Select, Card, CardHeader, CardTitle,",
        "  CardDescription, CardContent, CardFooter, Badge, Alert, AlertTitle,",
        "  AlertDescription, Dialog, DialogTrigger, DialogContent, DialogHeader,",
        "  DialogTitle, DialogDescription, DialogFooter, Tabs, TabsList, TabsTrigger,",
        "  TabsContent, Separator, Avatar, AvatarImage, AvatarFallback, Spinner,",
        "  Skeleton, EmptyState, AppShell, PageHeader, ToastProvider, useToast",
        "} from '@/components/ui';",
        "import { cn } from '@/lib/cn';",
        '```',
        '',
        '## Layout template',
        '',
        '- Multi-page / dashboard apps wrap pages in `<AppShell>`.',
        '- Single-page marketing sites use a hero + sections layout but every',
        '  block lives inside `max-w-screen-2xl mx-auto` and uses `Card` for',
        '  panels.',
        '- Page intro: `<PageHeader title=… description=… actions=… />`.',
        '- Spacing scale: `gap-4` between siblings, `gap-6` between sections,',
        '  `gap-8` between major regions.',
        '',
        '## Theme',
        '',
        '`globals.css` ships `:root` (light) + `.dark` blocks; `<html>` has',
        '`className="dark"` by default. Use semantic tokens — never fork into',
        'a "dark variant" branch.',
        '',
      ].join('\n'),
      language: 'markdown',
    });
  }

  // ── globals.css with semantic tokens (light + dark) ──────────────
  // Without these CSS variables, Tailwind classes like bg-background /
  // text-foreground / bg-card resolve to nothing and pages render
  // unstyled \u2014 a common cause of "UI looks basic" complaints.
  if (!fileMap.has('src/app/globals.css') && !fileMap.has('app/globals.css') && !fileMap.has('src/styles/globals.css')) {
    fileMap.set('src/app/globals.css', {
      path: 'src/app/globals.css',
      content: [
        '@tailwind base;',
        '@tailwind components;',
        '@tailwind utilities;',
        '',
        '@layer base {',
        '  :root {',
        '    --background: 0 0% 100%;',
        '    --foreground: 222 47% 11%;',
        '    --card: 0 0% 100%;',
        '    --card-foreground: 222 47% 11%;',
        '    --popover: 0 0% 100%;',
        '    --popover-foreground: 222 47% 11%;',
        '    --primary: 221 83% 53%;',
        '    --primary-foreground: 210 40% 98%;',
        '    --secondary: 210 40% 96%;',
        '    --secondary-foreground: 222 47% 11%;',
        '    --muted: 210 40% 96%;',
        '    --muted-foreground: 215 16% 47%;',
        '    --accent: 210 40% 96%;',
        '    --accent-foreground: 222 47% 11%;',
        '    --destructive: 0 84% 60%;',
        '    --destructive-foreground: 210 40% 98%;',
        '    --border: 214 32% 91%;',
        '    --input: 214 32% 91%;',
        '    --ring: 221 83% 53%;',
        '    --radius: 0.5rem;',
        '  }',
        '  .dark {',
        '    --background: 222 47% 6%;',
        '    --foreground: 210 40% 98%;',
        '    --card: 222 47% 9%;',
        '    --card-foreground: 210 40% 98%;',
        '    --popover: 222 47% 9%;',
        '    --popover-foreground: 210 40% 98%;',
        '    --primary: 217 91% 60%;',
        '    --primary-foreground: 222 47% 11%;',
        '    --secondary: 217 33% 17%;',
        '    --secondary-foreground: 210 40% 98%;',
        '    --muted: 217 33% 17%;',
        '    --muted-foreground: 215 20% 65%;',
        '    --accent: 217 33% 17%;',
        '    --accent-foreground: 210 40% 98%;',
        '    --destructive: 0 63% 31%;',
        '    --destructive-foreground: 210 40% 98%;',
        '    --border: 217 33% 17%;',
        '    --input: 217 33% 17%;',
        '    --ring: 217 91% 60%;',
        '  }',
        '  * { border-color: hsl(var(--border)); }',
        '  body { background-color: hsl(var(--background)); color: hsl(var(--foreground)); font-feature-settings: "rlig" 1, "calt" 1; }',
        '}',
        '',
      ].join('\n'),
      language: 'css',
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────
// sanitizeUIFoundation — fix broken EXISTING tailwind/globals/design-tokens
// files emitted by qa/polish. injectUIFoundation only fills gaps; this fn
// replaces files that exist-but-don't-compile (e.g. tailwind.config.ts that
// imports a non-existent design-tokens path or omits the required `content`
// array; globals.css missing @tailwind directives; empty design-tokens stub
// referenced by tailwind config).
//
// Strategy: regenerate the canonical templates and overwrite. We don't try
// to surgically patch — the LLM-emitted versions are not load-bearing
// (they reference token shapes that don't exist), so a clean replacement is
// safer than partial repair.
// ─────────────────────────────────────────────────────────────────────────
export function sanitizeUIFoundation(fileMap: Map<string, ProjectFile>): void {
  const hasFrontend = [...fileMap.keys()].some(
    p => /\.(tsx|jsx|vue|svelte)$/.test(p) || /(\/app\/|\/pages\/|\/components\/)/.test(p),
  );
  if (!hasFrontend) return;

  // ── 1. tailwind.config.{ts,js} ────────────────────────────────────
  // Broken if: missing `content:` array (Tailwind v3 hard requirement) OR
  // imports a design-tokens module whose file isn't present OR spreads
  // properties from an empty/stub design-tokens object.
  for (const cfgPath of ['tailwind.config.ts', 'tailwind.config.js']) {
    const cfg = fileMap.get(cfgPath);
    if (!cfg) continue;
    const text = cfg.content ?? '';
    const missingContent = !/\bcontent\s*:\s*\[/.test(text);
    const importsDesignTokens = /from\s+['"](\.\.?\/.+?design-tokens)['"]/.exec(text);
    let designTokensBroken = false;
    if (importsDesignTokens) {
      const importPath = importsDesignTokens[1].replace(/^\.\//, '');
      // The import is relative to the config file at root. Resolve to
      // candidate keys ('lib/design-tokens.ts', 'src/lib/design-tokens.ts', …).
      const candidates = [
        `${importPath}.ts`, `${importPath}.tsx`, `${importPath}.js`,
        `${importPath}/index.ts`, `${importPath}/index.js`,
      ];
      const resolvedKey = candidates.find((c) => fileMap.has(c));
      if (!resolvedKey) {
        designTokensBroken = true;
      } else {
        // Resolved — but is it an empty stub?
        const dt = fileMap.get(resolvedKey)!;
        if (/export\s+const\s+designTokens\s*=\s*\{\s*\}\s*;?/.test(dt.content ?? '')) {
          designTokensBroken = true;
        }
      }
    }
    if (missingContent || designTokensBroken) {
      fileMap.set(cfgPath, {
        path: cfgPath,
        content: [
          "import type { Config } from 'tailwindcss';", '',
          'const config: Config = {',
          "  content: ['./src/**/*.{ts,tsx,js,jsx}', './app/**/*.{ts,tsx,js,jsx}', './components/**/*.{ts,tsx,js,jsx}', './pages/**/*.{ts,tsx,js,jsx}'],",
          "  darkMode: 'class',",
          '  theme: { extend: {',
          '    colors: {',
          "      background:               'hsl(var(--background))',",
          "      foreground:               'hsl(var(--foreground))',",
          "      card:                     'hsl(var(--card))',",
          "      'card-foreground':        'hsl(var(--card-foreground))',",
          "      popover:                  'hsl(var(--popover))',",
          "      'popover-foreground':     'hsl(var(--popover-foreground))',",
          "      primary:                  'hsl(var(--primary))',",
          "      'primary-foreground':     'hsl(var(--primary-foreground))',",
          "      secondary:                'hsl(var(--secondary))',",
          "      'secondary-foreground':   'hsl(var(--secondary-foreground))',",
          "      muted:                    'hsl(var(--muted))',",
          "      'muted-foreground':       'hsl(var(--muted-foreground))',",
          "      accent:                   'hsl(var(--accent))',",
          "      'accent-foreground':      'hsl(var(--accent-foreground))',",
          "      destructive:              'hsl(var(--destructive))',",
          "      'destructive-foreground': 'hsl(var(--destructive-foreground))',",
          "      border:                   'hsl(var(--border))',",
          "      input:                    'hsl(var(--input))',",
          "      ring:                     'hsl(var(--ring))',",
          '    },',
          '    borderRadius: {',
          "      lg: 'var(--radius)',",
          "      md: 'calc(var(--radius) - 2px)',",
          "      sm: 'calc(var(--radius) - 4px)',",
          '    },',
          '  } },',
          '  plugins: [],',
          '};', '', 'export default config;', '',
        ].join('\n'),
        language: cfgPath.endsWith('.ts') ? 'typescript' : 'javascript',
      });
    }
  }

  // ── 2. globals.css must declare @tailwind directives AND CSS vars ────
  // The sanitized tailwind.config.ts wires semantic colors to CSS vars
  // (hsl(var(--background)) etc). If globals.css doesn't actually DEFINE
  // those vars, every semantic class resolves to invalid `hsl()` and the
  // page renders unstyled — which is the exact failure mode we keep
  // seeing on previews ("Featured Car" page with browser-default fonts).
  // So: if EITHER the tailwind directives OR the CSS-var :root block is
  // missing, replace the file with the canonical full template.
  const CANONICAL_GLOBALS_CSS = [
    '@tailwind base;',
    '@tailwind components;',
    '@tailwind utilities;',
    '',
    '@layer base {',
    '  :root {',
    '    --background: 0 0% 100%;',
    '    --foreground: 222 47% 11%;',
    '    --card: 0 0% 100%;',
    '    --card-foreground: 222 47% 11%;',
    '    --popover: 0 0% 100%;',
    '    --popover-foreground: 222 47% 11%;',
    '    --primary: 221 83% 53%;',
    '    --primary-foreground: 210 40% 98%;',
    '    --secondary: 210 40% 96%;',
    '    --secondary-foreground: 222 47% 11%;',
    '    --muted: 210 40% 96%;',
    '    --muted-foreground: 215 16% 47%;',
    '    --accent: 210 40% 96%;',
    '    --accent-foreground: 222 47% 11%;',
    '    --destructive: 0 84% 60%;',
    '    --destructive-foreground: 210 40% 98%;',
    '    --border: 214 32% 91%;',
    '    --input: 214 32% 91%;',
    '    --ring: 221 83% 53%;',
    '    --radius: 0.5rem;',
    '  }',
    '  .dark, [data-theme="dark"] {',
    '    --background: 222 47% 6%;',
    '    --foreground: 210 40% 98%;',
    '    --card: 222 47% 9%;',
    '    --card-foreground: 210 40% 98%;',
    '    --popover: 222 47% 9%;',
    '    --popover-foreground: 210 40% 98%;',
    '    --primary: 217 91% 60%;',
    '    --primary-foreground: 222 47% 11%;',
    '    --secondary: 217 33% 17%;',
    '    --secondary-foreground: 210 40% 98%;',
    '    --muted: 217 33% 17%;',
    '    --muted-foreground: 215 20% 65%;',
    '    --accent: 217 33% 17%;',
    '    --accent-foreground: 210 40% 98%;',
    '    --destructive: 0 63% 31%;',
    '    --destructive-foreground: 210 40% 98%;',
    '    --border: 217 33% 17%;',
    '    --input: 217 33% 17%;',
    '    --ring: 217 91% 60%;',
    '  }',
    '  * { border-color: hsl(var(--border)); }',
    '  body {',
    '    background-color: hsl(var(--background));',
    '    color: hsl(var(--foreground));',
    '    font-feature-settings: "rlig" 1, "calt" 1;',
    '  }',
    '}',
    '',
  ].join('\n');

  const cssCandidates = ['src/app/globals.css', 'app/globals.css', 'src/styles/globals.css', 'styles/globals.css'];
  for (const cssPath of cssCandidates) {
    const css = fileMap.get(cssPath);
    if (!css) continue;
    const text = css.content ?? '';
    const hasBase = /@tailwind\s+base\s*;/.test(text);
    const hasComponents = /@tailwind\s+components\s*;/.test(text);
    const hasUtilities = /@tailwind\s+utilities\s*;/.test(text);
    // The tailwind config references CSS vars like `--background`,
    // `--foreground`, `--card`, etc. Detect whether globals.css actually
    // declares the FOUNDATIONAL pair so semantic classes can resolve.
    const hasCoreVars =
      /--background\s*:/.test(text) && /--foreground\s*:/.test(text);

    if (hasBase && hasComponents && hasUtilities && hasCoreVars) continue;

    // Replace entirely. The LLM's version is either incomplete (no vars)
    // or non-Tailwind shape (e.g. [data-theme=dark] with --bg-* names that
    // don't match the config). The canonical version is what tailwind.config
    // expects, so they're guaranteed compatible.
    fileMap.set(cssPath, {
      ...css,
      content: CANONICAL_GLOBALS_CSS,
    });
  }

  // ── 3. design-tokens stub referenced by tailwind config ─────────────
  // We already replaced tailwind.config.ts above when the design-tokens
  // module was empty, so the stub is now harmless. Still: if it exists and
  // is the literal empty stub, fill it with a minimal-but-valid shape so
  // any OTHER consumer (e.g. polish-emitted UI components) doesn't crash.
  for (const dtPath of ['src/lib/design-tokens.ts', 'lib/design-tokens.ts']) {
    const dt = fileMap.get(dtPath);
    if (!dt) continue;
    if (/export\s+const\s+designTokens\s*=\s*\{\s*\}\s*;?/.test(dt.content ?? '')) {
      fileMap.set(dtPath, {
        ...dt,
        content: [
          'export const designTokens = {',
          '  colors: {},',
          '  spacing: {},',
          '  radii: {},',
          '  shadows: {},',
          "  typography: { fontFamily: 'Inter, system-ui, sans-serif', fontFamilyMono: 'ui-monospace, monospace', fontSize: {}, lineHeight: {}, letterSpacing: {} },",
          '  motion: { durations: {}, easings: {} },',
          '} as const;',
          '',
        ].join('\n'),
      });
    }
  }

  // ── 4. layout.tsx — apply dark theme + bg/fg classes on body ────────
  // Most generated apps look unstyled at first glance because the LLM's
  // <html><body> tags are bare. We can't change product layout, but we can
  // ensure: (a) <html> has class="dark" so the .dark CSS-var block is the
  // active theme (overwhelmingly what prompts ask for); (b) <body> uses
  // bg-background + text-foreground so the page actually paints.
  // Skipped if the layout already declares any theme class.
  const layoutCandidates = ['src/app/layout.tsx', 'app/layout.tsx', 'src/app/layout.jsx', 'app/layout.jsx'];
  for (const layoutPath of layoutCandidates) {
    const layout = fileMap.get(layoutPath);
    if (!layout) continue;
    let text = layout.content ?? '';
    let changed = false;

    // (a) <html lang="..."> with no className → add className="dark"
    //     (preserves any other attrs already on <html>).
    const htmlOpenRe = /<html\b([^>]*)>/;
    const htmlMatch = htmlOpenRe.exec(text);
    if (htmlMatch && !/className\s*=/.test(htmlMatch[1])) {
      text = text.replace(htmlOpenRe, `<html${htmlMatch[1]} className="dark">`);
      changed = true;
    }

    // (b) <body> with no className → add bg-background + text-foreground.
    //     If body already has a className we leave it alone — author intent.
    const bodyOpenRe = /<body\b([^>]*)>/;
    const bodyMatch = bodyOpenRe.exec(text);
    if (bodyMatch && !/className\s*=/.test(bodyMatch[1])) {
      text = text.replace(bodyOpenRe, `<body${bodyMatch[1]} className="bg-background text-foreground antialiased">`);
      changed = true;
    }

    if (changed) {
      fileMap.set(layoutPath, { ...layout, content: text });
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// enforceDesignSystem — class-rewriting pass.
//
// Even with the contract in the prompt, LLMs occasionally invent token names
// like `bg-cardBackground` (from a remembered design-tokens module) or fall
// back to `bg-white` / `text-black` for "neutral" surfaces. Those classes
// either don't exist in Tailwind's config or break dark mode. We rewrite the
// well-known offenders deterministically so the rendered UI matches the
// theme regardless of LLM drift.
//
// Scope: only .tsx / .jsx / .ts / .js files. We rewrite raw substrings — the
// invented tokens are unique enough that false positives are essentially
// impossible (no real Tailwind class collides with `cardBackground`, etc.).
// ─────────────────────────────────────────────────────────────────────────────
const CLASS_REWRITES: Array<readonly [RegExp, string]> = [
  // Invented camelCase tokens the LLM hallucinates from design-tokens.ts.
  [/\bbg-cardBackground\b/g, 'bg-card'],
  [/\btext-cardForeground\b/g, 'text-card-foreground'],
  [/\bborder-cardBorder\b/g, 'border-border'],
  [/\bbg-mainBackground\b/g, 'bg-background'],
  [/\bbg-mainBg\b/g, 'bg-background'],
  [/\btext-mainText\b/g, 'text-foreground'],
  [/\btext-textPrimary\b/g, 'text-foreground'],
  [/\btext-textSecondary\b/g, 'text-muted-foreground'],
  [/\btext-textMuted\b/g, 'text-muted-foreground'],
  [/\btext-headingColor\b/g, 'text-foreground'],
  [/\bbg-primaryColor\b/g, 'bg-primary'],
  [/\btext-primaryColor\b/g, 'text-primary'],
  [/\bbg-secondaryColor\b/g, 'bg-secondary'],
  [/\btext-secondaryColor\b/g, 'text-secondary'],
  [/\bbg-accentColor\b/g, 'bg-accent'],
  [/\btext-accentColor\b/g, 'text-accent'],
  [/\bbg-mutedColor\b/g, 'bg-muted'],
  [/\bborder-borderColor\b/g, 'border-border'],
  [/\bring-ringColor\b/g, 'ring-ring'],
  [/\bbg-popoverBackground\b/g, 'bg-popover'],
  [/\btext-popoverForeground\b/g, 'text-popover-foreground'],
  // bg-white / bg-black on layout chrome breaks dark mode. We only rewrite
  // when followed/preceded by other layout-y classes (border, rounded, p-,
  // shadow). Plain `bg-white` inside a Badge/icon gradient stays.
  // → conservative: leave palette colours alone; the prompt + KNOWN_ISSUES
  // already steer the LLM away. Adding here only proven-bad invented names.
];

const TEXT_FILE_EXT = /\.(tsx|jsx|ts|js)$/i;

/**
 * Rewrites well-known invented className tokens to their canonical semantic
 * equivalents across the entire generated file map. Idempotent — applying
 * twice is a no-op.
 */
export function enforceDesignSystem(fileMap: Map<string, { path: string; content: string; language?: string }>): {
  filesChanged: number;
  totalReplacements: number;
} {
  let filesChanged = 0;
  let totalReplacements = 0;
  for (const [path, file] of fileMap) {
    if (!TEXT_FILE_EXT.test(path)) continue;
    let text = file.content ?? '';
    let fileReplacements = 0;
    for (const [re, replacement] of CLASS_REWRITES) {
      const matches = text.match(re);
      if (!matches) continue;
      fileReplacements += matches.length;
      text = text.replace(re, replacement);
    }
    if (fileReplacements > 0) {
      filesChanged++;
      totalReplacements += fileReplacements;
      fileMap.set(path, { ...file, content: text });
    }
  }
  return { filesChanged, totalReplacements };
}
