# Draw App Manga

App per chi vuole raccontare a fumetti ma non sa disegnare: si costruisce un corpo umano,
lo si muove articolazione per articolazione come un manichino, si sceglie l'inquadratura
e il motore produce la vignetta in stile manga.

**Niente AI generativa**: ogni tratto nasce dalla scena 3D con regole deterministiche.

## Il corpo, strato dopo strato

Le ossa vengono dall'atlante anatomico **BodyParts3D** (scansione di un corpo reale,
© DBCLS, CC BY 4.0). Sopra, il codice aggiunge ciò che rende il corpo un manichino:
articolazioni con i loro limiti reali e un sistema nervoso che coordina i movimenti.

| Strato | Stato |
|---|---|
| 1. Scheletro — 103 ossa mobili dall'atlante BodyParts3D, centri articolari calcolati dalla geometria | ✅ |
| 2. Articolazioni — tipi anatomici e limiti di movimento reali | ✅ |
| 3. Sistema nervoso — coordinamento dei movimenti | ✅ prima versione |
| 4. Muscoli — volumi da origine a inserzione che si accorciano e si gonfiano | da fare |
| 5. Pelle e volumi — la figura esterna | da fare |
| 6. Sistema nervoso visibile — i nervi come strato anatomico | da fare |

### Scheletro
[public/anatomy/skeleton.glb](public/anatomy/) è generato da
[tools/build-anatomy.mjs](tools/build-anatomy.mjs) a partire dall'atlante:
le parti anatomiche (per nome FMA) sono raggruppate nelle ossa mobili e i centri
articolari sono calcolati dalla geometria reale — baricentro delle superfici affacciate
per la maggior parte dei giunti, sfera sulla testa articolare per anca e spalla.

Per rigenerarlo: scarica `partof_BP3D_4.0_obj_99.zip` e `partof_element_parts.txt` da
https://dbarchive.biosciencedbc.jp/en/bodyparts3d/download.html, poi
`npm run build:anatomy -- <cartella>`.

La gerarchia e la semantica delle ossa sono in [bodyDefinition.ts](src/engine/body/bodyDefinition.ts).

### Articolazioni
Ogni articolazione ha il suo tipo (enartrosi, ginglimo, trocoide, a sella, condiloidea),
i movimenti con i nomi anatomici (flessione, abduzione, pronazione, inversione…) e
l'escursione reale in gradi. Lo zero di ogni angolo è la **posizione anatomica**.
Convenzioni in [joints.ts](src/engine/body/joints.ts).

### Sistema nervoso
[nervousSystem.ts](src/engine/body/nervousSystem.ts) traduce le intenzioni in rotazioni delle ossa:
- **distribuzione spinale**: collo, colonna toracica e lombare si piegano ripartendo il movimento sulle vertebre
- **ritmo scapolo-omerale**: oltre i 30° la scapola accompagna il braccio (2:1); senza coordinamento la spalla si ferma a 120°
- **sinergia di chiusura della mano**: un comando flette tutte le dita
- **limiti dipendenti dalla direzione**: il braccio sale di 180° in avanti, ~60° all'indietro

## Avvio

```bash
npm install
npm run dev
```

Clicca un pallino colorato sullo scheletro per scegliere un'articolazione e muoverla dal pannello.

Parametri URL utili per test e confronti:

| Parametro | Esempio | Effetto |
|---|---|---|
| `h` | `h=180` | altezza in cm |
| `select` | `select=elbow_L` | articolazione selezionata |
| `cam` | `cam=front` / `side` / `threeQuarter` | inquadratura |
| `focus`, `size` | `focus=carpus_R&size=0.25` | inquadra da vicino un osso |
| `mode` | `mode=manga` | vista vignetta |
| `coord` | `coord=0` | coordinamento automatico spento |
| `markers` | `markers=0` | nasconde le articolazioni |
| `demo` | `demo=1` | posa di prova per i test visivi |

## Render manga

La vista "Vignetta manga" usa una pipeline a più passate (G-buffer + composizione):
linee da profondità, normali e confini tra oggetti, retini e ombre piatte, supersampling.
Vedi [src/engine/manga/](src/engine/manga/).

## Struttura

```
src/
  engine/
    body/          corpo: definizione anatomica, geometria, scheletro, sistema nervoso
    manga/         pipeline di render manga
    export/        esportazione PNG
    Viewport.ts    scena, camera, loop di disegno
  ui/              controlli del pannello (senza framework)
  main.ts          avvio e collegamento UI ↔ motore
```

## Stack

TypeScript, Three.js, Vite. In futuro: impacchettamento desktop (Electron/Tauri).
