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
const dictionaryReview = {};

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

function radicalGroupsFromSvg(file) {
  const text = fs.readFileSync(file, 'utf8').replace(/<!DOCTYPE[\s\S]*?\]>/, '');
  const token = /<g\b[^>]*>|<\/g\s*>|<path\b[^>]*>/g;
  const stack = [], found = [];
  let pathIndex = 0;
  const attrs = (tag) => Object.fromEntries([...tag.matchAll(/([:\w-]+)\s*=\s*"([^"]*)"/g)].map(m => [m[1], m[2]]));
  for (const match of text.matchAll(token)) {
    const tag = match[0];
    if (tag.startsWith('<path')) { stack.forEach(g => { g.end = pathIndex; }); pathIndex++; continue; }
    if (tag.startsWith('</')) {
      const g = stack.pop();
      if (g && g.radical && g.end >= g.start) found.push({ element:g.element, start:g.start, end:g.end, radical:true });
      continue;
    }
    const a = attrs(tag);
    stack.push({ element:a['kvg:element'] || '部品', start:pathIndex, end:pathIndex-1, radical:['general','tradit'].includes(a['kvg:radical']) });
  }
  return found;
}

function componentPositionsFromSvg(file) {
  const text = fs.readFileSync(file, 'utf8').replace(/<!DOCTYPE[\s\S]*?\]>/, '');
  const token = /<g\b[^>]*>|<\/g\s*>|<path\b[^>]*>/g;
  const stack = [], found = [];
  let pathIndex = 0;
  const attrs = (tag) => Object.fromEntries([...tag.matchAll(/([:\w-]+)\s*=\s*"([^"]*)"/g)].map(m => [m[1], m[2]]));
  for (const match of text.matchAll(token)) {
    const tag = match[0];
    if (tag.startsWith('<path')) { stack.forEach(g => { g.end = pathIndex; }); pathIndex++; continue; }
    if (tag.startsWith('</')) {
      const g = stack.pop();
      if (g && g.element && g.end >= g.start) found.push(g);
      continue;
    }
    const a = attrs(tag);
    stack.push({ element:a['kvg:element'], position:a['kvg:position'] || '', start:pathIndex, end:pathIndex-1 });
  }
  return found;
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

// SVGの位置情報を既存の部品範囲へ付加する。
for (const [char] of Object.entries(meta)) {
  const code = char.codePointAt(0).toString(16).padStart(5, '0');
  const svgFile = path.join(__dirname, '..', '..', 'svg', `${code}.svg`);
  if (!parts[code] || !fs.existsSync(svgFile)) continue;
  const groups = componentPositionsFromSvg(svgFile);
  parts[code].forEach(part => {
    const hit = groups.find(g => g.element === part.element && g.start <= part.start && g.end >= part.end);
    if (hit && hit.position) part.position = hit.position;
  });
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
  // 康熙部首そのものが字全体になる字（香・鹿・阜など）。
  if (!flagged.length && radical === char) {
    parts[code] = [{ element: char, start: 0, end: info.strokes - 1, radical: true }];
    continue;
  }
  if (flagged.length === 1 && ['単独画', '部品', '全体'].includes(flagged[0].element)) {
    flagged[0].element = radical;
  }
  const svgFile = path.join(__dirname, '..', '..', 'svg', `${code}.svg`);
  if (fs.existsSync(svgFile)) {
    const nested = radicalGroupsFromSvg(svgFile);
    const matching = nested.filter(g => candidates.has((g.element || '').normalize('NFKC')));
    if (matching.length && flagged.length === 1) {
      const chosen = matching.sort((a,b) => (a.end-a.start)-(b.end-b.start))[0];
      flagged[0].start = chosen.start;
      flagged[0].end = chosen.end;
      flagged[0].element = chosen.element;
      flagged[0].radical = true;
    } else if (!matching.length && nested.length === 1 && flagged.length === 1) {
      // 部首属性を持つSVGグループが1つだけなら、名称差があっても範囲は一意。
      const chosen = nested[0];
      flagged[0].start = chosen.start;
      flagged[0].end = chosen.end;
      flagged[0].element = radical;
      flagged[0].radical = true;
    } else if (!matching.length && flagged.length === 1 && nested.length > 1 && new Set(nested.map(g => g.element)).size === 1) {
      // 由のように、同じ部首が複数のSVGグループへ分かれる字は全体を部首範囲にする。
      flagged[0].start = 0;
      flagged[0].end = info.strokes - 1;
      flagged[0].element = radical;
      flagged[0].radical = true;
    }
  }
}
fs.writeFileSync(path.join(dataDir, 'kanji_parts.json'), JSON.stringify(parts, null, 2) + '\n');

for (const [char, info] of Object.entries(meta)) {
  const code = char.codePointAt(0).toString(16).padStart(5, '0');
  const items = parts[code];
  const radicalChar = String.fromCodePoint(0x2f00 + info.radicalNumber - 1);
  const candidates = new Set([radicalChar.normalize('NFKC'), ...(radicals[char] || []).map(x => x.normalize('NFKC'))]);
  if (!items) {
    statuses.missing++;
    report[char] = { status: 'missing', radicalNumber: info.radicalNumber, radicalChar };
    dictionaryReview[char] = { radicalNumber: info.radicalNumber, dictionaryRadical: radicalChar, status: 'missing' };
    continue;
  }
  const exact = items.filter(item => item.radical && item.element && candidates.has(item.element.normalize('NFKC')));
  if (exact.length) {
    statuses.exact++;
    report[char] = { status: 'exact', radicalNumber: info.radicalNumber, radicalChar, matched: exact.map(x => x.element) };
    dictionaryReview[char] = { radicalNumber: info.radicalNumber, dictionaryRadical: radicalChar, svgParts: items.map(x => x.element), selectedParts: exact.map(x => x.element), status: '一致' };
  } else {
    const flagged = items.filter(item => item.radical);
    if (flagged.length === 1) {
      statuses.fallback++;
      report[char] = { status: 'fallback', radicalNumber: info.radicalNumber, radicalChar, flagged: flagged.map(x => x.element) };
      dictionaryReview[char] = { radicalNumber: info.radicalNumber, dictionaryRadical: radicalChar, svgParts: items.map(x => x.element), selectedParts: flagged.map(x => x.element), status: '辞書部首を採用', reason: 'SVG部品名は字形差または入れ子のため直接一致しないが、部首フラグが1つに絞れる' };
    } else {
      statuses.candidate++;
      report[char] = { status: 'review', radicalNumber: info.radicalNumber, radicalChar, elements: items.map(x => x.element) };
      dictionaryReview[char] = { radicalNumber: info.radicalNumber, dictionaryRadical: radicalChar, svgParts: items.map(x => x.element), status: '要確認' };
    }
  }
}

fs.writeFileSync(path.join(dataDir, 'bushu_validation.json'), JSON.stringify({ generatedBy: 'validate_bushu_data.js', statuses, report }, null, 2) + '\n');
fs.writeFileSync(path.join(dataDir, 'bushu_dictionary_review.json'), JSON.stringify({ source: 'KANJIDIC2 radical number + KanjiVG component ranges', entries: dictionaryReview }, null, 2) + '\n');
console.log(statuses);
