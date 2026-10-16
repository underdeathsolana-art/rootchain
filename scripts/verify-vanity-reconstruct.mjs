// regression: worker→main-thread keypair reconstruction path (pkcs8 → fromSeed).
// catches the "bad secret key size" class of bug without grinding a suffix.
import { Keypair } from '@solana/web3.js';

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function toBase58(bytes) {
  const digits = [0];
  for (let i = 0; i < bytes.length; i++) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let out = '';
  for (let k = 0; bytes[k] === 0 && k < bytes.length - 1; k++) out += B58[0];
  for (let d = digits.length - 1; d >= 0; d--) out += B58[digits[d]];
  return out;
}

for (let round = 0; round < 20; round++) {
  const kp = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign']);
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', kp.privateKey));

  // exactly what the worker sends
  const b64 = btoa(String.fromCharCode(...pkcs8));
  const back = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const seed = back.slice(back.length - 32);

  // exactly what the main thread does after the fix
  const mint = Keypair.fromSeed(seed);
  const address = mint.publicKey.toBase58();

  if (address !== toBase58(raw)) throw new Error(`round ${round}: address mismatch`);
  if (typeof mint.secretKey === 'undefined' || mint.secretKey.length !== 64) {
    throw new Error(`round ${round}: secretKey length ${mint.secretKey?.length}`);
  }
}
console.log('OK: 20/20 pkcs8 → Keypair.fromSeed reconstructions match & produce 64-byte secret keys');
