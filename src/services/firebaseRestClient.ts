import * as http from 'node:http';
import * as https from 'node:https';
import * as vscode from 'vscode';
import { FirebaseStreamEvent, LastActivity, TodoChangeType, TodoItem } from '../models';
import { buildFirebaseUrl } from '../utils/firebasePath';

interface StreamHandlers {
  onOpen: () => void;
  onEvent: (event: FirebaseStreamEvent) => void;
  onError: (error: Error) => void;
  onClose: () => void;
}

interface CreateTodoInput {
  text: string;
  imageUrl?: string;
  author: string;
  updatedBy: string;
  completed: boolean;
  inProgress: boolean;
  createdAt: number;
  updatedAt: number;
}

interface UpdateTodoInput {
  text?: string;
  imageUrl?: string;
  completed?: boolean;
  inProgress?: boolean;
  updatedBy: string;
  updatedAt: number;
}

interface MetaPayload {
  __meta: {
    lastActivity: LastActivity;
    updatedAt: number;
  };
}

const STREAM_SOCKET_TIMEOUT = 75_000;

export class FirebaseRestClient {
  public constructor(
    private readonly databaseUrl: string,
    private readonly basePath: string,
  ) {}

  public async getRoot(): Promise<unknown> {
    return this.requestJson(this.buildUrl());
  }

  public async createTodoWithActivity(
    id: string,
    input: CreateTodoInput,
    activity: LastActivity,
  ): Promise<void> {
    await this.patchRoot({
      [id]: input,
      ...toMetaPayload(activity),
    });
  }

  public async replaceTodoWithActivity(
    id: string,
    input: CreateTodoInput,
    activity: LastActivity,
  ): Promise<void> {
    await this.patchRoot({
      [id]: input,
      ...toMetaPayload(activity),
    });
  }

  public async deleteTodoWithActivity(id: string, activity: LastActivity): Promise<void> {
    await this.patchRoot({
      [id]: null,
      ...toMetaPayload(activity),
    });
  }

  public async patchRoot(data: unknown): Promise<void> {
    await this.requestJson(this.buildUrl(), {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  public async putRoot(data: unknown): Promise<void> {
    await this.requestJson(this.buildUrl(), {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  public async putChild(id: string, data: unknown): Promise<void> {
    await this.requestJson(this.buildUrl(id), {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  public stream(handlers: StreamHandlers): vscode.Disposable {
    const url = new URL(this.buildUrl());
    const transport = url.protocol === 'https:' ? https : http;

    const request = transport.request(url, {
      method: 'GET',
      headers: {
        Accept: 'text/event-stream',
        'Cache-Control': 'no-cache',
      },
    });

    request.setTimeout(STREAM_SOCKET_TIMEOUT, () => {
      request.destroy(new Error('Firebase stream timed out'));
    });

    request.on('response', (response) => {
      this.attachStreamListeners(response, handlers);
    });

    request.on('error', (error) => {
      handlers.onError(error instanceof Error ? error : new Error(String(error)));
    });

    request.end();

    return new vscode.Disposable(() => {
      request.destroy();
    });
  }

  private attachStreamListeners(
    response: http.IncomingMessage,
    handlers: StreamHandlers,
  ): void {
    response.setEncoding('utf8');

    if ((response.statusCode ?? 500) >= 400) {
      handlers.onError(new Error(`Firebase stream failed with ${response.statusCode}`));
      response.resume();
      return;
    }

    handlers.onOpen();

    let buffer = '';
    let closed = false;
    const notifyClose = (): void => {
      if (closed) {
        return;
      }

      closed = true;
      handlers.onClose();
    };

    response.on('data', (chunk) => {
      buffer += chunk;
      buffer = consumeMessages(buffer, handlers.onEvent);
    });

    response.on('error', (error) => {
      handlers.onError(error instanceof Error ? error : new Error(String(error)));
    });

    response.on('end', notifyClose);
    response.on('close', notifyClose);
  }

  private async requestJson<T = unknown>(
    url: string,
    init?: RequestInit,
  ): Promise<T> {
    const response = await fetch(url, {
      headers: { 'Content-Type': 'application/json' },
      ...init,
    });

    if (!response.ok) {
      throw new Error(`Firebase request failed with ${response.status}`);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return (await response.json()) as T;
  }

  private buildUrl(id?: string): string {
    return buildFirebaseUrl(this.databaseUrl, this.basePath, ...(id ? [id] : []));
  }
}

function consumeMessages(
  buffer: string,
  onEvent: (event: FirebaseStreamEvent) => void,
): string {
  const messages = buffer.split('\n\n');
  const remainder = messages.pop() ?? '';

  for (const message of messages) {
    const parsed = parseMessage(message);

    if (parsed) {
      onEvent(parsed);
    }
  }

  return remainder;
}

function parseMessage(message: string): FirebaseStreamEvent | undefined {
  let eventName = 'put';
  const dataLines: string[] = [];

  for (const line of message.split(/\r?\n/)) {
    if (line.startsWith('event:')) {
      eventName = line.slice(6).trim();
    }

    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trim());
    }
  }

  if (eventName === 'keep-alive') {
    return { event: 'keep-alive' };
  }

  if (!isKnownEvent(eventName) || !dataLines.length) {
    return undefined;
  }

  try {
    const payload = JSON.parse(dataLines.join('\n')) as {
      path?: string;
      data?: unknown;
    };

    return {
      event: eventName,
      path: payload.path,
      data: payload.data,
    };
  } catch {
    return undefined;
  }
}

function isKnownEvent(eventName: string): eventName is FirebaseStreamEvent['event'] {
  return ['put', 'patch', 'keep-alive', 'cancel', 'auth_revoked'].includes(eventName);
}

function toMetaPayload(activity: LastActivity): MetaPayload {
  return {
    __meta: {
      lastActivity: activity,
      updatedAt: activity.timestamp,
    },
  };
}

export function createTodoPayload(
  text: string,
  deviceName: string,
  imageUrl?: string,
): CreateTodoInput {
  const timestamp = Date.now();

  return {
    text,
    imageUrl,
    author: deviceName,
    updatedBy: deviceName,
    completed: false,
    inProgress: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function createReplaceTodoPayload(
  todo: TodoItem,
  deviceName: string,
  changes: Partial<Pick<TodoItem, 'text' | 'imageUrl' | 'completed' | 'inProgress'>>,
): CreateTodoInput {
  return {
    text: changes.text ?? todo.text,
    imageUrl: changes.imageUrl ?? todo.imageUrl,
    completed: changes.completed ?? todo.completed,
    inProgress: changes.inProgress ?? todo.inProgress,
    author: todo.author,
    updatedBy: deviceName,
    createdAt: todo.createdAt,
    updatedAt: Date.now(),
  };
}

export function createLastActivityPayload(
  type: TodoChangeType,
  deviceName: string,
  todoId: string,
  todoText: string,
): LastActivity {
  return {
    type,
    todoId,
    todoText,
    deviceName,
    timestamp: Date.now(),
  };
}

const PUSH_CHARS = '-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz';
let lastPushTime = 0;
let lastRandomChars: number[] = [];

export function generatePushId(): string {
  let now = Date.now();
  const duplicateTime = now === lastPushTime;
  lastPushTime = now;

  const timeStampChars = new Array<string>(8);

  for (let index = 7; index >= 0; index -= 1) {
    timeStampChars[index] = PUSH_CHARS.charAt(now % 64);
    now = Math.floor(now / 64);
  }

  if (!duplicateTime) {
    lastRandomChars = Array.from({ length: 12 }, () => Math.floor(Math.random() * 64));
  } else {
    for (let index = 11; index >= 0; index -= 1) {
      if (lastRandomChars[index] === 63) {
        lastRandomChars[index] = 0;
        continue;
      }

      lastRandomChars[index] += 1;
      break;
    }
  }

  const randomChars = lastRandomChars.map((value) => PUSH_CHARS.charAt(value)).join('');
  return `${timeStampChars.join('')}${randomChars}`;
}
