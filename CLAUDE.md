# OTE Reader

Attendee-facing PWA for subscribing to OpenTechEvents feeds. Vanilla JS
(`app.js`), no build step — `<ote-events>` is loaded from a versioned CDN
URL in `index.html`, not vendored.

## Release checklist

Whenever a change is user-facing (new feature, fix, behavior change),
update these together before considering the task done:

1. Add an entry to `CHANGELOG.md` under a new version heading (date =
   today, semver: patch for fixes, minor for features, major for breaking
   changes).
2. Bump the version to match in both `package.json` (`version`) and
   `app.js` (`APP_VERSION` constant, near the top). `APP_VERSION` is what
   renders in the Ajustes modal (`#app-version` in `index.html`) — no
   separate manual edit needed there.

Internal/invisible changes (refactors, tooling, comments) don't need a
version bump or changelog entry.

## When the OTE spec publishes a new version

The support window is the last three minors, computed — not listed — so
one edit moves it:

1. Append the new version to `PUBLISHED_SPEC_VERSIONS` in `app.js`. The
   window, the latest version and every message derive from it.
2. Update the **OTE spec badge range** at the top of `README.md` (e.g.
   `v0.4 – v0.6`). This is the one thing nothing checks for you — see
   below.

`npm run check` reads the npm registry and the published event schema and
fails when `PUBLISHED_SPEC_VERSIONS` or `INHERITED_FEED_FIELDS` in
`app.js` have drifted from them. It does **not** look at the README, so
the badge goes stale silently.

A document is always judged against the version it *declares*, never
against the latest one, and a feed outside the window still opens — being
on an older release is a notice, never a defect, and no message blames
the publisher. Deliberately no dependency on `@opentechevents/validate`:
a reader must be more tolerant than a validator. The reasoning is in
README under "OTE spec version support"; don't re-litigate it without
reading that first.

## When `<ote-events>` publishes a new version

The widget is pinned by URL in `index.html` (`/embed/vX.Y.Z/`) and is a
separate version line from the OTE spec — the widget's own
`oteSpecVersion` says which spec release it targets, and it lags. Before
bumping, check the widget's **source** for the attributes and properties
this app sets (`layout`, `group-events`, `fields-preview`,
`fields-detail`, `show-past`, `sort`, `event-actions`, `theme`, and
`events` / `eventActions` / `eventClassName` / `eventBadges`), then
verify in a browser — the reader renders nothing itself, so a widget
regression is invisible to `npm run check`.
