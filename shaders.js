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

// Adatta la camera allo schermo come "object-fit: cover" (usa uRes e uCamAspect)
const COVER = `
vec2 coverUV(vec2 uv) {
  float sa = uRes.x / uRes.y;
  vec2 s = vec2(1.0);
  if (sa > uCamAspect) s.y = uCamAspect / sa; else s.x = sa / uCamAspect;
  return (uv - 0.5) * s + 0.5;
}
// Coordinate schermo → texture della camera (specchiata, y invertita)
vec2 camUV(vec2 uv) {
  vec2 c = coverUV(uv);
  return vec2(1.0 - c.x, 1.0 - c.y);
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
uniform sampler2D uMotion;  // r = movimento davanti alla camera (dal passo MOTION)
uniform float uMotionAmt;   // intensità degli effetti del movimento
uniform vec2  uRes;
uniform float uCamAspect;
uniform float uTime;
uniform float uBass, uMid, uHigh, uBeat, uLevel;
uniform float uFeedback, uWarp, uColorize, uSpread;
uniform float uStep; // durata del frame in "frame a 60fps": rende il moto indipendente dagli fps
uniform float uExpo; // ondata di luce (rara): 0..~2
uniform vec3  uPalA, uPalB, uPalC, uPalD;

${COMMON}
${COVER}

vec3 palette(float t) {
  return uPalA + uPalB * cos(6.28318 * (uPalC * t + uPalD));
}

// Ruota il colore attorno all'asse dei grigi (hue shift economico)
vec3 hueShift(vec3 c, float a) {
  const vec3 k = vec3(0.57735);
  float ca = cos(a);
  return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca);
}

// ── Fiori generativi ─────────────────────────────────────────
// F = (x, y, raggio, età)   G = (petali, rotazione, seme colore, durata)
// Ritorna (colore, copertura). Stile illustrato: due corone di petali,
// cuore, venature e un contorno luminoso.
uniform vec4 uFlowerA[4];
uniform vec4 uFlowerB[4];

vec4 flower(vec2 uv, vec4 F, vec4 G, float aspect) {
  float age = F.w;
  if (age < 0.0 || age > G.w) return vec4(0.0);
  vec2 d = (uv - F.xy) * vec2(aspect, 1.0);
  float r = length(d);
  float size = F.z * (1.0 + uBass * 0.08);
  if (r > size * 1.3) return vec4(0.0); // fuori dal fiore: esco subito (performance)

  float open = smoothstep(0.0, 1.8, age);               // sboccia
  float fade = 1.0 - smoothstep(G.w - 2.5, G.w, age);   // si scioglie nelle scie
  float R = size * (0.3 + 0.7 * open);

  float k = G.x;
  float spin = (fract(G.z * 7.13) - 0.5) * 0.25;         // verso e velocità di rotazione
  float a = atan(d.y, d.x) + G.y + age * spin;
  float wob = (noise(vec2(a * 2.5 + G.z * 20.0, age * 0.4)) - 0.5) * 0.14; // bordo organico

  // Corona esterna (k petali) e interna sfasata di mezzo petalo
  float pe = pow(abs(cos(a * k * 0.5)), 0.7);
  float Ro = R * (0.42 + 0.58 * pe + wob);
  float pi2 = pow(abs(cos(a * k * 0.5 + 1.5708)), 0.9);
  float Ri = R * (0.22 + 0.33 * pi2 * open + wob * 0.5);
  float Rc = R * 0.13;

  float aa = R * 0.04 + 0.002; // morbidezza del bordo
  float mo = smoothstep(Ro, Ro - aa, r);
  float mi = smoothstep(Ri, Ri - aa, r);
  float mc = smoothstep(Rc, Rc - aa, r);

  float rn = r / max(Ro, 1e-3);
  vec3 cOut = palette(G.z + 0.15 + rn * 0.25);
  vec3 cIn  = palette(G.z + 0.45 + rn * 0.2);
  vec3 cC   = palette(G.z + 0.75);

  float vein = 0.82 + 0.18 * cos(a * k * 4.0);           // venature radiali
  vec3 c = cOut * vein * (0.55 + 0.45 * rn);
  c = mix(c, cIn * (0.7 + 0.3 * vein), mi);
  c = mix(c, cC * 1.2, mc);
  float rim = smoothstep(aa * 2.5, 0.0, abs(r - Ro)) * 0.7; // contorno luminoso
  c += rim * cOut * 0.6;

  float m = max(mo, rim) * fade * (0.35 + 0.65 * open);
  return vec4(c, m);
}

// ── Folletti ─────────────────────────────────────────────────
// F = (x, y, scala, età)   G = (fase battito ali, inclinazione, seme colore, durata)
// Restituisce la luce da aggiungere; in mask la copertura (per le scie).
uniform vec4 uFairyA[3];
uniform vec4 uFairyB[3];

float wing(vec2 p, vec2 c, vec2 r, float ang, out float rim) {
  float e = length((rot(ang) * (p - c)) / r);
  rim = smoothstep(0.22, 0.0, abs(e - 0.92));
  return smoothstep(1.0, 0.75, e);
}

vec3 fairy(vec2 uv, vec4 F, vec4 G, float aspect, out float mask) {
  mask = 0.0;
  float age = F.w;
  if (age < 0.0 || age > G.w) return vec3(0.0);
  vec2 d = (uv - F.xy) * vec2(aspect, 1.0);
  float s = F.z;
  if (dot(d, d) > s * s * 2.0) return vec3(0.0); // fuori: esco subito

  float fade = smoothstep(0.0, 1.2, age) * (1.0 - smoothstep(G.w - 1.8, G.w, age));
  vec2 p = rot(-G.y) * d / s;                   // sistema locale: corpo dritto
  float flap = 0.3 + 0.7 * abs(sin(G.x));       // le ali si chiudono in prospettiva
  vec2 w = vec2(abs(p.x) / flap, p.y);          // simmetria sinistra/destra

  float rU, rL;
  float mU = wing(w, vec2(0.48, 0.30), vec2(0.48, 0.26), -0.55, rU); // ali superiori
  float mL = wing(w, vec2(0.34, -0.20), vec2(0.32, 0.17), 0.5, rL);  // ali inferiori
  float mw = max(mU, mL);
  float rim = max(rU, rL);

  vec3 cw = palette(G.z + length(w) * 0.35 + p.y * 0.2);
  float vein = 0.8 + 0.2 * cos(atan(w.y, w.x) * 9.0); // venature
  float body = exp(-dot(p / vec2(0.06, 0.2), p / vec2(0.06, 0.2)));
  float core = exp(-dot(p, p) * 70.0);
  float halo = exp(-dot(p, p) * 5.0);

  vec3 c = cw * mw * vein * 0.55            // ali velate
         + cw * rim * 0.9                   // contorno luminoso
         + vec3(1.0, 0.96, 0.85) * (core * 1.8 + body * 0.6)
         + palette(G.z + 0.5) * halo * 0.35;
  mask = max(max(mw * 0.6, rim), max(core, body)) * fade;
  return c * fade;
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
  float mo = texture2D(uMotion, uv).r * uMotionAmt;

  // Webcam distorta (specchiata, y invertita)
  // Dove ci si muove il liquido si piega di più
  vec2 wuv = uv + flow * uWarp * (0.012 + uMid * 0.06 + uBeat * 0.03 + mo * 0.05);
  // "Pump": sul kick l'immagine si gonfia verso chi guarda
  wuv = (wuv - 0.5) * (1.0 - uBass * 0.045 - uBeat * 0.035) + 0.5;
  vec2 cuv = camUV(wuv);
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
  // Movimento: un'aura di luce nei colori della palette segue chi si muove
  col += palette(ph + 0.35) * mo * 0.35;

  // Fiori: coordinate leggermente "liquide" per farli respirare con il flusso
  vec2 fuv = uv + flow * uWarp * 0.02;
  float fm = 0.0;
  for (int i = 0; i < 4; i++) {
    vec4 f = flower(fuv, uFlowerA[i], uFlowerB[i], aspect);
    if (f.a <= 0.0) continue;
    // Fusione che dipende dalla ripresa:
    //  - zone chiare (pelle, viso): multiply → il fiore tinge la camera come un vetro colorato
    //  - zone scure: il fiore diventa luce, ma lascia trasparire la trama della camera
    vec3 tinted = col * (0.3 + 0.95 * f.rgb);
    vec3 lit = f.rgb * (0.5 + 0.5 * l) + col * 0.25;
    vec3 blended = mix(lit, tinted, smoothstep(0.25, 0.75, l));
    col = mix(col, blended, f.a);
    fm = max(fm, f.a);
  }

  // Folletti: luce che si somma; le scie del feedback disegnano la loro traiettoria
  float fz = 0.0;
  for (int i = 0; i < 3; i++) {
    float m;
    col += fairy(uv, uFairyA[i], uFairyB[i], aspect, m) * (1.0 + uHigh * 0.6);
    fz = max(fz, m);
  }

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
  fb *= 1.0 - fm * 0.55;   // il fiore resta nitido; quando svanisce, le scie se lo portano via
  fb *= 1.0 - fz * 0.85;   // il folletto è nitido dove si trova, la scia resta dietro
  fb *= 1.0 - mo * 0.5;    // il gesto è nitido, poi diventa scia

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
uniform float uFade; // dissolvenza d'ingresso 0..1
uniform sampler2D uMotion;
uniform float uMotionAmt, uMotionView;

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
  // I gesti lasciano polvere fatata
  float mo = texture2D(uMotion, uv).r * uMotionAmt;
  float dens = 0.03 + uHigh * 0.45 + uBeat * 0.2 + mo * 0.5;
  float s = stars(uv, 26.0, uTime, dens, 0.35)
          + stars(uv + 0.37, 48.0, uTime * 1.3, dens * 0.8, 0.6) * 0.6;
  s *= max(smoothstep(0.2, 0.7, lum), mo) * uSparkle * (0.5 + uHigh * 0.9 + uExpo + mo);
  col += s * mix(vec3(1.0), normalize(col + 0.001) * 1.6, 0.35);

  // Spalla morbida: sotto il ginocchio non tocca nulla, sopra comprime verso 1.
  // Normalmente protegge dal bianco; durante l'ondata il ginocchio sale e la luce può bruciare.
  float knee = min(0.65 + uExpo * 0.3, 0.95);
  vec3 over = max(col - knee, 0.0);
  col = min(col, knee) + (1.0 - knee) * (1.0 - exp(-over / (1.0 - knee)));

  // Vignetta che respira: chiusa nel silenzio, si apre sui bassi
  float vig = smoothstep(0.08 + uBass * 0.12 + uBeat * 0.08, 0.5, r2) * (1.0 - min(uExpo, 1.0) * 0.7);
  col *= mix(1.0, 0.22, vig);

  col *= uFade;

  // Vista di taratura: il movimento rilevato in giallo
  if (uMotionView > 0.5) col = mix(col * 0.45, vec3(1.0, 0.82, 0.3), texture2D(uMotion, uv).r);

  // Grana
  col += (hash(uv * uRes + fract(uTime * 7.0) * 113.0) - 0.5) * 0.03;

  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

// ── PASS 0: movimento ─────────────────────────────────────────
// Su un buffer piccolo: confronta la luminosità della camera con quella del frame
// precedente. r = movimento (con una breve memoria che svanisce), g = luminosità attuale.
const MOTION_FRAG = `
precision highp float;
varying vec2 vTexCoord;

uniform sampler2D uCam;
uniform sampler2D uPrevMotion;
uniform vec2  uRes;
uniform float uCamAspect;
uniform vec2  uTexel;  // dimensione di una cella del buffer, in uv
uniform float uSens;   // sensibilità (0 = spento)
uniform float uDecay;  // quanto resta del movimento al frame successivo

${COVER}

float luma(vec2 uv) {
  return dot(texture2D(uCam, camUV(uv)).rgb, vec3(0.299, 0.587, 0.114));
}

void main() {
  vec2 uv = vTexCoord;
  vec2 o = uTexel * 0.25;
  // Media di 4 campioni: riduce il rumore del sensore
  float l = 0.25 * (luma(uv + vec2(-o.x, -o.y)) + luma(uv + vec2(o.x, -o.y))
                  + luma(uv + vec2(-o.x, o.y)) + luma(uv + o));
  vec4 prev = texture2D(uPrevMotion, uv);
  float m = smoothstep(0.05, 0.2, abs(l - prev.g) * uSens);
  gl_FragColor = vec4(max(m, prev.r * uDecay), l, 0.0, 1.0);
}
`;
