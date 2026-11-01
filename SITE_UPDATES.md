# What the site (docs/) still needs: checkpoint

Work that landed after the site was last updated (e541410, 31 Oct 2026, 0.7.0 beta 1). Tick each item when the
site shows it, in every language.

## New features to show
- [ ] **AI Assist, redesigned**: island input with a handle (phone), sidebar (tablet, desktop), word cloud of what it
      can do, coloured skill bubbles. Screenshots ready in `Screenshots/ai-assist/` (commit c3c281d, not pushed).
- [ ] **Scheduled actions and the daily brief**: once / daily / weekly / monthly / yearly; set by writing or speaking;
      rings in the island; the morning page with calendar, mail, weather and Notes checklists.
- [ ] **Personal details (memory)**: a few short facts AI Assist keeps, in every chat and scheduled action.
- [ ] **Place reminders**: arriving at a supermarket rings the open «Ψώνια» list (Android, off by default).
- [ ] **Mail «Read when shown»** (desktop and tablet).
- [ ] **Open beside, in split screen** (tablet, Android 12L+), from Files' ⋮ and from AI Assist.
      Merged 1 Nov (Tetra-mobile 5423f812).
- [ ] **PDF ↔ scanner**: open a PDF in the scanner, import files as pages, Files ⋮ › Open in scanner, scanner tile
      «From file» (PDF pages, JPG/PNG/HEIC), Perspective for every page, Tilt ±45° with Auto straighten, Flatten curve; auto
      fix straightens every new page. Merged 1 Nov.

- [ ] **Text editor**: Markdown view (as in Notes), line numbers, Stripes theme for following lines (Android). Merged 1 Nov.
- [ ] **Timer notifications**: icon-only × and zzz (snooze 10 min) / ‖ buttons, in the island too. Merged 1 Nov.
- [ ] **AI Assist reads files, and makes an MP3 of them**: a paperclip (Tetra's Files or the device; drag-and-drop on the
      computer) for PDF, Word, PowerPoint, ODT, text and scans; three pills once a file is in: «Ραδιοφωνική εκπομπή» (a host
      and an expert, examples and recaps, what the text does not say taken out), «Ζωντανή συζήτηση» (Live about the
      document), «Διάβασέ το μου». The MP3 (64 kbps, chapters) is made in the background with a notification, played in the
      chat, saved in Files or downloaded; ≈ €0.93 an hour of audio, the estimate asked first. The phone's are made by the computer.

## Numbers
- [ ] **Speed of Mail and AI Assist** (1 Nov, `desktop/PERF_MAIL_AI.md`): the computer's window 496 → 97 ms; Mail's list
      238 → 113 ms, the window no longer busy while mail arrives (161 → 0 ms in 10 s), a mail opened 258 → 211 ms; AI Assist's
      History 79 → 11 ms. The phone: Mail from Home after Tetra starts ~2.5 s → 129 ms. AI Assist was already quick (15–90 ms);
      an answer's wait is Mistral's (1–9 s). Add them beside the README's speed table.

## Downloads
- [ ] Bump the download buttons, labels and QR code to the next release once it is out (now 0.7.0 beta 1).
