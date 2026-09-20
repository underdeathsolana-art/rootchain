import './globals.css';

export const metadata = {
  title: 'Rootchain Terminal v1.0 — Secure Access',
  description:
    'A living cross-chain intelligence terminal. Agent-01 Root and Agent-02 Chain hold a continuous, memory-backed conversation on your own AI — attach it through the MCP connector, or let them interact on the local engine.',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0a0a0a',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
