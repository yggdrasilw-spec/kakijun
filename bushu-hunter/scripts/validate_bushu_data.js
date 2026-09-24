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
const kanjipediaAuditPath = path.join(dataDir, 'bushu_kanjipedia_audit.json');
const kanjipediaAudit = fs.existsSync(kanjipediaAuditPath) ? JSON.parse(fs.readFileSync(kanjipediaAuditPath, 'utf8')) : { entries: {} };

const statuses = { matched: 0, candidate: 0, fallback: 0, missing: 0 };
const report = {};
const dictionaryReview = {};

function dictionaryReviewEntry(char, info, items, selectedParts, status, override, extra = {}) {
  const source = kanjipediaAudit.entries?.[char] || {};
  const sourceRadical = source.dictionaryRadical || {};
  const sourceLabels = sourceRadical.indexLabels || [];
  const radicalChar = String.fromCodePoint(0x2f00 + info.radicalNumber - 1).normalize('NFKC');
  return {
    radicalNumber: info.radicalNumber,
    kanjidic2Radical: radicalChar,
    dictionaryRadical: override?.dictionaryRadical || sourceLabels.join('・') || radicalChar,
    svgParts: items.map(x => x.element),
    selectedParts,
    status,
    ...(override ? { overrideReason: override.reason, sources: override.sources || [override.source] } : {}),
    ...(sourceRadical.image ? { kanjipedia: { imageId: sourceRadical.image, indexLabels: sourceLabels, characterPage: source.kanjipediaCharacterUrl, indexPage: sourceRadical.indexUrl, image: sourceRadical.imageUrl } } : {}),
    ...extra
  };
}

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
  const override=radicalReference.radicalOverrides?.[char];
  const svgFile=path.join(__dirname,'..','..','svg',`${code}.svg`);
  if(!current.length||!fs.existsSync(svgFile)) continue;
  let tagged=radicalGroupsFromSvg(svgFile).filter(g=>override ? g.element===override.svgElement : forms.has((g.element||'').normalize('NFKC')));
  // 教育字形の辞書がKanjiVGのradical tagと異なる部首を採る場合、
  // 明示 override に限って同名の構造グループをSVGから取得する。
  if(override&&!tagged.length){
    tagged=componentPositionsFromSvg(svgFile).filter(g=>g.element===override.svgElement&&g.end>=g.start)
      .sort((a,b)=>(a.end-a.start)-(b.end-b.start)).slice(0,1).map(g=>({...g,radical:true}));
  }
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
  current.unshift({element:override?.displayElement||chosen.element,position:chosen.position||'',start:ranges[0][0],end:ranges[ranges.length-1][1],ranges,radical:true});
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
  const whole = source.find(p => {
    if(!p.radical) return false;
    const selected=Array(info.strokes).fill(false);
    (p.ranges||[[p.start,p.end]]).forEach(([start,end])=>{
      for(let stroke=Math.max(0,start);stroke<=Math.min(info.strokes-1,end);stroke++) selected[stroke]=true;
    });
    return selected.every(Boolean);
  });
  if (whole) {
    parts[code] = [{ ...whole, start:0, end:info.strokes-1, ranges:[[0,info.strokes-1]] }];
    continue;
  }
  const owners = Array(info.strokes).fill(-1);
  source.map((part,i)=>({part,i})).sort((a,b)=>Number(b.part.radical)-Number(a.part.radical)||a.i-b.i).forEach(({part,i})=>{
    (part.ranges||[[part.start,part.end]]).forEach(([start,end])=>{
      for(let stroke=Math.max(0,start);stroke<=Math.min(info.strokes-1,end);stroke++) if(owners[stroke]===-1) owners[stroke]=i;
    });
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

for (const [char, info] of Object.entries(meta)) {
  const code = char.codePointAt(0).toString(16).padStart(5, '0');
  const items = parts[code];
  const radicalChar = String.fromCodePoint(0x2f00 + info.radicalNumber - 1);
  const canonicalRadical = radicalChar.normalize('NFKC');
  const candidates = new Set((radicalReference.radicalForms[canonicalRadical] || [canonicalRadical]).map(x => x.normalize('NFKC')));
  const override = radicalReference.radicalOverrides?.[char];
  if (!items) {
    statuses.missing++;
    report[char] = { status: 'missing', radicalNumber: info.radicalNumber, radicalChar };
    dictionaryReview[char] = dictionaryReviewEntry(char, info, [], [], '未生成');
    continue;
  }
  if (override?.wholeCharacterRadical) {
    // 辞典で部首内画数0の字は、字全体が部首。画群を擬似分割せずゲーム対象外にする。
    const allParts = items.map(item => ({ ...item, radical: true }));
    parts[code] = allParts;
    statuses.matched++;
    report[char] = { status: 'matched', method: 'dictionary-whole-character-radical', radicalNumber: info.radicalNumber, radicalChar, matched: allParts.map(x => x.element) };
    dictionaryReview[char] = dictionaryReviewEntry(char, info, allParts, allParts.map(x => x.element), '辞書部首（字全体）', override);
    continue;
  }
  if (override && ['弱', '老', '申', '興'].includes(char)) {
    if (char === '老') {
      parts[code] = items.map(item => ({ ...item, radical: false }));
      parts[code].unshift({ element: '耂', position: 'tare', start: 0, end: 3, ranges: [[0, 3]], radical: true });
      parts[code].push({ element: '匕', position: 'tarec', start: 4, end: 5, ranges: [[4, 5]], radical: false });
    } else if (char === '申') {
      parts[code] = items.map(item => ({ ...item, radical: true }));
    }
    else if (char === '弱') {
      // 部首画数は3画。左側の弓だけを選び、右側の同形部品と混同しない。
      parts[code] = items.map(item => item.element === '弓'
        ? { ...item, start: 0, end: 2, ranges: [[0, 2]], radical: true }
        : { ...item, radical: false });
    } else if (char === '興') {
      // 伝統部首タグが興全体へ伝播するため、上部の臼形6画だけを選ぶ。
      parts[code] = items.map(item => ({ ...item, radical: false }));
      parts[code].unshift({ element: '臼', position: 'top', start: 0, end: 5, ranges: [[0, 5]], radical: true });
      parts[code].push({ element: 'その他の部分', position: 'remainder', start: 6, end: 15, ranges: [[6, 15]], radical: false });
    }
    const chosen = parts[code].filter(item => item.radical);
    statuses.matched++;
    report[char] = { status: 'matched', method: 'curated-dictionary-override', radicalNumber: info.radicalNumber, radicalChar, matched: chosen.map(x => x.element) };
    dictionaryReview[char] = dictionaryReviewEntry(char, info, parts[code], chosen.map(x => x.element), '個別規則適用', override);
    continue;
  }
  if (['母', '表'].includes(char)) {
    statuses.candidate++;
    report[char] = { status: 'review', method: 'dictionary-svg-stroke-count-disagreement', radicalNumber: info.radicalNumber, radicalChar, flagged: items.filter(item => item.radical).map(x => x.element) };
    dictionaryReview[char] = dictionaryReviewEntry(char, info, items, items.filter(item => item.radical).map(x => x.element), '要確認（部首画数不一致）', override);
    continue;
  }
  const exact = items.filter(item => item.radical && item.element && (candidates.has(item.element.normalize('NFKC')) || (override && item.element===override.displayElement)));
  if (exact.length) {
    statuses.matched++;
    report[char] = { status: 'matched', method: override ? 'curated-dictionary-override' : 'KANJIDIC2-form-match', radicalNumber: info.radicalNumber, radicalChar, matched: exact.map(x => x.element) };
    dictionaryReview[char] = dictionaryReviewEntry(char, info, items, exact.map(x => x.element), override ? '個別規則適用' : '自動部品照合', override);
  } else {
    const flagged = items.filter(item => item.radical);
    if (flagged.length === 1) {
      statuses.fallback++;
      report[char] = { status: 'review', radicalNumber: info.radicalNumber, radicalChar: canonicalRadical, flagged: flagged.map(x => x.element) };
      dictionaryReview[char] = dictionaryReviewEntry(char, info, items, flagged.map(x => x.element), '要確認', override, { reason: 'KANJIDIC2の部首異体形一覧に選択部品が含まれない' });
    } else {
      statuses.candidate++;
      report[char] = { status: 'review', radicalNumber: info.radicalNumber, radicalChar, elements: items.map(x => x.element) };
      dictionaryReview[char] = dictionaryReviewEntry(char, info, items, [], '要確認', override);
    }
  }
}

fs.writeFileSync(path.join(dataDir, 'kanji_parts.json'), JSON.stringify(parts, null, 2) + '\n');
fs.writeFileSync(path.join(dataDir, 'bushu_validation.json'), JSON.stringify({ generatedBy: 'validate_bushu_data.js', statuses, report }, null, 2) + '\n');
fs.writeFileSync(path.join(dataDir, 'bushu_dictionary_review.json'), JSON.stringify({ source: 'KANJIDIC2 radical number + curated Japanese radical-form equivalences', entries: dictionaryReview }, null, 2) + '\n');
console.log(statuses);
