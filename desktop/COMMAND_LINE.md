# Tetra's command line

The user, 14 Nov 2026: "a man with all the apps and the commands that control them, every button every action build a command line for it".

## What it is (desktop)

- **One registry**, `desktop/commands.js`: 322 commands in 29 apps. Each is `app verb`, with typed parameters, one line of help and a tag:
  `read` (reads only), `external` (text others wrote: mail, SMS, notifications), `side` (changes something it can undo), `asks` (sends, calls, deletes, moves out).
- **No second implementation.** `main.js` keeps every `ipcMain.handle` function by its channel. A command calls the same function its button calls, with the same checks.
  `test/commands.test.js` fails if a command names a channel or a `*_CALLS` method that main.js doesn't have.
- **The manual** comes from the registry: `tetra help [app]`, `desktop/COMMANDS.txt` (a test checks it is current; refresh it with `node cli.js help > COMMANDS.txt`), and in Tetra under Settings › AI Assist › Command line › Open the manual, a searchable page. `tetra help --json` gives the registry as data.
- **The CLI**, `desktop/cli.js` (`desktop/bin/tetra`, link it into `~/.local/bin`):
  `tetra timer start 300`, `tetra calendar events --from 2026-11-14 --to 2026-11-21`, `tetra mail delete --ids a,b --yes`.
  It sends one JSON line over a Unix socket at `$XDG_RUNTIME_DIR/tetra.sock`: the folder is 0700, the socket 0600, so only this user can open it. On Windows it's a named pipe.
  An `asks` command needs `--yes`; without it the exit code is 2. Exit codes: 0 done, 1 refused or failed.
  Bad parameters are refused before Tetra is asked. Hidden QA copies don't listen unless given `TETRA_SOCKET`.
- **AI Assist** keeps its 52 hand-tuned tools (mistral-small is reliable on them; they return short numbered lists). It also gets two more:
  `tetra_help(app)` returns that app's page of the manual, and `tetra_command({command, args})` runs any command. That's 2 tools instead of 300, so the model isn't flooded.
  The safety rules still hold:
  - Each command is behind its app's AI switch (`APPS[app][1]` → ai.js).
  - The `ai`, `usage`, `devices`, `role`, `vault` and `passwords` apps are never offered, and neither are `assistant ask/set/clear…`.
  - An `asks` command is always held for the user's yes (Do it / Cancel), because its button asks, not its handler.
  - After `external` text, `side` commands are held as before.
  - Answers are cut at 6000 characters.

## Left out, and why

- **Secrets:** passwords open/list/change/copy/cvc, 2FA codes, the passphrase, vault unlock/setup, the Mistral key, a mail account's password (`mail:add`), the pairing key (`role:join`), reading the clipboard for an app password. None of these go through a socket or to a model.
- **Reset's arm/delete:** wiping Tetra stays a two-step job done by hand in Settings.
- **`assistant:confirm/refuse`:** approving AI Assist's held actions is the user's own yes on the screen. A script must not give it.
- **The window's plumbing:** audio streams (live talk, transcribe, voice sample), the editor's bytes, remote mail images, face thumbnails, the call bubble's buttons, mail compose's file pickers, `schedules:prepare` (it resets the window's chat), `assistant:keep/attach/audioStart` (fed by the chat page and audio_make's estimate).
- **Pages are opened, not driven:** `app open <page>` shows any page. Things that live only in React state, like a half-typed draft, a selection or a scroll position, aren't commands. Their effects are, through the same handlers.
- **Not tested live:** `tetra_command` with a real Mistral key. The chat loop, holds and switches are covered by unit tests with a faked model.
- **Packaged Tetra:** `cli.js` is in the package, but the AppImage has no `node` on PATH for it. For now run it from the source tree, or as `ELECTRON_RUN_AS_NODE=1 /opt/Tetra/local-drive-desktop resources/app.asar/cli.js` (not tried).

## Android plan (Tetra-mobile)

The phone already has a command line: `AssistantCommands.kt` (about 50 `area verb` commands behind one `tetra` tool, with `gate`, `acts` and `external`). It is the same idea, so the plan is to converge, not to add a second one.

1. **One list of names.** Desktop exports `tetra help --json`. Copy it into the phone as `app/src/main/assets/commands.json`. The phone keeps its own branches (its code is Kotlin), but a command that exists on both uses the desktop's `app verb` and the same meaning.
   A unit test on the phone reads the JSON and checks:
   - every phone command whose name is in it has the same tag (`acts` = side/asks, `external` = external);
   - names that differ (`calls missed` vs `phone history`) are listed on purpose.
2. **Tags instead of flags.** Change `Command(acts, external)` to `tag = read|external|side|asks`. `asks` (calls back, mail delete, notes trash, calendar cancel, contacts add) waits for the user's yes always, as on the desktop. Today it only waits after outside text, and the description says "only when the user asked".
3. **Help per app.** Today `description()` lists every command in the tool's description. Past about 80 commands, split it the way the desktop did: `tetra_help(app)` plus `tetra_command`. Keep the description's index of apps so the model knows what exists.
4. **Fill the gaps,** in this order (most used first): alarms and stopwatch (already tools), timers, pills, media and quiet (phone-only), photos, maps places and trips, notes edit, files move/rename/trash, settings theme. Each one calls the screen's own ViewModel/repository function, never a copy.
5. **The phone from the computer's CLI (later):** `AssistantRemote.kt` already carries commands between devices. `tetra phone <cmd>` on the desktop could pass an `app verb` line to the phone over the sync connection and print the answer. The same tags apply, and an `asks` command shows the yes on the phone.

First slice to build: steps 1–2 (`commands.json` + the tag change + its test), with no new behaviour. That makes both apps speak the same names before anything grows.
