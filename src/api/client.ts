import type { CodeReviewPayload, FindingsUi } from './types';
import { Agent, fetch as undiciFetch } from 'undici';
import { isConnectFailure } from './networkError';

/**
 * Prefer shorter connect attempts + retries over a single 60s hang.
 * Connect failures are safe to retry for POST (server never accepted the socket).
 */
const apiAgent = new Agent({
  connectTimeout: 25_000,
  headersTimeout: 120_000,
  bodyTimeout: 120_000,
  keepAliveTimeout: 30_000,
});

const CONNECT_RETRY_ATTEMPTS = 3;
const CONNECT_RETRY_DELAYS_MS = [800, 2000];

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function apiFetch(url: string, init: RequestInit): Promise<Response> {
  return undiciFetch(url, {
    ...init,
    dispatcher: apiAgent,
  }) as unknown as Promise<Response>;
}

/**
 * Node fetch (undici) requires header values as ISO-8859-1. Build the key from code points only in 0-9a-f
 * so lone UTF-16 surrogates, emoji, homoglyphs, and BOM never reach Authorization.
 */
export function normalizeApiKey(raw: string): string {
  const s = raw.normalize('NFKC');
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 48 && c <= 57) out += String.fromCharCode(c);
    else if (c >= 65 && c <= 70) out += String.fromCharCode(c);
    else if (c >= 97 && c <= 102) out += String.fromCharCode(c);
  }
  return out;
}

/** API host should be ASCII-only in settings (avoids ByteString issues in URL parsing). */
export function sanitizeApiBaseUrl(raw: string): string {
  const s = raw.normalize('NFKC').trim().replace(/\/+$/, '');
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c <= 127) out += s[i];
  }
  return out.trim();
}

/**
 * Path segments after the configured base (no leading slash).
 * Production: base https://api.code-critic.com → …/v1/code_reviews.
 * Local Rack (Grape prefix /api): set apiBaseUrl to http://localhost:9292/api → …/api/v1/code_reviews.
 */
const API_VERSION_PATH = 'v1';

/** Join API base + path (exported for unit tests). */
export function joinApiUrl(base: string, path: string): string {
  const b = base.replace(/\/+$/, '');
  const segment = path.replace(/^\/+/, '');
  try {
    const u = new URL(b.endsWith('/') ? b : `${b}/`);
    const basePath = u.pathname.replace(/\/+$/, '');
    u.pathname = basePath ? `${basePath}/${segment}` : `/${segment}`;
    return u.href;
  } catch {
    throw new Error(`Invalid API base URL. Check setting codecritic.apiBaseUrl (got ${b.slice(0, 80)}…).`);
  }
}

/** Grape and proxies use different shapes; avoid showing bare "HTTP 400". */
function extractApiErrorText(json: unknown, status: number): string {
  const asTrimmedString = (v: unknown): string | undefined => {
    if (typeof v !== 'string') return undefined;
    const t = v.trim();
    return t.length ? t : undefined;
  };

  const flattenUnknown = (v: unknown, depth = 0): string | undefined => {
    if (v == null) return undefined;
    const direct = asTrimmedString(v);
    if (direct) return direct;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    if (Array.isArray(v)) {
      const parts = v
        .map((x) => flattenUnknown(x, depth + 1))
        .filter((x): x is string => typeof x === 'string' && x.length > 0);
      return parts.length ? parts.join('; ') : undefined;
    }
    if (typeof v === 'object' && depth < 4) {
      const o = v as Record<string, unknown>;
      const fromFields =
        flattenUnknown(o.message, depth + 1) ||
        flattenUnknown(o.error, depth + 1) ||
        flattenUnknown(o.reason, depth + 1) ||
        flattenUnknown(o.detail, depth + 1) ||
        flattenUnknown(o.details, depth + 1) ||
        flattenUnknown(o.errors, depth + 1) ||
        flattenUnknown(o.title, depth + 1);
      if (fromFields) return fromFields;
      // Grape-style { "field": ["msg"] }
      const keys = Object.keys(o);
      if (keys.length) {
        const bits = keys.flatMap((k) => {
          const val = o[k];
          if (Array.isArray(val)) {
            return val.map((x) => (asTrimmedString(x) ? `${k}: ${String(x).trim()}` : null)).filter(Boolean) as string[];
          }
          const s = asTrimmedString(val);
          return s ? [`${k}: ${s}`] : [];
        });
        if (bits.length) return bits.join('; ');
      }
      try {
        const raw = JSON.stringify(o);
        if (raw && raw !== '{}') return raw.length > 420 ? `${raw.slice(0, 420)}…` : raw;
      } catch {
        /* ignore */
      }
    }
    return undefined;
  };

  if (typeof json === 'string') return asTrimmedString(json) || `HTTP ${status}`;

  const text = flattenUnknown(json);
  return text || `HTTP ${status}`;
}

export class CodeCriticClient {
  constructor(
    private readonly baseUrl: string,
    private readonly getApiKey: () => Promise<string | undefined>
  ) {}

  private async headers(): Promise<Record<string, string>> {
    const raw = (await this.getApiKey()) ?? '';
    const key = normalizeApiKey(raw);
    if (!key) {
      throw new Error('No API key. Run CodeCritic: Set API key.');
    }
    const auth = `Bearer ${key}`;
    return {
      Authorization: auth,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
  }

  /**
   * Grape errors are JSON; reverse proxies often return HTML/plain for 404.
   */
  private async readJsonOrFail(res: Response, method: string, url: string): Promise<unknown> {
    const text = await res.text();
    if (!text) {
      if (!res.ok) {
        throw this.httpFailure(res.status, method, url, '');
      }
      return {};
    }
    try {
      return JSON.parse(text) as unknown;
    } catch {
      if (!res.ok) {
        throw this.httpFailure(res.status, method, url, text);
      }
      throw new Error(
        `Expected JSON from API (${res.status}) ${method} ${url}. Body starts with: ${text.slice(0, 120).replace(/\s+/g, ' ')}`
      );
    }
  }

  private httpFailure(status: number, method: string, url: string, body: string): Error {
    const snippet = body.replace(/\s+/g, ' ').trim().slice(0, 200);
    let msg = `HTTP ${status}${snippet ? `: ${snippet}` : ''} (${method} ${url})`;
    if (status === 404) {
      msg +=
        '. Wrong host or path: set codecritic.apiBaseUrl to the API origin only (e.g. https://api.code-critic.com). Do not use the marketing site URL; /v1/... is added by the extension.';
    }
    return new Error(msg);
  }

  /** Undici often throws Error with message "fetch failed" and a richer `cause`. */
  private networkErrorDetail(e: unknown): string {
    if (!(e instanceof Error)) return String(e);
    const bits: string[] = [e.message];
    const c = e.cause;
    if (c instanceof Error) bits.push(c.message);
    else if (c != null && typeof c !== 'object') bits.push(String(c));
    const agg = e as Error & { errors?: unknown[] };
    if (Array.isArray(agg.errors) && agg.errors.length > 0) {
      const first = agg.errors[0];
      if (first instanceof Error) bits.push(first.message);
    }
    return [...new Set(bits.filter(Boolean))].join(' · ');
  }

  private throwNetworkError(url: string, method: string, e: unknown): never {
    const detail = this.networkErrorDetail(e);
    const hints: string[] = [];
    if (/enotfound|getaddrinfo|not known|nxdomain/i.test(detail)) {
      hints.push('Check codecritic.apiBaseUrl spelling, DNS, and VPN.');
    } else if (/cert|ssl|tls|certificate|unable to verify/i.test(detail)) {
      hints.push('TLS or certificate issue (proxy, corporate SSL inspection, or wrong host).');
    } else if (/econnrefused|connection refused/i.test(detail)) {
      hints.push('Connection refused: wrong port, service down, or firewall.');
    } else if (/etimedout|timed out|timeout/i.test(detail)) {
      hints.push('Timeout: slow network, firewall, or unreachable host.');
    } else if (/fetch failed/i.test(detail)) {
      hints.push(
        'Often: offline, VPN/firewall blocking Node, or an HTTP proxy required for VS Code. Try the same URL in a browser.'
      );
    }
    const hint = hints.length ? ` ${hints[0]}` : '';
    throw new Error(`Network error (${method} ${url}): ${detail}.${hint}`);
  }

  private async request<T>(
    method: string,
    apiPath: string,
    body?: unknown
  ): Promise<{ ok: boolean; status: number; json: T }> {
    const url = joinApiUrl(this.baseUrl, apiPath);
    const init: RequestInit = {
      method,
      headers: await this.headers(),
    };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }

    let lastError: unknown;
    for (let attempt = 0; attempt < CONNECT_RETRY_ATTEMPTS; attempt++) {
      try {
        const res = await apiFetch(url, init);
        const json = (await this.readJsonOrFail(res, method, url)) as T;
        return { ok: res.ok, status: res.status, json };
      } catch (e) {
        lastError = e;
        const msg = e instanceof Error ? e.message : String(e);
        if (/ByteString|character at index|greater than 255/i.test(msg)) {
          throw new Error(
            'HTTP client rejected a header value (non-ASCII). Run CodeCritic: Set API key and paste the hex key from the dashboard only. Check codecritic.apiBaseUrl has no special characters. Then reload the window.'
          );
        }
        // Only retry when the TCP/TLS connect never completed (safe for POST create).
        if (!isConnectFailure(e) || attempt >= CONNECT_RETRY_ATTEMPTS - 1) {
          this.throwNetworkError(url, method, e);
        }
        await delay(CONNECT_RETRY_DELAYS_MS[attempt] ?? 2000);
      }
    }
    this.throwNetworkError(url, method, lastError);
  }

  async createReview(payload: {
    code: string;
    language: string;
    title?: string;
    description?: string;
  }): Promise<{ uuid: string }> {
    const { ok, status, json } = await this.request<unknown>('POST', `${API_VERSION_PATH}/code_reviews`, payload);
    if (!ok) {
      throw this.formatError(status, json);
    }
    const root = json as Record<string, unknown>;
    const data = (root.data as Record<string, unknown> | undefined) ?? root;
    const review = (data.review as Record<string, unknown> | undefined) ?? (root.review as Record<string, unknown>);
    const uuid = review?.uuid as string | undefined;
    if (!uuid) {
      throw new Error('Create review: missing uuid in response');
    }
    return { uuid };
  }

  async getReview(uuid: string): Promise<CodeReviewPayload> {
    const { ok, status, json } = await this.request<unknown>('GET', `${API_VERSION_PATH}/code_reviews/${uuid}`);
    if (!ok) {
      throw this.formatError(status, json);
    }
    const root = json as Record<string, unknown>;
    const data = (root.data as Record<string, unknown> | undefined) ?? root;
    const review = (data.review as CodeReviewPayload | undefined) ?? (root as unknown as CodeReviewPayload);
    if (!review?.uuid) {
      throw new Error('Get review: invalid response');
    }
    return review;
  }

  async putFindingState(
    uuid: string,
    body: { item_kind: 'issue' | 'suggestion'; item_index: number; state: 'dismissed' | 'done' }
  ): Promise<FindingsUi> {
    const { ok, status, json } = await this.request<unknown>(
      'PUT',
      `${API_VERSION_PATH}/code_reviews/${uuid}/finding_state`,
      body
    );
    if (!ok) {
      throw this.formatError(status, json);
    }
    const root = json as Record<string, unknown>;
    const data = (root.data as Record<string, unknown> | undefined) ?? root;
    const findings_ui = data.findings_ui as FindingsUi | undefined;
    if (!findings_ui) {
      throw new Error('Finding state: missing findings_ui');
    }
    return findings_ui;
  }

  async deleteFindingState(
    uuid: string,
    body: { item_kind: 'issue' | 'suggestion'; item_index: number }
  ): Promise<FindingsUi> {
    const { ok, status, json } = await this.request<unknown>(
      'DELETE',
      `${API_VERSION_PATH}/code_reviews/${uuid}/finding_state`,
      body
    );
    if (!ok) {
      throw this.formatError(status, json);
    }
    const root = json as Record<string, unknown>;
    const data = (root.data as Record<string, unknown> | undefined) ?? root;
    const findings_ui = data.findings_ui as FindingsUi | undefined;
    if (!findings_ui) {
      throw new Error('Finding state: missing findings_ui');
    }
    return findings_ui;
  }

  private formatError(status: number, json: unknown): Error {
    let msg = extractApiErrorText(json, status);
    if (status === 401 && /^unauthorized\.?$/i.test(msg.trim())) {
      msg =
        'Unauthorized. Run CodeCritic: Set API key and paste the key from Dashboard - Settings - API key (regenerate if you rotated it).';
    }
    const err = new Error(msg) as Error & { status?: number; body?: unknown };
    err.status = status;
    err.body = json;
    return err;
  }
}
