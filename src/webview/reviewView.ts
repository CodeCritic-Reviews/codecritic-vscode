/* Webview bundle: acquireVsCodeApi is injected by VS Code. */
declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
};

import type { CodeReviewPayload, FindingsUi, ReviewIssue, TrustFocusResult } from '../api/types';

const vscode = acquireVsCodeApi();

let lastReview: CodeReviewPayload | null = null;
let reviewUuid = '';
let dashboardUrl = 'https://code-critic.com';
let logoUrl = '';

function siteReviewUrl(uuid: string): string {
  return `${dashboardUrl.replace(/\/+$/, '')}/reviews/${uuid}`;
}

function resolveLogoUrl(): string {
  if (logoUrl) return logoUrl;
  return document.getElementById('app')?.getAttribute('data-logo') || '';
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text !== undefined) n.textContent = text;
  return n;
}

function severityClass(sev?: string): string {
  const s = (sev || '').toLowerCase();
  if (s === 'high') return 'sev-high';
  if (s === 'medium') return 'sev-medium';
  return 'sev-low';
}

function severityPillClass(sev?: string): string {
  const s = (sev || '').toLowerCase();
  if (s === 'high') return 'high';
  if (s === 'medium') return 'medium';
  return 'low';
}

function scoreTone(score: number): string {
  if (score < 50) return 'low';
  if (score < 75) return 'mid';
  return '';
}

function statusPillClass(status: string): string {
  if (status === 'completed') return 'ok';
  if (status === 'failed' || status === 'cancelled') return 'bad';
  return '';
}

function renderTrust(tf: TrustFocusResult): HTMLElement {
  const wrap = el('div', 'trust-panel');
  if (tf.status === 'failed') {
    wrap.appendChild(el('h2', '', 'Trust focus'));
    wrap.appendChild(
      el('p', 'muted', tf.error ? `Pass failed: ${tf.error}` : 'Trust focus pass did not complete.')
    );
    return wrap;
  }
  const level = (tf.trust_risk_level || 'medium').toLowerCase();
  const lvlClass = level === 'high' ? 'tf-high' : level === 'low' ? 'tf-low' : 'tf-medium';
  wrap.appendChild(el('h2', '', 'Trust focus'));
  wrap.appendChild(el('span', `trust-level ${lvlClass}`, `${level} risk`));
  if (tf.risk_rationale) {
    wrap.appendChild(el('p', 'summary-text', tf.risk_rationale));
  }
  const addList = (title: string, items?: string[]) => {
    if (!items?.length) return;
    wrap.appendChild(el('h3', '', title));
    const ul = el('ul', 'tf-list');
    for (const x of items) {
      ul.appendChild(el('li', '', x));
    }
    wrap.appendChild(ul);
  };
  addList('What green CI can miss', tf.what_green_ci_can_miss);
  addList('Verification ladder', tf.verification_ladder);
  addList('Blind spots', tf.blind_spots);
  if (tf.signals_from_tooling) {
    wrap.appendChild(el('h3', '', 'Technical signals'));
    wrap.appendChild(el('pre', 'sig', JSON.stringify(tf.signals_from_tooling, null, 2)));
  }
  return wrap;
}

function renderIssue(
  issue: ReviewIssue,
  index: number,
  ui: FindingsUi | null,
  kind: 'issue' | 'suggestion',
  reviewTitle: string
): HTMLElement {
  const metaRow = kind === 'issue' ? ui?.issues?.[index] : ui?.suggestions?.[index];
  const vis = metaRow?.visibility ?? 'visible';
  const userState = metaRow?.user_state ?? null;
  const row = el(
    'div',
    `issue ${severityClass(issue.severity)}${vis !== 'visible' ? ' collapsed' : ''}${userState === 'done' ? ' done' : ''}`
  );

  const top = el('div', 'issue-top');
  if (kind === 'issue') {
    top.appendChild(el('span', `sev-pill ${severityPillClass(issue.severity)}`, issue.severity || 'note'));
  } else {
    top.appendChild(el('span', 'kind-pill', 'Suggestion'));
  }
  if (userState === 'done') {
    top.appendChild(el('span', 'state-pill done', 'Done'));
  } else if (userState === 'dismissed') {
    top.appendChild(el('span', 'state-pill dismissed', 'Dismissed'));
  }
  row.appendChild(top);

  row.appendChild(el('p', 'issue-msg', issue.message));

  if (vis !== 'visible') {
    if (metaRow?.collapse_reason) {
      row.appendChild(el('div', 'muted', metaRow.collapse_reason));
    }
    const undo = el('button', 'secondary', userState === 'done' ? 'Undo done' : 'Undo dismiss');
    undo.addEventListener('click', () => {
      vscode.postMessage({ type: 'clearFinding', uuid: reviewUuid, item_kind: kind, item_index: index });
    });
    const actions = el('div', 'issue-meta');
    actions.appendChild(undo);
    row.appendChild(actions);
    return row;
  }

  const meta = el('div', 'issue-meta');
  if (issue.line != null) {
    const go = el('a', 'link', `Line ${issue.line}`);
    go.addEventListener('click', (e: MouseEvent) => {
      e.preventDefault();
      vscode.postMessage({ type: 'goToBlobLine', uuid: reviewUuid, line: issue.line });
    });
    meta.appendChild(go);
  }
  if (issue.path) {
    meta.appendChild(el('span', 'muted', issue.path));
  }
  if (meta.childNodes.length) {
    row.appendChild(meta);
  }

  if (issue.suggestion_code) {
    row.appendChild(el('pre', 'sig', issue.suggestion_code));
  }

  const actions = el('div', 'issue-meta');
  if (userState) {
    const undo = el('button', 'secondary', userState === 'done' ? 'Undo done' : 'Undo dismiss');
    undo.addEventListener('click', () => {
      vscode.postMessage({ type: 'clearFinding', uuid: reviewUuid, item_kind: kind, item_index: index });
    });
    actions.appendChild(undo);
  } else {
    const done = el('button', 'secondary done-btn', 'Mark as done');
    done.addEventListener('click', () => {
      vscode.postMessage({
        type: 'setFinding',
        uuid: reviewUuid,
        item_kind: kind,
        item_index: index,
        state: 'done',
      });
    });
    const dismiss = el('button', 'secondary', 'Dismiss');
    dismiss.addEventListener('click', () => {
      vscode.postMessage({
        type: 'setFinding',
        uuid: reviewUuid,
        item_kind: kind,
        item_index: index,
        state: 'dismissed',
      });
    });
    actions.appendChild(done);
    actions.appendChild(dismiss);
  }

  const chat = el('button', 'primary', 'Fix in Chat');
  chat.title =
    'Open Chat or Agent with a ready-made prompt (VS Code Copilot, Cursor, etc.). The file is opened when line mapping is available.';
  chat.addEventListener('click', () =>
    vscode.postMessage({
      type: 'sendToAgent',
      uuid: reviewUuid,
      review_title: reviewTitle,
      item_kind: kind,
      item_index: index,
      message: issue.message,
      path: issue.path,
      line: issue.line,
      suggestion: issue.suggestion,
      suggestion_code: issue.suggestion_code,
    })
  );
  actions.appendChild(chat);
  row.appendChild(actions);

  return row;
}

function renderSuggestion(text: string, index: number, ui: FindingsUi | null, reviewTitle: string): HTMLElement {
  const issue: ReviewIssue = { message: text };
  return renderIssue(issue, index, ui, 'suggestion', reviewTitle);
}

function renderBulletSection(title: string, items: string[], variant: 'strengths' | 'improvements'): HTMLElement {
  const section = el('section', 'section');
  const head = el('div', 'section-head');
  head.appendChild(el('h2', 'section-title', title));
  section.appendChild(head);
  const card = el('div', `bullet-card ${variant}`);
  const ul = el('ul');
  for (const s of items) ul.appendChild(el('li', '', s));
  card.appendChild(ul);
  section.appendChild(card);
  return section;
}

function render(review: CodeReviewPayload): void {
  const app = document.getElementById('app');
  if (!app) return;
  app.innerHTML = '';
  lastReview = review;
  reviewUuid = review.uuid;

  const hero = el('header', 'hero');
  hero.appendChild(el('div', 'hero-glow'));

  const brandRow = el('div', 'brand-row');
  const chip = el('div', 'brand-chip');
  const logo = resolveLogoUrl();
  if (logo) {
    const img = el('img', 'brand-logo');
    img.src = logo;
    img.alt = '';
    chip.appendChild(img);
  } else {
    chip.appendChild(el('span', 'brand-dot'));
  }
  chip.appendChild(document.createTextNode('CodeCritic'));
  brandRow.appendChild(chip);
  brandRow.appendChild(el('span', `status-pill ${statusPillClass(review.status)}`, review.status.replace(/_/g, ' ')));
  hero.appendChild(brandRow);

  hero.appendChild(el('h1', 'hero-title', review.title || 'Code review'));
  hero.appendChild(el('p', 'hero-sub', review.uuid));

  const actions = el('div', 'hero-actions');
  const openSite = el('button', 'secondary', 'Open on site');
  openSite.title = 'Open this review in the CodeCritic web app';
  openSite.addEventListener('click', () => {
    vscode.postMessage({ type: 'openExternal', url: siteReviewUrl(review.uuid) });
  });
  actions.appendChild(openSite);

  if (review.status === 'failed') {
    hero.appendChild(actions);
    app.appendChild(hero);
    const err = (review.review_result as { error?: string } | null)?.error || 'Review failed';
    app.appendChild(el('div', 'error-banner', err));
    return;
  }

  if (review.status !== 'completed' || !review.review_result) {
    hero.appendChild(actions);
    app.appendChild(hero);
    app.appendChild(el('div', 'empty-state', 'No result yet - wait for the review to finish.'));
    return;
  }

  const res = review.review_result;
  const findingsUi = review.findings_ui ?? null;
  const score = res.score ?? 0;

  const copyAll = el('button', 'primary', 'Copy all to Agent');
  copyAll.title = 'Send the full review (summary + issues + suggestions) to Chat / Agent, or copy to clipboard';
  copyAll.addEventListener('click', () => {
    const issues = (res.issues || []).map((iss) => ({
      message: iss.message,
      severity: iss.severity,
      path: iss.path,
      line: iss.line,
      suggestion: iss.suggestion,
      suggestion_code: iss.suggestion_code,
    }));
    const suggestions = (res.suggestions || []).map((s) =>
      typeof s === 'string' ? s : s.message || s.text || JSON.stringify(s)
    );
    vscode.postMessage({
      type: 'copyAllToAgent',
      uuid: review.uuid,
      review_title: review.title || '',
      site_url: siteReviewUrl(review.uuid),
      score,
      summary: res.ai_analysis?.summary || '',
      strengths: res.ai_analysis?.strengths || [],
      improvements: res.ai_analysis?.improvements || [],
      issues,
      suggestions,
    });
  });
  actions.appendChild(copyAll);
  hero.appendChild(actions);

  const scoreBlock = el('div', 'score-block');
  const ring = el('div', `score-ring ${scoreTone(score)}`, String(score));
  scoreBlock.appendChild(ring);
  const scoreCopy = el('div');
  scoreCopy.appendChild(el('p', 'score-label', 'Quality score'));
  const summary = res.ai_analysis?.summary;
  scoreCopy.appendChild(el('p', 'summary-text', summary || 'Review complete.'));
  scoreBlock.appendChild(scoreCopy);
  hero.appendChild(scoreBlock);
  app.appendChild(hero);

  if (res.ai_analysis?.strengths?.length) {
    app.appendChild(renderBulletSection('Strengths', res.ai_analysis.strengths, 'strengths'));
  }
  if (res.ai_analysis?.improvements?.length) {
    app.appendChild(renderBulletSection('Improvements', res.ai_analysis.improvements, 'improvements'));
  }

  const reviewTitle = review.title || '';

  const issues = res.issues || [];
  if (issues.length) {
    const section = el('section', 'section');
    const head = el('div', 'section-head');
    head.appendChild(el('h2', 'section-title', 'Issues'));
    head.appendChild(el('span', 'section-count', `${issues.length}`));
    section.appendChild(head);
    const list = el('div', 'card-list');
    issues.forEach((iss, i) => list.appendChild(renderIssue(iss, i, findingsUi, 'issue', reviewTitle)));
    section.appendChild(list);
    app.appendChild(section);
  }

  const sugg = res.suggestions || [];
  if (sugg.length) {
    const section = el('section', 'section');
    const head = el('div', 'section-head');
    head.appendChild(el('h2', 'section-title', 'Suggestions'));
    head.appendChild(el('span', 'section-count', `${sugg.length}`));
    section.appendChild(head);
    const list = el('div', 'card-list');
    sugg.forEach((s, i) => {
      const text = typeof s === 'string' ? s : s.message || s.text || JSON.stringify(s);
      list.appendChild(renderSuggestion(text, i, findingsUi, reviewTitle));
    });
    section.appendChild(list);
    app.appendChild(section);
  }

  if (res.trust_focus) {
    app.appendChild(renderTrust(res.trust_focus));
  }
}

type BootPayload =
  | { review?: CodeReviewPayload; dashboardUrl?: string; logoUrl?: string }
  | CodeReviewPayload;

function readEmbeddedBoot(): {
  review: CodeReviewPayload | null;
  dashboardUrl?: string;
  logoUrl?: string;
} {
  const node = document.getElementById('cc-initial-review');
  if (!node?.textContent?.trim()) return { review: null };
  try {
    const parsed = JSON.parse(node.textContent) as BootPayload;
    if (parsed && typeof parsed === 'object' && 'review' in parsed && parsed.review) {
      return {
        review: parsed.review,
        dashboardUrl: typeof parsed.dashboardUrl === 'string' ? parsed.dashboardUrl : undefined,
        logoUrl: typeof parsed.logoUrl === 'string' ? parsed.logoUrl : undefined,
      };
    }
    // Legacy: bare review object
    if (parsed && typeof parsed === 'object' && 'uuid' in parsed && 'status' in parsed) {
      return { review: parsed as CodeReviewPayload };
    }
  } catch {
    /* ignore */
  }
  return { review: null };
}

function boot(): void {
  const embedded = readEmbeddedBoot();
  if (embedded.dashboardUrl) {
    dashboardUrl = embedded.dashboardUrl;
  }
  if (embedded.logoUrl) {
    logoUrl = embedded.logoUrl;
  }
  if (embedded.review) {
    render(embedded.review);
  }
  vscode.postMessage({ type: 'ready' });
}

window.addEventListener('message', (event: MessageEvent) => {
  const msg = event.data as {
    type?: string;
    review?: CodeReviewPayload;
    findings_ui?: FindingsUi;
    dashboardUrl?: string;
    logoUrl?: string;
  };
  if (typeof msg.dashboardUrl === 'string' && msg.dashboardUrl) {
    dashboardUrl = msg.dashboardUrl;
  }
  if (typeof msg.logoUrl === 'string' && msg.logoUrl) {
    logoUrl = msg.logoUrl;
  }
  if (msg.type === 'bootstrap' && msg.review) {
    render(msg.review);
  }
  if (msg.type === 'updateFindings' && msg.findings_ui && lastReview) {
    lastReview = { ...lastReview, findings_ui: msg.findings_ui };
    render(lastReview);
  }
});

boot();
