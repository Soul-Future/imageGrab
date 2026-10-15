// =====================================================================
// 电商图片提取下载插件 - Service Worker 后台脚本 (background.js)
// 作用：
//   1. 接收 content 传来的候选图片 URL 列表，逐个 fetch + 解码，
//      过滤尺寸小于 100x100 的小图以及加载失败的坏图；
//   2. 将选中的图片转换为 PNG，并通过 chrome.downloads 完成下载；
//   3. 打开 gallery 展示页。
//
// 说明：跨域图片的 PNG 转换放在这里（而不是 content 里用 canvas 绘制），
//      是因为扩展在拥有 host_permissions 后，background 的 fetch 不受
//      页面 CORS 限制，可安全地读取 CDN 图片并解码。
//
// =====================================================================
// 【安装与使用说明】
//   1. 打开 Chrome，地址栏输入 chrome://extensions/ 并回车；
//   2. 打开右上角「开发者模式」开关；
//   3. 点击左上角「加载已解压的扩展程序」，选择本插件所在文件夹（含 manifest.json 的目录）；
//   4. 打开淘宝 / 天猫 / 京东 / 拼多多商家版的任意商品详情页，
//      右下角会出现「获取图片」悬浮按钮，点击即可抓取并下载。
//
// 【兼容性风险与注意事项】
//   - 各平台图片 CDN 域名不同（alicdn.com / 360buyimg.com / pddpic.com 等），
//     已一并写入 manifest.json 的 host_permissions；若后续出现新域名图片
//     下载失败，需要补充对应域名授权。
//   - 各平台懒加载属性名不同（data-src / data-ks-lazyload / data-lazyload 等），
//     content.js 已尽量覆盖，个别未覆盖的字段可能导致漏抓。
//   - 若某平台使用了「防盗链 + 登录态鉴权」的图片，fetch 时可能返回 403，
//     此类图片会被自动跳过。
// =====================================================================

const MIN_SIZE = 100; // 图片最小宽高（像素），低于此值视为小图/图标并过滤

// ---------------------------------------------------------------
// 消息分发
// ---------------------------------------------------------------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== 'object') return false;

  if (msg.type === 'ANALYZE_IMAGES') {
    analyzeImages(msg.urls)
      .then((items) => sendResponse({ ok: true, items }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true; // 保持通道开启以支持异步响应
  }

  if (msg.type === 'DOWNLOAD_IMAGE') {
    downloadImageAsPng(msg.url, msg.filename)
      .then((downloadId) => sendResponse({ ok: true, downloadId }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (msg.type === 'OPEN_GALLERY') {
    chrome.tabs
      .create({ url: chrome.runtime.getURL('gallery.html') })
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  return false;
});

// ---------------------------------------------------------------
// 批量分析图片：fetch + 解码，过滤小图 / 坏图
// ---------------------------------------------------------------
async function analyzeImages(urls) {
  const unique = Array.from(new Set(urls)).slice(0, 300); // 上限 300 张，防止过多
  const items = [];
  const CONCURRENCY = 6; // 并发数，避免同时请求过多

  let cursor = 0;
  async function worker() {
    while (cursor < unique.length) {
      const url = unique[cursor++];
      try {
        const info = await inspectImage(url);
        if (info) items.push(info);
      } catch (e) {
        // 单个图片失败不影响整体，忽略坏图
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, unique.length) }, () => worker())
  );
  return items;
}

// 检查单张图片：解码获取真实尺寸，返回 { url, width, height, type }
async function inspectImage(url) {
  const resp = await fetch(url, { mode: 'cors', credentials: 'omit' });
  if (!resp.ok) throw new Error('HTTP ' + resp.status);
  const blob = await resp.blob();
  const bitmap = await createImageBitmap(blob);
  const { width, height } = bitmap;
  bitmap.close();
  if (width < MIN_SIZE || height < MIN_SIZE) return null;
  return { url, width, height, type: blob.type || '' };
}

// ---------------------------------------------------------------
// 下载单张图片并确保为 PNG
// ---------------------------------------------------------------
async function downloadImageAsPng(url, filename) {
  const resp = await fetch(url, { mode: 'cors', credentials: 'omit' });
  if (!resp.ok) throw new Error('HTTP ' + resp.status);
  let blob = await resp.blob();

  // 非 PNG 则通过 canvas 转换为 PNG
  if (!(await isPngBlob(blob))) {
    blob = await convertToPng(blob);
  }

  // MV3 中 service worker 里 URL.createObjectURL 生成的 blob: 地址
  // 无法被 chrome.downloads 可靠下载，改为 base64 data URL 直接下载。
  const dataUrl = await blobToDataUrl(blob);
  return await chrome.downloads.download({
    url: dataUrl,
    filename: filename,
    saveAs: false,
    conflictAction: 'uniquify'
  });
}

// 将 Blob 读取为 base64 data URL（FileReader 在 service worker 中可用）
function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('读取图片数据失败'));
    reader.readAsDataURL(blob);
  });
}

// 判断 blob 是否为 PNG（优先看 MIME，缺失时读文件头）
async function isPngBlob(blob) {
  if ((blob.type || '').toLowerCase() === 'image/png') return true;
  const head = new Uint8Array(await blob.slice(0, 8).arrayBuffer());
  return (
    head[0] === 0x89 &&
    head[1] === 0x50 &&
    head[2] === 0x4e &&
    head[3] === 0x47
  );
}

// 使用 OffscreenCanvas 将任意图片格式转为 PNG
async function convertToPng(blob) {
  const bitmap = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return canvas.convertToBlob({ type: 'image/png' });
}
