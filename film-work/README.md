# 360 Logistics System film refinement

This local production uses the prior 60-second film as its motion and UI reference. The ten supplied photographs are in `assets/`: four truck views and six distinct document examples. Genuine application interface captures were taken from the supplied reference film. The existing application logo is copied from `src/assets`.

`film.html` is the single-canvas, deterministic animation; `window.seek(t)` draws any time from 0 to 60 seconds. `score.mjs` generated the original 120 BPM, 60-second piano-led soundtrack in `score.wav`. `render.mjs` captures four subframes for each 60 FPS output frame and combines them into `360-Logistics-System-Refined.mp4`.

The document photographs are presented as distinct examples, not as a single historical shipment. The account wording over the genuine dashboard capture is changed to CSR for the film. No production application or database files are changed.
