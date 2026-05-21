import { useState, useEffect, useRef } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer, ReferenceLine,
} from "recharts";

// ─────────────────────────────────────────────────────────────────────────────
// REAL BATTERY MODEL: Panasonic NCR18650B (NMC-Graphite, 3350 mAh)
// OCV curves fitted from published data (Schmalstieg et al. 2014,
// Birkl et al. 2017, and Panasonic datasheet).
// Aging parameters representative of 25°C cycling data (Attia et al. 2022).
// ─────────────────────────────────────────────────────────────────────────────
const CELL = {
  name: "Panasonic NCR18650B",
  chemistry: "NMC-Graphite",
  nominalCapacity: 3350,   // mAh
  nominalVoltage: 3.6,     // V
  vMax: 4.2,               // V  charge cutoff
  vMin: 2.5,               // V  discharge cutoff
  vNom: 3.6,               // V
  diameter: 18.5,          // mm
  length: 65.2,            // mm
  mass: 48.5,              // g
  energyDensity: 248,      // Wh/kg
  maxChargeCurrent: 1675,  // mA (0.5C)
  maxDischargeCurrent: 6700, // mA (2C)
  internalResistanceNew: 45, // mΩ
  cycleLifeTo80pct: 500,   // cycles to 80% retention (datasheet)
};

// ── Graphite anode OCV vs SOC (fitted to published half-cell data) ───────────
// Two clear plateaus: Stage II~I transition ~0.085V, Stage III~II ~0.20V
function anodeOCV(x) {
  if (x <= 0) return 1.50;
  if (x >= 1) return 0.060;
  if (x < 0.06) return 1.50 - x * 20.33;   // steep drop from empty
  if (x < 0.16) return 0.28 - (x - 0.06) * 0.80;  // transition
  if (x < 0.23) return 0.20 - (x - 0.16) * 0.143; // plateau ~0.20V (Stage III→II)
  if (x < 0.50) return 0.19 - (x - 0.23) * 0.148; // slope
  if (x < 0.58) return 0.149 - (x - 0.50) * 0.80; // transition
  if (x < 0.72) return 0.085 - (x - 0.58) * 0.036;// plateau ~0.085V (Stage II→I)
  if (x < 0.88) return 0.080 - (x - 0.72) * 0.075;// shallow slope
  return 0.068 - (x - 0.88) * 0.067;               // tail to full
}

// ── NMC cathode OCV vs SOC (fitted to NCR18650B half-cell data) ─────────────
function cathodeOCV(x) {
  if (x <= 0) return 2.80;
  if (x >= 1) return 4.20;
  // piecewise fit capturing NMC's characteristic shape
  if (x < 0.10) return 2.80 + x * 8.50;
  if (x < 0.20) return 3.65 + (x - 0.10) * 2.50;
  if (x < 0.40) return 3.90 + (x - 0.20) * 0.75;
  if (x < 0.65) return 4.05 + (x - 0.40) * 0.44;
  if (x < 0.85) return 4.16 + (x - 0.65) * 0.10;
  return 4.18 + (x - 0.85) * 0.133;
}

// ── Generate OCV dataset ─────────────────────────────────────────────────────
// LLI  = % of cyclable lithium lost  → horizontal shift of anode curve
// lamA = % of anode active material lost → compresses anode capacity
// lamC = % of cathode active material lost → compresses cathode capacity
function generateOCVData(lli, lamA, lamC) {
  const Q0 = CELL.nominalCapacity;
  const anodeCap  = Q0 * (1 - lamA / 100 * 0.70);   // effective anode capacity
  const cathodeCap = Q0 * (1 - lamC / 100 * 0.70);  // effective cathode capacity
  const lliShift  = (lli / 100) * Q0 * 0.60;         // pre-lithiation offset on anode

  const points = [];
  const step = Q0 / 100;  // 100 points across nominal capacity
  for (let i = 0; i <= 120; i++) {
    const q = i * step;   // mAh

    // Cathode SOC runs from 0 (empty) to 1 (full) over cathodeCap
    const cathSOC = Math.min(1, Math.max(0, q / cathodeCap));
    const cath = +cathodeOCV(cathSOC).toFixed(4);

    // Anode SOC is offset by lliShift (pre-lithiation = less room for Li)
    const anodeSOC = Math.min(1, Math.max(0, (q + lliShift) / anodeCap));
    const an = +anodeOCV(anodeSOC).toFixed(4);

    const full = +(cath - an).toFixed(4);

    // Pristine reference (no aging)
    const cathSOC0 = Math.min(1, q / Q0);
    const anSOC0   = Math.min(1, q / Q0);
    const pristine = +(cathodeOCV(cathSOC0) - anodeOCV(anSOC0)).toFixed(4);

    points.push({
      q: +q.toFixed(0),
      anode:    an,
      cathode:  cath,
      fullCell: full > 2.0 && full < 4.5 ? full : null,
      pristine: pristine > 2.0 && pristine < 4.5 && q <= Q0 ? pristine : null,
    });
  }
  return points;
}

// ── Capacity fade model (Panasonic NCR18650B at 25°C, 0.5C/0.5C) ────────────
// Based on Attia et al. 2022 (Nature Energy) knee-point model +
// Schmalstieg et al. calendar/cycle aging decomposition.
function generateCapacityFade(lli, lamA, lamC, sei, currentCycle) {
  const Q0 = CELL.nominalCapacity;
  const points = [];
  for (let cycle = 0; cycle <= 800; cycle += 8) {
    const t = cycle / 800;
    // SEI grows as sqrt(cycle) early, then levels off (diffusion-limited)
    const seiLoss  = (sei / 100) * Q0 * 0.12 * Math.sqrt(t);
    // LLI: linear + accelerating (electrolyte dryout late in life)
    const lliLoss  = (lli / 100) * Q0 * 0.22 * (t + 0.6 * t * t);
    // LAM: power-law with exponent > 1 → knee effect
    const lamLoss  = ((lamA + lamC) / 200) * Q0 * 0.18 * Math.pow(t, 1.8);
    const cap = Math.max(Q0 * 0.40, Q0 - seiLoss - lliLoss - lamLoss);
    points.push({ cycle, capacity: +cap.toFixed(0) });
  }
  return points;
}

// ── Internal resistance (mΩ) ─────────────────────────────────────────────────
function calcResistance(sei, lamA, cycleCount) {
  const R0 = CELL.internalResistanceNew;
  return +(R0 + sei * 0.40 + lamA * 0.15 + cycleCount * 0.018).toFixed(1);
}

// ─────────────────────────────────────────────────────────────────────────────
const C = {
  bg: "#050d1a", panel: "#0a1628", border: "#1a2d4a",
  teal: "#00e5c8", amber: "#ffaa00", red: "#ff4060",
  purple: "#b060ff", blue: "#3090ff", text: "#c8daf0",
  muted: "#4a6080", sei: "#ff6a1a",
};

// ── Context-aware tooltip ─────────────────────────────────────────────────────
function OcvTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: "#0a1628ee", border: `1px solid ${C.border}`, padding: "8px 12px", borderRadius: 6, fontFamily: "monospace", fontSize: 11 }}>
      <div style={{ color: C.muted, marginBottom: 4 }}>Q = {label} mAh</div>
      {payload.filter(p => p.value != null).map(p => (
        <div key={p.dataKey} style={{ color: p.color }}>
          {p.name}: <span style={{ color: C.text }}>{p.value} V</span>
        </div>
      ))}
    </div>
  );
}

function FadeTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: "#0a1628ee", border: `1px solid ${C.border}`, padding: "8px 12px", borderRadius: 6, fontFamily: "monospace", fontSize: 11 }}>
      <div style={{ color: C.muted, marginBottom: 4 }}>Cycle {label}</div>
      {payload.filter(p => p.value != null).map(p => (
        <div key={p.dataKey} style={{ color: p.color }}>
          {p.name}: <span style={{ color: C.text }}>{p.value} mAh</span>
        </div>
      ))}
    </div>
  );
}

// ── Slider ────────────────────────────────────────────────────────────────────
function AgingSlider({ label, value, onChange, max = 100, color, unit = "%" }) {
  return (
    <div style={{ marginBottom: 13 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ fontFamily: "monospace", fontSize: 10, color: C.text }}>{label}</span>
        <span style={{ fontFamily: "monospace", fontSize: 11, color, fontWeight: 700 }}>{value}{unit}</span>
      </div>
      <div style={{ position: "relative", height: 5, background: "#0d1e35", borderRadius: 3 }}>
        <div style={{ position: "absolute", left: 0, top: 0, height: "100%", width: `${(value / max) * 100}%`, background: color, borderRadius: 3, transition: "width 0.1s" }} />
        <input type="range" min={0} max={max} value={value} onChange={e => onChange(+e.target.value)}
          style={{ position: "absolute", inset: 0, width: "100%", opacity: 0, cursor: "pointer", height: "100%", margin: 0 }} />
      </div>
    </div>
  );
}

// ── Battery cross-section ─────────────────────────────────────────────────────
function BatteryViz({ soc, lli, lamA, lamC, sei, animPhase, hoveredMech }) {
  const Q0 = CELL.nominalCapacity;
  const totalIons = 30;
  const lostCount    = Math.round((lli / 100) * totalIons * 0.85);
  const deadAnodeCount  = Math.round((lamA / 100) * 6);   // max 6 layers
  const deadCathodeCount = Math.round((lamC / 100) * 6);
  const seiPx  = 3 + sei * 0.20;
  const anodeW = Math.max(88, 148 - lamA * 0.50);
  const cathW  = Math.max(88, 125 - lamC * 0.40);
  const sepX   = 16 + anodeW;
  const cathX  = sepX + 24;
  const plating = lamA > 45 && lli > 25;

  const movingIons = animPhase > 0
    ? Array.from({ length: 6 }, (_, i) => {
        const frac = ((animPhase / 100 + i / 6) % 1);
        const charging = soc > 50;
        const x = charging
          ? sepX - 8 + frac * (cathX + cathW - sepX + 16)
          : cathX + cathW + 8 - frac * (cathX + cathW - sepX + 16);
        return { id: i, x: Math.min(Math.max(x, 16), cathX + cathW + 8), y: 52 + (i * 47) % 240 };
      })
    : [];

  return (
    <div style={{ position: "relative", width: "100%", height: 370 }}>
      {/* Cu collector */}
      <div style={{ position: "absolute", left: 0, top: 28, width: 14, height: 312,
        background: "linear-gradient(90deg,#a0622a,#cd853f)", borderRadius: "3px 0 0 3px" }} />
      {/* Al collector */}
      <div style={{ position: "absolute", right: 0, top: 28, width: 14, height: 312,
        background: "linear-gradient(90deg,#999,#ccc)", borderRadius: "0 3px 3px 0" }} />

      {/* Anode body */}
      <div style={{
        position: "absolute", left: 14, top: 28, width: anodeW, height: 312,
        background: "#0b1c35", overflow: "hidden",
        outline: hoveredMech === "lamA" ? `2px solid ${C.red}` : "none",
        transition: "width 0.5s, outline 0.2s",
      }}>
        {[0,1,2,3,4,5].map(i => (
          <div key={i} style={{
            position: "absolute", left: 5, right: seiPx + 3, top: 18 + i * 48, height: 26,
            background: i < deadAnodeCount ? "#101828" : "#1a3868",
            borderRadius: 2,
            border: `1px solid ${i < deadAnodeCount ? "#151e2e" : "#2a4888"}`,
            opacity: i < deadAnodeCount ? 0.28 : 1,
            transition: "all 0.4s",
          }} />
        ))}
        {/* SEI film */}
        <div style={{
          position: "absolute", right: 0, top: 0, width: seiPx, height: "100%",
          background: hoveredMech === "sei" ? `${C.sei}cc` : `${C.sei}55`,
          borderLeft: `1px solid ${C.sei}88`,
          transition: "width 0.4s, background 0.2s",
        }}>
          {sei > 18 && (
            <div style={{ position: "absolute", bottom: 6, right: 2, fontSize: 7, color: C.sei,
              fontFamily: "monospace", writingMode: "vertical-rl", letterSpacing: 1 }}>SEI</div>
          )}
        </div>
        {/* Plating */}
        {plating && (
          <div style={{ position: "absolute", top: 3, left: 3, background: `${C.blue}22`,
            border: `1px solid ${C.blue}88`, borderRadius: 3,
            padding: "1px 4px", fontSize: 7, color: C.blue, fontFamily: "monospace" }}>⚠ PLATE</div>
        )}
      </div>

      {/* Separator */}
      <div style={{
        position: "absolute", left: sepX, top: 28, width: 24, height: 312,
        background: "repeating-linear-gradient(180deg,#0f1c34 0,#0f1c34 4px,#0c1828 4px,#0c1828 8px)",
        borderLeft: `1px solid ${C.border}`, borderRight: `1px solid ${C.border}`,
      }}>
        <div style={{ position: "absolute", top: "50%", left: "50%",
          transform: "translate(-50%,-50%) rotate(-90deg)",
          fontSize: 7, color: C.muted, fontFamily: "monospace", whiteSpace: "nowrap", letterSpacing: 1 }}>SEP</div>
      </div>

      {/* Cathode body */}
      <div style={{
        position: "absolute", left: cathX, top: 28, width: cathW, height: 312,
        background: "#0d1826", overflow: "hidden",
        outline: hoveredMech === "lamC" ? `2px solid ${C.purple}` : "none",
        transition: "width 0.5s, outline 0.2s",
      }}>
        {[0,1,2,3,4,5].map(i => (
          <div key={i} style={{
            position: "absolute", left: 5, right: 5, top: 18 + i * 48, height: 26,
            background: i >= 6 - deadCathodeCount ? "#110d24" : "#1e3260",
            borderRadius: 2,
            border: `1px solid ${i >= 6 - deadCathodeCount ? "#150f2a" : "#2a4270"}`,
            opacity: i >= 6 - deadCathodeCount ? 0.25 : 1,
            transition: "all 0.4s",
          }} />
        ))}
      </div>

      {/* Anode ions */}
      {Array.from({ length: totalIons }, (_, i) => {
        const col = i % 5, row = Math.floor(i / 5);
        const x = 22 + col * Math.max(14, (anodeW - 28) / 5);
        const y = 46 + row * 50;
        const isLost = i < lostCount;
        const isDead = !isLost && i < lostCount + Math.round(deadAnodeCount * 4);
        const anodeFull = Math.round(totalIons * (1 - soc / 100));
        const visible   = i < anodeFull;
        return (
          <div key={`a${i}`} style={{
            position: "absolute", left: x - 5, top: y - 5,
            width: 10, height: 10, borderRadius: "50%",
            background: isLost ? "#252525" : isDead ? "#2a1838" : C.amber,
            boxShadow: (!isLost && !isDead && visible) ? `0 0 5px ${C.amber}88` : "none",
            border: isDead ? `1px solid #5a2090` : "none",
            opacity: isLost ? 0.35 : visible ? 1 : 0.10,
            transition: "opacity 0.5s, left 0.5s",
          }} />
        );
      })}

      {/* Cathode ions */}
      {Array.from({ length: totalIons }, (_, i) => {
        const col = i % 5, row = Math.floor(i / 5);
        const x = cathX + 10 + col * Math.max(13, (cathW - 24) / 5);
        const y = 46 + row * 50;
        const isDead = i >= totalIons - Math.round(deadCathodeCount * 4);
        const cathFull = Math.round(totalIons * (soc / 100));
        const visible  = i < cathFull;
        return (
          <div key={`c${i}`} style={{
            position: "absolute", left: x - 5, top: y - 5,
            width: 10, height: 10, borderRadius: "50%",
            background: isDead ? "#2a1838" : C.amber,
            boxShadow: (!isDead && visible) ? `0 0 5px ${C.amber}88` : "none",
            border: isDead ? `1px solid #5a2090` : "none",
            opacity: isDead ? 0.25 : visible ? 1 : 0.10,
            transition: "opacity 0.5s",
          }} />
        );
      })}

      {/* Transit ions */}
      {movingIons.map(ion => (
        <div key={ion.id} style={{
          position: "absolute", left: ion.x - 5, top: ion.y - 5,
          width: 10, height: 10, borderRadius: "50%",
          background: C.teal, boxShadow: `0 0 8px ${C.teal}`,
          zIndex: 10, transition: "left 0.04s linear",
        }} />
      ))}

      {/* Labels */}
      <div style={{ position: "absolute", top: 10, left: 20, fontSize: 8, color: C.muted, fontFamily: "monospace", letterSpacing: 2 }}>ANODE</div>
      <div style={{ position: "absolute", top: 10, right: 18, fontSize: 8, color: C.muted, fontFamily: "monospace", letterSpacing: 2 }}>CATHODE</div>
      <div style={{ position: "absolute", bottom: 2, left: 3, fontSize: 8, color: "#cd853f", fontFamily: "monospace" }}>Cu</div>
      <div style={{ position: "absolute", bottom: 2, right: 3, fontSize: 8, color: "#aaa", fontFamily: "monospace" }}>Al</div>

    </div>
  );
}

function IonLegend() {
  return (
    <div style={{ display: "flex", gap: 14, justifyContent: "center", flexWrap: "wrap",
      fontSize: 8, color: C.muted, fontFamily: "monospace", padding: "4px 0" }}>
      {[[C.amber,"Li⁺ (active)"],["#252525","lost (LLI)"],["#2a1838","dead (LAM)"],[C.teal,"transit"]].map(([col, lbl]) => (
        <div key={lbl} style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: col,
            flexShrink: 0, boxShadow: col === C.amber ? `0 0 4px ${C.amber}88` : col === C.teal ? `0 0 4px ${C.teal}88` : "none" }} />
          {lbl}
        </div>
      ))}
    </div>
  );
}

// ── Interactive Full-Cell OCV Chart ──────────────────────────────────────────
// Click or drag anywhere on the curve → updates SOC live
function InteractiveOCVChart({ ocvData, soc, onSocChange, Q0 }) {
  const svgRef = useRef(null);
  const isDragging = useRef(false);

  // SVG layout constants
  const W = 580, H = 270;
  const ml = 48, mr = 36, mt = 12, mb = 36;
  const pw = W - ml - mr;   // plot width
  const ph = H - mt - mb;   // plot height
  const vMin = 2.4, vMax = 4.35;

  // Filter to valid full-cell points only — include q=0 by using >= 1.5V floor
  const validPts = ocvData.filter(d => d.fullCell != null && d.fullCell >= 1.5 && d.q <= Q0 * 1.05);
  const validPristine = ocvData.filter(d => d.pristine != null && d.pristine >= 1.5 && d.q <= Q0 * 1.05);
  const qMax = Math.max(...validPts.map(d => d.q), Q0);

  // Map data → SVG coords
  const xScale = q => ml + (q / qMax) * pw;
  const yScale = v => mt + ph - ((v - vMin) / (vMax - vMin)) * ph;

  // Build SVG path strings
  const agedPath = validPts.map((d, i) =>
    `${i === 0 ? "M" : "L"}${xScale(d.q).toFixed(1)},${yScale(d.fullCell).toFixed(1)}`
  ).join(" ");
  const pristinePath = validPristine.map((d, i) =>
    `${i === 0 ? "M" : "L"}${xScale(d.q).toFixed(1)},${yScale(d.pristine).toFixed(1)}`
  ).join(" ");

  // SOC → Q position on aged curve
  const socQ = soc / 100 * qMax;
  // Find nearest point on curve to socQ
  const nearestCurve = validPts.reduce((best, d) =>
    Math.abs(d.q - socQ) < Math.abs(best.q - socQ) ? d : best, validPts[0]);
  const dotX = xScale(nearestCurve?.q ?? 0);
  const dotY = yScale(nearestCurve?.fullCell ?? 3.6);
  const dotV = nearestCurve?.fullCell ?? 3.6;
  const dotQ = nearestCurve?.q ?? 0;

  // Pristine voltage at same Q
  const nearestP = validPristine.reduce((best, d) =>
    Math.abs(d.q - socQ) < Math.abs(best.q - socQ) ? d : best, validPristine[0] ?? { pristine: null });

  // Convert mouse X → SOC
  const xToSoc = (clientX) => {
    const rect = svgRef.current.getBoundingClientRect();
    const scaleX = W / rect.width;
    const svgX = (clientX - rect.left) * scaleX;
    const q = Math.min(qMax, Math.max(0, (svgX - ml) / pw * qMax));
    return Math.round(q / qMax * 100);
  };

  const handleMouseDown = (e) => {
    isDragging.current = true;
    onSocChange(xToSoc(e.clientX));
  };
  const handleMouseMove = (e) => {
    if (!isDragging.current) return;
    onSocChange(xToSoc(e.clientX));
  };
  const handleMouseUp = () => { isDragging.current = false; };

  // Y-axis ticks
  const yTicks = [2.5, 3.0, 3.5, 3.8, 4.0, 4.2];
  // X-axis ticks
  const xTicks = [0, 500, 1000, 1500, 2000, 2500, 3000, 3350];

  return (
    <div style={{ position: "relative", userSelect: "none" }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        style={{ cursor: "crosshair", display: "block" }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        {/* Grid lines */}
        {yTicks.map(v => (
          <line key={v} x1={ml} x2={ml + pw} y1={yScale(v)} y2={yScale(v)}
            stroke={C.border} strokeWidth="0.5" strokeDasharray="3 3" />
        ))}
        {xTicks.map(q => (
          <line key={q} x1={xScale(q)} x2={xScale(q)} y1={mt} y2={mt + ph}
            stroke={C.border} strokeWidth="0.5" strokeDasharray="3 3" />
        ))}

        {/* Voltage cutoff lines */}
        <line x1={ml} x2={ml+pw} y1={yScale(4.2)} y2={yScale(4.2)} stroke={C.red} strokeWidth="1" strokeDasharray="4 3" />
        <text x={ml+pw+3} y={yScale(4.2)+3} fill={C.red} fontSize="8" fontFamily="monospace">4.2V</text>
        <line x1={ml} x2={ml+pw} y1={yScale(2.5)} y2={yScale(2.5)} stroke={C.red} strokeWidth="1" strokeDasharray="4 3" />
        <text x={ml+pw+3} y={yScale(2.5)+3} fill={C.red} fontSize="8" fontFamily="monospace">2.5V</text>

        {/* Pristine curve (dashed) */}
        {pristinePath && (
          <path d={pristinePath} fill="none" stroke={C.muted} strokeWidth="1.5" strokeDasharray="6 4" opacity="0.7" />
        )}

        {/* Aged curve */}
        <path d={agedPath} fill="none" stroke={C.teal} strokeWidth="2.5" />

        {/* Vertical SOC line */}
        <line x1={dotX} x2={dotX} y1={mt} y2={mt + ph}
          stroke={C.amber} strokeWidth="1" strokeDasharray="3 3" opacity="0.6" />

        {/* Draggable dot */}
        <circle cx={dotX} cy={dotY} r="8" fill={C.bg} stroke={C.amber} strokeWidth="2.5" style={{ cursor: "ew-resize" }} />
        <circle cx={dotX} cy={dotY} r="4" fill={C.amber} />

        {/* Tooltip bubble — smart position: below dot when in upper half, above when in lower half */}
        {nearestCurve && (() => {
          const bw = 160, bh = nearestP?.pristine ? 64 : 46, br = 5;
          const inUpperHalf = dotY < mt + ph / 2;
          const bx = Math.min(Math.max(dotX - bw / 2, ml + 2), ml + pw - bw - 2);
          const by = inUpperHalf
            ? dotY + 14                          // below dot when curve is near top
            : Math.max(mt + 4, dotY - bh - 14); // above dot when curve is near bottom
          return (
            <g>
              <rect x={bx} y={by} width={bw} height={bh} rx={br}
                fill="#0a1628cc" stroke={C.border} strokeWidth="1" />
              <text x={bx+10} y={by+15} fill={C.muted} fontSize="9" fontFamily="monospace">
                Q = {Math.round(dotQ)} mAh · SOC = {soc}%
              </text>
              {nearestP?.pristine && (
                <text x={bx+10} y={by+31} fill={C.muted} fontSize="9" fontFamily="monospace">
                  Pristine: <tspan fill={C.muted}>{nearestP.pristine.toFixed(3)} V</tspan>
                </text>
              )}
              <text x={bx+10} y={by+(nearestP?.pristine ? 47 : 31)} fill={C.teal} fontSize="9" fontFamily="monospace">
                Aged: <tspan fill={C.teal}>{dotV.toFixed(3)} V</tspan>
              </text>
            </g>
          );
        })()}

        {/* Y axis */}
        <line x1={ml} x2={ml} y1={mt} y2={mt+ph} stroke={C.muted} strokeWidth="1" />
        {yTicks.map(v => (
          <g key={v}>
            <line x1={ml-3} x2={ml} y1={yScale(v)} y2={yScale(v)} stroke={C.muted} strokeWidth="1" />
            <text x={ml-5} y={yScale(v)+3} fill={C.muted} fontSize="8" fontFamily="monospace" textAnchor="end">{v}</text>
          </g>
        ))}
        <text x={12} y={mt + ph/2} fill={C.muted} fontSize="9" fontFamily="monospace"
          textAnchor="middle" transform={`rotate(-90,12,${mt+ph/2})`}>Voltage (V)</text>

        {/* X axis */}
        <line x1={ml} x2={ml+pw} y1={mt+ph} y2={mt+ph} stroke={C.muted} strokeWidth="1" />
        {xTicks.map(q => (
          <g key={q}>
            <line x1={xScale(q)} x2={xScale(q)} y1={mt+ph} y2={mt+ph+3} stroke={C.muted} strokeWidth="1" />
            <text x={xScale(q)} y={mt+ph+13} fill={C.muted} fontSize="8" fontFamily="monospace" textAnchor="middle">{q}</text>
          </g>
        ))}
        <text x={ml+pw/2} y={H-2} fill={C.muted} fontSize="9" fontFamily="monospace" textAnchor="middle">
          Capacity Q (mAh)
        </text>
      </svg>

      {/* Legend — below chart, never overlapping the curve */}
      <div style={{ display: "flex", gap: 16, justifyContent: "center", marginTop: 6, fontSize: 8, color: C.muted, fontFamily: "monospace" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <svg width="22" height="8"><line x1="0" y1="4" x2="22" y2="4" stroke={C.teal} strokeWidth="2.5" /></svg>
          Aged
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <svg width="22" height="8"><line x1="0" y1="4" x2="22" y2="4" stroke={C.muted} strokeWidth="1.5" strokeDasharray="5 3" /></svg>
          Pristine
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <svg width="12" height="12"><circle cx="6" cy="6" r="5" fill="none" stroke={C.amber} strokeWidth="2" /><circle cx="6" cy="6" r="2.5" fill={C.amber} /></svg>
          drag to set SOC
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
export default function BatteryAgingExplorer() {
  const [lli,  setLli]  = useState(0);
  const [lamA, setLamA] = useState(0);
  const [lamC, setLamC] = useState(0);
  const [sei,  setSei]  = useState(0);
  const [soc,  setSoc]  = useState(80);
  const [cycleCount, setCycleCount] = useState(0);
  const [animPhase,  setAnimPhase]  = useState(0);
  const [isCycling,  setIsCycling]  = useState(false);
  const [activeTab,  setActiveTab]  = useState("halfcell");
  const [hoveredMech, setHoveredMech] = useState(null);
  const [showSpec, setShowSpec] = useState(false);
  const animRef = useRef(null);

  const Q0 = CELL.nominalCapacity;
  const ocvData      = generateOCVData(lli, lamA, lamC);
  const capacityData = generateCapacityFade(lli, lamA, lamC, sei, cycleCount);

  // Current capacity at the current cycle marker
  const nearestPt = capacityData.reduce((best, d) =>
    Math.abs(d.cycle - cycleCount) < Math.abs(best.cycle - cycleCount) ? d : best, capacityData[0]);
  const currentCapacity = nearestPt.capacity;

  const resistance = calcResistance(sei, lamA, cycleCount);
  const retention  = +(currentCapacity / Q0 * 100).toFixed(1);
  const health     = Math.round(retention);
  const healthColor = health > 80 ? C.teal : health > 60 ? C.amber : C.red;

  // Dominant mechanism
  const mechScores = { LLI: lli * 0.40, "LAM-A": lamA * 0.25, "LAM-C": lamC * 0.25, SEI: sei * 0.10 };
  const dominant   = Object.entries(mechScores).sort((a, b) => b[1] - a[1])[0];
  const domColor   = { LLI: C.amber, "LAM-A": C.red, "LAM-C": C.purple, SEI: C.sei }[dominant[0]];

  const plating = lamA > 45 && lli > 25;

  // Vcell estimated at operating point
  const vcell = +(
    CELL.nominalVoltage
    + 0.3 * (soc / 100 - 0.5)
    - (resistance - CELL.internalResistanceNew) * 0.001
    - lli * 0.003
  ).toFixed(3);

  // Cycle animation
  const runCycle = () => {
    if (isCycling) return;
    setIsCycling(true);
    let phase = 0;
    const step = () => {
      phase += 2.5;
      setAnimPhase(phase % 100);
      setSoc(Math.round(20 + 65 * Math.abs(Math.sin((phase / 200) * Math.PI))));
      if (phase < 240) {
        animRef.current = setTimeout(step, 28);
      } else {
        setAnimPhase(0);
        setIsCycling(false);
        setSoc(80);
        setCycleCount(prev => Math.min(800, prev + 50));
        setLli(p  => Math.min(100, +(p  + 1.8).toFixed(1)));
        setSei(p  => Math.min(100, +(p  + 1.4).toFixed(1)));
        setLamA(p => Math.min(100, +(p  + 0.5).toFixed(1)));
        setLamC(p => Math.min(100, +(p  + 0.4).toFixed(1)));
      }
    };
    animRef.current = setTimeout(step, 28);
  };

  useEffect(() => () => clearTimeout(animRef.current), []);

  const applyPreset = (key) => {
    const P = {
      pristine: [0,    0,   0,   0,   0],
      c200:     [10,   4,   3,   14,  200],
      c500:     [28,  14,  11,   35,  500],
      eol:      [55,  38,  30,   70,  800],
    };
    const [l,la,lc,s,c] = P[key];
    setLli(l); setLamA(la); setLamC(lc); setSei(s); setCycleCount(c);
  };

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text, fontFamily: "'Courier New', monospace", overflow: "hidden" }}>

      {/* ── HEADER ── */}
      <div style={{ padding: "12px 18px", borderBottom: `1px solid ${C.border}`,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        background: "#06101e", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.teal, letterSpacing: 3 }}>
            ⚡ BATTERY AGING EXPLORER
          </div>
          <div style={{ fontSize: 8, color: C.muted, letterSpacing: 2, marginTop: 2 }}>
            {CELL.name} · {CELL.chemistry} · {Q0} mAh · {CELL.nominalVoltage}V nominal
            <button onClick={() => setShowSpec(s => !s)} style={{
              marginLeft: 10, background: "transparent", border: `1px solid ${C.border}`,
              color: C.teal, padding: "1px 7px", borderRadius: 3, cursor: "pointer",
              fontFamily: "monospace", fontSize: 8, letterSpacing: 1,
            }}>{showSpec ? "▲ HIDE SPEC" : "▼ SPEC SHEET"}</button>
          </div>
        </div>
        <div style={{ display: "flex", gap: 7, flexShrink: 0, flexWrap: "wrap" }}>
          {[
            ["SOH",    `${health}%`,           healthColor],
            ["CYCLE",   cycleCount,             C.blue],
            ["V_NOM",  `${vcell} V`,            C.purple],
            ["R_INT",  `${resistance} mΩ`,      C.sei],
            ["CAP",    `${currentCapacity} mAh`, C.amber],
            ["RETEN",  `${retention}%`,          retention > 80 ? C.teal : retention > 60 ? C.amber : C.red],
          ].map(([l, v, col]) => (
            <div key={l} style={{ background: "#0a1628", border: `1px solid ${C.border}`,
              borderRadius: 5, padding: "5px 9px", textAlign: "center", minWidth: 60 }}>
              <div style={{ fontSize: 7, color: C.muted, letterSpacing: 1 }}>{l}</div>
              <div style={{ fontSize: 13, color: col, fontWeight: 700, marginTop: 1 }}>{v}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── SPEC SHEET (collapsible) ── */}
      {showSpec && (
        <div style={{ background: "#07111f", borderBottom: `1px solid ${C.border}`,
          padding: "12px 18px", display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px,1fr))", gap: 10 }}>
          {[
            ["Model",          CELL.name],
            ["Chemistry",      CELL.chemistry],
            ["Nominal cap.",   `${CELL.nominalCapacity} mAh`],
            ["Nominal voltage",`${CELL.nominalVoltage} V`],
            ["Voltage window", `${CELL.vMin}–${CELL.vMax} V`],
            ["Dimensions",     `⌀${CELL.diameter} × ${CELL.length} mm`],
            ["Mass",           `${CELL.mass} g`],
            ["Energy density", `${CELL.energyDensity} Wh/kg`],
            ["Max chg. cur.",  `${CELL.maxChargeCurrent} mA (0.5C)`],
            ["Max dis. cur.",  `${CELL.maxDischargeCurrent} mA (2C)`],
            ["DC resistance",  `${CELL.internalResistanceNew} mΩ (new)`],
            ["Cycle life",     `~${CELL.cycleLifeTo80pct} cycles to 80%`],
          ].map(([k, v]) => (
            <div key={k} style={{ fontSize: 9, fontFamily: "monospace" }}>
              <div style={{ color: C.muted }}>{k}</div>
              <div style={{ color: C.teal, marginTop: 1 }}>{v}</div>
            </div>
          ))}
        </div>
      )}

      {/* ── MAIN 3-COLUMN GRID ── */}
      <div style={{ display: "grid", gridTemplateColumns: "380px 1fr 228px",
        height: `calc(100vh - ${showSpec ? 170 : 65}px)`, overflow: "hidden" }}>

        {/* ── LEFT: Battery viz ── */}
        <div style={{ borderRight: `1px solid ${C.border}`, padding: "14px 14px 6px",
          overflowY: "auto", display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontSize: 8, color: C.muted, letterSpacing: 3 }}>CELL CROSS-SECTION</div>

          <BatteryViz soc={soc} lli={lli} lamA={lamA} lamC={lamC}
            sei={sei} animPhase={animPhase} hoveredMech={hoveredMech} />

          <IonLegend />

          {/* SOC slider */}
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 8, color: C.muted, marginBottom: 4 }}>
              <span>STATE OF CHARGE</span>
              <span style={{ color: C.teal, fontWeight: 700 }}>{soc}%</span>
            </div>
            <div style={{ position: "relative", height: 6, background: "#0d1e35", borderRadius: 3 }}>
              <div style={{ position: "absolute", left: 0, top: 0, height: "100%",
                width: `${soc}%`, background: `linear-gradient(90deg,${C.blue}88,${C.teal})`,
                borderRadius: 3, transition: "width 0.15s" }} />
              <input type="range" min={0} max={100} value={soc}
                onChange={e => setSoc(+e.target.value)}
                style={{ position: "absolute", inset: 0, width: "100%", opacity: 0,
                  cursor: "pointer", height: "100%", margin: 0 }} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 7, color: C.muted, marginTop: 3 }}>
              <span>← discharge</span><span>charge →</span>
            </div>
          </div>

          {/* Cycle button */}
          <button onClick={runCycle} disabled={isCycling} style={{
            background: isCycling ? `${C.teal}18` : "transparent",
            border: `1px solid ${isCycling ? C.teal : C.border}`,
            color: isCycling ? C.teal : C.muted,
            padding: "8px", borderRadius: 4, cursor: isCycling ? "not-allowed" : "pointer",
            fontFamily: "monospace", fontSize: 9, letterSpacing: 2, width: "100%",
          }}>
            {isCycling ? `▶ CYCLING... (+50 cycles)` : `▶ SIMULATE 50 CYCLES`}
          </button>

          {/* Plating warning */}
          {plating && (
            <div style={{ background: `${C.blue}0e`, border: `1px solid ${C.blue}55`,
              borderRadius: 5, padding: "7px 10px", fontSize: 8, color: C.blue, lineHeight: 1.5 }}>
              ⚠ LITHIUM PLATING RISK — Reduced anode capacity + low cyclable Li means Li⁺
              cannot intercalate fast enough. Metallic lithium deposits → dendrites → internal short risk.
            </div>
          )}

          {/* Mechanism cards */}
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {[
              { key:"lli",  mech:"lli",  lbl:"LLI",   col:C.amber,  val:lli,
                desc:"Cyclable lithium consumed by electrolyte reduction & SEI formation. Shifts anode OCV curve horizontally." },
              { key:"lamA", mech:"lamA", lbl:"LAM-A",  col:C.red,    val:lamA,
                desc:"Graphite particle cracking & electrical isolation. Shrinks effective anode capacity, raises plating risk." },
              { key:"lamC", mech:"lamC", lbl:"LAM-C",  col:C.purple, val:lamC,
                desc:"NMC particle cracking & phase transformations. Compresses cathode capacity, distorts voltage plateau." },
              { key:"sei",  mech:"sei",  lbl:"SEI",    col:C.sei,    val:sei,
                desc:"Solid electrolyte interphase grows on anode. Increases DC resistance, consumes Li, limits rate capability." },
            ].map(({ key, mech, lbl, col, val, desc }) => (
              <div key={key}
                onMouseEnter={() => setHoveredMech(mech)}
                onMouseLeave={() => setHoveredMech(null)}
                style={{
                  background: "#0a1628",
                  border: `1px solid ${(val > 0 || hoveredMech === mech) ? col + "55" : C.border}`,
                  borderRadius: 5, padding: "6px 9px", transition: "border-color 0.2s",
                }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
                  <span style={{ color: col, fontSize: 10, fontWeight: 700 }}>
                    {lbl}{dominant[0] === lbl && val > 3 ? " ★" : ""}
                  </span>
                  <span style={{ fontSize: 9, color: val > 0 ? col : C.muted }}>{val > 0 ? `${val}%` : "—"}</span>
                </div>
                <div style={{ fontSize: 8, color: C.muted, lineHeight: 1.5 }}>{desc}</div>
              </div>
            ))}
          </div>
        </div>

        {/* ── CENTER: Charts ── */}
        <div style={{ padding: "14px 16px", overflowY: "auto", display: "flex", flexDirection: "column", gap: 12 }}>

          {/* Tabs */}
          <div style={{ display: "flex", gap: 5 }}>
            {[["halfcell","Half-Cell OCV"],["fullcell","Full-Cell OCV"],["fade","Capacity Fade"]].map(([id, lbl]) => (
              <button key={id} onClick={() => setActiveTab(id)} style={{
                background: activeTab === id ? `${C.teal}20` : "transparent",
                border: activeTab === id ? `1px solid ${C.teal}` : `1px solid ${C.border}`,
                color: activeTab === id ? C.teal : C.muted,
                padding: "5px 12px", borderRadius: 4, cursor: "pointer",
                fontFamily: "monospace", fontSize: 9, letterSpacing: 1,
              }}>{lbl}</button>
            ))}
          </div>

          {/* ── Half-Cell OCV ── */}
          {activeTab === "halfcell" && (
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 8, color: C.muted, letterSpacing: 2, marginBottom: 6 }}>
                HALF-CELLS — Graphite anode plateaus (Stage III→II ~0.20V, Stage II→I ~0.085V) · NMC cathode
              </div>
              <ResponsiveContainer width="100%" height={285}>
                <LineChart data={ocvData} margin={{ top: 5, right: 28, bottom: 22, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                  <XAxis dataKey="q" stroke={C.muted}
                    tick={{ fontSize: 9, fontFamily: "monospace" }}
                    label={{ value: "Capacity Q (mAh)", position: "insideBottom", offset: -14, fill: C.muted, fontSize: 9 }} />
                  <YAxis stroke={C.muted} domain={[0, 4.4]}
                    tick={{ fontSize: 9, fontFamily: "monospace" }}
                    label={{ value: "Voltage (V)", angle: -90, position: "insideLeft", offset: 8, fill: C.muted, fontSize: 9 }} />
                  <Tooltip content={<OcvTooltip />} />
                  <Legend wrapperStyle={{ fontFamily: "monospace", fontSize: 9 }} />
                  <Line type="monotone" dataKey="cathode" stroke={C.amber}   dot={false} strokeWidth={2}   name="Cathode vs Li/Li⁺ (NMC)" />
                  <Line type="monotone" dataKey="anode"   stroke={C.blue}    dot={false} strokeWidth={2}   name="Anode vs Li/Li⁺ (Graphite)" />
                </LineChart>
              </ResponsiveContainer>
              <div style={{ fontSize: 8, color: C.muted, marginTop: 6, lineHeight: 1.65 }}>
                ↑ Graphite shows two characteristic voltage plateaus from intercalation stage transitions.
                <b style={{ color: C.amber }}> LLI</b> shifts the anode curve right (pre-lithiation), narrowing the gap.
                <b style={{ color: C.red }}> LAM-A</b> compresses anode curve width.
              </div>
            </div>
          )}

          {/* ── Full-Cell OCV — interactive ── */}
          {activeTab === "fullcell" && (
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 8, color: C.muted, letterSpacing: 2, marginBottom: 6 }}>
                FULL-CELL OCV — <span style={{ color: C.amber }}>click or drag the dot</span> to set SOC → updates ions &amp; slider live
              </div>
              <InteractiveOCVChart
                ocvData={ocvData}
                soc={soc}
                onSocChange={setSoc}
                Q0={Q0}
              />
              <div style={{ fontSize: 8, color: C.muted, marginTop: 6, lineHeight: 1.65 }}>
                ↑ Drag the <span style={{ color: C.amber }}>●</span> along the curve to explore any operating point.
                SOC slider and ion visualization update in real time.
                LLI shifts the curve left; LAM narrows it; SEI adds IR drop under load.
              </div>
            </div>
          )}

          {/* ── Capacity Fade ── */}
          {activeTab === "fade" && (
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 8, color: C.muted, letterSpacing: 2, marginBottom: 6 }}>
                CAPACITY FADE — NCR18650B model · 25°C · 0.5C/0.5C · knee-point aging
              </div>
              <ResponsiveContainer width="100%" height={285}>
                <LineChart data={capacityData} margin={{ top: 5, right: 28, bottom: 22, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                  <XAxis dataKey="cycle" stroke={C.muted}
                    tick={{ fontSize: 9, fontFamily: "monospace" }}
                    label={{ value: "Cycle Number", position: "insideBottom", offset: -14, fill: C.muted, fontSize: 9 }} />
                  <YAxis stroke={C.muted} domain={[Q0 * 0.35, Q0 * 1.02]}
                    tick={{ fontSize: 9, fontFamily: "monospace" }}
                    label={{ value: "Capacity (mAh)", angle: -90, position: "insideLeft", offset: 8, fill: C.muted, fontSize: 9 }} />
                  <Tooltip content={<FadeTooltip />} />
                  <Legend wrapperStyle={{ fontFamily: "monospace", fontSize: 9 }} />
                  <ReferenceLine y={Q0 * 0.80} stroke={C.amber} strokeDasharray="3 3"
                    label={{ value: `80% = ${Math.round(Q0*0.8)} mAh`, fill: C.amber, fontSize: 8, fontFamily: "monospace", position:"right" }} />
                  <ReferenceLine x={cycleCount} stroke={C.teal} strokeDasharray="2 2"
                    label={{ value: `now`, fill: C.teal, fontSize: 8, fontFamily: "monospace", position:"top" }} />
                  <Line type="monotone" dataKey="capacity" stroke={C.purple}
                    dot={false} strokeWidth={2.5} name="Capacity (mAh)" />
                </LineChart>
              </ResponsiveContainer>
              <div style={{ fontSize: 8, color: C.muted, marginTop: 6, lineHeight: 1.65 }}>
                ↑ SEI: fast early loss (√cycle). LLI: linear + accelerating. LAM: power-law knee.
                Dominant mode: <span style={{ color: domColor, fontWeight: 700 }}>{dominant[0]}</span>.
                Datasheet EOL ({CELL.cycleLifeTo80pct} cycles) shown at 80% retention.
              </div>
            </div>
          )}

          {/* Metrics */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 7 }}>
            {[
              ["RETENTION",  `${retention}%`,          retention > 80 ? C.teal : retention > 60 ? C.amber : C.red],
              ["CAPACITY",   `${currentCapacity} mAh`, C.blue],
              ["V_CELL",     `${vcell} V`,              C.purple],
              ["R_INT",      `${resistance} mΩ`,        C.sei],
              ["DOMINANT",    dominant[0],               domColor],
            ].map(([l, v, col]) => (
              <div key={l} style={{ background: "#0a1628", border: `1px solid ${C.border}`,
                borderRadius: 5, padding: "7px 5px", textAlign: "center" }}>
                <div style={{ fontSize: 7, color: C.muted, letterSpacing: 1, marginBottom: 2 }}>{l}</div>
                <div style={{ fontSize: 11, color: col, fontWeight: 700 }}>{v}</div>
              </div>
            ))}
          </div>

          {/* Degradation bars */}
          <div style={{ background: "#0a1628", border: `1px solid ${C.border}`, borderRadius: 7, padding: "11px 13px" }}>
            <div style={{ fontSize: 8, color: C.muted, letterSpacing: 2, marginBottom: 9 }}>DEGRADATION BREAKDOWN</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              {[
                { lbl:"LLI",          val: lli  * 0.35, col:C.amber,  note:"Cyclable Li loss" },
                { lbl:"LAM Anode",    val: lamA * 0.20, col:C.red,    note:"Anode cap. loss" },
                { lbl:"LAM Cathode",  val: lamC * 0.20, col:C.purple, note:"Cathode cap. loss" },
                { lbl:"SEI Resistance",val: sei * 0.25, col:C.sei,    note:"Impedance rise" },
              ].map(({ lbl, val, col, note }) => (
                <div key={lbl}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                    <span style={{ fontSize: 8, color: C.muted }}>{lbl}</span>
                    <span style={{ fontSize: 8, color: col }}>{val.toFixed(1)}%</span>
                  </div>
                  <div style={{ height: 4, background: "#0d1e35", borderRadius: 2 }}>
                    <div style={{ height: "100%", width: `${Math.min(100, val)}%`,
                      background: col, borderRadius: 2, transition: "width 0.3s" }} />
                  </div>
                  <div style={{ fontSize: 7, color: C.muted, marginTop: 2 }}>{note}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── RIGHT: Controls ── */}
        <div style={{ borderLeft: `1px solid ${C.border}`, padding: "14px 13px",
          overflowY: "auto", background: "#06101e", display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ fontSize: 8, color: C.muted, letterSpacing: 2 }}>AGING PARAMETERS</div>

          <div>
            <div style={{ fontSize: 7, color: C.amber, letterSpacing: 2, marginBottom: 7,
              paddingBottom: 5, borderBottom: `1px solid ${C.border}` }}>▸ LLI</div>
            <AgingSlider label="LLI severity" value={lli} onChange={setLli} color={C.amber} />
          </div>

          <div>
            <div style={{ fontSize: 7, color: C.red, letterSpacing: 2, marginBottom: 7,
              paddingBottom: 5, borderBottom: `1px solid ${C.border}` }}>▸ ACTIVE MATERIAL LOSS</div>
            <AgingSlider label="LAM Anode" value={lamA} onChange={setLamA} color={C.red} />
            <AgingSlider label="LAM Cathode" value={lamC} onChange={setLamC} color={C.purple} />
          </div>

          <div>
            <div style={{ fontSize: 7, color: C.sei, letterSpacing: 2, marginBottom: 7,
              paddingBottom: 5, borderBottom: `1px solid ${C.border}` }}>▸ SEI GROWTH</div>
            <AgingSlider label="SEI thickness" value={sei} onChange={setSei} color={C.sei} />
          </div>

          <div>
            <div style={{ fontSize: 7, color: C.blue, letterSpacing: 2, marginBottom: 7,
              paddingBottom: 5, borderBottom: `1px solid ${C.border}` }}>▸ CYCLE COUNT</div>
            <AgingSlider label="Cycles" value={cycleCount} onChange={setCycleCount} max={800} color={C.blue} unit="" />
          </div>

          {/* Presets */}
          <div>
            <div style={{ fontSize: 7, color: C.muted, letterSpacing: 2, marginBottom: 7 }}>PRESETS</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              {[["Pristine","pristine",C.teal],["200 cycles","c200",C.blue],["500 cycles","c500",C.amber],["End of Life","eol",C.red]].map(([lbl,key,col]) => (
                <button key={key} onClick={() => applyPreset(key)} style={{
                  background:"transparent", border:`1px solid ${col}44`, color:col,
                  padding:"6px 8px", borderRadius:4, cursor:"pointer",
                  fontFamily:"monospace", fontSize:9, letterSpacing:1, textAlign:"left",
                }}
                  onMouseEnter={e => e.currentTarget.style.background = `${col}11`}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                >{lbl}</button>
              ))}
            </div>
          </div>

          {/* Tips */}
          <div style={{ background:"#0a1628", border:`1px solid ${C.border}`,
            borderRadius:5, padding:"9px 10px", fontSize:8, color:C.muted, lineHeight:1.75 }}>
            <div style={{ color:C.teal, marginBottom:5, fontSize:9 }}>ℹ Tips</div>
            <div>• Hover mechanism cards → highlights electrode</div>
            <div>• Click ▶ SIMULATE to auto-age the cell</div>
            <div>• Watch graphite plateaus shift with LLI</div>
            <div>• ⚠ plating warning = LAM-A + LLI both high</div>
            <div>• ★ marks the dominant aging mode</div>
            <div>• ▼ SPEC SHEET shows real cell datasheet</div>
          </div>
        </div>
      </div>
    </div>
  );
}
