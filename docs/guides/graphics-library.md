# Your graphics library

`out/cards/` is a working folder: it is overwritten every time a card changes and
is usually not committed. So postline also keeps a **library**: a folder on your
own computer with a full-quality copy of every card it renders, ready to reuse in
a deck, a website or print.

By default the library is at:

| System | Folder |
| --- | --- |
| macOS | `~/Pictures/postline/<brand>` |
| Windows | `C:\Users\<you>\Pictures\postline\<brand>` |
| Linux | `~/Pictures/postline/<brand>` |

`<brand>` is your brand name in lowercase with dashes, e.g. `nsisong-labs`.

## What gets saved

Every time `postline render` or `postline publish` renders a card, the library gets:

- **`2026-11-02_launch_3f9a1c2b.png`**: a lossless PNG at 3x (3600 x 3600 for a square card) regardless of the size you post at.
- **`2026-11-02_launch_3f9a1c2b.json`**: the post text, per-channel variants, topic, alt text, layout, size, source file and, once published, where it went with links.
- **`index.html`**: a gallery of everything in the folder. Open it in any browser; no server or internet needed.

The last part of the name is a fingerprint of the design. Edit a post's card and
the new version is saved next to the old one, so earlier versions are never lost.
Re-rendering an unchanged card doesn't write anything.

Posts that use your own `image:` instead of a card are copied into the library
when they are published.

```sh
postline library          # where the folder is, how many cards, the latest ones
postline library --open   # open the gallery in your browser
```

## Exporting at other sizes

For a one-off copy at a specific resolution, size or format:

```sh
postline export launch --scale 4                       # 4800 x 4800 PNG
postline export launch --size landscape --scale 2      # same card, landscape
postline export launch --format jpeg --out ~/Desktop/launch.jpg
```

Exports go to `<library>/exports/` unless you pass `--out`.

## Settings

```yaml
library:
  enabled: true                        # default: true, except in CI
  dir: ~/Pictures/postline/acme        # ~ is your home folder; relative paths are from the project
  scale: 3                             # 1 to 4; 3 = 3600 px wide for square cards
```

- In CI (when the `CI` environment variable is set) the library is off by default, because the machine is thrown away after the run. Set `enabled: true` to keep it anyway, for example to upload the folder as a build artifact.
- `postline render --no-library` skips the library for one run.
- If the folder can't be written (a full disk, a missing drive), postline prints a warning and carries on. Rendering and publishing never fail because of the library.
- The library lives outside the project on purpose, so it is never committed and survives deleting or re-cloning the repo. Back it up like any other folder of pictures.
