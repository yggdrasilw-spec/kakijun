/*
 * KANJIDIC2 の康熙部首番号と、KanjiVG由来の部品データを照合する監査ツール。
 * 実行: node scripts/validate_bushu_data.js
 */
const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'data');
const parts = JSON.parse(fs.readFileSync(path.join(dataDir, 'kanji_parts.json'), 'utf8'));
const radicals = JSON.parse(fs.readFileSync(path.join(dataDir, 'kanji2radical.json'), 'utf8'));
const meta = JSON.parse(fs.readFileSync(path.join(dataDir, 'kanjidic2_school.json'), 'utf8'));

const statuses = { exact: 0, candidate: 0, fallback: 0, missing: 0 };
const report = {};

// 不足している漢字だけ、同梱KanjiVGから直下部品を復元する。
// DOMを持たないNodeでも実行できるよう、g/pathの構造だけを読む。
function partsFromSvgFile(file) {
  const text = fs.readFileSync(file, 'utf8').replace(/<!DOCTYPE[\s\S]*?\]>/, '');
  const token = /<g\b[^>]*>|<\/g\s*>|<path\b[^>]*>/g;
  const stack = [];
  const candidates = [];
  let pathIndex = 0;
  const attrs = (tag) => Object.fromEntries([...tag.matchAll(/([:\w-]+)\s*=\s*"([^"]*)"/g)].map(m => [m[1], m[2]]));
  for (const match of text.matchAll(token)) {
    const tag = match[0];
    if (tag.startsWith('<path')) { stack.forEach(g => { g.end = pathIndex; }); pathIndex++; continue; }
    if (tag.startsWith('</')) {
      const group = stack.pop();
      if (!group) continue;
      if (group.radical) group.hasRadical = true;
      if (stack.length && group.hasRadical) stack[stack.length - 1].hasRadical = true;
      continue;
    }
    const a = attrs(tag);
    const group = { element: a['kvg:element'], start: pathIndex, end: pathIndex - 1, radical: ['general', 'tradit'].includes(a['kvg:radical']), hasRadical: false, depth: stack.length };
    // StrokePathsの外側グループを除き、漢字ルート直下の子だけを候補にする。
    if (stack.length === 2 && group.element) candidates.push(group);
    stack.push(group);
  }
  return candidates.filter(g => g.end >= g.start).map(g => ({
    element: g.element,
    start: g.start,
    end: g.end,
    radical: g.radical || g.hasRadical
  }));
}

const originallyMissing = new Set('井茨岡沖賀潟岐熊潔香佐細阪崎埼滋鹿得特栃奈縄俳媛阜夢梨'.split(''));
for (const char of Object.keys(meta)) {
  const code = char.codePointAt(0).toString(16).padStart(5, '0');
  if (parts[code] && !originallyMissing.has(char)) continue;
  const svgFile = path.join(__dirname, '..', '..', 'svg', `${code}.svg`);
  if (fs.existsSync(svgFile)) {
    const recovered = partsFromSvgFile(svgFile);
    if (recovered && recovered.length) parts[code] = recovered;
  }
}

// 康熙部首文字とSVGの汎用ラベル（単独画/部品）を正規化する。
// SVG上の実際の筆画範囲は保持し、表示ラベルだけを辞書上の部首へ寄せる。
for (const [char, info] of Object.entries(meta)) {
  const code = char.codePointAt(0).toString(16).padStart(5, '0');
  const items = parts[code];
  if (!items) continue;
  const radical = String.fromCodePoint(0x2f00 + info.radicalNumber - 1).normalize('NFKC');
  const candidates = new Set([radical, ...(radicals[char] || []).map(x => x.normalize('NFKC'))]);
  const flagged = items.filter(item => item.radical);
  if (flagged.some(item => candidates.has((item.element || '').normalize('NFKC')))) continue;
  if (flagged.length === 1 && ['単独画', '部品', '全体'].includes(flagged[0].element)) {
    flagged[0].element = radical;
  }
}
fs.writeFileSync(path.join(dataDir, 'kanji_parts.json'), JSON.stringify(parts, null, 2) + '\n');

for (const [char, info] of Object.entries(meta)) {
  const code = char.codePointAt(0).toString(16).padStart(5, '0');
  const items = parts[code];
  const radicalChar = String.fromCodePoint(0x2f00 + info.radicalNumber - 1);
  const candidates = new Set([radicalChar, ...(radicals[char] || [])]);
  if (!items) {
    statuses.missing++;
    report[char] = { status: 'missing', radicalNumber: info.radicalNumber, radicalChar };
    continue;
  }
  const exact = items.filter(item => item.element && candidates.has(item.element));
  if (exact.length) {
    statuses.exact++;
    report[char] = { status: 'exact', radicalNumber: info.radicalNumber, radicalChar, matched: exact.map(x => x.element) };
  } else {
    const flagged = items.filter(item => item.radical);
    if (flagged.length === 1) {
      statuses.fallback++;
      report[char] = { status: 'fallback', radicalNumber: info.radicalNumber, radicalChar, flagged: flagged.map(x => x.element) };
    } else {
      statuses.candidate++;
      report[char] = { status: 'review', radicalNumber: info.radicalNumber, radicalChar, elements: items.map(x => x.element) };
    }
  }
}

fs.writeFileSync(path.join(dataDir, 'bushu_validation.json'), JSON.stringify({ generatedBy: 'validate_bushu_data.js', statuses, report }, null, 2) + '\n');
console.log(statuses);
