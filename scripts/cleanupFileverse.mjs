import 'dotenv/config';

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`[Config] Missing ${name}`);
  return value;
}

function buildUrl(path, params = {}) {
  const server = requireEnv('FILEVERSE_SERVER_URL').replace(/\/+$/, '');
  const apiKey = requireEnv('FILEVERSE_API_KEY');
  const url = new URL(`${server}${path}`);
  url.searchParams.set('apiKey', apiKey);
  Object.entries(params).forEach(([key, val]) => {
    if (val !== undefined && val !== null) url.searchParams.set(key, String(val));
  });
  return url.toString();
}

async function fetchJson(url, init) {
  const res = await fetch(url, init);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  return text ? JSON.parse(text) : null;
}

async function listDocs(limit, skip) {
  return fetchJson(buildUrl('/api/ddocs', { limit, skip }), { method: 'GET' });
}

async function deleteDoc(ddocId) {
  await fetchJson(buildUrl(`/api/ddocs/${ddocId}`), { method: 'DELETE' });
}

async function main() {
  const limit = 50;
  let skip = 0;
  let totalDeleted = 0;

  while (true) {
    const page = await listDocs(limit, skip);
    const docs = page?.ddocs ?? [];
    if (!docs.length) break;
    for (const doc of docs) {
      if (!doc?.ddocId) continue;
      await deleteDoc(doc.ddocId);
      totalDeleted += 1;
    }
    if (!page?.hasNext) break;
    skip += limit;
  }

  console.log(`[Cleanup] Deleted ${totalDeleted} Fileverse docs`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
