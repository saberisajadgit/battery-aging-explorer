import { useState, useEffect, useRef } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer, ReferenceLine, ReferenceDot
} from "recharts";

const C = {
  bg: "#050d1a", panel: "#0a1628", border: "#1a2d4a",
  teal: "#00e5c8", amber: "#ffaa00", red: "#ff4060",
  purple: "#b060ff", blue: "#3090ff", text: "#c8daf0",
  muted: "#4a6080", sei: "#ff6a1a", lliLost: "#333",
};

// ── Realistic graphite anode OCV (two-plateau shape) ──────────────────────────
function anodeOCV(soc) {
  // Graphite has characteristic plateaus at ~0.1V and ~0.2V
  if (soc <= 0) return 1.5;
  if (soc >= 1) return 0.07;
  // Stage transitions produce plateaus
  const s = soc;
  if (s < 0.08) return 1.5 - s * 15;
  if (s < 0.18) return 0.28 - (s - 0.08) * 0.6;
  if (s < 0.25) return 0.22 - (s - 0.18) * 0.28;
  if (s < 0.50) return 0.205 - (s - 0.25) * 0.16;  // long plateau ~0.20V
  if (s < 0.70) return 0.165 - (s - 0.50) * 0.30;
  if (s < 0.85) return 0.105 - (s - 0.70) * 0.20;  // plateau ~0.10V
  return 0.075 - (s - 0.85) * 0.033;
}

// ── Realistic NMC cathode OCV ─────────────────────────────────────────────────
function cathodeOCV(soc) {
  if (soc <= 0) return 2.8;
  if (soc >= 1) return 4.22;
  const s = soc;
  // S-curve with shoulder around 0.5
  return 3.55 + 0.4 * Math.tanh((s - 0.15) * 6)
    + 0.25 * Math.tanh((s - 0.65) * 5)
    + 0.12 * s;
}

function generateOCVData(lli, lamA, lamC) {
  const points = [];
  const pristineQ = 170;
  const anodeCap = pristineQ * (1 - lamA * 0.006);
  const cathodeCap = pristineQ * (1 - lamC * 0.006);
  const lliShift = lli * 1.0; // mAh shifted on anode

  for (let q = 0; q <= 200; q += 2) {
    // Cathode SOC: starts from lliShift
    const cathSOC = Math.min(1, Math.max(0, q / cathodeCap));
    const cath = cathodeOCV(cathSOC);

    // Anode SOC: LLI means anode is pre-lithiated — shift its SOC reference
    const anodeSOC = Math.min(1, Math.max(0, (q + lliShift) / anodeCap));
    const an = anodeOCV(anodeSOC);

    const full = Math.max(0, +(cath - an).toFixed(3));
    points.push({
      q,
      anode: +an.toFixed(3),
      cathode: +cath.toFixed(3),
      fullCell: full > 2 ? full : null,
      pristine: q < pristineQ ? +(cathodeOCV(q / pristineQ) - anodeOCV(q / pristineQ)).toFixed(3) : null,
    });
  }
  return points;
}

// ── Capacity fade with knee effect ───────────────────────────────────────────
function generateCapacityFade(lli, lamA, lamC, sei, currentCycle) {
  const points = [];
  for (let cycle = 0; cycle <= 1000; cycle += 10) {
    // SEI: fast early growth (logarithmic)
    const seiLoss = (sei / 100) * 18 * Math.log1p(cycle) / Math.log1p(1000);
    // LLI: roughly linear with acceleration
    const lliLoss = (lli / 100) * 35 * (cycle / 1000) * (1 + 0.8 * Math.pow(cycle / 1000, 2));
    // LAM: slow then accelerating (knee)
    const lamLoss = ((lamA + lamC) / 200) * 28 * Math.pow(cycle / 1000, 1.6);
    const cap = Math.max(40, 169.8 - seiLoss - lliLoss - lamLoss);
    points.push({ cycle, capacity: +cap.toFixed(1), isCurrent: cycle <= currentCycle && cycle + 10 > currentCycle });
  }
  return points;
}

// ── Internal resistance ───────────────────────────────────────────────────────
function calcResistance(sei, cycle) {
  return +(5 + sei * 0.8 + cycle * 0.015).toFixed(1); // mΩ
}

// ── Tooltip ───────────────────────────────────────────────────────────────────
const ChartTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: "#0a1628ee", border: `1px solid ${C.border}`, padding: "8px 12px", borderRadius: 6, fontFamily: "monospace", fontSize: 11 }}>
      <div style={{ color: C.muted, marginBottom: 4 }}>{typeof label === "number" && label > 20 ? `Cycle ${label}` : `Q = ${label} mAh`}</div>
      {payload.filter(p => p.value != null).map(p => (
        <div key={p.dataKey} style={{ color: p.color }}>{p.name}: <span style={{ color: C.text }}>{p.value}V</span></div>
      ))}
    </div>
  );
};

// ── Slider ────────────────────────────────────────────────────────────────────
function AgingSlider({ label, value, onChange, max = 100, color, unit = "%" }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ fontFamily: "monospace", fontSize: 10, color: C.text, letterSpacing: 1 }}>{label}</span>
        <span style={{ fontFamily: "monospace", fontSize: 11, color, fontWeight: 700 }}>{value}{unit}</span>
      </div>
      <div style={{ position: "relative", height: 5, background: "#0d1e35", borderRadius: 3 }}>
        <div style={{ position: "absolute", left: 0, top: 0, height: "100%", width: `${(value / max) * 100}%`, background: color, borderRadius: 3, transition: "width 0.1s" }} />
        <input type="range" min={0} max={max} value={value} onChange={e => onChange(+e.target.value)}
          style={{ position: "absolute", inset: 0, width: "100%", opacity: 0, cursor: "pointer", height: "100%" }} />
      </div>
    </div>
  );
}

// ── Battery cross-section ─────────────────────────────────────────────────────
function BatteryViz({ soc, lli, lamA, lamC, sei, animPhase, hoveredMech }) {
  const totalIons = 30;
  const lostCount = Math.round(lli * 0.28);
  const deadAnodeCount = Math.round(lamA * 0.12);
  const deadCathodeCount = Math.round(lamC * 0.12);
  const seiPx = 3 + sei * 0.22;
  const anodeW = Math.max(90, 155 - lamA * 0.5);
  const cathodeW = Math.max(90, 130 - lamC * 0.45);
  const sepX = 18 + anodeW;
  const cathX = sepX + 26;
  const platingRisk = lamA > 50 && lli > 30;

  // Animate ions across separator
  const movingIons = animPhase > 0
    ? Array.from({ length: 5 }, (_, i) => {
        const frac = ((animPhase / 100 + i / 5) % 1);
        const x = soc > 50
          ? sepX - 10 + frac * (cathX + cathodeW - sepX + 20) // charge: left→right
          : cathX + cathodeW - frac * (cathX + cathodeW - sepX + 20); // discharge: right→left
        return { id: i, x, y: 100 + (i * 53) % 240 };
      })
    : [];

  return (
    <div style={{ position: "relative", width: "100%", height: 380 }}>
      {/* Cu current collector */}
      <div style={{ position: "absolute", left: 0, top: 30, width: 16, height: 320, background: "#b87333", borderRadius: "3px 0 0 3px" }} />
      {/* Al current collector */}
      <div style={{ position: "absolute", right: 0, top: 30, width: 16, height: 320, background: "#aaaaaa", borderRadius: "0 3px 3px 0" }} />

      {/* Anode */}
      <div style={{
        position: "absolute", left: 16, top: 30, width: anodeW, height: 320,
        background: "#0b1c35",
        outline: hoveredMech === "lamA" ? `2px solid ${C.red}` : "none",
        transition: "width 0.5s, outline 0.2s",
        overflow: "hidden",
      }}>
        {[0,1,2,3,4,5].map(i => (
          <div key={i} style={{
            position: "absolute", left: 4, right: 4, top: 20 + i * 50, height: 26,
            background: i < deadAnodeCount ? C.lam : "#183060",
            borderRadius: 2,
            border: `1px solid ${i < deadAnodeCount ? "#1a2a3a" : "#2a4a8a"}`,
            opacity: i < deadAnodeCount ? 0.35 : 1,
            transition: "all 0.4s",
          }} />
        ))}
        {/* SEI layer */}
        <div style={{
          position: "absolute", right: 0, top: 0, width: seiPx, height: "100%",
          background: hoveredMech === "sei" ? `${C.sei}cc` : `${C.sei}66`,
          borderLeft: `1px solid ${C.sei}`,
          transition: "width 0.4s, background 0.2s",
        }}>
          {sei > 15 && <div style={{ position: "absolute", bottom: 6, right: 2, fontSize: 8, color: C.sei, fontFamily: "monospace", writingMode: "vertical-rl" }}>SEI</div>}
        </div>
        {/* Plating indicator */}
        {platingRisk && (
          <div style={{ position: "absolute", top: 4, left: 4, background: `${C.blue}33`, border: `1px solid ${C.blue}`, borderRadius: 3, padding: "2px 4px", fontSize: 8, color: C.blue, fontFamily: "monospace" }}>⚠ PLATE</div>
        )}
      </div>

      {/* Separator */}
      <div style={{
        position: "absolute", left: sepX, top: 30, width: 26, height: 320,
        background: "repeating-linear-gradient(180deg,#101e38 0px,#101e38 4px,#0d1a30 4px,#0d1a30 8px)",
        borderLeft: `1px solid ${C.border}`, borderRight: `1px solid ${C.border}`,
      }}>
        <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%) rotate(-90deg)", fontSize: 7, color: C.muted, fontFamily: "monospace", whiteSpace: "nowrap", letterSpacing: 2 }}>SEP</div>
      </div>

      {/* Cathode */}
      <div style={{
        position: "absolute", left: cathX, top: 30, width: cathodeW, height: 320,
        background: "#0d1826",
        outline: hoveredMech === "lamC" ? `2px solid ${C.purple}` : "none",
        transition: "width 0.5s, outline 0.2s",
        overflow: "hidden",
      }}>
        {[0,1,2,3,4,5].map(i => (
          <div key={i} style={{
            position: "absolute", left: 4, right: 4, top: 20 + i * 50, height: 26,
            background: i >= 6 - deadCathodeCount ? "#1a1a2e" : "#1e3060",
            borderRadius: 2,
            border: `1px solid ${i >= 6 - deadCathodeCount ? "#1a1a2e" : "#2a4070"}`,
            opacity: i >= 6 - deadCathodeCount ? 0.3 : 1,
            transition: "all 0.4s",
          }} />
        ))}
      </div>

      {/* Static ions — anode */}
      {Array.from({ length: totalIons }, (_, i) => {
        const col = i % 5, row = Math.floor(i / 5);
        const x = 24 + col * Math.max(16, (anodeW - 30) / 5);
        const y = 48 + row * 52;
        const isLost = i < lostCount;
        const isDead = !isLost && i < lostCount + deadAnodeCount;
        // SOC: ions in anode decrease as SOC goes up (move to cathode)
        const anodeFilled = Math.round(totalIons * (1 - soc / 100));
        const visible = i < anodeFilled;
        return (
          <div key={`a${i}`} style={{
            position: "absolute", left: x - 5, top: y - 5,
            width: 10, height: 10, borderRadius: "50%",
            background: isLost ? "#2a2a2a" : isDead ? "#2a1a3a" : C.amber,
            boxShadow: (!isLost && !isDead && visible) ? `0 0 5px ${C.amber}88` : "none",
            border: isDead ? `1px solid #5a2090` : "none",
            opacity: isLost ? 0.4 : visible ? 1 : 0.12,
            transition: "all 0.6s ease",
          }} />
        );
      })}

      {/* Static ions — cathode */}
      {Array.from({ length: totalIons }, (_, i) => {
        const col = i % 5, row = Math.floor(i / 5);
        const x = cathX + 10 + col * Math.max(14, (cathodeW - 25) / 5);
        const y = 48 + row * 52;
        const isDead = i >= totalIons - deadCathodeCount;
        const cathFilled = Math.round(totalIons * (soc / 100));
        const visible = i < cathFilled;
        return (
          <div key={`c${i}`} style={{
            position: "absolute", left: x - 5, top: y - 5,
            width: 10, height: 10, borderRadius: "50%",
            background: isDead ? "#2a1a3a" : C.amber,
            boxShadow: (!isDead && visible) ? `0 0 5px ${C.amber}88` : "none",
            border: isDead ? `1px solid #5a2090` : "none",
            opacity: isDead ? 0.3 : visible ? 1 : 0.12,
            transition: "all 0.6s ease",
          }} />
        );
      })}

      {/* Animated transit ions */}
      {movingIons.map(ion => (
        <div key={ion.id} style={{
          position: "absolute", left: Math.min(ion.x - 5, 390), top: ion.y - 5,
          width: 10, height: 10, borderRadius: "50%",
          background: C.teal, boxShadow: `0 0 8px ${C.teal}`,
          transition: "left 0.05s linear",
          zIndex: 10,
        }} />
      ))}

      {/* Labels */}
      <div style={{ position: "absolute", top: 10, left: 24, fontSize: 9, color: C.muted, fontFamily: "monospace", letterSpacing: 2 }}>ANODE</div>
      <div style={{ position: "absolute", top: 10, left: cathX + 4, fontSize: 9, color: C.muted, fontFamily: "monospace", letterSpacing: 2 }}>CATHODE</div>
      <div style={{ position: "absolute", bottom: 4, left: 4, fontSize: 8, color: "#b87333", fontFamily: "monospace" }}>Cu</div>
      <div style={{ position: "absolute", bottom: 4, right: 4, fontSize: 8, color: "#aaaaaa", fontFamily: "monospace" }}>Al</div>

      {/* Legend */}
      <div style={{ position: "absolute", bottom: 4, left: "50%", transform: "translateX(-50%)", display: "flex", gap: 12, fontSize: 8, color: C.muted, fontFamily: "monospace", whiteSpace: "nowrap" }}>
        {[[C.amber, "Li⁺"], ["#2a2a2a", "lost (LLI)"], ["#2a1a3a", "dead (LAM)"], [C.teal, "transit"]].map(([color, label]) => (
          <div key={label} style={{ display: "flex", alignItems: "center", gap: 3 }}>
            <div style={{ width: 7, height: 7, borderRadius: "50%", background: color, flexShrink: 0 }} />
            {label}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────
export default function BatteryAgingExplorer() {
  const [lli, setLli] = useState(0);
  const [lamA, setLamA] = useState(0);
  const [lamC, setLamC] = useState(0);
  const [sei, setSei] = useState(0);
  const [soc, setSoc] = useState(79);
  const [cycleCount, setCycleCount] = useState(0);
  const [animPhase, setAnimPhase] = useState(0);
  const [isCycling, setIsCycling] = useState(false);
  const [activeTab, setActiveTab] = useState("halfcell");
  const [hoveredMech, setHoveredMech] = useState(null);
  const animRef = useRef(null);

  const ocvData = generateOCVData(lli, lamA, lamC);
  const capacityData = generateCapacityFade(lli, lamA, lamC, sei, cycleCount);
  const currentCapacity = capacityData.find(d => d.cycle <= cycleCount && d.cycle + 10 > cycleCount)?.capacity ?? 169.8;
  const resistance = calcResistance(sei, cycleCount);
  const vcell = +(3.97 - lli * 0.004 - sei * 0.006 - (lamA + lamC) * 0.003 - resistance * 0.001).toFixed(2);
  const health = Math.max(0, Math.round(currentCapacity / 169.8 * 100));
  const healthColor = health > 80 ? C.teal : health > 60 ? C.amber : C.red;
  const retention = health;

  // Dominant mechanism
  const mechScores = { LLI: lli * 0.4, "LAM-A": lamA * 0.25, "LAM-C": lamC * 0.25, SEI: sei * 0.1 };
  const dominant = Object.entries(mechScores).sort((a, b) => b[1] - a[1])[0];
  const dominantColor = { LLI: C.amber, "LAM-A": C.red, "LAM-C": C.purple, SEI: C.sei }[dominant[0]];

  // Lithium plating risk
  const platingRisk = lamA > 50 && lli > 30;

  // Cycle animation
  const runCycle = () => {
    if (isCycling) return;
    setIsCycling(true);
    let phase = 0;
    const step = () => {
      phase += 3;
      setAnimPhase(phase % 100);
      setSoc(prev => {
        // oscillate SOC during cycling
        const t = phase / 100;
        return Math.round(20 + 60 * Math.abs(Math.sin(t * Math.PI)));
      });
      if (phase < 200) {
        animRef.current = setTimeout(step, 30);
      } else {
        setAnimPhase(0);
        setIsCycling(false);
        setSoc(79);
        setCycleCount(prev => {
          const next = Math.min(1000, prev + 50);
          // Auto-increment aging params slightly
          setLli(p => Math.min(100, p + 1.5));
          setSei(p => Math.min(100, p + 1.2));
          setLamA(p => Math.min(100, p + 0.4));
          setLamC(p => Math.min(100, p + 0.3));
          return next;
        });
      }
    };
    animRef.current = setTimeout(step, 30);
  };

  useEffect(() => () => clearTimeout(animRef.current), []);

  const applyPreset = (preset) => {
    const presets = {
      pristine: [0, 0, 0, 0, 0],
      "200": [8, 4, 3, 12, 200],
      "500": [22, 12, 10, 30, 500],
      eol: [50, 35, 28, 65, 1000],
    };
    const [l, la, lc, s, c] = presets[preset];
    setLli(l); setLamA(la); setLamC(lc); setSei(s); setCycleCount(c);
  };

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text, fontFamily: "'Courier New', monospace" }}>

      {/* Header */}
      <div style={{ padding: "14px 20px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", background: "#07111f", gap: 12 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.teal, letterSpacing: 3 }}>⚡ BATTERY AGING EXPLORER</div>
          <div style={{ fontSize: 9, color: C.muted, letterSpacing: 2, marginTop: 2 }}>Li-Ion · LLI · LAM · SEI · Real OCV Physics</div>
        </div>
        <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
          {[["SOH", `${health}%`, healthColor], ["CYCLE", cycleCount, C.blue], ["V_CELL", `${vcell}V`, C.purple], ["R_INT", `${resistance}mΩ`, C.sei], ["CAP", `${currentCapacity}mAh`, C.amber]].map(([l, v, c]) => (
            <div key={l} style={{ background: "#0a1628", border: `1px solid ${C.border}`, borderRadius: 5, padding: "6px 10px", textAlign: "center" }}>
              <div style={{ fontSize: 8, color: C.muted, letterSpacing: 2 }}>{l}</div>
              <div style={{ fontSize: 14, color: c, fontWeight: 700, marginTop: 2 }}>{v}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Main 3-col grid */}
      <div style={{ display: "grid", gridTemplateColumns: "390px 1fr 230px", height: "calc(100vh - 65px)", overflow: "hidden" }}>

        {/* LEFT: Battery */}
        <div style={{ borderRight: `1px solid ${C.border}`, padding: "16px 16px 8px", overflowY: "auto", display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ fontSize: 9, color: C.muted, letterSpacing: 3 }}>CELL CROSS-SECTION</div>

          <BatteryViz soc={soc} lli={lli} lamA={lamA} lamC={lamC} sei={sei} animPhase={animPhase} hoveredMech={hoveredMech} />

          {/* SOC slider */}
          <div style={{ marginTop: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: C.muted, marginBottom: 4 }}>
              <span>STATE OF CHARGE</span>
              <span style={{ color: C.teal }}>{soc}%</span>
            </div>
            <div style={{ position: "relative", height: 6, background: "#0d1e35", borderRadius: 3 }}>
              <div style={{ position: "absolute", left: 0, top: 0, height: "100%", width: `${soc}%`, background: `linear-gradient(90deg,${C.blue}88,${C.teal})`, borderRadius: 3, transition: "width 0.15s" }} />
              <input type="range" min={0} max={100} value={soc} onChange={e => setSoc(+e.target.value)}
                style={{ position: "absolute", inset: 0, width: "100%", opacity: 0, cursor: "pointer", height: "100%" }} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 8, color: C.muted, marginTop: 3 }}>
              <span>← discharge</span><span>charge →</span>
            </div>
          </div>

          {/* Cycle button */}
          <button onClick={runCycle} disabled={isCycling} style={{
            background: isCycling ? `${C.teal}22` : "transparent",
            border: `1px solid ${isCycling ? C.teal : C.border}`,
            color: isCycling ? C.teal : C.muted,
            padding: "8px", borderRadius: 4, cursor: isCycling ? "not-allowed" : "pointer",
            fontFamily: "monospace", fontSize: 9, letterSpacing: 2, width: "100%",
            transition: "all 0.3s",
          }}>
            {isCycling ? `▶ CYCLING... (+50 cycles)` : `▶ SIMULATE 50 CYCLES`}
          </button>

          {/* Plating warning */}
          {platingRisk && (
            <div style={{ background: `${C.blue}11`, border: `1px solid ${C.blue}55`, borderRadius: 5, padding: "8px 10px", fontSize: 9, color: C.blue }}>
              ⚠ LITHIUM PLATING RISK — High LAM-A with LLI loss means anode can't accept Li⁺ fast enough. Metallic Li deposits on surface → dendrites → safety hazard.
            </div>
          )}

          {/* Mechanism cards */}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {[
              { key: "lli", mech: "lli", label: "LLI", color: C.amber, val: lli, desc: "Li inventory loss via side reactions & SEI formation. Horizontally shifts anode curve." },
              { key: "lamA", mech: "lamA", label: "LAM-A", color: C.red, val: lamA, desc: "Graphite cracking & particle isolation. Shrinks anode capacity, raises plating risk." },
              { key: "lamC", mech: "lamC", label: "LAM-C", color: C.purple, val: lamC, desc: "Cathode oxide degradation. Compresses voltage plateau, reduces energy density." },
              { key: "sei", mech: "sei", label: "SEI", color: C.sei, val: sei, desc: "Solid electrolyte interphase grows on anode surface. Raises resistance, consumes Li." },
            ].map(({ key, mech, label, color, val, desc }) => (
              <div key={key}
                onMouseEnter={() => setHoveredMech(mech)}
                onMouseLeave={() => setHoveredMech(null)}
                style={{
                  background: "#0a1628", border: `1px solid ${val > 0 || hoveredMech === mech ? color + "55" : C.border}`,
                  borderRadius: 5, padding: "7px 10px", cursor: "default", transition: "border-color 0.2s",
                }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                  <span style={{ color, fontSize: 10, fontWeight: 700 }}>{label} {dominant[0] === label && val > 5 ? "★" : ""}</span>
                  <span style={{ color: val > 0 ? color : C.muted, fontSize: 10 }}>{val > 0 ? `${val}%` : "—"}</span>
                </div>
                <div style={{ fontSize: 8, color: C.muted, lineHeight: 1.5 }}>{desc}</div>
              </div>
            ))}
          </div>
        </div>

        {/* CENTER: Charts */}
        <div style={{ padding: "16px", overflowY: "auto", display: "flex", flexDirection: "column", gap: 14 }}>

          {/* Tab bar */}
          <div style={{ display: "flex", gap: 6 }}>
            {[["halfcell", "Half-Cell OCV"], ["fullcell", "Full-Cell OCV"], ["fade", "Capacity Fade"]].map(([id, label]) => (
              <button key={id} onClick={() => setActiveTab(id)} style={{
                background: activeTab === id ? `${C.teal}22` : "transparent",
                border: activeTab === id ? `1px solid ${C.teal}` : `1px solid ${C.border}`,
                color: activeTab === id ? C.teal : C.muted,
                padding: "5px 12px", borderRadius: 4, cursor: "pointer",
                fontFamily: "monospace", fontSize: 9, letterSpacing: 1,
              }}>{label}</button>
            ))}
          </div>

          {activeTab === "halfcell" && (
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 9, color: C.muted, letterSpacing: 2, marginBottom: 6 }}>
                HALF-CELLS — realistic graphite plateaus · NMC cathode · gap = V_cell
              </div>
              <ResponsiveContainer width="100%" height={290}>
                <LineChart data={ocvData} margin={{ top: 5, right: 30, bottom: 20, left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                  <XAxis dataKey="q" stroke={C.muted} tick={{ fontSize: 9, fontFamily: "monospace" }} label={{ value: "Capacity Q (mAh)", position: "insideBottom", offset: -12, fill: C.muted, fontSize: 9 }} />
                  <YAxis stroke={C.muted} tick={{ fontSize: 9, fontFamily: "monospace" }} domain={[0, 4.5]} label={{ value: "Voltage (V)", angle: -90, position: "insideLeft", fill: C.muted, fontSize: 9 }} />
                  <Tooltip content={<ChartTooltip />} />
                  <Legend wrapperStyle={{ fontFamily: "monospace", fontSize: 9, color: C.muted }} />
                  <Line type="monotone" dataKey="cathode" stroke={C.amber} dot={false} strokeWidth={2} name="Cathode (NMC)" />
                  <Line type="monotone" dataKey="anode" stroke={C.blue} dot={false} strokeWidth={2} name="Anode (Graphite)" />
                </LineChart>
              </ResponsiveContainer>
              <div style={{ fontSize: 8, color: C.muted, marginTop: 4, lineHeight: 1.6 }}>
                ↑ Graphite shows two characteristic plateaus (~0.10V, ~0.20V) from lithiation stage transitions (LiC₁₂→LiC₆).
                LLI shifts the anode curve right relative to cathode — the gap (full cell voltage) narrows.
              </div>
            </div>
          )}

          {activeTab === "fullcell" && (
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 9, color: C.muted, letterSpacing: 2, marginBottom: 6 }}>FULL-CELL OCV — aged vs pristine</div>
              <ResponsiveContainer width="100%" height={290}>
                <LineChart data={ocvData} margin={{ top: 5, right: 30, bottom: 20, left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                  <XAxis dataKey="q" stroke={C.muted} tick={{ fontSize: 9, fontFamily: "monospace" }} label={{ value: "Capacity Q (mAh)", position: "insideBottom", offset: -12, fill: C.muted, fontSize: 9 }} />
                  <YAxis stroke={C.muted} tick={{ fontSize: 9, fontFamily: "monospace" }} domain={[2.5, 4.4]} label={{ value: "Voltage (V)", angle: -90, position: "insideLeft", fill: C.muted, fontSize: 9 }} />
                  <Tooltip content={<ChartTooltip />} />
                  <Legend wrapperStyle={{ fontFamily: "monospace", fontSize: 9 }} />
                  <ReferenceLine y={4.2} stroke={C.red} strokeDasharray="3 3" label={{ value: "4.2V", fill: C.red, fontSize: 8, fontFamily: "monospace" }} />
                  <ReferenceLine y={3.0} stroke={C.red} strokeDasharray="3 3" label={{ value: "3.0V", fill: C.red, fontSize: 8, fontFamily: "monospace" }} />
                  <Line type="monotone" dataKey="pristine" stroke={C.muted} dot={false} strokeWidth={1.5} strokeDasharray="5 3" name="Pristine" connectNulls />
                  <Line type="monotone" dataKey="fullCell" stroke={C.teal} dot={false} strokeWidth={2.5} name="Aged" connectNulls />
                </LineChart>
              </ResponsiveContainer>
              <div style={{ fontSize: 8, color: C.muted, marginTop: 4, lineHeight: 1.6 }}>
                ↑ Dashed = pristine cell. Aging compresses capacity to the left and can distort plateau shape.
                LAM flattens the curve; LLI shifts it; SEI adds IR drop (voltage offset under load).
              </div>
            </div>
          )}

          {activeTab === "fade" && (
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 9, color: C.muted, letterSpacing: 2, marginBottom: 6 }}>CAPACITY FADE — knee point model</div>
              <ResponsiveContainer width="100%" height={290}>
                <LineChart data={capacityData} margin={{ top: 5, right: 30, bottom: 20, left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                  <XAxis dataKey="cycle" stroke={C.muted} tick={{ fontSize: 9, fontFamily: "monospace" }} label={{ value: "Cycle Number", position: "insideBottom", offset: -12, fill: C.muted, fontSize: 9 }} />
                  <YAxis stroke={C.muted} tick={{ fontSize: 9, fontFamily: "monospace" }} domain={[40, 175]} label={{ value: "Capacity (mAh)", angle: -90, position: "insideLeft", fill: C.muted, fontSize: 9 }} />
                  <Tooltip content={<ChartTooltip />} />
                  <ReferenceLine y={169.8 * 0.8} stroke={C.amber} strokeDasharray="3 3" label={{ value: "80% EOL", fill: C.amber, fontSize: 8, fontFamily: "monospace" }} />
                  <ReferenceLine x={cycleCount} stroke={C.teal} strokeDasharray="2 2" label={{ value: `← now (${cycleCount})`, fill: C.teal, fontSize: 8, fontFamily: "monospace" }} />
                  <Line type="monotone" dataKey="capacity" stroke={C.purple} dot={false} strokeWidth={2.5} name="Capacity (mAh)" />
                </LineChart>
              </ResponsiveContainer>
              <div style={{ fontSize: 8, color: C.muted, marginTop: 4, lineHeight: 1.6 }}>
                ↑ SEI dominates early fade (logarithmic). LLI accelerates mid-life. LAM triggers the "knee" —
                sudden acceleration near end of life. Dominant mode here: <span style={{ color: dominantColor }}>{dominant[0]}</span>.
              </div>
            </div>
          )}

          {/* Metrics row */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 8 }}>
            {[
              ["RETENTION", `${retention}%`, retention > 80 ? C.teal : retention > 60 ? C.amber : C.red],
              ["CAPACITY", `${currentCapacity}mAh`, C.blue],
              ["V_CELL", `${vcell}V`, C.purple],
              ["R_INT", `${resistance}mΩ`, C.sei],
              ["DOMINANT", dominant[0], dominantColor],
            ].map(([l, v, c]) => (
              <div key={l} style={{ background: "#0a1628", border: `1px solid ${C.border}`, borderRadius: 5, padding: "8px 6px", textAlign: "center" }}>
                <div style={{ fontSize: 7, color: C.muted, letterSpacing: 1, marginBottom: 3 }}>{l}</div>
                <div style={{ fontSize: 12, color: c, fontWeight: 700 }}>{v}</div>
              </div>
            ))}
          </div>

          {/* Degradation breakdown bars */}
          <div style={{ background: "#0a1628", border: `1px solid ${C.border}`, borderRadius: 7, padding: 12 }}>
            <div style={{ fontSize: 9, color: C.muted, letterSpacing: 2, marginBottom: 10 }}>DEGRADATION BREAKDOWN</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              {[
                { label: "LLI", val: lli * 0.35, color: C.amber, note: "Cyclable Li loss" },
                { label: "LAM Anode", val: lamA * 0.2, color: C.red, note: "Anode cap. loss" },
                { label: "LAM Cathode", val: lamC * 0.2, color: C.purple, note: "Cathode cap. loss" },
                { label: "SEI Resistance", val: sei * 0.25, color: C.sei, note: "Impedance rise" },
              ].map(({ label, val, color, note }) => (
                <div key={label}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                    <span style={{ fontSize: 8, color: C.muted }}>{label}</span>
                    <span style={{ fontSize: 8, color }}>{val.toFixed(1)}%</span>
                  </div>
                  <div style={{ height: 4, background: "#0d1e35", borderRadius: 2 }}>
                    <div style={{ height: "100%", width: `${Math.min(100, val)}%`, background: color, borderRadius: 2, transition: "width 0.3s" }} />
                  </div>
                  <div style={{ fontSize: 7, color: C.muted, marginTop: 2 }}>{note}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* RIGHT: Controls */}
        <div style={{ borderLeft: `1px solid ${C.border}`, padding: "16px 14px", overflowY: "auto", background: "#07111f", display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ fontSize: 9, color: C.muted, letterSpacing: 2 }}>AGING PARAMETERS</div>

          <div>
            <div style={{ fontSize: 8, color: C.amber, letterSpacing: 2, marginBottom: 8, paddingBottom: 5, borderBottom: `1px solid ${C.border}` }}>▸ LLI</div>
            <AgingSlider label="LLI severity" value={lli} onChange={setLli} color={C.amber} />
          </div>

          <div>
            <div style={{ fontSize: 8, color: C.red, letterSpacing: 2, marginBottom: 8, paddingBottom: 5, borderBottom: `1px solid ${C.border}` }}>▸ ACTIVE MATERIAL LOSS</div>
            <AgingSlider label="LAM Anode" value={lamA} onChange={setLamA} color={C.red} />
            <AgingSlider label="LAM Cathode" value={lamC} onChange={setLamC} color={C.purple} />
          </div>

          <div>
            <div style={{ fontSize: 8, color: C.sei, letterSpacing: 2, marginBottom: 8, paddingBottom: 5, borderBottom: `1px solid ${C.border}` }}>▸ SEI GROWTH</div>
            <AgingSlider label="SEI thickness" value={sei} onChange={setSei} color={C.sei} />
          </div>

          <div>
            <div style={{ fontSize: 8, color: C.blue, letterSpacing: 2, marginBottom: 8, paddingBottom: 5, borderBottom: `1px solid ${C.border}` }}>▸ CYCLE COUNT</div>
            <AgingSlider label="Cycles" value={cycleCount} onChange={setCycleCount} max={1000} color={C.blue} unit="" />
          </div>

          {/* Presets */}
          <div>
            <div style={{ fontSize: 8, color: C.muted, letterSpacing: 2, marginBottom: 8 }}>PRESETS</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              {[["Pristine", "pristine", C.teal], ["200 cycles", "200", C.blue], ["500 cycles", "500", C.amber], ["End of Life", "eol", C.red]].map(([label, key, color]) => (
                <button key={key} onClick={() => applyPreset(key)} style={{
                  background: "transparent", border: `1px solid ${color}44`, color,
                  padding: "6px 8px", borderRadius: 4, cursor: "pointer",
                  fontFamily: "monospace", fontSize: 9, letterSpacing: 1, textAlign: "left",
                }}
                  onMouseEnter={e => e.currentTarget.style.background = `${color}11`}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                >{label}</button>
              ))}
            </div>
          </div>

          {/* Tip */}
          <div style={{ background: "#0a1628", border: `1px solid ${C.border}`, borderRadius: 5, padding: 10, fontSize: 8, color: C.muted, lineHeight: 1.7 }}>
            <div style={{ color: C.teal, marginBottom: 5, fontSize: 9 }}>ℹ Tips</div>
            <div>• Hover mechanism cards to highlight electrode regions</div>
            <div>• "Simulate 50 cycles" auto-ages the cell</div>
            <div>• LLI shifts anode OCV curve — watch plateaus move</div>
            <div>• High LAM-A + LLI → ⚠ plating risk alert</div>
            <div>• Star ★ marks the dominant aging mode</div>
          </div>
        </div>
      </div>
    </div>
  );
}
