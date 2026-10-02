# Bifurcate

Interactive logistic-map bifurcation diagram. The horizontal axis is the parameter `r`. The vertical axis is the attractor of

```
x′ = r x (1 − x)
```

Scroll or pinch to zoom, drag to pan, and double-click to zoom in. Reset returns to `r` 2.5–4 and `x` 0–1.

**EDM** sweeps the diagram from left to right and plays it, then rewinds and repeats until you press **EDM** again. Pitch follows the height of the chosen points. Denser columns add synth voices, stay on the column longer, and keep the beat at the same tempo. Each run splits the diagram into horizontal bands, and each voice only plays inside its band. The browser must allow audio (a click starts it).

## Run

```bash
npm install
npm run dev
```

Open `http://localhost:8080`.

```bash
npm run typecheck
npm run build
```
