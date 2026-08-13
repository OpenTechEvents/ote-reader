(function () {
  'use strict';

  var APP_VERSION = '0.5.0';
  var DEMO_MODE = new URLSearchParams(location.search).get('demo') === '1' || location.pathname.replace(/\/+$/, '').endsWith('/demo');
  var STORAGE = DEMO_MODE ? 'ote-reader-demo-state-v1' : 'ote-reader-state-v1';
  var INSTALL_DISMISSED = 'ote-reader-install-dismissed-v1';
  var THEME_STORAGE = 'ote-reader-theme-v1';
  var WIDTH_STORAGE = 'ote-reader-width-v1';
  var ADOPTERS_URL = 'https://opentechevents.org/data/adopters.json';
  var DEMO_FEEDS = [
    { url: new URL('demo-feed.json', document.baseURI).href, title: 'Feed demo' }
  ];
  var DIRECTORY_DEMO_FEEDS = [
    { url: new URL('eventos-wiki-demo-feed.json', document.baseURI).href, title: 'Eventos Wiki demo' },
    { url: new URL('techconf-demo-feed.json', document.baseURI).href, title: 'TechConf España demo' }
  ];
  var DIRECTORY_FOLDER = 'Directorios OTE';
  var DEFAULT_FOLDERS = ['Conferencias', 'Eventos Almería', 'CFP para charlas'];
  var FOLDER_EXAMPLES = DEFAULT_FOLDERS.concat(['Feeds de directorios OTE', 'Meetups locales', 'Online', 'Eventos para juniors']);
  var state = {
    feeds: [],
    categories: [],
    boards: [],
    folderTemplatesAdded: false,
    directorySamplesAdded: false,
    activeSource: { type: 'all', id: 'all' },
    filters: { q: '', mode: '', language: '', country: '', cfp: false, future: true },
    savedFilters: [],
    savedEvents: [],
    view: 'cards',
    groupSeries: true
  };
  var feedCache = new Map();
  var adopterCache = null;
  var deferredInstall = null;
  var optionsContext = null;
  var editingCategoryId = null;
  var boardEventContext = null;
  var embedReady = false;
  var subscribeState = { phase: 'idle' };
  var previewMode = null;

  var $ = function (id) { return document.getElementById(id); };

  function initTheme() {
    var saved = '';
    try { saved = localStorage.getItem(THEME_STORAGE) || ''; } catch (e) { /* storage unavailable */ }
    var dark = saved ? saved === 'dark' : window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    applyTheme(dark ? 'dark' : 'light');
  }

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    if ($('event-list')) $('event-list').setAttribute('theme', theme);
    var dark = theme === 'dark';
    var toggle = $('theme-toggle');
    if (toggle) {
      toggle.textContent = dark ? '☀' : '◐';
      toggle.setAttribute('aria-pressed', String(dark));
      toggle.setAttribute('aria-label', dark ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro');
    }
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', dark ? '#0d1118' : '#10131a');
  }

  function toggleTheme() {
    var next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    try { localStorage.setItem(THEME_STORAGE, next); } catch (e) { /* storage unavailable */ }
  }

  function initWidthPreference() {
    var saved = 'comfortable';
    try { saved = localStorage.getItem(WIDTH_STORAGE) || saved; } catch (e) { /* storage unavailable */ }
    applyWidthPreference(saved === 'full' ? 'full' : 'comfortable');
  }

  function applyWidthPreference(value) {
    var next = value === 'full' ? 'full' : 'comfortable';
    document.documentElement.dataset.width = next;
    if ($('app-width')) $('app-width').value = next;
  }

  function loadState() {
    try {
      var saved = JSON.parse(localStorage.getItem(STORAGE));
      if (saved && typeof saved === 'object') {
        state = Object.assign(state, saved);
        state.filters = Object.assign({ q: '', mode: '', language: '', country: '', cfp: false, future: true }, state.filters || {});
        state.categories = state.categories || [];
        state.boards = state.boards || [];
        state.folderTemplatesAdded = Boolean(state.folderTemplatesAdded);
        state.directorySamplesAdded = Boolean(state.directorySamplesAdded);
        state.activeSource = state.activeSource || { type: 'all', id: 'all' };
        state.savedFilters = state.savedFilters || [];
        state.savedEvents = state.savedEvents || [];
        state.view = state.view || 'cards';
        state.filters.q = normaliseQuery(state.filters.q || '');
      }
    } catch (e) {
      showMessage('No se pudo leer el estado guardado. Se usará una sesión limpia.', 'warn');
    }
    if (DEMO_MODE && !state.feeds.length) {
      DEMO_FEEDS.forEach(function (feed) {
        state.feeds.push({ url: feed.url, title: feed.title, status: 'pending' });
      });
    }
    migrateCategories();
    if (DEMO_MODE) seedDirectoryDemoFeeds();
    migrateBoards();
    persist();
  }

  function migrateBoards() {
    if (!state.boards.length) {
      state.boards.push({ id: 'favorites', name: 'Favorites', eventRefs: [] });
    }
    if (!state.boards.some(function (board) { return board.id === 'my-talks'; })) {
      state.boards.push({ id: 'my-talks', name: 'Mis charlas', eventRefs: [] });
    }
    state.boards.forEach(function (board) {
      board.eventRefs = board.eventRefs || [];
    });
  }

  function migrateCategories() {
    if (!state.categories.length && state.feeds.length) {
      state.categories.push({
        id: 'community',
        name: 'Community feeds',
        open: true,
        feedUrls: state.feeds.map(function (feed) { return feed.url; })
      });
    }
    if (DEMO_MODE) seedDefaultFolders();
    if (!state.categories.length) return;
    var known = new Set(state.categories.flatMap(function (category) { return category.feedUrls || []; }));
    var missing = state.feeds.map(function (feed) { return feed.url; }).filter(function (url) { return !known.has(url); });
    if (missing.length) state.categories[0].feedUrls = unique((state.categories[0].feedUrls || []).concat(missing));
  }

  function seedDirectoryDemoFeeds() {
    if (state.directorySamplesAdded) return;
    DIRECTORY_DEMO_FEEDS.forEach(function (sample) {
      var exists = state.feeds.some(function (feed) { return feed.url === sample.url; });
      if (!exists) state.feeds.push({ url: sample.url, title: sample.title, status: 'pending' });
    });
    moveDemoFeedsToDirectoryFolder();
    state.directorySamplesAdded = true;
  }

  function moveDemoFeedsToDirectoryFolder() {
    var urls = DIRECTORY_DEMO_FEEDS.map(function (feed) { return feed.url; });
    var folder = state.categories.find(function (category) {
      return category.name.toLowerCase() === DIRECTORY_FOLDER.toLowerCase();
    });
    if (!folder) {
      folder = { id: slug(DIRECTORY_FOLDER), name: DIRECTORY_FOLDER, open: true, feedUrls: [] };
      state.categories.push(folder);
    }
    state.categories.forEach(function (category) {
      category.feedUrls = (category.feedUrls || []).filter(function (url) {
        return urls.indexOf(url) === -1;
      });
    });
    folder.feedUrls = unique((folder.feedUrls || []).concat(urls));
  }

  function seedDefaultFolders() {
    if (state.folderTemplatesAdded) return;
    DEFAULT_FOLDERS.forEach(function (name) {
      var exists = state.categories.some(function (category) {
        return category.name.toLowerCase() === name.toLowerCase();
      });
      if (!exists) state.categories.push({ id: slug(name), name: name, open: true, feedUrls: [] });
    });
    state.folderTemplatesAdded = true;
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

  function updatedAsDate(event) {
    return event.updatedAt ? new Date(event.updatedAt) : startAsDate(event);
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
    return matchesWithFilters(event, state.filters);
  }

  function matchesWithFilters(event, filters) {
    var date = startAsDate(event);
    if (filters.future && date && date < startOfToday()) return false;
    if (filters.mode && event.attendanceMode !== filters.mode) return false;
    if (filters.language && (event.languages || []).indexOf(filters.language) === -1) return false;
    if (filters.country && countryOf(event) !== filters.country) return false;
    if (filters.cfp && !cfpIsOpen(event)) return false;
    if (filters.q) {
      var parts = queryTerms(filters.q);
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

  async function fetchOteDocument(url) {
    var response = await fetch(url, { headers: { accept: 'application/json,text/html;q=0.9,*/*;q=0.5' } });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    var type = response.headers.get('content-type') || '';
    if (type.indexOf('html') !== -1) {
      var html = await response.text();
      var discovered = discoverInHtml(html, url);
      if (!discovered.length) throw new Error('No encontré cabecera OTE en esa página');
      return fetchOteDocument(discovered[0].url);
    }
    var raw = await response.json();
    return { url: url, doc: normaliseDocument(raw, url) };
  }

  async function loadFeed(feed) {
    feed.status = 'loading';
    renderLibrary();
    try {
      var result = await fetchOteDocument(feed.url);
      feed.url = result.url;
      feed.title = feed.customTitle || result.doc.title;
      feed.status = 'ok';
      feed.updatedAt = result.doc.updatedAt || '';
      feedCache.set(feed.url, result.doc);
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

  function sourceEvents() {
    if (previewMode) {
      return (previewMode.doc.events || []).map(function (event) { return inherit(previewMode.doc, event); });
    }
    var events = allEvents();
    if (!state.activeSource || state.activeSource.type === 'all') return events;
    if (state.activeSource.type === 'feed') {
      return events.filter(function (event) { return event._feedUrl === state.activeSource.id; });
    }
    if (state.activeSource.type === 'category') {
      var category = findCategory(state.activeSource.id);
      var urls = new Set(category ? category.feedUrls || [] : []);
      return events.filter(function (event) { return urls.has(event._feedUrl); });
    }
    if (state.activeSource.type === 'board') {
      return boardEvents(findBoard(state.activeSource.id));
    }
    return events;
  }

  function filteredEvents() {
    var events = sourceEvents().filter(matches);
    if (state.view === 'feed') {
      return events.sort(function (a, b) {
        return (updatedAsDate(b) || 0) - (updatedAsDate(a) || 0);
      });
    }
    return events.sort(function (a, b) {
      return (startAsDate(a) || 0) - (startAsDate(b) || 0);
    });
  }

  function render() {
    renderControls();
    renderLibrary();
    renderBoards();
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
    document.querySelectorAll('[data-view]').forEach(function (button) {
      button.classList.toggle('is-active', button.dataset.view === state.view);
      button.setAttribute('aria-pressed', String(button.dataset.view === state.view));
    });
    $('group-series-wrap').hidden = state.view !== 'cards';
    $('group-series').checked = state.groupSeries;
  }

  function renderLibrary() {
    var box = $('library');
    box.replaceChildren();
    box.appendChild(libraryRow({
      title: 'All',
      meta: '',
      count: visibleUnreadCount({ type: 'all', id: 'all' }),
      active: isActiveSource('all', 'all'),
      onClick: function () { setActiveSource('all', 'all'); closeSidebar(); },
      className: 'library-all',
      menu: function (event) { openContextMenu(event, { type: 'all', id: 'all' }); },
      context: { type: 'all', id: 'all' }
    }));

    state.categories.forEach(function (category) {
      box.appendChild(libraryRow({
        title: category.name,
        meta: '',
        count: visibleUnreadCount({ type: 'category', id: category.id }),
        active: isActiveSource('category', category.id),
        unread: categoryHasUnread(category),
        onClick: function () { setActiveSource('category', category.id); closeSidebar(); },
        className: 'category-row',
        menu: function (event) { openContextMenu(event, { type: 'category', id: category.id }); },
        chevron: category.open !== false ? '▾' : '▸',
        onChevron: function () { toggleCategory(category); },
        editing: editingCategoryId === category.id,
        onRename: function (name) { finishCategoryRename(category, name); },
        onCancelRename: function () { cancelCategoryRename(); },
        context: { type: 'category', id: category.id },
        dropCategoryId: category.id
      }));

      if (category.open !== false) {
        (category.feedUrls || []).forEach(function (url) {
          var feed = findFeed(url);
          if (!feed) return;
          box.appendChild(libraryRow({
            title: feed.title || 'Feed OTE',
            meta: feed.status === 'error' ? feed.error : '',
            count: visibleUnreadCount({ type: 'feed', id: feed.url }),
            active: isActiveSource('feed', feed.url),
            unread: feedHasUnread(feed),
            onClick: function () { setActiveSource('feed', feed.url); closeSidebar(); },
            className: 'feed-row nested',
            menu: function (event) { openContextMenu(event, { type: 'feed', id: feed.url }); },
            context: { type: 'feed', id: feed.url },
            dragUrl: feed.url
          }));
        });
      }
    });
  }

  function libraryRow(options) {
    var row = document.createElement('div');
    row.className = 'library-row ' + (options.className || '') + (options.active ? ' is-active' : '');
    if (options.chevron) row.classList.add('has-chevron');
    if (options.context) {
      row.addEventListener('contextmenu', function (event) {
        event.preventDefault();
        openContextMenu(event, options.context);
      });
    }
    if (options.unread) row.classList.add('has-unread');
    if (options.dragUrl) {
      row.draggable = true;
      row.dataset.feedUrl = options.dragUrl;
      row.addEventListener('dragstart', function (event) {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', options.dragUrl);
      });
    }
    if (options.dropCategoryId) {
      row.dataset.categoryId = options.dropCategoryId;
      row.addEventListener('dragover', function (event) {
        event.preventDefault();
        row.classList.add('is-drop-target');
      });
      row.addEventListener('dragleave', function () {
        row.classList.remove('is-drop-target');
      });
      row.addEventListener('drop', function (event) {
        event.preventDefault();
        row.classList.remove('is-drop-target');
        moveFeedToCategoryId(event.dataTransfer.getData('text/plain'), options.dropCategoryId);
      });
    }
    var main = document.createElement(options.editing ? 'div' : 'button');
    if (!options.editing) main.type = 'button';
    main.className = 'library-main';
    if (!options.editing) main.addEventListener('click', options.onClick);
    if (options.chevron) {
      var chevron = document.createElement('button');
      chevron.className = 'chevron-button';
      chevron.type = 'button';
      chevron.textContent = options.chevron;
      chevron.setAttribute('aria-label', options.chevron === '▸' ? 'Expandir folder' : 'Plegar folder');
      chevron.addEventListener('click', function (event) {
        event.stopPropagation();
        options.onChevron();
      });
      row.appendChild(chevron);
    }
    var body = document.createElement('span');
    body.className = 'library-body';
    var title = options.editing ? document.createElement('input') : document.createElement('span');
    title.className = options.editing ? 'inline-name-input' : 'feed-title';
    if (options.editing) {
      title.value = options.title;
      title.addEventListener('click', function (event) { event.stopPropagation(); });
      title.addEventListener('keydown', function (event) {
        if (event.key === 'Enter') title.blur();
        if (event.key === 'Escape') {
          event.preventDefault();
          options.onCancelRename();
        }
      });
      title.addEventListener('blur', function () {
        options.onRename(title.value);
      });
      setTimeout(function () {
        title.focus();
        title.select();
      }, 0);
    } else {
      title.textContent = options.title;
    }
    var meta = document.createElement('span');
    meta.className = 'feed-meta';
    meta.textContent = options.meta || '';
    body.append(title, meta);
    main.appendChild(body);
    row.appendChild(main);
    if (options.menu) {
      var menu = document.createElement('button');
      menu.className = 'icon-button small';
      menu.type = 'button';
      menu.textContent = '...';
      menu.setAttribute('aria-label', 'Opciones');
      menu.addEventListener('click', function (event) {
        event.stopPropagation();
        options.menu(event);
      });
      row.appendChild(menu);
    }
    if (options.count != null) {
      var count = document.createElement('span');
      count.className = 'library-count';
      count.textContent = String(options.count);
      row.appendChild(count);
    }
    return row;
  }

  function feedHasUnread(feed) {
    var latest = latestFeedActivity(feed);
    if (!latest) return !feed.lastSeenAt && feed.status === 'ok';
    if (!feed.lastSeenAt) return feed.status === 'ok';
    return latest > new Date(feed.lastSeenAt);
  }

  function categoryHasUnread(category) {
    return Boolean(category && (category.feedUrls || []).some(function (url) {
      return feedHasUnread(findFeed(url));
    }));
  }

  function latestFeedActivity(feed) {
    var cached = feedCache.get(feed.url);
    var dates = [feed.updatedAt];
    if (cached) {
      dates = dates.concat((cached.events || []).map(function (event) {
        return event.updatedAt;
      }));
    }
    return dates.map(function (value) { return value ? new Date(value) : null; })
      .filter(function (date) { return date && !Number.isNaN(date.getTime()); })
      .sort(function (a, b) { return b - a; })[0] || null;
  }

  function setActiveSource(type, id) {
    if (previewMode) {
      previewMode = null;
      updatePreviewControls();
    }
    state.activeSource = { type: type, id: id };
    persist();
    render();
  }

  function isActiveSource(type, id) {
    if (previewMode) return false;
    return state.activeSource && state.activeSource.type === type && state.activeSource.id === id;
  }

  function sourceCount(source) {
    if (!source || source.type === 'all') return allEvents().length;
    if (source.type === 'feed') return allEvents().filter(function (event) { return event._feedUrl === source.id; }).length;
    if (source.type === 'category') {
      var category = findCategory(source.id);
      var urls = new Set(category ? category.feedUrls || [] : []);
      return allEvents().filter(function (event) { return urls.has(event._feedUrl); }).length;
    }
    if (source.type === 'board') return boardEvents(findBoard(source.id)).length;
    return 0;
  }

  function visibleUnreadCount(source) {
    var count = unreadCount(source);
    return count > 0 ? count : null;
  }

  function unreadCount(source) {
    if (!source || source.type === 'all') {
      return state.feeds.reduce(function (sum, feed) { return sum + unreadFeedCount(feed); }, 0);
    }
    if (source.type === 'feed') return unreadFeedCount(findFeed(source.id));
    if (source.type === 'category') {
      var category = findCategory(source.id);
      return (category ? category.feedUrls || [] : []).reduce(function (sum, url) {
        return sum + unreadFeedCount(findFeed(url));
      }, 0);
    }
    return 0;
  }

  function unreadFeedCount(feed) {
    if (!feed || feed.status !== 'ok') return 0;
    var cached = feedCache.get(feed.url);
    var events = cached ? cached.events || [] : [];
    if (!events.length) return feedHasUnread(feed) ? 1 : 0;
    if (!feed.lastSeenAt) return events.length;
    var seenAt = new Date(feed.lastSeenAt);
    return events.filter(function (event) {
      var activity = event.updatedAt ? new Date(event.updatedAt) : null;
      return activity && !Number.isNaN(activity.getTime()) && activity > seenAt;
    }).length;
  }

  function openFeedOptions(feed) {
    optionsContext = { type: 'feed', id: feed.url };
    $('options-title').textContent = feed.title || 'Feed OTE';
    $('options-name').value = feed.title || '';
    $('options-url').value = feed.url || '';
    var errorHint = $('options-error');
    if (feed.status === 'error' && feed.error) {
      errorHint.textContent = 'No se pudo cargar: ' + feed.error + '. Puedes corregir la URL.';
      errorHint.hidden = false;
    } else {
      errorHint.hidden = true;
    }
    fillFolderOptions(feed.url);
    openModal('options-modal');
  }

  function fillFolderOptions(feedUrl) {
    var select = $('options-folder');
    select.replaceChildren();
    state.categories.forEach(function (category) {
      var option = document.createElement('option');
      option.value = category.id;
      option.textContent = category.name;
      option.selected = (category.feedUrls || []).indexOf(feedUrl) !== -1;
      select.appendChild(option);
    });
  }

  function saveOptions() {
    if (!optionsContext) return;
    var feed = findFeed(optionsContext.id);
    if (!feed) return;
    var name = $('options-name').value.trim();
    if (name) {
      feed.customTitle = name;
      feed.title = name;
    }
    var urlChanged = false;
    var rawUrl = $('options-url').value.trim();
    var errorHint = $('options-error');
    if (rawUrl) {
      var newUrl;
      try { newUrl = normaliseUrl(rawUrl); } catch (e) {
        errorHint.textContent = 'La URL no parece válida.';
        errorHint.hidden = false;
        return;
      }
      if (newUrl !== feed.url) {
        if (state.feeds.some(function (item) { return item !== feed && item.url === newUrl; })) {
          errorHint.textContent = 'Ya hay una suscripción con esa URL.';
          errorHint.hidden = false;
          return;
        }
        renameFeedUrl(feed, newUrl);
        urlChanged = true;
      }
    }
    moveFeedToCategoryId(feed.url, $('options-folder').value);
    closeModal('options-modal');
    persist();
    render();
    if (urlChanged) loadFeed(feed);
  }

  function renameFeedUrl(feed, newUrl) {
    var oldUrl = feed.url;
    feedCache.delete(oldUrl);
    feed.url = newUrl;
    feed.status = 'pending';
    feed.error = '';
    state.categories.forEach(function (category) {
      category.feedUrls = (category.feedUrls || []).map(function (url) {
        return url === oldUrl ? newUrl : url;
      });
    });
    state.boards.forEach(function (board) {
      (board.eventRefs || []).forEach(function (ref) {
        if (ref.feedUrl === oldUrl) ref.feedUrl = newUrl;
      });
    });
    if (isActiveSource('feed', oldUrl)) state.activeSource = { type: 'feed', id: newUrl };
  }

  function openContextMenu(event, context) {
    event.preventDefault();
    optionsContext = context;
    showMenu(event, contextMenuItems(context));
  }

  function showMenu(event, items) {
    var menu = $('context-menu');
    menu.replaceChildren();
    items.forEach(function (item) {
      if (item === 'separator') {
        var separator = document.createElement('div');
        separator.className = 'context-separator';
        menu.appendChild(separator);
        return;
      }
      var button = document.createElement('button');
      button.type = 'button';
      button.className = item.danger ? 'context-danger' : '';
      button.innerHTML = '<span class="context-icon">' + item.icon + '</span><span>' + item.label + '</span>';
      button.addEventListener('click', function () {
        closeContextMenu();
        item.action();
      });
      menu.appendChild(button);
    });
    // Native <dialog> content renders in the top layer; a menu left under
    // <body> would be stuck behind an open dialog regardless of z-index.
    menuHost().appendChild(menu);
    positionContextMenu(menu, event.clientX, event.clientY);
    menu.hidden = false;
  }

  function menuHost() {
    return document.querySelector('dialog[open]') || document.body;
  }

  function openFolderPicker(event, url) {
    event.stopPropagation();
    var items = state.categories.map(function (category) {
      return {
        icon: '📁',
        label: category.name,
        action: function () {
          subscribe(url, category.id);
          renderSources();
        }
      };
    });
    showMenu(event, items);
  }

  function contextMenuItems(context) {
    if (context.type === 'all') {
      return [
        { icon: '✓', label: 'Mark as Read', action: markVisibleFeedsRead },
        { icon: '↻', label: 'Refresh feeds', action: function () { state.feeds.forEach(loadFeed); } }
      ];
    }
    if (context.type === 'category') {
      var category = findCategory(context.id);
      return [
        { icon: '✓', label: 'Mark as Read', action: function () { markCategoryRead(category); } },
        { icon: '⟷', label: 'Rename', action: function () { startCategoryRename(category); } },
        'separator',
        { icon: '⌫', label: 'Delete', danger: true, action: function () { deleteCategoryWithConfirm(category); } }
      ];
    }
    if (context.type === 'board') {
      var board = findBoard(context.id);
      return [
        { icon: '⟷', label: 'Rename', action: function () { renameBoard(board); } },
        { icon: '×', label: 'Vaciar colección', action: function () { clearBoard(board); } },
        'separator',
        { icon: '⌫', label: 'Delete', danger: true, action: function () { deleteBoard(board); } }
      ];
    }
    var feed = findFeed(context.id);
    return [
      { icon: '✓', label: 'Mark as Read', action: function () { markFeedRead(feed); } },
      { icon: '⚙', label: 'Edit', action: function () { openFeedOptions(feed); } },
      { icon: '↻', label: 'Refresh', action: function () { loadFeed(feed); } },
      'separator',
      { icon: '⌫', label: 'Delete', danger: true, action: function () { deleteFeedWithConfirm(feed); } }
    ];
  }

  function positionContextMenu(menu, x, y) {
    menu.style.left = '0px';
    menu.style.top = '0px';
    var width = 280;
    var height = Math.min(420, menu.childElementCount * 52);
    menu.style.left = Math.max(8, Math.min(x, window.innerWidth - width - 8)) + 'px';
    menu.style.top = Math.max(8, Math.min(y, window.innerHeight - height - 8)) + 'px';
  }

  function closeContextMenu() {
    $('context-menu').hidden = true;
  }

  function toggleCategory(category) {
    if (!category) return;
    category.open = category.open === false;
    persist();
    renderLibrary();
  }

  function startCategoryRename(category) {
    if (!category) return;
    editingCategoryId = category.id;
    renderLibrary();
  }

  function finishCategoryRename(category, name) {
    editingCategoryId = null;
    var next = String(name || '').trim();
    if (category && next) category.name = next;
    persist();
    render();
  }

  function cancelCategoryRename() {
    editingCategoryId = null;
    renderLibrary();
  }

  function createFolder() {
    var name = prompt('Nombre del folder\n\nIdeas: ' + FOLDER_EXAMPLES.join(', '), 'Conferencias');
    if (!name) return;
    state.categories.push({ id: slug(name) + '-' + Date.now().toString(36), name: name.trim(), open: true, feedUrls: [] });
    persist();
    renderLibrary();
  }

  function removeCategory(id) {
    var index = state.categories.findIndex(function (category) { return category.id === id; });
    if (index === -1) return;
    var removed = state.categories.splice(index, 1)[0];
    if (!state.categories.length) state.categories.push({ id: 'community', name: 'Community feeds', open: true, feedUrls: [] });
    state.categories[0].feedUrls = unique((state.categories[0].feedUrls || []).concat(removed.feedUrls || []));
    if (isActiveSource('category', id)) state.activeSource = { type: 'all', id: 'all' };
  }

  function moveFeedToCategory(feedUrl, categoryName) {
    var category = state.categories.find(function (item) {
      return item.name.toLowerCase() === categoryName.toLowerCase();
    });
    if (!category) {
      category = { id: slug(categoryName) + '-' + Date.now().toString(36), name: categoryName, open: true, feedUrls: [] };
      state.categories.push(category);
    }
    state.categories.forEach(function (item) {
      item.feedUrls = (item.feedUrls || []).filter(function (url) { return url !== feedUrl; });
    });
    category.feedUrls = unique((category.feedUrls || []).concat([feedUrl]));
  }

  function moveFeedToCategoryId(feedUrl, categoryId) {
    var feed = findFeed(feedUrl);
    var category = findCategory(categoryId);
    if (!feed || !category) return;
    state.categories.forEach(function (item) {
      item.feedUrls = (item.feedUrls || []).filter(function (url) { return url !== feedUrl; });
    });
    category.feedUrls = unique((category.feedUrls || []).concat([feedUrl]));
    category.open = true;
    persist();
    render();
  }

  function markFeedRead(feed) {
    if (!feed) return;
    feed.lastSeenAt = new Date().toISOString();
    persist();
    renderLibrary();
  }

  function markCategoryRead(category) {
    if (!category) return;
    (category.feedUrls || []).forEach(function (url) {
      var feed = findFeed(url);
      if (feed) feed.lastSeenAt = new Date().toISOString();
    });
    persist();
    render();
  }

  function markVisibleFeedsRead() {
    var urls = activeFeedUrls();
    urls.forEach(function (url) {
      var feed = findFeed(url);
      if (feed) feed.lastSeenAt = new Date().toISOString();
    });
    persist();
    render();
  }

  function activeFeedUrls() {
    if (!state.activeSource || state.activeSource.type === 'all') {
      return state.feeds.map(function (feed) { return feed.url; });
    }
    if (state.activeSource.type === 'feed') return [state.activeSource.id];
    if (state.activeSource.type === 'category') {
      var category = findCategory(state.activeSource.id);
      return category ? category.feedUrls || [] : [];
    }
    if (state.activeSource.type === 'board') {
      var board = findBoard(state.activeSource.id);
      return unique((board ? board.eventRefs || [] : []).map(function (ref) { return ref.feedUrl; }));
    }
    return unique(sourceEvents().map(function (event) { return event._feedUrl; }).filter(Boolean));
  }

  function deleteFeed(feed) {
    if (!feed) return;
    feedCache.delete(feed.url);
    state.feeds = state.feeds.filter(function (item) { return item.url !== feed.url; });
    state.categories.forEach(function (category) {
      category.feedUrls = (category.feedUrls || []).filter(function (url) { return url !== feed.url; });
    });
    if (isActiveSource('feed', feed.url)) state.activeSource = { type: 'all', id: 'all' };
    persist();
    render();
  }

  function deleteFeedWithConfirm(feed) {
    if (!feed || !confirm('Eliminar esta suscripción?')) return;
    deleteFeed(feed);
  }

  function deleteCategoryWithConfirm(category) {
    if (!category || !confirm('Eliminar este folder? Los feeds se moverán al primer folder.')) return;
    removeCategory(category.id);
    persist();
    render();
  }

  function findFeed(url) {
    return state.feeds.find(function (feed) { return feed.url === url; });
  }

  function findCategory(id) {
    return state.categories.find(function (category) { return category.id === id; });
  }

  function findBoard(id) {
    return state.boards.find(function (board) { return board.id === id; });
  }

  function eventRef(event) {
    return { feedUrl: event._feedUrl, eventId: event.id };
  }

  function sameRef(a, b) {
    return a && b && a.feedUrl === b.feedUrl && a.eventId === b.eventId;
  }

  function boardHasEvent(board, event) {
    var ref = eventRef(event);
    return Boolean(board && (board.eventRefs || []).some(function (item) { return sameRef(item, ref); }));
  }

  function boardEvents(board) {
    if (!board) return [];
    var refs = board.eventRefs || [];
    return allEvents().filter(function (event) {
      var ref = eventRef(event);
      return refs.some(function (item) { return sameRef(item, ref); });
    });
  }

  function createBoard(name) {
    var title = String(name || '').trim();
    if (!title) return null;
    var board = { id: slug(title) + '-' + Date.now().toString(36), name: title, eventRefs: [] };
    state.boards.push(board);
    persist();
    renderBoards();
    return board;
  }

  function renameBoard(board) {
    if (!board) return;
    var name = prompt('Nombre de la colección', board.name);
    if (!name) return;
    board.name = name.trim();
    persist();
    renderBoards();
  }

  function deleteBoard(board) {
    if (!board || !confirm('Eliminar esta colección?')) return;
    state.boards = state.boards.filter(function (item) { return item.id !== board.id; });
    if (!state.boards.length) migrateBoards();
    if (isActiveSource('board', board.id)) state.activeSource = { type: 'all', id: 'all' };
    persist();
    render();
  }

  function clearBoard(board) {
    if (!board || !confirm('Vaciar esta colección?')) return;
    board.eventRefs = [];
    persist();
    render();
  }

  function renderBoards() {
    var box = $('boards');
    box.replaceChildren();
    if (!state.boards.length) {
      var empty = document.createElement('p');
      empty.className = 'muted-small';
      empty.textContent = 'Sin colecciones.';
      box.appendChild(empty);
      return;
    }
    state.boards.forEach(function (board) {
      var row = document.createElement('div');
      row.className = 'saved-row board-row' + (isActiveSource('board', board.id) ? ' is-active' : '');
      row.addEventListener('contextmenu', function (event) {
        event.preventDefault();
        openContextMenu(event, { type: 'board', id: board.id });
      });
      var body = document.createElement('button');
      body.className = 'saved-filter';
      body.type = 'button';
      body.textContent = '☆ ' + board.name;
      body.addEventListener('click', function () {
        setActiveSource('board', board.id);
        closeSidebar();
      });
      var menu = document.createElement('button');
      menu.className = 'icon-button small';
      menu.type = 'button';
      menu.textContent = '...';
      menu.setAttribute('aria-label', 'Opciones de colección');
      menu.addEventListener('click', function (event) {
        event.stopPropagation();
        openContextMenu(event, { type: 'board', id: board.id });
      });
      row.append(body, menu);
      var boardCount = boardEvents(board).length;
      if (boardCount > 0) {
        var count = document.createElement('span');
        count.className = 'library-count';
        count.textContent = String(boardCount);
        row.appendChild(count);
      }
      box.appendChild(row);
    });
  }

  function renderFacets() {
    var events = sourceEvents();
    fillSelect('language', unique(events.flatMap(function (e) { return e.languages || []; })), 'Cualquiera');
    fillSelect('country', unique(events.map(countryOf).filter(Boolean)), 'Cualquiera');
    var selected = queryTerms(state.filters.q);
    var possibleEvents = sourceEvents().filter(function (event) { return matchesWithoutQuery(event); });
    var tags = unique(possibleEvents.flatMap(function (e) { return e.tags || []; }))
      .filter(function (tag) {
        return selected.indexOf(tag.toLowerCase()) !== -1 || wouldReturnResults(tag);
      })
      .slice(0, 14);
    var cloud = $('tag-cloud');
    cloud.replaceChildren();
    $('chip-hint').hidden = tags.length === 0;
    tags.forEach(function (tag) {
      var key = tag.toLowerCase();
      var active = selected.indexOf(key) !== -1;
      var button = document.createElement('button');
      button.className = 'chip' + (active ? ' is-active' : '');
      button.type = 'button';
      button.textContent = '#' + tag;
      button.setAttribute('aria-pressed', String(active));
      button.addEventListener('click', function () {
        toggleQueryTerm(tag);
        persist();
        render();
      });
      cloud.appendChild(button);
    });
  }

  function matchesWithoutQuery(event) {
    return matchesWithFilters(event, Object.assign({}, state.filters, { q: '' }));
  }

  function wouldReturnResults(tag) {
    var current = queryTerms(state.filters.q);
    if (current.indexOf(tag.toLowerCase()) !== -1) return true;
    var next = current.concat([tag.toLowerCase()]).join(' ');
    var filters = Object.assign({}, state.filters, { q: next });
    return sourceEvents().some(function (event) {
      return matchesWithFilters(event, filters);
    });
  }

  function toggleQueryTerm(term) {
    var key = term.toLowerCase();
    var terms = queryTerms(state.filters.q);
    var index = terms.indexOf(key);
    if (index === -1) terms.push(key);
    else terms.splice(index, 1);
    state.filters.q = terms.join(' ');
  }

  function queryTerms(value) {
    return unique(String(value || '').toLowerCase().split(/[\s,]+/).filter(Boolean));
  }

  function normaliseQuery(value) {
    return queryTerms(value).join(' ');
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
    var widget = $('event-list');
    var events = filteredEvents();
    $('result-count').textContent = sourceLabel() + ' · ' + events.length + (events.length === 1 ? ' evento' : ' eventos');
    if (!events.length) {
      widget.events = [];
      widget.setAttribute('empty-message', 'No hay eventos con esos filtros.');
      if (previewMode) showMessage('Este feed no tiene eventos.', 'warn', true);
      else if (!state.feeds.length) showEmptyState();
      else showMessage('No hay eventos con esos filtros.', 'warn', true);
      return;
    }
    clearMessages();
    if (!embedReady) {
      showMessage('El visor de eventos se está cargando...', 'warn', true);
      return;
    }
    widget.setAttribute('layout', state.view === 'feed' ? 'list' : state.view);
    if (state.view === 'cards' && state.groupSeries) {
      widget.setAttribute('group-events', 'series,multipart');
    } else {
      widget.removeAttribute('group-events');
    }
    widget.setAttribute('theme', document.documentElement.dataset.theme || 'light');
    widget.setAttribute('fields', 'image,when,location,attendance,description,price,tags,organizer');
    widget.setAttribute('show-past', 'true');
    widget.setAttribute('sort', 'none');
    widget.setAttribute('event-actions', 'none');
    widget.setAttribute('empty-message', 'No hay eventos con esos filtros.');
    widget.events = events;
    widget.eventActions = function (context) {
      var event = context.originalEvent;
      if (!event) return [];
      if (previewMode) {
        return [
          { type: 'link', placement: 'detail' },
          { type: 'ics', placement: 'detail' }
        ];
      }
      var saved = state.boards.some(function (board) { return boardHasEvent(board, event); });
      return [
        {
          id: 'save-to-collection',
          label: saved ? 'En colección' : 'Guardar',
          icon: saved ? 'bookmark' : 'star',
          pressed: saved,
          placement: 'both',
          onClick: function (_previewEvent, actionContext) {
            if (actionContext.originalEvent) openBoardPicker(actionContext.originalEvent);
          }
        },
        { type: 'link', placement: 'detail' },
        { type: 'ics', placement: 'detail' }
      ];
    };
    widget.eventClassName = function (context) {
      var event = context.originalEvent;
      return [
        event && event.status === 'cancelled' ? 'reader-cancelled' : '',
        event && eventIsUnread(event) ? 'reader-unread' : 'reader-read'
      ].filter(Boolean);
    };
    widget.eventBadges = function (context) {
      var event = context.originalEvent;
      if (!event) return [];
      var badges = [];
      if (cfpIsOpen(event)) badges.push({ label: 'CFP abierto', icon: 'check', tone: 'success' });
      if (event.status === 'cancelled') badges.push({ label: 'Cancelado', tone: 'warning' });
      return badges;
    };
  }

  function eventIsUnread(event) {
    var feed = event && findFeed(event._feedUrl);
    if (!feed || feed.status !== 'ok') return false;
    if (!feed.lastSeenAt) return true;
    var activity = event.updatedAt ? new Date(event.updatedAt) : null;
    return Boolean(activity && !Number.isNaN(activity.getTime()) && activity > new Date(feed.lastSeenAt));
  }

  function openBoardPicker(event) {
    boardEventContext = eventRef(event);
    renderBoardPicker();
    openModal('board-modal');
  }

  function renderBoardPicker() {
    var box = $('board-picker');
    box.replaceChildren();
    var event = currentBoardEvent();
    if (!event) {
      box.appendChild(messageNode('Este evento ya no está disponible en los feeds cargados.', 'warn'));
      return;
    }
    state.boards.forEach(function (board) {
      var label = document.createElement('label');
      label.className = 'board-choice';
      var input = document.createElement('input');
      input.type = 'checkbox';
      input.value = board.id;
      input.checked = boardHasEvent(board, event);
      label.append(input, document.createTextNode(board.name));
      box.appendChild(label);
    });
  }

  function currentBoardEvent() {
    if (!boardEventContext) return null;
    return allEvents().find(function (event) { return sameRef(eventRef(event), boardEventContext); }) || null;
  }

  function saveBoardPicker() {
    var event = currentBoardEvent();
    if (!event) return;
    var ref = eventRef(event);
    var checked = Array.from(document.querySelectorAll('#board-picker input:checked')).map(function (input) { return input.value; });
    state.boards.forEach(function (board) {
      var has = board.eventRefs.some(function (item) { return sameRef(item, ref); });
      var wants = checked.indexOf(board.id) !== -1;
      if (wants && !has) board.eventRefs.push(ref);
      if (!wants && has) board.eventRefs = board.eventRefs.filter(function (item) { return !sameRef(item, ref); });
    });
    persist();
    closeModal('board-modal');
    render();
  }

  function markdown(text) {
    var fragment = document.createDocumentFragment();
    var lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
    var list = null;

    lines.forEach(function (line) {
      var match = line.match(/^\s*[-*]\s+(.+)/);
      if (match) {
        if (!list) {
          list = document.createElement('ul');
          fragment.appendChild(list);
        }
        var li = document.createElement('li');
        appendInline(li, match[1]);
        list.appendChild(li);
        return;
      }
      list = null;
      if (!line.trim()) return;
      var p = document.createElement('p');
      appendInline(p, line);
      fragment.appendChild(p);
    });

    if (!fragment.childNodes.length) {
      var empty = document.createElement('p');
      empty.textContent = '';
      fragment.appendChild(empty);
    }
    return fragment;
  }

  function appendInline(parent, text) {
    var pattern = /(\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`)/g;
    var last = 0;
    var match;
    while ((match = pattern.exec(text))) {
      if (match.index > last) parent.appendChild(document.createTextNode(text.slice(last, match.index)));
      if (match[2] && match[3]) {
        var a = document.createElement('a');
        a.href = match[3];
        a.target = '_blank';
        a.rel = 'noopener';
        a.textContent = match[2];
        parent.appendChild(a);
      } else if (match[4]) {
        var strong = document.createElement('strong');
        strong.textContent = match[4];
        parent.appendChild(strong);
      } else if (match[5]) {
        var em = document.createElement('em');
        em.textContent = match[5];
        parent.appendChild(em);
      } else if (match[6]) {
        var code = document.createElement('code');
        code.textContent = match[6];
        parent.appendChild(code);
      }
      last = pattern.lastIndex;
    }
    if (last < text.length) parent.appendChild(document.createTextNode(text.slice(last)));
  }

  function pill(text, kind) {
    var span = document.createElement('span');
    span.className = 'pill ' + kind;
    span.textContent = text;
    return span;
  }

  function labelMode(mode) {
    return { online: 'Online', 'in-person': 'Presencial', hybrid: 'Híbrido' }[mode] || mode || '';
  }

  function formatDate(event) {
    var date = startAsDate(event);
    if (!date) return '';
    if (event.startDate.indexOf('T') === -1) {
      return date.toLocaleDateString('es', { dateStyle: 'medium' });
    }
    return date.toLocaleString('es', { dateStyle: 'medium', timeStyle: 'short' }) + ' · ' + event.timezone;
  }

  function formatUpdated(event) {
    var date = updatedAsDate(event);
    return date ? date.toLocaleDateString('es', { dateStyle: 'medium' }) : 'sin fecha';
  }

  function compactUrl(url) {
    try {
      var parsed = new URL(url);
      return parsed.hostname + parsed.pathname.replace(/\/$/, '');
    } catch (e) {
      return url;
    }
  }

  function downloadIcs(event) {
    var ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//OpenTechEvents//OTE Reader//ES',
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

  function showEmptyState() {
    var box = $('messages');
    box.replaceChildren();
    var empty = document.createElement('section');
    empty.className = 'empty-state';
    var title = document.createElement('h3');
    title.textContent = DEMO_MODE ? 'Demo sin eventos cargados' : 'Empieza con tus propias fuentes OTE';
    var copy = document.createElement('p');
    copy.textContent = DEMO_MODE
      ? 'La demo usa feeds de ejemplo para enseñar folders, vistas y colecciones.'
      : 'Suscríbete a feeds OTE, descubre fuentes publicadas o abre una demo con datos de ejemplo.';
    var actions = document.createElement('div');
    actions.className = 'empty-actions';
    var manual = document.createElement('button');
    manual.type = 'button';
    manual.textContent = 'Añadir feed';
    manual.addEventListener('click', function () { openModal('subscribe-modal'); });
    var discover = document.createElement('button');
    discover.type = 'button';
    discover.className = 'ghost';
    discover.textContent = 'Discover new feeds';
    discover.addEventListener('click', openSources);
    actions.append(manual, discover);
    if (!DEMO_MODE) {
      var demo = document.createElement('a');
      demo.className = 'ghost-link';
      demo.href = 'demo/';
      demo.textContent = 'Ver demo';
      actions.appendChild(demo);
    }
    empty.append(title, copy, actions);
    box.appendChild(empty);
  }

  function subscribe(rawUrl, categoryId) {
    var url;
    try { url = normaliseUrl(rawUrl); } catch (e) {
      showMessage('La URL no parece válida.', 'warn', true);
      return;
    }
    var existing = state.feeds.find(function (feed) { return feed.url === url; });
    if (existing) return loadFeed(existing);
    var feed = { url: url, status: 'pending' };
    state.feeds.push(feed);
    if (categoryId && findCategory(categoryId)) moveFeedToCategoryId(url, categoryId);
    else ensureDefaultCategory(url);
    persist();
    loadFeed(feed);
  }

  function setSubscribeState(next) {
    subscribeState = next;
    renderSubscribeModal();
  }

  function resetSubscribeModal() {
    $('feed-url').value = '';
    setSubscribeState({ phase: 'idle' });
  }

  function renderSubscribeModal() {
    var box = $('subscribe-preview');
    var previewButton = $('subscribe-preview-button');
    box.replaceChildren();
    previewButton.disabled = subscribeState.phase === 'loading';
    if (subscribeState.phase === 'idle') {
      box.hidden = true;
      return;
    }
    box.hidden = false;
    if (subscribeState.phase === 'loading') {
      box.appendChild(messageNode('Cargando...'));
      return;
    }
    if (subscribeState.phase === 'error') {
      box.appendChild(messageNode(subscribeState.message, 'warn'));
    }
  }

  async function handleSubscribePreview() {
    var raw = $('feed-url').value;
    if (!raw.trim()) return;
    var url;
    try { url = normaliseUrl(raw); } catch (e) {
      setSubscribeState({ phase: 'error', message: 'La URL no parece válida.' });
      return;
    }
    var existing = findFeed(url);
    if (existing) {
      closeModal('subscribe-modal');
      loadFeed(existing);
      setActiveSource('feed', existing.url);
      showMessage('Ya estabas suscrito a esta fuente. Actualizando...', 'warn', true);
      return;
    }
    setSubscribeState({ phase: 'loading' });
    try {
      var result = await fetchOteDocument(url);
      closeModal('subscribe-modal');
      enterPreviewMode(result.url, result.doc);
    } catch (error) {
      setSubscribeState({ phase: 'error', message: error.message || String(error) });
    }
  }

  function enterPreviewMode(url, doc) {
    previewMode = { url: url, doc: doc };
    updatePreviewControls();
    render();
  }

  function cancelPreview() {
    if (!previewMode) return;
    previewMode = null;
    updatePreviewControls();
    render();
  }

  function confirmPreviewSubscription() {
    if (!previewMode) return;
    confirmSubscription(previewMode.url, previewMode.doc);
    setActiveSource('feed', previewMode.url);
  }

  function updatePreviewControls() {
    $('mark-all-read').hidden = Boolean(previewMode);
    $('refresh').hidden = Boolean(previewMode);
    $('preview-confirm-button').hidden = !previewMode;
    $('preview-cancel-button').hidden = !previewMode;
  }

  function confirmSubscription(url, doc) {
    var feed = { url: url, status: 'ok', title: doc.title, updatedAt: doc.updatedAt || '' };
    state.feeds.push(feed);
    ensureDefaultCategory(feed.url);
    feedCache.set(feed.url, doc);
    persist();
    render();
  }

  function unsubscribe(rawUrl) {
    var url = normaliseUrl(rawUrl);
    state.feeds = state.feeds.filter(function (feed) { return feed.url !== url; });
    state.categories.forEach(function (category) {
      category.feedUrls = (category.feedUrls || []).filter(function (feedUrl) { return feedUrl !== url; });
    });
    feedCache.delete(url);
    if (isActiveSource('feed', url)) state.activeSource = { type: 'all', id: 'all' };
    persist();
    render();
  }

  function ensureDefaultCategory(feedUrl) {
    if (!state.categories.length) state.categories.push({ id: 'community', name: 'Community feeds', open: true, feedUrls: [] });
    var known = state.categories.some(function (category) { return (category.feedUrls || []).indexOf(feedUrl) !== -1; });
    if (!known) state.categories[0].feedUrls = unique((state.categories[0].feedUrls || []).concat([feedUrl]));
  }

  function sourceLabel() {
    if (previewMode) return previewMode.doc.title || 'Previsualización';
    if (!state.activeSource || state.activeSource.type === 'all') return 'All';
    if (state.activeSource.type === 'feed') {
      var feed = findFeed(state.activeSource.id);
      return feed ? feed.title || 'Feed OTE' : 'Feed';
    }
    if (state.activeSource.type === 'category') {
      var category = findCategory(state.activeSource.id);
      return category ? category.name : 'Folder';
    }
    if (state.activeSource.type === 'board') {
      var board = findBoard(state.activeSource.id);
      return board ? board.name : 'Colección';
    }
    return 'Eventos';
  }

  function openModal(id) {
    var modal = $(id);
    if (modal.showModal) modal.showModal();
    else modal.setAttribute('open', '');
  }

  function closeModal(id) {
    var modal = $(id);
    if (modal.close) modal.close();
    else modal.removeAttribute('open');
    if (id === 'subscribe-modal') resetSubscribeModal();
  }

  function bind() {
    $('demo-exit').addEventListener('click', exitDemo);
    $('subscribe-open-side').addEventListener('click', function () { openModal('subscribe-modal'); });
    $('find-sources-open').addEventListener('click', openSources);
    $('create-folder-open-side').addEventListener('click', createFolder);
    $('sidebar-toggle').addEventListener('click', toggleSidebar);
    $('sidebar-collapse').addEventListener('click', toggleSidebar);
    $('sidebar-restore').addEventListener('click', toggleSidebar);
    $('board-create').addEventListener('click', function () {
      var name = prompt('Nombre de la colección', 'Favorites');
      if (name) createBoard(name);
    });
    $('sidebar-scrim').addEventListener('click', closeSidebar);
    $('theme-toggle').addEventListener('click', toggleTheme);
    $('app-width').addEventListener('change', function () {
      applyWidthPreference(this.value);
      try { localStorage.setItem(WIDTH_STORAGE, this.value); } catch (e) { /* storage unavailable */ }
    });
    $('help-open').addEventListener('click', function () { openModal('help-modal'); });
    document.querySelectorAll('[data-close]').forEach(function (button) {
      button.addEventListener('click', function () { closeModal(button.dataset.close); });
    });
    document.querySelectorAll('.modal').forEach(function (modal) {
      modal.addEventListener('click', function (event) {
        if (event.target === modal) closeModal(modal.id);
      });
    });
    $('subscribe-form').addEventListener('submit', function (event) {
      event.preventDefault();
      handleSubscribePreview();
    });
    $('feed-url').addEventListener('input', function () {
      if (subscribeState.phase !== 'idle') setSubscribeState({ phase: 'idle' });
    });
    $('subscribe-modal').addEventListener('close', resetSubscribeModal);
    $('preview-confirm-button').addEventListener('click', confirmPreviewSubscription);
    $('preview-cancel-button').addEventListener('click', cancelPreview);
    ['q', 'mode', 'language', 'country', 'cfp', 'future'].forEach(function (id) {
      $(id).addEventListener('input', function () {
        state.filters[id] = this.type === 'checkbox' ? this.checked : (id === 'q' ? normaliseQuery(this.value) : this.value);
        persist();
        render();
      });
    });
    document.querySelectorAll('[data-view]').forEach(function (button) {
      button.addEventListener('click', function () {
        state.view = button.dataset.view;
        persist();
        render();
      });
    });
    $('group-series').addEventListener('change', function () {
      state.groupSeries = this.checked;
      persist();
      render();
    });
    $('refresh').addEventListener('click', function () {
      state.feeds.forEach(loadFeed);
    });
    $('mark-all-read').addEventListener('click', markVisibleFeedsRead);
    $('options-form').addEventListener('submit', function (event) {
      event.preventDefault();
      saveOptions();
    });
    $('options-refresh').addEventListener('click', function () {
      var feed = optionsContext && findFeed(optionsContext.id);
      closeModal('options-modal');
      if (feed) loadFeed(feed);
    });
    $('options-mark-read').addEventListener('click', function () {
      markFeedRead(optionsContext && findFeed(optionsContext.id));
      closeModal('options-modal');
    });
    $('options-delete').addEventListener('click', function () {
      if (!optionsContext || !confirm('Eliminar?')) return;
      deleteFeed(findFeed(optionsContext.id));
      closeModal('options-modal');
      persist();
      render();
    });
    $('board-add-inline').addEventListener('click', function () {
      var board = createBoard($('new-board-name').value);
      $('new-board-name').value = '';
      if (board) {
        renderBoardPicker();
        var checkbox = Array.from(document.querySelectorAll('#board-picker input')).find(function (input) {
          return input.value === board.id;
        });
        if (checkbox) checkbox.checked = true;
      }
    });
    $('board-form').addEventListener('submit', function (event) {
      event.preventDefault();
      saveBoardPicker();
    });
    window.addEventListener('beforeinstallprompt', function (event) {
      event.preventDefault();
      deferredInstall = event;
      updateInstallUi();
    });
    $('install-bar-button').addEventListener('click', promptInstall);
    $('install-help-button').addEventListener('click', promptInstall);
    $('install-dismiss').addEventListener('click', function () {
      try { localStorage.setItem(INSTALL_DISMISSED, '1'); } catch (e) { /* storage unavailable */ }
      updateInstallUi();
    });
    document.addEventListener('click', function (event) {
      if (!$('context-menu').hidden && !event.target.closest('#context-menu')) closeContextMenu();
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') closeContextMenu();
    });
  }

  async function openSources() {
    openModal('sources-modal');
    await renderSources();
  }

  async function renderSources() {
    var box = $('source-list');
    box.replaceChildren();
    box.appendChild(messageNode('Cargando fuentes...'));
    try {
      if (!adopterCache) {
        var response = await fetch(ADOPTERS_URL);
        if (!response.ok) throw new Error('HTTP ' + response.status);
        adopterCache = await response.json();
      }
      var sources = adopterCache.adopters || [];
      box.replaceChildren();
      if (!sources.length) {
        box.appendChild(messageNode('No hay fuentes en el catálogo.'));
        return;
      }
      sources.forEach(function (source) {
        if (source.feed) box.appendChild(sourceRow(source));
      });
    } catch (error) {
      box.replaceChildren(messageNode('No se pudieron cargar fuentes: ' + (error.message || error), 'warn'));
    }
  }

  function sourceRow(source) {
    var url = normaliseUrl(source.feed);
    var subscribed = Boolean(findFeed(url));
    var row = document.createElement('div');
    row.className = 'source-row';
    var body = document.createElement('div');
    var title = document.createElement('strong');
    title.textContent = source.name;
    var meta = document.createElement('span');
    meta.textContent = compactUrl(url);
    body.append(title, meta);

    if (subscribed) {
      var action = document.createElement('button');
      action.type = 'button';
      action.className = 'ghost';
      action.textContent = 'Desuscribirme';
      action.addEventListener('click', function () {
        unsubscribe(url);
        renderSources();
      });
      row.append(body, action);
      return row;
    }

    var group = document.createElement('div');
    group.className = 'split-button';
    var action = document.createElement('button');
    action.type = 'button';
    action.textContent = 'Suscribirme';
    action.addEventListener('click', function () {
      subscribe(url);
      renderSources();
    });
    var chevron = document.createElement('button');
    chevron.type = 'button';
    chevron.className = 'split-chevron';
    chevron.textContent = '▾';
    chevron.setAttribute('aria-label', 'Elegir folder de destino');
    chevron.addEventListener('click', function (event) { openFolderPicker(event, url); });
    group.append(action, chevron);
    row.append(body, group);
    return row;
  }

  function messageNode(text, kind) {
    var node = document.createElement('p');
    node.className = 'message ' + (kind || '');
    node.textContent = text;
    return node;
  }

  function installDismissed() {
    try { return localStorage.getItem(INSTALL_DISMISSED) === '1'; } catch (e) { return false; }
  }

  function updateInstallUi() {
    var canInstall = Boolean(deferredInstall);
    $('install-bar').hidden = !canInstall || installDismissed();
    $('help-install').hidden = !canInstall;
  }

  function updateDemoUi() {
    $('demo-bar').hidden = !DEMO_MODE;
  }

  function initVersionUi() {
    $('app-version').textContent = 'v' + APP_VERSION;
  }

  function exitDemo(event) {
    var target = location.origin + '/';
    if (window.top !== window.self) {
      event.preventDefault();
      window.top.location.href = target;
    }
  }

  async function promptInstall() {
    if (!deferredInstall) return;
    deferredInstall.prompt();
    await deferredInstall.userChoice;
    deferredInstall = null;
    updateInstallUi();
  }

  function isMobileSidebar() {
    return window.matchMedia('(max-width: 640px)').matches;
  }

  function toggleSidebar() {
    if (isMobileSidebar()) {
      if ($('sidebar').classList.contains('is-open')) closeSidebar();
      else openSidebar();
      return;
    }
    document.body.classList.toggle('sidebar-collapsed');
    var collapsed = document.body.classList.contains('sidebar-collapsed');
    $('sidebar-toggle').setAttribute('aria-expanded', String(!collapsed));
    $('sidebar-collapse').setAttribute('aria-expanded', String(!collapsed));
  }

  function openSidebar() {
    $('sidebar').classList.add('is-open');
    $('sidebar-scrim').hidden = false;
    $('sidebar-toggle').setAttribute('aria-expanded', 'true');
    $('sidebar-collapse').setAttribute('aria-expanded', 'true');
  }

  function closeSidebar() {
    $('sidebar').classList.remove('is-open');
    $('sidebar-scrim').hidden = true;
    $('sidebar-toggle').setAttribute('aria-expanded', 'false');
    $('sidebar-collapse').setAttribute('aria-expanded', 'false');
  }

  function applySubscribeParam() {
    var params = new URLSearchParams(location.search);
    var url = params.get('subscribe') || params.get('feed');
    if (!url) return;
    var normalised;
    try { normalised = normaliseUrl(url); } catch (e) { normalised = null; }
    if (normalised && state.feeds.some(function (feed) { return feed.url === normalised; })) return;
    $('feed-url').value = url;
    openModal('subscribe-modal');
  }

  async function boot() {
    initTheme();
    initWidthPreference();
    initVersionUi();
    loadState();
    bind();
    updateInstallUi();
    updateDemoUi();
    await waitForEmbed();
    render();
    applySubscribeParam();
    await Promise.all(state.feeds.map(loadFeed));
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    }
  }

  async function waitForEmbed() {
    if (!window.customElements || !customElements.whenDefined) return;
    try {
      await Promise.race([
        customElements.whenDefined('ote-events'),
        new Promise(function (_, reject) {
          setTimeout(function () { reject(new Error('timeout')); }, 6000);
        })
      ]);
      embedReady = true;
    } catch (e) {
      embedReady = false;
      showMessage('No se pudo cargar el componente de visualización OTE.', 'warn', true);
    }
  }

  boot();
}());
