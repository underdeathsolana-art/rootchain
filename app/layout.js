import './globals.css';
import PrivyWrapper from '@/components/privywrapper';

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

// The identity layer ("identity" command: X login + embedded wallets) is
// optional — without an app id the terminal renders exactly as before.
const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID || '';

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <PrivyWrapper appId={PRIVY_APP_ID}>{children}</PrivyWrapper>
      </body>
    </html>
  );
}
