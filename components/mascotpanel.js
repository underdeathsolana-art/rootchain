'use client';

/**
 * Rootchain mark — the terminal's mascot, drawn as real ASCII text (no image):
 * a bold R whose bowl is open at the lower-left, with an elongated chain link
 * tilted 45° threaded through the opening, wordmark beneath. Pure CSS drives
 * the amber phosphor, glow and motion. The panel reacts to the channel state:
 *   thinking → the mark "leans in" (fast bob, hot glow, scan sweep)
 *   live loop on → idle bob + slow scan
 *   paused → dims and settles
 */

const MASCOT_ART = [
  '   ██████████████████████████████',
  '   ██████████████████████████████',
  '   ██████████████████████████████',
  '   ██████                  ██████',
  '   ██████            ███   ██████',
  '   ██████           ██░██  ██████',
  '   ██████          █░░░░██ ██████',
  '   ██████        ██░░░░░░█ ██████',
  '   ██████       ██░░░░░░██ ██████',
  '   ██████      ██░░░░░░░█████████',
  '   ██████     ██░░░░░░███████████',
  '   ██████    ██░░░░░░████████████',
  '   ██████   ██░░░░░░█████',
  '   ██████  ██░░░░░░██ ████',
  '   ██████ █░░░░░░░██    ████',
  '   ████████░░░░░░██      ████',
  '   ███████░░░░░░██        ████',
  '   ████████░░░░█           ████',
  '   ██████ ██░██              ████',
  '   ██████  ███                ████',
  '   ██████                      ████',
  '   ██████                       ████',
  '   ██████                         ████',
  '   ██████                          ████',
  '',
  ' ███  ███  ██   █   █  ███  █  █   █   █ ',
  '  █   █    █ █  ██ ██   █   ██ █  █ █  █ ',
  '  █   ██   ██   █ █ █   █   █ ██  ███  █ ',
  '  █   █    █ █  █   █   █   █  █  █ █  █ ',
  '  █   ███  █ █  █   █  ███  █  █  █ █  ███',
].join('\n');

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
        <figure className="mascot" data-state={state} role="img" aria-label="Rootchain mark — a bold letter R with a chain link threaded through its open bowl, TERMINAL wordmark beneath">
          <pre className="mascot__art" aria-hidden="true">{MASCOT_ART}</pre>
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
