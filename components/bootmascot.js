'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CAT_ART, CAT_TIP } from '@/lib/daemoncat';

/**
 * Boot easter egg — when someone opens rtcterminal.com, the daemon-cat
 * wakes up centre-screen: the ASCII materialises row by row, the tail
 * lantern charges, the cat pounces with a CRT power-flash, then leaps
 * away (home: the mascot panel) and the real terminal takes over.
 *
 * ~3.5s total, skippable with a click / any key / Esc, skipped entirely
 * for prefers-reduced-motion. Purely decorative (aria-hidden) and mounted
 * from the root layout so it covers the boot splash, the gate and the
 * terminal alike.
 */

const GREETS = [
  'mrrp. booting the chain…',
  '*stretches* warming the phosphor…',
  'paws on the keys — restoring secure channel…',
  'nine lives, one terminal…',
  'daemon on duty. do not feed after midnight.',
];

// phase → ms into the sequence
const SEQUENCE = [
  ['charge', 1500],
  ['pounce', 2200],
  ['exit', 2850],
  ['gone', 3500],
];

export default function BootMascot() {
  const [phase, setPhase] = useState('reveal');
  const greet = useMemo(() => GREETS[Math.floor(Math.random() * GREETS.length)], []);
  const timersRef = useRef([]);

  const clearAll = useCallback(() => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
  }, []);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setPhase('gone');
      return;
    }
    let at = 0;
    SEQUENCE.forEach(([next, ms]) => {
      at = ms;
      timersRef.current.push(setTimeout(() => setPhase(next), ms));
    });
    const onKey = (e) => {
      if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') skip();
    };
    window.addEventListener('keydown', onKey, { once: true });
    return () => {
      clearAll();
      window.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const skip = useCallback(() => {
    if (phase === 'exit' || phase === 'gone') return;
    clearAll();
    setPhase('exit');
    timersRef.current.push(setTimeout(() => setPhase('gone'), 450));
  }, [phase, clearAll]);

  if (phase === 'gone') return null;

  return (
    <div className="bm" data-phase={phase} onClick={skip} role="presentation">
      <span className="bm-flash" aria-hidden="true" />
      <div className="bm-cat" aria-hidden="true">
        <pre className="bm-art">
          {CAT_ART.map((line, i) => {
            const at = line.indexOf(CAT_TIP);
            return (
              <span
                className="bm-row"
                key={i}
                style={{ '--d': `${120 + i * 34}ms` }}
              >
                {at === -1 ? (
                  line
                ) : (
                  <>
                    {line.slice(0, at)}
                    <span className="bm-tip">{CAT_TIP}</span>
                    {line.slice(at + CAT_TIP.length)}
                  </>
                )}
                {'\n'}
              </span>
            );
          })}
        </pre>
      </div>
      <p className="bm-line" aria-hidden="true">
        <span className="bm-line__prompt">&gt;</span> {greet}
        <span className="caret" aria-hidden="true" />
      </p>
      <p className="bm-hint" aria-hidden="true">click to skip</p>
    </div>
  );
}
