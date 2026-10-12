// Explanations per contrast: listening tips + schematic side view of the mouth.
// Articulatory descriptions follow standard phonetics textbooks; the figures are
// simplified schematics, not anatomically exact.

// Side view, face looking left. tx/ty = tongue tip, dx/dy = highest point of the
// tongue body, ry = tongue root, jaw = lower-jaw drop, lip = lower-lip offset.
const POSTURES = {
  neutral: { tx: 57, ty: 113, dx: 110, dy: 104, ry: 120, jaw: 2, lip: [0, 2] },
  r:       { tx: 80, ty: 94,  dx: 120, dy: 100, ry: 112, jaw: 2, lip: [-4, 1] },
  l:       { tx: 64, ty: 89,  dx: 112, dy: 104, ry: 120, jaw: 2, lip: [0, 2] },
  b:       { tx: 57, ty: 113, dx: 110, dy: 104, ry: 120, jaw: 0, lip: [0, -3] },
  v:       { tx: 57, ty: 113, dx: 110, dy: 104, ry: 120, jaw: 0, lip: [8, -3] },
  s:       { tx: 62, ty: 93,  dx: 108, dy: 96,  ry: 118, jaw: 0, lip: [0, 0] },
  th:      { tx: 43, ty: 105, dx: 104, dy: 100, ry: 118, jaw: 3, lip: [0, 9] },
  ae:      { tx: 57, ty: 124, dx: 100, dy: 116, ry: 122, jaw: 12, lip: [0, 12] },
  uh:      { tx: 57, ty: 118, dx: 118, dy: 104, ry: 118, jaw: 6, lip: [0, 6] },
  ii:      { tx: 57, ty: 112, dx: 96,  dy: 80,  ry: 118, jaw: 0, lip: [0, 1] },
  ih:      { tx: 57, ty: 114, dx: 104, dy: 88,  ry: 118, jaw: 2, lip: [0, 2] },
};

function tonguePath(p) {
  const y0 = 150 + p.jaw;
  return `M56 ${y0} C54 ${y0 - 10} ${p.tx - 6} ${p.ty + 10} ${p.tx} ${p.ty} `
    + `C${p.tx + 8} ${p.ty - 6} ${p.dx - 28} ${p.dy} ${p.dx} ${p.dy} `
    + `C${p.dx + 30} ${p.dy} 170 ${p.ry} 170 172 `
    + `C150 ${165 + p.jaw} 90 ${162 + p.jaw} 56 ${y0} Z`;
}

const reduceMotion = () => window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function mouthFigure(name, label) {
  const p = POSTURES[name];
  const n = POSTURES.neutral;
  const animate = !reduceMotion();
  const anim = (attr, from, to) => animate
    ? `<animate attributeName="${attr}" values="${from};${to};${to};${from}" keyTimes="0;0.3;0.75;1" dur="3s" repeatCount="indefinite"/>`
    : "";
  const move = (from, to) => animate
    ? `<animateTransform attributeName="transform" type="translate" values="${from};${to};${to};${from}" keyTimes="0;0.3;0.75;1" dur="3s" repeatCount="indefinite"/>`
    : "";
  const jawFrom = `0 ${n.jaw}`, jawTo = `0 ${p.jaw}`;
  const lipFrom = `${n.lip[0]} ${n.lip[1]}`, lipTo = `${p.lip[0]} ${p.lip[1]}`;

  return `
  <svg class="mouth" viewBox="0 0 200 190" role="img" aria-label="${label} を発音するときの口と舌（横から見た模式図）">
    <path class="outline" d="M44 18 C40 38 24 52 18 62 C24 68 32 72 36 78"/>
    <path class="outline" d="M54 86 C60 84 64 86 68 84 C86 72 120 66 145 74 C158 79 166 88 170 100"/>
    <path class="outline" d="M184 80 L184 190"/>
    <path class="tongue" d="${tonguePath(p)}">${anim("d", tonguePath(n), tonguePath(p))}</path>
    <g transform="translate(${jawTo})">${move(jawFrom, jawTo)}
      <path class="outline" d="M30 118 C32 145 70 160 130 162 C150 163 165 168 172 178"/>
      <path class="tooth" d="M47 108 L53 108 L54 126 L46 126 Z"/>
    </g>
    <g transform="translate(${lipTo})">${move(lipFrom, lipTo)}
      <rect class="lip" x="26" y="100" width="20" height="16" rx="8"/>
    </g>
    <rect class="lip" x="26" y="82" width="20" height="15" rx="7"/>
    <path class="tooth" d="M46 84 L54 84 L53 104 L47 104 Z"/>
    <text class="fig-label" x="70" y="80">歯ぐき</text>
    <text class="fig-label" x="112" y="60">上あご</text>
    <text class="fig-label" x="4" y="94">唇</text>
    <text class="fig-label" x="118" y="150">舌</text>
  </svg>`;
}

// Front view. w = half-width of the mouth opening, ht/hb = opening above/below
// the centre line, lipT/lipB = lip thickness, ut/lt = visible height of the
// upper/lower teeth, tongue = [cx, cy, rx, ry] (only the part inside the opening shows).
const FRONT = {
  neutral: { w: 26, ht: 4,   hb: 4,   lipT: 10, lipB: 11, ut: 3, lt: 2, tongue: [80, 70, 18, 6] },
  r:       { w: 15, ht: 8,   hb: 8,   lipT: 13, lipB: 14, ut: 4, lt: 2, tongue: [80, 75, 12, 5] },
  l:       { w: 24, ht: 9,   hb: 10,  lipT: 10, lipB: 11, ut: 5, lt: 3, tongue: [80, 58, 9, 10] },
  b:       { w: 26, ht: 0.5, hb: 0.5, lipT: 11, lipB: 12, ut: 0, lt: 0, tongue: [80, 72, 18, 6] },
  v:       { w: 26, ht: 8,   hb: 1,   lipT: 10, lipB: 6,  ut: 9, lt: 0, tongue: [80, 75, 18, 6] },
  s:       { w: 28, ht: 5,   hb: 5,   lipT: 9,  lipB: 10, ut: 5, lt: 4, tongue: [80, 72, 18, 6] },
  th:      { w: 26, ht: 8,   hb: 8,   lipT: 10, lipB: 11, ut: 5, lt: 4, tongue: [80, 61, 17, 5] },
  ae:      { w: 30, ht: 13,  hb: 20,  lipT: 9,  lipB: 10, ut: 6, lt: 3, tongue: [80, 80, 22, 8] },
  uh:      { w: 24, ht: 8,   hb: 12,  lipT: 10, lipB: 11, ut: 4, lt: 2, tongue: [80, 74, 18, 7] },
  ii:      { w: 34, ht: 4,   hb: 5,   lipT: 7,  lipB: 8,  ut: 3, lt: 3, tongue: [80, 72, 18, 6] },
  ih:      { w: 30, ht: 6,   hb: 7,   lipT: 9,  lipB: 10, ut: 4, lt: 3, tongue: [80, 69, 16, 5] },
};
const CX = 80, CY = 60;

function lensPath(w, ht, hb) {
  return `M${CX - w} ${CY} C${CX - w * 0.6} ${CY - ht} ${CX + w * 0.6} ${CY - ht} ${CX + w} ${CY} `
    + `C${CX + w * 0.6} ${CY + hb} ${CX - w * 0.6} ${CY + hb} ${CX - w} ${CY} Z`;
}

function ellipsePath(cx, cy, rx, ry) {
  const k = 0.5523;
  return `M${cx - rx} ${cy} C${cx - rx} ${cy - ry * k} ${cx - rx * k} ${cy - ry} ${cx} ${cy - ry} `
    + `C${cx + rx * k} ${cy - ry} ${cx + rx} ${cy - ry * k} ${cx + rx} ${cy} `
    + `C${cx + rx} ${cy + ry * k} ${cx + rx * k} ${cy + ry} ${cx} ${cy + ry} `
    + `C${cx - rx * k} ${cy + ry} ${cx - rx} ${cy + ry * k} ${cx - rx} ${cy} Z`;
}

const bandPath = (top, bottom) => `M40 ${top} H120 V${bottom} H40 Z`;

const frontShapes = (f) => ({
  lips: lensPath(f.w + 8, f.ht + f.lipT, f.hb + f.lipB),
  opening: lensPath(f.w, f.ht, f.hb),
  tongue: ellipsePath(...f.tongue),
  upper: bandPath(CY - f.ht - 2, CY - f.ht + f.ut),
  lower: bandPath(CY + f.hb - f.lt, CY + f.hb + 2),
});

let clipSeq = 0;

export function frontFigure(name, label) {
  const p = frontShapes(FRONT[name]);
  const n = frontShapes(FRONT.neutral);
  const animate = !reduceMotion();
  const anim = (key) => animate
    ? `<animate attributeName="d" values="${n[key]};${p[key]};${p[key]};${n[key]}" keyTimes="0;0.3;0.75;1" dur="3s" repeatCount="indefinite"/>`
    : "";
  const shape = (key, cls) => `<path class="${cls}" d="${p[key]}">${anim(key)}</path>`;
  const clip = `mouth-clip-${++clipSeq}`;

  return `
  <svg class="mouth front" viewBox="0 0 160 120" role="img" aria-label="${label} を発音するときの口（正面から見た模式図）">
    <path class="outline" d="M50 14 C60 22 100 22 110 14"/>
    <path class="outline" d="M22 30 C22 80 50 112 80 114 C110 112 138 80 138 30"/>
    ${shape("lips", "lip")}
    <clipPath id="${clip}"><path d="${p.opening}">${anim("opening")}</path></clipPath>
    ${shape("opening", "opening")}
    <g clip-path="url(#${clip})">
      ${shape("tongue", "tongue")}
      ${shape("upper", "tooth")}
      ${shape("lower", "tooth")}
    </g>
  </svg>`;
}

export const GUIDES = {
  rl: {
    summary: "日本語の「ラ行」は、舌先で歯ぐきを一瞬はじく音で、英語の /r/ とも /l/ とも違います。そのため両方が「ラ行」に聞こえてしまいます。",
    listen: [
      "/l/ は「明るく、はっきり」した音。舌先が離れる瞬間に、音がパッと切り替わります。",
      "/r/ は「こもった、暗い」音。始まりに「ゥ」のような響きがあり、次の音へゆっくり移ります。",
      "pray / play のように子音のあとに来るときも同じです。/r/ だと「プゥレイ」のようにこもって聞こえます。",
      "語末の /l/（file など）は「ウ」や「オ」に近く聞こえ、語末の /r/（fire など）は「アー」のようにこもって聞こえます。",
    ],
    sounds: [
      { key: "a", posture: "r", label: "/r/", front: "唇を少し丸めて前に出す。舌はほとんど見えない。", points: [
        "舌先を少し持ち上げるか奥へ引き、<strong>上あごのどこにも触れない</strong>。",
        "唇を少しすぼめる。",
        "舌全体を盛り上げる言い方（舌先は下げたまま）もあり、どちらでも同じように聞こえます。",
      ] },
      { key: "b", posture: "l", label: "/l/", front: "口は軽く開き、舌先が上の前歯の裏に付いているのが見える。", points: [
        "舌先を<strong>上の歯ぐきにしっかり付けたまま</strong>声を出す。",
        "息は舌の両わきから流れる。",
        "語頭では、舌先を離す瞬間に次の母音が始まる。",
      ] },
    ],
    examples: [["right", "light"], ["rock", "lock"], ["pray", "play"], ["fire", "file"]],
  },
  bv: {
    summary: "日本語には /v/ がなく、カタカナではどちらも「バ行」で書かれるため、区別しにくくなります。",
    listen: [
      "/b/ は唇を閉じて一気に開く音。<strong>一瞬で始まる</strong>「ポンッ」とした始まり方です。",
      "/v/ は歯と唇のすき間で空気がこすれる音。母音の前に<strong>「ブーン」という震え</strong>が続き、やわらかく始まります。",
      "語末（curb / curve）では、/v/ のほうが震えが残ります。",
    ],
    sounds: [
      { key: "a", posture: "b", label: "/b/", front: "唇がぴったり閉じる（そのあと一気に開く）。", points: [
        "<strong>上下の唇をしっかり閉じ</strong>、声を出しながら一気に開く。",
        "日本語の「バ」とほぼ同じ。",
      ] },
      { key: "b", posture: "v", label: "/v/", front: "上の前歯が下唇に乗っているのが見える。", points: [
        "<strong>上の前歯を下唇の内側に軽く当てる</strong>。",
        "声を出しながら、すき間から息を出し続ける（唇は閉じない）。",
        "「フ」の口の形で、声を出すイメージ。",
      ] },
    ],
    examples: [["berry", "very"], ["best", "vest"], ["boat", "vote"], ["curb", "curve"]],
  },
  sth: {
    summary: "日本語には /θ/ がなく、カタカナではどちらも「サ行」になります。",
    listen: [
      "/s/ は<strong>強く鋭い</strong>「スー」という高い息の音です。",
      "/θ/ は<strong>弱く、かすれた</strong>息の音で、音量が小さく、ほとんど聞こえないこともあります。",
      "迷ったら「息の音が強いか弱いか」に注目しましょう。",
    ],
    sounds: [
      { key: "a", posture: "s", label: "/s/", front: "上下の歯がほぼ閉じ、すき間から息が出る。舌は見えない。", points: [
        "舌先を<strong>上の歯ぐきに近づける（触れない）</strong>。",
        "狭いすき間から強く息を出す。",
      ] },
      { key: "b", posture: "th", label: "/θ/", front: "上下の歯の間に、舌先が少し見える。", points: [
        "<strong>舌先を上の前歯の先に軽く当てる</strong>（歯の間から少し出してもよい）。",
        "舌と歯のすき間から、やさしく息を出す。",
      ] },
    ],
    examples: [["sink", "think"], ["sick", "thick"], ["mouse", "mouth"], ["pass", "path"]],
  },
  aeuh: {
    summary: "日本語の「ア」1つに、英語では /æ/、/ʌ/ など複数の母音が対応するため、どれも「ア」に聞こえます。",
    listen: [
      "/æ/ は「エ」と「ア」の中間のような音で、<strong>やや長く、明るく</strong>聞こえます（cat は「キャット」に近い）。",
      "/ʌ/ は<strong>短く、暗めの</strong>「ア」です。驚いたときの「アッ」に近い音です。",
      "迷ったら「エの響きが混ざっているか」に注目しましょう。",
    ],
    sounds: [
      { key: "a", posture: "ae", label: "/æ/", front: "口が縦にも横にも大きく開き、下のほうに舌が見える。", points: [
        "<strong>口を大きく、縦にも横にも開く</strong>。",
        "舌は低く、前寄り。「エ」の口から、あごを下げて「ア」と言うイメージ。",
      ] },
      { key: "b", posture: "uh", label: "/ʌ/", front: "口は自然に軽く開く程度。/æ/ より小さい。", points: [
        "<strong>口は軽く開くだけ</strong>、力を抜く。",
        "舌は真ん中あたりで、短く「ア」と言う。",
      ] },
    ],
    examples: [["cap", "cup"], ["cat", "cut"], ["bag", "bug"], ["ankle", "uncle"]],
  },
  iih: {
    summary: "日本語の「イ」1つに、英語では /iː/ と /ɪ/ が対応します。長さだけでなく、音の響き（音色）も違います。",
    listen: [
      "/iː/ は<strong>長く、はっきりした</strong>「イー」です。",
      "/ɪ/ は<strong>短く、ゆるんだ</strong>音で、「イ」と「エ」の中間のように聞こえます（ship は「シェップ」に近く聞こえることも）。",
      "後ろの子音によって長さが変わるので、<strong>長さより音色</strong>に注目すると確実です。",
    ],
    sounds: [
      { key: "a", posture: "ii", label: "/iː/", front: "唇を横に強く引き（笑顔の形）、上下の歯が見える。", points: [
        "<strong>唇を横に引き</strong>（笑顔の形）、舌を高く、前へ。",
        "舌に力を入れて、長めに言う。",
      ] },
      { key: "b", posture: "ih", label: "/ɪ/", front: "唇の力を抜き、/iː/ より少しだけ縦に開く。", points: [
        "<strong>唇と舌の力を抜く</strong>。",
        "舌は /iː/ より少し低く、少し奥。短く言う。",
      ] },
    ],
    examples: [["sheep", "ship"], ["seat", "sit"], ["feel", "fill"], ["cheap", "chip"]],
  },
};
