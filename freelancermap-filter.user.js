// ==UserScript==
// @name         freelancermap.de – Erweiterte Projektfilter
// @namespace    https://www.freelancermap.de/
// @version      1.2.0
// @description  Blendet Projekte nach Stichwörtern, Datum, Remote-Anteil und Vertragsart aus oder graut sie aus – pro Filter einstellbar.
// @match        https://www.freelancermap.de/*
// @match        https://freelancermap.de/*
// @grant        GM_getValue
// @grant        GM_setValue
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Filterdefinitionen
  //   type 'list'   : ein Eintrag pro Zeile, Text = „enthält“, /regex/i = regulärer Ausdruck
  //   type 'number' : Zahl, leer = aus
  //   type 'bool'   : Checkbox
  // Jeder Filter hat seinen eigenen Modus: 'hide' (ausblenden) oder 'dim' (ausgrauen)
  // ---------------------------------------------------------------------------
  const FILTERS = [
    { key: 'title',     type: 'list',   label: 'Titel ausschließen' },
    { key: 'company',   type: 'list',   label: 'Firma ausschließen' },
    { key: 'location',  type: 'list',   label: 'Ort ausschließen' },
    { key: 'maxAge',    type: 'number', label: 'Veröffentlicht vor mehr als … Tagen' },
    { key: 'maxStart',  type: 'number', label: 'Projektstart in mehr als … Tagen' },
    { key: 'minRemote', type: 'number', label: 'Remote-Anteil unter … %' },
    { key: 'anue',      type: 'bool',   label: 'Arbeitnehmerüberlassung' },
    { key: 'perm',      type: 'bool',   label: 'Festanstellung' },
  ];

  const DEFAULTS = {
    values: { title: '', company: '', location: '', maxAge: '', maxStart: '', minRemote: '', anue: false, perm: false },
    modes: Object.fromEntries(FILTERS.map((f) => [f.key, 'hide'])),
    highlight: '',
    showHidden: false,
  };

  const raw = GM_getValue('settings', {});
  const settings = {
    values: Object.assign({}, DEFAULTS.values, raw.values),
    modes: Object.assign({}, DEFAULTS.modes, raw.modes),
    highlight: raw.highlight ?? DEFAULTS.highlight,
    showHidden: raw.showHidden ?? DEFAULTS.showHidden,
  };
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
            console.warn('[FM-Filter] Ungültiger regulärer Ausdruck:', line);
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

  // Ganze Kalendertage zwischen heute und dem Datum (positiv = Vergangenheit)
  function daysAgo(date) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const d = new Date(date); d.setHours(0, 0, 0, 0);
    return Math.round((today - d) / 86400000);
  }

  // Veröffentlichungsdatum: "16.11.2026", zur Sicherheit auch "heute", "gestern", "vor 3 Std."
  function parseCreated(s) {
    let m = s.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
    if (m) return new Date(+m[3], m[2] - 1, +m[1]);
    const d = new Date();
    if (/^\s*\d{1,2}:\d{2}\s*(uhr)?\s*$/i.test(s)) return d;          // nur Uhrzeit = heute
    if (/heute|vor\s+\d+\s*(sek|min|std|stunde)/i.test(s)) return d;
    if (/gestern/i.test(s)) { d.setDate(d.getDate() - 1); return d; }
    m = s.match(/vor\s+(\d+)\s*tag/i);
    if (m) { d.setDate(d.getDate() - +m[1]); return d; }
    return null;
  }

  // Projektstart: "01/2027", "1/2027", "15.01.2027" → Date; "ab sofort" → null
  function parseStart(s) {
    let m = s.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
    if (m) return new Date(+m[3], m[2] - 1, +m[1]);
    m = s.match(/(\d{1,2})\/(\d{4})/);
    if (m) return new Date(+m[2], m[1] - 1, 1);
    return null;
  }

  // Remote-Anteil: "100% Remote" → 100, "60% Remote" → 60, "Vor Ort" → 0, unbekannt → null
  function parseRemote(s) {
    const m = s.match(/(\d+)\s*%/);
    if (m) return +m[1];
    if (/vor\s*ort/i.test(s)) return 0;
    if (/remote/i.test(s)) return 100;
    return null;
  }

  function readCard(card) {
    const f = (id) => txt(card.querySelector(`[data-testid="${id}"]`));
    return {
      title: f('title'),
      company: txt(card.querySelector('.project-card-company')),
      location: f('city'),
      remote: parseRemote(f('remoteInPercent')),
      type: f('type'),
      start: parseStart(f('beginningMonth') || f('beginningText')),
      created: parseCreated(f('created')),
      top: !!card.querySelector('[data-testid="top-project"]'),   // bezahltes Top-Projekt (nicht nach Datum sortiert)
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
      highlight: parseRules(settings.highlight),
    };
  }

  const num = (k) => parseInt(settings.values[k], 10);

  const CHECKS = {
    title: (d) => { const r = firstMatch(rules.title, d.title); return r && 'Titel: ' + r.label; },
    company: (d) => { const r = firstMatch(rules.company, d.company); return r && 'Firma: ' + r.label; },
    location: (d) => { const r = firstMatch(rules.location, d.location); return r && 'Ort: ' + r.label; },
    maxAge: (d) => {
      const n = num('maxAge');
      return !isNaN(n) && d.created && daysAgo(d.created) > n ? `älter als ${n} Tag(e) (${fmt(d.created)})` : null;
    },
    maxStart: (d) => {
      const n = num('maxStart');
      return !isNaN(n) && d.start && -daysAgo(d.start) > n ? `Start erst ab ${fmt(d.start)}` : null;
    },
    minRemote: (d) => {
      const n = num('minRemote');
      return !isNaN(n) && d.remote !== null && d.remote < n ? `nur ${d.remote}% remote` : null;
    },
    anue: (d) => (settings.values.anue && /überlassung|\bANÜ\b/i.test(d.type) ? 'Arbeitnehmerüberlassung' : null),
    perm: (d) => (settings.values.perm && /festanstellung/i.test(d.type) ? 'Festanstellung' : null),
  };

  // ---------------------------------------------------------------------------
  // Filter anwenden
  // Die Seite ist eine React-App. Damit React nicht durcheinanderkommt, fügt das
  // Skript keine Elemente in die Karten ein, sondern setzt nur data-Attribute.
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
  function markCutoff(all, dateKey) {
    all.forEach(({ card }) => {
      setAttr(card, 'data-flf-cutoff', null);
      setAttr(card, 'data-flf-cutoff-label', null);
    });
    // Top-Projekte stehen unabhängig vom Datum oben und zählen für die Grenze nicht
    const list = all.filter((x) => !x.d.top);

    const n = parseInt(settings.values.maxAge, 10);
    if (isNaN(n)) return;

    const isOld = list.map(({ d }) => (d[dateKey] ? daysAgo(d[dateKey]) > n : null));
    const first = isOld.indexOf(true);
    const days = n === 1 ? '1 Tag' : `${n} Tage`;

    // Grenze liegt erst auf einer der nächsten Seiten → Hinweis unter dem letzten sichtbaren Projekt
    if (first === -1) {
      let last = list.length - 1;
      while (last >= 0 && !list[last].visible) last--;
      if (last >= 0 && isOld.some((o) => o === false)) {
        setAttr(list[last].card, 'data-flf-cutoff', 'pending');
        setAttr(list[last].card, 'data-flf-cutoff-label', `▼ Noch nichts älter als ${days} – auf der nächsten Seite weiterlesen`);
      }
      return;
    }
    if (isOld.slice(first).some((o) => o === false)) return;    // nicht nach Datum sortiert

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
    const cards = document.querySelectorAll('.project-card');
    let hiddenCount = 0, dimCount = 0;
    const list = [];

    cards.forEach((card) => {
      const d = readCard(card);
      const hits = FILTERS.map((f) => ({ mode: settings.modes[f.key], reason: CHECKS[f.key](d) }))
        .filter((h) => h.reason);
      const hide = hits.some((h) => h.mode === 'hide');
      const hl = !hits.length && firstMatch(rules.highlight, d.title);

      let state = null, reason = null;
      if (hits.length) {
        if (hide && !settings.showHidden) state = 'hidden';
        else {
          state = 'dim';
          reason = (hide ? 'Ausgeblendet – ' : 'Ausgegraut – ') + hits.map((h) => h.reason).join(' · ');
        }
        hide ? hiddenCount++ : dimCount++;
      }

      setAttr(card, 'data-flf', state);
      setAttr(card, 'data-flf-reason', reason);
      setAttr(card, 'data-flf-hl', hl ? '1' : null);
      list.push({ card, d, visible: state !== 'hidden' });
    });

    markCutoff(list, 'created');
    updateCounter(hiddenCount, dimCount, cards.length);
  }

  // ---------------------------------------------------------------------------
  // Oberfläche: Button + Einstellungs-Panel
  // ---------------------------------------------------------------------------
  const css = `
    .project-card[data-flf="hidden"] { display: none !important; }
    .project-card[data-flf="dim"], .project-card[data-flf-cutoff] { position: relative; }
    .project-card[data-flf="dim"] > * { opacity: .35; }
    .project-card[data-flf="dim"]:hover > * { opacity: .8; }
    .project-card[data-flf-cutoff=before] { margin-top: 44px !important; }
    .project-card[data-flf-cutoff=after], .project-card[data-flf-cutoff=pending] { margin-bottom: 44px !important; }
    .project-card[data-flf-cutoff]::after {
      content: attr(data-flf-cutoff-label); position: absolute; left: 0; right: 0; padding: 4px 2px;
      font: 700 14px sans-serif; color: #c0392b; border-top: 5px solid #c0392b; pointer-events: none; }
    .project-card[data-flf-cutoff=before]::after { top: -40px; }
    .project-card[data-flf-cutoff=after]::after, .project-card[data-flf-cutoff=pending]::after { bottom: -40px; }
    .project-card[data-flf-cutoff=pending]::after { color: #888; border-top: 3px dashed #aaa; font-weight: 600; }
    .project-card[data-flf-reason]::before { content: attr(data-flf-reason); position: absolute; top: 2px; left: 8px;
      font: 11px sans-serif; color: #a33; z-index: 1; }
    .project-card[data-flf-hl] { outline: 3px solid #f5b700; background: #fffbea; }
  `;

  // Styles für Button und Panel – liegen im Shadow DOM, CSS der Seite wirkt dort nicht
  const panelCss = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    #flf-btn { position: fixed; right: 16px; bottom: 16px; z-index: 99999; background: #242d2e; color: #fff;
      border: 0; border-radius: 20px; padding: 8px 14px; font: 600 13px sans-serif; cursor: pointer;
      box-shadow: 0 2px 6px rgba(0,0,0,.3); }
    #flf-panel { position: fixed; right: 16px; bottom: 60px; z-index: 99999; width: 380px; max-height: 80vh;
      overflow: auto; background: #fff; color: #222; border-radius: 8px; padding: 14px;
      box-shadow: 0 4px 16px rgba(0,0,0,.3); font: 13px sans-serif; display: none; text-align: left; }
    #flf-panel.open { display: block; }
    #flf-panel h4 { margin: 0 0 6px; font-size: 15px; }
    #flf-panel .flf-item { border-top: 1px solid #eee; padding: 8px 0; }
    #flf-panel .flf-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
    #flf-panel .flf-head > span, #flf-panel .flf-head > label { font-weight: 600; }
    #flf-panel select { font-size: 12px; width: auto; }
    #flf-panel textarea { width: 100%; height: 52px; margin-top: 4px; font: 12px monospace; box-sizing: border-box; }
    #flf-panel input[type=number] { width: 60px; display: inline-block; }
    #flf-panel input[type=checkbox] { margin: 0 4px 0 0; vertical-align: middle; }
    #flf-panel code { font-size: 11px; }
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

    // Eigener Container mit Shadow DOM, damit das Seiten-CSS (z. B. für Checkboxen) nicht stört
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
        Zahlen: leer = Filter aus. Tage: 0 = nur heute. „Vor Ort“ zählt als 0 % remote.
        Trifft ein Projekt mehrere Filter, gewinnt „Ausblenden“.</div>
      <button type="button" id="flf-save">Speichern &amp; anwenden</button>
    `;
    root.append(pstyle, btn, panel);
    document.body.append(host);

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
    panel.querySelectorAll('select, input[type=checkbox]').forEach((el) => el.addEventListener('change', commit));
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

  // ---------------------------------------------------------------------------
  // Start: auf Änderungen der React-App reagieren (neue Suche, Seitenwechsel)
  // ---------------------------------------------------------------------------
  compileRules();
  buildUI();

  let timer;
  const observer = new MutationObserver((mutations) => {
    // Änderungen im Shadow DOM des Panels erreichen diesen Observer nicht
    clearTimeout(timer);
    timer = setTimeout(applyFilters, 150);
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });

  applyFilters();
})();
