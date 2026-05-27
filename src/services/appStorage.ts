import * as vscode from 'vscode';
import { CURRENT_BUCKET_KEY } from '../constants';

export class AppStorage {
  public constructor(private readonly state: vscode.Memento) {}

  public getCurrentBucket(): string {
    return this.state.get<string>(CURRENT_BUCKET_KEY, '').trim();
  }

  public async setCurrentBucket(bucketId: string): Promise<void> {
    await this.state.update(CURRENT_BUCKET_KEY, bucketId.trim());
  }

  public async clearCurrentBucket(): Promise<void> {
    await this.state.update(CURRENT_BUCKET_KEY, undefined);
  }
}
