# Draw App Manga

App per chi vuole raccontare a fumetti ma non sa disegnare: si crea il personaggio,
lo si mette in posa come un manichino 3D, si sceglie l'inquadratura e il motore
produce la vignetta in stile manga (linee, ombre piatte, retini).

**Niente AI generativa**: ogni tratto nasce dalla scena 3D con regole deterministiche.
La stessa scena produce sempre la stessa vignetta.

## Stato: prototipo del render

Questo primo prototipo serve a validare l'estetica:

- personaggio VRM di prova, pose ed espressioni di esempio
- camera da regista (focale, inquadrature tipiche)
- render manga: contorni, pieghe, confini tra materiali, ombre a retino/tratteggio/nero, retini a punti
- esportazione della vignetta in PNG ad alta risoluzione

## Avvio

```bash
npm install
npm run dev
```

Lo stato iniziale si può impostare dall'URL, utile per confronti:

```
http://localhost:5173/?pose=wave&expr=happy&shot=medium&view=manga
```

| Parametro | Valori |
|---|---|
| `mode` | `manga`, `3d` |
| `view` | `manga`, `lines`, `shading`, `normals`, `depth`, `ids`, `albedo` |
| `pose` | `tpose`, `relaxed`, `wave`, `hand` |
| `expr` | `neutral`, `happy`, `angry`, `sad`, `relaxed` |
| `shot` | `full`, `medium`, `close` |
| `focal` | lunghezza focale in mm |

## Come funziona il render

Non è un filtro applicato a uno screenshot: il motore renderizza la scena in più
"passate" invisibili e poi le compone con regole da mangaka.

1. **G-buffer** ([GBufferMaterial.ts](src/engine/manga/GBufferMaterial.ts)): ogni materiale
   viene temporaneamente sostituito da uno shader che scrive in un colpo solo
   luminosità/saturazione del colore, illuminazione, normali, ID dell'oggetto e profondità.
2. **Composizione** ([compositeShader.ts](src/engine/manga/compositeShader.ts)):
   - linee esterne dai salti di profondità e dal contorno della figura
   - linee interne da pieghe (normali) e confini tra materiali (ID)
   - campiture: nero pieno per i colori scuri, retino medio/chiaro per i colori intermedi o saturi
   - ombre: retino più denso, tratteggio o nero
   - convenzioni manga: pelle bianca, viso senza ombre "sporche", ciglia e sopracciglia sempre in nero
3. **Supersampling 2×** per linee pulite, poi riduzione alla dimensione finale.

La fisica (capelli, gonna) viene fatta assestare dopo ogni cambio di posa e poi
congelata ([loadVRM.ts](src/engine/character/loadVRM.ts)): una vignetta è un'immagine ferma.

## Struttura

```
src/
  engine/              motore, indipendente dall'interfaccia
    Viewport.ts        scena, camera, loop di disegno
    manga/             pipeline di render manga
    character/         caricamento VRM, pose, espressioni, fisica
    export/            esportazione PNG
  ui/                  controlli del pannello (senza framework)
  main.ts              avvio e collegamento UI ↔ motore
public/models/         modelli di prova (vedi LICENSE.md lì dentro)
```

## Stack

TypeScript, Three.js, [@pixiv/three-vrm](https://github.com/pixiv/three-vrm), Vite.
In futuro: impacchettamento desktop (Electron/Tauri).

## Crediti

Modello di prova: AvatarSample_E di VRoid Project (pixiv), uso libero anche commerciale —
dettagli in [public/models/LICENSE.md](public/models/LICENSE.md).
