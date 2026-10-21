// An in-memory stand-in for @netlify/blobs with the slice of its API the function uses:
// getStore({ name }) -> { get(key, { type: 'json' }), setJSON(key, value), list({ prefix, directories }) }.
// Values are kept as JSON text, so everything round-trips through JSON exactly as it does on Netlify
// (null-prototype objects come back as plain objects, undefined fields disappear).
//
// list({ directories: true }) returns directory entries as prefix + segment, the form in the @netlify/blobs
// README ("cats" for "cats/garfield.jpg"); dirSlash: true appends a slash ("cats/") because the function's
// listDirs tolerates both and the live form is confirmed only by the first smoke row.
//
// failing: keys whose get() always throws; failOnce: keys whose first get() throws, then succeeds (the
// function retries once). log records every call: { store, op, key } for get/setJSON, { store, op, prefix,
// directories } for list.

export function createMemoryBlobs({ dirSlash = false } = {}) {
  const stores = new Map();
  const failing = new Set();
  const failOnce = new Set();
  const log = [];

  function bucket(name) {
    if (!stores.has(name)) stores.set(name, new Map());
    return stores.get(name);
  }

  function shouldFail(name, key) {
    if (failing.has(key) || failing.has(`${name}:${key}`)) return true;
    for (const k of [key, `${name}:${key}`]) {
      if (failOnce.has(k)) { failOnce.delete(k); return true; }
    }
    return false;
  }

  function getStore(opts) {
    const name = typeof opts === 'string' ? opts : opts && opts.name;
    if (!name) throw new Error('memory-blobs: getStore needs a name');
    const data = bucket(name);
    return {
      async get(key, options = {}) {
        log.push({ store: name, op: 'get', key });
        if (shouldFail(name, key)) throw new Error(`memory-blobs: read of ${name}/${key} failed`);
        if (!data.has(key)) return null;
        const text = data.get(key);
        if (options.type === 'json') return JSON.parse(text);
        return text;
      },
      async setJSON(key, value) {
        log.push({ store: name, op: 'setJSON', key });
        data.set(key, JSON.stringify(value));
      },
      async set(key, value) {
        log.push({ store: name, op: 'set', key });
        data.set(key, String(value));
      },
      async delete(key) {
        log.push({ store: name, op: 'delete', key });
        data.delete(key);
      },
      async list({ prefix = '', directories = false } = {}) {
        log.push({ store: name, op: 'list', prefix, directories });
        const blobs = [];
        const dirs = new Set();
        for (const key of [...data.keys()].sort()) {
          if (!key.startsWith(prefix)) continue;
          const rest = key.slice(prefix.length);
          const slash = rest.indexOf('/');
          if (directories && slash !== -1) dirs.add(prefix + rest.slice(0, slash) + (dirSlash ? '/' : ''));
          else blobs.push({ key, etag: `"${key.length}"` });
        }
        return { blobs, directories: [...dirs].sort() };
      }
    };
  }

  function dump(name) {
    const out = {};
    for (const [key, text] of [...bucket(name)].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) out[key] = JSON.parse(text);
    return out;
  }

  function rows(name) {
    return Object.values(dump(name));
  }

  return { getStore, stores, failing, failOnce, log, dump, rows };
}
