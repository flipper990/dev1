'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Bell } from 'lucide-react';
import { Sparkle } from '../ui/Sparkle';
import { cn } from '../../lib/cn';

const TABS: { href: string; label: string }[] = [
  { href: '/',         label: 'Home' },
  { href: '/agents',   label: 'Agents' },
  { href: '/projects', label: 'Projects' },
  { href: '/settings', label: 'Settings' },
];

/**
 * Top navigation matching the editorial cosmic design — wordmark on the left,
 * 4-tab strip in the center, notification bell + avatar on the right.
 * Active tab gets a gold underline; the rest are muted.
 */
export function TopNav() {
  const pathname = usePathname() ?? '/';

  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname.startsWith(href);

  return (
    <div className="cn-nav-wrap">
      <header className="cn-nav">
        <Link href="/" className="cn-brand">
          <span className="cn-brand-mark">
            <Sparkle size={18} />
          </span>
          <span>DEVteam</span>
        </Link>

        <nav className="cn-tabs flex-1">
          {TABS.map((t) => (
            <Link
              key={t.href}
              href={t.href}
              className={cn('cn-tab', isActive(t.href) && 'is-active')}
              aria-current={isActive(t.href) ? 'page' : undefined}
            >
              {t.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          <button className="cn-icon-btn" aria-label="Notifications">
            <Bell size={16} />
          </button>
          <div
            className="w-9 h-9 rounded-full bg-gradient-to-br from-gold-300 to-gold-600 grid place-items-center text-ink font-semibold text-sm shadow-gold-sm"
            aria-label="Account"
          >
            A
          </div>
        </div>
      </header>
    </div>
  );
}
