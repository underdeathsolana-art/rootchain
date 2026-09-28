// ROOTIDE runtimes — browser-side, loaded only when first used.
//
// · Python: Pyodide (WASM CPython) pulled from the jsDelivr CDN on first
//   run; the browser caches the ~10 MB runtime, so "installing Python"
//   means exactly that — it stays in the operator's browser storage.
//   `pip install` maps to micropip (pure-Python / WASM wheels).
// · JavaScript: executed in a Web Worker with console capture and a hard
//   timeout — no Node APIs, it is the browser runtime (clearly labelled).

const PYODIDE_VERSION = '0.28.3';
const PYODIDE_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

let pyodidePromise = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-rootide-runtime="${src}"]`);
    if (existing) {
      existing.addEventListener('load', resolve, { once: true });
      existing.addEventListener('error', reject, { once: true });
      return;
    }
    const el = document.createElement('script');
    el.src = src;
    el.async = true;
    el.dataset.rootideRuntime = src;
    el.onload = resolve;
    el.onerror = () => reject(new Error(`runtime download failed — ${src}`));
    document.head.appendChild(el);
  });
}

/** Get (or lazily download) the shared Pyodide runtime. */
export function getPython(onStatus) {
  if (!pyodidePromise) {
    pyodidePromise = (async () => {
      onStatus?.('downloading python runtime (pyodide) — first run only, cached afterwards…');
      await loadScript(`${PYODIDE_URL}pyodide.js`);
      const pyodide = await window.loadPyodide({ indexURL: PYODIDE_URL });
      onStatus?.('python runtime ready.');
      return pyodide;
    })().catch((err) => {
      pyodidePromise = null; // allow a retry
      throw err;
    });
  }
  return pyodidePromise;
}

/** Run Python code, returning captured stdout + the last expression. */
export async function runPython(code, onStatus) {
  const pyodide = await getPython(onStatus);
  let out = '';
  pyodide.setStdout({ batched: (s) => (out += `${s}\n`) });
  pyodide.setStderr({ batched: (s) => (out += `${s}\n`) });
  try {
    const result = await pyodide.runPythonAsync(code);
    if (result !== undefined && result !== null && typeof result?.print !== 'function') {
      out += `${String(result)}\n`;
    }
  } catch (err) {
    out += `${String(err.message || err)}\n`;
  }
  return out.trim();
}

/** pip install for the browser runtime (pure-python / WASM wheels only). */
export async function pipInstall(packages, onStatus) {
  const pyodide = await getPython(onStatus);
  await pyodide.loadPackage('micropip');
  const micropip = pyodide.pyimport('micropip');
  const list = (Array.isArray(packages) ? packages : [packages]).filter(Boolean);
  onStatus?.(`installing ${list.join(', ')}…`);
  await micropip.install(list);
  return list;
}

/** Run JavaScript in a Web Worker, capturing console output. */
export function runJavaScript(code, timeoutMs = 10000) {
  return new Promise((resolve) => {
    const src = [
      'self.onmessage = async (e) => {',
      '  const __out = [];',
      '  const push = (args) => __out.push(args.map((a) => {',
      '    try { return typeof a === "string" ? a : JSON.stringify(a); } catch { return String(a); }',
      '  }).join(" "));',
      '  const console = {',
      '    log: (...a) => push(a), info: (...a) => push(a), warn: (...a) => push(a),',
      '    error: (...a) => push(a), debug: (...a) => push(a),',
      '  };',
      '  try {',
      '    const result = await (new Function("console", \'"use strict"; return (async () => {\\n\' + e.data + \'\\n})()\'))(console);',
      '    if (result !== undefined) push([result]);',
      '  } catch (err) {',
      '    push([String((err && err.stack) || err)]);',
      '  }',
      '  self.postMessage(__out.join("\\n"));',
      '};',
    ].join('\n');
    const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    const worker = new Worker(url);
    const timer = setTimeout(() => {
      worker.terminate();
      resolve('(timed out after 10s — infinite loop?)');
    }, timeoutMs);
    worker.onmessage = (e) => {
      clearTimeout(timer);
      worker.terminate();
      URL.revokeObjectURL(url);
      resolve(String(e.data).trim() || '(no output — use console.log to print)');
    };
    worker.onerror = (e) => {
      clearTimeout(timer);
      worker.terminate();
      URL.revokeObjectURL(url);
      resolve(String(e.message || 'worker error'));
    };
    worker.postMessage(code);
  });
}
