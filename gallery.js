// =====================================================================
// 电商图片提取下载插件 - 图片展示页交互逻辑 (gallery.js)
// 作用：从 chrome.storage 读取已提取图片，网格展示，
//       支持勾选、全选、反选、放大预览、批量下载（PNG）。
// =====================================================================

(function () {
  'use strict';

  const grid = document.getElementById('grid');
  const countEl = document.getElementById('count');
  const selectAllBtn = document.getElementById('selectAll');
  const invertBtn = document.getElementById('invert');
  const downloadBtn = document.getElementById('download');
  const progressEl = document.getElementById('progress');
  const progressBar = document.getElementById('progressBar');
  const progressText = document.getElementById('progressText');

  const previewEl = document.getElementById('preview');
  const previewImg = document.getElementById('previewImg');
  const previewUrl = document.getElementById('previewUrl');
  const previewMask = document.getElementById('previewMask');
  const previewClose = document.getElementById('previewClose');

  let items = [];
  const selected = new Set(); // 存放已勾选图片的索引

  init();

  async function init() {
    const data = await chrome.storage.local.get(['ig:list', 'ig:meta']);
    items = data['ig:list'] || [];
    const meta = data['ig:meta'] || {};
    if (meta.title) document.title = meta.title + ' - 图片提取结果';
    render();
  }

  // ---------------------------------------------------------------
  // 渲染图片网格
  // ---------------------------------------------------------------
  function render() {
    grid.innerHTML = '';
    if (!items.length) {
      grid.innerHTML = '<div class="empty">没有可展示的图片，请回到商品页重新提取。</div>';
      return;
    }

    items.forEach((item, idx) => {
      const card = document.createElement('div');
      card.className = 'card';
      card.innerHTML =
        '<label class="card-check">' +
          '<input type="checkbox" data-index="' + idx + '">' +
          '<span class="checkmark"></span>' +
        '</label>' +
        '<div class="card-img" data-index="' + idx + '">' +
          '<img src="' + escapeHtml(item.url) + '" loading="lazy" alt="商品图 ' + (idx + 1) + '">' +
        '</div>' +
        '<div class="card-info">' +
          '<div class="card-size">' + item.width + ' × ' + item.height + '</div>' +
          '<div class="card-url" title="' + escapeHtml(item.url) + '">' + escapeHtml(item.url) + '</div>' +
        '</div>';
      grid.appendChild(card);
    });

    updateCount();
  }

  // ---------------------------------------------------------------
  // 事件绑定（网格内使用事件委托）
  // ---------------------------------------------------------------
  grid.addEventListener('change', (e) => {
    if (e.target.matches('input[type="checkbox"]')) {
      const idx = Number(e.target.dataset.index);
      if (e.target.checked) selected.add(idx);
      else selected.delete(idx);
      updateCount();
    }
  });

  grid.addEventListener('click', (e) => {
    const imgWrap = e.target.closest('.card-img');
    if (imgWrap) {
      const idx = Number(imgWrap.dataset.index);
      openPreview(items[idx]);
    }
  });

  selectAllBtn.addEventListener('click', () => {
    selected.clear();
    items.forEach((_, idx) => selected.add(idx));
    setAllCheckboxes(true);
    updateCount();
  });

  invertBtn.addEventListener('click', () => {
    items.forEach((_, idx) => {
      if (selected.has(idx)) selected.delete(idx);
      else selected.add(idx);
    });
    items.forEach((_, idx) => setCheckbox(idx, selected.has(idx)));
    updateCount();
  });

  downloadBtn.addEventListener('click', onDownload);

  previewClose.addEventListener('click', closePreview);
  previewMask.addEventListener('click', closePreview);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closePreview();
  });

  // ---------------------------------------------------------------
  // 辅助函数
  // ---------------------------------------------------------------
  function setAllCheckboxes(checked) {
    grid.querySelectorAll('input[type="checkbox"]').forEach((cb) => (cb.checked = checked));
  }

  function setCheckbox(idx, checked) {
    const cb = grid.querySelector('input[data-index="' + idx + '"]');
    if (cb) cb.checked = checked;
  }

  function updateCount() {
    countEl.textContent = '已选 ' + selected.size + ' 张';
  }

  function openPreview(item) {
    previewImg.src = item.url;
    previewUrl.textContent = item.url;
    previewEl.hidden = false;
  }

  function closePreview() {
    previewEl.hidden = true;
    previewImg.src = '';
  }

  // ---------------------------------------------------------------
  // 批量下载：逐张发送给 background 转换并下载
  // ---------------------------------------------------------------
  async function onDownload() {
    if (!selected.size) {
      alert('请先勾选要下载的图片');
      return;
    }

    const idxs = Array.from(selected).sort((a, b) => a - b);
    downloadBtn.disabled = true;
    progressEl.hidden = false;

    let done = 0;
    let failed = 0;
    const errors = [];

    for (let i = 0; i < idxs.length; i++) {
      const item = items[idxs[i]];
      const filename = '商品图_' + String(i + 1).padStart(3, '0') + '.png';
      progressText.textContent = '正在下载 ' + (i + 1) + '/' + idxs.length + ' …';
      progressBar.style.width = ((i / idxs.length) * 100).toFixed(1) + '%';

      try {
        const resp = await chrome.runtime.sendMessage({
          type: 'DOWNLOAD_IMAGE',
          url: item.url,
          filename: filename
        });
        if (resp && resp.ok) done++;
        else {
          failed++;
          errors.push((resp && resp.error) || '未知错误');
        }
      } catch (e) {
        failed++;
        errors.push(e.message);
      }
    }

    progressBar.style.width = '100%';
    let finalText =
      '下载完成：成功 ' + done + ' 张' + (failed ? '，失败 ' + failed + ' 张' : '');
    if (errors.length) finalText += '（原因：' + errors[0] + '）';
    progressText.textContent = finalText;

    setTimeout(() => {
      progressEl.hidden = true;
      progressBar.style.width = '0%';
      downloadBtn.disabled = false;
    }, 3000);
  }

  // HTML 转义，防止 URL 中的特殊字符破坏结构 / 注入脚本
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[c]));
  }
})();
