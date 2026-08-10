(function () {
  'use strict';

  var STORAGE = 'ote-reader-state-v1';
  var INSTALL_DISMISSED = 'ote-reader-install-dismissed-v1';
  var THEME_STORAGE = 'ote-reader-theme-v1';
  var WIDTH_STORAGE = 'ote-reader-width-v1';
  var ADOPTERS_URL = 'https://opentechevents.org/data/adopters.json';
  var DEFAULT_FEED = new URL('demo-feed.json', location.href).href;
  var DEFAULT_FOLDERS = ['Conferencias', 'Eventos Almería', 'CFP para charlas'];
  var FOLDER_EXAMPLES = DEFAULT_FOLDERS.concat(['Meetups locales', 'Online', 'Eventos para juniors']);
  var state = {
    feeds: [],
    categories: [],
    folderTemplatesAdded: false,
    activeSource: { type: 'all', id: 'all' },
    filters: { q: '', mode: '', language: '', country: '', cfp: false, future: true },
    savedFilters: [],
    savedEvents: [],
    view: 'cards'
  };
  var feedCache = new Map();
  var adopterCache = null;
  var deferredInstall = null;
  var optionsContext = null;
  var editingCategoryId = null;

  var $ = function (id) { return document.getElementById(id); };

  function initTheme() {
    var saved = '';
    try { saved = localStorage.getItem(THEME_STORAGE) || ''; } catch (e) { /* storage unavailable */ }
    var dark = saved ? saved === 'dark' : window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    applyTheme(dark ? 'dark' : 'light');
  }

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
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
        state.folderTemplatesAdded = Boolean(state.folderTemplatesAdded);
        state.activeSource = state.activeSource || { type: 'all', id: 'all' };
        state.savedFilters = state.savedFilters || [];
        state.savedEvents = state.savedEvents || [];
        state.view = state.view || 'cards';
        state.filters.q = normaliseQuery(state.filters.q || '');
      }
    } catch (e) {
      showMessage('No se pudo leer el estado guardado. Se usará una sesión limpia.', 'warn');
    }
    if (!state.feeds.length) {
      state.feeds.push({ url: DEFAULT_FEED, title: 'Feed demo', status: 'pending' });
    }
    migrateCategories();
    persist();
  }

  function migrateCategories() {
    if (!state.categories.length) {
      state.categories.push({
        id: 'community',
        name: 'Community feeds',
        open: true,
        feedUrls: state.feeds.map(function (feed) { return feed.url; })
      });
    }
    seedDefaultFolders();
    var known = new Set(state.categories.flatMap(function (category) { return category.feedUrls || []; }));
    var missing = state.feeds.map(function (feed) { return feed.url; }).filter(function (url) { return !known.has(url); });
    if (missing.length) state.categories[0].feedUrls = unique((state.categories[0].feedUrls || []).concat(missing));
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

  async function loadFeed(feed) {
    feed.status = 'loading';
    renderLibrary();
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
      feed.title = feed.customTitle || normalised.title;
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

  function sourceEvents() {
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
    document.querySelectorAll('[data-view]').forEach(function (button) {
      button.classList.toggle('is-active', button.dataset.view === state.view);
      button.setAttribute('aria-pressed', String(button.dataset.view === state.view));
    });
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
    state.activeSource = { type: type, id: id };
    persist();
    render();
  }

  function isActiveSource(type, id) {
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
    fillFolderOptions(feed.url);
    document.querySelectorAll('.feed-only').forEach(function (node) { node.hidden = false; });
    document.querySelectorAll('.folder-only').forEach(function (node) { node.hidden = true; });
    openModal('options-modal');
  }

  function openCategoryOptions(category) {
    optionsContext = { type: 'category', id: category.id };
    $('options-title').textContent = category.name;
    $('options-name').value = category.name;
    document.querySelectorAll('.feed-only').forEach(function (node) { node.hidden = true; });
    document.querySelectorAll('.folder-only').forEach(function (node) { node.hidden = false; });
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
    var name = $('options-name').value.trim();
    if (optionsContext.type === 'feed') {
      var feed = findFeed(optionsContext.id);
      if (!feed) return;
      if (name) {
        feed.customTitle = name;
        feed.title = name;
      }
      moveFeedToCategoryId(feed.url, $('options-folder').value);
    } else {
      var category = findCategory(optionsContext.id);
      if (category && name) category.name = name;
    }
    closeModal('options-modal');
    persist();
    render();
  }

  function openContextMenu(event, context) {
    event.preventDefault();
    optionsContext = context;
    var menu = $('context-menu');
    menu.replaceChildren();
    contextMenuItems(context).forEach(function (item) {
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
    positionContextMenu(menu, event.clientX, event.clientY);
    menu.hidden = false;
  }

  function contextMenuItems(context) {
    if (context.type === 'all') {
      return [
        { icon: '✓', label: 'Mark as Read', action: markVisibleFeedsRead },
        { icon: '+', label: 'Create New Folder', action: createFolder },
        { icon: '↻', label: 'Refresh feeds', action: function () { state.feeds.forEach(loadFeed); } },
        { icon: '⚙', label: 'Manage Feeds', action: openSources }
      ];
    }
    if (context.type === 'category') {
      var category = findCategory(context.id);
      return [
        { icon: '✓', label: 'Mark as Read', action: function () { markCategoryRead(category); } },
        { icon: '⟷', label: 'Rename', action: function () { startCategoryRename(category); } },
        { icon: '☊', label: 'Manage Feeds', action: openSources },
        { icon: '⚙', label: 'Folder settings', action: function () { openCategoryOptions(category); } },
        'separator',
        { icon: '⌫', label: 'Delete', danger: true, action: function () { deleteCategoryWithConfirm(category); } }
      ];
    }
    var feed = findFeed(context.id);
    return [
      { icon: '✓', label: 'Mark as Read', action: function () { markFeedRead(feed); } },
      { icon: '⟷', label: 'Rename', action: function () { openFeedOptions(feed); } },
      { icon: '♡', label: 'Add to Favorites', action: function () { moveFeedToCategory(feed.url, 'Favorites'); persist(); render(); } },
      { icon: '⚙', label: 'Manage Feed', action: function () { openFeedOptions(feed); } },
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

  function renderSavedFilters() {
    var box = $('saved-filters');
    box.replaceChildren();
    if (!state.savedFilters.length) {
      var empty = document.createElement('p');
      empty.className = 'muted-small';
      empty.textContent = 'Sin filtros guardados.';
      box.appendChild(empty);
      return;
    }
    state.savedFilters.forEach(function (saved, index) {
      var row = document.createElement('div');
      row.className = 'saved-row';
      var body = document.createElement('button');
      body.className = 'saved-filter';
      body.type = 'button';
      body.textContent = saved.name;
      body.addEventListener('click', function () {
        state.filters = Object.assign({}, saved.filters);
        persist();
        render();
      });
      var menu = document.createElement('button');
      menu.className = 'icon-button small';
      menu.type = 'button';
      menu.textContent = '...';
      menu.setAttribute('aria-label', 'Opciones de filtro');
      menu.addEventListener('click', function () {
        if (confirm('Eliminar este filtro?')) {
          state.savedFilters.splice(index, 1);
          persist();
          renderSavedFilters();
        }
      });
      row.append(body, menu);
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
    var list = $('event-list');
    var events = filteredEvents();
    list.className = 'events view-' + state.view;
    list.replaceChildren();
    $('result-count').textContent = sourceLabel() + ' · ' + events.length + (events.length === 1 ? ' evento' : ' eventos');
    if (!events.length) {
      showMessage('No hay eventos con esos filtros.', 'warn', true);
      return;
    }
    clearMessages();
    if (state.view === 'calendar') renderCalendar(events, list);
    else events.forEach(function (event) { list.appendChild(renderEvent(event)); });
  }

  function renderCalendar(events, list) {
    var groups = {};
    events.forEach(function (event) {
      var date = startAsDate(event);
      var key = date ? date.toLocaleDateString('es', { month: 'long', year: 'numeric' }) : 'Sin fecha';
      if (!groups[key]) groups[key] = [];
      groups[key].push(event);
    });
    Object.keys(groups).forEach(function (key) {
      var group = document.createElement('section');
      group.className = 'calendar-group';
      var title = document.createElement('h3');
      title.textContent = key;
      group.appendChild(title);
      groups[key].forEach(function (event) {
        group.appendChild(renderEvent(event));
      });
      list.appendChild(group);
    });
  }

  function renderEvent(event) {
    var tpl = $('event-template').content.cloneNode(true);
    var card = tpl.querySelector('.event-card');
    if (event.status === 'cancelled') card.classList.add('is-cancelled');
    var date = startAsDate(event);
    tpl.querySelector('.event-date').innerHTML = date
      ? '<span>' + date.toLocaleString('es', { month: 'short' }) + '</span>' + date.getDate()
      : '<span>sin</span>fecha';
    tpl.querySelector('.event-topline').textContent = state.view === 'feed'
      ? 'Actualizado ' + formatUpdated(event) + ' · ' + event._feedTitle
      : [event._feedTitle, organizerText(event)].filter(Boolean).join(' · ');
    tpl.querySelector('h3').textContent = event.name;
    tpl.querySelector('.event-description').appendChild(markdown(event.description || 'Sin descripción en el feed.'));
    tpl.querySelector('.event-meta').textContent = [
      formatDate(event),
      labelMode(event.attendanceMode),
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
    ensureDefaultCategory(url);
    persist();
    loadFeed(feed);
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
    if (!state.activeSource || state.activeSource.type === 'all') return 'All';
    if (state.activeSource.type === 'feed') {
      var feed = findFeed(state.activeSource.id);
      return feed ? feed.title || 'Feed OTE' : 'Feed';
    }
    if (state.activeSource.type === 'category') {
      var category = findCategory(state.activeSource.id);
      return category ? category.name : 'Folder';
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
  }

  function bind() {
    $('subscribe-open-side').addEventListener('click', function () { openModal('subscribe-modal'); });
    $('find-sources-open').addEventListener('click', openSources);
    $('sidebar-toggle').addEventListener('click', toggleSidebar);
    $('sidebar-collapse').addEventListener('click', toggleSidebar);
    $('sidebar-restore').addEventListener('click', toggleSidebar);
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
      subscribe($('feed-url').value);
      $('feed-url').value = '';
      closeModal('subscribe-modal');
    });
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
      if (optionsContext.type === 'feed') deleteFeed(findFeed(optionsContext.id));
      if (optionsContext.type === 'category') removeCategory(optionsContext.id);
      closeModal('options-modal');
      persist();
      render();
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
    var action = document.createElement('button');
    action.type = 'button';
    action.className = subscribed ? 'ghost' : '';
    action.textContent = subscribed ? 'Desuscribirme' : 'Suscribirme';
    action.addEventListener('click', function () {
      if (subscribed) unsubscribe(url);
      else subscribe(url);
      renderSources();
    });
    row.append(body, action);
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
    if (url) subscribe(url);
  }

  async function boot() {
    initTheme();
    initWidthPreference();
    loadState();
    bind();
    updateInstallUi();
    render();
    applySubscribeParam();
    await Promise.all(state.feeds.map(loadFeed));
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    }
  }

  boot();
}());
