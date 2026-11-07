# Rumore Sud · #1

Visual interattivi nel browser: la webcam viene trasformata in un mondo onirico (colori acidi o fatati, scie liquide, polvere luminosa) che reagisce alla musica.

Costruito con [p5.js](https://p5js.org/) e shader GLSL: tutti gli effetti girano sulla GPU, a 15 fps per un effetto rallentato e un carico leggero.

## Avvio

La webcam funziona solo su `localhost` o in HTTPS, quindi serve un piccolo server locale:

```bash
python3 -m http.server 8000
# oppure: npx serve
```

Poi apri <http://localhost:8000> e clicca **entra nel sogno**.

## Audio

- **Brano**: metti un file in `audio/track.mp3` (o cambia `TRACK` in `sketch.js`). Se manca, si parte dall'ingresso live.
- **Carica…** o trascina un file audio sulla pagina.
- **Ingresso live**: microfono o scheda audio (es. l'uscita del mixer di un DJ), scelto dal menu.

## Comandi

| Tasto | Effetto |
|---|---|
| `1`–`4` | Palette: Acido · Fatato · Onirico · Aurora |
| `+` / `−` | Reattività al suono |
| `E` | Ondata di luce manuale |
| `[` / `]` | Frequenza delle ondate di luce |
| `↑` / `↓` | Durata delle scie |
| `←` / `→` | Liquidità della distorsione |
| `S` | Polvere fatata on/off |
| `T` / `M` | Brano / ingresso live |
| `spazio` | Play / pausa |
| `F` | Schermo intero |
| `H` | Mostra / nascondi controlli |

## File

- `shaders.js`: gli effetti visivi (GLSL)
- `audio.js`: analisi del suono (bassi, medi, alti, battito, ondate)
- `sketch.js`: parametri di default, palette, controlli
