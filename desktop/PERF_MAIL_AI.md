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

### Round 2: the list sends and draws only what is seen

Each reload sent the whole folder over to the window with every field of the index (the Inbox: 6.5 MB, again every
2 s while mail arrived), and the window laid out all the rows it had made. Now a row carries only what it shows, the
rows out of view are not laid out or painted (`content-visibility`, as in Contacts), and a group of mails grows in place
(it was copied whole for each mail added, which grew with the square of a group's size).

| Moment | before | after |
|---|---|---|
| Mail opened (first rows) | 238 ms, window busy 138 ms | 113 ms, never busy |
| Inbox again from another folder | 182 ms, busy 74 ms | 93 ms, never busy |
| Sent (78 mails) from the Inbox | 246 ms, busy 81 ms | 161 ms, busy 92 ms |
| A mail opened | 258 ms on screen, settled 399 ms, busy 156 ms | 211 ms, settled 266 ms, busy 96 ms |
| 300 more rows (scrolled to the end, third time) | 96 ms, busy 124 ms | 95 ms, busy 95 ms |
| While mail arrives (10 s) | window busy 161 ms in all | 0 ms |
| Search ("σχολ") | 42 ms, never busy | 48 ms, never busy |

### Round 3: AI Assist's History

AI Assist itself was already quick on the computer: its page is on screen in 15–25 ms with the word cloud and the
sidebar, Scheduled and Memory in 3 ms. History read all its kept chats whole (up to 100, with every turn of each)
whenever it was opened. Now each title is read once and again only when that chat changes, and they are read in the
background after Tetra starts.

| Moment | before | after |
|---|---|---|
| History (100 chats) | 79 ms | 11 ms |
| AI Assist opened (word cloud and sidebar) | 17–25 ms | 15 ms |

**The first word of an answer** is Mistral's and the line's, not Tetra's. Measured with a short question, Tetra
spends 2–6 ms before the request leaves and 22 ms between a round of tools and the next; Mistral's first bytes came
after 1.1–8.7 s (the user's connection is weak, and every request carries AI Assist's instructions and 38 tools,
about 20 KB). Opening the connection beforehand would save 0.1–0.4 s of the first question only, less than the
network's own swing, so it was left out.
