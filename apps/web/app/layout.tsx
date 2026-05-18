import type { Metadata } from 'next';
import { IBM_Plex_Mono, Space_Grotesk } from 'next/font/google';
import './globals.css';
import '../src/styles/theme.css';

const sans = Space_Grotesk({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-sans',
  display: 'swap',
});

const mono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'DEVteam',
  description: 'Software production studio for multi-agent fullstack generation',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const themeBootScript = `
    (() => {
      try {
        const saved = window.localStorage.getItem('devteam-theme');
        const theme = saved === 'light' || saved === 'dark' ? saved : 'dark';
        const root = document.documentElement;
        root.dataset.theme = theme;
        root.classList.toggle('theme-dark', theme === 'dark');
      } catch {
        // Keep default dark theme when storage access is blocked.
      }
    })();
  `;

  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <body className="min-h-screen bg-surface-canvas text-text-primary antialiased" suppressHydrationWarning>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
        {children}
      </body>
    </html>
  );
}
