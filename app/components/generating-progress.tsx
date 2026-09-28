// The "Generating Your …" animation (sketch card, pen, phase label, hop
// track), shared by Create Campaign and the Flow Editor regenerate modal.
// `step` is driven by the caller while the real request is in flight.

export const PHASE_COLORS = ["#0088b0", "#d6006c", "#edbb00", "#4b7b4e"];
const PEN_SEGMENTS = [{ max: 88, y: 58 }, { max: 70, y: 76 }, { max: 50, y: 94 }];

export function GeneratingProgress({ title, rows, step, note }: {
  title: string;
  rows: string[];
  step: number;
  note: string;
}) {
  const phaseTotal = rows.length;
  const phaseIdx = Math.min(step, phaseTotal - 1);
  const phaseLabel = rows[phaseIdx];
  const phaseColor = PHASE_COLORS[phaseIdx % PHASE_COLORS.length];
  const hopPct = phaseTotal > 1 ? (phaseIdx / (phaseTotal - 1)) * 100 : 0;
  const t1 = 1, t2 = Math.ceil(phaseTotal / 2), t3 = phaseTotal - 1;
  const line1On = step >= t1, line2On = step >= t2, line3On = step >= t3;
  const bannerOn = step >= t2;
  const penVisible = step < phaseTotal;
  let penSegIdx = 0, penSegFrac = 0;
  if (step < t1) { penSegIdx = 0; penSegFrac = t1 > 0 ? step / t1 : 0; }
  else if (step < t2) { penSegIdx = 1; penSegFrac = (step - t1) / Math.max(1, t2 - t1); }
  else { penSegIdx = 2; penSegFrac = step < t3 ? (step - t2) / Math.max(1, t3 - t2) : 1; }
  const penX = 14 + Math.min(1, penSegFrac) * (PEN_SEGMENTS[penSegIdx].max / 100 * 186);
  const penY = PEN_SEGMENTS[penSegIdx].y;

  return (
    <div className="nomi-cc-generating">
      <h2>{title}</h2>

      <div className="nomi-cc-gen-card">
        <div className="nomi-cc-gen-banner">
          <i className={`nomi-cc-gen-banner-skeleton${bannerOn ? " is-hidden" : ""}`} />
          <i className={`nomi-cc-gen-banner-fill${bannerOn ? " is-shown" : ""}`} />
        </div>
        <div className="nomi-cc-gen-lines">
          <i className="nomi-cc-gen-line-track" style={{ width: "88%" }}><i className={`nomi-cc-gen-line-fill${line1On ? " is-on" : ""}`} style={{ background: "#201e1d" }} /></i>
          <i className="nomi-cc-gen-line-track" style={{ width: "70%" }}><i className={`nomi-cc-gen-line-fill${line2On ? " is-on" : ""}`} style={{ background: "#746f6b" }} /></i>
          <i className="nomi-cc-gen-line-track" style={{ width: "50%" }}><i className={`nomi-cc-gen-line-fill${line3On ? " is-on" : ""}`} style={{ background: "#0088b0" }} /></i>
        </div>
        {penVisible ? (
          <div className="nomi-cc-gen-pen" style={{ left: penX, top: penY }}>
            <span className="nomi-cc-gen-pen-icon"><svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20l1-4L16 5l3 3L8 19l-4 1Z" fill="#201e1d" /></svg></span>
            <i className="nomi-cc-gen-caret" />
          </div>
        ) : null}
      </div>

      <p key={step} className="nomi-cc-gen-phase">{phaseLabel}</p>

      <div className="nomi-cc-hop-track">
        <i className="nomi-cc-hop-line" />
        <i className="nomi-cc-hop-fill" style={{ width: `calc(${hopPct}% - 3px)`, opacity: hopPct > 0 ? 1 : 0 }} />
        {rows.map((row, index) => (
          <i key={row} className={`nomi-cc-hop-dot${index <= phaseIdx ? " is-active" : ""}`} style={{ background: index <= phaseIdx ? PHASE_COLORS[index % PHASE_COLORS.length] : undefined }} />
        ))}
        <div className="nomi-cc-hop-marker" style={{ left: `${hopPct}%` }}>
          <i key={step} className="nomi-cc-hop-marker-dot" style={{ background: phaseColor }} />
        </div>
      </div>

      <p className="nomi-cc-gen-note">{note}</p>
    </div>
  );
}
