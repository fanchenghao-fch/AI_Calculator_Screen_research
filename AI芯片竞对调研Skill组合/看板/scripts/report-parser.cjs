'use strict';

const observationCopy = require('../src/observation-copy.js');

const VENDORS = ['华为', '平头哥', '海光', '昆仑芯', '摩尔线程', '燧原科技', '寒武纪', '壁仞科技'];
const ALIASES = { 华为: '华为', 平头哥: '平头哥', 海光: '海光', 昆仑芯: '昆仑芯', 摩尔线程: '摩尔线程', 燧原: '燧原科技', 燧原科技: '燧原科技', 寒武纪: '寒武纪', 壁仞: '壁仞科技', 壁仞科技: '壁仞科技' };
const FULL_ID = /\d{4}-\d{2}-\d{2}(?:-\d{2,})?-[SR]\d+/g;

function plain(text = '') {
  return text.replace(/<a\b[^>]*>\s*<\/a>/gi, '').replace(/\[([^\]]+)\]\((?:<[^>]*>|[^)]*)\)/g, '$1').replace(/[*`_]/g, '').trim();
}

function cells(line) {
  const result = [];
  let value = '', code = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '\\' && line[i + 1] === '|') { value += '|'; i++; continue; }
    if (c === '`') code = !code;
    if (c === '|' && !code) { result.push(value.trim()); value = ''; } else value += c;
  }
  result.push(value.trim());
  if (result[0] === '') result.shift();
  if (result.at(-1) === '') result.pop();
  return result;
}

function tables(markdown) {
  const lines = markdown.split('\n'), result = [];
  for (let i = 0; i < lines.length - 1; i++) {
    if (!/^\s*\|/.test(lines[i])) continue;
    const sep = cells(lines[i + 1]);
    if (!sep.length || !sep.every(c => /^:?-{3,}:?$/.test(c))) continue;
    const header = cells(lines[i]), rows = [];
    i += 2;
    while (i < lines.length && /^\s*\|/.test(lines[i])) { rows.push(cells(lines[i])); i++; }
    result.push({ header, rows });
    i--;
  }
  return result;
}

function metadata(markdown) {
  const opening = plain(markdown.slice(0, 5000));
  const batch = opening.match(/(?:研究批次|批次)\s*[：:]\s*(\d{4}-\d{2}-\d{2}(?:-\d{2,})?)/)?.[1];
  const m = opening.match(/(?:资料核查截止|资料截至|资料截止|观察截止|研究截止|检索截止|核查截止|截止时间)\s*[：:]?\s*(\d{4}-\d{2}-\d{2})[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!batch) throw new Error('无法识别报告批次，请在开头明确“研究批次：YYYY-MM-DD[-NN]”');
  if (!m) throw new Error('无法识别研究截止时间，请在开头明确“研究截止：YYYY-MM-DD HH:mm”');
  const time = `${m[1]}T${m[2].padStart(2, '0')}:${m[3]}:${m[4] || '00'}+08:00`;
  if (!Number.isFinite(Date.parse(time))) throw new Error('研究截止时间无效');
  return { batch, time };
}

function ids(text, batch, type) {
  const full = [...text.matchAll(FULL_ID)].map(m => m[0]).filter(id => id.match(new RegExp(`-${type}\\d+$`)));
  if (full.length) return [...new Set(full)];
  return [...text.matchAll(new RegExp(`\\b${type}(\\d+)\\b`, 'g'))].map(m => `${batch}-${type}${m[1]}`);
}

function candidateMap(markdown) {
  const result = {};
  const batch = plain(markdown).match(/(?:批次|研究批次)\s*[：:]\s*(\d{4}-\d{2}-\d{2}(?:-\d{2,})?)/)?.[1];
  for (const table of tables(markdown)) {
    const ci = table.header.findIndex(h => /候选编号/.test(h));
    const vi = table.header.findIndex(h => /厂商/.test(h));
    if (ci < 0 || vi < 0) continue;
    for (const row of table.rows) {
      const candidateIds = batch ? ids(row[ci] || '', batch, 'S') : [...(row[ci] || '').matchAll(FULL_ID)].map(m => m[0]).filter(x => /-S\d+$/.test(x));
      const label = plain(row[vi] || '');
      const vendor = ALIASES[label.split(/[／/、，,\s]/)[0]];
      for (const candidateId of candidateIds) {
        if (vendor) result[candidateId] = { vendor, label };
      }
    }
  }
  return result;
}

function headingSections(markdown) {
  const lines = markdown.split('\n'), headings = [];
  let fenced = false;
  lines.forEach((line, i) => {
    if (/^\s*```/.test(line)) fenced = !fenced;
    const m = !fenced && line.match(/^(#{1,6})\s+(.+)$/);
    if (m) headings.push({ line: i, level: m[1].length, title: m[2] });
  });
  return { lines, headings };
}

function candidateSection(markdown, researchId) {
  const { lines, headings } = headingSections(markdown);
  const short = researchId.match(/R\d+$/)[0];
  const index = headings.findIndex(h => h.title.includes(researchId) || new RegExp(`^${short}(?:[\\s：:｜|]|$)`).test(h.title));
  if (index < 0) throw new Error(`${researchId} 未找到对应的逐候选研究章节`);
  const h = headings[index];
  const end = headings.slice(index + 1).find(x => x.level <= h.level)?.line ?? lines.length;
  const title = plain(h.title).replace(new RegExp(`^(?:${researchId}|${short})[\\s：:｜|]*`), '').replace(/[（(]\d{4}-\d{2}-\d{2}(?:-\d{2,})?-S\d+[）)]/g, '').trim();
  return { title, body: lines.slice(h.line + 1, end).join('\n').trim() };
}

function unresolved(markdown, candidateId, researchId) {
  const { lines, headings } = headingSections(markdown);
  const h = headings.find(h => /后续关注点|后续关注|未解决问题|待解决问题/.test(h.title));
  if (!h) return '';
  const end = headings.find(x => x.line > h.line && x.level <= h.level)?.line ?? lines.length;
  const text = lines.slice(h.line + 1, end).join('\n');
  const s = candidateId?.match(/S\d+$/)?.[0], r = researchId.match(/R\d+$/)[0];
  const found = [];
  for (const table of tables(text)) {
    const rows = table.rows.filter(row => {
      const label = plain(row[0]);
      return (s && new RegExp(`(?:^|[^A-Za-z0-9])${s}(?:$|[^0-9])`).test(label)) || new RegExp(`(?:^|[^A-Za-z0-9])${r}(?:$|[^0-9])`).test(label);
    });
    if (rows.length) found.push(`| ${table.header.join(' | ')} |\n| ${table.header.map(() => '---').join(' | ')} |\n${rows.map(row => `| ${row.join(' | ')} |`).join('\n')}`);
  }
  if (!found.length && !tables(text).length) {
    const bullets = text.trim().split(/\n(?=[-*]\s)/);
    const selected = bullets.filter(block => {
      const label = plain(block.split('\n')[0]).slice(0, 80);
      return new RegExp(`^[-*]\\s+${r}(?:[／/：:\\s]|$)`).test(label) || (s && new RegExp(`^[-*]\\s+${s}(?:[／/：:\\s]|$)`).test(label));
    }).map(block => block.split(/\n\s*\n(?=\S)/)[0].trim());
    if (selected.length) return selected.join('\n');
    // Unlabelled narrative unknowns are safe to attach only to a single-candidate report.
    const researchIds = new Set([...markdown.matchAll(FULL_ID)].map(m => m[0]).filter(id => /-R\d+$/.test(id)));
    if (researchIds.size === 1 && !/^### /m.test(text)) return text.trim();
  }
  return found.join('\n\n');
}

function evidence(markdown, body) {
  const anchors = new Set([...body.matchAll(/\]\(#([^)]+)\)/g)].map(m => m[1].toLowerCase()));
  if (!anchors.size) return '';
  const found = [];
  for (const table of tables(markdown)) {
    const rows = table.rows.filter(row => [...(row.join(' ').matchAll(/<a\b[^>]*id=["']([^"']+)["'][^>]*>/gi))].some(m => anchors.has(m[1].toLowerCase())));
    if (rows.length) found.push(`| ${table.header.join(' | ')} |\n| ${table.header.map(() => '---').join(' | ')} |\n${rows.map(row => `| ${row.join(' | ')} |`).join('\n')}`);
  }
  return found.join('\n\n');
}

function parseReport(markdown, screening = '') {
  const { batch, time } = metadata(markdown);
  const candidates = candidateMap(screening);
  const summary = tables(markdown).find(table => table.header.some(h => /观察|结论/.test(h)) && table.header.some(h => /编号|候选/.test(h)));
  if (!summary) throw new Error('未找到含研究编号与核心观察的概览表');
  const summaryIndex = summary.header.findIndex(h => /观察|结论/.test(h));
  const legacyIndex = summary.header.findIndex(h => /完成|证据边界/.test(h));
  const result = [];
  for (const row of summary.rows) {
    const leading = row.slice(0, summaryIndex).join(' ');
    const researchIds = ids(leading, batch, 'R');
    if (researchIds.length !== 1) throw new Error(`概览行的研究编号不明确：${plain(leading)}`);
    const researchId = researchIds[0];
    const candidateIds = ids(leading, batch, 'S');
    if (candidateIds.length > 1) throw new Error(`${researchId} 对应多个候选编号`);
    const candidateId = candidateIds[0] || null;
    const legacyNotes = legacyIndex < 0 ? '' : row[legacyIndex] || '';
    if (/未开展/.test(plain(legacyNotes))) continue;
    const observationNotes = observationCopy(legacyNotes).replace(/^(?:\*\*)?(?:部分完成|未完成|完成)(?:\*\*)?$/, '');
    const section = candidateSection(markdown, researchId);
    const mapped = candidateId && candidates[candidateId];
    // Only an explicit vendor at the start of a research title may replace a missing screening record.
    const prefix = Object.keys(ALIASES).sort((a, b) => b.length - a.length).find(v => section.title.startsWith(v));
    const vendor = mapped?.vendor || (prefix && ALIASES[prefix]);
    if (!vendor) throw new Error(`${researchId} 无法确定厂商；请提供对应筛选报告，或在研究标题开头注明厂商`);
    if (!section.body || !row[summaryIndex]) throw new Error(`${researchId} 正文或结论为空`);
    result.push({ candidateId, researchId, vendor, title: section.title, summary: row[summaryIndex], observationNotes, body: section.body, unknowns: unresolved(markdown, candidateId, researchId), evidence: evidence(markdown, section.body), batch, time });
  }
  if (!result.length) throw new Error('没有可收录的已开展研究');
  return { batch, time, items: result };
}

function markdownLinks(markdown) {
  return [...markdown.matchAll(/\[([^\]]*)\]\((<[^>]+>|[^)]+)\)/g)].map(m => ({ label: m[1], target: m[2].replace(/^<|>$/g, '') }));
}

module.exports = { VENDORS, plain, cells, tables, metadata, ids, candidateMap, parseReport, markdownLinks };
