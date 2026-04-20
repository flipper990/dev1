import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'DEVteam Control Center',
  description: 'Advanced multi-agent project generation dashboard',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
