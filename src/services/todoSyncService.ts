import * as vscode from 'vscode';
import { BUCKETS_ROOT_PATH, CONNECTION_TEST_PATH } from '../constants';
import { getConfig as readConfig } from '../config';
import { translate } from '../localization';
import {
  BucketSummary,
  ConnectionStatus,
  FirebaseStreamEvent,
  SharedTodoTasksConfig,
  LastActivity,
  TodoChange,
  TodoChangeType,
  TodoItem,
} from '../models';
import { TodoStore } from '../state/todoStore';
import { sanitizeBucketName } from '../utils/bucketName';
import { normalizeFirebaseDatabaseUrl } from '../utils/firebaseUrl';
import { AppStorage } from './appStorage';
import {
  createLastActivityPayload,
  createReplaceTodoPayload,
  createTodoPayload,
  FirebaseRestClient,
  generatePushId,
} from './firebaseRestClient';
import { NotificationService } from './notificationService';
import { ImageUploadService } from './imageUploadService';

const RECONNECT_DELAY = 3000;
const STREAM_WATCHDOG_DELAY = 75_000;

export class TodoSyncService implements vscode.Disposable {
  private readonly statusEmitter = new vscode.EventEmitter<ConnectionStatus>();
  private readonly bucketEmitter = new vscode.EventEmitter<string>();
  private readonly store = new TodoStore();
  private readonly notifications: NotificationService;
  private readonly imageUpload = new ImageUploadService();
  private readonly disposables: vscode.Disposable[] = [
    this.statusEmitter,
    this.bucketEmitter,
  ];

  private config: SharedTodoTasksConfig = readConfig();
  private client?: FirebaseRestClient;
  private streamDisposable?: vscode.Disposable;
  private streamWatchdog?: NodeJS.Timeout;
  private reconnectTimer?: NodeJS.Timeout;
  private connectionVersion = 0;
  private activeStreamId = 0;
  private currentBucket = '';
  private status: ConnectionStatus = {
    state: 'idle',
    message: 'Ready',
  };

  public constructor(
    private readonly storage: AppStorage,
    soundsDirectory: string,
  ) {
    this.notifications = new NotificationService(soundsDirectory);
  }

  public readonly onDidChangeTodos = this.store.onDidChange;
  public readonly onDidChangeStatus = this.statusEmitter.event;
  public readonly onDidChangeBucket = this.bucketEmitter.event;

  public getTodos(): TodoItem[] {
    return this.store.getTodos();
  }

  public getStatus(): ConnectionStatus {
    return this.status;
  }

  public getLastActivity(): LastActivity | undefined {
    return this.store.getLastActivity();
  }

  public getCurrentBucket(): string {
    return this.currentBucket;
  }

  public getConfig(): SharedTodoTasksConfig {
    return this.config;
  }

  public hasDatabaseUrl(): boolean {
    return Boolean(this.config.databaseUrl);
  }

  public getDatabaseUrl(): string {
    return this.config.databaseUrl;
  }

  public async configureDatabaseUrl(databaseUrl: string): Promise<string> {
    const normalized = await this.testDatabaseUrl(databaseUrl);
    const previous = this.config.databaseUrl;

    await vscode.workspace
      .getConfiguration('sharedTodoTasks')
      .update('firebase.databaseUrl', normalized, vscode.ConfigurationTarget.Global);

    if (previous !== normalized) {
      await this.storage.clearCurrentBucket();
    }

    await this.restart();
    return normalized;
  }

  public async testDatabaseUrl(databaseUrl: string): Promise<string> {
    const normalized = normalizeFirebaseDatabaseUrl(databaseUrl);

    if (!normalized) {
      throw new Error(this.t('error.invalidFirebaseUrl'));
    }

    try {
      const client = new FirebaseRestClient(normalized, CONNECTION_TEST_PATH);
      await client.patchRoot({
        checkedAt: Date.now(),
        deviceName: this.config.deviceName,
      });
      await client.putRoot(null);
      return normalized;
    } catch (error) {
      const message = error instanceof Error ? error.message : this.t('error.unknown');
      throw new Error(this.t('error.firebaseConnectionTestFailed', { message }));
    }
  }

  public async start(): Promise<void> {
    await this.restart();
  }

  public async restart(): Promise<void> {
    this.connectionVersion += 1;
    this.clearConnection();
    this.config = readConfig();

    const databaseUrl = this.config.databaseUrl;

    if (!databaseUrl) {
      this.client = undefined;
      this.currentBucket = '';
      this.store.setSnapshot({});
      this.emitBucket();
      this.updateStatus('needsFirebase', this.t('status.needsFirebase'));
      return;
    }

    try {
      const buckets = await this.listBuckets(databaseUrl);
      const bucketId = await this.resolveCurrentBucket(buckets);

      if (!bucketId) {
        this.client = undefined;
        this.currentBucket = '';
        this.store.setSnapshot({});
        this.emitBucket();
        this.updateStatus('needsBucket', this.t('status.needsBucket'));
        return;
      }

      this.currentBucket = bucketId;
      this.emitBucket();
      this.client = new FirebaseRestClient(databaseUrl, buildBucketPath(bucketId));
      await this.connect('connecting');
    } catch (error) {
      const message = error instanceof Error ? error.message : this.t('error.unknown');
      this.client = undefined;
      this.store.setSnapshot({});
      this.updateStatus('error', this.t('error.firebaseReadFailed', { message }));
    }
  }

  public reloadConfig(): void {
    this.config = readConfig();
    this.statusEmitter.fire(this.status);
    this.bucketEmitter.fire(this.currentBucket);
  }

  public async listBuckets(databaseUrl = this.requireDatabaseUrl()): Promise<BucketSummary[]> {
    const client = new FirebaseRestClient(databaseUrl, BUCKETS_ROOT_PATH);
    const raw = await client.getRoot();
    return toBucketSummaries(raw);
  }

  public async createBucket(name: string): Promise<string> {
    const bucketId = sanitizeBucketName(name);

    if (!bucketId) {
      throw new Error(this.t('error.validProjectName'));
    }

    const databaseUrl = this.requireDatabaseUrl();
    const existing = await this.listBuckets(databaseUrl);

    if (existing.some((bucket) => bucket.id === bucketId)) {
      await this.selectBucket(bucketId);
      return bucketId;
    }

    const client = new FirebaseRestClient(databaseUrl, buildBucketPath(bucketId));
    const timestamp = Date.now();

    await client.patchRoot({
      __meta: {
        name: bucketId,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    });

    await this.selectBucket(bucketId);
    return bucketId;
  }

  public async selectBucket(bucketId: string): Promise<void> {
    const normalized = sanitizeBucketName(bucketId);

    if (!normalized) {
      throw new Error(this.t('error.selectProject'));
    }

    await this.storage.setCurrentBucket(normalized);
    this.currentBucket = normalized;
    this.emitBucket();
    await this.restart();
  }

  public async addTodo(text: string, imageUrl?: string): Promise<void> {
    const trimmed = text.trim();

    if (!trimmed && !imageUrl) {
      throw new Error(this.t('error.todoTextOrImageRequired'));
    }

    await this.runMutation(async () => {
      const client = this.requireClient();
      const id = generatePushId();
      const activity = createLastActivityPayload('added', this.config.deviceName, id, trimmed || this.t('todo.imageFallback'));

      await client.createTodoWithActivity(
        id,
        createTodoPayload(trimmed || this.t('todo.imageFallback'), this.config.deviceName, imageUrl),
        activity,
      );
    });
    this.playLocalSound('added');
  }

  public async updateTodoText(id: string, text: string): Promise<void> {
    const trimmed = text.trim();

    await this.runMutation(async () => {
      const client = this.requireClient();
      const todo = this.requireTodo(id);

      if (!trimmed && !todo.imageUrl) {
        throw new Error(this.t('error.todoTextCannotBeEmpty'));
      }

      const activity = createLastActivityPayload('updated', this.config.deviceName, id, trimmed || todo.text);

      await client.replaceTodoWithActivity(
        id,
        createReplaceTodoPayload(todo, this.config.deviceName, { text: trimmed || todo.text }),
        activity,
      );
    });
    this.playLocalSound('updated');
  }

  public async updateTodo(
    id: string,
    changes: { text: string; imageUrl?: string },
  ): Promise<void> {
    const trimmed = changes.text.trim();

    await this.runMutation(async () => {
      const client = this.requireClient();
      const todo = this.requireTodo(id);

      if (!trimmed && !changes.imageUrl) {
        throw new Error(this.t('error.todoTextOrImageRequired'));
      }

      const activity = createLastActivityPayload('updated', this.config.deviceName, id, trimmed || todo.text);

      await client.replaceTodoWithActivity(
        id,
        createReplaceTodoPayload(todo, this.config.deviceName, {
          text: trimmed || todo.text,
          imageUrl: changes.imageUrl,
        }),
        activity,
      );
    });
    this.playLocalSound('updated');
  }

  public async uploadTodoImage(dataUrl: string): Promise<string> {
    const result = await this.imageUpload.uploadImage(dataUrl);
    return result.url;
  }

  public async toggleTodo(id: string, completed: boolean): Promise<void> {
    const activityType: TodoChangeType = completed ? 'completed' : 'reopened';

    await this.runMutation(async () => {
      const client = this.requireClient();
      const todo = this.requireTodo(id);
      const activity = createLastActivityPayload(activityType, this.config.deviceName, id, todo.text);

      await client.replaceTodoWithActivity(
        id,
        createReplaceTodoPayload(todo, this.config.deviceName, {
          completed,
          inProgress: completed ? false : todo.inProgress,
        }),
        activity,
      );
    });
    this.playLocalSound(activityType);
  }

  public async setTodoInProgress(id: string, inProgress: boolean): Promise<void> {
    const activityType: TodoChangeType = inProgress ? 'started' : 'stopped';

    await this.runMutation(async () => {
      const client = this.requireClient();
      const todo = this.requireTodo(id);
      const nextCompleted = inProgress ? false : todo.completed;
      const activity = createLastActivityPayload(activityType, this.config.deviceName, id, todo.text);

      await client.replaceTodoWithActivity(
        id,
        createReplaceTodoPayload(todo, this.config.deviceName, {
          inProgress,
          completed: nextCompleted,
        }),
        activity,
      );
    });
    this.playLocalSound(activityType);
  }

  public async deleteTodo(id: string): Promise<void> {
    await this.runMutation(async () => {
      const client = this.requireClient();
      const todo = this.requireTodo(id);
      const activity = createLastActivityPayload('removed', this.config.deviceName, id, todo.text);

      await client.deleteTodoWithActivity(id, activity);
    });
    this.playLocalSound('removed');
  }

  public dispose(): void {
    this.connectionVersion += 1;
    this.clearConnection();
    vscode.Disposable.from(...this.disposables).dispose();
  }

  private async resolveCurrentBucket(buckets: BucketSummary[]): Promise<string> {
    const storedBucket = this.storage.getCurrentBucket();

    if (storedBucket && buckets.some((bucket) => bucket.id === storedBucket)) {
      return storedBucket;
    }

    const firstBucket = buckets[0]?.id ?? '';

    if (!firstBucket) {
      await this.storage.clearCurrentBucket();
      return '';
    }

    await this.storage.setCurrentBucket(firstBucket);
    return firstBucket;
  }

  private async connect(state: 'connecting' | 'reconnecting'): Promise<void> {
    if (!this.client) {
      return;
    }

    const version = this.connectionVersion;
    this.updateStatus(
      state,
      state === 'connecting' ? this.t('status.connecting') : this.t('status.reconnecting'),
    );

    try {
      const snapshot = await this.client.getRoot();

      if (version !== this.connectionVersion) {
        return;
      }

      this.store.setSnapshot(snapshot);
      this.updateStatus('connected', this.t('status.connected'));
      this.openStream(version);
    } catch (error) {
      this.handleConnectionFailure(error, version);
    }
  }

  private openStream(version: number): void {
    if (!this.client) {
      return;
    }

    const streamId = this.resetActiveStream();
    this.streamDisposable = this.client.stream({
      onOpen: () => {
        this.markStreamActivity(version, streamId);
        this.updateStatus('connected', this.t('status.connected'));
      },
      onEvent: (event) => {
        void this.handleStreamEvent(event, version, streamId);
      },
      onError: (error) => {
        this.handleStreamFailure(error, version, streamId);
      },
      onClose: () => {
        this.handleStreamClose(version, streamId);
      },
    });
    this.markStreamActivity(version, streamId);
  }

  private async handleStreamEvent(
    event: FirebaseStreamEvent,
    version: number,
    streamId: number,
  ): Promise<void> {
    if (!this.isActiveStream(version, streamId)) {
      return;
    }

    this.markStreamActivity(version, streamId);

    if (event.event === 'keep-alive') {
      this.updateStatus('connected', this.t('status.connected'));
      return;
    }

    if (event.event === 'cancel' || event.event === 'auth_revoked') {
      this.invalidateActiveStream(streamId);
      this.updateStatus('error', this.t('error.firebaseStreamCanceled'));
      this.scheduleReconnect(this.t('status.streamInterrupted'), version);
      return;
    }

    const changes = this.store.applyStreamEvent(event);
    this.updateStatus('connected', this.t('status.connected'));
    await this.notifyForChanges(changes);
  }

  private async notifyForChanges(changes: TodoChange[]): Promise<void> {
    this.config = readConfig();

    const isMe = (activity: LastActivity | undefined) =>
      activity?.deviceName === this.config.deviceName;

    const lastActivity = this.store.getLastActivity();
    const isOwnChange = isMe(lastActivity);
    const visibleChanges = this.config.notificationsEnabled ? changes : [];

    await this.notifications.notify(
      visibleChanges,
      this.config,
      !isOwnChange,
      !isOwnChange,
    );
  }

  private handleConnectionFailure(error: unknown, version: number): void {
    if (version !== this.connectionVersion) {
      return;
    }

    const message = error instanceof Error ? error.message : this.t('error.unknown');
    this.updateStatus('error', this.t('status.connectionError', { message }));
    this.scheduleReconnect(this.t('status.reconnecting'), version);
  }

  private handleStreamFailure(error: unknown, version: number, streamId: number): void {
    if (!this.isActiveStream(version, streamId)) {
      return;
    }

    this.invalidateActiveStream(streamId);
    this.handleConnectionFailure(error, version);
  }

  private handleStreamClose(version: number, streamId: number): void {
    if (!this.isActiveStream(version, streamId)) {
      return;
    }

    this.invalidateActiveStream(streamId);
    this.scheduleReconnect(this.t('status.connectionClosed'), version);
  }

  private markStreamActivity(version: number, streamId: number): void {
    if (!this.isActiveStream(version, streamId)) {
      return;
    }

    if (this.streamWatchdog) {
      clearTimeout(this.streamWatchdog);
    }

    this.streamWatchdog = setTimeout(() => {
      if (!this.isActiveStream(version, streamId)) {
        return;
      }

      this.terminateActiveStream(streamId);
      this.scheduleReconnect(this.t('status.streamStopped'), version);
    }, STREAM_WATCHDOG_DELAY);
  }

  private scheduleReconnect(message: string, version: number): void {
    if (version !== this.connectionVersion || this.reconnectTimer || !this.client) {
      return;
    }

    this.updateStatus('reconnecting', message);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;

      if (version !== this.connectionVersion) {
        return;
      }

      void this.connect('reconnecting');
    }, RECONNECT_DELAY);
  }

  private updateStatus(state: ConnectionStatus['state'], message: string): void {
    this.status = { state, message };
    this.statusEmitter.fire(this.status);
  }

  private async runMutation(action: () => Promise<void>): Promise<void> {
    this.config = readConfig();

    try {
      await action();
      return;
    } catch (error) {
      if (!this.shouldRetryMutation(error)) {
        throw error;
      }
    }

    await this.restart();
    await action();
  }

  private shouldRetryMutation(error: unknown): boolean {
    if (!this.currentBucket) {
      return false;
    }

    if (!this.client || ['connecting', 'reconnecting', 'error'].includes(this.status.state)) {
      return true;
    }

    if (!(error instanceof Error)) {
      return false;
    }

    return [
      'Firebase request failed',
      'fetch failed',
      this.t('error.firebaseNotConfigured'),
      'stream',
      'timeout',
      'network',
    ].some((token) => error.message.toLowerCase().includes(token.toLowerCase()));
  }

  private emitBucket(): void {
    this.bucketEmitter.fire(this.currentBucket);
  }

  private requireClient(): FirebaseRestClient {
    if (!this.client) {
      throw new Error(this.t('error.firebaseNotConfigured'));
    }

    return this.client;
  }

  private requireTodo(id: string): TodoItem {
    const todo = this.store.getTodo(id);

    if (!todo) {
      throw new Error(this.t('error.todoNotFound'));
    }

    return todo;
  }

  private clearConnection(): void {
    this.resetActiveStream();

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
  }

  private isActiveStream(version: number, streamId: number): boolean {
    return version === this.connectionVersion && streamId === this.activeStreamId;
  }

  private resetActiveStream(): number {
    this.activeStreamId += 1;
    this.clearStreamWatchdog();
    this.streamDisposable?.dispose();
    this.streamDisposable = undefined;
    return this.activeStreamId;
  }

  private invalidateActiveStream(streamId: number): void {
    if (streamId !== this.activeStreamId) {
      return;
    }

    this.activeStreamId += 1;
    this.clearStreamWatchdog();
    this.streamDisposable = undefined;
  }

  private terminateActiveStream(streamId: number): void {
    if (streamId !== this.activeStreamId) {
      return;
    }

    const streamDisposable = this.streamDisposable;
    this.invalidateActiveStream(streamId);
    streamDisposable?.dispose();
  }

  private clearStreamWatchdog(): void {
    if (!this.streamWatchdog) {
      return;
    }

    clearTimeout(this.streamWatchdog);
    this.streamWatchdog = undefined;
  }

  private requireDatabaseUrl(): string {
    if (!this.config.databaseUrl) {
      throw new Error(this.t('error.firebaseNotConfigured'));
    }

    return this.config.databaseUrl;
  }

  private playLocalSound(type: TodoChangeType): void {
    this.config = readConfig();
    this.notifications.play(type, this.config);
  }

  private t(
    key: Parameters<typeof translate>[1],
    values?: Parameters<typeof translate>[2],
  ): string {
    return translate(this.config.language, key, values);
  }
}

function buildBucketPath(bucketId: string): string {
  return `${BUCKETS_ROOT_PATH}/${bucketId}`;
}

function toBucketSummaries(raw: unknown): BucketSummary[] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return [];
  }

  return Object.entries(raw as Record<string, unknown>)
    .filter(([, value]) => value && typeof value === 'object' && !Array.isArray(value))
    .map(([id, value]) => toBucketSummary(id, value as Record<string, unknown>))
    .sort((left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id));
}

function toBucketSummary(id: string, raw: Record<string, unknown>): BucketSummary {
  const meta = readMeta(raw);
  const lastActivity = readLastActivity(meta.lastActivity);
  const updatedAt = readNumber(meta.updatedAt, lastActivity?.timestamp ?? readNumber(meta.createdAt, 0));

  return {
    id,
    todoCount: Object.keys(raw).filter((key) => key !== '__meta').length,
    updatedAt,
    lastActivity,
  };
}

function readMeta(raw: Record<string, unknown>): Record<string, unknown> {
  const meta = raw.__meta;
  return meta && typeof meta === 'object' && !Array.isArray(meta)
    ? (meta as Record<string, unknown>)
    : {};
}

function readLastActivity(raw: unknown): LastActivity | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return undefined;
  }

  return {
    type: readChangeType((raw as Record<string, unknown>).type),
    todoId: readString((raw as Record<string, unknown>).todoId, ''),
    todoText: readString((raw as Record<string, unknown>).todoText, 'Todo'),
    deviceName: readString((raw as Record<string, unknown>).deviceName, 'device'),
    timestamp: readNumber((raw as Record<string, unknown>).timestamp, 0),
  };
}

function readString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function readChangeType(value: unknown): TodoChangeType {
  return ['added', 'removed', 'started', 'stopped', 'completed', 'reopened', 'updated'].includes(String(value))
    ? (value as TodoChangeType)
    : 'updated';
}
