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
