'use strict';

const path = require('node:path');
const crypto = require('node:crypto');
const { fileURLToPath } = require('node:url');

const hash = markdown => crypto.createHash('sha256').update(markdown).digest('hex');

// Path relocation is metadata maintenance. Re-key snapshots in place instead of importing new versions.
function createRelocator(relocations, workspace) {
  const map = new Map();
  const relative = file => path.relative(workspace, file).split(path.sep).join('/');
  for (const entry of relocations) {
    if (!entry.from || !entry.to) throw new Error('reportRelocations 必须包含 from 和 to');
    const from = path.resolve(workspace, entry.from), to = path.resolve(workspace, entry.to);
    if (from === to || map.has(from)) throw new Error(`重复或无效的报告路径迁移：${entry.from}`);
    map.set(from, to);
  }
  function target(file) {
    let current = path.resolve(file);
    const visited = new Set();
    while (map.has(current)) {
      if (visited.has(current)) throw new Error('报告路径迁移存在循环');
      visited.add(current);
      current = map.get(current);
    }
    return current;
  }
  for (const from of map.keys()) target(from);

  function absoluteReference(ref, origin) {
    let value = ref;
    try { value = decodeURIComponent(value); } catch { /* Keep literal percent signs. */ }
    if (/^file:/i.test(value)) { try { value = fileURLToPath(value); } catch { return null; } }
    if (!value || value.startsWith('#') || /^[a-z][a-z\d+.-]*:/i.test(value)) return null;
    const direct = path.resolve(path.dirname(origin), value);
    if (map.has(direct)) return direct;
    // An archived absolute link may still contain a former workspace prefix.
    const matches = [...map.keys()].filter(from => value.endsWith('/' + relative(from)));
    return matches.length === 1 ? matches[0] : direct;
  }

  function rewrite(markdown, origin) {
    if (!map.size) return markdown;
    const newOrigin = target(origin);
    return markdown.replace(/(\[[^\]]*\]\()(<[^>]+>|[^)]+)(\))/g, (whole, open, raw, close) => {
      const ref = raw.replace(/^<|>$/g, '');
      const position = ref.indexOf('#');
      const destination = position < 0 ? ref : ref.slice(0, position);
      const fragment = position < 0 ? '' : ref.slice(position);
      const resolved = absoluteReference(destination, origin);
      if (!resolved) return whole;
      const movedTarget = target(resolved);
      if (movedTarget === resolved && newOrigin === path.resolve(origin)) return whole;
      // A moved source also needs to keep relative links to unmoved local files valid.
      const changed = path.relative(path.dirname(newOrigin), movedTarget).split(path.sep).join('/') + fragment;
      return open + (/[\s()]/.test(changed) ? `<${changed}>` : changed) + close;
    });
  }

  function remapIndex(index) {
    if (!map.size) return index;
    const ids = new Map();
    for (const [collection, prefix] of [['reports', 'report-'], ['screenings', 'screen-']]) {
      const records = new Map();
      for (const record of index[collection]) {
        if (collection === 'reports') record.testRun = Boolean(record.testRun || record.paths.some(p => /测试/.test(p)));
        const oldId = record.id;
        const origin = path.resolve(workspace, record.paths[0]);
        record.markdown = rewrite(record.markdown, origin);
        record.id = prefix + hash(record.markdown);
        ids.set(oldId, record.id);
        record.paths = [...new Set(record.paths.map(p => relative(target(path.resolve(workspace, p)))))];
        if (record.availablePaths) record.availablePaths = [...new Set(record.availablePaths.map(p => relative(target(path.resolve(workspace, p)))))];
        if (record.screenPath) record.screenPath = relative(target(path.resolve(workspace, record.screenPath)));
        const previous = records.get(record.id);
        if (previous) {
          previous.paths = [...new Set([...previous.paths, ...record.paths])];
          previous.testRun = Boolean(previous.testRun || record.testRun);
          if (previous.availablePaths) previous.availablePaths = [...new Set([...previous.availablePaths, ...(record.availablePaths || [])])];
        } else records.set(record.id, record);
      }
      index[collection] = [...records.values()];
    }
    for (const report of index.reports) if (report.screenId) report.screenId = ids.get(report.screenId) || report.screenId;
    index.registeredReports = [...new Set(index.registeredReports.map(p => relative(target(path.resolve(workspace, p)))))];
    index.screeningOverrides = Object.fromEntries(Object.entries(index.screeningOverrides).map(([report, screen]) => [relative(target(path.resolve(workspace, report))), relative(target(path.resolve(workspace, screen)))]));
    return index;
  }

  return { target, rewrite, remapIndex };
}

module.exports = { createRelocator };
