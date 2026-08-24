# Codex Fork Notes

Date: 2026-06-20

## Location

Local fork:

```text
C:\Projects\codex-fork
```

Release binary used by this project:

```text
C:\Projects\codex-fork\codex-rs\target\release\codex.exe
```

Launcher that references it from `trading-mcp`:

```text
start-codex-remote.bat
```

## Current Branch

```text
fix/windows-remote-linux-path
```

Current committed fork patch:

```text
791a0fce5c Allow Unix absolute paths in Windows remote client
```

The branch tracks:

```text
origin/fix/windows-remote-linux-path
```

## Why This Fork Exists

The fork is used to run a Windows Codex TUI client against a Linux Codex app-server.

The original failure was caused by the Windows client receiving a Linux absolute path from the remote app-server, for example:

```text
/root/projects/trading-mcp
```

Without the fork patch, the Windows client could fail during remote TUI bootstrap with:

```text
AbsolutePathBuf deserialized without a base path
```

The committed fix changes `codex-rs/utils/absolute-path/src/lib.rs` so that, on Windows, a Unix-style absolute path beginning with `/` is accepted during `AbsolutePathBuf` deserialization. It also adds a Windows-only regression test for this case.

## Committed Change Summary

File changed:

```text
codex-rs/utils/absolute-path/src/lib.rs
```

Behavior:

- Windows still accepts normal Windows absolute paths.
- Windows additionally accepts Unix absolute paths from a remote Linux server.
- UNC-like `//...` paths are not treated as Linux absolute paths by this helper.
- Unix behavior is unchanged.

## Uncommitted Changes Present On 2026-06-20

At the time this note was written, the fork also had local uncommitted changes in:

```text
codex-rs/Cargo.lock
codex-rs/config/src/config_toml.rs
codex-rs/config/src/profile_toml.rs
codex-rs/core/src/config/mod.rs
codex-rs/core/src/thread_manager.rs
codex-rs/tui/src/app_server_session.rs
codex-rs/tui/src/cli.rs
codex-rs/tui/src/lib.rs
codex-rs/utils/absolute-path/src/lib.rs
```

These local changes add a separate tool-restriction mode:

```text
disable_file_shell_tools=true
```

and a TUI CLI flag:

```text
--no-file-shell-tools
```

Intended behavior:

- Disable local filesystem and shell-backed tools.
- Keep MCP tools available.
- Keep web search available when enabled separately with `--search`.
- Propagate the config to remote app-server thread start/config overrides.
- Start threads without default local environments when file/shell tools are disabled.

`Cargo.lock` was also updated so many internal Codex packages moved from version `0.0.0` to `0.135.0`.

## How It Is Used From trading-mcp

Windows launcher:

```bat
start-codex-remote.bat
```

Current launcher values:

```text
CODEX_LOCAL_EXE=C:\Projects\codex-fork\codex-rs\target\release\codex.exe
CODEX_REMOTE_REPO=/root/projects/trading-mcp
CODEX_REMOTE_APP_SERVER_URL=ws://singapur.tail3e0cf.ts.net:8790
```

The launcher runs:

```text
codex.exe --remote ws://singapur.tail3e0cf.ts.net:8790 -C /root/projects/trading-mcp --dangerously-bypass-approvals-and-sandbox
```

## Useful Commands

Check fork status:

```powershell
git -C C:\Projects\codex-fork status --short --branch
```

Show the committed Windows remote-path fix:

```powershell
git -C C:\Projects\codex-fork show --stat --oneline HEAD
git -C C:\Projects\codex-fork show -- codex-rs/utils/absolute-path/src/lib.rs
```

Show current uncommitted changes:

```powershell
git -C C:\Projects\codex-fork diff --stat
git -C C:\Projects\codex-fork diff -- codex-rs/tui/src/cli.rs codex-rs/core/src/config/mod.rs
```

Build release binary:

```powershell
cd C:\Projects\codex-fork\codex-rs
cargo build --release -p codex-cli
```

Run the remote TUI from `trading-mcp`:

```powershell
cd C:\Projects\trading-mcp
.\start-codex-remote.bat
```

## Notes

- The committed fix is narrow and only targets path deserialization for Windows remote clients.
- The `--no-file-shell-tools` work is separate from the path fix and was not committed when this document was created.
- If the fork is rebased onto a newer upstream Codex, re-check whether upstream already handles Unix remote paths on Windows before keeping the local patch.
