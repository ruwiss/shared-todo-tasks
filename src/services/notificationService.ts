import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import * as vscode from 'vscode';
import { translate } from '../localization';
import { SharedTodoTasksConfig, TodoChange, TodoChangeType } from '../models';

type TranslationKey = Parameters<typeof translate>[1];
export type SoundPlaybackResult = 'played' | 'silent' | 'missing' | 'failed';

const SUMMARY_KEYS: Record<TodoChangeType, TranslationKey> = {
  added: 'notification.summary.added',
  removed: 'notification.summary.removed',
  started: 'notification.summary.started',
  stopped: 'notification.summary.stopped',
  completed: 'notification.summary.completed',
  reopened: 'notification.summary.reopened',
  updated: 'notification.summary.updated',
};

const SINGLE_KEYS: Record<TodoChangeType, TranslationKey> = {
  added: 'notification.added',
  removed: 'notification.removed',
  started: 'notification.started',
  stopped: 'notification.stopped',
  completed: 'notification.completed',
  reopened: 'notification.reopened',
  updated: 'notification.updated',
};

export class NotificationService {
  public constructor(private readonly soundsDirectory: string) {}

  public play(type: TodoChangeType, config: SharedTodoTasksConfig): SoundPlaybackResult {
    if (!config.notificationsEnabled) {
      return 'silent';
    }

    return this.playSetting(config.sounds[type]);
  }

  public playSetting(setting: string): SoundPlaybackResult {
    return this.playSound(setting);
  }

  public async notify(
    changes: TodoChange[],
    config: SharedTodoTasksConfig,
    showToast = true,
    playSound = true,
  ): Promise<void> {
    if (!changes.length || !config.notificationsEnabled) {
      return;
    }

    if (playSound) {
      this.playSetting(config.sounds[changes[0].type]);
    }

    if (!showToast) {
      return;
    }

    const message = formatMessage(changes, config);
    void vscode.window.showInformationMessage(message);
  }

  private playSound(setting: string): SoundPlaybackResult {
    const filePath = resolveSoundPath(setting, this.soundsDirectory);

    if (!filePath) {
      return 'silent';
    }

    if (!existsSync(filePath)) {
      return 'missing';
    }

    const platform = process.platform;

    if (platform === 'darwin') {
      return runBackground('afplay', [filePath]) ? 'played' : 'failed';
    }

    if (platform === 'win32') {
      return runBackground('powershell', [
        '-NoProfile',
        '-STA',
        '-Command',
        [
          'Add-Type -AssemblyName PresentationCore;',
          `$file = '${escapePowerShell(filePath)}';`,
          '$player = New-Object System.Windows.Media.MediaPlayer;',
          '$player.Open((New-Object System.Uri($file)));',
          'for ($i = 0; $i -lt 20 -and -not $player.NaturalDuration.HasTimeSpan; $i++) { Start-Sleep -Milliseconds 100; }',
          '$player.Volume = 1.0;',
          '$player.Play();',
          '$duration = 2200;',
          'if ($player.NaturalDuration.HasTimeSpan) { $duration = [int][Math]::Min([Math]::Max($player.NaturalDuration.TimeSpan.TotalMilliseconds + 500, 1200), 6000); }',
          'Start-Sleep -Milliseconds $duration;',
          '$player.Close();',
        ].join(' '),
      ]) ? 'played' : 'failed';
    }

    return runBackground('sh', [
      '-c',
      [
        `if command -v ffplay >/dev/null 2>&1; then ffplay -nodisp -autoexit -loglevel quiet '${escapeShell(filePath)}' >/dev/null 2>&1;`,
        `elif command -v mpv >/dev/null 2>&1; then mpv --no-video --really-quiet '${escapeShell(filePath)}' >/dev/null 2>&1;`,
        `elif command -v mpg123 >/dev/null 2>&1; then mpg123 -q '${escapeShell(filePath)}' >/dev/null 2>&1;`,
        `elif command -v mpg321 >/dev/null 2>&1; then mpg321 -q '${escapeShell(filePath)}' >/dev/null 2>&1;`,
        `elif command -v cvlc >/dev/null 2>&1; then cvlc --intf dummy --play-and-exit '${escapeShell(filePath)}' >/dev/null 2>&1;`,
        `elif command -v vlc >/dev/null 2>&1; then vlc --intf dummy --play-and-exit '${escapeShell(filePath)}' >/dev/null 2>&1;`,
        `elif command -v play >/dev/null 2>&1; then play -q '${escapeShell(filePath)}' >/dev/null 2>&1;`,
        `else printf '\\a'; fi`,
      ].join(' '),
    ]) ? 'played' : 'failed';
  }
}

function resolveSoundPath(setting: string, soundsDirectory: string): string | undefined {
  const value = setting.trim();
  const normalized = value.toLowerCase();

  if (!value || normalized === 'builtin:xp' || normalized === 'xp' || normalized === 'default') {
    return path.join(soundsDirectory, 'xp.mp3');
  }

  if (normalized === 'none' || normalized === 'off' || normalized === 'silent') {
    return undefined;
  }

  return value;
}

function formatMessage(changes: TodoChange[], config: SharedTodoTasksConfig): string {
  if (changes.length === 1) {
    return formatSingle(changes[0], config);
  }

  const parts = (Object.keys(SUMMARY_KEYS) as TodoChangeType[])
    .map((type) => {
      const total = count(changes, type);
      return total ? translate(config.language, SUMMARY_KEYS[type], { count: total }) : '';
    })
    .filter(Boolean);

  return translate(config.language, 'notification.summary', { parts: parts.join(', ') });
}

function formatSingle(change: TodoChange, config: SharedTodoTasksConfig): string {
  const todo = change.after ?? change.before;
  const text = todo?.text ?? 'Todo';
  const actor = change.after?.updatedBy
    ?? change.after?.author
    ?? translate(config.language, 'todo.unknownAuthor');

  return translate(config.language, SINGLE_KEYS[change.type], { actor, text });
}

function count(changes: TodoChange[], type: TodoChange['type']): number {
  return changes.filter((change) => change.type === type).length;
}

function runBackground(command: string, args: string[]): boolean {
  try {
    const child = spawn(command, args, {
      detached: false,
      stdio: 'ignore',
    });

    child.on('error', () => undefined);
    child.unref();
    return true;
  } catch {
    return false;
  }
}

function escapeShell(value: string): string {
  return value.replaceAll("'", "'\\''");
}

function escapePowerShell(value: string): string {
  return value.replaceAll("'", "''");
}
