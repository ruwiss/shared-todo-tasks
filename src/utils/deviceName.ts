import * as os from 'node:os';

const MAX_DEVICE_NAME_LENGTH = 15;

export function resolveDeviceName(customName?: string): string {
  const sanitized = sanitizeDeviceName(customName ?? '');

  if (sanitized) {
    return sanitized;
  }

  return sanitizeDeviceName(os.hostname()) || 'device';
}

export function sanitizeDeviceName(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_DEVICE_NAME_LENGTH);
}
