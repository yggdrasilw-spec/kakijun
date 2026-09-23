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
const radicalReference = JSON.parse(fs.readFileSync(path.join(dataDir, 'radical_reference.json'), 'utf8'));

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
      if (g && g.radical && g.end >= g.start) found.push({ element:g.element, position:g.position, start:g.start, end:g.end, radical:true });
      continue;
    }
    const a = attrs(tag);
    // "jis" は KanjiVG の旧JIS由来タグ。辞書の部首形に一致した場合だけ後段で採用する。
    stack.push({ element:a['kvg:element'] || '部品', position:a['kvg:position']||'', start:pathIndex, end:pathIndex-1, radical:['general','tradit','jis'].includes(a['kvg:radical']) });
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
      if (g && g.end >= g.start && (g.element || g.position)) found.push(g);
      continue;
    }
    const a = attrs(tag);
    stack.push({ element:a['kvg:element'], position:a['kvg:position'] || '', start:pathIndex, end:pathIndex-1 });
  }
  return found;
}

for (const char of Object.keys(meta)) {
  const code = char.codePointAt(0).toString(16).padStart(5, '0');
  if (parts[code]) continue;
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
    const ranges=part.ranges||[[part.start,part.end]];
    if(!part.radical && !part.element.includes('・') && (radicals[char]||[]).includes(part.element) && !groups.some(g=>g.element===part.element&&ranges.some(([a,b])=>g.start<=a&&g.end>=b))) part.element='部品';
    const hit = groups.filter(g => (!g.element || g.element === part.element) && g.start <= part.start && g.end >= part.end)
      .sort((a,b)=>(a.end-a.start)-(b.end-b.start))[0];
    if (hit && hit.position) part.position = hit.position;
  });
}

// KANJIDIC2の部首形に一致する、SVG上で明示された部首グループを優先する。
for(const [char,info] of Object.entries(meta)){
  const code=char.codePointAt(0).toString(16).padStart(5,'0');
  const current=parts[code]||[];
  const radical=String.fromCodePoint(0x2f00+info.radicalNumber-1).normalize('NFKC');
  const forms=new Set((radicalReference.radicalForms[radical]||[radical]).map(x=>x.normalize('NFKC')));
  const svgFile=path.join(__dirname,'..','..','svg',`${code}.svg`);
  if(!current.length||!fs.existsSync(svgFile)) continue;
  const tagged=radicalGroupsFromSvg(svgFile).filter(g=>forms.has((g.element||'').normalize('NFKC')));
  if(!tagged.length) continue;
  const ranges=[];
  tagged.sort((a,b)=>a.start-b.start).forEach(g=>{
    const last=ranges[ranges.length-1];
    if(last&&g.start<=last[1]+1) last[1]=Math.max(last[1],g.end); else ranges.push([g.start,g.end]);
  });
  current.forEach(p=>{
    if(p.radical || ranges.some(([a,b])=>(p.ranges||[[p.start,p.end]]).some(([s,e])=>s<=b&&e>=a))) {
      p.radical=false;
      if(ranges.some(([a,b])=>(p.ranges||[[p.start,p.end]]).some(([s,e])=>s<=b&&e>=a))) p.element='その他の部分';
    }
  });
  const chosen=tagged[0];
  current.unshift({element:chosen.element,position:chosen.position||'',start:ranges[0][0],end:ranges[ranges.length-1][1],ranges,radical:true});
}

// 「部品」グループは、KanjiVG由来の部品一覧から既知の隣接要素を割り当てる。
// 一つのまとまりに複数要素が含まれる場合は、作り名を捏造せず列挙する。
for (const [char] of Object.entries(meta)) {
  const code=char.codePointAt(0).toString(16).padStart(5,'0');
  const items=parts[code]||[];
  const generic=items.filter(p=>['部品','単独画','全体','その他の部分'].includes(p.element));
  if(generic.length!==1) continue;
  const remaining=(radicals[char]||[]).map(x=>x.normalize('NFKC'));
  items.filter(p=>!generic.includes(p)).forEach(p=>{
    const i=remaining.indexOf((p.element||'').normalize('NFKC'));
    if(i>=0) remaining.splice(i,1);
  });
  if(remaining.length>=2) generic[0].element=remaining.join('・');
}

// 各筆画を1つの選択部品だけに所属させ、重複着色と無所属の画をなくす。
for (const [char, info] of Object.entries(meta)) {
  const code = char.codePointAt(0).toString(16).padStart(5, '0');
  const source = parts[code] || [];
  if (!source.length) continue;
  const radical = String.fromCodePoint(0x2f00 + info.radicalNumber - 1).normalize('NFKC');
  const ownForms = (radicalReference.radicalForms[radical] || [radical]).map(x=>x.normalize('NFKC'));
  if (ownForms.includes(char.normalize('NFKC'))) {
    parts[code] = [{element:char,position:'whole',start:0,end:info.strokes-1,ranges:[[0,info.strokes-1]],radical:true}];
    continue;
  }
  const whole = source.find(p => p.radical && p.start <= 0 && p.end >= info.strokes - 1);
  if (whole) {
    parts[code] = [{ ...whole, start:0, end:info.strokes-1, ranges:[[0,info.strokes-1]] }];
    continue;
  }
  const owners = Array(info.strokes).fill(-1);
  source.map((part,i)=>({part,i})).sort((a,b)=>Number(b.part.radical)-Number(a.part.radical)||a.i-b.i).forEach(({part,i})=>{
    for(let stroke=Math.max(0,part.start);stroke<=Math.min(info.strokes-1,part.end);stroke++) if(owners[stroke]===-1) owners[stroke]=i;
  });
  const normalized=[];
  for(let i=0;i<source.length;i++){
    const strokes=owners.map((owner,n)=>owner===i?n:-1).filter(n=>n>=0);
    if(!strokes.length) continue;
    const ranges=[];let start=strokes[0],end=start;
    for(const n of strokes.slice(1)){if(n===end+1)end=n;else{ranges.push([start,end]);start=end=n;}}
    ranges.push([start,end]);
    normalized.push({...source[i],start:ranges[0][0],end:ranges[ranges.length-1][1],ranges});
  }
  const gaps=owners.map((owner,n)=>owner===-1?n:-1).filter(n=>n>=0);
  if(gaps.length){
    const ranges=[];let start=gaps[0],end=start;
    for(const n of gaps.slice(1)){if(n===end+1)end=n;else{ranges.push([start,end]);start=end=n;}}
    ranges.push([start,end]);
    normalized.push({element:'その他の部分',position:'unknown',start:ranges[0][0],end:ranges[ranges.length-1][1],ranges,radical:false});
  }
  parts[code]=normalized;
}

fs.writeFileSync(path.join(dataDir, 'kanji_parts.json'), JSON.stringify(parts, null, 2) + '\n');

for (const [char, info] of Object.entries(meta)) {
  const code = char.codePointAt(0).toString(16).padStart(5, '0');
  const items = parts[code];
  const radicalChar = String.fromCodePoint(0x2f00 + info.radicalNumber - 1);
  const canonicalRadical = radicalChar.normalize('NFKC');
  const candidates = new Set((radicalReference.radicalForms[canonicalRadical] || [canonicalRadical]).map(x => x.normalize('NFKC')));
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
      dictionaryReview[char] = { radicalNumber: info.radicalNumber, dictionaryRadical: canonicalRadical, svgParts: items.map(x => x.element), selectedParts: exact.map(x => x.element), status: '一致' };
  } else {
    const flagged = items.filter(item => item.radical);
    if (flagged.length === 1) {
      statuses.fallback++;
      report[char] = { status: 'review', radicalNumber: info.radicalNumber, radicalChar: canonicalRadical, flagged: flagged.map(x => x.element) };
      dictionaryReview[char] = { radicalNumber: info.radicalNumber, dictionaryRadical: canonicalRadical, svgParts: items.map(x => x.element), selectedParts: flagged.map(x => x.element), status: '要確認', reason: 'KANJIDIC2の部首異体形一覧に選択部品が含まれない' };
    } else {
      statuses.candidate++;
      report[char] = { status: 'review', radicalNumber: info.radicalNumber, radicalChar, elements: items.map(x => x.element) };
      dictionaryReview[char] = { radicalNumber: info.radicalNumber, dictionaryRadical: radicalChar, svgParts: items.map(x => x.element), status: '要確認' };
    }
  }
}

fs.writeFileSync(path.join(dataDir, 'bushu_validation.json'), JSON.stringify({ generatedBy: 'validate_bushu_data.js', statuses, report }, null, 2) + '\n');
fs.writeFileSync(path.join(dataDir, 'bushu_dictionary_review.json'), JSON.stringify({ source: 'KANJIDIC2 radical number + curated Japanese radical-form equivalences', entries: dictionaryReview }, null, 2) + '\n');
console.log(statuses);
