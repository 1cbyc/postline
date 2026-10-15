# Self-hosted scheduling without GitHub Actions

Postline does not need GitHub Actions, a hosted scheduler, or usage credits. It can
stay running on any machine with Node.js 20 or newer and persistent storage.

## Install from the GitHub release

Download and install the release package without npm publishing:

```sh
npm install --global https://github.com/1cbyc/postline/releases/download/v2026.0.1.0/postline-0.1.0.tgz
postline --version
```

Install Chromium once on machines that render cards:

```sh
npx playwright-core@1.64.1 install chromium
```

## Run the built-in daemon

From the content project:

```sh
postline daemon --every 15
```

The first check runs immediately. Later checks run serially at the requested
interval, so one daemon never overlaps itself. Configuration and posts are reloaded
on every check, and a failed check is logged without stopping the daemon. `SIGINT`
and `SIGTERM` stop it cleanly.

The machine must remain awake and connected. Keep `.postline/ledger.json` on
persistent storage and run only one daemon for a content project. If a process dies
during a network request, the durable `attempting` entry prevents an automatic
duplicate; inspect the destination and use `postline mark` or `postline retry`.

## Keep it running with systemd

Copy the example created by `postline init` and replace every `/ABSOLUTE/PATH`
placeholder:

```sh
mkdir -p ~/.config/systemd/user
cp schedulers/systemd/postline.service.example ~/.config/systemd/user/postline.service
systemctl --user daemon-reload
systemctl --user enable --now postline.service
systemctl --user status postline.service
journalctl --user -u postline.service -f
```

The environment file contains ordinary `NAME=value` lines for the channels you
configured. Restrict it to your account:

```sh
chmod 600 /absolute/path/to/postline.env
```

On a Linux server, enable user lingering if the service must continue after logout:

```sh
loginctl enable-linger "$USER"
```

## Other process managers

Launchd, Docker Compose, Kubernetes, PM2, supervisord, and Windows Task Scheduler
can all run `postline daemon --every 15`. If the scheduler invokes one-shot jobs,
run `postline publish` from the content project and ensure jobs cannot overlap.

For disposable runners, use `publish --prepare-only`, persist the ledger, run
`publish --resume-prepared`, and persist the final ledger. That two-phase sequence
is required because the local filesystem disappears between runs.
