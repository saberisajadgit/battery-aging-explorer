import { useState, useEffect, useRef, useCallback } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from "recharts";

// ─── Color palette ───────────────────────────────────────────────────────────
const C = {
  bg: "#050d1a",
  panel: "#0a1628",
  border: "#1a2d4a",
  teal: "#00e5c8",
  amber: "#ffaa00",
  red: "#ff4060",
  purple: "#b060ff",
  blue: "#3090ff",
  text: "#c8daf0",
  muted: "#4a6080",
  sei: "#ff6a1a",
  lliLost: "#555",
  lam: "#1a3a5c",
};

// ─── Physics helpers ──────────────────────────────────────────────────────────
function generateOCVData(lli, lamA, lamC) {
  const points = [];
  const maxQ = 170 * (1 - lamA * 0.008) * (1 - lamC * 0.008);
  const shift = lli * 0.9;
  for (let i = 0; i <= 200; i += 2) {
    const q = i;
    // Anode half-cell (rises steeply at low SOC then flat)
    const anodeSOC = Math.min(1, Math.max(0, (q - shift) / (maxQ * 0.95)));
    const anode = anodeSOC < 0.05 ? 1.2 - anodeSOC * 8 : 0.08 + 0.02 * anodeSOC;
    // Cathode half-cell (starts high, falls)
    const cathodeSOC = Math.min(1, Math.max(0, q / (maxQ * 1.0)));
    const cathode = 4.2 - 0.5 * cathodeSOC - 0.3 * Math.pow(cathodeSOC, 3);
    const fullCell = Math.max(0, cathode - anode);
    points.push({ q, anode: +anode.toFixed(3), cathode: +cathode.toFixed(3), fullCell: +fullCell.toFixed(3) });
  }
  return points;
}

function generateCapacityFade(lli, lamA, lamC, sei) {
  const points = [];
  for (let cycle = 0; cycle <= 1000; cycle += 20) {
    const lliEffect = 1 - (lli / 100) * 0.6 * (1 - Math.exp(-cycle / 300));
    const lamEffect = 1 - ((lamA + lamC) / 200) * 0.5 * (cycle / 1000);
    const seiEffect = 1 - (sei / 100) * 0.3 * Math.log1p(cycle / 50) / Math.log1p(1000 / 50);
    const cap = 169.8 * lliEffect * lamEffect * seiEffect;
    points.push({ cycle, capacity: +Math.max(60, cap).toFixed(1) });
  }
  return points;
}

// ─── Ion particle ────────────────────────────────────────────────────────────
function Ion({ x, y, state, size = 10 }) {
  const color = state === "lost" ? C.lliLost : state === "dead" ? "#2a1a3a" : C.amber;
  const glow = state === "active" ? `0 0 6px ${C.amber}, 0 0 12px ${C.amber}88` : "none";
  return (
    <div style={{
      position: "absolute", left: x - size / 2, top: y - size / 2,
      width: size, height: size, borderRadius: "50%",
      background: color, boxShadow: glow,
      border: state === "dead" ? `1px solid #4a2060` : "none",
      transition: "all 0.8s ease",
    }} />
  );
}

// ─── Battery cross-section ───────────────────────────────────────────────────
function BatteryViz({ soc, lli, lamA, lamC, sei, animating }) {
  const ions = useRef([]);
  const [ionPositions, setIonPositions] = useState([]);
  const frameRef = useRef(0);

  // Build ion layout
  useEffect(() => {
    const total = 36;
    const lostCount = Math.floor(lli * 0.36);
    const deadCountA = Math.floor(lamA * 0.18);
    const positions = [];

    // Anode ions (left region x: 40–160)
    for (let i = 0; i < total; i++) {
      const col = i % 6;
      const row = Math.floor(i / 6);
      const baseX = 48 + col * 20;
      const baseY = 80 + row * 52;
      const isLost = i < lostCount;
      const isDead = !isLost && i < lostCount + deadCountA;
      // When charging (soc high), ions move right; discharging left
      const xOffset = animating ? (Math.random() - 0.5) * 6 : 0;
      positions.push({ id: `a${i}`, x: baseX + xOffset, y: baseY, state: isLost ? "lost" : isDead ? "dead" : "active", side: "anode" });
    }

    // Cathode ions (right region x: 220–340)
    const cathodeActive = Math.floor(total * (1 - lamC / 100 * 0.7));
    for (let i = 0; i < total; i++) {
      const col = i % 6;
      const row = Math.floor(i / 6);
      const baseX = 228 + col * 20;
      const baseY = 80 + row * 52;
      const active = i < cathodeActive;
      positions.push({ id: `c${i}`, x: baseX, y: baseY, state: active ? "active" : "dead", side: "cathode" });
    }

    setIonPositions(positions);
  }, [lli, lamA, lamC, animating]);

  const seiThickness = 4 + sei * 0.18;
  const anodeWidth = 160 - lamA * 0.4;
  const cathodeWidth = 120 - lamC * 0.3;

  return (
    <div style={{ position: "relative", width: 400, height: 420, margin: "0 auto" }}>
      {/* Current collectors */}
      <div style={{ position: "absolute", left: 0, top: 40, width: 18, height: 340, background: "linear-gradient(90deg,#b87333,#cd853f)", borderRadius: "3px 0 0 3px", boxShadow: "inset -3px 0 6px rgba(0,0,0,0.5)" }} />
      <div style={{ position: "absolute", right: 0, top: 40, width: 18, height: 340, background: "linear-gradient(90deg,#aaa,#ccc)", borderRadius: "0 3px 3px 0", boxShadow: "inset 3px 0 6px rgba(0,0,0,0.5)" }} />

      {/* Anode (graphite layers) */}
      <div style={{ position: "absolute", left: 18, top: 40, width: anodeWidth, height: 340, background: "#0d1f3a", overflow: "hidden" }}>
        {[0,1,2,3,4,5].map(i => (
          <div key={i} style={{ position: "absolute", left: 0, top: 16 + i * 52, width: "100%", height: 28, background: `linear-gradient(180deg, #1a3a6a, #0d2048)`, borderTop: `1px solid #2a4a8a`, borderBottom: `1px solid #0a1830` }} />
        ))}
        {/* SEI layer */}
        <div style={{ position: "absolute", right: 0, top: 0, width: seiThickness, height: "100%", background: `linear-gradient(90deg, ${C.sei}33, ${C.sei}88)`, borderLeft: `1px solid ${C.sei}66` }}>
          <div style={{ position: "absolute", top: 4, right: 2, fontSize: 8, color: C.sei, fontFamily: "monospace", writingMode: "vertical-rl", opacity: sei > 10 ? 1 : 0, transition: "opacity 0.5s" }}>SEI</div>
        </div>
      </div>

      {/* Separator */}
      <div style={{ position: "absolute", left: 18 + anodeWidth, top: 40, width: 28, height: 340, background: "repeating-linear-gradient(0deg, #1a2840, #1a2840 3px, #0f1e38 3px, #0f1e38 6px)", opacity: 0.9, borderLeft: `1px solid ${C.border}`, borderRight: `1px solid ${C.border}` }}>
        <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%) rotate(-90deg)", fontSize: 8, color: C.muted, fontFamily: "monospace", whiteSpace: "nowrap", letterSpacing: 2 }}>SEPARATOR</div>
      </div>

      {/* Cathode (layered oxide) */}
      <div style={{ position: "absolute", left: 18 + anodeWidth + 28, top: 40, width: cathodeWidth, height: 340, background: "#0d1a2e", overflow: "hidden" }}>
        {[0,1,2,3,4,5].map(i => (
          <div key={i} style={{ position: "absolute", left: 0, top: 16 + i * 52, width: "100%", height: 28, background: `linear-gradient(180deg, #1e3050, #152040)`, borderTop: `1px solid #2a4060`, borderBottom: `1px solid #0a1530` }} />
        ))}
      </div>

      {/* Labels */}
      {[["Cu", 9, 395], ["ANODE", 60, 18], ["SEPARATOR", 180, 18], ["CATHODE", 290, 18], ["Al", 388, 395]].map(([label, x, y]) => (
        <div key={label} style={{ position: "absolute", left: x, top: y, fontSize: label.length <= 2 ? 9 : 10, color: C.muted, fontFamily: "monospace", transform: "translateX(-50%)", letterSpacing: 1 }}>{label}</div>
      ))}

      {/* Ions */}
      {ionPositions.map(ion => <Ion key={ion.id} x={ion.x} y={ion.y} state={ion.state} />)}

      {/* Moving ions during animation */}
      {animating && Array.from({ length: 4 }).map((_, i) => (
        <MovingIon key={`m${i}`} soc={soc} delay={i * 0.25} />
      ))}

      {/* Legend */}
      <div style={{ position: "absolute", bottom: -30, left: 0, display: "flex", gap: 16, fontSize: 9, color: C.muted, fontFamily: "monospace" }}>
        {[["Li⁺", C.amber, "circle"], ["lost (LLI)", C.lliLost, "circle"], ["dead (LAM)", "#4a2060", "circle-border"]].map(([label, color]) => (
          <div key={label} style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: color, border: label === "dead (LAM)" ? `1px solid #8040c0` : "none", boxShadow: label === "Li⁺" ? `0 0 4px ${C.amber}` : "none" }} />
            {label}
          </div>
        ))}
      </div>
    </div>
  );
}

function MovingIon({ soc, delay }) {
  const [pos, setPos] = useState({ x: 170, y: 80 + Math.random() * 260 });
  useEffect(() => {
    const t = setTimeout(() => {
      setPos({ x: soc > 50 ? 230 + Math.random() * 80 : 50 + Math.random() * 80, y: 80 + Math.random() * 260 });
    }, delay * 1000);
    return () => clearTimeout(t);
  }, [soc, delay]);
  return (
    <div style={{
      position: "absolute", left: pos.x - 5, top: pos.y - 5,
      width: 10, height: 10, borderRadius: "50%",
      background: C.teal, boxShadow: `0 0 8px ${C.teal}, 0 0 16px ${C.teal}66`,
      transition: `all ${0.8 + delay}s cubic-bezier(0.4,0,0.2,1)`,
      opacity: 0.9,
    }} />
  );
}

// ─── Custom tooltip ───────────────────────────────────────────────────────────
const ChartTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: "#0a1628ee", border: `1px solid ${C.border}`, padding: "8px 12px", borderRadius: 6, fontFamily: "monospace", fontSize: 11 }}>
      <div style={{ color: C.muted, marginBottom: 4 }}>{payload[0]?.name?.includes("cycle") || label > 20 ? `Cycle ${label}` : `Q = ${label} mAh`}</div>
      {payload.map(p => (
        <div key={p.dataKey} style={{ color: p.color }}>{p.name}: <span style={{ color: C.text }}>{p.value}</span></div>
      ))}
    </div>
  );
};

// ─── Slider ───────────────────────────────────────────────────────────────────
function AgingSlider({ label, value, onChange, max = 100, color, description, unit = "%" }) {
  const pct = (value / max) * 100;
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
        <div>
          <span style={{ fontFamily: "monospace", fontSize: 11, color: C.text, letterSpacing: 1 }}>{label}</span>
          <span style={{ fontFamily: "monospace", fontSize: 9, color: C.muted, marginLeft: 6 }}>{description}</span>
        </div>
        <span style={{ fontFamily: "monospace", fontSize: 12, color, fontWeight: 700 }}>{value}{unit}</span>
      </div>
      <div style={{ position: "relative", height: 6, background: "#0d1e35", borderRadius: 3, cursor: "pointer" }}>
        <div style={{ position: "absolute", left: 0, top: 0, height: "100%", width: `${pct}%`, background: `linear-gradient(90deg, ${color}88, ${color})`, borderRadius: 3, transition: "width 0.1s" }} />
        <input type="range" min={0} max={max} value={value} onChange={e => onChange(+e.target.value)}
          style={{ position: "absolute", inset: 0, width: "100%", opacity: 0, cursor: "pointer", height: "100%" }} />
      </div>
    </div>
  );
}

// ─── Status badge ─────────────────────────────────────────────────────────────
function StatusBadge({ label, value, unit, color }) {
  return (
    <div style={{ background: "#0a1628", border: `1px solid ${C.border}`, borderRadius: 6, padding: "8px 12px", textAlign: "center", flex: 1 }}>
      <div style={{ fontFamily: "monospace", fontSize: 9, color: C.muted, letterSpacing: 2, marginBottom: 2 }}>{label}</div>
      <div style={{ fontFamily: "monospace", fontSize: 18, color, fontWeight: 700 }}>{value}<span style={{ fontSize: 10, marginLeft: 2 }}>{unit}</span></div>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function BatteryAgingExplorer() {
  const [lli, setLli] = useState(0);      // Lithium inventory loss %
  const [lamA, setLamA] = useState(0);    // LAM anode %
  const [lamC, setLamC] = useState(0);    // LAM cathode %
  const [sei, setSei] = useState(0);      // SEI growth %
  const [soc, setSoc] = useState(79);
  const [animating, setAnimating] = useState(false);
  const [activeTab, setActiveTab] = useState("halfcell");

  const ocvData = generateOCVData(lli, lamA, lamC);
  const capacityData = generateCapacityFade(lli, lamA, lamC, sei);

  const retention = +(capacityData[capacityData.length - 1].capacity / 169.8 * 100).toFixed(1);
  const currentCapacity = +(169.8 * (1 - lli / 100 * 0.5) * (1 - lamA / 100 * 0.3) * (1 - lamC / 100 * 0.3) * (1 - sei / 100 * 0.2)).toFixed(1);
  const vcell = +(3.97 - lli * 0.005 - sei * 0.008 - (lamA + lamC) * 0.003).toFixed(2);
  const health = Math.max(0, Math.round(100 - lli * 0.4 - lamA * 0.2 - lamC * 0.2 - sei * 0.2));

  const healthColor = health > 70 ? C.teal : health > 40 ? C.amber : C.red;

  const toggleAnim = () => {
    setAnimating(true);
    setTimeout(() => setAnimating(false), 2000);
  };

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text, fontFamily: "'Courier New', monospace", padding: 0, overflow: "hidden" }}>

      {/* ── Header ── */}
      <div style={{ padding: "16px 24px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", background: "#07111f" }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, color: C.teal, letterSpacing: 3, textTransform: "uppercase" }}>⚡ Battery Aging Explorer</div>
          <div style={{ fontSize: 10, color: C.muted, letterSpacing: 2, marginTop: 2 }}>Li-Ion Degradation Simulator · LLI · LAM · SEI</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {[["SOH", `${health}%`, healthColor], ["V_cell", `${vcell}V`, C.blue], ["Cap", `${currentCapacity}mAh`, C.amber]].map(([l, v, c]) => (
            <StatusBadge key={l} label={l} value={v} color={c} />
          ))}
        </div>
      </div>

      {/* ── Main layout ── */}
      <div style={{ display: "grid", gridTemplateColumns: "440px 1fr 260px", gap: 0, height: "calc(100vh - 70px)" }}>

        {/* ── LEFT: Battery viz ── */}
        <div style={{ borderRight: `1px solid ${C.border}`, padding: "24px 20px", overflowY: "auto", display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ fontSize: 10, color: C.muted, letterSpacing: 3, textTransform: "uppercase" }}>Cell Cross-Section</div>

          <BatteryViz soc={soc} lli={lli} lamA={lamA} lamC={lamC} sei={sei} animating={animating} />

          <div style={{ marginTop: 24 }}>
            <div style={{ fontSize: 10, color: C.muted, letterSpacing: 2, marginBottom: 8 }}>STATE OF CHARGE</div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ position: "relative", flex: 1, height: 8, background: "#0d1e35", borderRadius: 4 }}>
                <div style={{ position: "absolute", left: 0, top: 0, height: "100%", width: `${soc}%`, background: `linear-gradient(90deg, ${C.blue}88, ${C.teal})`, borderRadius: 4, transition: "width 0.2s" }} />
                <input type="range" min={0} max={100} value={soc} onChange={e => setSoc(+e.target.value)}
                  style={{ position: "absolute", inset: 0, width: "100%", opacity: 0, cursor: "pointer", height: "100%" }} />
              </div>
              <span style={{ fontSize: 13, color: C.teal, width: 36, textAlign: "right" }}>{soc}%</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: C.muted, marginTop: 4 }}>
              <span>← discharge</span><span>charge →</span>
            </div>
          </div>

          <button onClick={toggleAnim} style={{
            background: "transparent", border: `1px solid ${C.teal}`, color: C.teal,
            padding: "8px 16px", borderRadius: 4, cursor: "pointer", fontFamily: "monospace",
            fontSize: 10, letterSpacing: 2, textTransform: "uppercase",
            boxShadow: animating ? `0 0 12px ${C.teal}66` : "none",
            transition: "all 0.3s"
          }}>
            {animating ? "▶ Cycling..." : "▶ Simulate Cycle"}
          </button>

          {/* Mechanism info cards */}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {[
              { key: "LLI", color: C.amber, val: lli, desc: "Lithium inventory consumed by side reactions. Shifts OCV curve, reduces cyclable Li." },
              { key: "LAM-A", color: C.red, val: lamA, desc: "Anode active material lost to cracking/isolation. Reduces capacity and rate capability." },
              { key: "LAM-C", color: C.purple, val: lamC, desc: "Cathode active material degradation. Flattens voltage plateau." },
              { key: "SEI", color: C.sei, val: sei, desc: "Solid electrolyte interphase growth. Increases resistance, consumes lithium." },
            ].map(({ key, color, val, desc }) => (
              <div key={key} style={{ background: "#0a1628", border: `1px solid ${val > 0 ? color + "44" : C.border}`, borderRadius: 5, padding: "6px 10px", transition: "border-color 0.3s" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
                  <span style={{ color, fontSize: 10, fontWeight: 700 }}>{key}</span>
                  <span style={{ color: val > 0 ? color : C.muted, fontSize: 10 }}>{val > 0 ? `${val}%` : "—"}</span>
                </div>
                <div style={{ fontSize: 9, color: C.muted, lineHeight: 1.4 }}>{desc}</div>
              </div>
            ))}
          </div>
        </div>

        {/* ── CENTER: Charts ── */}
        <div style={{ padding: "20px", overflowY: "auto", display: "flex", flexDirection: "column", gap: 16 }}>

          {/* Tab switcher */}
          <div style={{ display: "flex", gap: 8, borderBottom: `1px solid ${C.border}`, paddingBottom: 12 }}>
            {[["halfcell", "Half-Cell OCV"], ["fullcell", "Full-Cell OCV"], ["fade", "Capacity Fade"]].map(([id, label]) => (
              <button key={id} onClick={() => setActiveTab(id)} style={{
                background: activeTab === id ? `${C.teal}22` : "transparent",
                border: activeTab === id ? `1px solid ${C.teal}` : `1px solid ${C.border}`,
                color: activeTab === id ? C.teal : C.muted,
                padding: "5px 14px", borderRadius: 4, cursor: "pointer",
                fontFamily: "monospace", fontSize: 10, letterSpacing: 1
              }}>{label}</button>
            ))}
          </div>

          {(activeTab === "halfcell") && (
            <div>
              <div style={{ fontSize: 10, color: C.muted, letterSpacing: 2, marginBottom: 12 }}>HALF-CELLS — gap = full-cell voltage</div>
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={ocvData} margin={{ top: 5, right: 20, bottom: 20, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                  <XAxis dataKey="q" stroke={C.muted} tick={{ fontSize: 10, fontFamily: "monospace" }} label={{ value: "Capacity Q (mAh)", position: "insideBottom", offset: -12, fill: C.muted, fontSize: 10 }} />
                  <YAxis stroke={C.muted} tick={{ fontSize: 10, fontFamily: "monospace" }} domain={[0, 4.5]} label={{ value: "Voltage (V)", angle: -90, position: "insideLeft", fill: C.muted, fontSize: 10 }} />
                  <Tooltip content={<ChartTooltip />} />
                  <Legend wrapperStyle={{ fontFamily: "monospace", fontSize: 10, color: C.muted }} />
                  <Line type="monotone" dataKey="cathode" stroke={C.amber} dot={false} strokeWidth={2} name="Cathode" />
                  <Line type="monotone" dataKey="anode" stroke={C.blue} dot={false} strokeWidth={2} name="Anode" />
                  <ReferenceLine x={ocvData.findIndex(d => d.fullCell < 3.97 && d.q > 100) * 2} stroke={C.teal} strokeDasharray="4 4" label={{ value: `V_cell=${vcell}V`, fill: C.teal, fontSize: 9, fontFamily: "monospace" }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {(activeTab === "fullcell") && (
            <div>
              <div style={{ fontSize: 10, color: C.muted, letterSpacing: 2, marginBottom: 12 }}>FULL CELL OCV CURVE</div>
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={ocvData} margin={{ top: 5, right: 20, bottom: 20, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                  <XAxis dataKey="q" stroke={C.muted} tick={{ fontSize: 10, fontFamily: "monospace" }} label={{ value: "Capacity Q (mAh)", position: "insideBottom", offset: -12, fill: C.muted, fontSize: 10 }} />
                  <YAxis stroke={C.muted} tick={{ fontSize: 10, fontFamily: "monospace" }} domain={[2.5, 4.5]} label={{ value: "Voltage (V)", angle: -90, position: "insideLeft", fill: C.muted, fontSize: 10 }} />
                  <Tooltip content={<ChartTooltip />} />
                  <Legend wrapperStyle={{ fontFamily: "monospace", fontSize: 10 }} />
                  <ReferenceLine y={4.2} stroke={C.red} strokeDasharray="3 3" label={{ value: "4.2V cutoff", fill: C.red, fontSize: 9, fontFamily: "monospace", position: "right" }} />
                  <ReferenceLine y={3.0} stroke={C.red} strokeDasharray="3 3" label={{ value: "3.0V cutoff", fill: C.red, fontSize: 9, fontFamily: "monospace", position: "right" }} />
                  <Line type="monotone" dataKey="fullCell" stroke={C.purple} dot={false} strokeWidth={2.5} name="Full Cell" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {activeTab === "fade" && (
            <div>
              <div style={{ fontSize: 10, color: C.muted, letterSpacing: 2, marginBottom: 12 }}>CAPACITY FADE vs CYCLE NUMBER</div>
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={capacityData} margin={{ top: 5, right: 20, bottom: 20, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                  <XAxis dataKey="cycle" stroke={C.muted} tick={{ fontSize: 10, fontFamily: "monospace" }} label={{ value: "Cycle Number", position: "insideBottom", offset: -12, fill: C.muted, fontSize: 10 }} />
                  <YAxis stroke={C.muted} tick={{ fontSize: 10, fontFamily: "monospace" }} domain={[60, 175]} label={{ value: "Capacity (mAh)", angle: -90, position: "insideLeft", fill: C.muted, fontSize: 10 }} />
                  <Tooltip content={<ChartTooltip />} />
                  <ReferenceLine y={169.8 * 0.8} stroke={C.amber} strokeDasharray="3 3" label={{ value: "80% EOL", fill: C.amber, fontSize: 9, fontFamily: "monospace", position: "right" }} />
                  <Line type="monotone" dataKey="capacity" stroke={C.teal} dot={false} strokeWidth={2.5} name="Capacity" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Metrics row */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10 }}>
            {[
              ["RETENTION", `${retention}%`, retention > 80 ? C.teal : retention > 60 ? C.amber : C.red],
              ["CAPACITY", `${currentCapacity} mAh`, C.blue],
              ["V_CELL", `${vcell} V`, C.purple],
              ["HEALTH", `${health}%`, healthColor],
            ].map(([label, val, color]) => (
              <div key={label} style={{ background: "#0a1628", border: `1px solid ${C.border}`, borderRadius: 6, padding: "10px", textAlign: "center" }}>
                <div style={{ fontSize: 8, color: C.muted, letterSpacing: 2, marginBottom: 4 }}>{label}</div>
                <div style={{ fontSize: 15, color, fontWeight: 700 }}>{val}</div>
              </div>
            ))}
          </div>

          {/* Mechanism breakdown */}
          <div style={{ background: "#0a1628", border: `1px solid ${C.border}`, borderRadius: 8, padding: 16 }}>
            <div style={{ fontSize: 10, color: C.muted, letterSpacing: 2, marginBottom: 12 }}>DEGRADATION BREAKDOWN</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              {[
                { label: "LLI contribution", val: lli * 0.4, color: C.amber, note: "Cyclable Li loss" },
                { label: "LAM Anode", val: lamA * 0.2, color: C.red, note: "Anode capacity loss" },
                { label: "LAM Cathode", val: lamC * 0.2, color: C.purple, note: "Cathode cap. loss" },
                { label: "SEI Resistance", val: sei * 0.2, color: C.sei, note: "Impedance rise" },
              ].map(({ label, val, color, note }) => (
                <div key={label} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                      <span style={{ fontSize: 9, color: C.muted }}>{label}</span>
                      <span style={{ fontSize: 9, color }}>{val.toFixed(1)}%</span>
                    </div>
                    <div style={{ height: 4, background: "#0d1e35", borderRadius: 2 }}>
                      <div style={{ height: "100%", width: `${Math.min(100, val)}%`, background: color, borderRadius: 2, transition: "width 0.3s" }} />
                    </div>
                    <div style={{ fontSize: 8, color: C.muted, marginTop: 2 }}>{note}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── RIGHT: Controls ── */}
        <div style={{ borderLeft: `1px solid ${C.border}`, padding: "20px 16px", overflowY: "auto", background: "#07111f" }}>
          <div style={{ fontSize: 10, color: C.muted, letterSpacing: 2, marginBottom: 16 }}>AGING PARAMETERS</div>

          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 9, color: C.amber, letterSpacing: 2, marginBottom: 10, borderBottom: `1px solid ${C.border}`, paddingBottom: 6 }}>▸ LLI</div>
            <AgingSlider label="LLI" description="Li inventory" value={lli} onChange={setLli} color={C.amber} />
          </div>

          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 9, color: C.red, letterSpacing: 2, marginBottom: 10, borderBottom: `1px solid ${C.border}`, paddingBottom: 6 }}>▸ ACTIVE MATERIAL LOSS</div>
            <AgingSlider label="LAM Anode" description="graphite" value={lamA} onChange={setLamA} color={C.red} />
            <AgingSlider label="LAM Cathode" description="oxide" value={lamC} onChange={setLamC} color={C.purple} />
          </div>

          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 9, color: C.sei, letterSpacing: 2, marginBottom: 10, borderBottom: `1px solid ${C.border}`, paddingBottom: 6 }}>▸ SEI GROWTH</div>
            <AgingSlider label="SEI thickness" description="anode film" value={sei} onChange={setSei} color={C.sei} />
          </div>

          {/* Quick presets */}
          <div style={{ marginTop: 8 }}>
            <div style={{ fontSize: 9, color: C.muted, letterSpacing: 2, marginBottom: 8 }}>PRESETS</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {[
                ["Pristine", () => { setLli(0); setLamA(0); setLamC(0); setSei(0); }, C.teal],
                ["200 cycles", () => { setLli(12); setLamA(5); setLamC(4); setSei(15); }, C.blue],
                ["500 cycles", () => { setLli(30); setLamA(15); setLamC(12); setSei(35); }, C.amber],
                ["End of Life", () => { setLli(55); setLamA(35); setLamC(28); setSei(70); }, C.red],
              ].map(([label, action, color]) => (
                <button key={label} onClick={action} style={{
                  background: "transparent", border: `1px solid ${color}44`, color,
                  padding: "6px 10px", borderRadius: 4, cursor: "pointer",
                  fontFamily: "monospace", fontSize: 9, letterSpacing: 1,
                  textAlign: "left", transition: "all 0.2s"
                }}
                  onMouseEnter={e => e.target.style.background = `${color}11`}
                  onMouseLeave={e => e.target.style.background = "transparent"}
                >{label}</button>
              ))}
            </div>
          </div>

          {/* Info box */}
          <div style={{ marginTop: 20, background: "#0a1628", border: `1px solid ${C.border}`, borderRadius: 6, padding: 12, fontSize: 9, color: C.muted, lineHeight: 1.6 }}>
            <div style={{ color: C.teal, marginBottom: 6, fontSize: 10 }}>ℹ How it works</div>
            Adjust the sliders to simulate different aging mechanisms. Watch the electrode visualization update and observe how each mechanism shifts the OCV curves and accelerates capacity fade.
          </div>
        </div>
      </div>
    </div>
  );
}
