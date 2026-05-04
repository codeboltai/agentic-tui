---
name: agentic-tui
description: >
  Use agentic-tui to run, inspect, and control terminal or TUI applications through CLI commands.
  Use when testing interactive CLIs, prompts, REPLs, setup wizards, full-screen terminal apps, or when an agent needs screenshots of terminal state.
  Do not use for web browsers, desktop GUI apps, MCP servers, or non-terminal interfaces.
---

# agentic-tui

## Purpose

Drive terminal applications through an observe/act loop:

1. Run the app in a persistent PTY session.
2. Observe output or rendered screen state.
3. Send keyboard/text input.
4. Wait for text or stability.
5. Repeat until complete.
6. Clean up the session.

## Setup

- Prefer JSON for agent workflows: add `--json`.
- Start the daemon explicitly when shell selection matters:
  - Windows PowerShell: `agentic-tui daemon start --shell powershell.exe`
  - PowerShell Core: `agentic-tui daemon start --shell pwsh`
  - Windows cmd: `agentic-tui daemon start --shell cmd.exe`
  - Unix shell: `agentic-tui daemon start --shell bash`
- If state directory access is restricted, set `AGENTIC_TUI_STATE_DIR` to a writable directory.

## Core Workflow

```bash
agentic-tui daemon start --shell powershell.exe --json
agentic-tui run <command> [...args] --json
agentic-tui screen --json
agentic-tui press Enter --json
agentic-tui wait --stable --json
agentic-tui screen --json
agentic-tui kill --json
```

Rules:

- Re-observe after every action that can change the UI.
- Use `wait --stable` before interpreting full-screen TUIs or prompts.
- Use `--session <id>` when more than one session exists.
- End sessions with `kill` or clean all sessions with `sessions cleanup --all`.

## Choosing The Read Mode

- Regular commands: `agentic-tui output --mode streaming --json`
  - Use for `npm`, `git`, `ls`, compilers, tests, and commands that print sequential logs.
  - Streaming output clears after read.
- Live-updating commands: `agentic-tui output --mode snapshot --json`
  - Use for raw recent output from progress or monitor-style commands.
  - Snapshot output does not clear.
- TUI apps and prompts: `agentic-tui screen --json`
  - Use for menus, editors, forms, full-screen apps, alternate-screen apps, and visual prompts.
  - This returns the rendered text grid.

## Common Actions

Run:

```bash
agentic-tui run npm install --json
agentic-tui run htop --cols 120 --rows 40 --json
agentic-tui run --cwd <dir> <command> [...args] --json
```

Type and submit:

```bash
agentic-tui type "hello world" --json
agentic-tui press Enter --json
```

Navigate:

```bash
agentic-tui press ArrowDown ArrowDown Enter --json
agentic-tui scroll down 5 --json
agentic-tui press Tab --json
agentic-tui press Escape --json
agentic-tui press Ctrl+C --json
```

Resize:

```bash
agentic-tui resize --cols 120 --rows 40 --json
```

Wait:

```bash
agentic-tui wait "Done" --timeout 30000 --json
agentic-tui wait "Loading" --gone --timeout 60000 --json
agentic-tui wait --stable --timeout 5000 --json
```

Inspect:

```bash
agentic-tui search "Continue" --json
agentic-tui search "error|failed" --regex --json
agentic-tui region --row 5 --col 0 --rows 10 --cols 80 --trim --json
agentic-tui cursor --json
```

## Reliability Rules

- Do not rely on old screenshots after input. Always call `screen --json` again.
- Do not use `streaming` to inspect full-screen TUIs; use `screen`.
- Use `search` before complex coordinate assumptions.
- Use `region` for tables, menus, status bars, and focused extraction.
- Resize early to make layouts deterministic.
- If a wait times out, capture `screen --json` before deciding the next action.
- For short-lived commands, it is still valid to read `output` or `screen` after the process exits.

## Session Handling

List sessions:

```bash
agentic-tui sessions list --json
```

Use a specific session:

```bash
agentic-tui --session <id> screen --json
agentic-tui --session <id> press Enter --json
```

Switch active session:

```bash
agentic-tui sessions switch <id> --json
```

Clean up:

```bash
agentic-tui kill --json
agentic-tui sessions cleanup --all --json
agentic-tui daemon stop --json
```

## Error Recovery

- `DAEMON_NOT_RUNNING`: run `agentic-tui daemon start --shell <shell>`.
- `NO_SESSION`: run a command or inspect `agentic-tui sessions list --json`.
- `SESSION_EXITED`: inspect with `output`, `screen`, `search`, or `region`; start a new session if more input is required.
- `INVALID_KEY`: use supported names like `Enter`, `Tab`, `Escape`, arrows, `F1`-`F12`, `Ctrl+C`.
- Timeout from `wait`: capture `screen --json`, then decide whether to wait longer, search for alternate text, or send a corrective key.

## Minimal Examples

Interactive prompt:

```bash
agentic-tui run npm init --json
agentic-tui wait --stable --json
agentic-tui screen --json
agentic-tui type "my-package" --json
agentic-tui press Enter --json
agentic-tui wait --stable --json
agentic-tui screen --json
```

Full-screen TUI:

```bash
agentic-tui run htop --cols 120 --rows 40 --json
agentic-tui wait --stable --timeout 3000 --json
agentic-tui screen --json
agentic-tui search "CPU" --json
agentic-tui press F10 --json
agentic-tui kill --json
```

Regular command:

```bash
agentic-tui run npm test --json
agentic-tui output --mode streaming --wait-for-idle 1000 --json
```
