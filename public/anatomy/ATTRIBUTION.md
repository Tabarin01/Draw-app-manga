# Attribuzione

`skeleton.glb` è derivato da **BodyParts3D 4.0**:

> BodyParts3D, © The Database Center for Life Science licensed under CC Attribution 4.0 International

- Licenza: https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html (CC BY 4.0, consultata il 2026-11-05)
- Download: https://dbarchive.biosciencedbc.jp/en/bodyparts3d/download.html (`partof_BP3D_4.0_obj_99.zip`)

Nota: i commenti dentro i file OBJ originali citano ancora la vecchia licenza
CC BY-SA 2.1 Japan; la pagina ufficiale della licenza indica CC BY 4.0. Prima di una
pubblicazione commerciale conviene una conferma scritta dal DBCLS.

## Modifiche apportate

Generato con `tools/build-anatomy.mjs`:
- le parti anatomiche sono raggruppate nelle ossa mobili dello scheletro dell'app
- coordinate convertite (mm, Z in alto → metri, Y in alto) e traslate (piedi a terra)
- mesh dense alleggerite con clustering dei vertici
- centri articolari calcolati dalla geometria e salvati negli `extras` della scena
