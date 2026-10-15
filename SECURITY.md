# Security

postline handles social media tokens, so please report vulnerabilities privately:
open a GitHub security advisory on this repository, or email isaacnsisong@gmail.com.
I aim to reply within a few days.

## Notes for users

- Keep tokens in CI secrets or environment variables, never in `postline.config.yaml`.
- Use the narrowest token each network offers (Bluesky app passwords, Mastodon scopes limited to `write:statuses` and `write:media`).
- Set `POSTLINE_WEBHOOK_SECRET` and verify `X-Postline-Signature` on the receiving side.
- Card HTML is built from your own repo content. Treat post files from untrusted contributors like code: review them before merging.
