#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const { pathToFileURL, fileURLToPath } = require('node:url');
const { VENDORS, parseReport, markdownLinks } = require('./report-parser.cjs');
const { createRelocator } = require('./report-paths.cjs');

const DEFAULT_BOARD = path.resolve(__dirname, '..');
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const readMarkdown = file => fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').trim() + '\n';
const exists = file => { try { return fs.statSync(file).isFile(); } catch { return false; } };
const json = value => JSON.stringify(value, null, 2) + '\n';
const scriptSafe = value => value.replace(/<\/script/gi, '<\\/script').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

function walk(dir, result = []) {
  if (!fs.existsSync(dir)) return result;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || ['node_modules', '看板'].includes(entry.name)) continue;
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file, result);
    else if (entry.isFile() && /^(深挖报告|筛选报告)\.md$/.test(entry.name)) result.push(file);
  }
  return result;
}

function resolveLocal(target, origin, known, workspace, relocate = file => file) {
  let ref = target.replace(/^<|>$/g, '').split('#')[0];
  try { ref = decodeURIComponent(ref); } catch { /* Literal percent signs in a filename are allowed. */ }
  if (/^file:/i.test(ref)) { try { ref = fileURLToPath(ref); } catch { return null; } }
  if (!ref || /^[a-z][a-z\d+.-]*:/i.test(ref)) return null;
  const direct = relocate(path.resolve(path.dirname(origin), ref));
  if (exists(direct)) return direct;
  // After a folder move, match the longest unique suffix against the configured report inventory.
  const parts = ref.split(/[\\/]/).filter(Boolean);
  for (let n = Math.min(parts.length, 9); n >= 2; n--) {
    const suffix = parts.slice(-n).join(path.sep);
    const matches = known.filter(file => file.endsWith(path.sep + suffix));
    if (matches.length === 1) return matches[0];
  }
  const relative = path.resolve(workspace, ref);
  return exists(relative) ? relative : null;
}

function groupedEvents(reports, groups) {
  const alias = new Map();
  for (const group of groups) {
    if (!group.id || !group.reason || !Array.isArray(group.candidateIds) || !group.candidateIds.length) throw new Error('eventGroups 必须包含 id、reason 和 candidateIds');
    for (const id of group.candidateIds) {
      if (!/^\d{4}-\d{2}-\d{2}(?:-\d{2,})?-S\d+$/.test(id) || alias.has(id)) throw new Error(`事件关联编号无效或重复：${id}`);
      alias.set(id, group.id);
    }
  }
  const events = new Map();
  for (const report of reports) {
    for (const item of report.items) {
      const id = alias.get(item.candidateId) || item.candidateId || `独立研究-${item.researchId}`;
      if (!events.has(id)) events.set(id, { id, vendor: item.vendor, versions: [] });
      const event = events.get(id);
      if (event.vendor !== item.vendor) throw new Error(`同一事件出现不同厂商：${id}；请核对报告归属或事件关联配置`);
      event.versions.push({ ...item, reportId: report.id, sequence: report.sequence, sourceState: report.sourceState, testRun: Boolean(report.testRun || report.paths.some(p => /测试/.test(p))) });
    }
  }
  return [...events.values()].map(event => {
    event.versions.sort((a, b) => Date.parse(b.time) - Date.parse(a.time) || b.sequence - a.sequence || b.researchId.localeCompare(a.researchId));
    return event;
  }).sort((a, b) => Date.parse(b.versions[0].time) - Date.parse(a.versions[0].time) || a.id.localeCompare(b.id));
}

function commitFiles(board, index, html) {
  const indexFile = path.join(board, 'data', 'index.json'), htmlFile = path.join(board, '竞对看板.html');
  const suffix = `.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  const indexTemp = indexFile + suffix, htmlTemp = htmlFile + suffix;
  const previous = exists(indexFile) ? fs.readFileSync(indexFile) : null;
  let indexCommitted = false;
  fs.mkdirSync(path.dirname(indexFile), { recursive: true });
  try {
    fs.writeFileSync(indexTemp, json(index));
    fs.writeFileSync(htmlTemp, html);
    fs.renameSync(indexTemp, indexFile);
    indexCommitted = true;
    fs.renameSync(htmlTemp, htmlFile);
  } catch (error) {
    if (indexCommitted) {
      if (previous) { fs.writeFileSync(indexTemp, previous); fs.renameSync(indexTemp, indexFile); }
      else fs.rmSync(indexFile, { force: true });
    }
    throw error;
  } finally {
    fs.rmSync(indexTemp, { force: true });
    fs.rmSync(htmlTemp, { force: true });
  }
}

function build(options = {}) {
  const board = path.resolve(options.board || DEFAULT_BOARD);
  const config = JSON.parse(fs.readFileSync(path.join(board, 'config.json'), 'utf8'));
  if (config.schemaVersion !== 1) throw new Error('不支持的配置版本');
  const workspace = path.resolve(board, config.workspace);
  const relocator = createRelocator(config.reportRelocations || [], workspace);
  const readReport = file => relocator.rewrite(readMarkdown(file), file);
  const location = file => path.relative(workspace, file).split(path.sep).join('/');
  const absolute = file => path.resolve(workspace, file);
  const indexFile = path.join(board, 'data', 'index.json');
  const lock = path.join(board, '.build.lock');
  try { fs.mkdirSync(lock); } catch { throw new Error('另一次看板更新尚未结束；请稍后重试。若前次进程异常退出，请核对后移除看板目录中的 .build.lock'); }
  try {
    fs.writeFileSync(path.join(lock, 'owner.json'), json({ pid: process.pid, startedAt: new Date().toISOString() }));
    const prior = exists(indexFile) ? JSON.parse(fs.readFileSync(indexFile, 'utf8')) : { schemaVersion: 1, reports: [], screenings: [], registeredReports: [], screeningOverrides: {}, sequence: 0 };
    if (prior.schemaVersion !== 1 || !Array.isArray(prior.reports) || !Array.isArray(prior.screenings)) throw new Error('索引结构异常；保留现有索引和页面，请先修复或从备份恢复');
    const index = relocator.remapIndex(structuredClone(prior)), now = new Date().toISOString();
    const diagnostics = [], current = new Map();
    const explicit = (options.reports || []).map(file => relocator.target(path.resolve(file)));
    for (const file of explicit) {
      if (!exists(file)) throw new Error(`指定报告不存在：${file}`);
      const rel = location(file);
      if (!index.registeredReports.includes(rel)) index.registeredReports.push(rel);
      if (options.screening) index.screeningOverrides[rel] = location(relocator.target(path.resolve(options.screening)));
    }
    if (options.screening && explicit.length !== 1) throw new Error('--screening 需要搭配且仅搭配一份 --report');
    const known = [...new Set([
      ...config.reportRoots.flatMap(root => walk(path.resolve(board, root))),
      ...index.registeredReports.map(absolute).filter(exists),
      ...Object.values(index.screeningOverrides).map(absolute).filter(exists)
    ])].sort();
    const screenFiles = known.filter(file => path.basename(file) === '筛选报告.md');
    const reportFiles = known.filter(file => path.basename(file) === '深挖报告.md' || index.registeredReports.includes(location(file)));
    const screenByPath = new Map(), screenRecords = new Map(index.screenings.map(s => [s.id, s]));
    function screenDocument(file) {
      if (screenByPath.has(file)) return screenByPath.get(file);
      const markdown = readReport(file), id = 'screen-' + digest(markdown);
      const record = screenRecords.get(id) || { id, markdown, paths: [] };
      if (!record.paths.includes(location(file))) record.paths.push(location(file));
      screenRecords.set(id, record);
      screenByPath.set(file, record);
      return record;
    }
    for (const file of screenFiles) {
      try { screenDocument(file); } catch (e) { diagnostics.push({ type: 'screening', path: location(file), message: e.message }); }
    }
    const reports = new Map(index.reports.map(r => [r.id, r]));
    const failedPaths = new Set();
    for (const file of reportFiles) {
      const rel = location(file);
      try {
        const markdown = readReport(file), id = 'report-' + digest(markdown);
        current.set(rel, id);
        const sourceLink = markdownLinks(markdown).find(link => /筛选报告\.md(?:#|$)/.test(link.target));
        const override = index.screeningOverrides[rel];
        const screeningPath = override ? absolute(override) : sourceLink && resolveLocal(sourceLink.target, file, known, workspace, relocator.target);
        let screen = null;
        if (screeningPath && exists(screeningPath)) screen = screenDocument(screeningPath);
        else if (sourceLink || override) throw new Error('来源筛选报告无法定位；可用 --screening 指定已搬迁的文件');
        const parsed = parseReport(markdown, screen?.markdown || '');
        const record = reports.get(id) || { id, paths: [], firstImportedAt: now, sequence: ++index.sequence, testRun: /测试/.test(rel) };
        if (!record.paths.includes(rel)) record.paths.push(rel);
        Object.assign(record, { markdown, items: parsed.items, time: parsed.time, batch: parsed.batch, screenId: screen?.id || null, screenPath: screeningPath ? location(screeningPath) : null, lastSeenAt: now });
        reports.set(id, record);
      } catch (e) {
        failedPaths.add(rel);
        diagnostics.push({ type: 'report', path: rel, message: e.message });
      }
    }
    for (const record of reports.values()) {
      record.availablePaths = record.paths.filter(p => current.get(p) === record.id && !failedPaths.has(p));
      const failed = record.paths.some(p => failedPaths.has(p));
      const replaced = record.paths.some(p => current.has(p) && current.get(p) !== record.id);
      record.sourceState = record.availablePaths.length ? 'available' : failed ? 'unreadable' : replaced ? 'superseded' : 'missing';
      if (['missing', 'unreadable'].includes(record.sourceState)) diagnostics.push({ type: 'source', path: record.paths[0], message: record.sourceState === 'missing' ? '原报告暂时缺失，保留上次收录内容' : '原报告本轮无法读取，保留上次收录内容' });
    }
    for (const rel of index.registeredReports) {
      if (!exists(absolute(rel)) && ![...reports.values()].some(r => r.paths.includes(rel))) diagnostics.push({ type: 'source', path: rel, message: '已登记的报告不存在，等待补录' });
    }
    // Reparse archived snapshots as well, so rebuilding never relies on an obsolete extraction.
    for (const record of reports.values()) {
      if (record.availablePaths.length) continue;
      const screen = record.screenId && screenRecords.get(record.screenId);
      const parsed = parseReport(record.markdown, screen?.markdown || '');
      record.items = parsed.items;
    }
    index.reports = [...reports.values()];
    index.screenings = [...screenRecords.values()];
    index.diagnostics = diagnostics;
    index.generatedAt = now;
    if (!diagnostics.length) index.lastSuccessfulAt = now;
    index.events = groupedEvents(index.reports, config.eventGroups || []);
    const documents = {};
    for (const record of [...index.reports, ...index.screenings]) {
      const origin = absolute(record.availablePaths?.[0] || record.paths.find(p => exists(absolute(p))) || record.paths[0]);
      const refs = {};
      for (const link of markdownLinks(record.markdown)) {
        if (!/\.md(?:#|$)/.test(link.target)) continue;
        const local = resolveLocal(link.target, origin, known, workspace, relocator.target);
        if (!local) continue;
        const rel = location(local);
        const doc = index.reports.find(r => r.availablePaths.includes(rel)) || index.screenings.find(s => s.paths.includes(rel));
        if (doc) refs[link.target] = doc.id;
      }
      documents[record.id] = { id: record.id, markdown: record.markdown, references: refs, filename: path.basename(origin), sourceUrl: pathToFileURL(origin).href, sourcePath: location(origin), sourceState: record.sourceState || (exists(origin) ? 'available' : 'missing'), batch: record.batch || '', screenId: record.screenId || null };
    }
    const payload = { schemaVersion: 1, vendors: VENDORS, generatedAt: now, lastSuccessfulAt: index.lastSuccessfulAt || null, asOf: index.reports.map(r => r.time).sort().at(-1) || null, diagnostics, events: index.events, documents };
    const source = name => fs.readFileSync(path.join(board, 'src', name), 'utf8');
    let html = source('template.html');
    const replacements = { '__STYLES__': source('styles.css'), '__MARKED__': fs.readFileSync(path.join(board, 'vendor', 'marked.umd.js'), 'utf8'), '__PAYLOAD__': JSON.stringify(payload).replace(/</g, '\\u003c'), '__OBSERVATION_COPY__': source('observation-copy.js'), '__APP__': source('app.js') };
    new vm.Script(scriptSafe(replacements.__MARKED__), { filename: 'marked.umd.js' });
    new vm.Script(scriptSafe(replacements.__APP__), { filename: 'app.js' });
    new vm.Script(scriptSafe(replacements.__OBSERVATION_COPY__), { filename: 'observation-copy.js' });
    for (const [tag, value] of Object.entries(replacements)) {
      if (!html.includes(tag)) throw new Error(`页面模板缺少 ${tag}`);
      html = html.replace(tag, () => tag === '__STYLES__' ? value : scriptSafe(value));
    }
    if (/__(STYLES|MARKED|PAYLOAD|OBSERVATION_COPY|APP)__/.test(html)) throw new Error('页面模板存在未替换的内容');
    commitFiles(board, index, html);
    const result = { output: path.join(board, '竞对看板.html'), reports: index.reports.length, events: index.events.length, researchVersions: index.events.reduce((sum, e) => sum + e.versions.length, 0), asOf: payload.asOf, pending: diagnostics.length, diagnostics };
    return result;
  } finally {
    fs.rmSync(lock, { recursive: true, force: true });
  }
}

function main(argv) {
  const options = { reports: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help') {
      console.log('用法：node build-dashboard.cjs [--report 报告路径] [--screening 筛选报告路径] [--rebuild]\n默认核对全部配置目录及已登记报告；--report 可重复使用并持续登记外部输出路径；--rebuild 从报告及保留快照重建视图，不清空历史。');
      return;
    }
    if (arg === '--rebuild') continue; // Every build reparses current reports and reconstructs the view.
    if (['--report', '--screening', '--board'].includes(arg)) {
      const value = argv[++i];
      if (!value || value.startsWith('--')) throw new Error(`${arg} 缺少路径`);
      if (arg === '--report') options.reports.push(value);
      else options[arg.slice(2)] = value;
    } else throw new Error(`未知参数：${arg}`);
  }
  const result = build(options);
  console.log(json(result));
  if (result.pending) process.exitCode = 1;
}

if (require.main === module) {
  try { main(process.argv.slice(2)); }
  catch (e) { console.error(`看板更新未完成：${e.message}`); process.exitCode = 1; }
}

module.exports = { build, groupedEvents, resolveLocal };
