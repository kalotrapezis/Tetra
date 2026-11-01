# Speed of Mail and AI Assist

The user found Mail and AI Assist very slow, above all on the computer (1 Nov 2026). These are the moments they wait
for, measured before and after each round of changes, kept for the Tetra page.

## Computer

**Machine.** AMD Ryzen 7 7730U (8 cores, 16 threads), 13 GB of RAM, NVMe disk; Linux, Wayland; Electron 44.4.3;
Tetra 0.7.0-beta.1.

**Data.** A copy of the user's own mail: 7 836 mails in the Inbox (13 670 in the index, 25 MB, plus the phones'
indexes, 44 MB), 5.1 GB of mail files; the largest mail 25.8 MB with its attachments. AI Assist: 100 kept chats (made
for the test: there were none yet), the user's schedules and memory.

**Method.** `scripts/measure-mail-ai.js`, in the manner of `scripts/measure.js` (the Photos and Phone round of
25 Oct): Tetra runs hidden, on a copy of the folders (`HOME`, `DRIVE_DATA` and `DRIVE_FILES` pointing at a copy), and
clicks through the pages. Each line is the median of 3–5 cold starts (one process each):

- *on screen*: until the thing waited for is there (the first rows, the open mail);
- *settled*: until the page stops changing (0.6 s with no change);
- *window busy*: the longest moment the window could not answer (Chromium's long tasks, over 50 ms).

"While mail arrives" sends main's *mail changed* twice a second for 10 s, as during a download, and adds up the time
the window was busy. The first word of AI Assist (`ASK=n`) separates the network (the request to Mistral until its
first bytes) from the app (before the request, and between one round of tools and the next).

### Round 1: the window does not wait for Mail's index

Mail read its whole index (25 MB, and 44 MB of the phones') when Tetra started, before the window was made. Now it is
read 1.5 s after the window's first page, in the background, and at once if something asks for it sooner.

| Moment | before | after |
|---|---|---|
| Tetra started → window made | 496 ms | 97 ms |
| Tetra started → first page loaded | 797 ms | 387 ms |
| Mail opened (first rows) | 238 ms | 227 ms |
