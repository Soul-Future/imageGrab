// =====================================================================
// 图提取 ImageGrab - 官网交互脚本
// 功能：
//   1. 移动端汉堡菜单开关
//   2. 导航栏滚动吸顶阴影
//   3. 导航当前区块高亮（滚动监听）
//   4. 元素滚动进入视口时淡入上移（IntersectionObserver）
// =====================================================================

(function () {
  'use strict';

  const navbar = document.getElementById('navbar');
  const nav = document.getElementById('nav');
  const navToggle = document.getElementById('navToggle');
  const navLinks = Array.from(document.querySelectorAll('.nav-link'));

  /* ---------- 1. 移动端汉堡菜单 ---------- */
  if (navToggle && nav) {
    navToggle.addEventListener('click', () => {
      const open = nav.classList.toggle('open');
      navToggle.setAttribute('aria-expanded', String(open));
    });

    // 点击导航链接后自动收起菜单
    navLinks.forEach((link) => {
      link.addEventListener('click', () => {
        nav.classList.remove('open');
        navToggle.setAttribute('aria-expanded', 'false');
      });
    });
  }

  /* ---------- 2. 导航栏滚动吸顶阴影 ---------- */
  function onScroll() {
    if (navbar) {
      navbar.classList.toggle('scrolled', window.scrollY > 10);
    }
    updateActiveLink();
  }

  /* ---------- 3. 导航当前区块高亮 ---------- */
  // 收集所有有 id 的区块，与导航链接的 href 对应
  const sections = navLinks
    .map((link) => {
      const id = link.getAttribute('href');
      if (!id || !id.startsWith('#')) return null;
      return { link, section: document.querySelector(id) };
    })
    .filter((item) => item && item.section);

  function updateActiveLink() {
    const scrollPos = window.scrollY + 120; // 偏移量，让高亮切换更自然
    let currentId = null;

    sections.forEach(({ link, section }) => {
      if (section.offsetTop <= scrollPos) {
        currentId = link.getAttribute('href');
      }
    });

    navLinks.forEach((link) => {
      const isActive = link.getAttribute('href') === currentId;
      link.classList.toggle('active', isActive);
    });
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll(); // 初始执行一次

  /* ---------- 4. 滚动入场动画 ---------- */
  const revealEls = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('visible');
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12 }
    );
    revealEls.forEach((el) => observer.observe(el));
  } else {
    // 兜底：不支持 IntersectionObserver 时直接显示
    revealEls.forEach((el) => el.classList.add('visible'));
  }
})();
