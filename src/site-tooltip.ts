import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const tippyRequire = createRequire(require.resolve("tippy.js"));
// 读取已安装的第三方发行文件并内联，静态页面离线可用，也不需要开放额外资源路由。
const asset = (path: string) =>
  readFileSync(tippyRequire.resolve(path), "utf8").replace(
    /\/\/# sourceMappingURL=.*$/gm,
    "",
  );
export const tooltipStyle =
  asset("tippy.js/dist/tippy.css") +
  `
.tippy-box[data-theme~='radar'] { background:#fcfdfc; color:#182a24; border-radius:16px; font-size:13px; line-height:1.6; box-shadow:0 12px 48px #102e2838; }
.tippy-box[data-theme~='radar'] .tippy-content { padding:0; max-height:min(80vh,720px); overflow:auto; overscroll-behavior:contain; border-radius:16px; }
.tippy-box[data-theme~='radar'] .tippy-arrow { color:#173e33; }
.birth-card { overflow-wrap:anywhere; font-family:system-ui,sans-serif; }
.birth-heading { position:sticky; top:0; z-index:1; padding:12px 44px 10px 14px; background:#173e33; color:#f6faf7; }
.birth-heading strong { font-size:18px; }
.birth-term { display:block; margin-top:4px; font-size:12px; opacity:.75; }
.birth-close { position:absolute; right:8px; top:8px; border:0; background:transparent; color:inherit; font-size:26px; cursor:pointer; width:32px; height:32px; line-height:1; }
.birth-steps { list-style:none; margin:0; padding:12px 12px max(12px,env(safe-area-inset-bottom)); }
.birth-step { position:relative; padding:0 0 10px 38px; }
.birth-step::before { content:''; position:absolute; left:13px; top:28px; bottom:0; width:1px; background:#dfe6e1; }
.birth-step:last-child::before { display:none; }
.birth-icon { position:absolute; left:0; top:0; width:28px; height:28px; border-radius:50%; display:grid; place-items:center; background:#173e33; color:#f6faf7; }
.birth-icon svg { width:15px; height:15px; fill:none; stroke:currentColor; stroke-width:1.8; stroke-linecap:round; stroke-linejoin:round; }
.birth-step h3 { font-size:13px; margin:0; padding:2px 0 4px; font-weight:650; }
.birth-value { margin:0; padding:7px 9px; background:#f0f3f2; border-radius:10px; white-space:pre-line; font-size:12px; }
.birth-value.copyable { display:flex; align-items:flex-start; gap:8px; color:#173e33; background:#edf4f1; }
.birth-value span { flex:1; min-width:0; }
.birth-copy { border:0; padding:4px; min-width:28px; min-height:28px; margin:-4px; background:none; color:inherit; cursor:pointer; flex:none; }
.birth-copy svg { width:17px; height:17px; fill:none; stroke:currentColor; stroke-width:1.6; }
.birth-note { font-size:11px; color:#697970; margin:5px 0 0; }
.birth-dialog { position:fixed; inset:auto 0 0; margin:0 auto; padding:0; width:calc(100% - 12px); max-width:600px; max-height:90dvh; border:0; border-radius:18px 18px 0 0; background:#fcfdfc; color:#182a24; overflow:auto; overscroll-behavior:contain; }
.birth-dialog::backdrop { background:#14251c66; backdrop-filter:blur(3px); }
.birth-dialog .birth-heading { padding-top:21px; }
.birth-dialog .birth-heading::before { content:''; position:absolute; width:40px; height:4px; background:#ffffff66; top:9px; left:calc(50% - 20px); border-radius:4px; }
html:has(.birth-dialog[open]) { overflow:hidden; }
.term-trigger { appearance:none; background:none; border:0; padding:0; color:inherit; font:inherit; text-align:left; cursor:help; text-decoration:underline dotted var(--muted); text-underline-offset:4px; }
.term-trigger:focus-visible { outline:2px solid var(--accent); outline-offset:4px; }
`;
// 用 DOM/textContent 构建分步卡片，外部文本始终不作为 HTML 解析。
export const tooltipScript = [
  asset("@popperjs/core/dist/umd/popper.min.js"),
  asset("tippy.js/dist/tippy-bundle.umd.min.js"),
  `// 使用固定图标与 textContent，来源内容不会被解析为 HTML。
  const birthIcons = {
    link:'<path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2"/>',
    file:'<path d="M6 2h8l4 4v16H6zM14 2v5h4M9 12h6M9 16h6"/>',
    search:'<circle cx="10" cy="10" r="7"/><path d="m15 15 6 6"/>',
    grid:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>'
  };
  function birthContent(element, close) {
    const root = document.createElement('div');
    root.className = 'birth-card';
    const heading = document.createElement('header');
    heading.className = 'birth-heading';
    const title = document.createElement('strong');
    title.textContent = '诞生路径';
    const term = document.createElement('span');
    term.className = 'birth-term';
    term.textContent = element.textContent;
    const dismiss = document.createElement('button');
    dismiss.type = 'button'; dismiss.className = 'birth-close';
    dismiss.textContent = '×'; dismiss.setAttribute('aria-label','关闭诞生路径');
    dismiss.addEventListener('click', close);
    heading.append(title, term, dismiss); root.append(heading);
    const list = document.createElement('ol'); list.className = 'birth-steps'; root.append(list);
    // 错误示范：不能按换行或中文标题解析阶段；多行 AI 理由必须完整留在同一步。
    for (const step of JSON.parse(element.getAttribute('data-birth-path') || '[]')) {
      const { title: label, text: value, copy, note } = step;
      const icon = step.kind === 'classification' ? 'grid'
        : step.kind === 'curve' || step.kind === 'search' ? 'search'
        : step.kind === 'source' ? 'link' : 'file';
      const item=document.createElement('li'); item.className='birth-step';
      const symbol=document.createElement('span'); symbol.className='birth-icon'; symbol.setAttribute('aria-hidden','true');
      symbol.innerHTML='<svg viewBox="0 0 24 24">'+birthIcons[icon]+'</svg>';
      const h=document.createElement('h3'); h.textContent=label;
      const block=document.createElement('div'); block.className='birth-value'+(copy?' copyable':'');
      const text=document.createElement('span'); text.textContent=value; block.append(text);
      if(copy) {
        const button=document.createElement('button'); button.type='button'; button.className='birth-copy'; button.setAttribute('aria-label','复制'+label);
        button.innerHTML='<svg viewBox="0 0 24 24"><rect x="7" y="7" width="13" height="14" rx="2"/><path d="M16 7V3H3v14h4"/></svg>';
        button.addEventListener('click', async()=>{
          try { await navigator.clipboard.writeText(value); button.textContent='已复制'; }
          catch { button.textContent='复制失败'; }
        }); block.append(button);
      }
      item.append(symbol,h,block);
      if(note) { const p=document.createElement('p'); p.className='birth-note'; p.textContent=note; item.append(p); }
      list.append(item);
    }
    return root;
  }
  // 手机使用浏览器原生 dialog，负责遮罩、焦点约束、Esc 和关闭后的焦点恢复。
  const birthMobile = window.matchMedia('(max-width: 640px)');
  const birthDialog = document.createElement('dialog'); birthDialog.className='birth-dialog';
  birthDialog.setAttribute('aria-label','诞生路径'); document.body.append(birthDialog);
  birthDialog.addEventListener('click', event=>{ if(event.target===birthDialog) { const r=birthDialog.getBoundingClientRect(); if(event.clientY<r.top||event.clientX<r.left||event.clientX>r.right) birthDialog.close(); } });
  const birthTooltips = tippy('[data-birth-path]', {
    content: element => birthContent(element, () => element._tippy.hide()),
    onShow: () => !birthMobile.matches,
    allowHTML: false, theme: 'radar', placement: 'bottom-start', maxWidth: 'min(520px, calc(100vw - 16px))',
    popperOptions: { strategy: 'fixed', modifiers: [{ name: 'preventOverflow', options: { padding: 8, tether: false, altAxis: true } }] },
    appendTo: () => document.body, trigger: 'mouseenter focus',
    interactive: true, hideOnClick: false, delay: [180, 80],
    aria: { content: 'describedby', expanded: false },
    duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : [100, 80]
  });
  document.querySelectorAll('[data-birth-path]').forEach(element => {
    element.addEventListener('click', () => {
      if (!birthMobile.matches) return;
      birthTooltips.forEach(tooltip => tooltip.hide());
      birthDialog.replaceChildren(birthContent(element, () => birthDialog.close()));
      birthDialog.showModal();
    });
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') birthTooltips.forEach(tooltip => tooltip.hide());
  });`,
].join("\n");
