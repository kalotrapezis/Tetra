# Tetra Mail for Thunderbird

Some accounts let in only approved apps. A university's Microsoft 365 is one: it lets Thunderbird in, but not Tetra. This extension brings their **Inbox** and **Sent** into Tetra Mail. When you send from them in Tetra, Thunderbird sends the mail. Thunderbird does the signing in, so Tetra never sees a password or a token.

On the Tetra side, the extension talks to `desktop/tbbridge.js`. That is plain HTTP on `127.0.0.1:43190`, and every call needs a token that Tetra hands out once, after you say yes. Bridged accounts are `auth: 'thunderbird'` in `mail.js`.

## Install

```bash
cd thunderbird && zip -r ../tetra-mail.xpi manifest.json background.js options.html options.js icon.png
```

1. In Thunderbird, open **Add-ons and Themes** › ⚙ › **Install Add-on From File…** and choose `tetra-mail.xpi`.
2. Open the extension's options with Tetra open, and press **Σύνδεση με το Tetra**. Tetra asks whether to let Thunderbird in.
3. Tick the accounts Tetra should get, for example the university one. Do not tick an account Tetra already fetches itself; Tetra refuses those.

## What it does (v1)

- Every mail of the ticked accounts' Inbox and Sent goes to Tetra once. It goes at once for new mail, and on a full look every 5 minutes.
- Read and ♥ changed in Thunderbird are followed in Tetra. Read and ♥ changed in Tetra stay in Tetra.
- Tetra's Send for these accounts goes through Thunderbird, which must be open. If Thunderbird is closed, the mail is not picked up within 2 minutes, the send fails, and the draft stays.
- Archive, delete, move and spam for these accounts are done in Thunderbird. Carrying them across is phase 2.
