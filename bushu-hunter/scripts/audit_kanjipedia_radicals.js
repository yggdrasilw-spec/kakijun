const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = 'https://www.kanjipedia.jp';
const school = require(path.join(ROOT, 'data/kanjidic2_school.json'));
const OUTPUT = path.join(ROOT, 'data/bushu_kanjipedia_audit.json');

function enrichExistingAudit() {
  const audit = JSON.parse(fs.readFileSync(OUTPUT, 'utf8'));
  const school = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/kanjidic2_school.json'), 'utf8'));
  const parts = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/kanji_parts.json'), 'utf8'));
  const radicalReference = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/radical_reference.json'), 'utf8'));
  const groups = Object.values(audit.radicalGroups);
  const linked = linkDictionaryLabels(audit.entries, groups);
  const { crosswalk, anomalies } = buildImageIdCrosswalk(audit.entries);
  audit.counts.directDictionaryPages = Object.values(audit.entries).filter(entry => entry.dictionaryRadical).length;
  audit.counts.dictionaryLabelsLinked = linked;
  audit.counts.numberCrosswalkReviewCandidates = anomalies.length;
  delete audit.counts.inferredDisagreements;
  audit.imageIdCrosswalk = crosswalk;
  audit.numberCrosswalkReviewCandidates = anomalies;
  const radicalStrokeMismatches = [];
  let radicalStrokeComparable = 0;
  for (const [char, entry] of Object.entries(audit.entries)) {
    const radicalInsideStrokeCount = entry.dictionaryRadical?.radicalStrokeCount;
    const totalStrokeCount = entry.dictionaryRadical?.totalStrokeCount;
    if (!Number.isInteger(radicalInsideStrokeCount) || !Number.isInteger(totalStrokeCount) || radicalReference.radicalOverrides?.[char]?.wholeCharacterRadical) continue;
    const code = char.codePointAt(0).toString(16).padStart(5, '0');
    const selected = (parts[code] || []).filter(part => part.radical);
    const svgRadicalStrokeCount = selected.reduce((sum, part) => sum + (part.ranges || [[part.start, part.end]]).reduce((partSum, [start, end]) => partSum + end - start + 1, 0), 0);
    if (radicalReference?.radicalOverrides?.[char]?.wholeCharacterRadical) continue;
    radicalStrokeComparable++;
    const expectedRadicalStrokeCount = totalStrokeCount - radicalInsideStrokeCount;
    if (expectedRadicalStrokeCount !== svgRadicalStrokeCount) radicalStrokeMismatches.push({ char, grade: school[char]?.grade, totalStrokeCount, radicalInsideStrokeCount, expectedRadicalStrokeCount, svgRadicalStrokeCount, radicalLabels: entry.dictionaryRadical.indexLabels, characterPage: entry.kanjipediaCharacterUrl, indexPage: entry.dictionaryRadical.indexUrl });
  }
  audit.radicalStrokeAudit = { method: 'Kanjipedia total strokes minus 部首内画数 compared with selected KanjiVG radical stroke count', compared: radicalStrokeComparable, mismatchCount: radicalStrokeMismatches.length, mismatches: radicalStrokeMismatches };
  audit.counts.radicalStrokeCompared = radicalStrokeComparable;
  audit.counts.radicalStrokeMismatches = radicalStrokeMismatches.length;
  delete audit.numberCrosswalkAnomalies;
  delete audit.disagreements;
  audit.method += ' 一字ページの画像IDを部首索引ページの同じ数値IDへ結び、全字に部首の読み・名称を付与した。番号対応の最頻値と異なる字は辞書差候補として列挙した。';
  fs.writeFileSync(OUTPUT, `${JSON.stringify(audit, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ ...audit.counts, linked }, null, 2));
}

const decode = (value) => value
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0*39;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&#([0-9]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)));

async function get(url) {
  let lastError;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { 'user-agent': 'KakijunSchoolRadicalAudit/1.0 (dictionary cross-check)' }
      });
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
      const html = await response.text();
      if (url.includes('/sakuin/bushu/') && !html.includes('bushuResult') && !html.includes('bushuList02')) {
        throw new Error(`Unexpected page content for ${url}`);
      }
      return html;
    } catch (error) {
      lastError = error;
      await new Promise(resolve => setTimeout(resolve, Math.max(1800, 1800 * (attempt + 1))));
    }
  }
  throw lastError;
}

async function getWithRetry(url) {
  for (let round = 0; round < 5; round++) {
    try { return await get(url); }
    catch (error) {
      if (round === 4) throw error;
      console.warn(`Retry ${round + 1}/5 after ${error.message}`);
      await new Promise(resolve => setTimeout(resolve, 5000 * (round + 1)));
    }
  }
}

function links(html, regex) {
  return [...html.matchAll(regex)].map(match => ({ href: match[1], label: decode(match[2].replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim() }));
}

function categoryRadicals(html) {
  const section = html.match(/<ul class="bushuList02[^>]*>([\s\S]*?)<\/ul>/i)?.[1] || '';
  const found = new Map();
  for (const match of section.matchAll(/<a\b[^>]*href="(\/sakuin\/bushu\/detail\/(\d+)\/(\d+))(?:#[^"]*)?"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const [, route, strokes, id, body] = match;
    const labels = [...body.matchAll(/<img\b[^>]*alt="([^"]*)"/gi)].map(x => decode(x[1]).trim()).filter(Boolean);
    const key = `${strokes}/${id}`;
    found.set(key, { key, strokes: Number(strokes), id: Number(id), route, labels: [...new Set(labels)] });
  }
  return [...found.values()];
}

function schoolCharacters(html) {
  const result = new Map();
  const section = html.match(/<ul id="bushuResult"[^>]*>([\s\S]*?)<\/ul>\s*<div class="pagerSection/i)?.[1] || '';
  for (const match of section.matchAll(/<a\b[^>]*href="(\/kanji\/[^\"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const text = decode(match[2].replace(/<[^>]*>/g, '').trim());
    for (const char of text) if (school[char] && !result.has(char)) result.set(char, match[1]);
  }
  return [...result].map(([char, path]) => ({ char, path }));
}

function dictionaryRadical(html) {
  const match = html.match(/<p class="kanjiBushu">\s*部首：\s*<img\b[^>]*src="([^"]*\/bushu\/16\/([^"/]+\.png))"[^>]*>/i)
    || html.match(/<img\b[^>]*src="([^"]*\/bushu\/16\/([^"/]+\.png))"[^>]*>/i);
  if (!match) return null;
  const inside = html.match(/部首内画数\s*[:：]?\s*(\d+)/i);
  const total = html.match(/画数\s*[:：]?\s*[（(](\d+)[）)]/i);
  return {
    image: match[2].replace(/\.png$/i, ''), imageUrl: `${SOURCE}${match[1]}`,
    ...(inside ? { radicalStrokeCount: Number(inside[1]) } : {}),
    ...(total ? { totalStrokeCount: Number(total[1]) } : {})
  };
}

function linkDictionaryLabels(entries, groups) {
  let linked = 0;
  for (const entry of Object.values(entries)) {
    const radical = entry.dictionaryRadical;
    if (!radical) continue;
    const radicalId = Number(String(radical.image).match(/^\d+/)?.[0]);
    const group = groups.find(item => item.id === radicalId);
    radical.indexLabels = group?.labels || [];
    radical.indexUrl = group?.url || null;
    if (group) linked++;
  }
  return linked;
}

function buildImageIdCrosswalk(entries) {
  const counts = {};
  for (const entry of Object.values(entries)) {
    const image = entry.dictionaryRadical?.image;
    if (!image) continue;
    const radicalId = String(image).match(/^(\d+)/)?.[1];
    if (!radicalId) continue;
    counts[radicalId] ||= {};
    counts[radicalId][entry.currentRadicalNumber] = (counts[radicalId][entry.currentRadicalNumber] || 0) + 1;
  }
  const crosswalk = {};
  for (const [id, values] of Object.entries(counts)) {
    const sorted = Object.entries(values).sort((a, b) => b[1] - a[1] || Number(a[0]) - Number(b[0]));
    const total = sorted.reduce((sum, [, n]) => sum + n, 0);
    const topNumbers = sorted.filter(([, n]) => n === sorted[0][1]).map(([n]) => Number(n));
    crosswalk[id] = { inferredRadicalNumber: topNumbers.length === 1 ? topNumbers[0] : null, topNumbers, support: sorted[0][1], total, alternatives: sorted.slice(topNumbers.length).map(([radicalNumber, n]) => ({ radicalNumber: Number(radicalNumber), count: n })) };
  }
  const anomalies = Object.entries(entries).flatMap(([char, entry]) => {
    const image = entry.dictionaryRadical?.image;
    const id = image && String(image).match(/^(\d+)/)?.[1];
    const mapping = id && crosswalk[id];
    if (!mapping || (mapping.inferredRadicalNumber !== null && mapping.inferredRadicalNumber === entry.currentRadicalNumber)) return [];
    return [{ char, currentRadicalNumber: entry.currentRadicalNumber, dictionaryImage: image, dictionaryLabels: entry.dictionaryRadical.indexLabels, inferredRadicalNumber: mapping.inferredRadicalNumber, topNumbers: mapping.topNumbers, mappingSupport: `${mapping.support}/${mapping.total}`, status: mapping.inferredRadicalNumber === null ? 'ambiguous-image-id-family' : 'majority-mapping-outlier', characterPage: entry.kanjipediaCharacterUrl, indexPage: entry.dictionaryRadical.indexUrl }];
  });
  return { crosswalk, anomalies };
}

async function main() {
  const radicals = new Map();
  for (let strokes = 1; strokes <= 17; strokes++) {
    const html = await get(`${SOURCE}/sakuin/bushu/${strokes}`);
    for (const radical of categoryRadicals(html)) radicals.set(radical.key, radical);
    await new Promise(resolve => setTimeout(resolve, 180));
  }

  const charIndex = new Map(Object.keys(school).map(char => [char, []]));
  const characterPages = new Map();
  const entries = {};
  let done = 0;
  for (const radical of radicals.values()) {
    const html = await get(`${SOURCE}${radical.route}`);
    radical.labels = [...new Set([...radical.labels, ...[...html.matchAll(/<ul id="bushuResult"[^>]*>[\s\S]*?<img\b[^>]*alt="([^"]*)"/gi)].map(x => decode(x[1]).trim()).filter(Boolean)])];
    radical.url = `${SOURCE}${radical.route}`;
    radical.kanji = schoolCharacters(html).sort((a, b) => a.char.localeCompare(b.char, 'ja'));
    for (const { char, path: characterPath } of radical.kanji) {
      charIndex.get(char).push(radical.key);
      if (!characterPages.has(char)) characterPages.set(char, characterPath);
    }
    done++;
    if (done % 25 === 0) process.stdout.write(`Fetched ${done}/${radicals.size} radical pages\n`);
    await new Promise(resolve => setTimeout(resolve, 180));
  }

  let characterDone = 0;
  for (const [char, characterPath] of characterPages) {
    const html = await getWithRetry(`${SOURCE}${characterPath}`);
    entries[char] = { ...(entries[char] || {}), kanjipediaCharacterUrl: `${SOURCE}${characterPath}`, dictionaryRadical: dictionaryRadical(html) };
    fs.writeFileSync(OUTPUT, `${JSON.stringify({ source: SOURCE, retrievedAt: new Date().toISOString(), entries, radicalGroups: Object.fromEntries(radicals) }, null, 2)}\n`, 'utf8');
    characterDone++;
    if (characterDone % 100 === 0) process.stdout.write(`Fetched ${characterDone}/${characterPages.size} school-character pages\n`);
    await new Promise(resolve => setTimeout(resolve, 180));
  }

  const schoolData = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/kanjidic2_school.json'), 'utf8'));
  const partsData = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/kanji_parts.json'), 'utf8'));
  const radicalReference = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/radical_reference.json'), 'utf8'));
  const radicalStrokeMismatches = [];
  let radicalStrokeComparable = 0;
  for (const [char, entry] of Object.entries(entries)) {
    const radicalInsideStrokeCount = entry.dictionaryRadical?.radicalStrokeCount;
    const totalStrokeCount = entry.dictionaryRadical?.totalStrokeCount;
    if (!Number.isInteger(radicalInsideStrokeCount) || !Number.isInteger(totalStrokeCount) || radicalReference.radicalOverrides?.[char]?.wholeCharacterRadical) continue;
    const code = char.codePointAt(0).toString(16).padStart(5, '0');
    const selected = (partsData[code] || []).filter(part => part.radical);
    const svgRadicalStrokeCount = selected.reduce((sum, part) => sum + (part.ranges || [[part.start, part.end]]).reduce((partSum, [start, end]) => partSum + end - start + 1, 0), 0);
    radicalStrokeComparable++;
    const expectedRadicalStrokeCount = totalStrokeCount - radicalInsideStrokeCount;
    if (expectedRadicalStrokeCount !== svgRadicalStrokeCount) radicalStrokeMismatches.push({ char, grade: schoolData[char]?.grade, totalStrokeCount, radicalInsideStrokeCount, expectedRadicalStrokeCount, svgRadicalStrokeCount, radicalLabels: entry.dictionaryRadical.indexLabels, characterPage: entry.kanjipediaCharacterUrl, indexPage: entry.dictionaryRadical.indexUrl });
  }

  const missing = [];
  const multiple = [];
  const crosswalkCounts = {};
  for (const [char, info] of Object.entries(school)) {
    const groups = charIndex.get(char) || [];
    if (!groups.length) missing.push(char);
    if (groups.length > 1) multiple.push({ char, groups });
    entries[char] = {
      ...(entries[char] || {}),
      grade: info.grade,
      currentRadicalNumber: info.radicalNumber,
      kanjipediaGroups: groups.map(key => {
        const radical = radicals.get(key);
        if (!crosswalkCounts[key]) crosswalkCounts[key] = {};
        crosswalkCounts[key][info.radicalNumber] = (crosswalkCounts[key][info.radicalNumber] || 0) + 1;
        return { key, labels: radical.labels, url: radical.url };
      })
    };
  }

  const crosswalk = {};
  const imageCrosswalkCounts = {};
  for (const [char, entry] of Object.entries(entries)) {
    const image = entry.dictionaryRadical?.image;
    if (!image) continue;
    if (!imageCrosswalkCounts[image]) imageCrosswalkCounts[image] = {};
    imageCrosswalkCounts[image][school[char].radicalNumber] = (imageCrosswalkCounts[image][school[char].radicalNumber] || 0) + 1;
  }
  const imageCrosswalk = {};
  for (const [image, counts] of Object.entries(imageCrosswalkCounts)) {
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1] || Number(a[0]) - Number(b[0]));
    const total = sorted.reduce((sum, [, count]) => sum + count, 0);
    imageCrosswalk[image] = { inferredRadicalNumber: Number(sorted[0][0]), support: sorted[0][1], total, alternatives: sorted.slice(1).map(([radicalNumber, count]) => ({ radicalNumber: Number(radicalNumber), count })) };
  }
  for (const [key, counts] of Object.entries(crosswalkCounts)) {
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1] || Number(a[0]) - Number(b[0]));
    const total = sorted.reduce((sum, [, count]) => sum + count, 0);
    crosswalk[key] = { inferredRadicalNumber: Number(sorted[0][0]), support: sorted[0][1], total, alternatives: sorted.slice(1).map(([radicalNumber, count]) => ({ radicalNumber: Number(radicalNumber), count })) };
  }

  const dictionaryLabelsLinked = linkDictionaryLabels(entries, [...radicals.values()]);
  const { crosswalk: imageIdCrosswalk, anomalies: numberCrosswalkReviewCandidates } = buildImageIdCrosswalk(entries);

  const disagreements = Object.entries(entries).flatMap(([char, entry]) => {
    const image = entry.dictionaryRadical?.image;
    if (!image || imageCrosswalk[image]?.inferredRadicalNumber === entry.currentRadicalNumber) return [];
    return [{ char, grade: entry.grade, currentRadicalNumber: entry.currentRadicalNumber, dictionaryRadical: { ...entry.dictionaryRadical, inferredRadicalNumber: imageCrosswalk[image]?.inferredRadicalNumber } }];
  });

  const output = {
    source: '漢字ペディア 部首索引（公益財団法人 日本漢字能力検定協会）',
    sourceUrl: `${SOURCE}/sakuin/bushu/1`,
    retrievedAt: new Date().toISOString(),
    method: '部首索引17ページ・214部首ページから教育漢字1,026字の掲載を抽出し、各漢字ペディア一字ページの部首画像IDも取得。画像IDとKANJIDIC2部首番号の対応は、同じ画像IDの教育漢字における部首番号の最頻値から推定した。相違は辞書一字ページを基準にしたレビュー候補であり、同じ教育字セットの最頻値で番号対応を推定しているため、個別根拠を記録した人手確認済みとは区別する。',
    radicalStrokeAudit: { method: 'Kanjipedia total strokes minus 部首内画数 compared with selected KanjiVG radical stroke count', compared: radicalStrokeComparable, mismatchCount: radicalStrokeMismatches.length, mismatches: radicalStrokeMismatches },
    counts: { schoolCharacters: Object.keys(school).length, radicalGroups: radicals.size, listed: Object.keys(school).length - missing.length, missing: missing.length, multipleAssignments: multiple.length, directDictionaryPages: Object.values(entries).filter(entry => entry.dictionaryRadical).length, dictionaryLabelsLinked, radicalStrokeCompared: radicalStrokeComparable, radicalStrokeMismatches: radicalStrokeMismatches.length, numberCrosswalkReviewCandidates: numberCrosswalkReviewCandidates.length },
    missing,
    multiple,
    crosswalk,
    imageCrosswalk,
    imageIdCrosswalk,
    numberCrosswalkReviewCandidates,
    entries,
    radicalGroups: Object.fromEntries(radicals)
  };
  fs.writeFileSync(OUTPUT, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(output.counts, null, 2));
  console.log(`Wrote ${path.relative(process.cwd(), OUTPUT)}`);
}

if (process.argv.includes('--enrich-existing')) enrichExistingAudit();
else main().catch(error => { console.error(error); process.exitCode = 1; });
