// Tiny hash-based router. Routes are arrays like ['tasks', '12'] -> {path: 'tasks/12', parts: [...]}.
const subs = new Set();

export function onRoute(cb) { subs.add(cb); cb(parse()); return () => subs.delete(cb); }
export function go(hash) { window.location.hash = hash.startsWith('#') ? hash : '#' + hash; }
export function parse() {
  const raw = (window.location.hash || '#/').replace(/^#\/?/, '');
  const [pathPart, queryPart] = raw.split('?');
  const parts = pathPart.split('/').filter(Boolean);
  const query = {};
  if (queryPart) queryPart.split('&').forEach(kv => {
    const [k,v] = kv.split('=');
    query[decodeURIComponent(k)] = decodeURIComponent(v || '');
  });
  return { path: pathPart, parts, query };
}

window.addEventListener('hashchange', () => {
  const r = parse();
  subs.forEach(cb => { try { cb(r); } catch (e) { console.error(e); } });
});
