(() => {
  'use strict';
  const data = JSON.parse(document.getElementById('dashboard-data').textContent);
  const $ = id => document.getElementById(id);
  const grid = $('vendor-grid'), reader = $('reader'), content = $('reader-content');
  const byEvent = new Map(data.events.map(event => [event.id, event]));
  let currentView = null, viewStack = [], query = '', previousHash = '';
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const text = value => String(value || '').replace(/<a\b[^>]*>\s*<\/a>/gi, '').replace(/\[([^\]]+)\]\((?:<[^>]*>|[^)]*)\)/g, '$1').replace(/[*`_]/g, '').trim();
  const date = (value, full = false) => value ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', ...(full ? { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' } : {}) }).format(new Date(value)).replaceAll('/', '.') : '时间未载明';
  const observationCopy = window.observationCopy;
  const sourceWarning = state => ['missing', 'unreadable'].includes(state) ? '来源暂不可用 · 展示已收录快照' : '';

  // Markdown is treated as content, never as executable HTML. Only readable markup and safe links survive.
  function markdown(value, documentId) {
    const template = document.createElement('template');
    template.innerHTML = window.marked.parse(value || '', { gfm: true, breaks: false });
    const allowed = new Set(['P', 'BR', 'HR', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'STRONG', 'EM', 'DEL', 'BLOCKQUOTE', 'PRE', 'CODE', 'UL', 'OL', 'LI', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD', 'A']);
    const documentData = data.documents[documentId];
    for (const node of template.content.querySelectorAll('*')) {
      if (!allowed.has(node.tagName)) {
        if (node.tagName === 'IMG') node.replaceWith(document.createTextNode(node.getAttribute('alt') || '[原报告图片]'));
        else if (['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'FORM'].includes(node.tagName)) node.remove();
        else node.replaceWith(...node.childNodes);
        continue;
      }
      const href = node.getAttribute('href'), id = node.getAttribute('id');
      for (const attribute of [...node.attributes]) node.removeAttribute(attribute.name);
      if (id && /^[a-zA-Z][\w-]*$/.test(id)) node.id = `report-anchor-${id.toLowerCase()}`;
      if (node.tagName !== 'A' || !href) continue;
      let decodedHref = href;
      try { decodedHref = decodeURI(href); } catch { /* A literal percent sign may be part of the path. */ }
      const ref = documentData?.references[href] || documentData?.references[decodedHref];
      if (ref && data.documents[ref]) {
        node.href = '#'; node.dataset.document = ref;
      } else if (/^#[\w-]+$/.test(href)) {
        node.href = '#'; node.dataset.anchor = `report-anchor-${href.slice(1).toLowerCase()}`;
      } else if (/^https?:\/\//i.test(href)) {
        node.href = href; node.target = '_blank'; node.rel = 'noopener noreferrer';
      } else {
        node.className = 'unavailable-link'; node.title = '此链接未纳入当前离线档案，请查阅原文件';
      }
    }
    for (const table of template.content.querySelectorAll('table')) {
      const wrapper = document.createElement('div'); wrapper.className = 'table-scroll';
      table.replaceWith(wrapper); wrapper.append(table);
    }
    const wrapper = document.createElement('div'); wrapper.append(template.content);
    return wrapper.innerHTML;
  }

  function itemHtml(event, expanded = false) {
    const version = event.versions[0];
    const warning = sourceWarning(version.sourceState);
    return `<li class="${expanded ? 'vendor-history-item' : 'research-item'}"><div class="item-meta"><time datetime="${escape(version.time)}">研究于 ${date(version.time, true)}</time></div><button class="item-title" data-event="${escape(event.id)}">${escape(version.title)}</button><p class="item-summary">${escape(text(observationCopy(version.summary)))}</p>${warning ? `<p class="source-alert">${escape(warning)}</p>` : ''}<button class="item-link" data-event="${escape(event.id)}" aria-label="查看${escape(version.title)}详情">查看详情<span aria-hidden="true">›</span></button></li>`;
  }

  for (const event of data.events) event.search = text(observationCopy(event.vendor + ' ' + event.versions.map(v => [v.title, v.summary, v.body, v.unknowns, v.observationNotes || '', v.candidateId, v.researchId].join(' ')).join(' '))).toLocaleLowerCase();

  function renderGrid() {
    const terms = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
    let count = 0;
    const html = data.vendors.map((vendor, index) => {
      const all = data.events.filter(event => event.vendor === vendor);
      const matches = all.filter(event => terms.every(term => event.search.includes(term)));
      const vendorMatch = terms.every(term => vendor.toLocaleLowerCase().includes(term));
      if (terms.length && !matches.length && !vendorMatch) return '';
      count += matches.length;
      const visible = matches.slice(0, 3);
      const label = all.length ? `${all.length} 项研究事件 · 持续收录` : '研究成果待积累';
      return `<article class="vendor" data-vendor="${escape(vendor)}"><div class="vendor-header"><h3>${escape(vendor)}</h3><span class="vendor-index">${String(index + 1).padStart(2, '0')}</span></div><p class="vendor-sub">${escape(label)}</p>${visible.length ? `<ul class="research-list">${visible.map(event => itemHtml(event)).join('')}</ul>` : `<div class="empty-state"><span class="empty-line" aria-hidden="true"></span><p>${all.length && terms.length ? '没有匹配的研究' : '暂无深挖成果'}</p><small>${all.length && terms.length ? '试试其他关键词' : '新的深挖报告将在完成后收录于此'}</small></div>`}${matches.length > 3 ? `<button class="all-button" data-vendor-history="${escape(vendor)}"><span>查看全部 ${matches.length} 项研究</span><span aria-hidden="true">›</span></button>` : ''}</article>`;
    }).join('');
    grid.innerHTML = html || '<div class="no-results">没有找到相关研究，试试厂商名称或产品型号。</div>';
    $('search-result').textContent = terms.length ? `找到 ${count} 项相关研究` : '最新研究在前';
  }

  function setView(view, push = false) {
    if (push && currentView) viewStack.push({ view: currentView, scroll: $('reader-scroll').scrollTop });
    currentView = view;
    $('reader-back').hidden = !viewStack.length;
    if (!reader.open) {
      previousHash = location.hash;
      reader.showModal();
      document.body.style.overflow = 'hidden';
    }
    if (view.type === 'event') renderEvent(view);
    if (view.type === 'document') renderDocument(view);
    if (view.type === 'vendor') renderVendor(view);
    if (view.type === 'maintenance') renderMaintenance();
    $('reader-scroll').scrollTop = 0;
  }

  function actions(documentId, includeScreen = true) {
    const doc = data.documents[documentId];
    if (!doc) return '';
    return `<div class="reader-actions"><button data-document="${escape(documentId)}">查看完整深挖报告 ↗</button>${includeScreen && doc.screenId ? `<button data-document="${escape(doc.screenId)}">查看来源筛选报告 ↗</button>` : ''}${doc.sourceState === 'available' ? `<a href="${escape(doc.sourceUrl)}" target="_blank" rel="noopener">打开原 Markdown 文件 ↗</a>` : ''}</div>`;
  }

  function renderEvent(view) {
    const event = byEvent.get(view.id);
    if (!event) return;
    const version = event.versions[view.version || 0];
    const doc = data.documents[version.reportId];
    const warning = sourceWarning(version.sourceState);
    $('reader-context').textContent = '研究详情';
    let notes = '';
    if (view.version) notes += '<div class="reader-note warning">你正在查看历史研究。当前判断请返回最新版本。</div>';
    if (warning) notes += `<div class="reader-note warning">${escape(warning)}。原始文件恢复后，可重新核对更新。</div>`;
    if (version.sourceState === 'superseded') notes += '<div class="reader-note">此为原报告修订前的收录快照，保留用于追溯。</div>';
    const excerpt = value => markdown(observationCopy(value), version.reportId);
    const followUps = version.observationNotes || version.unknowns
      ? `<div class="section-label">原报告 · 后续关注点</div><div class="markdown">${excerpt(version.observationNotes || '')}${excerpt(version.unknowns || '')}</div>` : '';
    const history = event.versions.length > 1
      ? `<details class="version-history" ${view.version ? 'open' : ''}><summary>研究历史 · ${event.versions.length} 个版本</summary><ul class="version-list">${event.versions.map((v, i) => `<li><button class="version-button" data-version="${i}" data-event="${escape(event.id)}" aria-current="${i === (view.version || 0)}"><span>${date(v.time, true)}${i === 0 ? ' · 最新' : ''}</span><small>${escape(v.researchId)}${v.sourceState === 'superseded' ? ' · 修订前快照' : ''}</small></button></li>`).join('')}</ul></details>` : '';
    content.innerHTML = `<p class="reader-eyebrow">${escape(version.vendor)}${version.testRun ? ' · 历史测试批次' : ''}</p>
      <h2 class="reader-title" id="reader-title">${escape(version.title)}</h2>
      <div class="reader-meta"><span>研究于 ${date(version.time, true)}</span></div>${notes}
      <div class="section-label">原报告 · 观察概览</div><div class="markdown">${excerpt(version.summary)}</div>
      <hr class="reader-divider"><div class="section-label">原报告 · 信息与分析</div><article class="markdown">${excerpt(version.body)}</article>
      ${followUps}${version.evidence ? `<div class="section-label">原报告 · 对应证据</div><div class="markdown">${excerpt(version.evidence)}</div>` : ''}
      ${actions(version.reportId)}<p class="document-source">候选 ${escape(version.candidateId || '无第一阶段编号')} · 研究 ${escape(version.researchId)}<br>来源：${escape(doc.sourcePath)}</p>${history}`;
  }

  function renderDocument(view) {
    const doc = data.documents[view.id];
    if (!doc) return;
    const screening = doc.id.startsWith('screen-');
    $('reader-context').textContent = screening ? '来源筛选报告' : '完整深挖报告';
    content.innerHTML = `<p class="reader-eyebrow">${screening ? '线索发现与人工选择' : '原始研究档案'}${doc.batch ? ` · ${escape(doc.batch)}` : ''}</p><h2 class="reader-title" id="reader-title">${screening ? '筛选报告' : '完整深挖报告'}</h2><p class="document-source">${escape(doc.sourcePath)}</p>${screening ? '<p class="screening-label">初筛内容用于发现线索，研究结论请以对应深挖报告为准。</p>' : ''}${doc.sourceState !== 'available' ? '<div class="reader-note">当前展示已收录的报告快照。</div>' : ''}<article class="markdown">${markdown(doc.markdown, doc.id)}</article>${doc.sourceState === 'available' ? `<div class="reader-actions"><a href="${escape(doc.sourceUrl)}" target="_blank" rel="noopener">打开原 Markdown 文件 ↗</a></div>` : ''}`;
  }

  function renderVendor(view) {
    $('reader-context').textContent = '厂商研究档案';
    const terms = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
    const events = data.events.filter(event => event.vendor === view.vendor && terms.every(term => event.search.includes(term)));
    content.innerHTML = `<p class="reader-eyebrow">全部研究 · 按研究时间倒序</p><h2 class="reader-title" id="reader-title">${escape(view.vendor)}</h2><ul class="research-list">${events.map(event => itemHtml(event, true)).join('')}</ul>`;
  }

  function renderMaintenance() {
    $('reader-context').textContent = '收录情况';
    content.innerHTML = `<p class="reader-eyebrow">研究档案维护</p><h2 class="reader-title" id="reader-title">有 ${data.diagnostics.length} 项需要核对</h2><div class="reader-note">已收录研究继续保留。修复对应报告或路径后，重新运行看板更新即可补录。</div>${data.diagnostics.map(d => `<div class="diagnostic-item">${escape(d.message)}<small>${escape(d.path)}</small></div>`).join('')}`;
  }

  function closeReader() { reader.close(); }
  $('reader-close').addEventListener('click', closeReader);
  reader.addEventListener('click', e => { if (e.target === reader && e.clientX < reader.getBoundingClientRect().left) closeReader(); });
  reader.addEventListener('close', () => {
    document.body.style.overflow = '';
    currentView = null; viewStack = [];
    if (location.hash.startsWith('#event=')) history.replaceState(null, '', location.pathname + location.search + previousHash);
  });
  $('reader-back').addEventListener('click', () => {
    const previous = viewStack.pop();
    if (!previous) return;
    setView(previous.view);
    $('reader-scroll').scrollTop = previous.scroll;
  });
  document.addEventListener('click', e => {
    const button = e.target.closest('[data-event],[data-document],[data-vendor-history],[data-anchor]');
    if (!button) return;
    e.preventDefault();
    if (button.dataset.event) setView({ type: 'event', id: button.dataset.event, version: Number(button.dataset.version || 0) }, reader.open && currentView?.type !== 'event');
    if (button.dataset.document) setView({ type: 'document', id: button.dataset.document }, true);
    if (button.dataset.vendorHistory) setView({ type: 'vendor', vendor: button.dataset.vendorHistory });
    if (button.dataset.anchor) {
      const anchor = content.querySelector(`[id="${button.dataset.anchor.replace(/[^\w-]/g, '')}"]`);
      if (anchor) { anchor.scrollIntoView({ block: 'center' }); const row = anchor.closest('tr') || anchor; row.classList.add('highlight-anchor'); setTimeout(() => row.classList.remove('highlight-anchor'), 1800); }
    }
  });
  $('search').addEventListener('input', e => { query = e.target.value.trim(); renderGrid(); });
  document.addEventListener('keydown', e => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); if (!reader.open) $('search').focus(); } });
  $('maintenance').addEventListener('click', () => setView({ type: 'maintenance' }));
  $('as-of').textContent = data.asOf ? `报告资料截至 ${date(data.asOf, true)} · Asia/Shanghai` : '从已有深挖报告中，了解市场信息与观察。';
  $('updated-at').textContent = data.lastSuccessfulAt ? `最近成功更新于 ${date(data.lastSuccessfulAt, true)}` : `看板生成于 ${date(data.generatedAt, true)}`;
  if (data.diagnostics.length) { $('maintenance').hidden = false; $('maintenance').textContent = `${data.diagnostics.length} 项收录待核对 ›`; }
  renderGrid();
  if (location.hash.startsWith('#event=')) {
    const id = decodeURIComponent(location.hash.slice(7));
    if (byEvent.has(id)) setView({ type: 'event', id, version: 0 });
  }
})();
