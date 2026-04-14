import type { ApiErrorBody, CodeReviewPayload, FindingsUi } from './types';

function joinUrl(base: string, path: string): string {
  const b = base.replace(/\/+$/, '');
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${b}${p}`;
}

export class CodeCriticClient {
  constructor(
    private readonly baseUrl: string,
    private readonly getApiKey: () => Promise<string | undefined>
  ) {}

  private async headers(): Promise<HeadersInit> {
    const key = await this.getApiKey();
    if (!key?.trim()) {
      throw new Error('No API key. Run “CodeCritic: Set API key”.');
    }
    return {
      Authorization: `Bearer ${key.trim()}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
  }

  private async parseJson(res: Response): Promise<unknown> {
    const text = await res.text();
    if (!text) return {};
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new Error(`Invalid JSON (${res.status}): ${text.slice(0, 200)}`);
    }
  }

  private async request<T>(
    method: string,
    apiPath: string,
    body?: unknown
  ): Promise<{ ok: boolean; status: number; json: T }> {
    const url = joinUrl(this.baseUrl, apiPath);
    const init: RequestInit = {
      method,
      headers: await this.headers(),
    };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }
    const res = await fetch(url, init);
    const json = (await this.parseJson(res)) as T;
    return { ok: res.ok, status: res.status, json };
  }

  async createReview(payload: {
    code: string;
    language: string;
    title?: string;
    description?: string;
  }): Promise<{ uuid: string }> {
    const { ok, status, json } = await this.request<unknown>('POST', '/api/v1/code_reviews', payload);
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
    const { ok, status, json } = await this.request<unknown>('GET', `/api/v1/code_reviews/${uuid}`);
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
      `/api/v1/code_reviews/${uuid}/finding_state`,
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
      `/api/v1/code_reviews/${uuid}/finding_state`,
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
    const b = json as ApiErrorBody & Record<string, unknown>;
    const msg =
      (typeof b.message === 'string' && b.message) ||
      (typeof b.error === 'string' && b.error) ||
      (typeof b.reason === 'string' && b.reason) ||
      `HTTP ${status}`;
    const err = new Error(msg) as Error & { status?: number; body?: unknown };
    err.status = status;
    err.body = json;
    return err;
  }
}
