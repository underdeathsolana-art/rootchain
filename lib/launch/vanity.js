'use client';

/**
 * Rootchain Launchpad · vanity mint search manager.
 *
 * Spawns workers from /workers/vanity-root.worker.js, aggregates their
 * progress, and on the first hit re-derives the keypair on the main thread
 * from the exported PKCS#8 seed — the address is verified against the exact
 * suffix BEFORE anything is allowed to proceed. The mint keypair lives only
 * in memory (a ref held by the caller); it is never logged, stored or sent
 * to any server.
 */

import { Keypair } from '@solana/web3.js';

// 3-char suffix ≈ 1 in 58³ ≈ 195k keypairs — seconds, not minutes ('root' was 58× harder)
export const VANITY_SUFFIX = 'rtc';
export const VANITY_WORKER_URL = '/workers/vanity-root.worker.js';

const B58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function isValidBase58(str) {
  if (typeof str !== 'string' || str.length < 2) return false;
  for (const ch of str) if (!B58_ALPHABET.includes(ch)) return false;
  return true;
}

/** Approximate probability that a random Solana pubkey ends with `suffix`. */
export function suffixProbability(suffix) {
  return 1 / Math.pow(58, suffix.length);
}

export function expectedAttempts(suffix) {
  return 1 / suffixProbability(suffix);
}

/** Mean time to find, given the current combined rate (keys/sec). */
export function etaSeconds(suffix, ratePerSec) {
  if (!ratePerSec || ratePerSec <= 0) return null;
  return expectedAttempts(suffix) / ratePerSec;
}

/** P(at least one hit) after n attempts — for honest progress reporting. */
export function chanceAfterAttempts(suffix, attempts) {
  const p = suffixProbability(suffix);
  return 1 - Math.pow(1 - p, attempts);
}

export function defaultWorkerCount() {
  const hc = typeof navigator !== 'undefined' && navigator.hardwareConcurrency ? navigator.hardwareConcurrency : 4;
  return Math.max(1, Math.min(6, hc - 1));
}

/** Extract the 32-byte Ed25519 seed from a standard PKCS#8 blob (last 32 bytes). */
function seedFromPkcs8Bytes(pkcs8) {
  if (pkcs8.length < 32) throw new Error('pkcs8 too short');
  return pkcs8.slice(pkcs8.length - 32);
}

function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Search for a keypair whose base58 address ends with `suffix`.
 *
 * Returns { promise, cancel }. `promise` resolves with
 *   { address, mintKeypair, attempts, elapsedMs }
 * or rejects. `cancel()` terminates every worker; the promise then rejects
 * with an error carrying `cancelled: true`.
 */
export function searchVanityMint({ suffix = VANITY_SUFFIX, workerCount = defaultWorkerCount(), onProgress } = {}) {
  if (!isValidBase58(suffix)) {
    return { promise: Promise.reject(new Error(`invalid suffix "${suffix}"`)), cancel: () => {} };
  }

  const startedAt = Date.now();
  const entries = []; // { worker, lastAttempts, lastRate }
  let attempts = 0;
  let settled = false;
  let progressTimer = null;
  let settleFn = null;
  const cancelError = Object.assign(new Error('vanity search cancelled'), { cancelled: true });

  const stopAll = () => {
    if (progressTimer) clearInterval(progressTimer);
    for (const e of entries) {
      try {
        e.worker.terminate();
      } catch (_) {}
    }
  };

  const cancel = () => {
    if (settled) return;
    stopAll();
    if (settleFn) settleFn.reject(cancelError);
  };

  const promise = new Promise((resolve, reject) => {
    settleFn = { resolve, reject };
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      stopAll();
      fn(value);
    };
    const failAll = (message) => finish(reject, new Error(message));

    const handleFound = (msg) => {
      let mintKeypair;
      try {
        const seed = seedFromPkcs8Bytes(base64ToBytes(msg.pkcs8));
        mintKeypair = Keypair.fromSecretKey(seed);
      } catch (e) {
        failAll('failed to reconstruct mint keypair: ' + (e && e.message ? e.message : String(e)));
        return;
      }
      // Re-derive + verify the EXACT suffix match on the main thread. Never
      // trust the worker's claim on its own.
      const address = mintKeypair.publicKey.toBase58();
      if (address !== msg.address || !address.endsWith(suffix)) {
        failAll(`mint verification failed — address does not end with "${suffix}"`);
        return;
      }
      finish(resolve, { address, mintKeypair, attempts: msg.attempts, elapsedMs: Date.now() - startedAt });
    };

    const n = Math.max(1, Math.min(8, Math.floor(workerCount)));
    for (let i = 0; i < n; i++) {
      const worker = new Worker(VANITY_WORKER_URL);
      const entry = { worker, lastAttempts: 0, lastRate: 0 };
      entries.push(entry);
      worker.onmessage = (ev) => {
        if (settled) return;
        const msg = ev.data || {};
        if (msg.type === 'progress') {
          attempts += Math.max(0, msg.attempts - entry.lastAttempts);
          entry.lastAttempts = msg.attempts;
          entry.lastRate = msg.rate || entry.lastRate;
        } else if (msg.type === 'error') {
          failAll(msg.message || 'worker error');
        } else if (msg.type === 'found') {
          handleFound(msg);
        }
      };
      worker.onerror = (e) => failAll('worker crashed: ' + (e.message || 'unknown error'));
      worker.postMessage({ type: 'start', suffix });
    }

    progressTimer = setInterval(() => {
      if (settled || !onProgress) return;
      const ratePerSec = entries.reduce((sum, e) => sum + (e.lastRate || 0), 0);
      onProgress({
        attempts,
        ratePerSec,
        elapsedMs: Date.now() - startedAt,
        chance: chanceAfterAttempts(suffix, attempts),
      });
    }, 350);
  });

  return { promise, cancel };
}
