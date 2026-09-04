# Gmail OAuth dogfood

Gmail support is a desktop OAuth dogfood provider, not a Gmail REST backend.
Use a Google Cloud **Desktop app** OAuth client and never create or store a
client secret in this repository.

## Setup

1. Create or select a Google Cloud project and configure the Google Auth
   Platform consent screen.
2. If the consent screen is in Testing, add the developer Gmail account as a
   test user.
3. Create an OAuth client with type **Desktop app** and copy only its client
   ID.
4. In the shell used to start Tauri, set
   `BOXPLOT_GOOGLE_OAUTH_CLIENT_ID=<client-id>` and run `pnpm dev`.
5. Choose **Google / Gmail**, enter the intended Google account address and
   click **Continuar con Google**.
6. Complete consent in the system browser, return to Correo Boxplot, then
   click Refresh.

The browser redirect is a one-use loopback listener on a random
`127.0.0.1:<port>`. The requested scope is only `https://mail.google.com/`.
Never record authorization codes, access tokens or refresh tokens in a shell,
issue, test fixture, screenshot or log.

## Dogfood checklist

- DOG-01: Google login completes.
- DOG-02: Inbox loads without a full-mailbox body download.
- DOG-03: Recent Inbox metadata appears.
- DOG-04: Opening a message fetches its body on demand.
- DOG-05: A previously cached message opens offline after restart.
- DOG-06: Seen works.
- DOG-07: Flagged works.
- DOG-08: Trash targets Gmail Trash.
- DOG-09: Send a plain message to self.
- DOG-10: En cola / Enviando / Enviado-or-Verificando remains accurate.
- DOG-11: Refresh Sent finds the sent message.
- DOG-12: Close the application.
- DOG-13: Reopen it.
- DOG-14: Cached local mail is immediately visible.
- DOG-15: Reconnect uses the valid refresh token without opening a browser.

Current intentional limits: Inbox, Sent and Trash only; the highest 100 UIDs
per mailbox; metadata-only Refresh; no labels, archive, IDLE or background
sync. A revoked credential requires **Volver a autorizar con Google**.
