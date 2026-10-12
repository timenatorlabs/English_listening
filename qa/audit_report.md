# 教材・音声の点検レポート（2026-10-12）

`tools/audit.py` が自動生成。自動で確認できたことと、人の確認が必要なことを分けて記載する。

## 1. ファイル
- アプリが参照する音声：7598件、欠落：0件
- どこからも参照されていない音声：0件
- 読み込み不可・無音・音割れ：0件

## 2. 訓練用とテスト用の分離
| 対象 | 単語の重なり | 話者の重なり | テスト専用 | 1回のテストでの繰り返し |
|---|---|---|---|---|
| rl | 0 | 0 | 12 | 約1.7回 |
| bv | 0 | 0 | 4 | 約5.0回 |
| sth | 0 | 0 | 4 | 約5.0回 |
| aeuh | 0 | 0 | 4 | 約5.0回 |
| iih | 0 | 0 | 4 | 約5.0回 |
| stress | 0 | 0 | 9 | 約1.1回 |

## 3. 長さだけで正解できてしまうか（同じ話者のペアで a が長い割合。50%なら手がかりにならない）
| 音 | a が長い割合 | 長さだけで答えた場合の正答率 |
|---|---|---|
| rl | 48% | 52% |
| bv | 44% | 56% |
| sth | 52% | 52% |
| aeuh | 47% | 53% |
| iih | 47% | 53% |

## 4. 教材データ（発音記号・強勢ラベル・注記の位置）
- 問題なし

## 5. 音声認識（faster-whisper base.en、PC内で実行）
- 聞き分けの単語：意図した語と判定されなかったファイル 303件。8割未満の単語：aeuh:bag, aeuh:drunk, aeuh:hat, aeuh:staff, bv:bane, bv:bat, bv:bent, bv:best, bv:bet, bv:bile, bv:boat, bv:curb, bv:marble, bv:saber, bv:van, bv:vane, bv:vase, bv:vat, bv:veil, bv:very, bv:vest, bv:vet, bv:volt, bv:vote, bv:vowel, iih:it, iih:peel, iih:pill, iih:slip, iih:will, rl:bland, rl:crack, rl:lent, rl:lice, rl:lust, sth:forth, sth:tense, sth:thaw, sth:thought
- 強勢の単語：聞き取れなかった割合が2割を超える単語：banana, cartoon, comedy, damage, hamburger, pajamas, piano, sandwich
- 文：874件中、内容語（名詞・動詞など）が原文と違ったもの 103件、機能語（a, the, have など）だけが違ったもの 23件（弱く発音された結果の可能性が高い）
  - audio/dict/2-10_539.mp3：原文「I think it's going to rain.」／認識「I think it's going to ring.」（違い：rain, ring）
  - audio/dict/3-02_227.mp3：原文「What do you want to eat for dinner?」／認識「What do you want E for dinner?」（違い：eat, e）
  - audio/dict/3-12_93.mp3：原文「Check it out when you have time.」／認識「Pick it out when you have time.」（違い：check, pick）
  - audio/dict/4-02_539.mp3：原文「You'd better leave now, or you'll miss the train.」／認識「You'd better leave now where you'll miss the train.」（違い：where）
  - audio/dict/4-02_93.mp3：原文「You'd better leave now, or you'll miss the train.」／認識「You better leave now or you'll miss the train.」（違い：you'd）
  - audio/dict/4-02_902.mp3：原文「You'd better leave now, or you'll miss the train.」／認識「You better leave now or you'll miss a train.」（違い：you'd）
  - audio/dict/4-02_227.mp3：原文「You'd better leave now, or you'll miss the train.」／認識「You better leave now, or you'll miss the train.」（違い：you'd）
  - audio/dict/4-09_93.mp3：原文「As far as I know, the store is closed on Mondays.」／認識「As far as I know, the stores closed on Mondays.」（違い：store, stores）
  - audio/dict/5-01_93.mp3：原文「I'd have gone with you if you'd asked me.」／認識「I'd have gone with you if you'd ask me.」（違い：asked, ask）
  - audio/dict/5-02_539.mp3：原文「They're supposed to be here by now, aren't they?」／認識「This is supposed to be here by now, aren't they?」（違い：they, this）
  - audio/dict/5-03_539.mp3：原文「What are you going to do about it?」／認識「Were you going to do about it?」（違い：what）
  - audio/dict/5-05_539.mp3：原文「We ought to get going before it gets dark.」／認識「We are to get going before it gets dark.」（違い：ought）
  - audio/dict/5-07_539.mp3：原文「Would you mind if I opened the window a little?」／認識「Would you mind if I open the window a little?」（違い：opened, open）
  - audio/dict/5-07_93.mp3：原文「Would you mind if I opened the window a little?」／認識「Would you mind if I open the window a little?」（違い：opened, open）
  - audio/dict/5-07_902.mp3：原文「Would you mind if I opened the window a little?」／認識「Would you mind if I open the window a little?」（違い：opened, open）
  - audio/dict/5-07_227.mp3：原文「Would you mind if I opened the window a little?」／認識「Would you mind if I open the window a little?」（違い：opened, open）
  - audio/cs/linking-ex1-natural.mp3：原文「check in」／認識「Chicken」（違い：check, chicken）
  - audio/cs/linking-ex2-words.mp3：原文「an apple」／認識「Ann Apple」（違い：ann）
  - audio/cs/linking-ex4-words.mp3：原文「for an hour」／認識「4 and hour」（違い：four）
  - audio/cs/linking-q2_93.mp3：原文「Take it easy.」／認識「Pick it easy.」（違い：take, pick）
  - audio/cs/linking-q3_227.mp3：原文「Let's eat out tonight.」／認識「Let's eat up tonight.」（違い：out, up）
  - audio/cs/reduction-ex3-words.mp3：原文「kind of tired」／認識「Kind, both tired.」（違い：both）
  - audio/cs/reduction-q4_227.mp3：原文「I ran out of time.」／認識「a run out of time.」（違い：ran, run）
  - audio/cs/elision-ex2-words.mp3：原文「bus stop」／認識「Buss, stop.」（違い：bus, buss）
  - audio/cs/elision-ex2-natural.mp3：原文「bus stop」／認識「Let's stop.」（違い：bus, let）
  - audio/cs/assimilation-ex1-words.mp3：原文「would you」／認識「Wood, you.」（違い：wood）
  - audio/cs/flap-q3_227.mp3：原文「It's a little hot.」／認識「It's a little hawk.」（違い：hot, hawk）
  - audio/sh/1-a-3_539.mp3：原文「Then I walk to the station.」／認識「Then I walked to the station.」（違い：walk, walked）
  - audio/sh/1-a-3_902.mp3：原文「Then I walk to the station.」／認識「Then I walked to the station.」（違い：walk, walked）
  - audio/sh/1-b-4_93.mp3：原文「We walk him every evening.」／認識「We welcome every evening.」（違い：walk, welcome）
  - audio/sh/1-b-4_227.mp3：原文「We walk him every evening.」／認識「We welcome every evening.」（違い：walk, welcome）
  - audio/sh/2-a-0_93.mp3：原文「What are you doing this weekend?」／認識「Where are you doing this weekend?」（違い：what, where）
  - audio/sh/2-a-3_539.mp3：原文「Do you want to come with us?」／認識「You will have come with us」（違い：want, will）
  - audio/sh/2-a-3_93.mp3：原文「Do you want to come with us?」／認識「Do you want me to come with us?」（違い：me）
  - audio/sh/2-b-3_93.mp3：原文「For here or to go?」／認識「We're here to go.」（違い：we）
  - audio/sh/2-b-3_902.mp3：原文「For here or to go?」／認識「We're here or to go.」（違い：we）
  - audio/sh/2-b-3_227.mp3：原文「For here or to go?」／認識「We're here to go.」（違い：we）
  - audio/sh/3-a-0_227.mp3：原文「It started raining when I left the office.」／認識「It started raining while I left the office.」（違い：when, while）
  - audio/sh/3-b-0_902.mp3：原文「I've been studying English for about a year.」／認識「I've been study, English for about a year.」（違い：studying, study）
  - audio/sh/4-a-0_539.mp3：原文「These days, a lot of people work from home.」／認識「He's days a lot of people work from home.」（違い：these, he's）
- 注意：単語1つだけの音声認識は誤りやすく、不一致は「要確認」であって「誤り」ではない。

## 6. 正解ラベルの確認状況
| 種類 | 自動確認の結果 | 件数 |
|---|---|---|
| 強勢の単語 | 発音記号で照合済み（音での強さは未確認） | 42 |
| 文の強い語 | 合格 | 2 |
| 文の強い語 | 要確認 | 10 |
| 聞き分けの単語 | 合格 | 177 |
| 聞き分けの単語 | 要確認 | 39 |
| 音の変化の例 | 自動確認できない | 5 |

人による確認：未確認 179件、1件確認・問題なし 93件、2件確認・問題なし 3件

## 7. 自動では確認できないこと（未確認として扱う）
- 音の変化の例文で、TTS が実際に連結・脱落などを起こしているか
- 単語の強勢が、音として（長さ・強さで）知覚できるか（発音記号との照合のみ）
- 文の強い語の判定は、語の長さ×音量による簡易推定
- 音声の自然さ（機械っぽさ）
