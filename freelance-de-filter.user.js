// ==UserScript==
// @name         freelance.de – Erweiterte Projektfilter
// @namespace    https://www.freelance.de/
// @version      1.3.0
// @description  Blendet Projekte nach Stichwörtern, Datum, Remote und Vertragstyp aus oder graut sie aus – pro Filter einstellbar.
// @match        https://www.freelance.de/*
// @match        https://freelance.de/*
// @grant        GM_getValue
// @grant        GM_setValue
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Filterdefinitionen
  //   type 'list'   : ein Eintrag pro Zeile, Text = „enthält“, /regex/i = regulärer Ausdruck
  //   type 'number' : Zahl (Tage), leer = aus
  //   type 'bool'   : Checkbox
  // Jeder Filter hat seinen eigenen Modus: 'hide' (ausblenden) oder 'dim' (ausgrauen)
  // ---------------------------------------------------------------------------
  const FILTERS = [
    { key: 'title',    type: 'list',   label: 'Titel ausschließen' },
    { key: 'company',  type: 'list',   label: 'Firma ausschließen' },
    { key: 'location', type: 'list',   label: 'Ort ausschließen' },
    { key: 'skill',    type: 'list',   label: 'Skill ausschließen' },
    { key: 'maxAge',   type: 'number', label: 'Veröffentlicht vor mehr als … Tagen' },
    { key: 'maxStart', type: 'number', label: 'Projektstart in mehr als … Tagen' },
    { key: 'anue',     type: 'bool',   label: 'Arbeitnehmerüberlassung' },
    { key: 'remote',   type: 'bool',   label: 'Nicht remote' },
  ];

  const DEFAULTS = {
    values: { title: '', company: '', location: '', skill: '', maxAge: '', maxStart: '', anue: false, remote: false },
    modes: Object.fromEntries(FILTERS.map((f) => [f.key, 'hide'])),
    highlight: '',
    showHidden: false,
  };

  // Einstellungen laden (inkl. Übernahme aus Version 1.0/1.1)
  function loadSettings() {
    const raw = GM_getValue('settings', {});
    const s = {
      values: Object.assign({}, DEFAULTS.values, raw.values),
      modes: Object.assign({}, DEFAULTS.modes, raw.modes),
      highlight: raw.highlight ?? DEFAULTS.highlight,
      showHidden: raw.showHidden ?? DEFAULTS.showHidden,
    };
    if (!raw.values) {
      const old = { title: 'titleBlacklist', company: 'companyBlacklist', location: 'locationBlacklist',
        skill: 'skillBlacklist', maxAge: 'maxAgeDays', maxStart: 'maxStartDays', remote: 'remoteOnly' };
      for (const [k, o] of Object.entries(old)) if (raw[o] !== undefined) s.values[k] = raw[o];
      if (raw.titleHighlight) s.highlight = raw.titleHighlight;
      if (raw.mode === 'dim') FILTERS.forEach((f) => (s.modes[f.key] = 'dim'));
    }
    return s;
  }

  const settings = loadSettings();
  const save = () => GM_setValue('settings', settings);

  // ---------------------------------------------------------------------------
  // Hilfsfunktionen
  // ---------------------------------------------------------------------------
  function parseRules(text) {
    return String(text || '')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((line) => {
        const m = line.match(/^\/(.+)\/([gimsuy]*)$/);
        if (m) {
          try {
            const re = new RegExp(m[1], m[2].replace('g', ''));
            return { label: line, test: (s) => re.test(s) };
          } catch (e) {
            console.warn('[FL-Filter] Ungültiger regulärer Ausdruck:', line);
            return null;
          }
        }
        const needle = line.toLowerCase();
        return { label: line, test: (s) => s.toLowerCase().includes(needle) };
      })
      .filter(Boolean);
  }

  const firstMatch = (rules, text) => rules.find((r) => r.test(text)) || null;
  const txt = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
  const fmt = (d) => d.toLocaleDateString('de-DE');

  // "17.11.2026" oder "17.11.2026 14:42" → Date
  function parseDate(s) {
    const m = s.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
    return m ? new Date(+m[3], m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0)) : null;
  }

  // Ganze Kalendertage zwischen heute und dem Datum (positiv = Vergangenheit)
  function daysAgo(date) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const d = new Date(date); d.setHours(0, 0, 0, 0);
    return Math.round((today - d) / 86400000);
  }

  function readCard(card) {
    const infoItem = (icon) => {
      const i = card.querySelector('i.' + icon);
      return i ? txt(i.closest('li')) : '';
    };
    return {
      title: txt(card.querySelector('h3')),
      company: txt(card.querySelector('h3 + small')),
      contractBadges: [...card.querySelectorAll('small.badge')].map(txt),
      skills: [...card.querySelectorAll('a.badge')].map(txt),
      location: infoItem('fa-map-marker-alt'),
      remote: infoItem('fa-laptop-house'),
      start: parseDate(infoItem('fa-calendar-star')),   // Projektstart
      posted: parseDate(infoItem('fa-history')),        // Veröffentlicht / aktualisiert
    };
  }

  // ---------------------------------------------------------------------------
  // Prüfungen: jede liefert einen Grund (String) oder null
  // ---------------------------------------------------------------------------
  let rules = {};
  function compileRules() {
    rules = {
      title: parseRules(settings.values.title),
      company: parseRules(settings.values.company),
      location: parseRules(settings.values.location),
      skill: parseRules(settings.values.skill),
      highlight: parseRules(settings.highlight),
    };
  }

  const CHECKS = {
    title: (d) => { const r = firstMatch(rules.title, d.title); return r && 'Titel: ' + r.label; },
    company: (d) => { const r = firstMatch(rules.company, d.company); return r && 'Firma: ' + r.label; },
    location: (d) => { const r = firstMatch(rules.location, d.location); return r && 'Ort: ' + r.label; },
    skill: (d) => {
      for (const s of d.skills) { const r = firstMatch(rules.skill, s); if (r) return 'Skill: ' + r.label; }
      return null;
    },
    maxAge: (d) => {
      const n = parseInt(settings.values.maxAge, 10);
      return !isNaN(n) && d.posted && daysAgo(d.posted) > n ? `älter als ${n} Tag(e) (${fmt(d.posted)})` : null;
    },
    maxStart: (d) => {
      const n = parseInt(settings.values.maxStart, 10);
      return !isNaN(n) && d.start && -daysAgo(d.start) > n ? `Start erst am ${fmt(d.start)}` : null;
    },
    anue: (d) =>
      settings.values.anue && d.contractBadges.some((b) => /arbeitnehmerüberlassung/i.test(b))
        ? 'Arbeitnehmerüberlassung' : null,
    remote: (d) =>
      settings.values.remote && !/remote/i.test(d.remote + ' ' + d.location) ? 'nicht remote' : null,
  };

  // ---------------------------------------------------------------------------
  // Filter anwenden
  // ---------------------------------------------------------------------------
  function setAttr(el, name, value) {
    if (value == null) { if (el.hasAttribute(name)) el.removeAttribute(name); }
    else if (el.getAttribute(name) !== value) el.setAttribute(name, value);
  }

  // ---------------------------------------------------------------------------
  // Alters-Grenze markieren: dicke Linie vor dem ersten (sichtbaren) Projekt, das
  // älter als „Veröffentlicht vor mehr als … Tagen“ ist. Nur wenn die Liste
  // nach Datum sortiert ist (danach kommen nur noch ältere Projekte).
  // ---------------------------------------------------------------------------
  function markCutoff(list, dateKey) {
    list.forEach(({ card }) => {
      setAttr(card, 'data-flf-cutoff', null);
      setAttr(card, 'data-flf-cutoff-label', null);
    });

    const n = parseInt(settings.values.maxAge, 10);
    if (isNaN(n)) return;

    const isOld = list.map(({ d }) => (d[dateKey] ? daysAgo(d[dateKey]) > n : null));
    const first = isOld.indexOf(true);
    if (first === -1) return;                                   // alles auf dieser Seite ist neu genug
    if (isOld.slice(first).some((o) => o === false)) return;    // nicht nach Datum sortiert

    const days = n === 1 ? '1 Tag' : `${n} Tage`;
    let i = list.findIndex((x, idx) => idx >= first && x.visible);
    if (i !== -1) {
      setAttr(list[i].card, 'data-flf-cutoff', 'before');
      setAttr(list[i].card, 'data-flf-cutoff-label', `▼ Ab hier älter als ${days}`);
      return;
    }
    for (i = first - 1; i >= 0 && !list[i].visible; i--);
    if (i >= 0) {
      setAttr(list[i].card, 'data-flf-cutoff', 'after');
      setAttr(list[i].card, 'data-flf-cutoff-label', `▲ Alle weiteren Projekte sind älter als ${days}`);
    }
  }

  function applyFilters() {
    const cards = document.querySelectorAll('search-project-card');
    let hiddenCount = 0, dimCount = 0;
    const list = [];

    cards.forEach((card) => {
      const d = readCard(card);
      const entry = { card, d, visible: true };
      list.push(entry);
      const hits = FILTERS.map((f) => ({ mode: settings.modes[f.key], reason: CHECKS[f.key](d) }))
        .filter((h) => h.reason);
      const hide = hits.some((h) => h.mode === 'hide');
      const hl = firstMatch(rules.highlight, d.title);

      card.classList.remove('flf-hidden', 'flf-dim');
      card.classList.toggle('flf-highlight', !!hl && !hits.length);
      card.querySelector('.flf-reason')?.remove();

      if (!hits.length) return;

      if (hide && !settings.showHidden) {
        card.classList.add('flf-hidden');
        entry.visible = false;
        hiddenCount++;
        return;
      }

      hide ? hiddenCount++ : dimCount++;
      card.classList.add('flf-dim');
      const tag = document.createElement('div');
      tag.className = 'flf-reason';
      tag.textContent = (hide ? 'Ausgeblendet – ' : 'Ausgegraut – ') + hits.map((h) => h.reason).join(' · ');
      card.prepend(tag);
    });

    markCutoff(list, 'posted');
    updateCounter(hiddenCount, dimCount, cards.length);
  }

  // ---------------------------------------------------------------------------
  // Oberfläche: Button + Einstellungs-Panel
  // ---------------------------------------------------------------------------
  const css = `
    search-project-card.flf-hidden { display: none !important; }
    search-project-card.flf-dim > a { opacity: .35; }
    search-project-card.flf-dim:hover > a { opacity: .8; }
    search-project-card[data-flf-cutoff=before]::before,
    search-project-card[data-flf-cutoff=after]::after {
      content: attr(data-flf-cutoff-label); display: block; padding: 6px 4px; margin: 6px 0 12px;
      font: 700 14px sans-serif; color: #c0392b; border-top: 5px solid #c0392b; }
    search-project-card[data-flf-cutoff=after]::after { margin: 12px 0 6px; }
    search-project-card.flf-highlight .card { outline: 3px solid #f5b700; background: #fffbea; }
    .flf-reason { font: 12px sans-serif; color: #a33; margin: 0 0 4px 4px; }
    #flf-btn { position: fixed; right: 16px; bottom: 16px; z-index: 99999; background: #242d2e; color: #fff;
      border: 0; border-radius: 20px; padding: 8px 14px; font: 600 13px sans-serif; cursor: pointer;
      box-shadow: 0 2px 6px rgba(0,0,0,.3); }
    #flf-panel { position: fixed; right: 16px; bottom: 60px; z-index: 99999; width: 380px; max-height: 80vh;
      overflow: auto; background: #fff; color: #222; border-radius: 8px; padding: 14px;
      box-shadow: 0 4px 16px rgba(0,0,0,.3); font: 13px sans-serif; display: none; }
    #flf-panel.open { display: block; }
    #flf-panel h4 { margin: 0 0 6px; font-size: 15px; }
    #flf-panel .flf-item { border-top: 1px solid #eee; padding: 8px 0; }
    #flf-panel .flf-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
    #flf-panel .flf-head > span, #flf-panel .flf-head > label { font-weight: 600; }
    #flf-panel select { font-size: 12px; }
    #flf-panel textarea { width: 100%; height: 52px; margin-top: 4px; font: 12px monospace; box-sizing: border-box; }
    #flf-panel input[type=number] { width: 60px; }
    #flf-panel .flf-hint { color: #666; font-size: 11px; margin-top: 6px; }
    #flf-panel button { margin-top: 10px; padding: 6px 12px; cursor: pointer; }
  `;

  const modeSelect = (key) => `
    <select id="flf-mode-${key}" title="Was soll mit passenden Projekten passieren?">
      <option value="hide">Ausblenden</option>
      <option value="dim">Ausgrauen</option>
    </select>`;

  function filterHTML(f) {
    if (f.type === 'list') {
      return `<div class="flf-item"><div class="flf-head"><span>${f.label}</span>${modeSelect(f.key)}</div>
        <textarea id="flf-val-${f.key}" spellcheck="false"></textarea></div>`;
    }
    if (f.type === 'number') {
      const [a, b] = f.label.split('…');
      return `<div class="flf-item"><div class="flf-head">
        <span>${a}<input type="number" min="0" id="flf-val-${f.key}">${b}</span>${modeSelect(f.key)}</div></div>`;
    }
    return `<div class="flf-item"><div class="flf-head">
      <label><input type="checkbox" id="flf-val-${f.key}"> ${f.label}</label>${modeSelect(f.key)}</div></div>`;
  }

  let btn, panel;

  function buildUI() {
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);

    btn = document.createElement('button');
    btn.id = 'flf-btn';
    btn.textContent = 'Filter';
    btn.addEventListener('click', () => panel.classList.toggle('open'));

    panel = document.createElement('div');
    panel.id = 'flf-panel';
    panel.innerHTML = `
      <h4>Erweiterte Projektfilter</h4>
      ${FILTERS.map(filterHTML).join('')}
      <div class="flf-item"><div class="flf-head"><span>Titel hervorheben</span></div>
        <textarea id="flf-highlight" spellcheck="false"></textarea></div>
      <div class="flf-item"><label><input type="checkbox" id="flf-showHidden">
        Ausgeblendete vorübergehend (ausgegraut) anzeigen</label></div>
      <div class="flf-hint">Listen: ein Eintrag pro Zeile, Text = „enthält“ (Groß-/Kleinschreibung egal),
        reguläre Ausdrücke als <code>/muster/i</code>, z. B. <code>/\\bSAP\\b/i</code>.
        Tage: leer = Filter aus, 0 = nur heute.
        Trifft ein Projekt mehrere Filter, gewinnt „Ausblenden“.</div>
      <button id="flf-save">Speichern &amp; anwenden</button>
    `;
    document.body.append(btn, panel);

    // Werte ins Panel übernehmen
    for (const f of FILTERS) {
      const el = panel.querySelector('#flf-val-' + f.key);
      if (f.type === 'bool') el.checked = !!settings.values[f.key];
      else el.value = settings.values[f.key];
      panel.querySelector('#flf-mode-' + f.key).value = settings.modes[f.key];
    }
    panel.querySelector('#flf-highlight').value = settings.highlight;
    panel.querySelector('#flf-showHidden').checked = settings.showHidden;

    const commit = () => {
      for (const f of FILTERS) {
        const el = panel.querySelector('#flf-val-' + f.key);
        settings.values[f.key] = f.type === 'bool' ? el.checked : el.value.trim();
        settings.modes[f.key] = panel.querySelector('#flf-mode-' + f.key).value;
      }
      settings.highlight = panel.querySelector('#flf-highlight').value;
      settings.showHidden = panel.querySelector('#flf-showHidden').checked;
      save();
      compileRules();
      applyFilters();
    };

    panel.querySelector('#flf-save').addEventListener('click', commit);
    // Checkboxen und Modus-Auswahl wirken sofort
    panel.querySelectorAll('select, input[type=checkbox]').forEach((el) => el.addEventListener('change', commit));
  }

  function updateCounter(hidden, dimmed, total) {
    if (!btn) return;
    btn.style.display = total || panel.classList.contains('open') ? '' : 'none';
    const parts = [];
    if (hidden) parts.push(`${hidden} ausgeblendet`);
    if (dimmed) parts.push(`${dimmed} ausgegraut`);
    btn.textContent = parts.length ? `Filter (${parts.join(', ')} von ${total})` : 'Filter';
  }

  // ---------------------------------------------------------------------------
  // Start: Seite ist eine Angular-App → auf Änderungen reagieren
  // ---------------------------------------------------------------------------
  compileRules();
  buildUI();

  let timer;
  const observer = new MutationObserver((mutations) => {
    // eigene Änderungen ignorieren
    if (mutations.every((m) => m.target.closest?.('#flf-panel, #flf-btn') ||
        [...m.addedNodes, ...m.removedNodes].every((n) => n.classList?.contains('flf-reason')))) return;
    clearTimeout(timer);
    timer = setTimeout(applyFilters, 150);
  });
  observer.observe(document.body, { childList: true, subtree: true });

  applyFilters();
})();
