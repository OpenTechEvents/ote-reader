# OTE Reader

[![Deploy GitHub Pages](https://github.com/OpenTechEvents/ote-reader/actions/workflows/pages.yml/badge.svg)](https://github.com/OpenTechEvents/ote-reader/actions/workflows/pages.yml)
[![OTE spec](https://img.shields.io/badge/OTE%20spec-v0.4%20%E2%80%93%20v0.6-2563eb)](#ote-spec-version-support)
[![Reader](https://img.shields.io/badge/reader-opentechevents.org-2563eb)](https://reader.opentechevents.org)
![PWA](https://img.shields.io/badge/PWA-offline--first-5b21b6)
![Build step](https://img.shields.io/badge/build%20step-none-555555)
![License](https://img.shields.io/badge/license-MIT-339933)

Supported OTE spec minors: **0.4, 0.5, 0.6** — the last three published minors,
computed at runtime from `PUBLISHED_SPEC_VERSIONS` in `app.js`. Feeds outside
that window still open; see [OTE spec version support](#ote-spec-version-support).

Attendee-facing MVP for OpenTechEvents feeds.

The first version is a static PWA that lets people:

- subscribe to OTE feeds or standalone OTE event URLs;
- discover feeds from pages that expose an OTE `<link rel="alternate">`;
- filter events by topic, attendance mode, language, country and open CFP;
- switch between card, RSS-like and calendar views;
- save filters and events locally;
- export single events as `.ics`.

## Relationship with `<ote-events>`

The embeddable widget at <https://tools.opentechevents.org/embed/> is a good candidate
for sharing presentation code with OTE Reader. Today it consumes a `feed` URL directly.
OTE Reader keeps feeds and filters in memory, so the clean integration point would be a
future widget API that accepts an already-filtered OTE feed object or event list.

## OTE spec version support

The reader opens a document because of its **shape** — a declared
`specVersion` plus `events[]` for a feed — and uses the version it declares to
decide which rules apply to it. The two questions are kept apart on purpose: a
reader that treats "which version is this?" as "is this OTE?" stops opening
every feed published after it shipped, which is exactly what happened while
the test was `specVersion === '0.3.0'`.

The support window is the **last three minors**, computed from
`PUBLISHED_SPEC_VERSIONS` in `app.js` rather than listed, so a spec release
moves it by itself. What each case means here:

| Declared | What the reader does |
| --- | --- |
| The current release | Opens it, says nothing |
| An older supported release | Opens it, notes the version when you open that feed |
| Older than the window | Opens it, warns that fields added later are missing |
| Newer than this build knows | Opens it, warns it is ignoring what it does not recognise |
| Not a published version | Opens it, says so |

None of these refuse the feed, and none of them blames the publisher: running
last season's release is a legitimate choice, and a reader's job is to show
the events.

### Why there is no dependency on `@opentechevents/validate`

That package is the right tool for judging a document — it embeds every
published version and measures each one against what it declares. The reader
is deliberately not a judge:

- **It must be more tolerant than a validator.** `validateDocument` reports an
  out-of-window or unpublished version as an *error*. Gating on that would
  make a 0.3.0 feed unopenable and break every feed again on the next spec
  release — the original bug, reintroduced.
- **There is no build step.** The package is ESM with a per-version dynamic
  `import()` meant for a bundler, ~3.7 MB of compiled validators. Vendoring it
  or pulling it from a CDN would mean megabytes, or a runtime dependency on a
  third party for an offline-first PWA's ability to open a file.

What the reader needs from it is the **policy**, not the schemas, so the
policy is mirrored in `app.js` with the same vocabulary (`current`,
`outdated`, `out-of-window`). `npm run check` reads the npm registry and the
published event schema and fails if the mirrored version list or the
feed→event inheritance list has drifted from them.

## Run locally

```bash
npm run dev
```

Then open <http://localhost:8001>.

## Discovery contract

Communities can expose their OTE feed from a website with:

```html
<link rel="alternate" type="application/ote+json" href="/events.json">
```

They can also link directly to the reader with:

```text
https://reader.opentechevents.org/?subscribe=https://example.org/events.json
```
