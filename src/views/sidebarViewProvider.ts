import * as vscode from 'vscode';
import { getLocaleName, getWebviewMessages, translate } from '../localization';
import { TodoSyncService } from '../services/todoSyncService';

export class SidebarViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  public static readonly viewType = 'sharedTodoTasks.overviewView';

  private readonly disposables: vscode.Disposable[] = [];
  private view?: vscode.WebviewView;

  public constructor(private readonly syncService: TodoSyncService) {
    this.disposables.push(
      this.syncService.onDidChangeTodos(() => this.postState()),
      this.syncService.onDidChangeStatus(() => this.postState()),
      this.syncService.onDidChangeBucket(() => this.postState()),
    );
  }

  public resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = this.getHtml(webviewView.webview);
    webviewView.webview.onDidReceiveMessage((message) => {
      void this.handleMessage(message);
    });
    this.postState();
  }

  public dispose(): void {
    vscode.Disposable.from(...this.disposables).dispose();
  }

  private async handleMessage(message: { type?: string }): Promise<void> {
    if (message.type === 'ready') {
      this.postState();
      return;
    }

    if (message.type === 'configureFirebase') {
      await vscode.commands.executeCommand('sharedTodoTasks.configureFirebase');
      return;
    }

    if (message.type === 'openProjects') {
      await vscode.commands.executeCommand('sharedTodoTasks.openProjects');
      return;
    }

    if (message.type === 'openSettings') {
      await vscode.commands.executeCommand('sharedTodoTasks.openSettings');
    }
  }

  private postState(): void {
    const config = this.syncService.getConfig();
    const activity = this.syncService.getLastActivity();

    this.postMessage({
      type: 'hydrate',
      payload: {
        status: this.syncService.getStatus(),
        currentBucket: this.syncService.getCurrentBucket(),
        hasFirebase: this.syncService.hasDatabaseUrl(),
        todoCount: this.syncService.getTodos().length,
        lastActivity: activity
          ? {
            ...activity,
            formattedTime: new Date(activity.timestamp).toLocaleString(getLocaleName(config.language), {
              dateStyle: 'short',
              timeStyle: 'short',
            }),
          }
          : undefined,
        messages: getWebviewMessages(config.language),
      },
    });
  }

  private postMessage(message: unknown): void {
    void this.view?.webview.postMessage(message);
  }

  private getHtml(_webview: vscode.Webview): string {
    const nonce = createNonce();

    return `<!DOCTYPE html>
<html lang="${this.syncService.getConfig().language}">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 12px 14px;
      font-family: var(--vscode-font-family);
      color: var(--vscode-foreground);
      background: transparent;
    }
    .empty {
      min-height: 220px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 14px;
      text-align: center;
    }
    .empty-title {
      font-weight: 700;
      font-size: 13px;
    }
    .empty-body {
      max-width: 280px;
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
      line-height: 1.45;
    }
    .primary-button,
    .secondary-button {
      width: min(220px, 100%);
      min-height: 34px;
      border-radius: 4px;
      border: 1px solid var(--vscode-button-border, transparent);
      font: inherit;
      cursor: pointer;
    }
    .primary-button {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }
    .primary-button:hover {
      background: var(--vscode-button-hoverBackground);
    }
    .secondary-button {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
    .secondary-button:hover {
      background: var(--vscode-button-secondaryHoverBackground);
    }
    .summary {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .row {
      display: grid;
      grid-template-columns: 92px 1fr;
      gap: 8px;
      align-items: baseline;
      min-width: 0;
      font-size: 12px;
    }
    .label {
      color: var(--vscode-descriptionForeground);
    }
    .value {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-weight: 600;
    }
    .actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      margin-top: 8px;
    }
    .actions button {
      width: auto;
      padding: 0 10px;
    }
  </style>
  <title>Shared Todo Tasks Overview</title>
</head>
<body>
  <div id="app"></div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const state = {
      status: { state: 'idle', message: 'Ready' },
      currentBucket: '',
      hasFirebase: false,
      todoCount: 0,
      lastActivity: undefined,
      messages: {},
    };

    const fallback = {
      'sidebar.configureFirebase': 'Configure Firebase',
      'sidebar.firebaseMissing': 'Firebase is not connected',
      'sidebar.firebaseSetupStartDescription': 'Paste URL and test connection',
      'sidebar.lastActivity': 'Last activity',
      'sidebar.noActivity': 'No activity yet',
      'sidebar.projects': 'Projects',
      'sidebar.status': 'Status',
      'webview.firebaseIntroBody': 'Shared Todo Tasks needs a Realtime Database URL to sync todos. If you already have one, continue configuration.',
      'webview.firebaseIntroTitle': 'Firebase is not connected',
      'webview.openProjects': 'Open Projects',
      'webview.openSettings': 'Open Settings',
    };

    const app = document.getElementById('app');

    window.addEventListener('message', (event) => {
      if (event.data?.type !== 'hydrate') {
        return;
      }

      Object.assign(state, event.data.payload ?? {});
      render();
    });

    function render() {
      if (!state.hasFirebase) {
        app.innerHTML = '<section class="empty">' +
          '<div class="empty-title">' + escapeHtml(t('webview.firebaseIntroTitle')) + '</div>' +
          '<div class="empty-body">' + escapeHtml(t('webview.firebaseIntroBody')) + '</div>' +
          '<button class="primary-button" data-action="configureFirebase">' + escapeHtml(t('sidebar.configureFirebase')) + '</button>' +
          '</section>';
        bind();
        return;
      }

      app.innerHTML = '<section class="summary">' +
        renderRow(t('sidebar.projects'), state.currentBucket || '-') +
        renderRow(t('sidebar.status'), state.status?.message || '-') +
        renderRow('Todos', String(state.todoCount || 0)) +
        renderRow(t('sidebar.lastActivity'), state.lastActivity ? state.lastActivity.deviceName + ' - ' + state.lastActivity.formattedTime : t('sidebar.noActivity')) +
        renderActions() +
        '</section>';
      bind();
    }

    function renderActions() {
      if (state.currentBucket) {
        return '';
      }

      return '<div class="actions">' +
        '<button class="secondary-button" data-action="openProjects">' + escapeHtml(t('webview.openProjects')) + '</button>' +
        '</div>';
    }

    function renderRow(label, value) {
      return '<div class="row"><div class="label">' + escapeHtml(label) + '</div><div class="value" title="' + escapeHtml(value) + '">' + escapeHtml(value) + '</div></div>';
    }

    function bind() {
      document.querySelectorAll('[data-action]').forEach((button) => {
        button.addEventListener('click', () => {
          vscode.postMessage({ type: button.dataset.action });
        });
      });
    }

    function t(key) {
      return state.messages[key] || fallback[key] || key;
    }

    function escapeHtml(value) {
      return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
    }

    render();
    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
  }
}

function createNonce(): string {
  return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
}
