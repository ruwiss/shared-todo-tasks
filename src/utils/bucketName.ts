import { MAX_BUCKET_NAME_LENGTH } from '../constants';

export function sanitizeBucketName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9-_\s]+/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_BUCKET_NAME_LENGTH);
}
