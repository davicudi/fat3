// ─────────────────────────────────────────────────────────────
//  Analisi audio con Web Audio API nativa.
//  Sorgenti: microfono oppure file trascinato sulla pagina.
//  Espone valori 0..1 già lisciati: bass, mid, high, level, beat.
// ─────────────────────────────────────────────────────────────

class AudioReactive {
  constructor() {
    this.ctx = null;
    this.analyser = null;
    this.source = null;
    this.micStream = null;
    this.audioEl = null;

    this.bass = 0; this.mid = 0; this.high = 0; this.level = 0; this.beat = 0;
    this.peak = { bass: 0.2, mid: 0.2, high: 0.2 }; // auto-gain
    this.avg = { bass: 0, mid: 0, high: 0 };        // media mobile lenta
    this.prevBass = 0;
    this.bassAvg = 0;

    // "Ondata": momenti in cui l'energia sale di colpo rispetto agli ultimi secondi (drop, entrate)
    this.surge = 0;            // 0..1, inviluppo di luce
    this.surgeHold = 0;        // secondi di picco rimanenti
    this.lastSurge = -999;
    this.energyFast = 0;       // ~0.3 s
    this.energySlow = 0;       // ~8 s
    this.surgeCooldown = 6;    // secondi minimi tra due ondate
    this.surgeThreshold = 1.3; // quanto deve superare la media lenta (più basso = più frequente)
    this.lastBeat = 0;
    this.time = 0;
    this.sourceTime = 0;       // secondi dall'ultimo cambio di sorgente
    this.mode = 'nessuno';
  }

  init() {
    if (this.ctx) return;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.45; // più reattivo: la lisciatura la facciamo noi
    this.analyser.minDecibels = -85;
    this.analyser.maxDecibels = -20;
    this.freq = new Uint8Array(this.analyser.frequencyBinCount);
  }

  _disconnect() {
    if (this.source) { try { this.source.disconnect(); } catch (e) {} this.source = null; }
    if (this.audioEl) {
      // Libero davvero il decoder e il file: senza questo ogni cambio di brano resta in memoria
      this.audioEl.pause();
      this.audioEl.removeAttribute('src');
      this.audioEl.load();
      this.audioEl = null;
    }
    if (this.objectUrl) { URL.revokeObjectURL(this.objectUrl); this.objectUrl = null; }
  }

  // Ingresso live: microfono o scheda audio (es. uscita del mixer del DJ).
  // deviceId vuoto = ingresso predefinito di sistema.
  async useMic(deviceId = '') {
    this.init();
    await this.ctx.resume();
    this._disconnect();
    if (!this.micStream || this.micDeviceId !== deviceId) {
      if (this.micStream) this.micStream.getTracks().forEach((t) => t.stop());
      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: deviceId ? { exact: deviceId } : undefined,
          // niente elaborazioni "da videochiamata": vogliamo il segnale grezzo
          echoCancellation: false, noiseSuppression: false, autoGainControl: false,
        },
      });
      this.micDeviceId = deviceId;
    }
    this.source = this.ctx.createMediaStreamSource(this.micStream);
    this.source.connect(this.analyser); // NON verso le casse: niente larsen
    this.sourceTime = 0;
    const label = this.micStream.getAudioTracks()[0]?.label;
    this.mode = label ? `live · ${label}` : 'microfono';
    this.kind = 'live';
  }

  // Elenco degli ingressi audio (i nomi compaiono solo dopo il primo permesso)
  async listInputs() {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((d) => d.kind === 'audioinput');
  }

  // Brano da URL (file nella cartella audio/) — suona anche dalle casse
  async useUrl(url, name = url) {
    this.init();
    await this.ctx.resume();
    this._disconnect();
    const el = new Audio(url);
    el.loop = true;
    this.audioEl = el;
    this.source = this.ctx.createMediaElementSource(el);
    this.source.connect(this.analyser);
    this.source.connect(this.ctx.destination);
    this.sourceTime = 0;
    try {
      await el.play();
    } catch (e) {
      this._disconnect();
      throw e;
    }
    this.mode = `brano · ${name}`;
    this.kind = 'track';
  }

  // Brano scelto o trascinato dall'utente
  async useFile(file) {
    const url = URL.createObjectURL(file);
    await this.useUrl(url, file.name);
    this.objectUrl = url; // revocato al prossimo cambio di sorgente
    this.kind = 'file';
  }

  togglePlay() {
    if (!this.audioEl) return;
    this.audioEl.paused ? this.audioEl.play() : this.audioEl.pause();
  }

  // Media dei bin FFT tra due frequenze, 0..1
  _band(lo, hi) {
    const nyq = this.ctx.sampleRate / 2;
    const n = this.freq.length;
    const a = Math.max(1, Math.floor((lo / nyq) * n));
    const b = Math.min(n - 1, Math.ceil((hi / nyq) * n));
    let s = 0;
    for (let i = a; i <= b; i++) s += this.freq[i];
    return s / ((b - a + 1) * 255);
  }

  // Normalizzazione "a contrasto": conta quanto il segnale sta SOPRA la sua media recente,
  // rispetto al picco. Così un kick spicca anche in un pezzo con bassi sempre presenti.
  // Una piccola quota di livello assoluto evita che tutto si spenga nei pezzi piatti.
  _norm(name, raw, dt) {
    this.avg[name] += (raw - this.avg[name]) * (1 - Math.exp(-dt * 1.2));
    this.peak[name] = Math.max(raw, this.peak[name] * Math.exp(-dt * 0.3), 0.1);
    const floor = this.avg[name] * 0.9;
    const contrast = (raw - floor) / Math.max(this.peak[name] - floor, 0.04);
    const absolute = raw / this.peak[name];
    return Math.min(1, Math.max(0, contrast * 0.85 + absolute * 0.25));
  }

  // Attacco veloce, rilascio lento: movimento organico, non nervoso
  _follow(cur, target, dt, attack = 18, release = 3.5) {
    const r = target > cur ? attack : release;
    return cur + (target - cur) * (1 - Math.exp(-dt * r));
  }

  // Ondata manuale (tasto E): utile dal vivo per sottolineare un momento
  triggerSurge() {
    this.surgeHold = 0.5;
    this.lastSurge = this.time;
  }

  _updateSurge(raw, dt) {
    // Riscaldamento: con una sorgente nuova la media lenta parte da zero e ogni suono
    // sembrerebbe un'esplosione. Per qualche secondo la allineo e non lancio ondate.
    if (this.sourceTime < 5) {
      this.energyFast += (raw - this.energyFast) * (1 - Math.exp(-dt / 0.3));
      this.energySlow = this.energyFast;
      return;
    }
    this.energyFast += (raw - this.energyFast) * (1 - Math.exp(-dt / 0.3));
    this.energySlow += (raw - this.energySlow) * (1 - Math.exp(-dt / 8));
    const ratio = this.energyFast / Math.max(this.energySlow, 0.02);
    if (ratio > this.surgeThreshold && this.energyFast > 0.15 &&
        this.time - this.lastSurge > this.surgeCooldown) {
      this.triggerSurge();
    }
  }

  update(dt) {
    this.time += dt;
    this.sourceTime += dt;
    this.beat *= Math.exp(-dt * 7);

    // Inviluppo dell'ondata: attacco quasi istantaneo, tenuta, lunga coda (~2.5 s)
    if (this.surgeHold > 0) {
      this.surgeHold -= dt;
      this.surge += (1 - this.surge) * (1 - Math.exp(-dt * 25));
    } else {
      this.surge *= Math.exp(-dt * 1.4);
    }
    if (!this.analyser || !this.source) {
      // nessun audio: decadimento dolce verso zero
      this.bass *= 0.95; this.mid *= 0.95; this.high *= 0.95; this.level *= 0.95;
      return;
    }
    this.analyser.getByteFrequencyData(this.freq);

    const rb = this._band(30, 120);    // cassa e sub
    const rm = this._band(200, 2000);  // voci, synth, rullante
    const rh = this._band(4000, 12000); // hi-hat, piatti, aria

    // Rilascio più rapido = impulsi ben leggibili invece di una "marea" continua
    this.bass = this._follow(this.bass, this._norm('bass', rb, dt), dt, 30, 7);
    this.mid = this._follow(this.mid, this._norm('mid', rm, dt), dt, 20, 5);
    this.high = this._follow(this.high, this._norm('high', rh, dt), dt, 40, 9);
    this.level = this._follow(this.level, (this.bass + this.mid + this.high) / 3, dt, 8, 3);

    this._updateSurge((rb + rm + rh) / 3, dt);

    // Beat detection: bassi in salita e sopra la media mobile.
    // Soglie basse perché i dati FFT sono in dB (dinamica compressa).
    this.bassAvg += (rb - this.bassAvg) * (1 - Math.exp(-dt * 2.5));
    const rising = rb - this.prevBass > 0.004;
    this.prevBass = rb;
    if (rising && rb > this.bassAvg * 1.08 + 0.015 && rb > 0.12 && this.time - this.lastBeat > 0.22) {
      this.beat = 1;
      this.lastBeat = this.time;
    }
  }
}
