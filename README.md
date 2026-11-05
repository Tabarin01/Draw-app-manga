# Draw App Manga

Un'app per raccontare storie a fumetti e manga **senza saper disegnare**.

Crei i tuoi personaggi nel dettaglio, come nell'editor di un videogioco, li metti in
posa come manichini, scegli inquadratura e ambientazione, e l'app restituisce la
vignetta disegnata in 2D.

**Niente AI generativa.** Il disegno nasce dalla scena 3D con regole fisse: ogni
personaggio resta identico da una vignetta all'altra e il risultato è sempre sotto
il controllo di chi racconta.

## Come si usa

1. **Crea il personaggio.** Il corpo è costruito a strati, come quello vero:
   scheletro, muscoli, pelle, poi viso, capelli e vestiti. Proporzioni e corporatura
   si personalizzano.
2. **Mettilo in posa.** Muovi le articolazioni entro i loro limiti reali. Il "sistema
   nervoso" coordina il resto: la scapola accompagna il braccio, la colonna si piega
   su tutte le vertebre, la mano si chiude con tutte le dita insieme.
3. **Componi la scena.** Camera da regista (focale, angolazione, inquadrature),
   più personaggi, ambientazione.
4. **Ottieni la vignetta.** Render in stile manga: linee, ombre piatte, retini.
5. **Impagina.** Tavola con vignette, balloon e onomatopee; esportazione per stampa e web.

## A che punto siamo

| Parte | Stato |
|---|---|
| Render manga (linee, ombre, retini, esportazione PNG) | ✅ prototipo |
| Scheletro anatomico reale (livello base) | ✅ |
| Organi interni e vasi sanguigni, come livelli attivabili che seguono la posa | ✅ |
| Articolazioni con limiti di movimento reali | ✅ |
| Sistema nervoso: coordinamento dei movimenti | 🟡 prima versione, manca il trascinamento di mani e piedi |
| Muscoli | ⬜ |
| Pelle e corporatura | ⬜ |
| Viso, capelli, vestiti | ⬜ |
| Scena: più personaggi, ambientazioni | ⬜ |
| Impaginazione: tavola, balloon, onomatopee | ⬜ |
| Nervi come strato anatomico visibile | ⬜ |

## Avvio

```bash
npm install
npm run dev
```

Clicca un pallino colorato sullo scheletro per scegliere un'articolazione e muoverla
dal pannello.

## Tecnica, in breve

- TypeScript, Three.js, Vite. Prima web, poi anche app desktop (Electron o Tauri).
- `src/engine/body/`: corpo, articolazioni, sistema nervoso.
- `src/engine/manga/`: render manga a più passate.
- `src/main.ts`: interfaccia.
- I livelli anatomici (`public/anatomy/`: scheletro, organi, vasi sanguigni) sono generati
  da `tools/build-anatomy.mjs` a partire dall'atlante anatomico BodyParts3D; le istruzioni
  sono in testa allo script.

## Crediti

Anatomia: BodyParts3D, © The Database Center for Life Science, licenza
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Dettagli in
[public/anatomy/ATTRIBUTION.md](public/anatomy/ATTRIBUTION.md).
