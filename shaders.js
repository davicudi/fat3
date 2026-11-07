// ─────────────────────────────────────────────────────────────
//  Shader GLSL — tutto il lavoro pesante avviene qui, sulla GPU.
// ─────────────────────────────────────────────────────────────

// Vertex shader a schermo intero: ignora le matrici di p5 e
// mappa il rect (0..1) direttamente sullo spazio clip (-1..1).
const VERT = `
precision highp float;
attribute vec3 aPosition;
attribute vec2 aTexCoord;
varying vec2 vTexCoord;
void main() {
  vTexCoord = aTexCoord;
  vec4 p = vec4(aPosition, 1.0);
  p.xy = p.xy * 2.0 - 1.0;
  gl_Position = p;
}
`;

const COMMON = `
float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * noise(p);
    p = p * 2.03 + vec2(1.7, 9.2);
    a *= 0.5;
  }
  return v;
}
mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
`;

// ── PASS 1: "sogno" ───────────────────────────────────────────
// webcam → distorsione liquida → gradient map su palette
// → miscelata con il frame precedente (feedback) per le scie.
const DREAM_FRAG = `
precision highp float;
varying vec2 vTexCoord;

uniform sampler2D uCam;
uniform sampler2D uPrev;
uniform vec2  uRes;
uniform float uCamAspect;
uniform float uTime;
uniform float uBass, uMid, uHigh, uBeat, uLevel;
uniform float uFeedback, uWarp, uColorize, uSpread;
uniform float uStep; // durata del frame in "frame a 60fps": rende il moto indipendente dagli fps
uniform float uExpo; // ondata di luce (rara): 0..~2
uniform vec3  uPalA, uPalB, uPalC, uPalD;

${COMMON}

vec3 palette(float t) {
  return uPalA + uPalB * cos(6.28318 * (uPalC * t + uPalD));
}

// Ruota il colore attorno all'asse dei grigi (hue shift economico)
vec3 hueShift(vec3 c, float a) {
  const vec3 k = vec3(0.57735);
  float ca = cos(a);
  return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca);
}

// Adatta la camera allo schermo come "object-fit: cover"
vec2 coverUV(vec2 uv) {
  float sa = uRes.x / uRes.y;
  vec2 s = vec2(1.0);
  if (sa > uCamAspect) s.y = uCamAspect / sa; else s.x = sa / uCamAspect;
  return (uv - 0.5) * s + 0.5;
}

void main() {
  vec2 uv = vTexCoord;
  float aspect = uRes.x / uRes.y;
  float t = uTime;

  // Campo di flusso (domain warping) — il "liquido" del sogno
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0) * 2.4;
  vec2 q = vec2(fbm(p + vec2(0.0, t * 0.06)),
                fbm(p + vec2(5.2, 1.3) - t * 0.05));
  vec2 flow = q - 0.5;
  float n = fbm(p + flow * 2.0 + t * 0.03);

  // Webcam distorta (specchiata, y invertita)
  vec2 wuv = uv + flow * uWarp * (0.012 + uMid * 0.06 + uBeat * 0.03);
  // "Pump": sul kick l'immagine si gonfia verso chi guarda
  wuv = (wuv - 0.5) * (1.0 - uBass * 0.045 - uBeat * 0.035) + 0.5;
  vec2 cuv = coverUV(wuv);
  cuv = vec2(1.0 - cuv.x, 1.0 - cuv.y);
  vec3 cam = texture2D(uCam, cuv).rgb;
  float luma = dot(cam, vec3(0.299, 0.587, 0.114));
  float l = smoothstep(0.04, 0.92, luma);

  // Gradient map: la luminosità sceglie il colore nella palette
  // I bassi spingono i colori lungo la palette: il kick "cambia tinta"
  float ph = l * uSpread + n * 0.35 + t * 0.025 + uBass * 0.25 + uBeat * 0.08;
  vec3 pal = palette(ph);
  vec3 col = mix(cam, pal * (0.25 + 0.95 * l), uColorize);
  // Il kick dà solo un accento minimo; l'esposizione vera arriva con l'ondata (rara)
  col *= 0.92 + uBeat * 0.08 + uExpo * 0.9;
  // Nell'ondata anche le ombre si aprono verso la palette: luce che "riempie" la stanza
  col += pal * uExpo * 0.25 * (1.0 - l);

  // Feedback: leggo il frame precedente un po' zoomato e ruotato.
  // Tutti gli incrementi sono moltiplicati per uStep → stessa velocità a 24 o 60 fps.
  vec2 c = (uv - 0.5) * vec2(aspect, 1.0);
  float zoom = 1.0 - (0.003 + uBass * 0.014 + uBeat * 0.008) * uStep;
  float ang = (0.0015 * sin(t * 0.13) + (n - 0.5) * 0.004 + uMid * 0.004) * uStep;
  c = rot(ang) * c * zoom;
  vec2 puv = c / vec2(aspect, 1.0) + 0.5 + flow * 0.003 * (1.0 + uMid * 4.0) * uStep;
  vec3 prev = texture2D(uPrev, puv).rgb;
  // Gli alti fanno ruotare il colore delle scie: arcobaleni sui piatti
  prev = max(hueShift(prev, (0.006 + uHigh * 0.06) * uStep), 0.0);

  // Le zone chiare (il soggetto) restano nitide, il buio trattiene le scie
  float fb = uFeedback * (1.0 - 0.5 * smoothstep(0.3, 0.9, l));
  fb *= 1.0 - uBeat * 0.4; // sul kick l'immagine nuova "sfonda" le scie

  gl_FragColor = vec4(mix(col, prev * pow(0.992, uStep), fb), 1.0);
}
`;

// ── PASS 2: post-produzione ───────────────────────────────────
// aberrazione cromatica, glow/foschia, polvere fatata, vignetta, grana
const POST_FRAG = `
precision highp float;
varying vec2 vTexCoord;

uniform sampler2D uTex;
uniform vec2  uRes;
uniform float uTime, uBass, uHigh, uBeat, uLevel;
uniform float uGlow, uSparkle, uExpo;

${COMMON}

float stars(vec2 uv, float scale, float t, float density, float speed) {
  vec2 p = uv * vec2(uRes.x / uRes.y, 1.0) * scale;
  p.y -= t * speed;                       // salgono lentamente
  p.x += sin(p.y * 0.35 + t * 0.5) * 0.3; // ondeggiano
  vec2 id = floor(p);
  float h = hash(id);
  if (h > density) return 0.0;
  vec2 g = fract(p) - 0.5 - (vec2(hash(id + 3.1), hash(id + 7.7)) - 0.5) * 0.6;
  float d = length(g);
  float tw = pow(0.5 + 0.5 * sin(t * (1.5 + h * 6.0) + h * 60.0), 8.0);
  float core = exp(-d * d * 250.0);
  float rays = exp(-abs(g.x) * 40.0) * exp(-abs(g.y) * 8.0)
             + exp(-abs(g.y) * 40.0) * exp(-abs(g.x) * 8.0);
  return (core * 1.5 + rays * 0.5) * tw;
}

void main() {
  vec2 uv = vTexCoord;
  vec2 d = uv - 0.5;
  float r2 = dot(d, d);

  // Aberrazione cromatica radiale (cresce con gli alti)
  float k = 0.004 + uHigh * 0.022 + uBeat * 0.012;
  vec3 col;
  col.r = texture2D(uTex, uv - d * k).r;
  col.g = texture2D(uTex, uv).g;
  col.b = texture2D(uTex, uv + d * k).b;

  // Glow: 12 campioni a spirale aurea
  vec3 blur = vec3(0.0);
  vec2 px = 1.0 / uRes;
  float rad = 16.0 + uLevel * 10.0 + uBeat * 8.0 + uExpo * 22.0;
  for (int i = 0; i < 12; i++) {
    float fi = float(i);
    float a = fi * 2.39996;
    float r = sqrt((fi + 0.5) / 12.0) * rad;
    blur += texture2D(uTex, uv + vec2(cos(a), sin(a)) * r * px).rgb;
  }
  blur /= 12.0;
  // Glow solo sulle vere luci (soglia alta) e con un tetto: la musica allarga l'alone, non lo accende
  // Durante l'ondata la soglia scende e l'alone esplode
  float thr = 0.5 - uExpo * 0.25;
  col += max(blur - thr, 0.0) * uGlow * (0.6 + uLevel * 0.4 + uBeat * 0.3 + uExpo * 2.5);
  col = mix(col, max(col, blur), 0.2 + uExpo * 0.2); // foschia onirica

  // Accento leggerissimo sul kick
  col *= 1.0 + uBeat * 0.06;

  // Polvere fatata: appare sulle zone luminose, esplode con gli alti
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  float dens = 0.03 + uHigh * 0.45 + uBeat * 0.2;
  float s = stars(uv, 26.0, uTime, dens, 0.35)
          + stars(uv + 0.37, 48.0, uTime * 1.3, dens * 0.8, 0.6) * 0.6;
  s *= smoothstep(0.2, 0.7, lum) * uSparkle * (0.5 + uHigh * 0.9 + uExpo);
  col += s * mix(vec3(1.0), normalize(col + 0.001) * 1.6, 0.35);

  // Spalla morbida: sotto il ginocchio non tocca nulla, sopra comprime verso 1.
  // Normalmente protegge dal bianco; durante l'ondata il ginocchio sale e la luce può bruciare.
  float knee = min(0.65 + uExpo * 0.3, 0.95);
  vec3 over = max(col - knee, 0.0);
  col = min(col, knee) + (1.0 - knee) * (1.0 - exp(-over / (1.0 - knee)));

  // Vignetta che respira: chiusa nel silenzio, si apre sui bassi
  float vig = smoothstep(0.08 + uBass * 0.12 + uBeat * 0.08, 0.5, r2) * (1.0 - min(uExpo, 1.0) * 0.7);
  col *= mix(1.0, 0.22, vig);

  // Grana
  col += (hash(uv * uRes + fract(uTime * 7.0) * 113.0) - 0.5) * 0.03;

  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;
