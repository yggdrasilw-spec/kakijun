# 部首ハンター

漢字のパーツをタップして部首を当てるクイズゲーム。「漢字辞典の使い方アプリ」の部品タップ機能をゲーム化した別アプリ。

## 使い方
1. `bushu_hunter.html` と `data/` を `kakijun` 本体の `svg/` フォルダと同じリポジトリ内に置く
   - 筆順SVGは親フォルダの `svg/{code}.svg` を参照する
   - 小学校で習う漢字は `kakijun.html` の学年別配当表から読み込み、1〜6年を選べる
2. http(s)経由で公開する（`fetch()`を使うため`file://`では動きません）

## モード
- ⏱ タイムアタック：10問の合計スコア・タイムを競う
- ❤ サバイバル：ライフ3つ、ミスするまで何問続くか
- 🌱 れんしゅう：タイマーなし、じっくり型

## データの出典
- `data/kanji2radical.json`：yagays/kanjivg-radical のKanjiVG由来の直下部品データ（CC BY-SA 4.0）
- `data/kanjidic2_school.json`：EDRDG KANJIDIC2から抽出した小学校漢字の学年・総画数・康熙部首番号（CC BY-SA 4.0）
- `data/radical_reference.json`：部首の異体形照合と、よく使われる部品の通称。位置により「へん／かんむり／あし／にょう」等が変わるものは個別に登録
- `data/bushu_validation.json`：KANJIDIC2の部首番号と部品形の照合結果。未一致はクイズから外し、要確認一覧に残す
- `../svg/`：KanjiVGの筆順SVG

部品の分割表示はKanjiVG SVGの画範囲を使い、部品名と小学校漢字の対象範囲は上記のデータを使う。漢字を追加するときは、KANJIDIC2の対象データと対応するKanjiVG SVGを追加する。

部品名は辞書・教科書で呼び方が分かれることがあるため、「のぶん（ぼくづくり）」のように代表名と別称を併記する場合がある。「へん」は左側にある場合だけ付ける。呼び名が特定できない複合部品は、根拠のない通称を付けず、構成要素または位置と画数で表示する。部首と部品の照合にはKANJIDIC2の部首番号を使い、KanjiVGの一般部品候補だけでは正解と判定しない。

部品名の表記確認には[漢字ペディアの部首索引](https://www.kanjipedia.jp/sakuin/bushu/1)、[漢字辞典オンラインの偏旁冠脚の説明](https://kanji.jitenon.jp/content/1)、[教育出版の小学校国語指導資料](https://www.kyoiku-shuppan.co.jp/textbook/shou/kokugo/files/r6kokugo4_nenkeihyouka_2309.pdf)を参照。辞書間の異名が示されている場合は一つに決めつけない。

## ライセンス表記
筆順データはKanjiVGプロジェクトのもの（CC BY-SA 3.0）。出典はアプリのフッターに記載済み。
