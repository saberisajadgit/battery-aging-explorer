# ⚡ Battery Aging Explorer

[![Live Demo](https://img.shields.io/badge/Live%20Demo-GitHub%20Pages-00e5c8?style=for-the-badge&logo=github)](https://saberisajadgit.github.io/battery-aging-explorer)
[![React](https://img.shields.io/badge/React-18-61dafb?style=for-the-badge&logo=react)](https://react.dev)
[![Vite](https://img.shields.io/badge/Vite-5-646cff?style=for-the-badge&logo=vite)](https://vitejs.dev)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow?style=for-the-badge)](LICENSE)

An interactive, physics-based simulator for exploring **lithium-ion battery degradation mechanisms** in real time. Built on real OCV data from the **Panasonic NCR18650B** cell and aging models from peer-reviewed literature.

> **[→ Try the live demo](https://saberisajadgit.github.io/battery-aging-explorer)**

---

## 🔬 What It Shows

Battery aging is not a single process — it is the result of several competing electrochemical mechanisms happening simultaneously inside the cell. This tool lets you explore each one independently and observe how they affect the voltage curve, capacity, and internal resistance.

### Aging Mechanisms

| Mechanism | Symbol | Physical Origin | Observable Effect |
|---|---|---|---|
| Lithium Inventory Loss | **LLI** | SEI formation, electrolyte reduction, Li plating | Shifts anode OCV curve horizontally, reduces cyclable Li |
| Loss of Active Material (Anode) | **LAM-A** | Graphite particle cracking, electrical isolation | Compresses anode capacity, increases plating risk |
| Loss of Active Material (Cathode) | **LAM-C** | NMC particle cracking, phase transformation | Compresses cathode capacity, distorts voltage plateau |
| Solid Electrolyte Interphase Growth | **SEI** | Reductive electrolyte decomposition at anode | Increases DC resistance, consumes lithium, limits rate |

---

## 🔋 Battery Model

The simulator is based on the **Panasonic NCR18650B** cylindrical cell — one of the most studied Li-ion cells in the academic literature.

| Parameter | Value |
|---|---|
| Chemistry | NMC cathode / Graphite anode |
| Nominal Capacity | 3350 mAh |
| Nominal Voltage | 3.6 V |
| Voltage Window | 2.5 V – 4.2 V |
| Dimensions | ⌀18.5 × 65.2 mm |
| Mass | 48.5 g |
| Energy Density | 248 Wh/kg |
| DC Resistance (new) | 45 mΩ |
| Cycle Life to 80% | ~500 cycles (0.5C/0.5C, 25°C) |

### OCV Curves

The half-cell OCV curves are piecewise fits to published experimental data:

- **Graphite anode**: Two characteristic voltage plateaus at ~0.085 V and ~0.200 V (vs. Li/Li⁺), corresponding to Stage II→I and Stage III→II lithiation transitions (LiC₁₂ → LiC₆)
- **NMC cathode**: S-curve shape fitted to NCR18650B half-cell data, spanning 2.8–4.2 V

### Capacity Fade Model

The capacity fade model follows a mechanistic decomposition (Schmalstieg et al. 2014):

- **SEI growth**: proportional to √(cycle) — diffusion-limited parabolic kinetics
- **LLI**: linear with superimposed acceleration term at high cycle counts
- **LAM**: power-law with exponent > 1, producing the characteristic "knee point" observed experimentally

---

## ✨ Features

- **Live cell cross-section** — animated Li⁺ ion intercalation, SEI film growth, electrode shrinkage as LAM increases
- **Interactive Full-Cell OCV chart** — drag the dot along the curve to set SOC; ions and slider update instantly
- **Half-cell OCV** — see graphite stage-transition plateaus and how LLI shifts the anode curve
- **Capacity fade projection** — knee-point model over 800 cycles with current position marker
- **State of Health dashboard** — SOH, capacity, V_cell, R_int, dominant aging mode — all live
- **Lithium plating warning** — triggers when LAM-A and LLI combination creates plating risk
- **Cycle simulator** — click to auto-age the cell 50 cycles, watching all parameters evolve
- **Presets** — Pristine / 200 cycles / 500 cycles / End of Life
- **Spec sheet** — expandable full datasheet panel

---

## 🚀 Run Locally

**Requirements:** Node.js ≥ 18 ([nodejs.org](https://nodejs.org))

```bash
# Clone the repo
git clone https://github.com/saberisajadgit/battery-aging-explorer.git
cd battery-aging-explorer

# Install dependencies
npm install

# Start development server
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

---

## 📦 Build & Deploy

```bash
# Build for production
npm run build

# Deploy to GitHub Pages
npm run deploy
```

---

## 📚 Scientific References

The physics, OCV curves, and aging models in this simulator are based on:

1. **Schmalstieg, J. et al.** (2014). A holistic aging model for Li(NiMnCo)O₂ based 18650 lithium-ion batteries. *Journal of Power Sources*, 257, 325–334.

2. **Birkl, C. R. et al.** (2017). Degradation diagnostics for lithium ion cells. *Journal of Power Sources*, 341, 373–386.

3. **Attia, P. M. et al.** (2022). Knees in lithium-ion battery aging trajectories. *Journal of The Electrochemical Society*, 169(6), 060517.

4. **Panasonic Corporation** (2012). NCR18650B product datasheet.

5. **Plett, G. L.** (2015). *Battery Management Systems, Volume I: Battery Modeling*. Artech House.

---

## 🛠️ Tech Stack

- [React 18](https://react.dev) — UI framework
- [Vite](https://vitejs.dev) — build tool
- [Recharts](https://recharts.org) — Half-cell OCV and Capacity Fade charts
- Custom SVG — interactive Full-Cell OCV chart with drag-to-scrub
- Pure CSS animations — ion particle system

---

## 📄 License

MIT © [saberisajadgit](https://github.com/saberisajadgit)

---

<p align="center">Built for battery researchers, students, and engineers exploring Li-ion degradation physics.</p>
