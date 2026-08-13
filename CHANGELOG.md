# OTE Reader changelog

## 0.5.0 - 2026-08-13

### Added

- The feed "Edit" modal now lets you change the feed's URL, so you can fix
  a subscription after its address moves without having to unsubscribe and
  resubscribe. When a feed fails to load, the modal shows the fetch error
  inline as a hint.

## 0.4.0 - 2026-08-13

### Added

- A chevron next to "Suscribirme" in the discover-feeds catalog opens a
  folder picker, so you can subscribe straight into a specific folder
  instead of always landing in the default one.

## 0.3.1 - 2026-08-13

### Changed

- Reorganized the sidebar's "..." menus: moved "Create New Folder" into
  the "+" menu next to it, dropped "Manage Feeds" and "Folder settings"
  (they duplicated the discovery catalog and the Rename/Delete actions
  already in the same menu), and merged the feed menu's "Rename"/"Manage
  Feed" into a single "Edit" entry.

## 0.3.0 - 2026-08-13

### Added

- An "Agrupar series" toggle next to the card view button that collapses
  events sharing the same `partOf.id` into a single stacked card, enabled
  by default. Only shown in card view, since grouping only applies there.

### Changed

- Upgraded the `<ote-events>` embed to
  [v0.4.0](https://github.com/OpenTechEvents/ote-tools/releases/tag/embed-v0.4.0),
  which adds the `group-events` attribute the series toggle relies on.

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
