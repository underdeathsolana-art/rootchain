// ROOTIDE workspace — a per-operator virtual filesystem in the browser.
//
// Cloned repositories live in IndexedDB (lightning-fs, one database per
// operator username), so "what you clone stays with the user" is literal:
// nothing touches the server's disk. isomorphic-git talks to GitHub's smart
// HTTP through Rootchain's own /api/git relay (github serves no CORS headers
// on git endpoints; the relay also keeps us off rate-limited public proxies).
//
// Everything here is browser-only and loaded through dynamic imports, so the
// module is inert during SSR/prerender.

const REPO_ROOT = '/repos';
const MAX_FILES = 500;

let fsHandle = null;
let fsOwner = null;

/** One lightning-fs database per operator — their private workspace. */
async function getFs(username) {
  const owner = String(username || '').toLowerCase().replace(/[^a-z0-9-]/g, '-');
  if (!owner) throw new Error('Missing operator.');
  if (fsHandle && fsOwner === owner) return fsHandle;

  const { default: LightningFS } = await import('@isomorphic-git/lightning-fs');
  fsHandle = new LightningFS(`rootchain-ide-${owner}`);
  fsOwner = owner;
  return fsHandle;
}

function repoUrl(raw) {
  const url = String(raw || '').trim().replace(/\/+$/, '').replace(/\.git$/, '');
  if (!/^https:\/\/github\.com\//i.test(url)) {
    throw new Error('Only public https://github.com repos can be cloned.');
  }
  return `${url}.git`;
}

function repoNameFromUrl(raw) {
  const clean = String(raw || '').trim().replace(/\/+$/, '').replace(/\.git$/, '');
  const parts = clean.split('/');
  const name = parts[parts.length - 1] || 'repo';
  return name.toLowerCase().replace(/[^a-z0-9._-]/g, '-') || 'repo';
}

/** lightning-fs has no promises.rm — remove a tree by hand. */
async function rmDir(fs, dir) {
  let entries = [];
  try {
    entries = await fs.promises.readdir(dir);
  } catch {
    return; // already gone
  }
  for (const entry of entries) {
    const full = `${dir}/${entry}`;
    let stat = null;
    try {
      stat = await fs.promises.stat(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) await rmDir(fs, full);
    else await fs.promises.unlink(full).catch(() => {});
  }
  await fs.promises.rmdir(dir).catch(() => {});
}

/** Clone a public repo (depth 1) into the operator's virtual FS. */
export async function cloneRepo(username, rawUrl) {
  const fs = await getFs(username);
  const { relayHttp } = await import('./gitRelay');
  const isogit = (await import('isomorphic-git')).default;

  const name = repoNameFromUrl(rawUrl);
  const dir = `${REPO_ROOT}/${name}`;
  try {
    // only a completed clone has .git — a leftover dir from a failed clone
    // (network dropped mid-way) is wiped and retried
    await fs.promises.stat(`${dir}/.git`);
    return { ok: false, error: `"${name}" already exists — "rmrepo ${name}" removes it first.` };
  } catch {
    await rmDir(fs, dir);
  }

  await isogit.clone({
    fs,
    http: relayHttp(),
    dir,
    url: repoUrl(rawUrl),
    depth: 1,
    singleBranch: true,
    noCheckout: false,
  });

  const files = await walk(fs, dir);
  return { ok: true, repo: name, files: files.length };
}

async function walk(fs, dir) {
  const out = [];
  const stack = [dir];
  while (stack.length && out.length < MAX_FILES) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = await fs.promises.readdir(current);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry === '.git') continue;
      const full = `${current}/${entry}`;
      let stat = null;
      try {
        stat = await fs.promises.stat(full);
      } catch {
        continue;
      }
      if (stat.isDirectory()) stack.push(full);
      else out.push(full.slice(REPO_ROOT.length + 1));
    }
  }
  return out.sort();
}

/** Every file of every cloned repo, as "repo/path" strings. */
export async function listWorkspace(username) {
  const fs = await getFs(username);
  let repos = [];
  try {
    repos = await fs.promises.readdir(REPO_ROOT);
  } catch {
    return [];
  }
  const out = [];
  for (const repo of repos) {
    for (const file of await walk(fs, `${REPO_ROOT}/${repo}`)) {
      out.push(file);
    }
  }
  return out;
}

export async function readWorkspaceFile(username, path) {
  const fs = await getFs(username);
  const clean = String(path || '').replace(/^\/+/, '');
  if (clean.includes('..')) throw new Error('Nice try — no path traversal.');
  const buf = await fs.promises.readFile(`${REPO_ROOT}/${clean}`);
  return new TextDecoder().decode(buf);
}

/** Write an edited file back into the operator's virtual FS. */
export async function writeWorkspaceFile(username, path, content) {
  const fs = await getFs(username);
  const clean = String(path || '').replace(/^\/+/, '');
  if (clean.includes('..')) throw new Error('Nice try — no path traversal.');
  await fs.promises.writeFile(`${REPO_ROOT}/${clean}`, new TextEncoder().encode(content), 'utf8');
  return clean;
}

/** Remove one repo directory. */
export async function removeRepo(username, repoName) {
  const fs = await getFs(username);
  const name = repoNameFromUrl(repoName);
  const dir = `${REPO_ROOT}/${name}`;
  try {
    await fs.promises.stat(dir);
  } catch {
    return { ok: false, error: `no repo named "${name}".` };
  }
  await rmDir(fs, dir);
  return { ok: true, removed: name };
}

/** List cloned repo names. */
export async function listRepos(username) {
  const fs = await getFs(username);
  try {
    return await fs.promises.readdir(REPO_ROOT);
  } catch {
    return [];
  }
}
