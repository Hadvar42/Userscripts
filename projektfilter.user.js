// ==UserScript==
// @name         Projektbörsen – Erweiterte Projektfilter
// @namespace    https://github.com/Hadvar42/Userscripts
// @version      2.0.0
// @description  Filter für freelance.de und freelancermap.de mit gemeinsamen Ausschlusslisten: Stichwörter, Projektstart, Alter, Remote, Arbeitnehmerüberlassung – pro Filter ausblenden oder ausgrauen.
// @match        https://www.freelance.de/*
// @match        https://freelance.de/*
// @match        https://www.freelancermap.de/*
// @match        https://freelancermap.de/*
// @grant        GM_getValue
// @grant        GM_setValue
// @run-at       document-idle
// @homepageURL  https://github.com/Hadvar42/Userscripts
// @updateURL    https://raw.githubusercontent.com/Hadvar42/Userscripts/main/projektfilter.user.js
// @downloadURL  https://raw.githubusercontent.com/Hadvar42/Userscripts/main/projektfilter.user.js
// ==/UserScript==

(function () {
  'use strict';

  // ===========================================================================
  // Hilfsfunktionen
  // ===========================================================================
  const txt = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
  const fmt = (d) => d.toLocaleDateString('de-DE');

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
            console.warn('[Projektfilter] Ungültiger regulärer Ausdruck:', line);
            return null;
          }
        }
        const needle = line.toLowerCase();
        return { label: line, test: (s) => s.toLowerCase().includes(needle) };
      })
      .filter(Boolean);
  }
  const firstMatch = (rules, text) => rules.find((r) => r.test(text)) || null;

  // Ganze Kalendertage zwischen heute und dem Datum (positiv = Vergangenheit)
  function daysAgo(date) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const d = new Date(date); d.setHours(0, 0, 0, 0);
    return Math.round((today - d) / 86400000);
  }

  // "17.11.2026" / "17.11.2026 14:42" → Date
  function parseDMY(s) {
    const m = s.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
    return m ? new Date(+m[3], m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0)) : null;
  }

  // Projektstart: "17.11.2026", "Ab Dezember 2026", "12/2026" → Date (Monatsangaben = Monatserster); "ab sofort" → null
  const MONTHS = ['januar', 'februar', 'märz', 'april', 'mai', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'dezember'];
  function parseStart(s) {
    const d = parseDMY(s);
    if (d) return d;
    let m = s.toLowerCase().match(new RegExp('(' + MONTHS.join('|') + ')\\s+(\\d{4})'));
    if (m) return new Date(+m[2], MONTHS.indexOf(m[1]), 1);
    m = s.match(/(\d{1,2})\/(\d{4})/);
    return m ? new Date(+m[2], m[1] - 1, 1) : null;
  }

  // Veröffentlicht: Datum, oder nur Uhrzeit / "heute" / "gestern" / "vor 3 Tagen"
  function parseCreated(s) {
    const d0 = parseDMY(s);
    if (d0) return d0;
    const d = new Date();
    if (/^\s*\d{1,2}:\d{2}\s*(uhr)?\s*$/i.test(s)) return d;
    if (/heute|vor\s+\d+\s*(sek|min|std|stunde)/i.test(s)) return d;
    if (/gestern/i.test(s)) { d.setDate(d.getDate() - 1); return d; }
    const m = s.match(/vor\s+(\d+)\s*tag/i);
    if (m) { d.setDate(d.getDate() - +m[1]); return d; }
    return null;
  }

  // "100% Remote" → 100, "Vor Ort" → 0, "Remote" ohne Zahl → 100, unbekannt → null
  function parseRemotePct(s) {
    const m = s.match(/(\d+)\s*%/);
    if (m) return +m[1];
    if (/vor\s*ort/i.test(s)) return 0;
    if (/remote/i.test(s)) return 100;
    return null;
  }

  function setAttr(el, name, value) {
    if (value == null) { if (el.hasAttribute(name)) el.removeAttribute(name); }
    else if (el.getAttribute(name) !== value) el.setAttribute(name, value);
  }

  // ===========================================================================
  // Seiten-Anpassungen: wie Projektkarten gefunden, gelesen und markiert werden
  // Einheitliche Felder: title, company, location, skills[], isAnue, isPerm,
  //   remote (true/false/null), remotePct, start, posted, top, main
  // ===========================================================================
  const SITES = {
    fl: {
      name: 'freelance.de',
      // Angular-App; Karten = <search-project-card>
      cards: () => document.querySelectorAll('search-project-card'),
      read(card) {
        const info = (icon) => { const i = card.querySelector('i.' + icon); return i ? txt(i.closest('li')) : ''; };
        const location = info('fa-map-marker-alt');
        const remoteText = info('fa-laptop-house');
        return {
          title: txt(card.querySelector('h3')),
          company: txt(card.querySelector('h3 + small')),
          location,
          skills: [...card.querySelectorAll('a.badge')].map(txt),
          isAnue: [...card.querySelectorAll('small.badge')].some((b) => /arbeitnehmerüberlassung/i.test(txt(b))),
          isPerm: false,
          remote: /remote/i.test(remoteText + ' ' + location),
          remotePct: null,
          start: parseStart(info('fa-calendar-star')),
          posted: parseDMY(info('fa-history')),
          top: false,
          main: true,
        };
      },
      // Angular verträgt ein vorangestelltes Hinweis-Element; Zustand über Klassen
      render(card, state, reason, hl) {
        card.classList.toggle('flf-hidden', state === 'hidden');
        card.classList.toggle('flf-dim', state === 'dim');
        card.classList.toggle('flf-highlight', hl);
        let tag = card.querySelector(':scope > .flf-reason');
        if (reason) {
          if (!tag) { tag = document.createElement('div'); tag.className = 'flf-reason'; card.prepend(tag); }
          if (tag.textContent !== reason) tag.textContent = reason;
        } else if (tag) tag.remove();
      },
      css: `
        search-project-card.flf-hidden { display: none !important; }
        search-project-card.flf-dim > a { opacity: .35; }
        search-project-card.flf-dim:hover > a { opacity: .8; }
        search-project-card.flf-highlight .card { outline: 3px solid #f5b700; background: #fffbea; }
        .flf-reason { font: 12px sans-serif; color: #a33; margin: 0 0 4px 4px; }
        search-project-card[data-flf-cutoff=before]::before,
        search-project-card[data-flf-cutoff=after]::after,
        search-project-card[data-flf-cutoff=pending]::after {
          content: attr(data-flf-cutoff-label); display: block; padding: 6px 4px; margin: 6px 0 12px;
          font: 700 14px sans-serif; color: #c0392b; border-top: 5px solid #c0392b; }
        search-project-card[data-flf-cutoff=after]::after,
        search-project-card[data-flf-cutoff=pending]::after { margin: 12px 0 6px; }
        search-project-card[data-flf-cutoff=pending]::after { color: #888; border-top: 3px dashed #aaa; font-weight: 600; }
      `,
    },

    fm: {
      name: 'freelancermap.de',
      // React-App; Karten = .project-card (auch in nachgeladenen „Ähnliche Projekte“)
      cards: () => document.querySelectorAll('.project-card'),
      read(card) {
        const f = (id) => txt(card.querySelector(`[data-testid="${id}"]`));
        const type = f('type');
        const remotePct = parseRemotePct(f('remoteInPercent'));
        return {
          title: f('title'),
          company: txt(card.querySelector('.project-card-company')),
          location: f('city'),
          skills: [],
          isAnue: /überlassung|\bANÜ\b/i.test(type),
          isPerm: /festanstellung/i.test(type),
          remote: remotePct === null ? null : remotePct > 0,
          remotePct,
          start: parseStart(f('beginningMonth') || f('beginningText')),
          posted: parseCreated(f('created')),
          top: !!card.querySelector('[data-testid="top-project"]'),
          main: !!card.closest('#project-search-result') || !document.querySelector('#project-search-result'),
        };
      },
      // React: keine Elemente in die Karten einfügen, nur data-Attribute setzen
      render(card, state, reason, hl) {
        setAttr(card, 'data-flf', state);
        setAttr(card, 'data-flf-reason', reason);
        setAttr(card, 'data-flf-hl', hl ? '1' : null);
      },
      css: `
        .project-card[data-flf="hidden"] { display: none !important; }
        .project-card[data-flf="dim"], .project-card[data-flf-cutoff] { position: relative; }
        .project-card[data-flf="dim"] > * { opacity: .35; }
        .project-card[data-flf="dim"]:hover > * { opacity: .8; }
        .project-card[data-flf-hl] { outline: 3px solid #f5b700; background: #fffbea; }
        .project-card[data-flf-reason]::before { content: attr(data-flf-reason); position: absolute; top: 2px; left: 8px;
          font: 11px sans-serif; color: #a33; z-index: 1; }
        .project-card[data-flf-cutoff=before] { margin-top: 44px !important; }
        .project-card[data-flf-cutoff=after], .project-card[data-flf-cutoff=pending] { margin-bottom: 44px !important; }
        .project-card[data-flf-cutoff]::after {
          content: attr(data-flf-cutoff-label); position: absolute; left: 0; right: 0; padding: 4px 2px;
          font: 700 14px sans-serif; color: #c0392b; border-top: 5px solid #c0392b; pointer-events: none; }
        .project-card[data-flf-cutoff=before]::after { top: -40px; }
        .project-card[data-flf-cutoff=after]::after, .project-card[data-flf-cutoff=pending]::after { bottom: -40px; }
        .project-card[data-flf-cutoff=pending]::after { color: #888; border-top: 3px dashed #aaa; font-weight: 600; }
      `,
    },
  };

  const siteKey = /(^|\.)freelancermap\.de$/.test(location.hostname) ? 'fm' : 'fl';
  const SITE = SITES[siteKey];

  // ===========================================================================
  // Filterdefinitionen
  //   scope 'shared' = gilt auf beiden Seiten, 'fl' = nur freelance.de, 'fm' = nur freelancermap.de
  //   type: list (ein Eintrag pro Zeile), number, date, bool
  // ===========================================================================
  const FILTERS = [
    { scope: 'shared', key: 'title',     type: 'list',   label: 'Titel ausschließen' },
    { scope: 'shared', key: 'company',   type: 'list',   label: 'Firma ausschließen' },
    { scope: 'shared', key: 'location',  type: 'list',   label: 'Ort ausschließen' },
    { scope: 'shared', key: 'startFrom', type: 'date',   label: 'Projektstart ab … ausschließen' },
    { scope: 'shared', key: 'anue',      type: 'bool',   label: 'Arbeitnehmerüberlassung' },
    { scope: 'shared', key: 'remote',    type: 'bool',   label: 'Ohne Remote-Möglichkeit' },
    { scope: 'fl',     key: 'skill',     type: 'list',   label: 'Skill ausschließen' },
    { scope: 'fl',     key: 'maxAge',    type: 'number', label: 'Veröffentlicht vor mehr als … Tagen' },
    { scope: 'fm',     key: 'maxAge',    type: 'number', label: 'Veröffentlicht vor mehr als … Tagen' },
    { scope: 'fm',     key: 'minRemote', type: 'number', label: 'Remote-Anteil unter … %' },
    { scope: 'fm',     key: 'perm',      type: 'bool',   label: 'Festanstellung' },
  ];
  const ACTIVE = FILTERS.filter((f) => f.scope === 'shared' || f.scope === siteKey);
  const fid = (f) => `${f.scope}-${f.key}`;

  // ===========================================================================
  // Einstellungen: { shared|fl|fm: { values, modes }, highlight, showHidden }
  // ===========================================================================
  function loadSettings() {
    const raw = GM_getValue('settings', {});
    const s = { highlight: raw.highlight ?? '', showHidden: raw.showHidden ?? false };
    for (const scope of ['shared', 'fl', 'fm']) {
      const r = raw[scope] || {};
      s[scope] = { values: Object.assign({}, r.values), modes: Object.assign({}, r.modes) };
    }
    for (const f of FILTERS) {
      const g = s[f.scope];
      if (g.values[f.key] === undefined) g.values[f.key] = f.type === 'bool' ? false : '';
      if (!g.modes[f.key]) g.modes[f.key] = 'hide';
    }
    return s;
  }
  const settings = loadSettings();
  const save = () => GM_setValue('settings', settings);
  const val = (f) => settings[f.scope].values[f.key];
  const mode = (f) => settings[f.scope].modes[f.key];
  const siteVal = (key) => settings[siteKey].values[key];

  // ===========================================================================
  // Prüfungen: liefern einen Grund (String) oder null
  // ===========================================================================
  let rules = {};
  function compileRules() {
    rules = {
      title: parseRules(settings.shared.values.title),
      company: parseRules(settings.shared.values.company),
      location: parseRules(settings.shared.values.location),
      skill: parseRules(settings.fl.values.skill),
      highlight: parseRules(settings.highlight),
    };
  }

  function parseInputDate(v) {   // <input type=date> liefert "2026-12-01"
    const m = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? new Date(+m[1], m[2] - 1, +m[3]) : null;
  }

  const CHECKS = {
    title: (d) => { const r = firstMatch(rules.title, d.title); return r && 'Titel: ' + r.label; },
    company: (d) => { const r = firstMatch(rules.company, d.company); return r && 'Firma: ' + r.label; },
    location: (d) => { const r = firstMatch(rules.location, d.location); return r && 'Ort: ' + r.label; },
    skill: (d) => {
      for (const s of d.skills) { const r = firstMatch(rules.skill, s); if (r) return 'Skill: ' + r.label; }
      return null;
    },
    startFrom: (d, v) => {
      const limit = parseInputDate(v);
      return limit && d.start && d.start >= limit ? `Start ${fmt(d.start)}` : null;
    },
    anue: (d, v) => (v && d.isAnue ? 'Arbeitnehmerüberlassung' : null),
    perm: (d, v) => (v && d.isPerm ? 'Festanstellung' : null),
    remote: (d, v) => (v && d.remote === false ? 'kein Remote' : null),
    maxAge: (d, v) => {
      const n = parseInt(v, 10);
      return !isNaN(n) && d.posted && daysAgo(d.posted) > n ? `älter als ${n} Tag(e) (${fmt(d.posted)})` : null;
    },
    minRemote: (d, v) => {
      const n = parseInt(v, 10);
      return !isNaN(n) && d.remotePct !== null && d.remotePct < n ? `nur ${d.remotePct}% remote` : null;
    },
  };

  // ===========================================================================
  // Altersgrenze markieren (Linie in der Ergebnisliste)
  // ===========================================================================
  let lastLog = '';
  function debugLog(label, data) {
    const sig = label + JSON.stringify(data);
    if (sig === lastLog) return;
    lastLog = sig;
    console.debug('[Projektfilter] ' + label, data);
  }

  function markCutoff(all) {
    all.forEach(({ card }) => {
      setAttr(card, 'data-flf-cutoff', null);
      setAttr(card, 'data-flf-cutoff-label', null);
    });
    document.querySelectorAll('[data-flf-cutoff-list]').forEach((el) => el.removeAttribute('data-flf-cutoff-list'));

    const n = parseInt(siteVal('maxAge'), 10);
    if (isNaN(n)) return;

    // Nur die eigentliche Ergebnisliste zählt; Top-Projekte stehen unabhängig vom Datum oben
    const list = all.filter((x) => x.d.main && !x.d.top);
    const isOld = list.map(({ d }) => (d.posted ? daysAgo(d.posted) > n : null));
    const days = n === 1 ? '1 Tag' : `${n} Tage`;
    debugLog('Altersgrenze', {
      projekte: list.length, ignoriert: all.length - list.length, grenzeTage: n,
      alt: isOld.map((o) => (o === null ? '?' : o ? 'A' : 'n')).join(''),
    });

    // Sortierung ist nicht streng → Beginn des Endstücks suchen, in dem nur noch alte Projekte kommen
    let start = list.length;
    while (start > 0 && isOld[start - 1] !== false) start--;
    while (start < list.length && isOld[start] !== true) start++;
    const first = start < list.length ? start : -1;

    if (first === -1) {
      let last = list.length - 1;
      while (last >= 0 && !list[last].visible) last--;
      if (last >= 0 && isOld.some((o) => o === false)) {
        setAttr(list[last].card, 'data-flf-cutoff', 'pending');
        setAttr(list[last].card, 'data-flf-cutoff-label', `▼ Noch nichts älter als ${days} – auf der nächsten Seite weiterlesen`);
      }
      return;
    }
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
      return;
    }
    const container = list[first].card.parentElement;
    if (container) setAttr(container, 'data-flf-cutoff-list', `▲ Alle Projekte auf dieser Seite sind älter als ${days}`);
  }

  // ===========================================================================
  // Filter anwenden
  // ===========================================================================
  function applyFilters() {
    const cards = SITE.cards();
    let hiddenCount = 0, dimCount = 0;
    const all = [];

    cards.forEach((card) => {
      const d = SITE.read(card);
      const hits = ACTIVE.map((f) => ({ mode: mode(f), reason: CHECKS[f.key](d, val(f)) })).filter((h) => h.reason);
      const hide = hits.some((h) => h.mode === 'hide');
      const hl = !hits.length && !!firstMatch(rules.highlight, d.title);

      let state = null, reason = null;
      if (hits.length) {
        if (hide && !settings.showHidden) state = 'hidden';
        else {
          state = 'dim';
          reason = (hide ? 'Ausgeblendet – ' : 'Ausgegraut – ') + hits.map((h) => h.reason).join(' · ');
        }
        hide ? hiddenCount++ : dimCount++;
      }
      SITE.render(card, state, reason, hl);
      all.push({ card, d, visible: state !== 'hidden' });
    });

    markCutoff(all);
    updateCounter(hiddenCount, dimCount, cards.length);
  }

  // ===========================================================================
  // Oberfläche: Button + Einstellungsfenster (im Shadow DOM, Seiten-CSS wirkt dort nicht)
  // ===========================================================================
  const commonCss = `
    [data-flf-cutoff-list]::before { content: attr(data-flf-cutoff-list); display: block; grid-column: 1 / -1;
      padding: 6px 4px; margin: 6px 0 12px; font: 700 14px sans-serif; color: #c0392b; border-top: 5px solid #c0392b; }
  `;

  const panelCss = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    #flf-btn { position: fixed; right: 16px; bottom: 16px; z-index: 99999; background: #242d2e; color: #fff;
      border: 0; border-radius: 20px; padding: 8px 14px; font: 600 13px sans-serif; cursor: pointer;
      box-shadow: 0 2px 6px rgba(0,0,0,.3); }
    #flf-panel { position: fixed; right: 16px; bottom: 60px; z-index: 99999; width: 400px; max-height: 82vh;
      overflow: auto; background: #fff; color: #222; border-radius: 8px; padding: 14px;
      box-shadow: 0 4px 16px rgba(0,0,0,.3); font: 13px sans-serif; display: none; text-align: left; }
    #flf-panel.open { display: block; }
    h4 { margin: 0 0 10px; font-size: 15px; }
    fieldset { border: 0; border-left: 4px solid; border-radius: 4px; margin: 0 0 12px; padding: 4px 10px 6px; }
    fieldset.shared { border-color: #2e86c1; background: #f2f8fc; }
    fieldset.site { border-color: #d68910; background: #fef8ee; }
    legend { font-weight: 700; font-size: 13px; padding: 0; margin-bottom: 2px; float: left; width: 100%; }
    legend small { display: block; font-weight: 400; color: #666; font-size: 11px; }
    .flf-item { border-top: 1px solid rgba(0,0,0,.08); padding: 7px 0; clear: both; }
    .flf-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
    .flf-head > span, .flf-head > label { font-weight: 600; }
    select { font-size: 12px; }
    textarea { width: 100%; height: 50px; margin-top: 4px; font: 12px monospace; }
    input[type=number] { width: 56px; margin: 0 3px; }
    input[type=date] { margin: 0 3px; font-size: 12px; }
    input[type=checkbox] { margin: 0 4px 0 0; vertical-align: middle; }
    code { font-size: 11px; }
    .flf-hint { color: #666; font-size: 11px; margin-top: 6px; }
    button.save { margin-top: 10px; padding: 6px 12px; cursor: pointer; }
  `;

  const modeSelect = (f) => `
    <select id="mode-${fid(f)}" title="Was soll mit passenden Projekten passieren?">
      <option value="hide">Ausblenden</option>
      <option value="dim">Ausgrauen</option>
    </select>`;

  function filterHTML(f) {
    const id = 'val-' + fid(f);
    if (f.type === 'list') {
      return `<div class="flf-item"><div class="flf-head"><span>${f.label}</span>${modeSelect(f)}</div>
        <textarea id="${id}" spellcheck="false"></textarea></div>`;
    }
    if (f.type === 'number' || f.type === 'date') {
      const [a, b] = f.label.split('…');
      const input = f.type === 'number' ? `<input type="number" min="0" id="${id}">` : `<input type="date" id="${id}">`;
      return `<div class="flf-item"><div class="flf-head"><span>${a}${input}${b}</span>${modeSelect(f)}</div></div>`;
    }
    return `<div class="flf-item"><div class="flf-head">
      <label><input type="checkbox" id="${id}"> ${f.label}</label>${modeSelect(f)}</div></div>`;
  }

  let btn, panel;

  function buildUI() {
    const style = document.createElement('style');
    style.textContent = SITE.css + commonCss;
    document.head.appendChild(style);

    const host = document.createElement('div');
    host.id = 'flf-host';
    const root = host.attachShadow({ mode: 'open' });
    const pstyle = document.createElement('style');
    pstyle.textContent = panelCss;

    btn = document.createElement('button');
    btn.id = 'flf-btn';
    btn.type = 'button';
    btn.textContent = 'Filter';
    btn.addEventListener('click', () => panel.classList.toggle('open'));

    const shared = ACTIVE.filter((f) => f.scope === 'shared');
    const own = ACTIVE.filter((f) => f.scope === siteKey);
    const other = SITES[siteKey === 'fl' ? 'fm' : 'fl'].name;

    panel = document.createElement('div');
    panel.id = 'flf-panel';
    panel.innerHTML = `
      <h4>Erweiterte Projektfilter</h4>
      <fieldset class="shared">
        <legend>Gemeinsam für freelance.de und freelancermap.de
          <small>Änderungen hier gelten auch auf ${other}.</small></legend>
        ${shared.map(filterHTML).join('')}
        <div class="flf-item"><div class="flf-head"><span>Titel hervorheben</span></div>
          <textarea id="highlight" spellcheck="false"></textarea></div>
      </fieldset>
      <fieldset class="site">
        <legend>Nur für ${SITE.name}
          <small>Gilt nicht auf ${other}.</small></legend>
        ${own.map(filterHTML).join('')}
      </fieldset>
      <label><input type="checkbox" id="showHidden"> Ausgeblendete vorübergehend (ausgegraut) anzeigen</label>
      <div class="flf-hint">Listen: ein Eintrag pro Zeile, Text = „enthält“ (Groß-/Kleinschreibung egal),
        reguläre Ausdrücke als <code>/muster/i</code>, z. B. <code>/\\bSAP\\b/i</code>.
        Leere Felder = Filter aus. Tage: 0 = nur heute.
        Projektstart: Monatsangaben („Dezember 2026“, „12/2026“) zählen als Monatserster; „ab sofort“ wird nie gefiltert.
        Trifft ein Projekt mehrere Filter, gewinnt „Ausblenden“.</div>
      <button type="button" class="save" id="save">Speichern &amp; anwenden</button>
    `;
    root.append(pstyle, btn, panel);
    document.body.append(host);

    const $ = (id) => panel.querySelector('#' + id);
    for (const f of ACTIVE) {
      const el = $('val-' + fid(f));
      if (f.type === 'bool') el.checked = !!val(f);
      else el.value = val(f);
      $('mode-' + fid(f)).value = mode(f);
    }
    $('highlight').value = settings.highlight;
    $('showHidden').checked = settings.showHidden;

    const commit = () => {
      for (const f of ACTIVE) {
        const el = $('val-' + fid(f));
        settings[f.scope].values[f.key] = f.type === 'bool' ? el.checked : el.value.trim();
        settings[f.scope].modes[f.key] = $('mode-' + fid(f)).value;
      }
      settings.highlight = $('highlight').value;
      settings.showHidden = $('showHidden').checked;
      save();
      compileRules();
      applyFilters();
    };
    $('save').addEventListener('click', commit);
    panel.querySelectorAll('select, input[type=checkbox], input[type=date]').forEach((el) => el.addEventListener('change', commit));
  }

  function updateCounter(hidden, dimmed, total) {
    if (!btn) return;
    btn.style.display = total || panel.classList.contains('open') ? '' : 'none';
    const parts = [];
    if (hidden) parts.push(`${hidden} ausgeblendet`);
    if (dimmed) parts.push(`${dimmed} ausgegraut`);
    const label = parts.length ? `Filter (${parts.join(', ')} von ${total})` : 'Filter';
    if (btn.textContent !== label) btn.textContent = label;
  }

  // ===========================================================================
  // Start: auf Änderungen der Seite reagieren (neue Suche, Seitenwechsel, Nachladen)
  // ===========================================================================
  compileRules();
  buildUI();

  const ownNode = (n) => n.nodeType === 1
    ? n.classList.contains('flf-reason')
    : !!(n.parentElement && n.parentElement.closest('.flf-reason'));
  let timer;
  new MutationObserver((mutations) => {
    // eigene Hinweis-Elemente (freelance.de) ignorieren; das Panel liegt im Shadow DOM und erscheint hier nicht
    if (mutations.every((m) => ownNode(m.target) || [...m.addedNodes, ...m.removedNodes].every(ownNode)
        && (m.addedNodes.length + m.removedNodes.length) > 0)) return;
    clearTimeout(timer);
    timer = setTimeout(applyFilters, 150);
  }).observe(document.body, { childList: true, subtree: true, characterData: true });

  // Sicherheitsnetz für Seitenwechsel, die der Observer nicht mitbekommt; Unverändertes wird nicht neu geschrieben
  setInterval(() => { if (!document.hidden) applyFilters(); }, 1000);

  applyFilters();
})();
