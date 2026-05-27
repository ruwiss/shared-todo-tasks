<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=Ruwiss.shared-todo-taskboard">
    <img src="media/icon.png" width="150" alt="Shared Todo Taskboard logo" />
  </a>
</p>

<h1 align="center">Shared Todo Taskboard</h1>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=Ruwiss.shared-todo-taskboard">
    <img src="https://img.shields.io/badge/VS%20Marketplace-Install-007ACC?logo=visualstudiocode&logoColor=white" alt="Install from VS Marketplace" />
  </a>
  <a href="https://marketplace.visualstudio.com/items?itemName=Ruwiss.shared-todo-taskboard">
    <img src="https://img.shields.io/badge/VS%20Code-Extension-007ACC?logo=visualstudiocode&logoColor=white" alt="VS Code extension" />
  </a>
  <a href="https://marketplace.visualstudio.com/items?itemName=Ruwiss.shared-todo-taskboard">
    <img src="https://img.shields.io/badge/Realtime-Todo%20Sync-10B981" alt="Realtime todo sync" />
  </a>
</p>

Shared Todo Taskboard is a lightweight VS Code extension for keeping a shared realtime todo list inside your editor.

## Features

- Shared todo lists with realtime sync
- Multiple projects or task buckets
- Add, edit, start, complete, reopen, and delete todos
- Paste or attach images to todos
- See who last changed a task and when
- Optional desktop notifications and action sounds
- Built-in language support for English, Turkish, Spanish, German, and French

## First Setup

Open the **Shared Todo Taskboard** activity bar icon.

If sync is not configured yet, the Overview view shows a short setup message and a **Configure Firebase** button. Click it and follow the guided steps:

1. Create or open a Firebase project.
2. Enable Realtime Database.
3. Copy the provided database rules into Realtime Database Rules.
4. Paste your Realtime Database URL into Shared Todo Taskboard.

After the connection test passes, create or select a project and start adding todos.

## Usage

- Use **Overview** to check the active project, connection status, todo count, and last activity.
- Use **Todo List** to add and manage todos.
- Use **Projects** to switch between shared task buckets.
- Use the row actions to mark a todo in progress, complete it, edit it, or delete it.
- Run **Shared Todo Taskboard: Select Sound** to choose the bundled XP sound, disable sound, or pick a local `.mp3`/`.wav` file for one action or all actions.
- Open extension settings to change language, device name, notifications, and advanced per-action sound values.

## Settings

- **Language**: choose English, Turkish, Spanish, German, or French.
- **Device name**: customize the name shown in shared activity.
- **Notifications**: enable or disable notification popups and sounds.
- **Sounds**: use **Shared Todo Taskboard: Select Sound** for file picking, or set `builtin:xp`, `none`, or an absolute custom audio path.

## Notes

Shared Todo Taskboard is intended for small shared workspaces, friends, and personal team workflows where everyone uses the same Realtime Database URL.
