'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { build } = require('../scripts/build-dashboard.cjs');
const { parseReport } = require('../scripts/report-parser.cjs');

const realBoard = path.resolve(__dirname, '..');
const realWorkspace = path.resolve(realBoard, '../..');
const readIndex = board => JSON.parse(fs.readFileSync(path.join(board, 'data/index.json'), 'utf8'));

function fixture(t) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'chip-dashboard-test-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const board = path.join(temp, 'workspace', 'AI芯片竞对调研Skill组合', '看板');
  fs.mkdirSync(board, { recursive: true });
  for (const folder of ['src', 'vendor']) fs.cpSync(path.join(realBoard, folder), path.join(board, folder), { recursive: true });
  fs.writeFileSync(path.join(board, 'config.json'), JSON.stringify({ schemaVersion: 1, workspace: '../..', reportRoots: ['../../reports'], eventGroups: [] }));
  const reports = path.resolve(board, '../../reports');
  fs.mkdirSync(reports, { recursive: true });
  return { board, reports, temp };
}

function sample({ researchId = '2026-10-23-R01', candidateId = '2026-10-23-S01', batch = '2026-10-23', time = '2026-10-23 10:00', summary = '厂商宣称已展示测试方案，交付仍未核实。', title = '华为／测试方案', extra = '' } = {}) {
  return `# 测试市场观察报告\n\n研究批次：${batch}；资料截至：${time}（Asia/Shanghai）。\n\n## 观察概览\n\n| 研究编号 | 候选编号 | 核心观察 |\n| --- | --- | --- |\n| ${researchId} | ${candidateId || '无'} | ${summary} |\n\n## 逐项信息与分析\n\n### ${researchId}：${title}\n\n${summary} [测试来源](https://example.com/research)。\n\n${extra}\n\n## 后续关注点\n\n| 候选 | 后续关注 | 观察节点 |\n| --- | --- | --- |\n| ${candidateId || researchId} | 持续关注实际应用 | 后续客户动态 |\n`;
}

function save(dir, sub, markdown) {
  const file = path.join(dir, sub, '深挖报告.md');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, markdown);
  return file;
}

test('实际三种历史报告：九项研究、厂商按候选表归属、原文及证据保持一致', () => {
  const sources = [
    ['AI芯片竞对调研Skill组合/成果/深挖/2026-10-20-03/深挖报告.md', 'AI芯片竞对调研Skill组合/成果/初筛/2026-10-20-03/筛选报告.md'],
    ['AI芯片竞对调研Skill组合/成果/深挖/2026-10-20/深挖报告.md', 'AI芯片竞对调研Skill组合/成果/初筛/2026-10-20/筛选报告.md'],
    ['AI芯片竞对调研Skill组合/成果/深挖/2026-10-20-02/深挖报告.md', 'AI芯片竞对调研Skill组合/成果/初筛/2026-10-20-02/筛选报告.md']
  ];
  const items = sources.flatMap(([report, screen]) => {
    const markdown = fs.readFileSync(path.join(realWorkspace, report), 'utf8');
    return parseReport(markdown, fs.readFileSync(path.join(realWorkspace, screen), 'utf8')).items.map(item => {
      assert.ok(markdown.includes(item.summary), '摘要必须是报告原文');
      assert.ok(markdown.includes(item.body), '正文必须是原文片段');
      assert.equal(Object.hasOwn(item, 'status'), false);
      assert.equal(Object.hasOwn(item, 'statusDetail'), false);
      assert.doesNotMatch(item.observationNotes, /部分完成|完成程度/);
      return item;
    });
  });
  assert.equal(items.length, 9);
  const project = items.find(i => i.candidateId === '2026-10-20-S03');
  assert.equal(project.vendor, '壁仞科技', '项目名含昆仑，不能归入昆仑芯');
  assert.match(project.evidence, /id="e21"/);
  const r01 = items.find(i => i.researchId === '2026-10-20-02-R01');
  assert.match(r01.unknowns, /V900/);
  assert.doesNotMatch(r01.unknowns, /R02|R03|BR20X/);
});

test('重复导入和报告副本不新增研究；新一轮研究保留旧事件并追加同候选版本', t => {
  const { board, reports } = fixture(t);
  const first = save(reports, 'one', sample());
  assert.equal(build({ board }).events, 1);
  assert.equal(build({ board }).researchVersions, 1);
  save(reports, 'copy', fs.readFileSync(first, 'utf8'));
  const duplicate = build({ board });
  assert.equal(duplicate.reports, 1);
  assert.equal(readIndex(board).reports[0].availablePaths.length, 2);
  save(reports, 'two', sample({ batch: '2026-10-24', researchId: '2026-10-24-R01', time: '2026-10-24 11:00', summary: '取得后续原文，验收仍未核实。' }));
  const updated = build({ board });
  assert.equal(updated.events, 1);
  assert.equal(updated.researchVersions, 2);
  const event = readIndex(board).events[0];
  assert.equal(event.versions[0].researchId, '2026-10-24-R01');
  assert.equal(event.versions[1].researchId, '2026-10-23-R01');
  assert.equal(build({ board }).researchVersions, 2);
});

test('原报告更正保留修订快照；源文件缺失时保留已有内容，恢复后清除提示', t => {
  const { board, reports } = fixture(t);
  const file = save(reports, 'one', sample());
  build({ board });
  const correction = sample({ summary: '原报告更正：当前仍是计划阶段，尚未交付。' });
  fs.writeFileSync(file, correction);
  assert.equal(build({ board }).researchVersions, 2);
  let index = readIndex(board);
  assert.match(index.events[0].versions[0].summary, /原报告更正/);
  assert.equal(index.reports.filter(r => r.sourceState === 'superseded').length, 1);
  fs.unlinkSync(file);
  const missing = build({ board });
  assert.equal(missing.events, 1);
  assert.ok(missing.pending > 0);
  fs.writeFileSync(file, correction);
  assert.equal(build({ board }).pending, 0);
  assert.equal(readIndex(board).events[0].versions.length, 2);
});

test('未识别的新报告可补录；失败修订不会覆盖上次可读研究', t => {
  const { board, reports } = fixture(t);
  const file = save(reports, 'one', sample());
  build({ board });
  fs.writeFileSync(file, '# 格式尚未完成\n');
  assert.ok(build({ board }).pending > 0);
  assert.equal(readIndex(board).events.length, 1);
  fs.writeFileSync(file, sample({ summary: '补录成功，未知仍按原文保留。' }));
  assert.equal(build({ board }).pending, 0);
  assert.equal(readIndex(board).events[0].versions.length, 2);
});

test('外部自定义路径持续登记；不自动合并不同候选，明确关联后才合并', t => {
  const { board, temp } = fixture(t);
  const external = save(path.join(temp, 'outside'), 'custom', sample({ candidateId: null }));
  assert.equal(build({ board, reports: [external] }).events, 1);
  assert.equal(build({ board }).events, 1, '后续未传 --report 仍需读取已登记路径');
  const other = save(path.join(temp, 'outside'), 'other', sample({ candidateId: '2026-10-23-S02', researchId: '2026-10-23-R02' }));
  assert.equal(build({ board, reports: [other] }).events, 2, '同标题不同候选不能自动合并');
});

test('明确事件关联能合并历史；跨厂商或重复关联配置会拒绝替换可用看板', t => {
  const { board, reports } = fixture(t);
  save(reports, 'one', sample());
  save(reports, 'two', sample({ candidateId: '2026-10-23-S02', researchId: '2026-10-23-R02' }));
  build({ board });
  const configFile = path.join(board, 'config.json');
  const config = JSON.parse(fs.readFileSync(configFile));
  config.eventGroups = [{ id: '明确关联的同一事件', candidateIds: ['2026-10-23-S01', '2026-10-23-S02'], reason: '测试中已明确属于同一事件' }];
  fs.writeFileSync(configFile, JSON.stringify(config));
  assert.equal(build({ board }).events, 1);
  const html = fs.readFileSync(path.join(board, '竞对看板.html'));
  config.eventGroups.push({ id: '重复关联', candidateIds: ['2026-10-23-S01'], reason: '无效测试' });
  fs.writeFileSync(configFile, JSON.stringify(config));
  assert.throws(() => build({ board }), /重复/);
  assert.deepEqual(fs.readFileSync(path.join(board, '竞对看板.html')), html);
});

test('页面构建失败保留索引和旧页面，释放锁后可重试', t => {
  const { board, reports } = fixture(t);
  save(reports, 'one', sample());
  build({ board });
  const before = fs.readFileSync(path.join(board, '竞对看板.html'));
  const indexBefore = fs.readFileSync(path.join(board, 'data/index.json'));
  const templateFile = path.join(board, 'src/template.html');
  const template = fs.readFileSync(templateFile, 'utf8');
  fs.writeFileSync(templateFile, '<html>模板尚未完成</html>');
  assert.throws(() => build({ board }), /模板缺少/);
  assert.deepEqual(fs.readFileSync(path.join(board, '竞对看板.html')), before);
  assert.deepEqual(fs.readFileSync(path.join(board, 'data/index.json')), indexBefore);
  assert.equal(fs.existsSync(path.join(board, '.build.lock')), false);
  fs.writeFileSync(templateFile, template);
  assert.equal(build({ board }).pending, 0);
});

test('报告与整个工作区搬迁后，可从相对目录恢复原文回链', t => {
  const { board, reports, temp } = fixture(t);
  const screenFile = path.join(reports, '筛选报告.md');
  fs.writeFileSync(screenFile, '# 筛选报告\n批次：2026-10-23\n\n| 候选编号 | 厂商／产品 |\n| --- | --- |\n| 2026-10-23-S01 | 平头哥／测试产品 |\n');
  const report = sample({ title: '测试产品', extra: `[来源筛选报告](<${screenFile}>)` });
  save(reports, 'one', report);
  assert.equal(build({ board }).pending, 0);
  const movedWorkspace = path.join(temp, 'moved-workspace');
  fs.renameSync(path.resolve(board, '../..'), movedWorkspace);
  const movedBoard = path.join(movedWorkspace, 'AI芯片竞对调研Skill组合/看板');
  assert.equal(build({ board: movedBoard }).pending, 0);
  const index = readIndex(movedBoard);
  assert.equal(index.events[0].vendor, '平头哥');
});

test('只迁移报告及回链不新增研究版本，保留修订历史、登记路径与测试标识', t => {
  const { board, reports } = fixture(t);
  const workspace = path.resolve(board, '../..');
  const screenFile = path.join(reports, '测试批次', '筛选报告.md');
  fs.mkdirSync(path.dirname(screenFile), { recursive: true });
  fs.writeFileSync(screenFile, '# 筛选报告\n批次：2026-10-23\n\n| 候选编号 | 厂商／产品 |\n| --- | --- |\n| 2026-10-23-S01 | 平头哥／测试产品 |\n');
  const first = sample({ title: '测试产品', extra: `[来源筛选报告](<${screenFile}>)` });
  const reportFile = save(reports, '测试批次', first);
  build({ board, reports: [reportFile], screening: screenFile });
  const corrected = first.replace('厂商宣称已展示测试方案，交付仍未核实。', '更正后的原文，交付仍未核实。');
  fs.writeFileSync(reportFile, corrected);
  build({ board });
  const before = readIndex(board);
  assert.equal(before.events[0].versions.length, 2);
  const { createRelocator } = require('../scripts/report-paths.cjs');
  const destination = path.join(workspace, '成果', '深挖', '2026-10-23', '深挖报告.md');
  const destinationScreen = path.join(workspace, '成果', '初筛', '2026-10-23', '筛选报告.md');
  const relocations = [
    { from: path.relative(workspace, reportFile), to: path.relative(workspace, destination) },
    { from: path.relative(workspace, screenFile), to: path.relative(workspace, destinationScreen) }
  ];
  const relocate = createRelocator(relocations, workspace);
  for (const [oldFile, newFile] of [[reportFile, destination], [screenFile, destinationScreen]]) {
    fs.mkdirSync(path.dirname(newFile), { recursive: true });
    fs.writeFileSync(newFile, relocate.rewrite(fs.readFileSync(oldFile, 'utf8'), oldFile));
    fs.unlinkSync(oldFile);
  }
  const config = JSON.parse(fs.readFileSync(path.join(board, 'config.json'), 'utf8'));
  config.reportRoots = ['../../成果'];
  config.reportRelocations = relocations;
  fs.writeFileSync(path.join(board, 'config.json'), JSON.stringify(config));
  const result = build({ board });
  const after = readIndex(board);
  assert.equal(result.pending, 0);
  assert.equal(result.researchVersions, 2);
  assert.equal(result.events, 1);
  assert.equal(after.sequence, before.sequence, '路径变化不能分配新的研究序号');
  assert.deepEqual(after.events[0].versions.map(v => v.researchId), before.events[0].versions.map(v => v.researchId));
  assert.ok(after.events[0].versions.every(v => v.testRun), '搬迁后仍要保留历史测试标识');
  assert.ok(after.reports.every(r => r.paths.every(p => p.startsWith('成果/深挖/'))));
  assert.equal(after.registeredReports[0], '成果/深挖/2026-10-23/深挖报告.md');
  assert.equal(after.screeningOverrides[after.registeredReports[0]], '成果/初筛/2026-10-23/筛选报告.md');
  assert.equal(build({ board, reports: [reportFile] }).researchVersions, 2, '旧路径参数仍可映射到新位置');
  assert.equal(build({ board }).pending, 0, '重复重建不会重复迁移');
  const roundTrip = readIndex(board);
  assert.equal(roundTrip.reports.length, after.reports.length);
  assert.equal(roundTrip.screenings.length, after.screenings.length);
  const movedRoot = path.join(path.dirname(board), '成果');
  fs.renameSync(path.join(workspace, '成果'), movedRoot);
  config.reportRoots = ['../成果'];
  config.reportRelocations.push(...relocations.map(entry => ({ from: entry.to, to: 'AI芯片竞对调研Skill组合/' + entry.to })));
  fs.writeFileSync(path.join(board, 'config.json'), JSON.stringify(config));
  const moved = build({ board, reports: [reportFile] });
  const movedIndex = readIndex(board);
  assert.equal(moved.pending, 0);
  assert.equal(moved.researchVersions, 2);
  assert.equal(movedIndex.sequence, roundTrip.sequence);
  assert.deepEqual(movedIndex.reports.map(r => r.id), roundTrip.reports.map(r => r.id), '整个成果目录移动不应改变快照内容标识');
  assert.ok(movedIndex.reports.every(r => r.paths.every(p => p.startsWith('AI芯片竞对调研Skill组合/成果/'))));
  assert.ok(movedIndex.events[0].versions.every(v => v.testRun));
});

test('市场观察格式无需完成度或官方确认材料；后续关注点按需提供', t => {
  const report = sample({ summary: '行业媒体报道厂商公布新方案，值得关注其生态推进。' });
  const parsed = parseReport(report);
  assert.equal(parsed.items.length, 1);
  assert.equal(parsed.items[0].vendor, '华为');
  assert.match(parsed.items[0].summary, /行业媒体报道/);
  assert.match(parsed.items[0].unknowns, /后续客户动态/);
  assert.equal(parsed.items[0].observationNotes, '');
  assert.equal(Object.hasOwn(parsed.items[0], 'status'), false);
  const withoutFollowUps = report.split('\n## 后续关注点')[0];
  assert.equal(parseReport(withoutFollowUps).items[0].unknowns, '');
  const { board, reports } = fixture(t);
  save(reports, 'new', withoutFollowUps);
  const first = build({ board });
  assert.equal(first.events, 1);
  assert.equal(first.pending, 0);
  assert.equal(build({ board }).researchVersions, 1);
});

test('旧格式未开展项不会被当作观察成果，实际产品阶段原文保留', () => {
  const legacy = sample().replace('| 研究编号 | 候选编号 | 核心观察 |', '| 研究编号 | 候选编号 | 核心结论 | 完成程度 |')
    .replace('| --- | --- | --- |', '| --- | --- | --- | --- |')
    .replace('| 厂商宣称已展示测试方案，交付仍未核实。 |', '| 厂商宣称已展示测试方案，交付仍未核实。 | **部分完成**：交付阶段仍待观察。 |');
  const parsed = parseReport(legacy);
  assert.equal(parsed.items[0].observationNotes, '交付阶段仍待观察。');
  assert.equal(Object.hasOwn(parsed.items[0], 'status'), false);
  const notStarted = legacy.replace('**部分完成**：交付阶段仍待观察。', '未开展：工具不可用。');
  assert.throws(() => parseReport(notStarted), /没有可收录/);
  const observationCopy = require('../src/observation-copy.js');
  const body = '**完成程度：部分完成。** 厂商称芯片已完成启动测试，量产尚未完成。';
  assert.equal(observationCopy(body), '厂商称芯片已完成启动测试，量产尚未完成。');
  assert.equal(observationCopy('完成程度：**部分完成**。正文观察。'), '正文观察。');
  assert.equal(observationCopy('- **R01／部分完成：** 后续客户动态。'), '- **R01：** 后续客户动态。');
  assert.equal(observationCopy('组件量产已完成，整机验证未完成。'), '组件量产已完成，整机验证未完成。');
});
