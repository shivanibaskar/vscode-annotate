// annotationPreview.js
// Contributed via "markdown.previewScripts" in package.json.
// Runs inside VS Code's built-in Markdown preview WebView.
// Reads .vscode/annotations.json from the workspace and overlays visual
// markers on [data-line] elements that fall within annotated ranges.
// Updates live whenever VS Code re-renders the preview (triggered by the
// extension calling markdown.preview.refresh on store changes).
(function () {
  'use strict';

  // ── Color palette — mirrors the extension's decoration colours ─────────────
  /** @type {Record<string, {border: string; bg: string}>} */
  var TAG_COLORS = {
    bug:       { border: 'var(--vscode-errorForeground, #f44747)',                      bg: 'rgba(244,71,71,0.07)'    },
    question:  { border: 'var(--vscode-notificationsWarningIcon-foreground, #cca700)',  bg: 'rgba(204,167,0,0.07)'    },
    todo:      { border: 'var(--vscode-notificationsInfoIcon-foreground, #75beff)',     bg: 'rgba(117,190,255,0.07)'  },
    context:   { border: 'var(--vscode-editorInfo-foreground, #4ec9b0)',                bg: 'rgba(78,201,176,0.07)'   },
    important: { border: 'var(--vscode-charts-purple, #b180d7)',                        bg: 'rgba(177,128,215,0.07)'  },
  };
  var DEFAULT_COLOR = { border: 'var(--vscode-editorInfo-foreground, #4ec9b0)', bg: 'rgba(78,201,176,0.07)' };

  function getColor(tag) {
    return (tag && TAG_COLORS[tag]) || DEFAULT_COLOR;
  }

  // ── Inject styles once ─────────────────────────────────────────────────────
  var STYLE_ID = 'vscode-annotate-preview-styles';

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) { return; }
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = [
      '.vscode-annotate-badge {',
      '  display: inline-flex;',
      '  align-items: center;',
      '  margin-left: 8px;',
      '  padding: 1px 7px;',
      '  border-radius: 10px;',
      '  font-size: 0.72em;',
      '  font-weight: 600;',
      '  font-family: var(--vscode-font-family, sans-serif);',
      '  cursor: help;',
      '  vertical-align: middle;',
      '  user-select: none;',
      '  white-space: nowrap;',
      '  opacity: 0.85;',
      '}',
    ].join('\n');
    document.head.appendChild(style);
  }

  // ── Read preview settings injected by VS Code ──────────────────────────────
  function getPreviewSettings() {
    var el = document.getElementById('vscode-markdown-preview-data');
    if (!el) { return null; }
    try {
      return JSON.parse(el.dataset.settings || '{}');
    } catch (e) {
      return null;
    }
  }

  // ── Fetch annotations from the workspace .vscode directory ─────────────────
  function loadAnnotations(resourceBase) {
    var base = resourceBase.endsWith('/') ? resourceBase : resourceBase + '/';
    var url = base + '.vscode/annotations.json';
    return fetch(url, { cache: 'no-store' })
      .then(function (resp) {
        if (!resp.ok) { return []; }
        return resp.json().then(function (json) {
          return (json && Array.isArray(json.annotations)) ? json.annotations : [];
        });
      })
      .catch(function () { return []; });
  }

  // ── Match an annotation's fileUri against the current preview source ────────
  // fileUri is a workspace-relative path like "src/README.md".
  // sourceUri is a full URI like "file:///workspace/src/README.md".
  function matchesSource(fileUri, sourceUri) {
    var decoded = decodeURIComponent(sourceUri);
    return decoded.endsWith('/' + fileUri) || decoded === fileUri;
  }

  // ── Remove all previously applied markers ─────────────────────────────────
  function clearMarkers() {
    var ranges = document.querySelectorAll('[data-vscode-annotate]');
    for (var i = 0; i < ranges.length; i++) {
      var el = ranges[i];
      el.removeAttribute('data-vscode-annotate');
      el.style.removeProperty('border-left');
      el.style.removeProperty('padding-left');
      el.style.removeProperty('margin-left');
      el.style.removeProperty('background-color');
    }
    var badges = document.querySelectorAll('.vscode-annotate-badge');
    for (var j = 0; j < badges.length; j++) {
      badges[j].parentNode && badges[j].parentNode.removeChild(badges[j]);
    }
  }

  // ── Apply annotation overlays to [data-line] elements ─────────────────────
  function applyAnnotations(annotations, sourceUri) {
    clearMarkers();

    var relevant = annotations.filter(function (a) {
      return matchesSource(a.fileUri, sourceUri);
    });
    if (relevant.length === 0) { return; }

    // Build a map of line number → array of annotations covering that line.
    var lineMap = {};
    for (var i = 0; i < relevant.length; i++) {
      var ann = relevant[i];
      for (var line = ann.range.start; line <= ann.range.end; line++) {
        if (!lineMap[line]) { lineMap[line] = []; }
        lineMap[line].push(ann);
      }
    }

    // Walk all [data-line] elements. VS Code emits these on block-level elements
    // (headings, paragraphs, list items, code fences, etc.) for scroll sync.
    var lineEls = document.querySelectorAll('[data-line]');
    var badgePlaced = {}; // annotation id → boolean

    for (var k = 0; k < lineEls.length; k++) {
      var el = lineEls[k];
      var lineNum = parseInt(el.getAttribute('data-line'), 10);
      if (isNaN(lineNum)) { continue; }
      var anns = lineMap[lineNum];
      if (!anns || anns.length === 0) { continue; }

      var color = getColor(anns[0].tag);
      el.style.borderLeft = '3px solid ' + color.border;
      el.style.paddingLeft = '6px';
      el.style.marginLeft = '-9px';
      el.style.backgroundColor = color.bg;
      el.setAttribute('data-vscode-annotate', '1');

      // Place a badge only at the first line of each annotation.
      for (var m = 0; m < anns.length; m++) {
        var a = anns[m];
        if (a.range.start === lineNum && !badgePlaced[a.id]) {
          badgePlaced[a.id] = true;
          el.appendChild(makeBadge(a));
        }
      }
    }
  }

  function makeBadge(ann) {
    var color = getColor(ann.tag);
    var label = ann.tag ? ('\u270e ' + ann.tag) : '\u270e';
    var badge = document.createElement('span');
    badge.className = 'vscode-annotate-badge';
    badge.style.background = color.bg;
    badge.style.color = color.border;
    badge.style.border = '1px solid ' + color.border;
    badge.textContent = label;
    // Native browser tooltip — no JS needed, no CSP concerns.
    badge.title = ann.comment;
    return badge;
  }

  // ── Main render function ───────────────────────────────────────────────────
  var _running = false;
  var _pending = false;

  function run() {
    if (_running) { _pending = true; return; }
    _running = true;

    var settings = getPreviewSettings();
    if (!settings || !settings.source || !settings.resourceBase) {
      _running = false;
      return;
    }

    ensureStyles();

    var source = settings.source;
    loadAnnotations(settings.resourceBase).then(function (annotations) {
      applyAnnotations(annotations, source);
    }).finally(function () {
      _running = false;
      if (_pending) {
        _pending = false;
        run();
      }
    });
  }

  // ── Bootstrap ─────────────────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }

  // Re-apply after VS Code re-renders the preview. VS Code replaces direct
  // children of <body> when it refreshes, so watching childList on body is
  // sufficient. The debounce avoids multiple fetches during one render cycle.
  var _debounceTimer = null;
  var observer = new MutationObserver(function () {
    clearTimeout(_debounceTimer);
    _debounceTimer = setTimeout(run, 150);
  });
  observer.observe(document.body, { childList: true });
})();
