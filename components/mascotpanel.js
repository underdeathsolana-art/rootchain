'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Rootchain daemon-cat — the terminal's mascot, drawn as real ASCII text
 * (no image): a chibi black cat with a pixel-P mark on its forehead, huge
 * glowing eyes, an open smile and a tail that ends in a lantern tip. Pure
 * CSS drives the amber phosphor, glow and motion.
 *
 * Passive motion: idle bob + CRT flicker + scan sweep + slow eye-blink
 * (a second <pre> layer crossfades in) + pulsing tail lantern.
 *
 * Interactive trigger animation: click the cat (or focus + Enter/Space) to
 * cycle reactions — pounce (hop & squash), zap (jitter & flash), purr
 * (sway) — each with its own caption; the cat settles back by itself.
 * Channel state still leans it: thinking → hot & fast, idle → awake,
 * paused → dim.
 */

const MASCOT_ART = [
  '     ▄█▄                  ▄█▄',
  '    ▄█▀ ▀█▄            ▄█▀ ▀█▄',
  '    ▐█▌   ▀██▄      ▄██▀   ▌█▐',
  '     ▀█▄▄▄▄▄██████████▄▄▄▄▄█▀',
  '    ▄▄██████████████████████▄▄',
  '   ▄██████████ ▄▀▀▄ ██████████▄',
  '   ███████████ █▀   ███████████',
  '  ▄███████████ █▄▄▄ ███████████▄',
  '  ██████▄████▄██████▄████▄██████      ▀▐▓▓▓▌▀',
  '  █████ ▄████▄ ████ ▄████▄ █████  ▐█▄▄▄',
  '  █████ ██▒████ ██ ████▒██ █████  ▐█',
  '  █████ ██▒▒███ ██ ███▒▒██ █████  ▐█',
  '  █████ ▀████▀ ████ ▀████▀ █████  ▐█▀',
  '   ███████████  ▀█▀  ██████████   ▄▄█▀',
  '    █████████  ▄▀▀▄  █████████',
  '     ▀███████  ▐▒▒▌  ███████▀',
  '        ▄████████████████▄',
  '       ████████████████████',
  '      ███ ▀▀▀▀▀▀▀▀▀▀▀▀▀▀ ███',
  '      ███ ██████████████ ███',
  '      ████      ████',
  '       ▀▀▀      ▀▀▀',
  '',
  ' ███  ███  ██   █   █  ███  █  █   █   █',
  '  █   █    █ █  ██ ██   █   ██ █  █ █  █',
  '  █   ██   ██   █ █ █   █   █ ██  ███  █',
  '  █   █    █ █  █   █   █   █  █  █ █  █',
  '  █   ███  █ █  █   █  ███  █  █  █ █  ███',
];

// identical frame, eyes closed — crossfades on top for the blink beat
const MASCOT_BLINK = [
  '     ▄█▄                  ▄█▄',
  '    ▄█▀ ▀█▄            ▄█▀ ▀█▄',
  '    ▐█▌   ▀██▄      ▄██▀   ▌█▐',
  '     ▀█▄▄▄▄▄██████████▄▄▄▄▄█▀',
  '    ▄▄██████████████████████▄▄',
  '   ▄██████████ ▄▀▀▄ ██████████▄',
  '   ███████████ █▀   ███████████',
  '  ▄███████████ █▄▄▄ ███████████▄',
  '  ██████▄████▄██████▄████▄██████      ▀▐▓▓▓▌▀',
  '  █████  ▄▄▄▄  ████  ▄▄▄▄  █████  ▐█▄▄▄',
  '  █████   ▀▀  █ ██ █  ▀▀   █████  ▐█',
  '  █████   ▀▀  █ ██ █  ▀▀   █████  ▐█',
  '  █████  ▀▀▀▀  ████  ▀▀▀▀  █████  ▐█▀',
  '   ███████████  ▀█▀  ██████████   ▄▄█▀',
  '    █████████  ▄▀▀▄  █████████',
  '     ▀███████  ▐▒▒▌  ███████▀',
  '        ▄████████████████▄',
  '       ████████████████████',
  '      ███ ▀▀▀▀▀▀▀▀▀▀▀▀▀▀ ███',
  '      ███ ██████████████ ███',
  '      ████      ████',
  '       ▀▀▀      ▀▀▀',
  '',
  ' ███  ███  ██   █   █  ███  █  █   █   █',
  '  █   █    █ █  ██ ██   █   ██ █  █ █  █',
  '  █   ██   ██   █ █ █   █   █ ██  ███  █',
  '  █   █    █ █  █   █   █   █  █  █ █  █',
  '  █   ███  █ █  █   █  ███  █  █  █ █  ███',
];

const TIP = '▐▓▓▓▌'; // lantern tail tip — gets its own pulse

function ArtLines({ lines, tipClass }) {
  return lines.map((line, i) => {
    const at = line.indexOf(TIP);
    if (at === -1) return <span key={i}>{line}{'\n'}</span>;
    return (
      <span key={i}>
        {line.slice(0, at)}
        <span className={tipClass}>{TIP}</span>
        {line.slice(at + TIP.length)}
        {'\n'}
      </span>
    );
  });
}

const AGENT_NAMES = { root: 'Agent-01 Root', link: 'Agent-02 Chain' };

const REACTIONS = [
  { id: 'pounce', ms: 1000, caption: '*pounce!* the daemon cat greets you — terminal nominal' },
  { id: 'zap', ms: 800, caption: '⚡ tail charged — *root mode armed' },
  { id: 'purr', ms: 2000, caption: 'purring at 60 fps — the channel hums along' },
];

export default function MascotPanel({ thinking, auto, link }) {
  const state = thinking ? 'thinking' : auto ? 'idle' : 'paused';
  const [reaction, setReaction] = useState(null);
  const timerRef = useRef(null);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const poke = useCallback(() => {
    clearTimeout(timerRef.current);
    const prev = REACTIONS.findIndex((r) => r.id === reaction);
    const next = REACTIONS[(prev + 1) % REACTIONS.length];
    setReaction(next.id);
    timerRef.current = setTimeout(() => setReaction(null), next.ms + 250);
  }, [reaction]);

  const baseCaption = thinking
    ? `composing — ${AGENT_NAMES[thinking] || 'an agent'} is thinking…`
    : auto
      ? link === 'live'
        ? 'watching the channel — your AI carries the wire'
        : 'watching the channel — local engine on duty'
      : 'standing by — the loop is paused';

  const reactionInfo = reaction ? REACTIONS.find((r) => r.id === reaction) : null;
  const caption = reactionInfo ? reactionInfo.caption : baseCaption;

  const statusWord = reaction ? 'ALIVE' : thinking ? 'SCANNING' : auto ? 'AWAKE' : 'IDLE';

  return (
    <section className="panel panel--mascot" data-panel="daemon">
      <div className="panel__head">
        <span>Daemon // mascot</span>
        <span className={`mascot-state mascot-state--${state}`}>{statusWord}</span>
      </div>
      <div className="panel__body">
        <figure
          className="mascot mascot--poke"
          data-state={state}
          data-reaction={reaction || undefined}
          tabIndex={0}
          role="button"
          aria-label="poke the daemon cat — triggers an animation"
          title="poke the daemon"
          onClick={poke}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              poke();
            }
          }}
        >
          <pre className="mascot__art" aria-hidden="true">
            <ArtLines lines={MASCOT_ART} tipClass="mascot__tip" />
          </pre>
          <pre className="mascot__art mascot__blink" aria-hidden="true">
            <ArtLines lines={MASCOT_BLINK} tipClass="mascot__tip" />
          </pre>
          <span className="mascot__scan" aria-hidden="true" />
          <span className="mascot__glow" aria-hidden="true" />
        </figure>
        <p className="mascot__caption" aria-live="polite">
          <span className="mascot__cursor" aria-hidden="true" /> {caption}
        </p>
      </div>
    </section>
  );
}
