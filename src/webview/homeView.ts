/* Webview bundle: acquireVsCodeApi is injected by VS Code. */
declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
};

const vscode = acquireVsCodeApi();

type BootState = {
  hasApiKey: boolean;
  recent: string[];
  dashboardUrl: string;
};

let state: BootState = {
  hasApiKey: false,
  recent: [],
  dashboardUrl: 'https://code-critic.com',
};

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

function shortUuid(uuid: string): string {
  return uuid.length > 12 ? `${uuid.slice(0, 8)}…` : uuid;
}

function logoSrc(): string {
  const app = document.getElementById('app');
  return app?.getAttribute('data-logo') || '';
}

function actionButton(label: string, type: string, primary = false): HTMLButtonElement {
  const btn = el('button', primary ? 'btn primary' : 'btn', label);
  btn.type = 'button';
  btn.addEventListener('click', () => vscode.postMessage({ type }));
  return btn;
}

function render(): void {
  const app = document.getElementById('app');
  if (!app) return;
  app.innerHTML = '';

  const header = el('header', 'header');
  const brand = el('div', 'brand');
  const img = el('img', 'logo');
  img.src = logoSrc();
  img.alt = 'CodeCritic';
  brand.appendChild(img);
  const titles = el('div', 'brand-text');
  titles.appendChild(el('h1', '', 'CodeCritic'));
  titles.appendChild(el('p', 'tagline', 'Second opinion for AI-written code'));
  brand.appendChild(titles);
  header.appendChild(brand);
  app.appendChild(header);

  const status = el('div', `status ${state.hasApiKey ? 'ok' : 'warn'}`);
  status.appendChild(
    el('span', '', state.hasApiKey ? 'API key ready' : 'API key not set - add it to run reviews')
  );
  app.appendChild(status);

  if (!state.hasApiKey) {
    const setup = el('section', 'card');
    setup.appendChild(el('p', 'muted', 'Paste your key from Dashboard → Settings → API key.'));
    const row = el('div', 'btn-col');
    row.appendChild(actionButton('Set API key', 'setApiKey', true));
    row.appendChild(actionButton('Open Dashboard', 'openDashboard'));
    setup.appendChild(row);
    app.appendChild(setup);
  }

  const actions = el('section', 'card');
  actions.appendChild(el('h2', '', 'Review'));
  const col = el('div', 'btn-col');
  col.appendChild(actionButton('Review selection', 'reviewSelection', true));
  col.appendChild(actionButton('Review active file', 'reviewActiveFile'));
  col.appendChild(actionButton('Review files…', 'reviewFiles'));
  col.appendChild(actionButton('Review folder…', 'reviewFolder'));
  actions.appendChild(col);
  app.appendChild(actions);

  const recent = el('section', 'card');
  const head = el('div', 'section-head');
  head.appendChild(el('h2', '', 'Recent'));
  const refresh = el('button', 'linkish', 'Refresh');
  refresh.type = 'button';
  refresh.addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));
  head.appendChild(refresh);
  recent.appendChild(head);

  if (!state.recent.length) {
    recent.appendChild(el('p', 'muted', 'No reviews in this workspace yet.'));
  } else {
    const list = el('ul', 'recent-list');
    for (const uuid of state.recent) {
      const li = el('li');
      const open = el('button', 'recent-item');
      open.type = 'button';
      open.title = uuid;
      open.appendChild(el('span', 'recent-id', shortUuid(uuid)));
      open.appendChild(el('span', 'recent-hint', 'Open'));
      open.addEventListener('click', () => vscode.postMessage({ type: 'openRecent', uuid }));
      li.appendChild(open);
      list.appendChild(li);
    }
    recent.appendChild(list);
    const last = el('div', 'btn-col');
    last.appendChild(actionButton('Open last result', 'openLastResult'));
    recent.appendChild(last);
  }
  app.appendChild(recent);

  const footer = el('section', 'card quiet');
  footer.appendChild(el('h2', '', 'Account'));
  const foot = el('div', 'btn-col');
  foot.appendChild(actionButton(state.hasApiKey ? 'Change API key' : 'Set API key', 'setApiKey'));
  foot.appendChild(actionButton('Open Dashboard', 'openDashboard'));
  const site = el('button', 'btn', 'code-critic.com');
  site.type = 'button';
  site.addEventListener('click', () =>
    vscode.postMessage({ type: 'openExternal', url: state.dashboardUrl })
  );
  foot.appendChild(site);
  footer.appendChild(foot);
  app.appendChild(footer);
}

window.addEventListener('message', (event: MessageEvent) => {
  const msg = event.data as Partial<BootState> & { type?: string };
  if (msg.type !== 'bootstrap') return;
  state = {
    hasApiKey: Boolean(msg.hasApiKey),
    recent: Array.isArray(msg.recent) ? msg.recent.filter((u): u is string => typeof u === 'string') : [],
    dashboardUrl:
      typeof msg.dashboardUrl === 'string' && msg.dashboardUrl ? msg.dashboardUrl : state.dashboardUrl,
  };
  render();
});

vscode.postMessage({ type: 'ready' });
