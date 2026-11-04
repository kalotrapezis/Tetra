# What the site (docs/) still needs: checkpoint

Work that landed after the site was last updated (e541410, 31 Oct 2026, 0.7.0 beta 1). Tick each item when the
site shows it, in every language.

## New features to show
- [x] **AI Assist, redesigned**: island input with a handle (phone), sidebar (tablet, desktop), word cloud of what it
      can do, coloured skill bubbles. Screenshots ready in `Screenshots/ai-assist/` (commit c3c281d, not pushed).
- [x] **Scheduled actions and the daily brief**: once / daily / weekly / monthly / yearly; set by writing or speaking;
      rings in the island; the morning page with calendar, mail, weather and Notes checklists.
- [x] **Personal details (memory)**: a few short facts AI Assist keeps, in every chat and scheduled action.
- [x] **Place reminders**: arriving at a supermarket rings the open «Ψώνια» list (Android, off by default).
- [x] **Mail «Read when shown»** (desktop and tablet).
- [x] **Open beside, in split screen** (tablet, Android 12L+), from Files' ⋮ and from AI Assist.
      Merged 1 Nov (Tetra-mobile 5423f812).
- [x] **PDF ↔ scanner**: open a PDF in the scanner, import files as pages, Files ⋮ › Open in scanner, scanner tile
      «From file» (PDF pages, JPG/PNG/HEIC), Perspective for every page, Tilt ±45° with Auto straighten, Flatten curve; auto
      fix straightens every new page. Merged 1 Nov.

- [x] **Text editor**: Markdown view (as in Notes), line numbers, Stripes theme for following lines (Android). Merged 1 Nov.
- [x] **Timer notifications**: icon-only × and zzz (snooze 10 min) / ‖ buttons, in the island too. Merged 1 Nov.
- [x] **AI Assist reads files, and makes an MP3 of them**: a paperclip (Tetra's Files or the device; drag-and-drop on the
      computer) for PDF, Word, PowerPoint, ODT, text and scans; three pills once a file is in: «Ραδιοφωνική εκπομπή» (a host
      and an expert, examples and recaps, what the text does not say taken out), «Ζωντανή συζήτηση» (Live about the
      document), «Διάβασέ το μου». The MP3 (64 kbps, chapters) is made in the background with a notification, played in the
      chat, saved in Files or downloaded; ≈ €0.93 an hour of audio, the estimate asked first. The phone makes its own, as M4A.
- [x] **AI Assist: usage and cost**: every paid call counted, per device and month, in `.System` (kept through updates);
      a dashboard in Settings, opened from the € chip in the header, with totals for all devices and a monthly budget.
- [ ] **AI Assist (phone): result cards**: contact (photo, numbers, last calls; Open, Call, Message), files, web sources,
      an email to check before sending, event, note, timer. «Βρες» only shows; «Πάρε τον Χ» calls after 3 s unless cancelled.
      The mini window shows the screen behind it, dimmed.

- [x] **Browser** (Android): a browser that forgets (logins, addresses and cards with Android's encryption; history for
      the session, a day or always; Private; ad blocking; tabs and groups; Firefox import; pages dark in the dark look).
- [x] **Music behind the map**: Player mode for any page, background play, radio favourites in folders for ‹ ›, Maps' 🎧.
- [x] **Messages**: SMS as chats on the phone, side by side on a tablet and on the computer; Tetra as the default SMS app.
- [x] **Alarms and the stopwatch** synced with the computer's Clock.
- [ ] **Notifications by applet** (4 Nov): on the computer each app in the sidebar shows its own count (cleared when
      opened) and the Notifications list shows each one under its app's icon; on the phone a bell on Home opens a
      notification centre grouped by applet with Home's icons, and each Home tile shows its own count. The launcher icons
      stop counting what is always there (Listening, sync, a countdown).
- [ ] **AI Assist plays and sends** (4 Nov): «play disco on YouTube» finds playlists and plays the first; «play the radio»
      plays Maps' driving station, «βάλε Kosmos» a saved one; «δυνάμωσε / χαμήλωσε / ένταση στο 30»; «play it on the
      tablet», «send the answer to the PC», «open the brief on the PC» go to another device through the computer.
- [ ] **Daily brief weather** (4 Nov): without a place set it uses where the phone is; the phone's Scheduled tab shows and sets it.

## Numbers
- [x] **Speed of Mail and AI Assist** (1 Nov, `desktop/PERF_MAIL_AI.md`): the computer's window 496 → 97 ms; Mail's list
      238 → 113 ms, the window no longer busy while mail arrives (161 → 0 ms in 10 s), a mail opened 258 → 211 ms; AI Assist's
      History 79 → 11 ms. The phone: Mail from Home after Tetra starts ~2.5 s → 129 ms. AI Assist was already quick (15–90 ms);
      an answer's wait is Mistral's (1–9 s). Add them beside the README's speed table.

## Downloads
- [x] Bump the download buttons, labels and QR code to the next release once it is out (now 0.8.0 beta 3).
