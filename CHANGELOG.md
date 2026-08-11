# OTE Reader changelog

## 0.2.0 - 2026-08-12

### Fixed

- Removed the per-card feed-name badge: it was redundant with the sidebar
  grouping and, for feeds with a long title, could squeeze the card layout.
- Upgraded the `<ote-events>` embed to
  [v0.3.1](https://github.com/OpenTechEvents/ote-tools/releases/tag/embed-v0.3.1),
  which keeps any long custom badge label from breaking the card/list layout.

### Changed

- `?subscribe=` / `?feed=` URL parameters now open the manual subscription
  modal with the feed URL pre-filled instead of subscribing immediately,
  so the user confirms before a feed is added. No dialog is shown if the
  feed is already subscribed. ([#1](https://github.com/OpenTechEvents/ote-reader/issues/1))
- Demo feeds (`demo-feed.json` and the directory samples) now only load in
  demo mode (`?demo=1` or `/demo/`), instead of seeding automatically for
  every first-time visitor with an empty state.

### Added

- An empty state ("Empieza con tus propias fuentes OTE") with actions to
  add a feed, discover feeds, or open the demo, shown when there are no
  subscribed feeds.
- A dismissible "Estás viendo la demo" hello bar with a "Salir de la demo"
  action when running in demo mode, including breaking out of the `/demo/`
  iframe wrapper back to the top-level reader.
