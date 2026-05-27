const vscode = acquireVsCodeApi();

const fallbackMessages = {
  'webview.add': 'Add',
  'webview.addImage': 'Add image',
  'webview.cancel': 'Cancel',
  'webview.close': 'Close',
  'webview.connectionOk': 'Connection test succeeded.',
  'webview.continueEdit': 'Continue editing',
  'webview.copyRules': 'Copy rules',
  'webview.delete': 'Delete',
  'webview.edit': 'Edit',
  'webview.configureFirebase': 'Configure Firebase',
  'webview.firebaseBody': 'Paste your Firebase Realtime Database URL. If this is a new database, copy the rules below in Firebase Console first.',
  'webview.firebaseIntroBody': 'Shared Todo Taskboard needs a Realtime Database URL to sync todos. If you already have one, continue configuration.',
  'webview.firebaseIntroTitle': 'Firebase is not connected',
  'webview.firebaseRulesBody': 'Use these rules for personal/shared access without auth. Anyone with the URL can read and write.',
  'webview.firebaseRulesTitle': 'Realtime Database rules',
  'webview.firebaseTitle': 'Connect Firebase',
  'webview.firebaseUrlPlaceholder': 'https://xxxxx-default-rtdb.firebaseio.com',
  'webview.fullImageAlt': 'Full-size image',
  'webview.noProjectTitle': 'No project selected',
  'webview.noTodosBody': 'Create the first note to get started.',
  'webview.noTodosTitle': 'No todos in this project',
  'webview.openProjects': 'Open Projects',
  'webview.openSettings': 'Open Settings',
  'webview.pickProjectBody': 'Create or select a project after Firebase is connected.',
  'webview.previewAlt': 'Preview',
  'webview.progressRemove': 'Remove in-progress status',
  'webview.progressStart': 'Start working',
  'webview.removeImage': 'Remove image',
  'webview.rulesCopied': 'Rules copied.',
  'webview.saveConnect': 'Save & Connect',
  'webview.statusDone': 'Completed',
  'webview.statusIdle': 'Waiting',
  'webview.statusProgress': 'In Progress',
  'webview.testConnection': 'Test',
  'webview.todoListLabel': 'Todo list',
  'webview.todoPlaceholder': 'Write a new todo...',
  'webview.update': 'Update',
  'webview.viewImageAlt': 'Todo image',
  'error.unknown': 'An error occurred',
};

const state = {
  todos: [],
  status: { state: 'idle', message: 'Ready' },
  currentBucket: '',
  hasFirebase: false,
  hasBucket: false,
  firebaseUrl: '',
  firebaseRules: '',
  firebaseInput: '',
  firebaseInputTouched: false,
  showFirebaseConfig: false,
  locale: 'en-US',
  messages: fallbackMessages,
  error: '',
  notice: '',
  isComposerVisible: false,
  composer: {
    id: null,
    text: '',
    images: [],
    uploading: false,
  },
  pendingIds: new Set(),
};

const app = document.getElementById('app');

window.addEventListener('message', (event) => {
  const message = event.data;

  if (message.type === 'hydrate') {
    const focus = captureFocus();
    const wasUploading = state.composer.uploading;
    const composer = { ...state.composer, images: [...state.composer.images] };
    const payload = message.payload ?? {};

    Object.assign(state, payload, { error: '' });
    state.messages = { ...fallbackMessages, ...(payload.messages ?? {}) };
    state.composer = composer;
    state.composer.uploading = false;
    state.pendingIds.clear();

    if (!state.firebaseInputTouched) {
      state.firebaseInput = state.firebaseUrl || '';
    }

    if (wasUploading) {
      clearComposer();
      state.isComposerVisible = false;
    }

    render();
    restoreFocus(focus);
  }

  if (message.type === 'editTodo') {
    const todo = message.payload.todo;
    state.isComposerVisible = true;
    state.composer.id = todo.id;
    state.composer.text = todo.text;
    state.composer.images = todo.imageUrl
      ? todo.imageUrl.split(',').map((url) => ({ url }))
      : [];
    render();
    const input = app.querySelector('.composer-input');
    if (input) {
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }
  }

  if (message.type === 'notice') {
    state.notice = message.payload?.message ?? '';
    state.error = '';
    render();
  }

  if (message.type === 'error') {
    state.error = message.payload?.message ?? t('error.unknown');
    state.notice = '';
    state.composer.uploading = false;
    state.pendingIds.clear();
    render();
  }
});

function clearComposer() {
  state.composer.id = null;
  state.composer.text = '';
  state.composer.images = [];
}

render();
vscode.postMessage({ type: 'ready' });

function render() {
  app.innerHTML = `
    <div class="shell">
      ${state.error ? `<section class="message error">${escapeHtml(state.error)}</section>` : ''}
      ${state.notice ? `<section class="message notice">${escapeHtml(state.notice)}</section>` : ''}
      ${shouldShowFirebaseSetup() ? renderFirebaseSetup() : renderTodoShell()}
    </div>
  `;

  bindEvents();
}

function shouldShowFirebaseSetup() {
  return !state.hasFirebase || (state.status?.state === 'error' && !state.hasBucket);
}

function renderTodoShell() {
  return `
    ${state.hasBucket ? renderComposerToggle() : ''}
    ${state.hasBucket && state.isComposerVisible ? renderComposer() : ''}
    ${renderList()}
  `;
}

function renderFirebaseSetup() {
  if (!state.showFirebaseConfig) {
    return `
      <section class="setup">
        <div class="message-title">${t('webview.firebaseIntroTitle')}</div>
        <div class="message-body">${t('webview.firebaseIntroBody')}</div>
        <div class="setup-actions">
          <button class="link-button" data-action="showFirebaseConfig">
            <span class="codicon codicon-plug"></span>
            ${t('webview.configureFirebase')}
          </button>
          <button class="icon-button setup-icon" data-action="openSettings" title="${t('webview.openSettings')}" aria-label="${t('webview.openSettings')}">
            <span class="codicon codicon-settings-gear"></span>
          </button>
        </div>
      </section>
    `;
  }

  return `
    <section class="setup">
      <div class="message-title">${t('webview.firebaseTitle')}</div>
      <div class="message-body">${t('webview.firebaseBody')}</div>
      <input class="firebase-url-input" type="url" value="${escapeHtml(state.firebaseInput || state.firebaseUrl)}" placeholder="${t('webview.firebaseUrlPlaceholder')}" />
      <div class="setup-actions">
        <button class="link-button" data-action="saveFirebaseUrl">
          <span class="codicon codicon-plug"></span>
          ${t('webview.saveConnect')}
        </button>
        <button class="link-button" data-action="testFirebaseUrl">
          <span class="codicon codicon-debug-start"></span>
          ${t('webview.testConnection')}
        </button>
        <button class="icon-button setup-icon" data-action="openSettings" title="${t('webview.openSettings')}" aria-label="${t('webview.openSettings')}">
          <span class="codicon codicon-settings-gear"></span>
        </button>
      </div>
      <div class="rules-panel">
        <div class="rules-header">
          <div>
            <div class="rules-title">${t('webview.firebaseRulesTitle')}</div>
            <div class="rules-body">${t('webview.firebaseRulesBody')}</div>
          </div>
          <button class="icon-button setup-icon" data-action="copyFirebaseRules" title="${t('webview.copyRules')}" aria-label="${t('webview.copyRules')}">
            <span class="codicon codicon-copy"></span>
          </button>
        </div>
        <pre class="rules-code">${escapeHtml(state.firebaseRules)}</pre>
      </div>
    </section>
  `;
}

function renderComposerToggle() {
  const isEditing = Boolean(state.composer.id);
  return `
    <div class="composer-toggle">
      <button class="link-button full" data-action="toggleComposer">
        <span class="codicon codicon-${state.isComposerVisible ? 'chevron-up' : 'add'}"></span>
        ${state.isComposerVisible ? t('webview.close') : isEditing ? t('webview.continueEdit') : t('webview.add')}
      </button>
    </div>
  `;
}

function renderComposer() {
  const isUploading = state.composer.uploading;
  const isEditing = Boolean(state.composer.id);

  return `
    <section class="composer ${isUploading ? 'uploading' : ''}">
      <div class="composer-container">
        <textarea class="composer-input" placeholder="${t('webview.todoPlaceholder')}" rows="3" ${isUploading ? 'disabled' : ''}>${escapeHtml(state.composer.text)}</textarea>
        <input type="file" accept="image/*" id="imageInput" multiple ${isUploading ? 'disabled' : ''} hidden />
        <button class="composer-image-btn" title="${t('webview.addImage')}" data-action="pickImage" ${isUploading ? 'disabled' : ''}>
          <span class="codicon codicon-device-camera"></span>
        </button>
      </div>

      <div class="composer-previews">
        ${state.composer.images.map((img, index) => `
          <div class="composer-preview-container">
            <img class="composer-preview" src="${escapeHtml(img.dataUrl || img.url)}" alt="${t('webview.previewAlt')}" />
            ${!isUploading ? `<div class="composer-preview-remove" data-action="removeImage" data-index="${index}" title="${t('webview.removeImage')}">
              <span class="codicon codicon-close"></span>
            </div>` : ''}
          </div>
        `).join('')}
      </div>

      <div class="composer-actions">
        <button class="link-button" data-action="submitTodo" ${isUploading ? 'disabled' : ''}>
          ${isUploading ? '<span class="codicon codicon-loading spin"></span>' : ''}
          ${isEditing ? t('webview.update') : t('webview.add')}
        </button>
        ${isEditing && !isUploading ? `<button class="link-button" data-action="cancelEdit">${t('webview.cancel')}</button>` : ''}
      </div>
    </section>
  `;
}

function renderList() {
  if (!state.hasBucket) {
    return `
      <section class="message empty">
        <div class="message-title">${t('webview.noProjectTitle')}</div>
        <div class="message-body">${t('webview.pickProjectBody')}</div>
        <button class="link-button" data-action="openProjects">${t('webview.openProjects')}</button>
      </section>
    `;
  }

  if (!state.todos.length) {
    return `
      <section class="message empty">
        <div class="message-title">${t('webview.noTodosTitle')}</div>
        <div class="message-body">${t('webview.noTodosBody')}</div>
      </section>
    `;
  }

  return `
    <section class="todo-list" aria-label="${t('webview.todoListLabel')}">
      ${state.todos.map(renderTodo).join('')}
    </section>
  `;
}

function renderTodo(todo) {
  const updatedAt = new Date(todo.updatedAt).toLocaleString(state.locale, {
    dateStyle: 'short',
    timeStyle: 'short',
  });
  const status = todo.completed ? t('webview.statusDone') : todo.inProgress ? t('webview.statusProgress') : t('webview.statusIdle');
  const isPending = state.pendingIds.has(todo.id);
  const imageUrls = todo.imageUrl ? todo.imageUrl.split(',') : [];

  return `
    <article class="todo-row ${todo.completed ? 'completed' : ''} ${todo.inProgress ? 'in-progress' : ''} ${isPending ? 'pending' : ''}">
      <div class="todo-progress-bar"></div>
      <label class="todo-check">
        <input type="checkbox" data-id="${escapeHtml(todo.id)}" ${todo.completed ? 'checked' : ''} ${isPending ? 'disabled' : ''} />
        <span></span>
      </label>
      <div class="todo-main">
        <div class="todo-actions">
          <button class="icon-button subtle ${todo.inProgress ? 'active' : ''}" data-action="progress" data-id="${escapeHtml(todo.id)}" title="${todo.inProgress ? t('webview.progressRemove') : t('webview.progressStart')}" aria-label="${todo.inProgress ? t('webview.progressRemove') : t('webview.progressStart')}" ${isPending ? 'disabled' : ''}>
            <span class="codicon codicon-loading ${todo.inProgress || (isPending && !todo.completed) ? 'spin' : ''}"></span>
          </button>
          <button class="icon-button subtle" data-action="edit" data-id="${escapeHtml(todo.id)}" title="${t('webview.edit')}" aria-label="${t('webview.edit')}" ${isPending ? 'disabled' : ''}>
            <span class="codicon codicon-edit"></span>
          </button>
          <button class="icon-button danger subtle" data-action="delete" data-id="${escapeHtml(todo.id)}" title="${t('webview.delete')}" aria-label="${t('webview.delete')}" ${isPending ? 'disabled' : ''}>
            <span class="codicon codicon-trash"></span>
          </button>
        </div>
        <div class="todo-text">${escapeHtml(todo.text)}</div>
        ${imageUrls.length > 0 ? `
          <div class="todo-images">
            ${imageUrls.map((url) => `
              <div class="todo-image-wrapper">
                <img class="todo-image" src="${escapeHtml(url)}" alt="${t('webview.viewImageAlt')}" data-action="viewImage" data-url="${escapeHtml(url)}" />
              </div>
            `).join('')}
          </div>
        ` : ''}
        <div class="todo-meta" title="${escapeHtml(`${todo.updatedBy} - ${status} - ${updatedAt}`)}">
          <span>${escapeHtml(todo.updatedBy)}</span>
          <span>-</span>
          <span class="todo-badge ${todo.completed ? 'done' : todo.inProgress ? 'progress' : 'idle'}">${escapeHtml(status)}</span>
          <span>-</span>
          <span>${escapeHtml(updatedAt)}</span>
        </div>
      </div>
    </article>
  `;
}

function bindEvents() {
  app.querySelectorAll('input[type="checkbox"]').forEach((input) => {
    input.addEventListener('change', () => {
      const id = input.dataset.id;
      state.pendingIds.add(id);
      render();
      vscode.postMessage({
        type: 'toggleTodo',
        payload: { id, completed: input.checked },
      });
    });
  });

  const composerInput = app.querySelector('.composer-input');
  if (composerInput) {
    composerInput.addEventListener('input', () => {
      state.composer.text = composerInput.value;
    });

    composerInput.addEventListener('paste', (event) => handlePaste(event));
  }

  const firebaseInput = app.querySelector('.firebase-url-input');
  if (firebaseInput) {
    firebaseInput.addEventListener('input', () => {
      state.firebaseInput = firebaseInput.value;
      state.firebaseInputTouched = true;
      state.error = '';
      state.notice = '';
    });
  }

  const imageInput = app.querySelector('#imageInput');
  if (imageInput) {
    imageInput.addEventListener('change', async (event) => {
      const files = [...(event.target.files || [])];
      for (const file of files) {
        await attachImageFile(file);
      }
    });
  }

  app.querySelectorAll('[data-action]').forEach((button) => {
    button.addEventListener('click', () => handleAction(button));
  });
}

function handleAction(element) {
  const action = element.dataset.action;
  const id = element.dataset.id;

  if (action === 'openProjects') {
    vscode.postMessage({ type: 'openProjects' });
    return;
  }

  if (action === 'openSettings') {
    vscode.postMessage({ type: 'openSettings' });
    return;
  }

  if (action === 'copyFirebaseRules') {
    vscode.postMessage({ type: 'copyFirebaseRules' });
    return;
  }

  if (action === 'showFirebaseConfig') {
    state.showFirebaseConfig = true;
    render();
    const input = app.querySelector('.firebase-url-input');
    if (input) {
      input.focus();
    }
    return;
  }

  if (action === 'testFirebaseUrl') {
    vscode.postMessage({ type: 'testFirebaseUrl', payload: { databaseUrl: state.firebaseInput } });
    return;
  }

  if (action === 'saveFirebaseUrl') {
    vscode.postMessage({ type: 'saveFirebaseUrl', payload: { databaseUrl: state.firebaseInput } });
    return;
  }

  if (action === 'toggleComposer') {
    state.isComposerVisible = !state.isComposerVisible;
    render();
    const input = app.querySelector('.composer-input');
    if (input) {
      input.focus();
    }
    return;
  }

  if (action === 'cancelEdit') {
    clearComposer();
    state.isComposerVisible = false;
    render();
    return;
  }

  if (action === 'delete' && id) {
    state.pendingIds.add(id);
    render();
    vscode.postMessage({ type: 'deleteTodo', payload: { id } });
    return;
  }

  if (action === 'edit' && id) {
    vscode.postMessage({ type: 'editTodo', payload: { id } });
    return;
  }

  if (action === 'progress' && id) {
    const button = app.querySelector(`[data-action="progress"][data-id="${CSS.escape(id)}"]`);
    const inProgress = !button?.classList.contains('active');
    state.pendingIds.add(id);
    render();
    vscode.postMessage({ type: 'setTodoInProgress', payload: { id, inProgress } });
    return;
  }

  if (action === 'viewImage' && element.dataset.url) {
    openImageViewer(element.dataset.url);
    return;
  }

  if (action === 'pickImage') {
    app.querySelector('#imageInput')?.click();
    return;
  }

  if (action === 'removeImage') {
    const index = parseInt(element.dataset.index, 10);
    state.composer.images.splice(index, 1);
    render();
    return;
  }

  if (action === 'submitTodo') {
    state.composer.uploading = true;
    render();
    vscode.postMessage({
      type: 'createTodo',
      payload: {
        id: state.composer.id,
        text: state.composer.text,
        images: state.composer.images,
      },
    });
  }
}

function openImageViewer(url) {
  const overlay = document.createElement('div');
  overlay.className = 'image-viewer-overlay';
  overlay.innerHTML = `
    <div class="image-viewer-container">
      <div class="image-viewer-zoom-text" id="zoomText">0</div>
      <div class="image-viewer-zoom-wrapper">
        <img src="${escapeHtml(url)}" alt="${t('webview.fullImageAlt')}" id="zoomableImage" />
      </div>
      <div class="image-viewer-close">
        <span class="codicon codicon-close"></span>
      </div>
    </div>
  `;

  let scale = 1;
  let isDragging = false;
  let startX = 0;
  let startY = 0;
  let lastX = 0;
  let lastY = 0;

  const img = overlay.querySelector('#zoomableImage');
  const wrapper = overlay.querySelector('.image-viewer-zoom-wrapper');
  const container = overlay.querySelector('.image-viewer-container');
  const closeButton = overlay.querySelector('.image-viewer-close');
  const zoomText = overlay.querySelector('#zoomText');

  const updateZoomText = () => {
    const percent = Math.round((scale - 1) * 100);
    zoomText.textContent = String(Math.max(0, percent));
  };

  const updateTransform = () => {
    img.style.transform = `translate(${lastX}px, ${lastY}px) scale(${scale})`;
    wrapper.style.cursor = scale > 1 ? 'grab' : 'zoom-in';
    updateZoomText();
  };

  const onMouseMove = (event) => {
    if (!isDragging) {
      return;
    }

    lastX = event.clientX - startX;
    lastY = event.clientY - startY;
    updateTransform();
  };

  const onMouseUp = () => {
    isDragging = false;
    wrapper.style.cursor = scale > 1 ? 'grab' : 'zoom-in';
  };

  const onKeyDown = (event) => {
    if (event.key === 'Escape') {
      cleanup();
    }
  };

  const cleanup = () => {
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
    window.removeEventListener('keydown', onKeyDown);
    overlay.remove();
  };

  container.addEventListener('click', (event) => {
    event.stopPropagation();
  });

  closeButton.addEventListener('click', (event) => {
    event.stopPropagation();
    cleanup();
  });

  wrapper.addEventListener('mousedown', (event) => {
    if (scale <= 1) {
      return;
    }

    isDragging = true;
    startX = event.clientX - lastX;
    startY = event.clientY - lastY;
    wrapper.style.cursor = 'grabbing';
    event.preventDefault();
  });

  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);

  wrapper.addEventListener('wheel', (event) => {
    event.preventDefault();
    const delta = event.deltaY < 0 ? 0.1 : -0.1;
    scale = Math.min(Math.max(scale + delta, 1), 2);

    if (scale === 1) {
      lastX = 0;
      lastY = 0;
    }

    updateTransform();
  }, { passive: false });

  window.addEventListener('keydown', onKeyDown);
  overlay.addEventListener('click', cleanup);
  document.body.appendChild(overlay);
  updateTransform();
}

async function handlePaste(event) {
  const files = [...(event.clipboardData?.files ?? [])].filter((item) => item.type.startsWith('image/'));
  if (files.length === 0) {
    return;
  }

  event.preventDefault();
  for (const file of files) {
    await attachImageFile(file);
  }
}

async function attachImageFile(file) {
  const dataUrl = await readFileAsDataUrl(file);
  state.composer.images.push({
    dataUrl,
    name: file.name || 'pasted-image.png',
  });
  render();
  const input = app.querySelector('.composer-input');
  if (input) {
    input.focus();
  }
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Image could not be read'));
    reader.readAsDataURL(file);
  });
}

function captureFocus() {
  const element = document.activeElement;

  if (!element || !(element.classList?.contains('composer-input') || element.classList?.contains('firebase-url-input'))) {
    return undefined;
  }

  return {
    selector: element.classList.contains('composer-input') ? '.composer-input' : '.firebase-url-input',
    start: element.selectionStart ?? 0,
    end: element.selectionEnd ?? 0,
  };
}

function restoreFocus(focus) {
  if (!focus) {
    return;
  }

  const element = app.querySelector(focus.selector);

  if (!element) {
    return;
  }

  element.focus();
  if (typeof element.setSelectionRange === 'function') {
    element.setSelectionRange(focus.start, focus.end);
  }
}

function t(key) {
  return state.messages[key] ?? fallbackMessages[key] ?? key;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
