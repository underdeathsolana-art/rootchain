'use client';

export default function StatusBar({ status }) {
  const live = status.link === 'live';
  const label = live
    ? status.source === 'mcp'
      ? 'MCP LIVE'
      : 'API LIVE'
    : 'LOCAL ENGINE';
  const apiTone = live && !status.error ? 'ok' : status.error ? 'warn' : 'ok';

  return (
    <div className="statusbar">
      <span className="seg seg--ok">
        <span className="dot" aria-hidden="true" />
        SYSTEM <b>ONLINE</b>
      </span>
      <span className={`seg seg--${apiTone}`} title={status.error || undefined}>
        AI LINK: <b>{label}</b>
      </span>
      <span className="seg seg--ok">
        CROSS-CHAIN MODULE: <b>READY</b>
      </span>
      <span className="seg seg--ok">
        MEMORY: <b>{status.memory ? 'ACTIVE' : 'STANDBY'}</b>
      </span>
      <span className="seg">
        MODEL: <b>{status.model || 'local'}</b>
      </span>
    </div>
  );
}
