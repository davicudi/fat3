// ─────────────────────────────────────────────────────────────
//  Rumore Sud — #1  ·  webcam + suono → mondi onirici
//  p5.js gestisce camera, canvas e input; gli effetti sono shader.
// ─────────────────────────────────────────────────────────────

// Palette coseno (Inigo Quilez): colore = a + b·cos(2π(c·t + d))
const PALETTES = [
  { name: 'Acido',   spread: 0.7, a: [0.5, 0.5, 0.5],    b: [0.55, 0.55, 0.55], c: [1, 1, 1], d: [0.30, 0.80, 0.55] },
  { name: 'Fatato',  spread: 0.8, a: [0.82, 0.74, 0.86], b: [0.18, 0.2, 0.16],  c: [1, 1, 1], d: [0.0, 0.33, 0.67] },
  { name: 'Onirico', spread: 0.6, a: [0.42, 0.32, 0.58], b: [0.42, 0.32, 0.38], c: [1, 1, 1], d: [0.475, 0.555, 0.375] },
  { name: 'Aurora',  spread: 0.9, a: [0.25, 0.5, 0.5],   b: [0.3, 0.45, 0.4],   c: [1, 1, 1], d: [0.55, 0.0, 0.15] },
];

// Brano di default: mettilo nella cartella audio/ con questo nome
// (o cambia il percorso). Se non c'è, si parte dal microfono.
const TRACK = 'audio/track.mp3';

// Frame rate fisso: 15 dà l'effetto "rallentato" onirico ed è un divisore esatto
// di 60 e 120 Hz, quindi la cadenza è regolare. Altri valori regolari: 20, 30, 60.
// (Valori come 24 su uno schermo a 60 Hz vengono arrotondati a 20 o 15, con scatti.)
const TARGET_FPS = 15;

// Fiori generativi: uno nuovo ogni FLOWER_INTERVAL secondi (+ uno a ogni ondata di luce)
const FLOWER_INTERVAL = 5;
const MAX_FLOWERS = 4; // deve coincidere con la dimensione degli array nello shader

// Folletti: lucine alate che vagano per lo schermo lasciando una scia
const FAIRY_INTERVAL = 7;
const MAX_FAIRIES = 3; // deve coincidere con la dimensione degli array nello shader

const params = {
  react: 1.0,     // reattività al suono (0..2.5): moltiplica bassi, medi, alti e beat
  feedback: 0.8,  // quanto restano le scie (0..0.97)
  warp: 1.0,      // liquidità della distorsione
  colorize: 0.85, // quanto la palette sostituisce i colori reali
  glow: 0.9,
  sparkle: 1.0,
  light: 0.8,     // intensità delle ondate di luce (0..2)
  surgeFreq: 0.5, // frequenza delle ondate (0 = rarissime, 1 = frequenti)
  flowers: true,  // fiori on/off
  fairies: true,  // folletti on/off
  motion: 1.0,    // sensibilità al movimento davanti alla camera (0 = spento, 2 = massima)
  motionView: false, // mostra il movimento rilevato (per tarare la sensibilità)
};

const DEFAULT_PARAMS = { ...params };

function resetParams() {
  Object.assign(params, DEFAULT_PARAMS);
  setSurgeFreq(params.surgeFreq);
}

// Movimento: buffer piccolo (basta per sapere dove ci si muove) e griglia di analisi
const MOTION_W = 96, MOTION_H = 54;
const GRID_X = 12, GRID_Y = 7;
const MOTION_FLOWER_GAP = 2.5; // secondi minimi tra due fiori nati dal movimento
const motion = { activity: 0, gain: 1, spots: [] };
let lastMotionFlower = -999;

let fairies = [];
let nextFairy = 4;      // il primo folletto arriva dopo 4 s
let lastSurgeFairy = -999;

let flowers = [];
let nextFlower = 2;     // il primo fiore sboccia dopo 2 s
let lastSurgeSeen = -999;

let cam = null, camAspect = 16 / 9;
let dreamShader, postShader, motionShader;
let fbA, fbB, fbMotionA, fbMotionB;
let audio;
let booted = false;   // setup() gira di nuovo quando la grafica viene ricostruita
let started = false;
let startTime = 0;
const FADE_IN = 4; // secondi di dissolvenza dal nero all'avvio
let t = 0;
let palIndex = 1; // 0 Acido · 1 Fatato · 2 Onirico · 3 Aurora
const pal = JSON.parse(JSON.stringify(PALETTES[palIndex])); // palette corrente (interpolata)

function setup() {
  createCanvas(windowWidth, windowHeight, WEBGL);
  pixelDensity(1); // su Retina dimezza il carico, la grana e il glow nascondono la differenza
  frameRate(TARGET_FPS);
  noStroke();

  dreamShader = createShader(VERT, DREAM_FRAG);
  postShader = createShader(VERT, POST_FRAG);
  motionShader = createShader(VERT, MOTION_FRAG);

  const opts = { format: HALF_FLOAT, depth: false, density: 1, textureFiltering: LINEAR };
  fbA = createFramebuffer(opts);
  fbB = createFramebuffer(opts);
  const mopts = { width: MOTION_W, height: MOTION_H, density: 1, depth: false, textureFiltering: LINEAR };
  fbMotionA = createFramebuffer(mopts);
  fbMotionB = createFramebuffer(mopts);

  // Se la GPU si resetta, ricostruisco la grafica invece di lasciare la pagina morta
  drawingContext.canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    health.contextLost++;
    console.warn('Contesto WebGL perso: ricostruisco la grafica');
    setTimeout(rebuildGraphics, 300);
  });

  if (booted) {               // ricostruzione: riparto da dove eravamo
    if (started) startCamera();
    return;
  }
  booted = true;

  audio = new AudioReactive();
  setSurgeFreq(params.surgeFreq);
  const saved = loadState();
  UI.init();
  document.getElementById('start').addEventListener('click', () => start());
  setInterval(watchdog, 2000);
  setInterval(saveState, 5000);
  window.addEventListener('pagehide', () => saveState({ clean: true }));
  window.addEventListener('error', () => health.errors++);
  // In background il browser sospende il disegno: al ritorno non è un blocco
  document.addEventListener('visibilitychange', () => (health.lastDraw = performance.now()));

  // Webcam e microfono funzionano solo in un contesto sicuro (HTTPS o localhost)
  if (!window.isSecureContext || !navigator.mediaDevices) document.getElementById('intro-warn').hidden = false;

  // Il browser ha ricaricato la pagina durante lo show (crash): riparto da solo
  if (saved && saved.running && !saved.clean && saved.recoveries < 3) recover(saved);
}

async function start() {
  enterShow();
  // Prima il brano (il click su "entra" sblocca l'autoplay), poi ripiego sul live
  await startAudio('track');
}

function enterShow() {
  const intro = document.getElementById('intro');
  intro.classList.add('hidden');
  intro.inert = true;
  setTimeout(() => (intro.hidden = true), 800); // dopo la dissolvenza
  document.body.classList.add('started');
  started = true;
  startTime = t;
  health.since = health.since || Date.now();
  // Su desktop il pannello parte aperto (senza rubare il focus alle scorciatoie)
  if (matchMedia('(min-width: 641px) and (hover: hover)').matches) UI.open(false);
  startCamera();
  saveState();
}

function startCamera() {
  cam = createCapture(
    { video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' }, audio: false },
    () => {}
  );
  cam.hide();
}

function stopCamera() {
  if (!cam) return;
  cam.elt.srcObject?.getTracks().forEach((tr) => tr.stop());
  cam = null;
}

async function startAudio(kind) {
  if (kind === 'live') return useLive();
  try { await playTrack(); }
  catch (e) {
    console.warn(`Brano ${TRACK} non trovato, passo all'ingresso live.`, e);
    await useLive();
  }
}

function playTrack() {
  return audio.useUrl(TRACK, TRACK.split('/').pop());
}

async function useLive(deviceId = document.getElementById('src-live').value) {
  try {
    await audio.useMic(deviceId);
    await refreshInputs(); // dopo il permesso i nomi dei dispositivi sono visibili
  } catch (e) {
    console.warn('Ingresso live non disponibile:', e);
  }
}

async function refreshInputs() {
  const sel = document.getElementById('src-live');
  const inputs = await audio.listInputs();
  const current = audio.micDeviceId || '';
  sel.innerHTML = '<option value="">ingresso live (predefinito)</option>' +
    inputs.filter((d) => d.deviceId && d.deviceId !== 'default')
      .map((d, i) => `<option value="${d.deviceId}">${d.label || 'ingresso ' + (i + 1)}</option>`)
      .join('');
  sel.value = current;
}

function draw() {
  health.lastDraw = performance.now();
  const dt = Math.min(deltaTime / 1000, 0.1);
  t += dt;
  audio.update(dt);

  if (!started || !cam) { background(0); return; }
  const v = cam.elt;
  if (v.videoWidth > 0) camAspect = v.videoWidth / v.videoHeight;

  // Transizione morbida tra palette
  const target = PALETTES[palIndex];
  const k = 1 - Math.exp(-dt * 1.5);
  for (const key of ['a', 'b', 'c', 'd'])
    for (let i = 0; i < 3; i++) pal[key][i] += (target[key][i] - pal[key][i]) * k;
  pal.spread += (target.spread - pal.spread) * k;

  // Valori audio scalati dalla reattività, con saturazione morbida:
  // i valori medi crescono quasi lineari, i picchi (drop) vengono compressi.
  const R = params.react;
  const soft = (x) => (x * R) / (1 + 0.6 * x * R) * 1.6;
  const A = {
    bass: soft(audio.bass), mid: soft(audio.mid), high: soft(audio.high),
    beat: soft(audio.beat), level: soft(audio.level),
  };
  // Ingresso morbido: immagine dal nero e reattività che sale nei primi secondi
  const fade = smoothstep01((t - startTime) / FADE_IN);
  for (const k in A) A[k] *= fade;

  const step = dt * 60; // durata del frame in "frame a 60fps"

  // PASS 0 → movimento, su un buffer piccolo
  fbMotionB.begin();
  shader(motionShader);
  motionShader.setUniform('uCam', cam);
  motionShader.setUniform('uPrevMotion', fbMotionA);
  motionShader.setUniform('uRes', [width, height]);
  motionShader.setUniform('uCamAspect', camAspect);
  motionShader.setUniform('uTexel', [1 / MOTION_W, 1 / MOTION_H]);
  motionShader.setUniform('uSens', params.motion);
  motionShader.setUniform('uDecay', Math.pow(0.97, step)); // la traccia svanisce in ~1/3 s
  rect(0, 0, width, height);
  fbMotionB.end();
  [fbMotionA, fbMotionB] = [fbMotionB, fbMotionA];
  if (frameCount % 2 === 0) analyzeMotion();
  const motionAmt = motion.gain * fade;

  // PASS 1 → fbB (legge fbA come frame precedente)
  fbB.begin();
  shader(dreamShader);
  dreamShader.setUniform('uCam', cam);
  dreamShader.setUniform('uPrev', fbA);
  dreamShader.setUniform('uRes', [width, height]);
  dreamShader.setUniform('uCamAspect', camAspect);
  dreamShader.setUniform('uTime', t);
  dreamShader.setUniform('uBass', A.bass);
  dreamShader.setUniform('uMid', A.mid);
  dreamShader.setUniform('uHigh', A.high);
  dreamShader.setUniform('uBeat', A.beat);
  dreamShader.setUniform('uLevel', A.level);
  const expo = audio.surge * params.light * fade;
  dreamShader.setUniform('uExpo', expo);
  // params.feedback è "quanto resta per frame a 60fps": lo converto alla durata reale del frame
  dreamShader.setUniform('uStep', step);
  dreamShader.setUniform('uMotion', fbMotionA);
  dreamShader.setUniform('uMotionAmt', motionAmt);
  dreamShader.setUniform('uFeedback', Math.pow(params.feedback, step));
  dreamShader.setUniform('uWarp', params.warp);
  dreamShader.setUniform('uColorize', params.colorize);
  dreamShader.setUniform('uSpread', pal.spread);
  dreamShader.setUniform('uPalA', pal.a);
  dreamShader.setUniform('uPalB', pal.b);
  dreamShader.setUniform('uPalC', pal.c);
  dreamShader.setUniform('uPalD', pal.d);
  updateFlowers();
  motionFlowers();
  const [FA, FB] = packFlowers();
  dreamShader.setUniform('uFlowerA', FA);
  dreamShader.setUniform('uFlowerB', FB);
  updateFairies(dt, A);
  const [GA, GB] = packFairies();
  dreamShader.setUniform('uFairyA', GA);
  dreamShader.setUniform('uFairyB', GB);
  rect(0, 0, width, height);
  fbB.end();

  // PASS 2 → schermo
  shader(postShader);
  postShader.setUniform('uTex', fbB);
  postShader.setUniform('uRes', [width, height]);
  postShader.setUniform('uTime', t);
  postShader.setUniform('uBass', A.bass);
  postShader.setUniform('uHigh', A.high);
  postShader.setUniform('uBeat', A.beat);
  postShader.setUniform('uLevel', A.level);
  postShader.setUniform('uGlow', params.glow);
  postShader.setUniform('uSparkle', params.sparkle);
  postShader.setUniform('uExpo', expo);
  postShader.setUniform('uFade', fade);
  postShader.setUniform('uMotion', fbMotionA);
  postShader.setUniform('uMotionAmt', motionAmt);
  postShader.setUniform('uMotionView', params.motionView ? 1 : 0);
  rect(0, 0, width, height);

  [fbA, fbB] = [fbB, fbA]; // ping-pong

  if (frameCount % 3 === 0) UI.update();
}

const smoothstep01 = (x) => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };

// ── Fiori ────────────────────────────────────────────────────
function spawnFlower(at) {
  // Provo qualche posizione e tengo la più lontana dai fiori ancora vivi
  let best = at ? { x: at.x + random(-0.03, 0.03), y: at.y + random(-0.03, 0.03) } : null, bestDist = -1;
  for (let i = 0; i < (at ? 0 : 6); i++) {
    const c = { x: random(0.15, 0.85), y: random(0.18, 0.82) };
    const dmin = flowers.reduce((m, f) => Math.min(m, Math.hypot(f.x - c.x, f.y - c.y)), 9);
    if (dmin > bestDist) { best = c; bestDist = dmin; }
  }
  flowers.push({
    ...best,
    size: random(0.13, 0.24),          // raggio, in frazione dell'altezza
    born: t,
    life: random(5.5, 7.5),            // durata totale (sboccia, resta, si scioglie)
    petals: random([5, 6, 7, 8, 9, 11]),
    rot: random(TWO_PI),
    seed: random(),                    // punto di partenza nella palette
  });
  if (flowers.length > MAX_FLOWERS) flowers.shift();
}

function updateFlowers() {
  flowers = flowers.filter((f) => t - f.born < f.life);
  if (!params.flowers) return;
  if (t >= nextFlower) {
    spawnFlower();
    nextFlower = t + FLOWER_INTERVAL;
  }
  // Un fiore in più a ogni ondata di luce
  if (audio.lastSurge !== lastSurgeSeen) {
    lastSurgeSeen = audio.lastSurge;
    if (audio.lastSurge > 0) spawnFlower();
  }
}

// Due array piatti vec4[4]: (x, y, raggio, età) e (petali, rotazione, seme, durata).
// Età -1 = slot vuoto. La y è invertita perché nello shader l'origine è in basso.
function packFlowers() {
  const A = [], B = [];
  for (let i = 0; i < MAX_FLOWERS; i++) {
    const f = flowers[i];
    if (f) {
      A.push(f.x, 1 - f.y, f.size, t - f.born);
      B.push(f.petals, f.rot, f.seed, f.life);
    } else {
      A.push(0, 0, 0, -1);
      B.push(0, 0, 0, 1);
    }
  }
  return [A, B];
}

// ── Folletti ─────────────────────────────────────────────────
function spawnFairy() {
  const f = {
    seed: random(1000),
    color: random(),
    size: random(0.045, 0.07),  // apertura alare, in frazione dell'altezza
    born: t,
    life: random(10, 16),
    path: 0,                    // avanzamento lungo la traiettoria (accelera con la musica)
    flap: random(TWO_PI),       // fase del battito d'ali
    tilt: 0,
    vx: 0, vy: 0,
    lure: 0,                    // 0 = vaga per conto suo, 1 = attratto da chi si muove
    sx: 0.5, sy: 0.5,           // ultimo punto di movimento che lo ha attirato
  };
  Object.assign(f, fairyPos(f));
  fairies.push(f);
  if (fairies.length > MAX_FAIRIES) fairies.shift();
}

// Traiettoria vagante: rumore di Perlin su x e y, più un leggero dondolio
function fairyPos(f) {
  return {
    x: 0.5 + (noise(f.seed, f.path * 0.18) - 0.5) * 1.6,
    y: 0.5 + (noise(f.seed + 50, f.path * 0.18) - 0.5) * 1.4 + Math.sin(f.path * 2.1 + f.seed) * 0.012,
  };
}

// Il punto di movimento più vicino al folletto (se abbastanza forte e non troppo lontano)
function nearestSpot(f) {
  let best = null, bd = 0.6;
  for (const sp of motion.spots) {
    const d = Math.hypot(sp.x - f.x, sp.y - f.y);
    if (sp.w > 0.25 && d < bd) { best = sp; bd = d; }
  }
  return best;
}

function updateFairies(dt, A) {
  fairies = fairies.filter((f) => t - f.born < f.life);
  const aspect = width / height;
  for (const f of fairies) {
    f.path += dt * (1 + A.mid * 1.2 + A.beat * 0.8);      // la musica li fa sfrecciare
    f.flap += dt * (16 + A.bass * 14 + A.high * 10);      // e battere le ali più forte

    // Bersaglio: la traiettoria vagante, oppure un'orbita attorno a chi si muove
    const spot = nearestSpot(f);
    if (spot) { f.sx = spot.x; f.sy = spot.y; }
    f.lure += ((spot ? 1 : 0) - f.lure) * (1 - Math.exp(-dt * (spot ? 2 : 0.6)));
    const wander = fairyPos(f);
    const orbit = f.path * 2.4 + f.seed;
    const tx = lerp(wander.x, f.sx + Math.cos(orbit) * 0.08 / aspect, f.lure);
    const ty = lerp(wander.y, f.sy + Math.sin(orbit) * 0.08, f.lure);

    // Molla smorzata verso il bersaglio: volo fluido, con un piccolo rimbalzo
    f.vx += ((tx - f.x) * 9 - f.vx * 4.5) * dt;
    f.vy += ((ty - f.y) * 9 - f.vy * 4.5) * dt;
    f.x += f.vx * dt;
    f.y += f.vy * dt;

    // Si inclinano nella direzione in cui volano
    const targetTilt = constrain(f.vx * 2.5, -0.6, 0.6);
    f.tilt += (targetTilt - f.tilt) * (1 - Math.exp(-dt * 4));
  }
  if (!params.fairies) return;
  // Se qualcuno si muove e ci sono pochi folletti, ne arriva uno prima del previsto
  const called = motion.spots[0]?.w > 0.4 && fairies.length < 2 && t >= nextFairy - FAIRY_INTERVAL / 2;
  if (t >= nextFairy || called) {
    spawnFairy();
    nextFairy = t + FAIRY_INTERVAL;
  }
  if (audio.lastSurge !== lastSurgeFairy) {
    lastSurgeFairy = audio.lastSurge;
    if (audio.lastSurge > 0 && random() < 0.6) spawnFairy();
  }
}

// ── Movimento ────────────────────────────────────────────────
// Legge il buffer di movimento (96×54, costa poco) e trova le zone dove ci si muove.
// Nel buffer la riga 0 è il basso dello schermo: y = 1 - riga/altezza.
function analyzeMotion() {
  fbMotionA.loadPixels();
  const px = fbMotionA.pixels;
  const sum = new Float32Array(GRID_X * GRID_Y), cnt = new Uint16Array(GRID_X * GRID_Y);
  let total = 0;
  for (let y = 0; y < MOTION_H; y++) {
    const gy = Math.floor((y * GRID_Y) / MOTION_H);
    for (let x = 0; x < MOTION_W; x++) {
      const v = px[(y * MOTION_W + x) * 4] / 255;
      const c = gy * GRID_X + Math.floor((x * GRID_X) / MOTION_W);
      sum[c] += v; cnt[c]++; total += v;
    }
  }
  motion.activity = total / (MOTION_W * MOTION_H);
  // Se si muove quasi tutto lo schermo è la camera (esposizione automatica, scossone): attenuo
  motion.gain = motion.activity > 0.35 ? 0.35 / motion.activity : 1;
  const spots = [];
  for (let c = 0; c < sum.length; c++) {
    const w = (sum[c] / cnt[c]) * motion.gain;
    if (w > 0.15) {
      const gx = c % GRID_X, gy = Math.floor(c / GRID_X);
      spots.push({ x: (gx + 0.5) / GRID_X, y: 1 - (gy + 0.5) / GRID_Y, w });
    }
  }
  motion.spots = spots.sort((a, b) => b.w - a.w).slice(0, 4);
}

// Dove qualcuno si muove sboccia un fiore (non troppo spesso, non sopra un altro)
function motionFlowers() {
  if (!params.flowers || t - lastMotionFlower < MOTION_FLOWER_GAP) return;
  const sp = motion.spots[0];
  if (sp && sp.w > 0.35 && flowers.every((f) => Math.hypot(f.x - sp.x, f.y - sp.y) > 0.2)) {
    spawnFlower(sp);
    lastMotionFlower = t;
  }
}

// Due array vec4[3]: (x, y, scala, età) e (fase ali, inclinazione, colore, durata). Età -1 = vuoto.
function packFairies() {
  const A = [], B = [];
  for (let i = 0; i < MAX_FAIRIES; i++) {
    const f = fairies[i];
    if (f) {
      A.push(f.x, 1 - f.y, f.size, t - f.born);
      B.push(f.flap, f.tilt, f.color, f.life);
    } else {
      A.push(0, 0, 0, -1);
      B.push(0, 0, 0, 1);
    }
  }
  return [A, B];
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight); // i framebuffer si ridimensionano da soli
}

// ── Scorciatoie da tastiera ──────────────────────────────────
// Tutto è anche nel pannello (ui.js); qui restano i tasti rapidi per lo show.
function keyPressed() {
  // Mentre si usa un controllo del pannello i tasti servono a lui (frecce sugli slider, spazio sui bottoni)
  const el = document.activeElement;
  if (el && el.matches('input, select, textarea')) return;
  if (el && el.matches('button, summary') && (key === ' ' || keyCode === ENTER)) return;
  // Le regolazioni fini da tastiera sono riservate alla modalità sviluppo (?dev)
  const devKey = '[]sSvV'.includes(key) || [UP_ARROW, DOWN_ARROW, LEFT_ARROW, RIGHT_ARROW].includes(keyCode);
  if (devKey && !UI.dev) return;

  if (key >= '1' && key <= '4') palIndex = int(key) - 1;
  else if (key === 'f' || key === 'F') fullscreen(!fullscreen());
  else if (key === 'h' || key === 'H') UI.toggle();
  else if (keyCode === ESCAPE) UI.close();
  else if (key === 's' || key === 'S') params.sparkle = params.sparkle > 0 ? 0 : 1;
  else if (key === 'm' || key === 'M') useLive();
  else if (key === 't' || key === 'T') playTrack().catch(console.warn);
  else if (key === ' ') audio.togglePlay();
  else if (keyCode === UP_ARROW) params.feedback = constrain(params.feedback + 0.02, 0, 0.97);
  else if (keyCode === DOWN_ARROW) params.feedback = constrain(params.feedback - 0.02, 0, 0.97);
  else if (keyCode === RIGHT_ARROW) params.warp = constrain(params.warp + 0.2, 0, 4);
  else if (keyCode === LEFT_ARROW) params.warp = constrain(params.warp - 0.2, 0, 4);
  else if (key === '+' || key === '=') setReact(params.react + 0.1);
  else if (key === '-' || key === '_') setReact(params.react - 0.1);
  else if (key === 'e' || key === 'E') audio.triggerSurge();
  else if (key === 'b' || key === 'B') params.flowers = !params.flowers;
  else if (key === 'n' || key === 'N') spawnFlower();
  else if (key === 'l' || key === 'L') params.fairies = !params.fairies;
  else if (key === 'k' || key === 'K') spawnFairy();
  else if (key === 'v' || key === 'V') params.motionView = !params.motionView;
  else if (key === ']') setSurgeFreq(params.surgeFreq + 0.1);
  else if (key === '[') setSurgeFreq(params.surgeFreq - 0.1);
  else return;
  UI.sync();
  return false;
}

function setReact(v) {
  params.react = constrain(Math.round(v * 10) / 10, 0, 2.5);
}

// Frequenza delle ondate → soglia di salto d'energia e tempo minimo tra due ondate
function setSurgeFreq(v) {
  params.surgeFreq = constrain(Math.round(v * 10) / 10, 0, 1);
  audio.surgeThreshold = lerp(1.6, 1.1, params.surgeFreq);
  audio.surgeCooldown = lerp(12, 3, params.surgeFreq);
}

// ── Stabilità ────────────────────────────────────────────────
const health = { since: 0, lastDraw: 0, contextLost: 0, rebuilds: 0, errors: 0 };
const STATE_KEY = 'rumore-sud-state';

// Ricrea da zero canvas, shader e framebuffer (la musica non si ferma)
function rebuildGraphics() {
  try {
    stopCamera();
    remove();     // p5 libera canvas ed elementi
    new p5();     // riesegue setup(): booted = true, quindi ricrea solo la grafica
    health.rebuilds++;
  } catch (e) {
    console.error('Ricostruzione fallita, ricarico la pagina', e);
    saveState();
    location.reload();
  }
}

// Se il disegno si ferma (errore nel loop, GPU bloccata) per più di 5 s, ricostruisco
function watchdog() {
  if (!started || document.hidden || !health.lastDraw) return;
  if (performance.now() - health.lastDraw > 5000) {
    console.warn('Il disegno è fermo da 5 s: ricostruisco la grafica');
    health.lastDraw = performance.now();
    rebuildGraphics();
  }
}

// Stato della sessione (sessionStorage: vale solo per questa scheda).
// clean = la pagina è stata chiusa o ricaricata da chi la usa; se manca, è stato un crash.
function saveState(extra = {}) {
  if (!booted) return;
  try {
    sessionStorage.setItem(STATE_KEY, JSON.stringify({
      params, palIndex, running: started, clean: false, since: health.since, saved: Date.now(),
      source: audio.kind === 'live' ? 'live' : 'track', recoveries: health.recoveries || 0, ...extra,
    }));
  } catch (e) { /* storage non disponibile: pazienza */ }
}

function loadState() {
  let s = null;
  try { s = JSON.parse(sessionStorage.getItem(STATE_KEY)); } catch (e) { return null; }
  if (!s) return null;
  Object.assign(params, s.params);
  if (s.palIndex >= 0 && s.palIndex < PALETTES.length) palIndex = s.palIndex;
  setSurgeFreq(params.surgeFreq);
  return s;
}

// Ripresa dopo un ricaricamento non voluto: visual subito, audio al primo tocco
// (il browser non permette di far partire il suono senza un gesto di chi usa la pagina)
function recover(saved) {
  health.recoveries = (saved.recoveries || 0) + 1;
  health.since = saved.since || Date.now();
  enterShow();
  const mins = Math.round((saved.saved - saved.since) / 60000);
  console.warn(`Pagina ricaricata dal browser dopo ${mins} min di show: riprendo.`);
  const box = document.getElementById('resume');
  document.getElementById('resume-msg').textContent =
    `Il browser ha ricaricato la pagina dopo ${mins} min. Impostazioni ripristinate.`;
  box.hidden = false;
  document.getElementById('resume-audio').addEventListener('click', () => {
    box.hidden = true;
    startAudio(saved.source);
  }, { once: true });
}

// Riga di stato per il pannello
function healthText() {
  const up = health.since ? Math.floor((Date.now() - health.since) / 60000) : 0;
  const parts = [`attivo da ${up >= 60 ? Math.floor(up / 60) + ' h ' : ''}${up % 60} min`];
  if (performance.memory) parts.push(`memoria ${Math.round(performance.memory.usedJSHeapSize / 1048576)} MB`);
  if (health.rebuilds) parts.push(`grafica ricostruita ${health.rebuilds}×`);
  if (health.recoveries) parts.push(`ripreso dopo crash ${health.recoveries}×`);
  return parts.join(' · ');
}
