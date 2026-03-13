import type {
  FileverseCreateResponse,
  FileverseDoc,
  FileverseListResponse,
  FileverseSearchResponse,
} from '../types';

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_RETRIES = 3;
const RETRY_BACKOFF_MS = 2_000;
const SKIP_SYNC = ['1', 'true', 'yes'].includes((process.env.FILEVERSE_SKIP_SYNC || '').toLowerCase());

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`[Config] Missing ${name}`);
  }
  return value;
}

function getServerUrl(): string {
  const raw = requireEnv('FILEVERSE_SERVER_URL');
  return raw.replace(/\/+$/, '');
}

function getApiKey(): string {
  return requireEnv('FILEVERSE_API_KEY');
}

function buildUrl(path: string, params: Record<string, string | number | undefined> = {}): string {
  const url = new URL(`${getServerUrl()}${path}`);
  url.searchParams.set('apiKey', getApiKey());
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchJson<T>(
  url: string,
  init?: RequestInit,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  retries = DEFAULT_RETRIES
): Promise<T> {
  let attempt = 0;
  let lastError: Error | null = null;

  while (attempt <= retries) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      const res = await fetch(url, {
        ...init,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const bodyText = await res.text();

      if (!res.ok) {
        throw new Error(`[Fileverse] HTTP ${res.status}: ${bodyText.slice(0, 200)}`);
      }

      if (!bodyText) return undefined as T;

      return JSON.parse(bodyText) as T;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error('Unknown error');
      attempt += 1;
      if (attempt > retries) break;
      await sleep(RETRY_BACKOFF_MS);
    }
  }

  throw lastError ?? new Error('[Fileverse] Request failed');
}

export async function createDoc(title: string, content: string): Promise<string> {
  const url = buildUrl('/api/ddocs');
  const payload = await fetchJson<FileverseCreateResponse>(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, content }),
  });

  if (!payload?.data?.ddocId) {
    throw new Error('[Fileverse] Missing ddocId in create response');
  }

  return payload.data.ddocId;
}

export async function getDoc(ddocId: string): Promise<FileverseDoc> {
  const url = buildUrl(`/api/ddocs/${ddocId}`);
  return fetchJson<FileverseDoc>(url, { method: 'GET' });
}

export async function updateDoc(ddocId: string, content: string, title?: string): Promise<void> {
  const url = buildUrl(`/api/ddocs/${ddocId}`);
  await fetchJson<void>(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(title ? { content, title } : { content }),
  });
}

export async function deleteDoc(ddocId: string): Promise<void> {
  const url = buildUrl(`/api/ddocs/${ddocId}`);
  await fetchJson<void>(url, { method: 'DELETE' });
}

export async function listDocs(limit = 50, skip = 0): Promise<FileverseListResponse> {
  const url = buildUrl('/api/ddocs', { limit, skip });
  return fetchJson<FileverseListResponse>(url, { method: 'GET' });
}

export async function searchDocs(query: string): Promise<FileverseSearchResponse> {
  const url = buildUrl('/api/search', { q: query });
  return fetchJson<FileverseSearchResponse>(url, { method: 'GET' });
}

export async function waitForSync(ddocId: string): Promise<string> {
  if (SKIP_SYNC) {
    console.warn('[Fileverse] FILEVERSE_SKIP_SYNC enabled; skipping sync wait');
    return '';
  }
  for (let i = 0; i < 20; i += 1) {
    const doc = await getDoc(ddocId);
    if (doc.syncStatus === 'synced' && doc.link) return doc.link;
    if (doc.syncStatus === 'failed') {
      throw new Error(`[Fileverse] Sync failed for ${ddocId}`);
    }
    await sleep(3_000);
  }

  throw new Error(`[Fileverse] Sync timeout for ${ddocId}`);
}
