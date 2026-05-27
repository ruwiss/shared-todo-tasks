import * as vscode from 'vscode';
import { FIREBASE_RULES_TEMPLATE } from '../constants';
import { getLocaleName, getWebviewMessages, translate } from '../localization';
import { TodoSyncService } from '../services/todoSyncService';

export class TodoListViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  public static readonly viewType = 'sharedTodoTasks.todoView';

  private readonly disposables: vscode.Disposable[] = [];
  private view?: vscode.WebviewView;

  public constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly syncService: TodoSyncService,
  ) {
    this.disposables.push(
      this.syncService.onDidChangeTodos(() => this.postState()),
      this.syncService.onDidChangeStatus(() => this.postState()),
      this.syncService.onDidChangeBucket(() => this.postState()),
    );
  }

  public resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')],
    };

    webviewView.webview.html = this.getHtml(webviewView.webview);
    webviewView.webview.onDidReceiveMessage((message) => {
      void this.handleMessage(message);
    });

    this.postState();
  }

  public dispose(): void {
    vscode.Disposable.from(...this.disposables).dispose();
  }

  private async handleMessage(message: { type?: string; payload?: any }): Promise<void> {
    if (message.type === 'ready') {
      this.postState();
      return;
    }

    if (message.type === 'toggleTodo') {
      await this.run(() => this.syncService.toggleTodo(message.payload.id, !!message.payload.completed));
      return;
    }

    if (message.type === 'createTodo') {
      await this.run(async () => {
        const images: string[] = [];

        if (message.payload?.images) {
          for (const img of message.payload.images) {
            if (img.url) {
              images.push(img.url);
            } else if (img.dataUrl) {
              const url = await this.syncService.uploadTodoImage(img.dataUrl);
              images.push(url);
            }
          }
        }

        const imageUrl = images.join(',');

        if (message.payload?.id) {
          await this.syncService.updateTodo(message.payload.id, {
            text: message.payload?.text ?? '',
            imageUrl,
          });
        } else {
          await this.syncService.addTodo(message.payload?.text ?? '', imageUrl);
        }
      });
      return;
    }

    if (message.type === 'setTodoInProgress') {
      await this.run(() => this.syncService.setTodoInProgress(message.payload.id, !!message.payload.inProgress));
      return;
    }

    if (message.type === 'deleteTodo') {
      const todo = this.syncService.getTodos().find((item) => item.id === message.payload?.id);
      const answer = await vscode.window.showWarningMessage(
        todo
          ? this.t('command.delete.prompt', { todo: todo.text })
          : this.t('command.delete.promptFallback'),
        { modal: true },
        this.t('command.delete.confirm'),
      );

      if (answer !== this.t('command.delete.confirm')) {
        this.postState();
        return;
      }

      await this.run(() => this.syncService.deleteTodo(message.payload.id));
      return;
    }

    if (message.type === 'editTodo') {
      const todo = this.syncService.getTodos().find((item) => item.id === message.payload?.id);

      if (!todo) {
        return;
      }

      this.postMessage({
        type: 'editTodo',
        payload: { todo },
      });
      return;
    }

    if (message.type === 'openProjects') {
      await vscode.commands.executeCommand('sharedTodoTasks.openProjects');
      return;
    }

    if (message.type === 'openSettings') {
      await vscode.commands.executeCommand('sharedTodoTasks.openSettings');
      return;
    }

    if (message.type === 'copyFirebaseRules') {
      await vscode.env.clipboard.writeText(FIREBASE_RULES_TEMPLATE);
      this.postMessage({ type: 'notice', payload: { message: this.t('webview.rulesCopied') } });
      return;
    }

    if (message.type === 'testFirebaseUrl') {
      await this.run(async () => {
        await this.syncService.testDatabaseUrl(message.payload?.databaseUrl ?? '');
        this.postMessage({ type: 'notice', payload: { message: this.t('webview.connectionOk') } });
      });
      return;
    }

    if (message.type === 'saveFirebaseUrl') {
      await this.run(async () => {
        await this.syncService.configureDatabaseUrl(message.payload?.databaseUrl ?? '');
        this.postMessage({ type: 'notice', payload: { message: this.t('command.configureFirebase.success') } });
      });
      return;
    }
  }

  private async run(action: () => Thenable<void> | Promise<void>): Promise<void> {
    try {
      await action();
      this.postState();
    } catch (error) {
      const message = error instanceof Error ? error.message : this.t('error.unknown');
      void vscode.window.showErrorMessage(message);
      this.postMessage({ type: 'error', payload: { message } });
    }
  }

  private postState(): void {
    const config = this.syncService.getConfig();

    this.postMessage({
      type: 'hydrate',
      payload: {
        todos: this.syncService.getTodos(),
        status: this.syncService.getStatus(),
        currentBucket: this.syncService.getCurrentBucket(),
        hasFirebase: this.syncService.hasDatabaseUrl(),
        firebaseUrl: this.syncService.getDatabaseUrl(),
        hasBucket: this.syncService.hasDatabaseUrl() && Boolean(this.syncService.getCurrentBucket()),
        messages: getWebviewMessages(config.language),
        locale: getLocaleName(config.language),
        firebaseRules: FIREBASE_RULES_TEMPLATE,
      },
    });
  }

  private postMessage(message: unknown): void {
    void this.view?.webview.postMessage(message);
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = createNonce();
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'sidebar.css'));
    const codiconUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'codicons', 'codicon.css'));
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'sidebar.js'));
    const language = this.syncService.getConfig().language;

    return `<!DOCTYPE html>
<html lang="${language}">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https: data:; style-src ${webview.cspSource}; font-src ${webview.cspSource}; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="${codiconUri}" />
  <link rel="stylesheet" href="${styleUri}" />
  <title>Shared Todo Taskboard</title>
</head>
<body>
  <div id="app"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  private t(
    key: Parameters<typeof translate>[1],
    values?: Parameters<typeof translate>[2],
  ): string {
    return translate(this.syncService.getConfig().language, key, values);
  }
}

function createNonce(): string {
  return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
}
