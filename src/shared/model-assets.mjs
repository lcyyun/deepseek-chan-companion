/** Only resolve aliases derived from the server's allowlisted model manifest. */
export function buildAssetLookup(assets, suffix) {
  const lookup = new Map();
  const ambiguous = new Set();
  const add = (alias, file) => {
    const key = String(alias).replaceAll('\\', '/').toLowerCase();
    if (!key || ambiguous.has(key)) return;
    if (lookup.has(key) && lookup.get(key) !== file) { lookup.delete(key); ambiguous.add(key); }
    else lookup.set(key, file);
  };
  for (const { name, file } of assets) {
    const basename = file.replaceAll('\\', '/').split('/').at(-1);
    for (const alias of [name, file, basename]) {
      add(alias, file);
      if (alias.toLowerCase().endsWith(suffix.toLowerCase())) add(alias.slice(0, -suffix.length), file);
    }
  }
  return lookup;
}

export function resolveAssetFile(lookup, name) {
  return lookup.get(String(name).replaceAll('\\', '/').toLowerCase());
}
