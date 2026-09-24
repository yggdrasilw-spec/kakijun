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
- `data/bushu_kanjipedia_audit.json`：教育漢字1,026字の漢字ペディア字別部首画像・索引名・出典URL。索引上の重複掲載と、KANJIDIC2番号との機械的な不一致候補も別記
- `../svg/`：KanjiVGの筆順SVG

部品の分割表示はKanjiVG SVGの画範囲を使い、部品名と小学校漢字の対象範囲は上記のデータを使う。漢字を追加するときは、KANJIDIC2の対象データと対応するKanjiVG SVGを追加する。

部品名は辞書・教科書で呼び方が分かれることがあるため、「のぶん（ぼくづくり）」のように代表名と別称を併記する場合がある。「へん」は左側にある場合だけ付ける。呼び名が特定できない複合部品は、根拠のない通称を付けず、構成要素または位置と画数で表示する。部首と部品の照合にはKANJIDIC2の部首番号を使い、KanjiVGの一般部品候補だけでは正解と判定しない。

全字照合では、漢字ペディアの部首索引214ページと教育漢字の字別ページ1,026件を取得し、字別ページの部首画像IDを同じ索引IDの部首名に結び付けている。部首の異体形や辞書間の分類差があるため、番号の自動一致だけを個別確認済みとは扱わない。`numberCrosswalkReviewCandidates` は辞書の誤り一覧ではなく、KANJIDIC2との番号対応に別途判断が必要な候補。個別に判断した字形差は `radical_reference.json` の `radicalOverrides` に根拠ページとともに記録する。監査一覧は `bushu_review.html` で全字検索・出典表示できる。

字別ページの総画数から「部首内画数」を引いた部首画数を、KanjiVGの部首候補画数と照合する監査も実行する。画数比較は構造的な警告検出であって、形の正しさを単独で証明するものではない。現在は1,024字が自動または個別規則で照合され、母・表の2字は画数差が解決していないためレビュー対象（クイズから除外）。検証データの「matched」は機械的な構造照合を表し、人手で正しさを保証した意味ではない。部首内画数0の字（例：歯、申）は字全体が部首となるため、分割クイズには含めない。

出典データを更新するときは `node scripts/audit_kanjipedia_radicals.js` を実行する（外部サイトへ低頻度でアクセス）。既に取得した監査JSONへ索引名の対応だけ再計算する場合は `node scripts/audit_kanjipedia_radicals.js --enrich-existing` を使う。

部品名の表記確認には[漢字ペディアの部首索引](https://www.kanjipedia.jp/sakuin/bushu/1)、[漢字辞典オンラインの偏旁冠脚の説明](https://kanji.jitenon.jp/content/1)、[教育出版の小学校国語指導資料](https://www.kyoiku-shuppan.co.jp/textbook/shou/kokugo/files/r6kokugo4_nenkeihyouka_2309.pdf)を参照。辞書間の異名が示されている場合は一つに決めつけない。

## ライセンス表記
筆順データはKanjiVGプロジェクトのもの（CC BY-SA 3.0）。出典はアプリのフッターに記載済み。
