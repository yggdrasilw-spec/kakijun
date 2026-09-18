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
- `../svg/`：KanjiVGの筆順SVG

部品の分割表示はKanjiVG SVGの画範囲を使い、部品名と小学校漢字の対象範囲は上記のデータを使う。漢字を追加するときは、KANJIDIC2の対象データと対応するKanjiVG SVGを追加する。

## ライセンス表記
筆順データはKanjiVGプロジェクトのもの（CC BY-SA 3.0）。出典はアプリのフッターに記載済み。
