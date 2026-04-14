/* Webview bundle: acquireVsCodeApi is injected by VS Code. */
declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
};

import type { CodeReviewPayload, FindingsUi, ReviewIssue, TrustFocusResult } from '../api/types';

const vscode = acquireVsCodeApi();

let lastReview: CodeReviewPayload | null = null;
let reviewUuid = '';

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
  const lvl = el('span', `trust-level ${lvlClass}`, `${level} risk`);
  wrap.appendChild(el('h2', '', 'Trust focus'));
  wrap.appendChild(lvl);
  if (tf.risk_rationale) {
    wrap.appendChild(el('p', '', tf.risk_rationale));
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
  kind: 'issue' | 'suggestion'
): HTMLElement {
  const metaRow =
    kind === 'issue' ? ui?.issues?.[index] : ui?.suggestions?.[index];
  const vis = metaRow?.visibility ?? 'visible';
  const row = el('div', `issue ${severityClass(issue.severity)}${vis !== 'visible' ? ' collapsed' : ''}`);

  row.appendChild(el('div', '', issue.message));

  if (vis !== 'visible' && metaRow?.collapse_reason) {
    row.appendChild(el('div', 'muted', metaRow.collapse_reason));
    const undo = el('button', 'secondary', 'Undo dismiss');
    undo.addEventListener('click', () => {
      vscode.postMessage({ type: 'clearFinding', uuid: reviewUuid, item_kind: kind, item_index: index });
    });
    row.appendChild(undo);
    return row;
  }

  const meta = el('div', 'issue-meta');
  if (issue.line != null) {
    const go = el('a', 'link', `Line ${issue.line}`);
    go.addEventListener('click', (e) => {
      e.preventDefault();
      vscode.postMessage({ type: 'goToBlobLine', uuid: reviewUuid, line: issue.line });
    });
    meta.appendChild(go);
  }
  if (issue.path) {
    meta.appendChild(el('span', 'muted', issue.path));
  }
  row.appendChild(meta);

  if (issue.suggestion_code) {
    row.appendChild(el('pre', 'sig', issue.suggestion_code));
  }

  const actions = el('div', 'issue-meta');
  if (kind === 'issue') {
    const d = el('button', '', 'Dismiss');
    d.addEventListener('click', () =>
      vscode.postMessage({
        type: 'setFinding',
        uuid: reviewUuid,
        item_kind: 'issue',
        item_index: index,
        state: 'dismissed',
      })
    );
    actions.appendChild(d);
  }
  const done = el('button', 'secondary', 'Done');
  done.addEventListener('click', () =>
    vscode.postMessage({
      type: 'setFinding',
      uuid: reviewUuid,
      item_kind: kind,
      item_index: index,
      state: 'done',
    })
  );
  actions.appendChild(done);
  row.appendChild(actions);

  return row;
}

function renderSuggestion(text: string, index: number, ui: FindingsUi | null): HTMLElement {
  const issue: ReviewIssue = { message: text };
  return renderIssue(issue, index, ui, 'suggestion');
}

function render(review: CodeReviewPayload): void {
  const app = document.getElementById('app');
  if (!app) return;
  app.innerHTML = '';
  lastReview = review;
  reviewUuid = review.uuid;

  app.appendChild(el('h1', '', review.title || 'Code review'));
  app.appendChild(el('p', 'muted', `Status: ${review.status} · ${review.uuid}`));

  if (review.status === 'failed') {
    const err = (review.review_result as { error?: string } | null)?.error || 'Review failed';
    app.appendChild(el('div', 'error-banner', err));
    return;
  }

  if (review.status !== 'completed' || !review.review_result) {
    app.appendChild(el('p', 'muted', 'No result yet.'));
    return;
  }

  const res = review.review_result;
  const findingsUi = review.findings_ui ?? null;

  const scoreRow = el('div', 'score-row');
  scoreRow.appendChild(el('div', 'score-badge', String(res.score ?? 0)));
  const summary = res.ai_analysis?.summary;
  if (summary) {
    scoreRow.appendChild(el('div', '', summary));
  }
  app.appendChild(scoreRow);

  if (res.ai_analysis?.strengths?.length) {
    app.appendChild(el('h2', '', 'Strengths'));
    const ul = el('ul', 'tf-list');
    for (const s of res.ai_analysis.strengths) ul.appendChild(el('li', '', s));
    app.appendChild(ul);
  }
  if (res.ai_analysis?.improvements?.length) {
    app.appendChild(el('h2', '', 'Improvements'));
    const ul = el('ul', 'tf-list');
    for (const s of res.ai_analysis.improvements) ul.appendChild(el('li', '', s));
    app.appendChild(ul);
  }

  const issues = res.issues || [];
  if (issues.length) {
    app.appendChild(el('h2', '', `Issues (${issues.length})`));
    issues.forEach((iss, i) => app.appendChild(renderIssue(iss, i, findingsUi, 'issue')));
  }

  const sugg = res.suggestions || [];
  if (sugg.length) {
    app.appendChild(el('h2', '', `Suggestions (${sugg.length})`));
    sugg.forEach((s, i) => {
      const text = typeof s === 'string' ? s : s.message || s.text || JSON.stringify(s);
      app.appendChild(renderSuggestion(text, i, findingsUi));
    });
  }

  if (res.trust_focus) {
    app.appendChild(renderTrust(res.trust_focus));
  }
}

window.addEventListener('message', (event) => {
  const msg = event.data as { type?: string; review?: CodeReviewPayload; findings_ui?: FindingsUi };
  if (msg.type === 'bootstrap' && msg.review) {
    render(msg.review);
  }
  if (msg.type === 'updateFindings' && msg.findings_ui && lastReview) {
    lastReview = { ...lastReview, findings_ui: msg.findings_ui };
    render(lastReview);
  }
});
