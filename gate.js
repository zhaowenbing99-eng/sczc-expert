/* ══════════════════════════════════════════════════════════════
   学习码门禁
   · 未验证：只显示门禁页，不加载题库与主程序（20 行数据都不给你）
   · 验证通过：写 localStorage，本机长期免输，再动态加载 data.bundle.js + app.js
   · 这是「软门禁」：静态站没有服务端，挡不住直接扒静态文件的人
   ══════════════════════════════════════════════════════════════ */
(() => {
  'use strict';

  const LS = 'sczc_license_v1';
  const SALT = window.CODE_SALT || '';
  const HASHES = new Set(window.CODE_HASHES || []);
  const $ = (s) => document.querySelector(s);

  window.__GATE = { locked: true, entered: false };
  window.__license = () => {
    try { const o = JSON.parse(localStorage.getItem(LS) || 'null'); return o && HASHES.has(o.h) ? o : null; }
    catch (e) { return null; }
  };

  const normalize = (v) => String(v == null ? '' : v).toUpperCase().replace(/[\s\-_—–.]/g, '');

  async function sha256hex(str) {
    if (window.crypto && window.crypto.subtle) {
      const d = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
      return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, '0')).join('');
    }
    return null;
  }

  function loadScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = res;
      s.onerror = () => rej(new Error('加载失败：' + src));
      document.body.appendChild(s);
    });
  }

  function setBusy(on, text) {
    const btn = $('#gateBtn');
    const inp = $('#gateInput');
    if (btn) { btn.disabled = on; btn.textContent = on ? (text || '正在进入…') : '进入学习系统'; }
    if (inp) inp.disabled = on;
  }

  function fail(msg, shake) {
    const err = $('#gateErr');
    if (err) err.textContent = msg;
    const box = $('.gate-card');
    if (shake && box) { box.classList.remove('shake'); void box.offsetWidth; box.classList.add('shake'); }
  }

  /** 加载题库与主程序，然后淡出门禁 */
  async function enterApp() {
    window.__GATE.locked = false;
    setBusy(true, '正在载入题库…');
    try {
      if (!window.DB) await loadScript('data.bundle.js');
      if (!window.__appStarted) await loadScript('app.js');
      const g = $('#gate');
      if (g) { g.classList.add('done'); setTimeout(() => g.remove(), 320); }
    } catch (e) {
      window.__GATE.locked = true;
      setBusy(false);
      fail('题库加载失败，请检查网络后重试');
    }
  }

  let fails = 0;
  async function verify(raw) {
    const code = normalize(raw);
    if (!code) return fail('请先输入学习码');
    if (code.length < 6) return fail('学习码长度不对，请检查是否抄漏');

    setBusy(true, '校验中…');
    const h = await sha256hex(SALT + ':' + code);
    if (!h) { setBusy(false); return fail('当前环境不支持校验，请用浏览器打开线上网址'); }

    if (HASHES.has(h)) {
      try { localStorage.setItem(LS, JSON.stringify({ h, ts: Date.now(), v: 1 })); } catch (e) {}
      fail('');
      await enterApp();
    } else {
      fails++;
      setBusy(false);
      fail(fails >= 3 ? `学习码无效（已连错 ${fails} 次，请联系发码人核对）` : '学习码无效，请核对后重试', true);
      const inp = $('#gateInput'); if (inp) { inp.select(); }
    }
  }

  function init() {
    // 单文件版（题库已内联）：无需门禁，直接放行
    if (window.DB) { const g = $('#gate'); if (g) g.remove(); return; }

    const g = $('#gate');
    if (!g) return;

    // 已激活：不闪门禁，直接进
    if (window.__license()) { g.remove(); enterApp(); return; }

    g.hidden = false;
    const b = document.getElementById('boot');
    if (b) b.remove();

    const form = $('#gateForm');
    const input = $('#gateInput');
    if (input) {
      input.addEventListener('input', () => {
        input.value = input.value.toUpperCase();
        const e = $('#gateErr'); if (e) e.textContent = '';
      });
      setTimeout(() => input.focus(), 150);
    }
    if (form) form.addEventListener('submit', (ev) => { ev.preventDefault(); verify(input ? input.value : ''); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
