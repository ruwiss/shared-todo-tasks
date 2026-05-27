export const BUCKETS_ROOT_PATH = 'shared-todo-tasks/buckets';
export const CONNECTION_TEST_PATH = 'shared-todo-tasks/__connectionTest';
export const CURRENT_BUCKET_KEY = 'sharedTodoTasks.currentBucket';
export const MAX_BUCKET_NAME_LENGTH = 40;
export const FIREBASE_RULES_TEMPLATE = `{
  "rules": {
    "shared-todo-tasks": {
      ".read": true,
      ".write": true
    }
  }
}`;
