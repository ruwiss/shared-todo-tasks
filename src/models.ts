import { LanguageCode } from './localization';

export interface TodoItem {
  id: string;
  text: string;
  imageUrl?: string;
  completed: boolean;
  inProgress: boolean;
  author: string;
  updatedBy: string;
  createdAt: number;
  updatedAt: number;
}

export interface TodoRecord {
  text?: unknown;
  imageUrl?: unknown;
  completed?: unknown;
  inProgress?: unknown;
  author?: unknown;
  updatedBy?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export type TodoChangeType =
  | 'added'
  | 'removed'
  | 'started'
  | 'stopped'
  | 'completed'
  | 'reopened'
  | 'updated';

export interface BucketSummary {
  id: string;
  todoCount: number;
  updatedAt: number;
  lastActivity?: LastActivity;
}

export interface LastActivity {
  type: TodoChangeType;
  todoId: string;
  todoText: string;
  deviceName: string;
  timestamp: number;
}

export interface LastActivityRecord {
  type?: unknown;
  todoId?: unknown;
  todoText?: unknown;
  deviceName?: unknown;
  timestamp?: unknown;
}

export interface TodoChange {
  type: TodoChangeType;
  before?: TodoItem;
  after?: TodoItem;
}

export type ConnectionState =
  | 'idle'
  | 'needsFirebase'
  | 'needsBucket'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'error';

export interface ConnectionStatus {
  state: ConnectionState;
  message: string;
}

export interface SharedTodoTasksConfig {
  databaseUrl: string;
  deviceName: string;
  customDeviceName: string;
  language: LanguageCode;
  languageSetting: string;
  notificationsEnabled: boolean;
  sounds: Record<TodoChangeType, string>;
}

export interface FirebaseStreamEvent {
  event: 'put' | 'patch' | 'keep-alive' | 'cancel' | 'auth_revoked';
  path?: string;
  data?: unknown;
}
