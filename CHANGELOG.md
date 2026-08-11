# OTE Reader changelog

## Unreleased

### Changed

- `?subscribe=` / `?feed=` URL parameters now open the manual subscription
  modal with the feed URL pre-filled instead of subscribing immediately,
  so the user confirms before a feed is added. No dialog is shown if the
  feed is already subscribed. ([#1](https://github.com/OpenTechEvents/ote-reader/issues/1))
