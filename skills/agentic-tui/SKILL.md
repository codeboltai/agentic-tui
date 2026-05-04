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
3. Send keyboard, text, or terminal mouse-wheel input.
4. Wait for text or stability.
5. Repeat until complete.
6. Clean up the session.

## Setup

- Plain text output is fine for most observe/act loops.
- Add `--json` when you need structured metadata such as session ids, cursor coordinates, match rows/cols, or saved file details.
- Start the daemon explicitly when shell selection matters:
  - Windows PowerShell: `agentic-tui daemon start --shell powershell.exe`
  - PowerShell Core: `agentic-tui daemon start --shell pwsh`
  - Windows cmd: `agentic-tui daemon start --shell cmd.exe`
  - Unix shell: `agentic-tui daemon start --shell bash`
- On Windows, the default PTY backend is `winpty` because it passes raw terminal input sequences more reliably for TUI automation. Set `AGENTIC_TUI_WINDOWS_PTY=conpty` only when you specifically need ConPTY behavior.
- If state directory access is restricted, set `AGENTIC_TUI_STATE_DIR` to a writable directory.

## Core Workflow

```bash
agentic-tui daemon start --shell powershell.exe
agentic-tui run <command> [...args]
agentic-tui screen
agentic-tui press Enter
agentic-tui wheel down 3
agentic-tui wait --stable
agentic-tui screen
agentic-tui kill
```

Rules:

- Re-observe after every action that can change the UI.
- Use `wait --stable` before interpreting full-screen TUIs or prompts.
- Use `--session <id>` when more than one session exists.
- End sessions with `kill` or clean all sessions with `sessions cleanup --all`.

## Choosing The Read Mode

- Regular commands: `agentic-tui output --mode streaming`
  - Use for `npm`, `git`, `ls`, compilers, tests, and commands that print sequential logs.
  - Streaming output clears after read.
- Live-updating commands: `agentic-tui output --mode snapshot`
  - Use for raw recent output from progress or monitor-style commands.
  - Snapshot output does not clear.
- TUI apps and prompts: `agentic-tui screen`
  - Use for menus, editors, forms, full-screen apps, alternate-screen apps, and visual prompts.
  - This returns the rendered text grid.

## Common Actions

Run:

```bash
agentic-tui run npm install
agentic-tui run htop --cols 120 --rows 40
agentic-tui run --cwd <dir> <command> [...args]
```

Type and submit:

```bash
agentic-tui type "hello world"
agentic-tui press Enter
```

Navigate:

```bash
agentic-tui press ArrowDown ArrowDown Enter
agentic-tui scroll down 5
agentic-tui wheel down 3
agentic-tui scroll down 3 --row 12 --col 40
agentic-tui scroll down 3 --keys
agentic-tui press Tab
agentic-tui press Escape
agentic-tui press Ctrl+C
```

Scrolling guidance:

- Use `scroll up|down|left|right [amount]` for terminal mouse-wheel events.
- `wheel up|down|left|right [amount]` is an explicit alias for the same wheel-event path.
- Use `scroll --keys` only when the app expects repeated arrow keys rather than wheel input.
- Add `--row N --col N` when the app scrolls only under the pointer or has multiple panes.
- Use `--protocol sgr` only when auto detection fails; modern TUIs usually request SGR mouse mode automatically.

Resize:

```bash
agentic-tui resize --cols 120 --rows 40
```

Wait:

```bash
agentic-tui wait "Done" --timeout 30000
agentic-tui wait "Loading" --gone --timeout 60000
agentic-tui wait --stable --timeout 5000
```

Inspect:

```bash
agentic-tui search "Continue"
agentic-tui search "error|failed" --regex
agentic-tui region --row 5 --col 0 --rows 10 --cols 80 --trim
agentic-tui cursor
```

Save screenshots:

```bash
agentic-tui screen --out screen.txt --format text
agentic-tui screen --out screen.json --format json
agentic-tui screen --out screen.png --format png
```

## Reliability Rules

- Do not rely on old screenshots after input. Always call `screen` again.
- Do not use `streaming` to inspect full-screen TUIs; use `screen`.
- Use `search` before complex coordinate assumptions.
- Use `region` for tables, menus, status bars, and focused extraction.
- Use `--out` to save evidence or reports. Prefer text for quick inspection, JSON for metadata, and PNG for human visual review.
- Resize early to make layouts deterministic.
- If a wait times out, capture `screen` before deciding the next action.
- For short-lived commands, it is still valid to read `output` or `screen` after the process exits.

## Session Handling

List sessions:

```bash
agentic-tui sessions list
```

Use a specific session:

```bash
agentic-tui --session <id> screen
agentic-tui --session <id> press Enter
```

Switch active session:

```bash
agentic-tui sessions switch <id>
```

Clean up:

```bash
agentic-tui kill
agentic-tui sessions cleanup --all
agentic-tui daemon stop
```

## Error Recovery

- `DAEMON_NOT_RUNNING`: run `agentic-tui daemon start --shell <shell>`.
- `NO_SESSION`: run a command or inspect `agentic-tui sessions list`.
- `SESSION_EXITED`: inspect with `output`, `screen`, `search`, or `region`; start a new session if more input is required.
- `INVALID_KEY`: use supported names like `Enter`, `Tab`, `Escape`, arrows, `F1`-`F12`, `Ctrl+C`.
- Timeout from `wait`: capture `screen`, then decide whether to wait longer, search for alternate text, or send a corrective key.

## Minimal Examples

Interactive prompt:

```bash
agentic-tui run npm init
agentic-tui wait --stable
agentic-tui screen
agentic-tui type "my-package"
agentic-tui press Enter
agentic-tui wait --stable
agentic-tui screen
```

Full-screen TUI:

```bash
agentic-tui run htop --cols 120 --rows 40
agentic-tui wait --stable --timeout 3000
agentic-tui screen
agentic-tui search "CPU"
agentic-tui press F10
agentic-tui kill
```

Regular command:

```bash
agentic-tui run npm test
agentic-tui output --mode streaming --wait-for-idle 1000
```
