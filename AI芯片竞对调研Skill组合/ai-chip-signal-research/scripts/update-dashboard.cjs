#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function ancestors(start) {
  const result = [];
  for (let dir = path.resolve(start); ; dir = path.dirname(dir)) {
    result.push(dir);
    if (path.dirname(dir) === dir) break;
  }
  return result;
}

function main(argv) {
  let dashboard = process.env.AI_CHIP_DASHBOARD_DIR;
  const forwarded = [], reports = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dashboard') {
      dashboard = argv[++i];
      if (!dashboard) throw new Error('--dashboard 缺少路径');
    } else {
      forwarded.push(argv[i]);
      if (argv[i] === '--report' && argv[i + 1]) reports.push(path.resolve(argv[i + 1]));
    }
  }
  const candidateDirs = dashboard ? [path.resolve(dashboard)] : [...new Set([
    ...ancestors(__dirname), ...ancestors(process.cwd()), ...reports.flatMap(file => ancestors(path.dirname(file)))
  ])].flatMap(root => [path.join(root, 'AI芯片竞对调研Skill组合', '看板'), path.join(root, '看板')]);
  const found = candidateDirs.find(dir => fs.existsSync(path.join(dir, 'scripts', 'build-dashboard.cjs')) && fs.existsSync(path.join(dir, 'config.json')));
  if (!found) throw new Error('未找到竞对看板。请用 --dashboard 指定看板目录；研究报告已保存，但本轮尚未收录。');
  const result = spawnSync(process.execPath, [path.join(found, 'scripts', 'build-dashboard.cjs'), ...forwarded], { stdio: 'inherit' });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}

try { main(process.argv.slice(2)); }
catch (error) { console.error(`自动收录未完成：${error.message}`); process.exitCode = 1; }
