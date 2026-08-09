(function () {
  'use strict';

  var STORAGE = 'ote-reader-state-v1';
  var DEFAULT_FEED = new URL('demo-feed.json', location.href).href;
  var state = {
    feeds: [],
    filters: { q: '', mode: '', language: '', country: '', cfp: false, future: true },
    savedFilters: [],
    savedEvents: []
  };
  var feedCache = new Map();
  var deferredInstall = null;

  var $ = function (id) { return document.getElementById(id); };

  function loadState() {
    try {
      var saved = JSON.parse(localStorage.getItem(STORAGE));
      if (saved && typeof saved === 'object') state = Object.assign(state, saved);
    } catch (e) {
      showMessage('No se pudo leer el estado guardado. Se usará una sesión limpia.', 'warn');
    }
    if (!state.feeds.length) {
      state.feeds.push({ url: DEFAULT_FEED, title: 'Feed demo para asistentes', status: 'pending' });
    }
  }

  function persist() {
    try { localStorage.setItem(STORAGE, JSON.stringify(state)); } catch (e) { /* storage unavailable */ }
  }

  function normaliseUrl(value) {
    return new URL(String(value || '').trim(), location.href).href;
  }

  function isOteFeed(doc) {
    return doc && doc.specVersion === '0.3.0' && Array.isArray(doc.events);
  }

  function isOteEvent(doc) {
    return doc && doc.specVersion === '0.3.0' && doc.id && doc.name && doc.startDate;
  }

  function inherit(feed, event) {
    var out = Object.assign({}, event);
    ['specVersion', 'license', 'textLanguage', 'organizers'].forEach(function (key) {
      if (out[key] == null && feed[key] != null) out[key] = feed[key];
    });
    out._feedTitle = feed.title || 'Evento suelto';
    out._feedUrl = feed._sourceUrl || feed.url || '';
    return out;
  }

  function startAsDate(event) {
    var raw = event.startDate;
    if (!raw) return null;
    if (raw.indexOf('T') === -1) return new Date(raw + 'T00:00:00');
    return new Date(raw);
  }

  function locationText(event) {
    var loc = event.location || {};
    var address = loc.address || {};
    return [loc.venue, address.locality, address.region, address.country, loc.onlineUrl]
      .filter(Boolean).join(' · ');
  }

  function countryOf(event) {
    return event.location && event.location.address && event.location.address.country || '';
  }

  function organizerText(event) {
    return (event.organizers || []).map(function (org) { return org.name; }).filter(Boolean).join(', ');
  }

  function eventHaystack(event) {
    return [
      event.name,
      event.description,
      locationText(event),
      organizerText(event),
      (event.tags || []).join(' '),
      (event.languages || []).join(' ')
    ].join(' ').toLowerCase();
  }

  function cfpIsOpen(event) {
    if (!event.cfp || !event.cfp.url) return false;
    if (!event.cfp.closesAt) return true;
    return new Date(event.cfp.closesAt) >= new Date();
  }

  function matches(event) {
    var filters = state.filters;
    var date = startAsDate(event);
    if (filters.future && date && date < startOfToday()) return false;
    if (filters.mode && event.attendanceMode !== filters.mode) return false;
    if (filters.language && (event.languages || []).indexOf(filters.language) === -1) return false;
    if (filters.country && countryOf(event) !== filters.country) return false;
    if (filters.cfp && !cfpIsOpen(event)) return false;
    if (filters.q) {
      var parts = filters.q.toLowerCase().split(/[\s,]+/).filter(Boolean);
      var haystack = eventHaystack(event);
      if (!parts.every(function (part) { return haystack.indexOf(part) !== -1; })) return false;
    }
    return true;
  }

  function startOfToday() {
    var d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }

  async function loadFeed(feed) {
    feed.status = 'loading';
    renderFeeds();
    try {
      var response = await fetch(feed.url, { headers: { accept: 'application/json,text/html;q=0.9,*/*;q=0.5' } });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      var type = response.headers.get('content-type') || '';
      var doc;
      if (type.indexOf('html') !== -1) {
        var html = await response.text();
        var discovered = discoverInHtml(html, feed.url);
        if (!discovered.length) throw new Error('No encontré cabecera OTE en esa página');
        feed.url = discovered[0].url;
        return loadFeed(feed);
      }
      doc = await response.json();
      var normalised = normaliseDocument(doc, feed.url);
      feed.title = normalised.title;
      feed.status = 'ok';
      feed.updatedAt = normalised.updatedAt || '';
      feedCache.set(feed.url, normalised);
    } catch (error) {
      feed.status = 'error';
      feed.error = error.message || String(error);
    }
    persist();
    render();
  }

  function normaliseDocument(doc, sourceUrl) {
    if (isOteFeed(doc)) {
      doc._sourceUrl = sourceUrl;
      return doc;
    }
    if (isOteEvent(doc)) {
      return {
        specVersion: doc.specVersion,
        title: doc.name,
        url: doc.url || sourceUrl,
        license: doc.license,
        updatedAt: doc.updatedAt || new Date().toISOString(),
        _sourceUrl: sourceUrl,
        events: [doc]
      };
    }
    throw new Error('La URL no parece un evento ni un feed OTE v0.3');
  }

  function discoverInHtml(html, baseUrl) {
    var doc = new DOMParser().parseFromString(html, 'text/html');
    var selectors = [
      'link[rel~="alternate"][type="application/ote+json"]',
      'link[rel~="alternate"][type="application/opentechevents+json"]',
      'link[rel~="alternate"][type="application/vnd.opentechevents.feed+json"]',
      'meta[name="ote-feed"]'
    ];
    return selectors.flatMap(function (selector) {
      return Array.from(doc.querySelectorAll(selector)).map(function (node) {
        var href = node.getAttribute('href') || node.getAttribute('content');
        return href ? { url: new URL(href, baseUrl).href, title: node.getAttribute('title') || '' } : null;
      }).filter(Boolean);
    });
  }

  function allEvents() {
    return Array.from(feedCache.values()).flatMap(function (feed) {
      return (feed.events || []).map(function (event) { return inherit(feed, event); });
    });
  }

  function filteredEvents() {
    return allEvents()
      .filter(matches)
      .sort(function (a, b) {
        return (startAsDate(a) || 0) - (startAsDate(b) || 0);
      });
  }

  function render() {
    renderControls();
    renderFeeds();
    renderSavedFilters();
    renderFacets();
    renderEvents();
  }

  function renderControls() {
    $('q').value = state.filters.q;
    $('mode').value = state.filters.mode;
    $('language').value = state.filters.language;
    $('country').value = state.filters.country;
    $('cfp').checked = state.filters.cfp;
    $('future').checked = state.filters.future;
  }

  function renderFeeds() {
    var box = $('feeds');
    box.replaceChildren();
    state.feeds.forEach(function (feed, index) {
      var row = document.createElement('div');
      row.className = 'feed-row';
      var body = document.createElement('div');
      body.innerHTML = '<div class="feed-title"></div><div class="feed-meta"></div>';
      body.querySelector('.feed-title').textContent = feed.title || 'Feed OTE';
      var meta = feed.status === 'error' ? feed.error : feed.url;
      body.querySelector('.feed-meta').textContent = feed.status + ' · ' + meta;
      var remove = document.createElement('button');
      remove.className = 'remove';
      remove.type = 'button';
      remove.textContent = 'Quitar';
      remove.addEventListener('click', function () {
        feedCache.delete(feed.url);
        state.feeds.splice(index, 1);
        persist();
        render();
      });
      row.append(body, remove);
      box.appendChild(row);
    });
  }

  function renderSavedFilters() {
    var box = $('saved-filters');
    box.replaceChildren();
    if (!state.savedFilters.length) {
      var empty = document.createElement('p');
      empty.textContent = 'Guarda combinaciones como "CFPs en España" o "online + Kubernetes".';
      box.appendChild(empty);
      return;
    }
    state.savedFilters.forEach(function (saved, index) {
      var row = document.createElement('div');
      row.className = 'saved-row';
      var body = document.createElement('button');
      body.className = 'ghost';
      body.type = 'button';
      body.textContent = saved.name;
      body.addEventListener('click', function () {
        state.filters = Object.assign({}, saved.filters);
        persist();
        render();
      });
      var remove = document.createElement('button');
      remove.className = 'remove';
      remove.type = 'button';
      remove.textContent = 'Quitar';
      remove.addEventListener('click', function () {
        state.savedFilters.splice(index, 1);
        persist();
        renderSavedFilters();
      });
      row.append(body, remove);
      box.appendChild(row);
    });
  }

  function renderFacets() {
    var events = allEvents();
    fillSelect('language', unique(events.flatMap(function (e) { return e.languages || []; })), 'Cualquiera');
    fillSelect('country', unique(events.map(countryOf).filter(Boolean)), 'Cualquiera');
    var tags = unique(events.flatMap(function (e) { return e.tags || []; })).slice(0, 18);
    var cloud = $('tag-cloud');
    cloud.replaceChildren();
    tags.forEach(function (tag) {
      var button = document.createElement('button');
      button.className = 'chip' + (state.filters.q.toLowerCase().split(/\s+/).indexOf(tag.toLowerCase()) !== -1 ? ' is-active' : '');
      button.type = 'button';
      button.textContent = '#' + tag;
      button.addEventListener('click', function () {
        var q = state.filters.q.trim();
        state.filters.q = q ? q + ' ' + tag : tag;
        persist();
        render();
      });
      cloud.appendChild(button);
    });
  }

  function fillSelect(id, values, firstLabel) {
    var select = $(id);
    var selected = select.value || state.filters[id] || '';
    select.replaceChildren(new Option(firstLabel, ''));
    values.forEach(function (value) { select.appendChild(new Option(value, value)); });
    select.value = values.indexOf(selected) !== -1 ? selected : '';
    state.filters[id] = select.value;
  }

  function unique(values) {
    return Array.from(new Set(values.filter(Boolean))).sort(function (a, b) {
      return String(a).localeCompare(String(b), 'es', { sensitivity: 'base' });
    });
  }

  function renderEvents() {
    var list = $('event-list');
    var events = filteredEvents();
    list.replaceChildren();
    $('result-count').textContent = events.length + (events.length === 1 ? ' evento' : ' eventos');
    if (!events.length) {
      showMessage('No hay eventos con esos filtros. Prueba a desactivar "Solo futuros" o añade otro feed.', 'warn', true);
      return;
    }
    clearMessages();
    events.forEach(function (event) { list.appendChild(renderEvent(event)); });
  }

  function renderEvent(event) {
    var tpl = $('event-template').content.cloneNode(true);
    var card = tpl.querySelector('.event-card');
    if (event.status === 'cancelled') card.classList.add('is-cancelled');
    var date = startAsDate(event);
    tpl.querySelector('.event-date').innerHTML = date
      ? '<span>' + date.toLocaleString('es', { month: 'short' }) + '</span>' + date.getDate()
      : '<span>sin</span>fecha';
    tpl.querySelector('.event-topline').textContent = [event._feedTitle, organizerText(event)].filter(Boolean).join(' · ');
    tpl.querySelector('h3').textContent = event.name;
    tpl.querySelector('.event-description').textContent = event.description || 'Sin descripción en el feed.';
    tpl.querySelector('.event-meta').textContent = [
      formatDate(event),
      event.attendanceMode || '',
      locationText(event),
      (event.languages || []).join(', ')
    ].filter(Boolean).join(' · ');
    var tags = tpl.querySelector('.event-tags');
    (event.tags || []).forEach(function (tag) {
      var item = document.createElement('span');
      item.className = 'tag';
      item.textContent = '#' + tag;
      tags.appendChild(item);
    });
    if (cfpIsOpen(event)) tags.appendChild(pill('CFP abierto', 'ok'));
    if (event.status === 'cancelled') tags.appendChild(pill('Cancelado', 'warn'));
    var link = tpl.querySelector('.primary-link');
    link.href = event.url || event.cfp && event.cfp.url || event._feedUrl || event.id;
    var save = tpl.querySelector('.save-event');
    var saved = state.savedEvents.indexOf(event.id) !== -1;
    save.textContent = saved ? 'Guardado' : 'Guardar';
    save.addEventListener('click', function () {
      var i = state.savedEvents.indexOf(event.id);
      if (i === -1) state.savedEvents.push(event.id);
      else state.savedEvents.splice(i, 1);
      persist();
      renderEvents();
    });
    tpl.querySelector('.calendar-event').addEventListener('click', function () {
      downloadIcs(event);
    });
    return tpl;
  }

  function pill(text, kind) {
    var span = document.createElement('span');
    span.className = 'pill ' + kind;
    span.textContent = text;
    return span;
  }

  function formatDate(event) {
    var date = startAsDate(event);
    if (!date) return '';
    if (event.startDate.indexOf('T') === -1) {
      return date.toLocaleDateString('es', { dateStyle: 'medium' });
    }
    return date.toLocaleString('es', { dateStyle: 'medium', timeStyle: 'short' }) + ' · ' + event.timezone;
  }

  function downloadIcs(event) {
    var ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//OpenTechEvents//OTE Reader MVP//ES',
      'BEGIN:VEVENT',
      'UID:' + escapeIcs(event.id),
      'SUMMARY:' + escapeIcs(event.name),
      'DESCRIPTION:' + escapeIcs(event.description || ''),
      'URL:' + escapeIcs(event.url || event.id),
      event.location ? 'LOCATION:' + escapeIcs(locationText(event)) : '',
      'DTSTART:' + toIcsDate(event.startDate),
      event.endDate ? 'DTEND:' + toIcsDate(event.endDate) : '',
      'END:VEVENT',
      'END:VCALENDAR'
    ].filter(Boolean).join('\r\n');
    var blob = new Blob([ics], { type: 'text/calendar' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = slug(event.name) + '.ics';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function toIcsDate(value) {
    return value.replace(/[-:]/g, '').replace('T', 'T');
  }

  function escapeIcs(value) {
    return String(value || '').replace(/[\\;,]/g, '\\$&').replace(/\n/g, '\\n');
  }

  function slug(value) {
    return String(value || 'event').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'event';
  }

  function showMessage(text, kind, replace) {
    var box = $('messages');
    if (replace) box.replaceChildren();
    var msg = document.createElement('p');
    msg.className = 'message ' + (kind || '');
    msg.textContent = text;
    box.appendChild(msg);
  }

  function clearMessages() {
    $('messages').replaceChildren();
  }

  function subscribe(rawUrl) {
    var url;
    try { url = normaliseUrl(rawUrl); } catch (e) {
      showMessage('La URL no parece válida.', 'warn', true);
      return;
    }
    var existing = state.feeds.find(function (feed) { return feed.url === url; });
    if (existing) return loadFeed(existing);
    var feed = { url: url, status: 'pending' };
    state.feeds.push(feed);
    persist();
    loadFeed(feed);
  }

  function bind() {
    $('subscribe-form').addEventListener('submit', function (event) {
      event.preventDefault();
      subscribe($('feed-url').value);
      $('feed-url').value = '';
    });
    ['q', 'mode', 'language', 'country', 'cfp', 'future'].forEach(function (id) {
      $(id).addEventListener('input', function () {
        state.filters[id] = this.type === 'checkbox' ? this.checked : this.value;
        persist();
        render();
      });
    });
    $('refresh').addEventListener('click', function () {
      state.feeds.forEach(loadFeed);
    });
    $('save-filter').addEventListener('click', function () {
      var name = prompt('Nombre del filtro');
      if (!name) return;
      state.savedFilters.push({ name: name.trim(), filters: Object.assign({}, state.filters) });
      persist();
      renderSavedFilters();
    });
    window.addEventListener('beforeinstallprompt', function (event) {
      event.preventDefault();
      deferredInstall = event;
      $('install-button').hidden = false;
    });
    $('install-button').addEventListener('click', async function () {
      if (!deferredInstall) return;
      deferredInstall.prompt();
      await deferredInstall.userChoice;
      deferredInstall = null;
      $('install-button').hidden = true;
    });
  }

  function applySubscribeParam() {
    var params = new URLSearchParams(location.search);
    var url = params.get('subscribe') || params.get('feed');
    if (url) subscribe(url);
  }

  async function boot() {
    loadState();
    bind();
    render();
    applySubscribeParam();
    await Promise.all(state.feeds.map(loadFeed));
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    }
  }

  boot();
}());
