/* Rootchain Launchpad · vanity mint worker ---------------------------------
 *
 * Self-contained (no imports): grinds Ed25519 keypairs via WebCrypto until a
 * base58 public key ends with the requested suffix (default "rtc").
 *
 * Runs OFF the main thread. The private key never leaves this worker except
 * once, as a PKCS#8 blob, when a match is found. Nothing is logged, stored
 * or sent anywhere else.
 *
 * messages in : { type: 'start', suffix } | { type: 'stop' }
 * messages out: { type: 'progress', attempts, rate } (every ~300ms)
 *               { type: 'found', address, pkcs8 }
 *               { type: 'error', message }
 * ------------------------------------------------------------------------- */

(function () {
  'use strict';

  var ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  var ALPHABET_MAP = {};
  for (var i = 0; i < ALPHABET.length; i++) ALPHABET_MAP[ALPHABET.charAt(i)] = i;

  var BATCH = 256; // keypairs generated per await cycle

  function toBase58(bytes) {
    var digits = [0];
    for (var i = 0; i < bytes.length; i++) {
      var carry = bytes[i];
      for (var j = 0; j < digits.length; j++) {
        carry += digits[j] << 8;
        digits[j] = carry % 58;
        carry = (carry / 58) | 0;
      }
      while (carry > 0) {
        digits.push(carry % 58);
        carry = (carry / 58) | 0;
      }
    }
    var out = '';
    for (var k = 0; bytes[k] === 0 && k < bytes.length - 1; k++) out += ALPHABET[0];
    for (var d = digits.length - 1; d >= 0; d--) out += ALPHABET[digits[d]];
    return out;
  }

  function validSuffix(s) {
    if (typeof s !== 'string' || s.length < 2 || s.length > 8) return false;
    for (var i = 0; i < s.length; i++) {
      if (ALPHABET_MAP[s.charAt(i)] === undefined) return false;
    }
    return true;
  }

  var suffix = null;
  var running = false;
  var attempts = 0;
  var attemptsAtLastPost = 0;
  var lastPost = 0;
  var rateEma = 0;

  function post(msg) {
    self.postMessage(msg);
  }

  async function supportsEd25519() {
    try {
      var kp = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign']);
      return !!kp && !!kp.publicKey;
    } catch (e) {
      return false;
    }
  }

  async function grind() {
    for (;;) {
      if (!running) return;

      // Generate a batch in parallel; native WebCrypto queues these efficiently.
      var gens = [];
      for (var g = 0; g < BATCH; g++) gens.push(crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign']));
      var keys = await Promise.all(gens);

      var hit = null;
      for (var k = 0; k < keys.length; k++) {
        if (!running) return;
        var raw = new Uint8Array(await crypto.subtle.exportKey('raw', keys[k].publicKey));
        var addr = toBase58(raw);
        if (addr.length >= 32 && addr.endsWith(suffix)) {
          hit = { addr: addr, kp: keys[k] };
          break;
        }
        attempts++;
      }
      if (hit) {
        // Export the winning private key exactly once, then stop.
        var pkcs8 = await crypto.subtle.exportKey('pkcs8', hit.kp.privateKey);
        var b64 = btoa(String.fromCharCode.apply(null, new Uint8Array(pkcs8)));
        running = false;
        post({ type: 'found', address: hit.addr, pkcs8: b64, attempts: attempts });
        return;
      }

      var now = Date.now();
      if (now - lastPost >= 300) {
        var delta = attempts - attemptsAtLastPost;
        var inst = delta / Math.max(1, now - lastPost); // keypairs per ms this window
        rateEma = rateEma ? rateEma * 0.7 + inst * 0.3 : inst;
        post({ type: 'progress', attempts: attempts, rate: Math.round(rateEma * 1000) });
        attemptsAtLastPost = attempts;
        lastPost = now;
      }
    }
  }

  self.onmessage = async function (ev) {
    var msg = ev.data || {};
    if (msg.type === 'stop') {
      running = false;
      return;
    }
    if (msg.type === 'start') {
      if (running) return;
      if (!validSuffix(msg.suffix)) {
        post({ type: 'error', message: 'invalid suffix' });
        return;
      }
      if (!(await supportsEd25519())) {
        post({
          type: 'error',
          message:
            'this browser has no WebCrypto Ed25519 support — use an up-to-date Chrome, Edge, Firefox or Safari',
        });
        return;
      }
      suffix = msg.suffix;
      attempts = 0;
      attemptsAtLastPost = 0;
      rateEma = 0;
      lastPost = Date.now();
      running = true;
      grind().catch(function (e) {
        running = false;
        post({ type: 'error', message: 'grind failed: ' + (e && e.message ? e.message : String(e)) });
      });
    }
  };
})();
