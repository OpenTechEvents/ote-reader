# OTE Reader

Attendee-facing MVP for OpenTechEvents feeds.

The first version is a static PWA that lets people:

- subscribe to OTE feeds or standalone OTE event URLs;
- discover feeds from pages that expose an OTE `<link rel="alternate">`;
- filter events by topic, attendance mode, language, country and open CFP;
- save filters and events locally;
- export single events as `.ics`.

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
https://opentechevents.github.io/ote-reader/?subscribe=https://example.org/events.json
```
