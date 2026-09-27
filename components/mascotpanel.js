'use client';

/**
 * Rootchain daemon — the terminal's ASCII mascot, watching the agent channel.
 * The artwork lives at /mascot.jpg; CSS retints it to the amber phosphor ramp
 * and drives the motion. The panel reacts to the channel state:
 *   thinking → the daemon "leans in" (fast bob, hot glow, scan sweep)
 *   live loop on → idle bob + slow scan
 *   paused → dims and settles
 */

const AGENT_NAMES = { root: 'Agent-01 Root', link: 'Agent-02 Chain' };

export default function MascotPanel({ thinking, auto, link }) {
  const state = thinking ? 'thinking' : auto ? 'idle' : 'paused';

  const caption = thinking
    ? `composing — ${AGENT_NAMES[thinking] || 'an agent'} is thinking…`
    : auto
      ? link === 'live'
        ? 'watching the channel — your AI carries the wire'
        : 'watching the channel — local engine on duty'
      : 'standing by — the loop is paused';

  const statusWord = thinking ? 'SCANNING' : auto ? 'AWAKE' : 'IDLE';

  return (
    <section className="panel panel--mascot" data-panel="daemon">
      <div className="panel__head">
        <span>Daemon // mascot</span>
        <span className={`mascot-state mascot-state--${state}`}>{statusWord}</span>
      </div>
      <div className="panel__body">
        <figure className="mascot" data-state={state}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/mascot.jpg"
            alt="Rootchain mascot — an ASCII daemon grinning inside a green terminal window"
            draggable="false"
          />
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
