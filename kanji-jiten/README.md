# 字引きたんけん隊（漢字辞典の使い方アプリ）

## 使い方
1. `kanji_jiten_hikikata.html` と `data/` フォルダを、`kakijun` 本体の `svg/` フォルダと同じ構成で置く
   - このアプリは `../svg/{code}.svg` を参照するため、`kakijun/kanji-jiten/` から親フォルダの `svg/` にある全漢字を読み込みます
2. GitHub Pagesなど、http(s)経由で公開する
   - `fetch()` でデータを読み込む構成のため、`index.html` をローカルでダブルクリックして `file://` で開くと読み込めません。ローカルで確認したい場合は `python3 -m http.server` などの簡易サーバー越しに開いてください

## ファイル構成
```
index.html          … アプリ本体（部首さく引・音訓さく引・総画さく引の3モード）
data/kanji_data.json … 各漢字の部首・総画数・読み方・意味データ
../svg/*.svg          … kakijun本体にあるKanjiVGの筆順SVG
```

## 漢字を追加する方法
1. `data/kanji_data.json` に1エントリ追加（char, code, radical, radicalName, radicalStrokes, totalStrokes, on, kun, meaning, page）
   - `code` はUnicodeコードポイントの16進5桁（例：「連」なら `09023`）。Pythonなら `hex(ord('連'))[2:].zfill(5)` で確認できる
2. その `code.svg` が `kakijun/svg/` フォルダに存在するか確認する
3. 部首名（「てへん」など）と部首の代表画数だけは自動データに無いため手作業で確認する。総画数・音訓・学年はKanjiVGベースのデータで概ね正確（しんにょう「⻌」を含む漢字だけ、実際の教科書値と1画ずれることがあるため要注意）

## ライセンス表記
筆順データはKanjiVGプロジェクト（Ulrich Apel氏）のものです。
CC BY-SA 3.0ライセンスに基づき、以下を表示しています（アプリのフッターにも記載済み）。
- 出典: KanjiVG (https://kanjivg.tagaini.net/)
- ライセンス: Creative Commons Attribution-Share Alike 3.0
