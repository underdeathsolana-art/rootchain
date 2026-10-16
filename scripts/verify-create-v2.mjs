// offline verification: build a real create_v2 launch transaction (no send, no cost)
import { createHash } from 'node:crypto';
import {
  Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
  ComputeBudgetProgram,
} from '@solana/web3.js';
import * as PumpSdkModule from '@pump-fun/pump-sdk';

const PumpSdk = PumpSdkModule.PumpSdk || PumpSdkModule.default?.PumpSdk;
if (!PumpSdk) throw new Error('PumpSdk export not found');
console.log('PumpSdk ctor arity:', PumpSdk.length, '(offline builder)');

const sdk = new PumpSdk();
if (typeof sdk.createV2Instruction !== 'function') throw new Error('no createV2Instruction');

const mint = Keypair.generate();
const payer = Keypair.generate().publicKey; // stand-in wallet
const ix = await sdk.createV2Instruction({
  mint: mint.publicKey,
  name: 'Rootchain Root',
  symbol: 'ROOT',
  uri: 'ipfs://bafytesturi0000000000000000000000000000000000',
  creator: payer,
  user: payer,
  mayhemMode: false,
  holderReward: false,
});

// 1) is this really create_v2? compare anchor discriminator sha256("global:create_v2")[0..8]
const want = createHash('sha256').update('global:create_v2').digest().slice(0, 8);
const got = ix.data.slice(0, 8);
console.log('discriminator want:', want.toString('hex'));
console.log('discriminator got :', Buffer.from(got).toString('hex'));
console.log('DISCRIMINATOR MATCH:', Buffer.from(got).equals(want));
console.log('programId:', ix.programId.toBase58());
console.log('instruction data bytes:', ix.data.length);

// 2) account roles: mint must be a signer, user must be a signer+writer
const roles = ix.keys.map((k) => (k.isSigner ? 'S' : '-') + (k.isWritable ? 'W' : '-'));
console.log('keys (' + ix.keys.length + '):', roles.join(' '));
const mintIdx = ix.keys.findIndex((k) => k.pubkey.equals(mint.publicKey));
const userIdx = ix.keys.findIndex((k) => k.pubkey.equals(payer));
console.log('mint key idx', mintIdx, ix.keys[mintIdx]?.isSigner ? '(signer ✓)' : '(NOT SIGNER ✗)');
console.log('user key idx', userIdx, ix.keys[userIdx]?.isSigner ? '(signer ✓)' : '(NOT SIGNER ✗)');
const t22 = ix.keys.filter((k) => k.pubkey.equals(new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'))).length;
console.log('token-2022 program in accounts:', t22 > 0);

// 3) assemble the launch transaction exactly like lib/launch/pumpfun.js
const instructions = [
  ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
  ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 120_000 }),
  ix,
];
const message = new TransactionMessage({
  payerKey: payer,
  recentBlockhash: '11111111111111111111111111111111', // offline dummy
  instructions,
}).compileToV0Message();
const tx = new VersionedTransaction(message);
tx.sign([mint]); // mint partial-signs
const serialized = tx.serialize();
console.log('partial-signed tx bytes:', serialized.length.byteLength ?? serialized.length);
console.log('signatures:', tx.signatures.map((s) => Buffer.from(s).toString('hex').slice(0, 8)));
console.log('ALL OFFLINE CHECKS DONE');
