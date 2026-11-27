// The little host on the start screen: a half-moon benne dosa on two short legs, hands folded,
// saying namaste and welcome. Drawn here as vector shapes (no image file).

const INK = '#3B2314';

function Face({ cx, cy, k = 1 }: { cx: number; cy: number; k?: number }) {
  return (
    <g>
      <ellipse cx={cx - 24 * k} cy={cy} rx={6.5 * k} ry={8.5 * k} fill={INK} />
      <ellipse cx={cx + 24 * k} cy={cy} rx={6.5 * k} ry={8.5 * k} fill={INK} />
      <circle cx={cx - 21.8 * k} cy={cy - 3 * k} r={2.4 * k} fill="#fff" />
      <circle cx={cx + 26.2 * k} cy={cy - 3 * k} r={2.4 * k} fill="#fff" />
      <ellipse cx={cx - 42 * k} cy={cy + 15 * k} rx={10 * k} ry={6.5 * k} fill="#F08A5D" opacity=".5" />
      <ellipse cx={cx + 42 * k} cy={cy + 15 * k} rx={10 * k} ry={6.5 * k} fill="#F08A5D" opacity=".5" />
      <path
        d={`M${cx - 12 * k} ${cy + 13 * k}q${12 * k} ${13 * k} ${24 * k} 0`}
        fill="none"
        stroke={INK}
        strokeWidth={4.5 * k}
        strokeLinecap="round"
      />
    </g>
  );
}

// Arms coming in from the sides to two palms pressed together.
function Namaste({ cx, cy, body, palm, line }: { cx: number; cy: number; body: string; palm: string; line: string }) {
  const arm = (s: 1 | -1) => `M${cx - 58 * s} ${cy - 6}q${24 * s} 26 ${50 * s} 8`;
  return (
    <g strokeLinecap="round" strokeLinejoin="round">
      <path d={arm(1)} fill="none" stroke={line} strokeWidth="19" />
      <path d={arm(-1)} fill="none" stroke={line} strokeWidth="19" />
      <path d={arm(1)} fill="none" stroke={body} strokeWidth="12" />
      <path d={arm(-1)} fill="none" stroke={body} strokeWidth="12" />
      <path d={`M${cx} ${cy - 34}c-12 8-15 22-12 40q6 5 12 4z`} fill={palm} stroke={line} strokeWidth="3.5" />
      <path d={`M${cx} ${cy - 34}c12 8 15 22 12 40q-6 5-12 4z`} fill={palm} stroke={line} strokeWidth="3.5" />
    </g>
  );
}

function Dosa() {
  return (
    <svg viewBox="0 0 240 200" aria-hidden="true">
      {/* two short legs with little shoes */}
      <g stroke="#A9661A" strokeWidth="9" strokeLinecap="round">
        <path d="M92 140v30" />
        <path d="M148 140v30" />
      </g>
      <ellipse cx="86" cy="176" rx="17" ry="9" fill={INK} />
      <ellipse cx="154" cy="176" rx="17" ry="9" fill={INK} />
      {/* the dosa, folded into a half moon */}
      <path
        d="M16 132A104 104 0 0 1 224 132q0 14-14 14H30q-14 0-14-14z"
        fill="#E9A23B"
        stroke="#A9661A"
        strokeWidth="4"
        strokeLinejoin="round"
      />
      <path d="M36 124A84 84 0 0 1 112 46" fill="none" stroke="#F6C877" strokeWidth="9" strokeLinecap="round" />
      <g fill="#C97F23" opacity=".5">
        <circle cx="176" cy="70" r="5" />
        <circle cx="198" cy="104" r="6" />
        <circle cx="150" cy="50" r="4" />
        <circle cx="44" cy="134" r="4" />
      </g>
      {/* a knob of butter on top: benne */}
      <path d="M104 22l30-6 6 22-30 7z" fill="#FBE08A" stroke="#B9831A" strokeWidth="3.5" strokeLinejoin="round" />
      <Face cx={120} cy={86} k={0.95} />
      <Namaste cx={120} cy={136} body="#E9A23B" palm="#F6C877" line="#A9661A" />
    </svg>
  );
}

export function Mascots() {
  return (
    <div className="hosts" data-testid="hosts">
      <div className="say">
        <b>Namaste!</b>
        <span>Welcome to Benne 14</span>
      </div>
      <div className="hop">
        <Dosa />
      </div>
      <i className="shade" />
    </div>
  );
}
