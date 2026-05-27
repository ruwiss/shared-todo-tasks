import * as vscode from 'vscode';
import { FIREBASE_RULES_TEMPLATE } from './constants';
import { getConfig } from './config';
import { translate } from './localization';
import { TodoChangeType } from './models';
import { AppStorage } from './services/appStorage';
import { NotificationService, SoundPlaybackResult } from './services/notificationService';
import { TodoSyncService } from './services/todoSyncService';
import { SidebarViewProvider } from './views/sidebarViewProvider';
import { TodoListViewProvider } from './views/todoListViewProvider';

interface TodoItemLike {
  todo: {
    id: string;
    text: string;
    completed: boolean;
  };
}

const SOUND_ACTIONS: TodoChangeType[] = [
  'added',
  'removed',
  'started',
  'stopped',
  'completed',
  'reopened',
  'updated',
];

const SOUND_ACTION_LABEL_KEYS: Record<TodoChangeType, Parameters<typeof translate>[1]> = {
  added: 'command.soundAction.added',
  removed: 'command.soundAction.removed',
  started: 'command.soundAction.started',
  stopped: 'command.soundAction.stopped',
  completed: 'command.soundAction.completed',
  reopened: 'command.soundAction.reopened',
  updated: 'command.soundAction.updated',
};

type SoundActionTarget = TodoChangeType | 'all';
type SoundActionPick = vscode.QuickPickItem & { type: SoundActionTarget };
type SoundOptionPick = vscode.QuickPickItem & { value: 'builtin:xp' | 'none' | 'file' };

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const storage = new AppStorage(context.workspaceState);
  const soundsDirectory = vscode.Uri.joinPath(context.extensionUri, 'media', 'sounds').fsPath;
  const notificationService = new NotificationService(soundsDirectory);
  const syncService = new TodoSyncService(storage, soundsDirectory);
  const sidebarProvider = new SidebarViewProvider(syncService);
  const todoListProvider = new TodoListViewProvider(context.extensionUri, syncService);

  await ensureNotificationDefaultEnabled();

  context.subscriptions.push(syncService, sidebarProvider, todoListProvider);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      SidebarViewProvider.viewType,
      sidebarProvider,
    ),
  );
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      TodoListViewProvider.viewType,
      todoListProvider,
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('sharedTodoTasks.addTodo', async () => {
      if (!ensureFirebaseConfigured(syncService) || !ensureBucketSelected(syncService)) {
        return;
      }

      const text = await vscode.window.showInputBox({
        prompt: t('command.addTodo.prompt', { project: syncService.getCurrentBucket() }),
        placeHolder: t('command.addTodo.placeholder'),
        ignoreFocusOut: true,
      });

      if (!text) {
        return;
      }

      await runCommand(() => syncService.addTodo(text));
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('sharedTodoTasks.refreshTodos', async () => {
      await runCommand(() => syncService.restart());
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('sharedTodoTasks.openProjects', async () => {
      await openProjects(syncService);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('sharedTodoTasks.configureFirebase', async () => {
      await configureFirebase(syncService);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('sharedTodoTasks.copyFirebaseRules', async () => {
      await vscode.env.clipboard.writeText(FIREBASE_RULES_TEMPLATE);
      void vscode.window.showInformationMessage(t('command.copyRules.success'));
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('sharedTodoTasks.createBucket', async () => {
      await createBucket(syncService);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('sharedTodoTasks.openSettings', async () => {
      await vscode.commands.executeCommand('workbench.action.openSettings', 'sharedTodoTasks');
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('sharedTodoTasks.selectSound', async () => {
      await selectSound(notificationService);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('sharedTodoTasks.testSound', async () => {
      await testSound(notificationService);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('sharedTodoTasks.toggleTodoItem', async (item?: TodoItemLike) => {
      if (!item) {
        return;
      }

      await runCommand(() => syncService.toggleTodo(item.todo.id, !item.todo.completed));
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('sharedTodoTasks.editTodoItem', async (item?: TodoItemLike) => {
      if (!item) {
        return;
      }

      const text = await vscode.window.showInputBox({
        prompt: t('command.editTodo.prompt'),
        value: item.todo.text,
        ignoreFocusOut: true,
      });

      if (!text) {
        return;
      }

      await runCommand(() => syncService.updateTodoText(item.todo.id, text));
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('sharedTodoTasks.deleteTodoItem', async (item?: TodoItemLike) => {
      if (!item) {
        return;
      }

      const answer = await vscode.window.showWarningMessage(
        t('command.delete.prompt', { todo: item.todo.text }),
        { modal: true },
        t('command.delete.confirm'),
      );

      if (answer !== t('command.delete.confirm')) {
        return;
      }

      await runCommand(() => syncService.deleteTodo(item.todo.id));
    }),
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(async (event) => {
      if (
        !event.affectsConfiguration('sharedTodoTasks.notifications')
        && !event.affectsConfiguration('sharedTodoTasks.identity')
        && !event.affectsConfiguration('sharedTodoTasks.firebase')
        && !event.affectsConfiguration('sharedTodoTasks.language')
        && !event.affectsConfiguration('sharedTodoTasks.sounds')
      ) {
        return;
      }

      if (event.affectsConfiguration('sharedTodoTasks.firebase')) {
        await syncService.restart();
        return;
      }

      syncService.reloadConfig();
    }),
  );

  await syncService.start();
}

export function deactivate(): void {}

async function openProjects(syncService: TodoSyncService): Promise<void> {
  try {
    if (!ensureFirebaseConfigured(syncService)) {
      return;
    }

    const buckets = await syncService.listBuckets();
    const currentBucket = syncService.getCurrentBucket();
    const pick = await vscode.window.showQuickPick(
      [
        {
          label: `$(add) ${t('command.openProjects.create')}`,
          description: t('command.openProjects.createDescription'),
          action: 'create' as const,
        },
        ...buckets.map((bucket) => ({
          label: `$(folder) ${bucket.id}`,
          description: bucket.id === currentBucket ? t('command.openProjects.current') : '',
          detail: t('command.openProjects.detail', { count: bucket.todoCount }),
          action: 'select' as const,
          bucketId: bucket.id,
        })),
      ],
      {
        title: t('command.openProjects.title'),
        matchOnDetail: true,
        ignoreFocusOut: true,
        placeHolder: t('command.openProjects.placeholder'),
      },
    );

    if (!pick) {
      return;
    }

    if (pick.action === 'create') {
      await createBucket(syncService);
      return;
    }

    await syncService.selectBucket(pick.bucketId);
  } catch (error) {
    showError(error);
  }
}

async function createBucket(syncService: TodoSyncService): Promise<void> {
  if (!ensureFirebaseConfigured(syncService)) {
    return;
  }

  const name = await vscode.window.showInputBox({
    prompt: t('command.createBucket.prompt'),
    placeHolder: t('command.createBucket.placeholder'),
    ignoreFocusOut: true,
  });

  if (!name) {
    return;
  }

  await runCommand(async () => {
    await syncService.createBucket(name);
  });
}

async function configureFirebase(syncService: TodoSyncService): Promise<void> {
  const action = await vscode.window.showInformationMessage(
    t('command.configureFirebase.title'),
    {
      modal: true,
      detail: t('command.firebaseSetup.instructions'),
    },
    t('command.firebaseSetup.copyRules'),
    t('command.firebaseSetup.enterUrl'),
    t('command.firebaseSetup.openSettings'),
  );

  if (!action) {
    return;
  }

  if (action === t('command.firebaseSetup.copyRules')) {
    await vscode.env.clipboard.writeText(FIREBASE_RULES_TEMPLATE);
    void vscode.window.showInformationMessage(t('command.copyRules.success'));
  }

  if (action === t('command.firebaseSetup.openSettings')) {
    await vscode.commands.executeCommand('workbench.action.openSettings', 'sharedTodoTasks.firebase');
    return;
  }

  const databaseUrl = await vscode.window.showInputBox({
    prompt: t('command.configureFirebase.prompt'),
    placeHolder: t('command.configureFirebase.placeholder'),
    value: syncService.getDatabaseUrl(),
    ignoreFocusOut: true,
  });

  if (!databaseUrl) {
    return;
  }

  await runCommand(async () => {
    await syncService.configureDatabaseUrl(databaseUrl);
    void vscode.window.showInformationMessage(t('command.configureFirebase.success'));
  });
}

async function selectSound(notificationService: NotificationService): Promise<void> {
  try {
    const type = await pickSoundAction(t('command.selectSound.pickAction'), true);

    if (!type) {
      return;
    }

    const setting = await pickSoundSetting(type);

    if (setting === undefined) {
      return;
    }

    const config = vscode.workspace.getConfiguration('sharedTodoTasks');

    if (type === 'all') {
      for (const soundType of SOUND_ACTIONS) {
        await config.update(`sounds.${soundType}`, setting, vscode.ConfigurationTarget.Global);
      }
    } else {
      await config.update(`sounds.${type}`, setting, vscode.ConfigurationTarget.Global);
    }

    const action = type === 'all' ? t('command.soundAction.all') : t(SOUND_ACTION_LABEL_KEYS[type]);
    const result = notificationService.playSetting(setting);
    showSoundPlaybackResult(result, setting, action, t('command.selectSound.saved', { action }));
  } catch (error) {
    showError(error);
  }
}

async function testSound(notificationService: NotificationService): Promise<void> {
  try {
    const type = await pickSoundAction(t('command.testSound.pickAction'), false);

    if (!type) {
      return;
    }

    const config = getConfig();
    const action = t(SOUND_ACTION_LABEL_KEYS[type]);
    const result = notificationService.playSetting(config.sounds[type]);
    showSoundPlaybackResult(result, config.sounds[type], action, t('command.testSound.playing', { action }));
  } catch (error) {
    showError(error);
  }
}

async function pickSoundAction(title: string, includeAll: true): Promise<SoundActionTarget | undefined>;
async function pickSoundAction(title: string, includeAll: false): Promise<TodoChangeType | undefined>;
async function pickSoundAction(title: string, includeAll: boolean): Promise<SoundActionTarget | undefined> {
  const config = getConfig();
  const items: SoundActionPick[] = [
    ...(includeAll
      ? [{
        label: t('command.soundAction.all'),
        description: t('command.selectSound.allDescription'),
        type: 'all' as const,
      }]
      : []),
    ...SOUND_ACTIONS.map((type) => ({
      label: t(SOUND_ACTION_LABEL_KEYS[type]),
      description: formatSoundSetting(config.sounds[type]),
      type,
    })),
  ];

  const pick = await vscode.window.showQuickPick<SoundActionPick>(
    items,
    {
      title,
      placeHolder: t('command.selectSound.pickActionPlaceholder'),
      ignoreFocusOut: true,
    },
  );

  return pick?.type;
}

async function pickSoundSetting(type: SoundActionTarget): Promise<string | undefined> {
  const action = type === 'all' ? t('command.soundAction.all') : t(SOUND_ACTION_LABEL_KEYS[type]);
  const current = type === 'all' ? 'builtin:xp' : getConfig().sounds[type];
  const pick = await vscode.window.showQuickPick<SoundOptionPick>(
    [
      {
        label: `$(bell) ${t('command.selectSound.builtinXp')}`,
        description: t('command.selectSound.builtinXpDescription'),
        value: 'builtin:xp',
      },
      {
        label: `$(mute) ${t('command.selectSound.none')}`,
        description: t('command.selectSound.noneDescription'),
        value: 'none',
      },
      {
        label: `$(folder-opened) ${t('command.selectSound.chooseFile')}`,
        description: t('command.selectSound.chooseFileDescription'),
        value: 'file',
      },
    ],
    {
      title: t('command.selectSound.pickSound', { action }),
      placeHolder: t('command.selectSound.current', { value: formatSoundSetting(current) }),
      ignoreFocusOut: true,
    },
  );

  if (!pick) {
    return undefined;
  }

  if (pick.value !== 'file') {
    return pick.value;
  }

  const files = await vscode.window.showOpenDialog({
    title: t('command.selectSound.fileTitle', { action }),
    openLabel: t('command.selectSound.fileOpen'),
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    filters: {
      Audio: ['mp3', 'wav'],
    },
  });

  return files?.[0]?.fsPath;
}

function showSoundPlaybackResult(
  result: SoundPlaybackResult,
  setting: string,
  action: string,
  successMessage: string,
): void {
  if (result === 'silent') {
    void vscode.window.showInformationMessage(t('command.sound.silent', { action }));
    return;
  }

  if (result === 'missing') {
    void vscode.window.showWarningMessage(t('command.sound.missing', { value: formatSoundSetting(setting) }));
    return;
  }

  if (result === 'failed') {
    void vscode.window.showWarningMessage(t('command.sound.failed', { value: formatSoundSetting(setting) }));
    return;
  }

  void vscode.window.showInformationMessage(successMessage);
}

function formatSoundSetting(setting: string): string {
  const value = setting.trim();
  const normalized = value.toLowerCase();

  if (!value || normalized === 'builtin:xp' || normalized === 'xp' || normalized === 'default') {
    return t('command.selectSound.builtinXp');
  }

  if (normalized === 'none' || normalized === 'off' || normalized === 'silent') {
    return t('command.selectSound.none');
  }

  return value;
}

function ensureFirebaseConfigured(syncService: TodoSyncService): boolean {
  if (syncService.hasDatabaseUrl()) {
    return true;
  }

  void vscode.window.showInformationMessage(
    t('error.firebaseNotConfigured'),
    t('sidebar.configureFirebase'),
  ).then((answer) => {
    if (answer === t('sidebar.configureFirebase')) {
      void vscode.commands.executeCommand('sharedTodoTasks.configureFirebase');
    }
  });

  return false;
}

function ensureBucketSelected(syncService: TodoSyncService): boolean {
  if (syncService.getCurrentBucket()) {
    return true;
  }

  void vscode.window.showInformationMessage(
    t('command.selectProject'),
    t('command.projects.open'),
  ).then((answer) => {
    if (answer === t('command.projects.open')) {
      void vscode.commands.executeCommand('sharedTodoTasks.openProjects');
    }
  });

  return false;
}

async function runCommand(action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (error) {
    showError(error);
  }
}

function showError(error: unknown): void {
  const message = error instanceof Error ? error.message : t('error.unknown');
  void vscode.window.showErrorMessage(message);
}

async function ensureNotificationDefaultEnabled(): Promise<void> {
  const config = vscode.workspace.getConfiguration('sharedTodoTasks');
  const inspected = config.inspect<boolean>('notifications.enabled');
  const hasExplicitValue = inspected?.globalValue !== undefined
    || inspected?.workspaceValue !== undefined
    || inspected?.workspaceFolderValue !== undefined
    || inspected?.globalLanguageValue !== undefined
    || inspected?.workspaceLanguageValue !== undefined
    || inspected?.workspaceFolderLanguageValue !== undefined;

  if (!hasExplicitValue) {
    await config.update('notifications.enabled', true, vscode.ConfigurationTarget.Global);
  }
}

function t(
  key: Parameters<typeof translate>[1],
  values?: Parameters<typeof translate>[2],
): string {
  return translate(getConfig().language, key, values);
}
