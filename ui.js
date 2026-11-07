// ─────────────────────────────────────────────────────────────
//  Pannello di controllo, generato da SECTIONS: ogni riga è un controllo.
//  Accessibilità: controlli nativi con etichetta, target ≥ 48 px,
//  focus ben visibile, Esc per chiudere, uguale con touch e tastiera.
// ─────────────────────────────────────────────────────────────

const UI = (() => {
  const $ = (id) => document.getElementById(id);
  const fmt = {
    x: (v) => v.toFixed(1) + '×',
    pct: (v) => Math.round(v * 100) + '%',
    n1: (v) => v.toFixed(1),
  };

  // Modalità sviluppo: aggiungi ?dev all'indirizzo (es. http://localhost:8000/?dev)
  const DEV = new URLSearchParams(location.search).has('dev');

  // range: slider su params[key] (set = funzione con effetti collaterali, opzionale)
  // toggle: interruttore su params[key] · action: bottone · keys: scorciatoia da tastiera
  // custom: sezione costruita a mano (musica, palette, analisi audio, stato)

  // Esperienza: ciò che serve a chi usa l'installazione
  const USER = [
    { title: 'Musica', custom: () => buildMusic() },
    { title: 'Palette', custom: () => buildPalette() },
    { title: 'Magia', row: true, items: [
      { type: 'action', label: 'Ondata di luce', run: () => audio.triggerSurge(), keys: 'E' },
      { type: 'action', label: 'Fai sbocciare un fiore', run: () => spawnFlower(), keys: 'N' },
      { type: 'action', label: 'Chiama un folletto', run: () => spawnFairy(), keys: 'K' },
    ]},
    { title: 'Creature', items: [
      { type: 'toggle', key: 'flowers', label: 'Fiori', keys: 'B' },
      { type: 'toggle', key: 'fairies', label: 'Folletti', keys: 'L' },
    ]},
    { title: 'Intensità', items: [
      { type: 'range', key: 'react', label: 'Reattività alla musica', min: 0, max: 2.5, step: 0.1, format: fmt.x, set: (v) => setReact(v), keys: '+ −' },
    ]},
  ];

  // Sviluppo: taratura fine, diagnostica, scorciatoie
  const DEV_SECTIONS = [
    { title: 'Analisi audio', custom: () => buildMeters() },
    { title: 'Luce', items: [
      { type: 'range', key: 'light', label: 'Intensità delle ondate', min: 0, max: 2, step: 0.1, format: fmt.pct },
      { type: 'range', key: 'surgeFreq', label: 'Frequenza delle ondate', min: 0, max: 1, step: 0.1, format: fmt.pct, set: (v) => setSurgeFreq(v), keys: '[ ]' },
      { type: 'range', key: 'glow', label: 'Bagliore', min: 0, max: 2, step: 0.05, format: fmt.pct },
      { type: 'range', key: 'sparkle', label: 'Polvere fatata', min: 0, max: 2, step: 0.05, format: fmt.pct, keys: 'S' },
    ]},
    { title: 'Immagine', items: [
      { type: 'range', key: 'feedback', label: 'Scie', min: 0, max: 0.97, step: 0.01, format: fmt.pct, keys: '↑ ↓' },
      { type: 'range', key: 'warp', label: 'Liquido', min: 0, max: 4, step: 0.1, format: fmt.n1, keys: '← →' },
      { type: 'range', key: 'colorize', label: 'Colori della palette', min: 0, max: 1, step: 0.05, format: fmt.pct },
    ]},
    { title: 'Movimento', items: [
      { type: 'range', key: 'motion', label: 'Sensibilità al movimento', min: 0, max: 2, step: 0.1, format: fmt.pct },
      { type: 'toggle', key: 'motionView', label: 'Mostra il movimento rilevato', keys: 'V' },
    ]},
    { title: 'Stato', custom: () => [
      h('p', { id: 'health', class: 'status' }),
      buildAction({ label: 'Riavvia la grafica', run: () => rebuildGraphics() }),
      buildAction({ label: 'Ripristina i valori predefiniti', run: () => { resetParams(); sync(); } }),
    ]},
  ];

  // Le scorciatoie "dev" funzionano solo in modalità sviluppo (vedi keyPressed in sketch.js)
  const SHORTCUTS = [
    ['1 – 4', 'palette'], ['E', 'ondata di luce'], ['N / K', 'nuovo fiore · nuovo folletto'],
    ['B / L', 'fiori · folletti on/off'], ['+ / −', 'reattività'], ['Spazio', 'play / pausa'],
    ['T / M', 'brano · ingresso live'], ['F', 'schermo intero'], ['H', 'mostra / nascondi pannello'], ['Esc', 'chiudi pannello'],
    ['[ / ]', 'frequenza ondate (dev)'], ['↑ / ↓', 'scie (dev)'], ['← / →', 'liquido (dev)'],
    ['S', 'polvere on/off (dev)'], ['V', 'mostra il movimento (dev)'],
  ];

  const ranges = [], toggles = [];
  let panel, toggleBtn;

  // Crea un elemento: h('button', { class: 'x', onclick }, 'testo', figlio, ...)
  function h(tag, attrs = {}, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'class') el.className = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    el.append(...children.filter((c) => c != null));
    return el;
  }
  const kbd = (keys) => keys && h('kbd', { 'aria-hidden': 'true' }, keys);

  function buildRange(c) {
    const id = `ctl-${c.key}`;
    const input = h('input', { type: 'range', id, min: c.min, max: c.max, step: c.step });
    const out = h('output', { for: id });
    input.addEventListener('input', () => {
      const v = parseFloat(input.value);
      c.set ? c.set(v) : (params[c.key] = v);
      show(c, input, out);
    });
    ranges.push({ c, input, out });
    return h('div', { class: 'field' },
      h('div', { class: 'field-head' }, h('label', { for: id }, c.label), kbd(c.keys), out),
      input);
  }

  function show(c, input, out) {
    const text = c.format(params[c.key]);
    out.textContent = text;
    input.setAttribute('aria-valuetext', text);
    input.style.setProperty('--p', ((params[c.key] - c.min) / (c.max - c.min)) * 100 + '%'); // riempimento
  }

  function buildToggle(c) {
    const input = h('input', { type: 'checkbox', role: 'switch', class: 'switch',
      onchange: (e) => (params[c.key] = e.target.checked) });
    toggles.push({ c, input });
    return h('label', { class: 'field toggle' }, h('span', {}, c.label), kbd(c.keys), input);
  }

  const buildAction = (c) =>
    h('button', { type: 'button', class: 'btn', onclick: c.run }, c.label, kbd(c.keys));

  function buildMusic() {
    const fileInput = h('input', { type: 'file', id: 'file-input', accept: 'audio/*', hidden: true,
      onchange: (e) => {
        const f = e.target.files[0];
        if (f) audio.useFile(f).catch(console.warn);
        e.target.value = '';
      } });
    const live = h('select', { id: 'src-live',
      onfocus: () => refreshInputs().catch(console.warn),
      onchange: (e) => useLive(e.target.value) },
      h('option', { value: '' }, 'Ingresso predefinito'));
    return [
      h('div', { class: 'row' },
        h('button', { type: 'button', class: 'btn', id: 'src-play', onclick: () => audio.togglePlay() },
          h('span', { id: 'play-label' }, 'Pausa'), kbd('Spazio')),
        h('button', { type: 'button', class: 'btn', id: 'src-track', onclick: () => playTrack().catch(console.warn) },
          'Brano', kbd('T')),
        h('button', { type: 'button', class: 'btn', onclick: () => fileInput.click() }, 'Carica un file…')),
      h('div', { class: 'field' },
        h('div', { class: 'field-head' }, h('label', { for: 'src-live' }, 'Microfono o ingresso live'), kbd('M')),
        live),
      fileInput,
    ];
  }

  function buildMeters() {
    const meter = (name, label) =>
      h('div', { class: 'meter' }, h('span', {}, label), h('div', {}, h('i', { id: `m-${name}` })));
    return [
      // I meter sono solo decorativi: lo stato testuale è in #info
      h('div', { class: 'meters', 'aria-hidden': 'true' },
        meter('bass', 'bassi'), meter('mid', 'medi'), meter('high', 'alti'),
        h('div', { class: 'dots' }, h('b', { id: 'beat' }), 'battito', h('b', { id: 'surge' }), 'ondata')),
      h('p', { id: 'info', class: 'status' }),
    ];
  }

  function buildPalette() {
    return h('fieldset', { class: 'palette' },
      h('legend', { class: 'sr-only' }, 'Palette'),
      h('div', { class: 'chips' }, ...PALETTES.map((p, i) => {
        const input = h('input', { type: 'radio', name: 'palette', value: i,
          onchange: () => (palIndex = i) });
        return h('label', { class: 'chip', style: `--sw: ${swatch(p)}` }, input, h('span', {}, p.name));
      })));
  }

  // Sfumatura di anteprima della palette (stessa formula dello shader)
  function swatch(p) {
    const stops = [0, 0.33, 0.66, 1].map((t) => {
      const c = [0, 1, 2].map((i) =>
        Math.round(255 * Math.min(1, Math.max(0, p.a[i] + p.b[i] * Math.cos(6.28318 * (p.c[i] * t * p.spread + p.d[i]))))));
      return `rgb(${c.join(',')})`;
    });
    return `linear-gradient(90deg, ${stops.join(',')})`;
  }

  function buildSection(sec) {
    const id = 'h-' + sec.title.toLowerCase().replace(/\W+/g, '-');
    const content = sec.custom ? [].concat(sec.custom()) : sec.items.map((c) =>
      c.type === 'range' ? buildRange(c) : c.type === 'toggle' ? buildToggle(c) : buildAction(c));
    return h('section', { 'aria-labelledby': id, class: sec.row ? 'actions' : null },
      h('h3', { id }, sec.title, sec.title === 'Palette' ? kbd('1 – 4') : null), ...content);
  }

  function build() {
    const body = $('panel-body');
    const user = USER.map(buildSection);
    // Schermo intero: non disponibile su iPhone, lì il bottone non compare
    if (document.fullscreenEnabled || document.webkitFullscreenEnabled) {
      user.push(buildSection({ title: 'Schermo', items: [
        { type: 'action', label: 'Schermo intero', run: () => fullscreen(!fullscreen()), keys: 'F' }] }));
    }
    if (!DEV) { body.append(...user); return; }

    const dev = DEV_SECTIONS.map(buildSection);
    dev.push(h('details', { class: 'shortcuts' },
      h('summary', {}, 'Scorciatoie da tastiera'),
      h('dl', {}, ...SHORTCUTS.flatMap(([k, d]) => [h('dt', {}, h('kbd', {}, k)), h('dd', {}, d)]))));

    // Due schede (ARIA tabs): frecce ←/→ per passare dall'una all'altra
    const tabs = [['user', 'Esperienza', user], ['dev', 'Sviluppo', dev]].map(([key, label, content], i) => ({
      tab: h('button', { type: 'button', role: 'tab', id: `tab-${key}`, 'aria-controls': `tp-${key}`,
        'aria-selected': i === 0 ? 'true' : 'false', tabindex: i === 0 ? '0' : '-1' }, label),
      panel: h('div', { role: 'tabpanel', id: `tp-${key}`, 'aria-labelledby': `tab-${key}`, hidden: i !== 0 }, ...content),
    }));
    const select = (i, focus) => tabs.forEach((t, j) => {
      t.tab.setAttribute('aria-selected', i === j ? 'true' : 'false');
      t.tab.tabIndex = i === j ? 0 : -1;
      t.panel.hidden = i !== j;
      if (i === j && focus) t.tab.focus();
    });
    tabs.forEach((t, i) => {
      t.tab.addEventListener('click', () => select(i));
      t.tab.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
          e.preventDefault();
          select((i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length, true);
        }
      });
    });
    body.append(h('div', { role: 'tablist', class: 'tabs', 'aria-label': 'Sezioni dei controlli' }, ...tabs.map((t) => t.tab)),
      ...tabs.map((t) => t.panel));
  }

  // moveFocus: aprendo dal bottone il focus entra nel pannello; con il tasto H no,
  // così le scorciatoie continuano a funzionare durante uno show.
  function setOpen(open, moveFocus = true) {
    panel.hidden = !open;
    toggleBtn.setAttribute('aria-expanded', open);
    document.body.classList.toggle('panel-open', open);
    if (open) { sync(); if (moveFocus) $('panel-close').focus(); }
    else if (panel.contains(document.activeElement)) toggleBtn.focus();
  }

  function init() {
    panel = $('panel');
    toggleBtn = $('panel-toggle');
    build();
    toggleBtn.addEventListener('click', () => setOpen(true));
    $('panel-close').addEventListener('click', () => setOpen(false));
    panel.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); }
    });

    // Cursore e bottone del pannello spariscono dopo un po' di inattività (utile in proiezione)
    let idleTimer;
    const wake = () => {
      document.body.classList.remove('idle');
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => document.body.classList.add('idle'), 3000);
    };
    ['pointermove', 'pointerdown', 'keydown'].forEach((ev) => window.addEventListener(ev, wake));
    wake();

    // Trascina un file audio sulla pagina per usarlo
    const b = document.body;
    b.addEventListener('dragover', (e) => { e.preventDefault(); b.classList.add('drag'); });
    b.addEventListener('dragleave', () => b.classList.remove('drag'));
    b.addEventListener('drop', (e) => {
      e.preventDefault();
      b.classList.remove('drag');
      const f = e.dataTransfer.files[0];
      if (f && f.type.startsWith('audio')) audio.useFile(f).catch(console.warn);
    });
  }

  // Riallinea i controlli ai parametri (dopo una scorciatoia da tastiera)
  function sync() {
    for (const { c, input, out } of ranges) { input.value = params[c.key]; show(c, input, out); }
    for (const { c, input } of toggles) input.checked = params[c.key];
    document.querySelectorAll('input[name="palette"]').forEach((r) => (r.checked = +r.value === palIndex));
  }

  // Meter e stato: aggiornati solo a pannello aperto
  function update() {
    if (!panel || panel.hidden) return;
    const paused = !audio.audioEl || audio.audioEl.paused;
    $('play-label').textContent = paused ? 'Play' : 'Pausa';
    $('src-play').disabled = !audio.audioEl;
    const devPanel = $('tp-dev');
    if (!devPanel || devPanel.hidden) return;
    const R = params.react;
    const bar = (id, v) => ($(id).style.transform = `scaleX(${Math.min(1, v * R).toFixed(3)})`);
    bar('m-bass', audio.bass);
    bar('m-mid', audio.mid);
    bar('m-high', audio.high);
    $('beat').style.opacity = Math.min(1, audio.beat * R).toFixed(2);
    $('surge').style.opacity = Math.min(1, audio.surge).toFixed(2);
    $('info').textContent = `${audio.mode} · ${Math.round(frameRate())} fps`;
    $('health').textContent = healthText();
  }

  return { init, sync, update, dev: DEV, toggle: () => setOpen(panel.hidden, false), open: (focus = true) => setOpen(true, focus), close: () => setOpen(false) };
})();
