# agentic-tui

`agentic-tui` is a Node.js CLI for AI agents to run, inspect, and control terminal and TUI applications.

It keeps real PTY sessions alive in a local daemon, feeds terminal output through `@xterm/headless`, and exposes simple CLI commands for reading output, capturing the rendered screen, sending keys, waiting for UI states, and managing sessions.

There is no MCP server and no web UI. The interface is intentionally CLI-first so agents can iterate with shell commands.

## What It Is For

- Running interactive CLIs such as package generators, installers, REPLs, prompts, and setup wizards.
- Testing full-screen TUI applications such as `htop`, `top`, `vim`, `nano`, `lazygit`, or terminal menus.
- Capturing text-grid screenshots of what a human would see in the terminal.
- Sending repeatable keyboard input to drive interactive flows.
- Giving AI agents either simple text output or structured JSON when metadata is useful.

## How It Works

`agentic-tui` has two parts:

- CLI client: commands like `run`, `screen`, `press`, `wait`, and `kill`.
- Local daemon: a background Node process that owns PTY sessions and keeps them alive between CLI calls.

The daemon listens only on `127.0.0.1` and stores a local token in the runtime state directory. CLI calls read that state and communicate with the daemon over local HTTP JSON RPC.

Terminal sessions are powered by:

- `node-pty`: spawns and controls real pseudo-terminal sessions.
- `@xterm/headless`: renders ANSI output into a terminal buffer for `screen`, `region`, `cursor`, and `search`.
- `@napi-rs/canvas`: renders text-grid screenshots to PNG using cross-platform native prebuilds.

## Install

Global install:

```bash
npm i -g @codebolt/agentic-tui
agentic-tui --help
```

Local development:

```bash
npm install
npm run build
```

Run locally from the project:

```bash
node dist/src/cli.js --help
```

After global installation, the package name is scoped but the executable is still:

```bash
agentic-tui --help
```

Optional local development link:

```bash
npm link
agentic-tui --help
```

## Quick Start

```bash
# Start the daemon. On Windows, choose PowerShell or cmd explicitly if desired.
agentic-tui daemon start --shell powershell.exe

# Run a command or TUI application.
agentic-tui run npm install
agentic-tui run htop

# Capture what is visible.
agentic-tui screen
agentic-tui screenshot
agentic-tui screenshot --out screen.png --format png

# Read raw command output since the last read.
agentic-tui output --mode streaming
agentic-tui output --mode screen --out screen.json --format json

# Send input.
agentic-tui type "hello world"
agentic-tui press Enter
agentic-tui press ArrowDown ArrowDown Enter

# Wait for a condition.
agentic-tui wait "Done" --timeout 30000
agentic-tui wait --stable

# Clean up.
agentic-tui kill
agentic-tui daemon stop
```

Use JSON when you need structured metadata:

```bash
agentic-tui screen --json
agentic-tui search "Continue" --json
agentic-tui sessions list --json
```

## Core Agent Loop

1. Start the daemon with the shell you want.
2. Run the target app or command.
3. Observe with `screen`, `output --mode streaming`, or `search`.
4. Act with `type`, `press`, `scroll`, or `resize`.
5. Synchronize with `wait`, usually `wait --stable` after actions that redraw the UI.
6. Repeat observe/act until the task is complete.
7. End with `kill` or `daemon stop`.

## Global Options

Global options can appear before the command.

```bash
agentic-tui --json screen
agentic-tui -s <session-id> screen
agentic-tui --session <session-id> press Enter
```

| Option | Description |
| --- | --- |
| `--json` | Print structured JSON instead of human-readable text when you need machine-readable metadata. |
| `-s, --session <id>` | Target a specific session. Defaults to the active session. |

JSON success shape:

```json
{
  "ok": true,
  "result": {}
}
```

JSON error shape:

```json
{
  "ok": false,
  "error": {
    "code": "NO_SESSION",
    "message": "No active session"
  }
}
```

## Output Modes

`agentic-tui` supports three output modes.

| Mode | Best For | Behavior |
| --- | --- | --- |
| `streaming` | Regular commands like `ls`, `git`, `npm`, compilers, test runners | Returns raw sequential PTY output since the last streaming read, then clears that stream buffer. |
| `snapshot` | Live-updating commands like `top`, progress UIs, logs | Returns the recent raw output tail without clearing it. |
| `screen` | TUI apps, prompts, menus, editors, anything visual | Returns the rendered 2D text grid from the terminal buffer. |

Examples:

```bash
agentic-tui output --mode streaming
agentic-tui output --mode snapshot
agentic-tui output --mode screen
agentic-tui screen
agentic-tui screenshot
```

Useful flags for `output`:

| Option | Description |
| --- | --- |
| `--mode streaming\|snapshot\|screen` | Select output mode. |
| `--wait-for-idle <ms>` | Wait until output has been quiet for this many milliseconds before reading. |
| `--trim` | Trim trailing whitespace in screen mode. |
| `--include-empty` | Preserve trailing empty rows in screen mode. |
| `--out <path>` | Save output to a file instead of printing the raw content. |
| `--format text\|json\|png` | File/stdout format. PNG requires `--out`. |

## Commands

### `daemon`

Manage the background daemon.

```bash
agentic-tui daemon start [--shell SHELL]
agentic-tui daemon run [--shell SHELL]
agentic-tui daemon status
agentic-tui daemon stop
agentic-tui daemon restart [--shell SHELL]
```

| Subcommand | Description |
| --- | --- |
| `start` | Start the daemon in the background. |
| `run` | Run the daemon in the foreground for debugging. |
| `status` | Check whether the daemon is reachable and list session count. |
| `stop` | Ask the daemon to stop and clean up state. |
| `restart` | Stop, then start a fresh daemon. |

| Option | Description |
| --- | --- |
| `--shell <shell>` | Default shell used for shell-evaluated commands. Examples: `powershell.exe`, `pwsh`, `cmd.exe`, `bash`, `zsh`. |

Examples:

```bash
agentic-tui daemon start --shell powershell.exe
agentic-tui daemon start --shell pwsh
agentic-tui daemon start --shell bash
agentic-tui daemon status
agentic-tui daemon stop
```

### `run`

Start a new PTY session.

```bash
agentic-tui run <command> [...args] [--cwd DIR] [--cols N] [--rows N] [--env KEY=VALUE]
```

| Option | Default | Description |
| --- | --- | --- |
| `--cwd <dir>` | Current working directory | Working directory for the spawned process. |
| `--cols <n>` | `120` | Terminal columns. |
| `--rows <n>` | `40` | Terminal rows. |
| `--env <KEY=VALUE>` | Inherited environment | Add or override an environment variable. Repeatable. |
| `--session <id>` | Generated UUID | Explicit session id. Usually unnecessary. |

Examples:

```bash
agentic-tui run npm install
agentic-tui run node -e "console.log('hello')"
agentic-tui run htop --cols 160 --rows 50
agentic-tui run --cwd D:\Codeboltapps\my-app npm test
agentic-tui run --env CI=1 --env FORCE_COLOR=1 npm test
```

Notes:

- On Windows, commands are launched through the daemon shell so `node`, `npm`, and `.cmd` shims resolve through PATH.
- On Unix, commands with explicit args are spawned directly. Single command strings containing spaces are shell-evaluated through the configured shell.
- `run` makes the new session active.
- If no daemon is running, `run` starts one automatically.

### `output`

Read session output.

```bash
agentic-tui output --mode streaming
agentic-tui output --mode snapshot
agentic-tui output --mode screen
```

Use `streaming` for ordinary command output, `snapshot` for recent raw output, and `screen` for rendered UI state.

### `screen` and `screenshot`

Capture the current rendered terminal screen.

```bash
agentic-tui screen
agentic-tui screenshot
agentic-tui screen
agentic-tui screenshot --out screen.txt --format text
agentic-tui screenshot --out screen.json --format json
agentic-tui screenshot --out screen.png --format png
```

`screenshot` is an alias for `screen`. The screenshot is a text grid, not an image file.

When `--format png` is used, `agentic-tui` renders the current text grid into a PNG image. This is meant for human review, reports, docs, and debugging. Agents should usually inspect text output first and request JSON when they need metadata.

PNG rendering uses `@napi-rs/canvas`, which provides native prebuilds for the main Windows, macOS, and Linux platforms.

JSON result includes:

```json
{
  "output": "visible terminal text",
  "metadata": {
    "mode": "screen",
    "sessionId": "...",
    "rows": 40,
    "cols": 120,
    "cursor": {
      "x": 0,
      "y": 1,
      "currentLine": "",
      "isAlternateBuffer": false
    }
  }
}
```

### `press`

Send one or more key presses.

```bash
agentic-tui press <key...>
```

Examples:

```bash
agentic-tui press Enter
agentic-tui press Ctrl+C
agentic-tui press ArrowDown ArrowDown Enter
agentic-tui press Tab
agentic-tui press Escape
agentic-tui press F10
```

Supported key names:

- `Enter`, `Return`
- `Tab`
- `Escape`, `Esc`
- `Backspace`, `Delete`
- `ArrowUp`, `ArrowDown`, `ArrowLeft`, `ArrowRight`
- `Up`, `Down`, `Left`, `Right`
- `Home`, `End`, `PageUp`, `PageDown`
- `Space`
- `F1` through `F12`
- `Ctrl+<letter>`, such as `Ctrl+C`, `Ctrl+D`, `Ctrl+M`

### `type`

Send literal text.

```bash
agentic-tui type <text>
```

Examples:

```bash
agentic-tui type "my-project"
agentic-tui press Enter
```

`type` does not automatically press Enter. Use `press Enter` when you want to submit.

### `scroll`

Convenience wrapper over repeated arrow-key presses.

```bash
agentic-tui scroll up [amount]
agentic-tui scroll down [amount]
agentic-tui scroll left [amount]
agentic-tui scroll right [amount]
```

Examples:

```bash
agentic-tui scroll down
agentic-tui scroll down 5
agentic-tui scroll up 3
```

This is intentionally app-agnostic. It sends arrow keys; it does not know app-specific scrolling semantics.

### `resize`

Resize the PTY and rendered terminal buffer.

```bash
agentic-tui resize --cols <n> --rows <n>
```

Examples:

```bash
agentic-tui resize --cols 120 --rows 40
agentic-tui resize --cols 80 --rows 24
```

Use this before screenshots when you need reproducible layouts.

### `wait`

Wait for text, text disappearance, or screen stability.

```bash
agentic-tui wait <text> [--timeout MS]
agentic-tui wait <text> --gone [--timeout MS]
agentic-tui wait --stable [--timeout MS]
```

| Option | Default | Description |
| --- | --- | --- |
| `--timeout <ms>` | `30000` | Maximum wait time. |
| `--gone` | `false` | Wait for text to disappear instead of appear. |
| `--stable` | `false` | Wait until the rendered screen stops changing briefly. |

Examples:

```bash
agentic-tui wait "Continue"
agentic-tui wait "Installing" --gone --timeout 60000
agentic-tui wait --stable --timeout 5000
```

Exit behavior:

- Returns exit code `0` when the condition is met.
- Returns exit code `75` when the condition times out.

### `search`

Search the visible rendered screen.

```bash
agentic-tui search <text>
agentic-tui search <regex> --regex
```

Examples:

```bash
agentic-tui search "Continue"
agentic-tui search "error|failed" --regex
```

JSON result:

```json
{
  "sessionId": "...",
  "results": [
    { "row": 10, "col": 4, "text": "Continue" }
  ],
  "count": 1
}
```

### `region`

Extract a rectangular screen region.

```bash
agentic-tui region --row <n> --col <n> --rows <n> --cols <n>
```

Coordinates are zero-based.

| Option | Description |
| --- | --- |
| `--row <n>` | Starting row. |
| `--col <n>` | Starting column. |
| `--rows <n>` | Number of rows to extract. |
| `--cols <n>` | Number of columns to extract. |
| `--trim` | Trim trailing whitespace. |
| `--wait-for-idle <ms>` | Wait for output to quiet before extracting. |

Examples:

```bash
agentic-tui region --row 0 --col 0 --rows 5 --cols 120
agentic-tui region --row 6 --col 0 --rows 20 --cols 80 --trim
```

### `cursor`

Return cursor position and current cursor line.

```bash
agentic-tui cursor
agentic-tui cursor --json  # use when row/col metadata matters
```

Use this for prompts, editors, and forms where cursor location matters.

### `sessions`

List, inspect, switch, and clean up sessions.

```bash
agentic-tui sessions list
agentic-tui sessions show [id]
agentic-tui sessions switch <id>
agentic-tui sessions cleanup [--all]
```

| Subcommand | Description |
| --- | --- |
| `list` | Show active and exited sessions still held by the daemon. |
| `show` | Show details for a session. Defaults to active session. |
| `switch` | Make a session active. |
| `cleanup` | Remove exited sessions. |
| `cleanup --all` | Remove all sessions. |

### `kill`

Kill the active or selected session.

```bash
agentic-tui kill
agentic-tui --session <id> kill
```

## Environment Variables

| Variable | Description |
| --- | --- |
| `AGENTIC_TUI_STATE_DIR` | Override where daemon state, session metadata, and active session files are stored. |
| `AGENTIC_TUI_SHELL` | Default shell used for shell-evaluated commands if daemon was not started with `--shell`. |

Default state directory:

- Windows: `%LOCALAPPDATA%\agentic-tui`
- Unix: `$XDG_STATE_HOME/agentic-tui` or `~/.local/state/agentic-tui`

## Recommended Patterns For Agents

### Regular Command

```bash
agentic-tui daemon start --shell powershell.exe
agentic-tui run npm test
agentic-tui output --mode streaming --wait-for-idle 1000
agentic-tui output --mode streaming --out test-output.txt
```

Use `streaming` because normal commands produce sequential output.

### Interactive Prompt

```bash
agentic-tui run npm init
agentic-tui screen
agentic-tui type "my-package"
agentic-tui press Enter
agentic-tui wait --stable
agentic-tui screen
```

Always re-read the screen after each input.

### Full TUI App

```bash
agentic-tui run htop --cols 120 --rows 40
agentic-tui wait --stable --timeout 3000
agentic-tui screen
agentic-tui search "CPU"
agentic-tui press F10
agentic-tui kill
```

Use `screen`, `search`, and `region` rather than raw `streaming` output for full-screen apps.

### Saving Screenshots

```bash
agentic-tui screen --out current-screen.txt
agentic-tui screen --out current-screen.json --format json
agentic-tui screen --out current-screen.png --format png
```

Use text for quick agent reasoning, JSON when metadata matters, and PNG when a human needs to inspect or archive the visual state.

### Menu Navigation

```bash
agentic-tui screen
agentic-tui press ArrowDown
agentic-tui wait --stable
agentic-tui screen
agentic-tui press Enter
```

Never assume a menu moved correctly without observing again.

## Troubleshooting

### `DAEMON_NOT_RUNNING`

Start the daemon:

```bash
agentic-tui daemon start
```

If the state file is stale:

```bash
agentic-tui daemon stop
agentic-tui daemon start
```

### `NO_SESSION`

Run an app first or list existing sessions:

```bash
agentic-tui run <command>
agentic-tui sessions list
```

### Windows shell command cannot be found

Start the daemon with the shell you want:

```bash
agentic-tui daemon restart --shell powershell.exe
agentic-tui daemon restart --shell pwsh
agentic-tui daemon restart --shell cmd.exe
```

### Output is changing too quickly

Use:

```bash
agentic-tui wait --stable
agentic-tui output --mode snapshot
agentic-tui screen
```

### Need reproducible screenshots

Resize before running or before capture:

```bash
agentic-tui run htop --cols 120 --rows 40
agentic-tui resize --cols 120 --rows 40
agentic-tui screen
```

## Development

```bash
npm install
npm run build
npm test
```

The tests cover key mapping and xterm screen helpers.
