import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'DEVteam — AI Multi-Agent Platform',
  description: 'Generate production-ready software with a team of AI agents',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
