// =====================================================================
// 电商图片提取下载插件 - 内容脚本 (content.js)
// 作用：在电商详情页右下角注入「获取图片」悬浮按钮。
//       页面加载阶段只注入按钮、不抓取图片；
//       用户点击按钮后才扫描页面图片，交给 background 分析过滤，
//       最后打开 gallery 展示页。
// =====================================================================

(function () {
  'use strict';

  // 防止重复注入（部分 SPA 页面可能多次触发）
  if (window.__imageGrabberInjected) return;
  window.__imageGrabberInjected = true;

  // ---------------------------------------------------------------
  // 1. 注入悬浮按钮
  // ---------------------------------------------------------------
  const btn = document.createElement('button');
  btn.id = 'image-grabber-btn';
  btn.type = 'button';
  btn.title = '获取当前页面所有商品图片';
  btn.innerHTML =
    '<svg viewBox="0 0 24 24" aria-hidden="true">' +
    '<path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2z' +
    'M8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/></svg>' +
    '<span class="ig-btn-text">获取图片</span>';
  document.documentElement.appendChild(btn);

  btn.addEventListener('click', onGrab);

  // ---------------------------------------------------------------
  // 2. 点击按钮后的扫描流程
  // ---------------------------------------------------------------
  async function onGrab() {
    btn.classList.add('loading');
    btn.disabled = true;
    const label = btn.querySelector('.ig-btn-text');
    if (label) label.textContent = '提取中…';

    try {
      const urls = collectImageUrls();
      if (!urls.length) {
        showToast('未找到可提取的图片');
        return;
      }

      // 交给 background 逐个 fetch 解码，过滤小图 / 坏图
      const resp = await chrome.runtime.sendMessage({ type: 'ANALYZE_IMAGES', urls });
      if (!resp || !resp.ok) {
        showToast('图片提取失败：' + ((resp && resp.error) || '未知错误'));
        return;
      }

      const items = resp.items || [];
      if (!items.length) {
        showToast('未找到符合条件的商品图片（尺寸不足或加载失败）');
        return;
      }

      // 存入 storage 供 gallery 页面读取
      await chrome.storage.local.set({
        'ig:list': items,
        'ig:meta': { title: document.title, url: location.href }
      });

      // 打开 gallery 展示页（由 background 用 chrome.tabs.create 打开）
      await chrome.runtime.sendMessage({ type: 'OPEN_GALLERY' });
    } catch (e) {
      showToast('提取出错：' + e.message);
    } finally {
      btn.classList.remove('loading');
      btn.disabled = false;
      if (label) label.textContent = '获取图片';
    }
  }

  // ---------------------------------------------------------------
  // 3. 收集候选图片 URL
  // ---------------------------------------------------------------
  function collectImageUrls() {
    const urls = new Set();

    // 3.1 <img> 标签
    const lazyAttrs = [
      'data-src', 'data-original', 'data-lazy-src', 'data-lazyload',
      'data-ks-lazyload', 'data-img', 'data-original-src', 'data-hi-res-src',
      'data-url', 'data-echo', 'data-src-retina', 'data-actualsrc'
    ];

    document.querySelectorAll('img').forEach((img) => {
      // 懒加载属性通常是原图，优先级更高
      for (const attr of lazyAttrs) {
        const v = img.getAttribute(attr);
        if (v) addCandidate(urls, v);
      }

      // srcset 取最后一项（分辨率最高）
      const srcset = img.getAttribute('data-srcset') || img.getAttribute('srcset');
      if (srcset) {
        const list = parseSrcset(srcset);
        if (list.length) addCandidate(urls, list[list.length - 1]);
      }

      if (img.currentSrc) addCandidate(urls, img.currentSrc);
      if (img.src) addCandidate(urls, img.src);
    });

    // 3.2 背景图（background-image）
    const bgTags = 'div,span,li,a,section,figure,p,td,th,ul,ol,article,main';
    document.querySelectorAll(bgTags).forEach((el) => {
      const bg = getComputedStyle(el).backgroundImage;
      if (!bg || bg === 'none') return;
      const matches = bg.match(/url\((['"]?)(.*?)\1\)/g);
      if (matches) {
        matches.forEach((m) => {
          const url = m.replace(/url\((['"]?)(.*?)\1\)/, '$2');
          addCandidate(urls, url);
        });
      }
    });

    // 归一化 URL -> 去噪 -> 去重
    return Array.from(urls)
      .map(toOriginalUrl)
      .filter(isUsefulUrl);
  }

  function parseSrcset(srcset) {
    return srcset
      .split(',')
      .map((s) => s.trim().split(/\s+/)[0])
      .filter(Boolean);
  }

  function addCandidate(set, url) {
    if (!url || typeof url !== 'string') return;
    url = url.trim();
    if (url.startsWith('data:') || url.startsWith('blob:')) return;
    if (url.startsWith('//')) url = 'https:' + url; // 协议相对地址
    if (!/^https?:\/\//i.test(url)) return;
    set.add(url);
  }

  // 将缩略图 URL 还原为原图 URL（去除尺寸参数）
  function toOriginalUrl(url) {
    if (!url) return url;
    // 淘宝 / 天猫：xxx.jpg_400x400.jpg / xxx.jpg_400x400q50.jpg -> xxx.jpg
    url = url.replace(/\.(jpe?g|png|webp)_\d+x\d+(?:q\d+)?\.(jpe?g|png|webp)$/i, '.$1');
    // 通用：xxx_400x400.jpg -> xxx.jpg
    url = url.replace(/_\d+x\d+(?:q\d+)?\.(jpe?g|png|webp)$/i, '.$1');
    return url;
  }

  // 过滤图标 / Logo / 占位图等非商品图片
  const NOISE_RE = /logo|icon|favicon|avatar|sprite|qrcode|qr_code|barcode|blank\.gif|1x1|\.svg$|transparent|placeholder|loading\.gif/i;
  function isUsefulUrl(url) {
    return !NOISE_RE.test(url);
  }

  // ---------------------------------------------------------------
  // 4. 轻量提示 Toast
  // ---------------------------------------------------------------
  function showToast(msg) {
    let t = document.getElementById('ig-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'ig-toast';
      document.documentElement.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.remove('show'), 3000);
  }
})();
