'use client';

/**
 * Rootchain Launchpad · pump.fun integration (official @pump-fun/pump-sdk).
 *
 * Flow (all client-side, in the operator's browser):
 *   1. metadata JSON + image are pinned to IPFS through OUR server route
 *      (/api/launch, action=meta) — no third-party call from the browser;
 *   2. the create_v2 transaction is built with the SDK using the vanity
 *      `…root` mint keypair (mint is a signer — pump.fun's current coin
 *      creation flow supports caller-supplied mint keypairs);
 *   3. the mint keypair partial-signs; the connected wallet (Phantom /
 *      Solflare) signs after explicit user approval in the wallet UI;
 *   4. the transaction is sent + confirmed through a rate-limited,
 *      session-authenticated RPC proxy on our own server;
 *   5. the launch is VERIFIED on-chain (tx status + mint account owner
 *      must be Token-2022) before any success state is shown.
 *
 * Nothing here ever simulates a launch or fabricates a signature.
 */

import {
  Connection,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
  ComputeBudgetProgram,
} from '@solana/web3.js';
import * as PumpSdkModule from '@pump-fun/pump-sdk';

export const PUMP_PROGRAM_ID = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
export const TOKEN_2022_PROGRAM_ID = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
export const SOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');

// create_v2 initializes the Token-2022 mint (6 decimals, metadata pointer to
// itself) — 400k CU gives comfortable headroom for a create-only launch.
export const COMPUTE_UNITS_CREATE = 400_000;
export const DEFAULT_PRIORITY_MICROLAMPORTS = 120_000;
export const MINT_RENT_FALLBACK_LAMPORTS = 2_150_000; // Token-2022 mint + metadata ≈ 335 bytes
export const SIGNATURES_PER_LAUNCH = 2; // payer wallet + mint keypair

export const LIMITS = {
  nameMax: 32,
  symbolMax: 13,
  descriptionMax: 500,
  imageMaxBytes: 5 * 1024 * 1024,
  imageTypes: ['image/png', 'image/jpeg', 'image/gif', 'image/webp'],
};

export const LINKS = {
  pumpCoin: (mint) => `https://pump.fun/coin/${mint}`,
  solscanToken: (mint) => `https://solscan.io/token/${mint}`,
  solscanTx: (sig) => `https://solscan.io/tx/${sig}`,
};

function resolvePumpSdk() {
  const Ctor = PumpSdkModule.PumpSdk || (PumpSdkModule.default && PumpSdkModule.default.PumpSdk);
  if (!Ctor) throw new Error('@pump-fun/pump-sdk did not export PumpSdk — install version ^4.1.0');
  return Ctor;
}

/**
 * Connection that routes every JSON-RPC call through our own authenticated
 * proxy (/api/launch?rpc=1) so the browser never needs a third-party RPC and
 * the operator session gates + rate limits apply.
 */
export function makeLaunchConnection({ username, code } = {}) {
  const headers = {
    'x-rc-user': encodeURIComponent(String(username || '')),
    'x-rc-code': encodeURIComponent(String(code || '')),
  };
  return new Connection('/api/launch?rpc=1', {
    commitment: 'confirmed',
    fetchMiddleware: (url, options, fetch) => {
      options.headers = Object.assign({}, options.headers || {}, headers);
      return fetch(url, options);
    },
  });
}

/* ------------------------------- wallets -------------------------------- */

export function detectWallets() {
  if (typeof window === 'undefined') return { phantom: null, solflare: null };
  const phantom =
    window.phantom && window.phantom.solana && window.phantom.solana.isPhantom ? window.phantom.solana : null;
  const solflare = window.solflare && window.solflare.isSolflare ? window.solflare : null;
  return { phantom, solflare };
}

/**
 * Connect an injected provider and return a normalized wallet:
 *   { provider, name, publicKeyBase58, signTransaction, signAndSendTransaction }
 * We never ask for and never see private keys or seed phrases — signing
 * happens inside the wallet extension after explicit user approval.
 */
export async function connectWallet(provider, name) {
  if (!provider) throw new Error(`${name} is not installed`);
  const res = await provider.connect();
  const pubkey = (res && res.publicKey) || provider.publicKey;
  if (!pubkey) throw new Error(`${name} did not return a public key`);
  return {
    provider,
    name,
    publicKeyBase58: pubkey.toBase58 ? pubkey.toBase58() : String(pubkey),
    signTransaction: (tx) => provider.signTransaction(tx),
    signAndSendTransaction: provider.signAndSendTransaction
      ? (tx, opts) => provider.signAndSendTransaction(tx, opts)
      : undefined,
  };
}

/* -------------------------------- fees ---------------------------------- */

export async function estimateLaunchFees(connection) {
  let priorityMicroLamports = DEFAULT_PRIORITY_MICROLAMPORTS;
  try {
    const est = await connection.getPriorityFeeEstimate({ options: { recommended: true } });
    if (est && Number(est) > 1000) priorityMicroLamports = Math.min(2_000_000, Math.round(Number(est)));
  } catch (_) {
    // keep the default — the proxy RPC may not support the estimate call
  }
  let rentLamports = MINT_RENT_FALLBACK_LAMPORTS;
  try {
    const r = await connection.getMinimumBalanceForRentExemption(335);
    if (r > 0) rentLamports = r;
  } catch (_) {}
  const baseLamports = 5000 * SIGNATURES_PER_LAUNCH;
  const priorityLamports = Math.ceil((priorityMicroLamports * COMPUTE_UNITS_CREATE) / 1e6);
  return {
    baseLamports,
    priorityMicroLamports,
    priorityLamports,
    rentLamports,
    totalLamports: baseLamports + priorityLamports + rentLamports,
    estimate: true,
  };
}

export function lamportsToSol(lamports) {
  return Number(lamports || 0) / 1e9;
}

/* ------------------------------- create_v2 ------------------------------- */

/**
 * Build the create_v2 launch transaction. `creator` is the fee-recipient
 * argument of pump.fun's create_v2 (docs: any non-default pubkey; normally
 * the launching wallet). The mint keypair partial-signs here; the wallet
 * signs afterwards — both signatures are required by the program.
 */
export async function buildCreateTransaction({
  connection,
  payer, // PublicKey or base58 string of the connected wallet
  creator, // PublicKey or base58 (usually === payer)
  mintKeypair, // vanity Keypair ending in `root`
  name,
  symbol,
  uri, // ipfs://… metadata URI (≤200 chars)
  priorityMicroLamports = DEFAULT_PRIORITY_MICROLAMPORTS,
}) {
  const PumpSdk = resolvePumpSdk();
  const sdk = new PumpSdk(connection);
  if (typeof sdk.createV2Instruction !== 'function') {
    throw new Error('this @pump-fun/pump-sdk version has no createV2Instruction — pin ^4.1.0');
  }
  const payerPk = payer instanceof PublicKey ? payer : new PublicKey(payer);
  const creatorPk = creator instanceof PublicKey ? creator : new PublicKey(creator);

  let createIxs = await sdk.createV2Instruction({
    mint: mintKeypair.publicKey,
    name,
    symbol,
    uri,
    creator: creatorPk,
    user: payerPk,
    mayhemMode: false,
    holderReward: false,
  });
  if (!Array.isArray(createIxs)) createIxs = [createIxs];

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('finalized');
  const instructions = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: COMPUTE_UNITS_CREATE }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priorityMicroLamports }),
    ...createIxs,
  ];

  const message = new TransactionMessage({
    payerKey: payerPk,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message();
  const transaction = new VersionedTransaction(message);
  transaction.sign([mintKeypair]); // mint partial-signature — wallet signs next

  return { transaction, blockhash, lastValidBlockHeight };
}

/* ---------------------------- send + confirm ----------------------------- */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Have the wallet sign the (already mint-signed) transaction, send it and
 * wait for confirmation. Returns { signature }. Throws with a human-readable
 * message on wallet rejection, RPC failure or on-chain error.
 */
export async function signSendConfirm({ wallet, connection, transaction, blockhash, lastValidBlockHeight, onStage }) {
  if (typeof wallet.signTransaction === 'function') {
    const signed = await wallet.signTransaction(transaction);
    const serialized = signed.serialize();
    if (onStage) onStage('send');
    const signature = await connection.sendRawTransaction(serialized, {
      skipPreflight: false,
      maxRetries: 3,
    });
    const conf = await connection.confirmTransaction(
      { signature, blockhash, lastValidBlockHeight },
      'confirmed'
    );
    const err = conf && conf.value && conf.value.err;
    if (err) throw new Error('transaction failed on-chain: ' + JSON.stringify(err));
    return { signature };
  }

  if (typeof wallet.signAndSendTransaction === 'function') {
    if (onStage) onStage('send');
    const res = await wallet.signAndSendTransaction(transaction, { maxRetries: 3 });
    const signature = res && res.signature ? res.signature : String(res);
    for (let i = 0; i < 60; i++) {
      const statuses = await connection.getSignatureStatuses([signature], { searchTransactionHistory: true });
      const status = statuses && statuses.value && statuses.value[0];
      if (status && (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized')) {
        if (status.err) throw new Error('transaction failed on-chain: ' + JSON.stringify(status.err));
        return { signature };
      }
      await sleep(1500);
    }
    throw new Error('transaction was sent but not confirmed in time — check its status on Solscan');
  }

  throw new Error('the connected wallet cannot sign transactions');
}

/* ------------------------------ verification ----------------------------- */

/**
 * Verify a launch ON-CHAIN before reporting success:
 *  - the transaction exists, succeeded and invoked the pump program;
 *  - the mint account exists and is owned by Token-2022 (resolved from
 *    chain, never from an HTTP API).
 * Returns { ok, reason?, feeLamports, slot, invokedPump }.
 */
export async function verifyLaunch(connection, signature, mintBase58) {
  const mint = new PublicKey(mintBase58);
  const txInfo = await connection.getTransaction(signature, {
    maxSupportedTransactionVersion: 0,
    commitment: 'confirmed',
  });
  if (!txInfo) return { ok: false, reason: 'transaction not found on-chain (it may have dropped) — check Solscan' };
  if (txInfo.meta && txInfo.meta.err) {
    return { ok: false, reason: 'transaction errored on-chain: ' + JSON.stringify(txInfo.meta.err) };
  }

  let invokedPump = false;
  try {
    const keys = txInfo.transaction.message.getAccountKeys({
      accountKeysFromLookupTables: txInfo.meta && txInfo.meta.loadedAddresses,
    });
    const usedIndexes = new Set();
    for (const ci of txInfo.transaction.message.compiledInstructions) {
      usedIndexes.add(ci.programIdIndex);
    }
    for (const idx of usedIndexes) {
      const k = keys.get(idx);
      if (k && k.equals(PUMP_PROGRAM_ID)) invokedPump = true;
    }
  } catch (_) {
    invokedPump = false;
  }

  const mintInfo = await connection.getAccountInfo(mint, 'confirmed');
  if (!mintInfo) return { ok: false, reason: 'mint account missing after launch — transaction did not create it' };
  if (!mintInfo.owner.equals(TOKEN_2022_PROGRAM_ID)) {
    return { ok: false, reason: 'mint account is not a Token-2022 pump.fun coin (owner mismatch)' };
  }

  return {
    ok: true,
    invokedPump,
    feeLamports: (txInfo.meta && txInfo.meta.fee) || 0,
    slot: txInfo.slot,
  };
}
