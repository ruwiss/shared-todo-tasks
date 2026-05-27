import * as vscode from 'vscode';
import { resolveLanguage } from './localization';
import { SharedTodoTasksConfig, TodoChangeType } from './models';
import { resolveDeviceName, sanitizeDeviceName } from './utils/deviceName';
import { normalizeFirebaseDatabaseUrl } from './utils/firebaseUrl';

const SOUND_TYPES: TodoChangeType[] = [
  'added',
  'removed',
  'started',
  'stopped',
  'completed',
  'reopened',
  'updated',
];

export function getConfig(): SharedTodoTasksConfig {
  const config = vscode.workspace.getConfiguration('sharedTodoTasks');
  const customDeviceName = config.get<string>('identity.deviceName', '');
  const languageSetting = config.get<string>('language', 'en');

  return {
    databaseUrl: normalizeFirebaseDatabaseUrl(config.get<string>('firebase.databaseUrl', '')),
    deviceName: resolveDeviceName(customDeviceName),
    customDeviceName: sanitizeDeviceName(customDeviceName),
    language: resolveLanguage(languageSetting),
    languageSetting,
    notificationsEnabled: config.get<boolean>('notifications.enabled', true),
    sounds: Object.fromEntries(
      SOUND_TYPES.map((type) => [
        type,
        normalizeSoundSetting(config.get<string>(`sounds.${type}`, 'builtin:xp')),
      ]),
    ) as Record<TodoChangeType, string>,
  };
}

function normalizeSoundSetting(value: string): string {
  const trimmed = value.trim();
  return trimmed || 'builtin:xp';
}
