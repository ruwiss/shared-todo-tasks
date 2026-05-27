import * as vscode from 'vscode';
import {
  FirebaseStreamEvent,
  LastActivity,
  LastActivityRecord,
  TodoChange,
  TodoItem,
  TodoRecord,
} from '../models';

export class TodoStore {
  private readonly emitter = new vscode.EventEmitter<TodoItem[]>();
  private rawSnapshot: Record<string, unknown> = {};
  private todos = new Map<string, TodoItem>();
  private lastActivity?: LastActivity;

  public readonly onDidChange = this.emitter.event;

  public getTodos(): TodoItem[] {
    return Array.from(this.todos.values()).sort(sortTodos);
  }

  public getTodo(id: string): TodoItem | undefined {
    return this.todos.get(id);
  }

  public getLastActivity(): LastActivity | undefined {
    return this.lastActivity;
  }

  public setSnapshot(raw: unknown): TodoChange[] {
    const nextRaw = normalizeRoot(raw);
    return this.commit(nextRaw);
  }

  public applyStreamEvent(event: FirebaseStreamEvent): TodoChange[] {
    const nextRaw = cloneRoot(this.rawSnapshot);

    if (event.event === 'put') {
      applyPut(nextRaw, event.path ?? '/', event.data);
    }

    if (event.event === 'patch') {
      applyPatch(nextRaw, event.path ?? '/', event.data);
    }

    return this.commit(nextRaw);
  }

  private commit(nextRaw: Record<string, unknown>): TodoChange[] {
    const nextTodos = toTodoMap(nextRaw);
    const changes = diffTodos(this.todos, nextTodos);

    this.rawSnapshot = nextRaw;
    this.todos = nextTodos;
    this.lastActivity = toLastActivity(nextRaw);
    this.emitter.fire(this.getTodos());

    return changes;
  }
}

function normalizeRoot(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }

  return cloneRoot(raw as Record<string, unknown>);
}

function cloneRoot(raw: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(raw));
}

function applyPut(root: Record<string, unknown>, path: string, data: unknown): void {
  if (path === '/') {
    replaceRoot(root, normalizeRoot(data));
    return;
  }

  setValue(root, path, data);
}

function applyPatch(root: Record<string, unknown>, path: string, data: unknown): void {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return;
  }

  for (const [key, value] of Object.entries(data)) {
    setValue(root, joinPath(path, key), value);
  }
}

function replaceRoot(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): void {
  for (const key of Object.keys(target)) {
    delete target[key];
  }

  for (const [key, value] of Object.entries(source)) {
    target[key] = value;
  }
}

function setValue(root: Record<string, unknown>, path: string, value: unknown): void {
  const segments = toSegments(path);
  const last = segments.pop();

  if (!last) {
    return;
  }

  const parent = getOrCreateParent(root, segments);

  if (value === null) {
    delete parent[last];
    return;
  }

  parent[last] = value;
}

function getOrCreateParent(
  root: Record<string, unknown>,
  segments: string[],
): Record<string, unknown> {
  let current = root;

  for (const segment of segments) {
    const next = current[segment];

    if (!next || typeof next !== 'object' || Array.isArray(next)) {
      current[segment] = {};
    }

    current = current[segment] as Record<string, unknown>;
  }

  return current;
}

function joinPath(basePath: string, key: string): string {
  return `${basePath.replace(/\/$/, '')}/${key}`;
}

function toSegments(path: string): string[] {
  return path.split('/').filter(Boolean);
}

function toTodoMap(raw: Record<string, unknown>): Map<string, TodoItem> {
  const todos = new Map<string, TodoItem>();

  for (const [id, value] of Object.entries(raw)) {
    if (id === '__meta' || !value || typeof value !== 'object' || Array.isArray(value)) {
      continue;
    }

    todos.set(id, normalizeTodo(id, value as TodoRecord));
  }

  return todos;
}

function toLastActivity(raw: Record<string, unknown>): LastActivity | undefined {
  const meta = raw.__meta;

  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
    return undefined;
  }

  const record = (meta as Record<string, unknown>).lastActivity;

  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return undefined;
  }

  return normalizeLastActivity(record as LastActivityRecord);
}

function normalizeTodo(id: string, record: TodoRecord): TodoItem {
  const now = Date.now();

  return {
    id,
    text: stringify(record.text, 'New note'),
    imageUrl: readOptionalString(record.imageUrl),
    completed: Boolean(record.completed),
    inProgress: Boolean(record.inProgress),
    author: stringify(record.author, 'Anonymous'),
    updatedBy: stringify(record.updatedBy, stringify(record.author, 'Anonymous')),
    createdAt: toNumber(record.createdAt, now),
    updatedAt: toNumber(record.updatedAt, now),
  };
}

function normalizeLastActivity(record: LastActivityRecord): LastActivity {
  const now = Date.now();

  return {
    type: toChangeType(record.type),
    todoId: stringify(record.todoId, ''),
    todoText: stringify(record.todoText, 'Todo'),
    deviceName: stringify(record.deviceName, 'device'),
    timestamp: toNumber(record.timestamp, now),
  };
}

function stringify(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function toNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function toChangeType(value: unknown): TodoChange['type'] {
  return ['added', 'removed', 'started', 'stopped', 'completed', 'reopened', 'updated'].includes(String(value))
    ? (value as TodoChange['type'])
    : 'updated';
}

function diffTodos(
  previous: Map<string, TodoItem>,
  next: Map<string, TodoItem>,
): TodoChange[] {
  const changes: TodoChange[] = [];

  for (const [id, before] of previous.entries()) {
    const after = next.get(id);

    if (!after) {
      changes.push({ type: 'removed', before });
      continue;
    }

    const change = detectChange(before, after);

    if (change) {
      changes.push(change);
    }
  }

  for (const [id, after] of next.entries()) {
    if (!previous.has(id)) {
      changes.push({ type: 'added', after });
    }
  }

  return changes;
}

function detectChange(before: TodoItem, after: TodoItem): TodoChange | undefined {
  if (before.completed !== after.completed) {
    return { type: after.completed ? 'completed' : 'reopened', before, after };
  }

  if (before.inProgress !== after.inProgress) {
    return { type: after.inProgress ? 'started' : 'stopped', before, after };
  }

  if (
    before.text !== after.text
    || before.imageUrl !== after.imageUrl
    || before.updatedAt !== after.updatedAt
  ) {
    return { type: 'updated', before, after };
  }

  return undefined;
}

function sortTodos(left: TodoItem, right: TodoItem): number {
  if (left.completed !== right.completed) {
    return Number(left.completed) - Number(right.completed);
  }

  if (left.inProgress !== right.inProgress) {
    return Number(right.inProgress) - Number(left.inProgress);
  }

  return right.updatedAt - left.updatedAt;
}
