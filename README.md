# OTE Reader

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
