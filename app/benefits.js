// "What this practice changes when you listen to real English" — shown at the top of
// each practice and on the home screen. Each entry also states its limits, so the
// benefit is not overstated (see docs/spec.md §3 for the evidence levels).
import { esc } from "./util.js";

export const BENEFITS = {
  hvpt: {
    short: "right と light のような、似た音の単語の取り違えを減らす",
    gains: [
      "right / light、very / berry のような、似た音の単語を聞き分けられるようになる",
      "「ライト」と聞こえて、どっちの単語か文脈で迷うことが減る",
    ],
    limit: "身につくのは単語の音を聞き分ける力です。これだけで文全体が聞き取れるようになるわけではありません。",
  },
  rhythm: {
    short: "速い英語の中で、単語の切れ目と大事な語を見つけやすくする",
    gains: [
      "英語は意味の中心になる語を強く長く言うので、強い所を拾うと話の要点がつかみやすくなる",
      "速い英語でも、強い音節を手がかりに単語の切れ目が分かりやすくなる",
      "hotel（ホテル）、banana（バナナ）のように、カタカナ語と強い位置が違う単語を聞き逃しにくくなる",
    ],
    limit: "強勢の聞き取りは訓練で伸びるという研究がありますが、文全体の聞き取りまで伸びるかの研究はまだ少ないです。",
  },
  connected: {
    short: "「知っている単語なのに聞き取れない」を減らす",
    gains: [
      "want to →「ワナ」、check it out →「チェキラウ」のように、つながって形が変わった音を、知っている単語として聞き取れるようになる",
      "1語ずつなら分かるのに、文になると聞き取れない、という場面が減る",
    ],
    limit: "音声合成の声は、実際の会話ほど音を崩しません。実際の会話の音声でも練習すると効果的です。",
  },
  dictation: {
    short: "自分がどこで聞き取れなくなるかを見つける",
    gains: [
      "聞き取れない原因（似た音、音の変化、弱く読まれる語、知らない単語）の見当がつき、次に何を練習すればよいかが分かる",
      "同じ文を何度か聞き直すことで、聞き取れなかった部分の音と文字が結びつく",
    ],
    limit: "書き取りそのものの学習効果を示す研究は限られています。主に「弱点を見つける道具」として使ってください。",
  },
  shadowing: {
    short: "英語の速さに慣れ、聞きながら意味をとる処理を速くする",
    gains: [
      "英語を聞いてから意味が分かるまでの時間が短くなり、ついていける速さが上がる",
      "音を口でまねることで、音のつながりやリズムに気づきやすくなる",
    ],
    limit: "研究では、特に初級の学習者で効果が出やすいと報告されています。内容を理解してから行うのが前提です。",
  },
  reading: {
    short: "文字を見ながら聞いて、音と意味を結びつける",
    gains: [
      "文字で分かる英語を、音でも分かるようにする（音と文字の結びつき）",
      "長めの英語を最後まで聞く体力がつき、多聴の入り口になる",
    ],
    limit: "研究は小規模なものが中心です。物語はやさしめなので、慣れたら多聴へ進みましょう。",
  },
  extensive: {
    short: "やさしい英語を大量に聞いて、聞いてすぐ分かる英語を増やす",
    gains: [
      "聞いてすぐ意味が分かる英語が増え、長い英語を聞き続けても疲れにくくなる",
      "教材ではない本物の英語（ニュース、会話）の速さや話し方に慣れる",
    ],
    limit: "効果が出るまで時間がかかります。「だいたい分かる」くらいの、やさしい素材を選ぶことが大切です。",
  },
};

export function benefitCard(key) {
  const b = BENEFITS[key];
  if (!b) return "";
  return `
    <section class="card benefit">
      <h2>この練習で何ができるようになるか</h2>
      <ul class="small">${b.gains.map((g) => `<li>${esc(g)}</li>`).join("")}</ul>
      <p class="muted small">${esc(b.limit)}</p>
    </section>`;
}
