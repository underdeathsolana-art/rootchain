'use client';

import { PrivyProvider } from '@privy-io/react-auth';

/**
 * Client-only mount for the Privy provider (the SDK needs browser React —
 * createContext & friends — so it can never be imported from the RSC
 * layout directly). The terminal renders normally when no app id is set.
 */
export default function PrivyWrapper({ appId, children }) {
  if (!appId) return children;
  return (
    <PrivyProvider
      appId={appId}
      config={{
        loginMethods: ['twitter', 'wallet', 'email'],
        embeddedWallets: {
          ethereum: { createOnLogin: 'users-without-wallets' },
          solana: { createOnLogin: 'users-without-wallets' },
        },
        appearance: { theme: 'dark' },
      }}
    >
      {children}
    </PrivyProvider>
  );
}
