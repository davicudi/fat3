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

const params = {
  react: 1.4,     // reattività al suono (0..2.5): moltiplica bassi, medi, alti e beat
  feedback: 0.8,  // quanto restano le scie (0..0.97)
  warp: 1.0,      // liquidità della distorsione
  colorize: 0.85, // quanto la palette sostituisce i colori reali
  glow: 0.9,
  sparkle: 1.0,
  light: 1.0,     // intensità delle ondate di luce (0..2)
  surgeFreq: 0.5, // frequenza delle ondate (0 = rarissime, 1 = frequenti)
};

let cam = null, camAspect = 16 / 9;
let dreamShader, postShader;
let fbA, fbB;
let audio;
let started = false;
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

  const opts = { format: HALF_FLOAT, depth: false, density: 1, textureFiltering: LINEAR };
  fbA = createFramebuffer(opts);
  fbB = createFramebuffer(opts);

  audio = new AudioReactive();
  setupUI();
  setSurgeFreq(params.surgeFreq);
}

async function start() {
  document.getElementById('intro').classList.add('hidden');
  started = true;

  cam = createCapture(
    { video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' }, audio: false },
    () => {}
  );
  cam.hide();

  // Prima il brano (il click su "entra" sblocca l'autoplay), poi ripiego sul live
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
  const expo = audio.surge * params.light;
  dreamShader.setUniform('uExpo', expo);
  // params.feedback è "quanto resta per frame a 60fps": lo converto alla durata reale del frame
  const step = dt * 60;
  dreamShader.setUniform('uStep', step);
  dreamShader.setUniform('uFeedback', Math.pow(params.feedback, step));
  dreamShader.setUniform('uWarp', params.warp);
  dreamShader.setUniform('uColorize', params.colorize);
  dreamShader.setUniform('uSpread', pal.spread);
  dreamShader.setUniform('uPalA', pal.a);
  dreamShader.setUniform('uPalB', pal.b);
  dreamShader.setUniform('uPalC', pal.c);
  dreamShader.setUniform('uPalD', pal.d);
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
  rect(0, 0, width, height);

  [fbA, fbB] = [fbB, fbA]; // ping-pong

  if (frameCount % 3 === 0) updateHUD();
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight); // i framebuffer si ridimensionano da soli
}

// ── Controlli ────────────────────────────────────────────────
function keyPressed() {
  if (key >= '1' && key <= '4') palIndex = int(key) - 1;
  else if (key === 'f' || key === 'F') fullscreen(!fullscreen());
  else if (key === 'h' || key === 'H') toggleHUD();
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
  else if (key === ']') setSurgeFreq(params.surgeFreq + 0.1);
  else if (key === '[') setSurgeFreq(params.surgeFreq - 0.1);
  else return;
  return false;
}

function setReact(v) {
  params.react = constrain(Math.round(v * 10) / 10, 0, 2.5);
  document.getElementById('react').value = params.react;
}

// Frequenza delle ondate → soglia di salto d'energia e tempo minimo tra due ondate
function setSurgeFreq(v) {
  params.surgeFreq = constrain(Math.round(v * 10) / 10, 0, 1);
  audio.surgeThreshold = lerp(1.6, 1.1, params.surgeFreq);
  audio.surgeCooldown = lerp(12, 3, params.surgeFreq);
  document.getElementById('surge-freq').value = params.surgeFreq;
}

function toggleHUD() {
  document.body.classList.toggle('hud-off');
}

function setupUI() {
  const $ = (id) => document.getElementById(id);
  $('start').addEventListener('click', start);
  $('hud-toggle').addEventListener('click', toggleHUD);

  // Sorgenti audio
  $('src-track').addEventListener('click', () => playTrack().catch(console.warn));
  $('src-play').addEventListener('click', () => audio.togglePlay());
  $('src-file').addEventListener('click', () => $('file-input').click());
  $('file-input').addEventListener('change', (e) => {
    const f = e.target.files[0];
    if (f) audio.useFile(f).catch(console.warn);
    e.target.value = '';
  });
  $('src-live').addEventListener('focus', () => refreshInputs().catch(console.warn));
  $('src-live').addEventListener('change', (e) => { e.target.blur(); useLive(e.target.value); });
  $('react').addEventListener('input', (e) => (params.react = parseFloat(e.target.value)));
  $('react').addEventListener('change', (e) => e.target.blur());
  $('light').addEventListener('input', (e) => (params.light = parseFloat(e.target.value)));
  $('light').addEventListener('change', (e) => e.target.blur());
  $('surge-freq').addEventListener('input', (e) => setSurgeFreq(parseFloat(e.target.value)));
  $('surge-freq').addEventListener('change', (e) => e.target.blur());
  $('surge-now').addEventListener('click', () => audio.triggerSurge());

  // Dopo un click il focus resta sul bottone: lo tolgo, così spazio/tasti vanno allo sketch
  document.querySelectorAll('#hud button, #hud-toggle').forEach((b) =>
    b.addEventListener('click', () => b.blur()));

  // Cursore che sparisce dopo 2 s di mouse fermo
  let idleTimer;
  window.addEventListener('mousemove', () => {
    document.body.classList.remove('idle');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => document.body.classList.add('idle'), 2000);
  });

  // Trascina un file audio sulla pagina per usarlo al posto del microfono
  const body = document.body;
  body.addEventListener('dragover', (e) => { e.preventDefault(); body.classList.add('drag'); });
  body.addEventListener('dragleave', () => body.classList.remove('drag'));
  body.addEventListener('drop', (e) => {
    e.preventDefault();
    body.classList.remove('drag');
    const f = e.dataTransfer.files[0];
    if (f && f.type.startsWith('audio')) audio.useFile(f).catch(console.warn);
  });
}

function updateHUD() {
  // I meter mostrano ciò che arriva agli shader (già scalato dalla reattività)
  const R = params.react;
  const set = (id, v) =>
    (document.getElementById(id).style.transform = `scaleX(${Math.min(1, v * R).toFixed(3)})`);
  set('m-bass', audio.bass);
  set('m-mid', audio.mid);
  set('m-high', audio.high);
  document.getElementById('beat').style.opacity = Math.min(1, audio.beat * R).toFixed(2);
  document.getElementById('surge').style.opacity = Math.min(1, audio.surge).toFixed(2);
  document.getElementById('info').textContent =
    `${PALETTES[palIndex].name} · reattività ${R.toFixed(1)} · scie ${params.feedback.toFixed(2)} · liquido ${params.warp.toFixed(1)} · ${audio.mode} · ${Math.round(frameRate())} fps`;
}
