# Tetra Passwords for Firefox

The Passwords applet of Tetra Desktop in Firefox, like Proton Pass or Bitwarden: Tetra stays the only store, so a login saved or changed in Firefox reaches the phone and tablet through Tetra's own sync. Firefox's own password manager and Firefox Sync are not used (turn off **Settings › Privacy › Ask to save passwords** so the two do not both ask).

- **Toolbar popup**: logins (this site's first) with Fill, copy user, copy password; 2FA codes with Use (copied, and typed into the code box); a strong password to copy; Lock.
- **Autofill**: when the site has exactly one login in Tetra, it is filled by itself (switch off in the popup).
- **Suggest**: a sign-up or change-password field offers a strong 20-character password; it fills the "repeat" box too.
- **Save**: a login sent on a site that Tetra does not have, or with a changed password, puts **+** on the toolbar button; the popup asks to save it to Tetra.
- **Locked**: Tetra's Passwords lock as they do in Tetra (5 minutes away, screen lock). The popup unlocks with the computer's login password or the sync passphrase.

On the Tetra side it talks to `desktop/pwbridge.js`: plain HTTP on `127.0.0.1:43191`, every call with a token Tetra hands out once, after you say yes. 2FA secrets never leave Tetra, only the current codes.

## Install

```bash
cd firefox && zip -r ../tetra-passwords.xpi manifest.json background.js content.js popup.html popup.js icon.png
```

Release Firefox installs only signed extensions. Either:

- **Try it now**: `about:debugging` › This Firefox › **Load Temporary Add-on…** › `manifest.json` (gone when Firefox closes), or
- **Keep it**: sign it once, free and private, as an unlisted add-on on addons.mozilla.org (`npx web-ext sign --channel=unlisted` with your AMO API keys), then install the signed `.xpi` from file.

Then open the popup with Tetra running and press **Σύνδεση με το Tetra**. Tetra asks whether to let Firefox in.

## Not yet

- Two-step sign-ins (user on one page, password on the next) are saved without the user name; edit it in Tetra.
- Cards and addresses are not filled.
