// isomorphic-git HTTP client that routes through Rootchain's own /api/git
// relay — github.com's git endpoints have no CORS headers, so the browser
// client cannot reach them directly; our server forwards the requests.
// Implements the GitHttpRequest → GitHttpResponse contract isomorphic-git
// expects (body as an async iterable of Uint8Array chunks).

function fromValue(value) {
  let queue = [value];
  return {
    next() {
      return Promise.resolve({ done: queue.length === 0, value: queue.pop() });
    },
    return() {
      queue = [];
      return {};
    },
    [Symbol.asyncIterator]() {
      return this;
    },
  };
}

export function relayHttp() {
  return {
    async request({ url, method = 'GET', headers = {}, body }) {
      const relay = `/api/git?u=${encodeURIComponent(url)}`;
      const init = { method, headers: { ...headers } };
      if (body != null) {
        // the outgoing body is an async iterable of Uint8Array — flatten it
        const chunks = [];
        for await (const chunk of body) chunks.push(chunk);
        init.body = new Blob(chunks);
      }
      const res = await fetch(relay, init);
      const buf = new Uint8Array(await res.arrayBuffer());
      return {
        url,
        method,
        statusCode: res.status,
        statusMessage: res.statusText,
        headers: Object.fromEntries(res.headers.entries()),
        body: fromValue(buf),
      };
    },
  };
}
