# Rumore Sud · #1

Visual interattivi nel browser: la webcam viene trasformata in un mondo onirico (colori acidi o fatati, scie liquide, polvere luminosa) che reagisce alla musica.

Costruito con [p5.js](https://p5js.org/) e shader GLSL: tutti gli effetti girano sulla GPU, a 15 fps per un effetto rallentato e un carico leggero.

## Avvio

La webcam funziona solo su `localhost` o in HTTPS, quindi serve un piccolo server locale:

```bash
python3 -m http.server 8000
# oppure: npx serve
```

Poi apri <http://localhost:8000> e clicca **Entra nel sogno**.

**Da telefono o tablet** l'indirizzo di rete (`http://192.168.…:8000`) non basta: il browser blocca webcam e microfono fuori da HTTPS, e la pagina lo segnala. Serve un tunnel HTTPS (es. `npx localtunnel --port 8000` o `cloudflared tunnel --url http://localhost:8000`) oppure un hosting HTTPS.

## Audio

- **Brano**: `audio/track.mp3` è nel repo (cambia `TRACK` in `sketch.js` per usarne un altro). Se manca, si parte dall'ingresso live.
- **Carica un file…** o trascina un file audio sulla pagina.
- **Ingresso live**: microfono o scheda audio (es. l'uscita del mixer di un DJ), scelto dal menu.

## Movimento

Chi si muove davanti alla camera fa parte dello spettacolo: un'aura di luce e polvere fatata segue i gesti, i fiori sbocciano dove ci si muove e i folletti vengono attirati e girano attorno a chi si muove. La sensibilità si regola nel pannello **Sviluppo** (`?dev`); il tasto `V` mostra in giallo il movimento rilevato, utile per tararla sul posto (luce della sala, distanza delle persone).

## Stabilità

Pensato per girare a lungo in proiezione:

- se la GPU si resetta o il disegno si blocca per più di 5 s, la grafica si ricostruisce da sola senza fermare la musica (c'è anche il bottone **Riavvia la grafica** nel pannello **Sviluppo**);
- se il browser ricarica la pagina per un crash, i visual ripartono da soli con le stesse impostazioni; per l'audio basta un tocco su **Riattiva l'audio** (il browser non permette di far partire il suono da solo);
- nel pannello **Sviluppo**, sotto **Stato**: da quanto è attivo, memoria usata (solo Chrome), ricostruzioni e riprese.

## Controlli

Il bottone **Controlli** in basso a sinistra apre il pannello (su desktop parte già aperto, su telefono si apre come foglio dal basso). I controlli sono grandi da toccare, leggibili e usabili anche da tastiera e screen reader (`Esc` chiude). In proiezione, a mouse fermo, cursore e bottone spariscono e tornano al primo movimento o tocco.

Il pannello ha due livelli:

- **Esperienza** (sempre visibile), per chi usa l'installazione: musica (play/pausa, brano, carica un file, microfono), palette, gesti magici (ondata di luce, fai sbocciare un fiore, chiama un folletto), fiori e folletti on/off, reattività alla musica, schermo intero.
- **Sviluppo** (solo aprendo <http://localhost:8000/?dev>), per tarare e diagnosticare: analisi audio, luce (intensità e frequenza delle ondate, bagliore, polvere fatata), immagine (scie, liquido, colori), movimento (sensibilità, vista del movimento rilevato), stato, riavvio della grafica, ripristino dei valori predefiniti, elenco delle scorciatoie.

Le impostazioni scelte in modalità sviluppo restano attive per tutta la sessione della scheda, quindi si può tarare con `?dev` e poi passare alla pagina normale.

### Scorciatoie da tastiera

| Tasto | Effetto |
|---|---|
| `1`–`4` | Palette: Acido · Fatato · Onirico · Aurora |
| `E` | Ondata di luce |
| `N` / `K` | Fai sbocciare un fiore · chiama un folletto |
| `B` / `L` | Fiori on/off · folletti on/off |
| `+` / `−` | Reattività alla musica |
| `spazio` | Play / pausa |
| `T` / `M` | Brano / ingresso live |
| `F` | Schermo intero |
| `H` / `Esc` | Mostra-nascondi / chiudi il pannello |

Solo in modalità sviluppo (`?dev`):

| Tasto | Effetto |
|---|---|
| `[` / `]` | Frequenza delle ondate di luce |
| `↑` / `↓` | Durata delle scie |
| `←` / `→` | Liquidità della distorsione |
| `S` | Polvere fatata on/off |
| `V` | Mostra il movimento rilevato |

## File

- `shaders.js`: gli effetti visivi (GLSL)
- `audio.js`: analisi del suono (bassi, medi, alti, battito, ondate)
- `sketch.js`: parametri di default, palette, fiori, folletti, scorciatoie
- `ui.js`: il pannello di controllo (generato dall'elenco `SECTIONS`)
- `audio/track.mp3`: il brano di default
