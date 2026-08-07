import * as pdfjsLib from 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.1.200/build/pdf.mjs';
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.1.200/build/pdf.worker.mjs';

const { PDFDocument, StandardFonts, rgb } = window.PDFLib;
const state = {
  pdfBytes: null,
  fileName: 'edited-document.pdf',
  pages: [],
  pageIndex: 0,
  zoom: 1,
  edits: [],
  selectedId: null,
  sourceIndex: new Map()
};

const $ = (id) => document.getElementById(id);
const elements = {
  welcome: $('welcome'), workspace: $('workspace'), error: $('error'), busy: $('busyOverlay'),
  openTop: $('openPdfTop'), openWelcome: $('openPdfWelcome'), download: $('downloadButton'),
  thumbnails: $('thumbnailList'), pageCanvas: $('pageCanvas'), pageStage: $('pageStage'), pageCount: $('pageCount'),
  addText: $('addTextButton'), delete: $('deleteButton'), zoom: $('zoomSelect'),
  emptyProperties: $('emptyProperties'), propertyForm: $('propertyForm'), text: $('textInput'), fontSize: $('fontSizeInput'),
  fontFamily: $('fontFamilyInput'), fontStyle: $('fontStyleValue'), textColor: $('textColorInput'), width: $('widthInput'), height: $('heightInput'),
  cover: $('coverInput'), coverColor: $('coverColorInput'), coverColorLabel: $('coverColorLabel'), sourceInfo: $('sourceInfo')
};

function setBusy(value) { elements.busy.classList.toggle('hidden', !value); }
function showError(message = '') { elements.error.textContent = message; elements.error.classList.toggle('hidden', !message); }
function selectedEdit() { return state.edits.find((edit) => edit.id === state.selectedId) || null; }
function makeId() { return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`; }
function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
function hexToRgb(hex) {
  const n = Number.parseInt(hex.replace('#', ''), 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}
function rgbToHex(r, g, b) { return `#${[r,g,b].map(v => clamp(Math.round(v),0,255).toString(16).padStart(2,'0')).join('')}`; }
function normaliseFamily(value = '') {
  const family = String(value).replace(/["']/g, '').split(',')[0].trim();
  if (!family || /^sans-serif$/i.test(family)) return 'Arial';
  if (/^serif$/i.test(family)) return 'Times New Roman';
  if (/^monospace$/i.test(family)) return 'Courier New';
  return family;
}
function fontTraits(fontName = '', family = '') {
  const probe = `${fontName} ${family}`.toLowerCase();
  return {
    bold: /(bold|black|heavy|semibold|demi)/.test(probe),
    italic: /(italic|oblique)/.test(probe)
  };
}
function fontCss(edit, size = edit.fontSize) {
  return `${edit.italic ? 'italic ' : ''}${edit.bold ? '700 ' : '400 '}${Math.max(1,size)}px ${JSON.stringify(edit.fontFamily || 'Arial')}, Arial, sans-serif`;
}

function sampleInkColor(ctx, x, y, width, height) {
  try {
    const sx = clamp(Math.floor(x), 0, ctx.canvas.width - 1);
    const sy = clamp(Math.floor(y), 0, ctx.canvas.height - 1);
    const sw = clamp(Math.ceil(width), 1, ctx.canvas.width - sx);
    const sh = clamp(Math.ceil(height), 1, ctx.canvas.height - sy);
    const data = ctx.getImageData(sx, sy, sw, sh).data;
    let best = null;
    for (let i = 0; i < data.length; i += 16) {
      const a = data[i + 3]; if (a < 32) continue;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const lum = .2126 * r + .7152 * g + .0722 * b;
      const chroma = Math.max(r,g,b) - Math.min(r,g,b);
      const score = lum - chroma * .15;
      if (!best || score < best.score) best = { r, g, b, score };
    }
    return best && best.score < 225 ? rgbToHex(best.r,best.g,best.b) : '#111111';
  } catch { return '#111111'; }
}
function sampleBackgroundColor(ctx, x, y, width, height) {
  try {
    const points = [
      [x - 3, y + height / 2], [x + width + 3, y + height / 2],
      [x + width / 2, y - 3], [x + width / 2, y + height + 3]
    ];
    const colors = [];
    for (const [px,py] of points) {
      const sx = clamp(Math.round(px), 0, ctx.canvas.width - 1);
      const sy = clamp(Math.round(py), 0, ctx.canvas.height - 1);
      const d = ctx.getImageData(sx, sy, 1, 1).data;
      if (d[3] > 32) colors.push([d[0],d[1],d[2]]);
    }
    if (!colors.length) return '#ffffff';
    const avg = [0,1,2].map(k => colors.reduce((sum,c) => sum + c[k], 0) / colors.length);
    return rgbToHex(...avg);
  } catch { return '#ffffff'; }
}

async function loadPdf(file) {
  if (!file) return;
  setBusy(true); showError();
  try {
    state.pages.forEach((page) => URL.revokeObjectURL(page.imageUrl));
    const bytes = new Uint8Array(await file.arrayBuffer());
    const pdf = await pdfjsLib.getDocument({ data: bytes.slice(), useSystemFonts: true }).promise;
    const pages = [];
    state.sourceIndex.clear();

    for (let number = 1; number <= pdf.numPages; number += 1) {
      const page = await pdf.getPage(number);
      const viewport = page.getViewport({ scale: 1.5 });
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d', { willReadFrequently: true });
      canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
      await page.render({ canvasContext: context, viewport, canvas }).promise;

      const textContent = await page.getTextContent();
      const textItems = [];
      textContent.items.forEach((item, itemIndex) => {
        if (!('str' in item) || !item.str || !item.str.trim()) return;
        const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
        const style = textContent.styles?.[item.fontName] || {};
        const fontHeight = Math.max(6, Math.hypot(tx[2], tx[3]));
        const ascent = typeof style.ascent === 'number' ? style.ascent : (typeof style.descent === 'number' ? 1 + style.descent : .8);
        const top = tx[5] - fontHeight * ascent;
        const left = tx[4];
        const width = Math.max(4, Math.abs(item.width || 0) * viewport.scale);
        const height = Math.max(fontHeight * 1.12, 8);
        const family = normaliseFamily(style.fontFamily || item.fontName || 'Arial');
        const traits = fontTraits(item.fontName, family);
        const sourceId = `p${number - 1}-t${itemIndex}`;
        const textItem = {
          sourceId, text: item.str, x: left, y: top, width, height,
          fontSize: fontHeight, fontFamily: family, bold: traits.bold, italic: traits.italic,
          color: sampleInkColor(context, left, top, width, height),
          backgroundColor: sampleBackgroundColor(context, left, top, width, height)
        };
        textItems.push(textItem);
        state.sourceIndex.set(sourceId, textItem);
      });

      const blob = await new Promise((resolve, reject) => canvas.toBlob((result) => result ? resolve(result) : reject(new Error('Could not render page.')), 'image/png'));
      pages.push({ width: viewport.width, height: viewport.height, imageUrl: URL.createObjectURL(blob), textItems });
    }

    state.pdfBytes = bytes; state.pages = pages; state.pageIndex = 0; state.edits = []; state.selectedId = null;
    state.fileName = `${file.name.replace(/\.pdf$/i, '')}-edited.pdf`;
    elements.welcome.classList.add('hidden'); elements.workspace.classList.remove('hidden'); elements.download.disabled = false;
    renderAll();
  } catch (error) { showError(error instanceof Error ? error.message : 'Unable to open this PDF.'); }
  finally { setBusy(false); elements.openTop.value = ''; elements.openWelcome.value = ''; }
}

function renderAll() { renderThumbnails(); renderPage(); renderProperties(); }
function renderThumbnails() {
  elements.thumbnails.replaceChildren();
  state.pages.forEach((page, index) => {
    const button = document.createElement('button'); button.className = `thumbnail${index === state.pageIndex ? ' active' : ''}`;
    button.innerHTML = `<img src="${page.imageUrl}" alt="Page ${index + 1}"><span>Page ${index + 1}</span>`;
    button.addEventListener('click', () => { state.pageIndex = index; state.selectedId = null; renderAll(); });
    elements.thumbnails.appendChild(button);
  });
}

function renderPage() {
  const page = state.pages[state.pageIndex]; if (!page) return;
  elements.pageCount.textContent = `Page ${state.pageIndex + 1} of ${state.pages.length}`;
  elements.pageCanvas.style.width = `${page.width * state.zoom}px`; elements.pageCanvas.style.height = `${page.height * state.zoom}px`;
  elements.pageCanvas.replaceChildren();

  const image = document.createElement('img'); image.src = page.imageUrl; image.alt = `PDF page ${state.pageIndex + 1}`; image.draggable = false;
  elements.pageCanvas.appendChild(image);

  page.textItems.forEach((item) => {
    const edited = state.edits.some(e => e.sourceId === item.sourceId);
    const hit = document.createElement('button');
    hit.type = 'button';
    hit.className = `source-text-hit${edited ? ' edited' : ''}`;
    hit.title = edited ? 'This text has been edited' : `Edit “${item.text}”`;
    hit.setAttribute('aria-label', `Edit text: ${item.text}`);
    Object.assign(hit.style, {
      left: `${item.x * state.zoom}px`, top: `${item.y * state.zoom}px`,
      width: `${Math.max(item.width, 8) * state.zoom}px`, height: `${Math.max(item.height, 8) * state.zoom}px`
    });
    hit.addEventListener('click', (event) => { event.stopPropagation(); selectSourceText(item); });
    elements.pageCanvas.appendChild(hit);
  });

  state.edits.filter((edit) => edit.pageIndex === state.pageIndex).forEach((edit) => {
    const box = document.createElement('div'); box.className = `text-overlay${edit.id === state.selectedId ? ' selected' : ''}`;
    Object.assign(box.style, {
      left: `${edit.x * state.zoom}px`, top: `${edit.y * state.zoom}px`, width: `${edit.width * state.zoom}px`, height: `${edit.height * state.zoom}px`,
      backgroundColor: edit.coverOriginal ? edit.coverColor : 'transparent', color: edit.color,
      fontSize: `${edit.fontSize * state.zoom}px`, fontFamily: `${JSON.stringify(edit.fontFamily)}, Arial, sans-serif`,
      fontWeight: edit.bold ? '700' : '400', fontStyle: edit.italic ? 'italic' : 'normal', lineHeight: '1.05'
    });
    box.textContent = edit.text;
    box.addEventListener('click', (event) => { event.stopPropagation(); state.selectedId = edit.id; renderPage(); renderProperties(); });
    box.addEventListener('dblclick', (event) => beginInlineEdit(event, edit, box));
    box.addEventListener('pointerdown', (event) => { if (!box.isContentEditable) beginDrag(event, edit); });
    elements.pageCanvas.appendChild(box);
  });
}

function selectSourceText(item) {
  let edit = state.edits.find(e => e.sourceId === item.sourceId);
  if (!edit) {
    edit = {
      id: makeId(), sourceId: item.sourceId, pageIndex: state.pageIndex, x: item.x, y: item.y,
      width: Math.max(item.width + 4, 24), height: Math.max(item.height + 2, 12), text: item.text,
      originalText: item.text, fontSize: item.fontSize, fontFamily: item.fontFamily,
      bold: item.bold, italic: item.italic, color: item.color,
      coverOriginal: true, coverColor: item.backgroundColor || '#ffffff', sourceType: 'existing'
    };
    state.edits.push(edit);
  }
  state.selectedId = edit.id;
  renderPage(); renderProperties();
  setTimeout(() => { elements.text.focus(); elements.text.select(); }, 0);
}

function beginInlineEdit(event, edit, box) {
  event.preventDefault(); event.stopPropagation(); state.selectedId = edit.id;
  box.contentEditable = 'true'; box.classList.add('inline-editing'); box.focus();
  const selection = window.getSelection(); const range = document.createRange(); range.selectNodeContents(box); selection.removeAllRanges(); selection.addRange(range);
  const finish = () => {
    edit.text = box.innerText.replace(/\n$/, ''); box.contentEditable = 'false'; box.classList.remove('inline-editing');
    box.removeEventListener('blur', finish); renderPage(); renderProperties();
  };
  box.addEventListener('blur', finish);
  box.addEventListener('input', () => { edit.text = box.innerText; if (elements.text) elements.text.value = edit.text; });
  box.addEventListener('keydown', (e) => { if (e.key === 'Escape') box.blur(); });
}

function beginDrag(event, edit) {
  if (event.button !== 0) return;
  event.preventDefault(); state.selectedId = edit.id; renderProperties();
  const startX = event.clientX, startY = event.clientY, initialX = edit.x, initialY = edit.y, page = state.pages[state.pageIndex];
  const move = (moveEvent) => {
    edit.x = Math.max(0, Math.min(page.width - edit.width, initialX + (moveEvent.clientX - startX) / state.zoom));
    edit.y = Math.max(0, Math.min(page.height - edit.height, initialY + (moveEvent.clientY - startY) / state.zoom)); renderPage();
  };
  const stop = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop); };
  window.addEventListener('pointermove', move); window.addEventListener('pointerup', stop);
}

function renderProperties() {
  const edit = selectedEdit(); elements.delete.disabled = !edit;
  elements.emptyProperties.classList.toggle('hidden', !!edit); elements.propertyForm.classList.toggle('hidden', !edit);
  if (!edit) return;
  elements.text.value = edit.text; elements.fontSize.value = Number(edit.fontSize.toFixed(1)); elements.textColor.value = edit.color;
  elements.fontFamily.value = edit.fontFamily || 'Arial';
  elements.fontStyle.textContent = `${edit.bold ? 'Bold' : 'Regular'}${edit.italic ? ' Italic' : ''}`;
  elements.width.value = Math.round(edit.width); elements.height.value = Math.round(edit.height); elements.cover.checked = edit.coverOriginal;
  elements.coverColor.value = edit.coverColor; elements.coverColorLabel.classList.toggle('hidden', !edit.coverOriginal);
  elements.sourceInfo.textContent = edit.sourceType === 'existing' ? `Existing PDF text: “${edit.originalText}”` : 'New text';
}

function updateSelected(patch) { const edit = selectedEdit(); if (!edit) return; Object.assign(edit, patch); renderPage(); renderProperties(); }
function addText() {
  const page = state.pages[state.pageIndex]; if (!page) return;
  const edit = { id: makeId(), sourceId: null, pageIndex: state.pageIndex, x: page.width * .2, y: page.height * .2, width: 220, height: 48, text: 'New text', originalText: '', fontSize: 18, fontFamily: 'Arial', bold: false, italic: false, color: '#111827', coverOriginal: false, coverColor: '#ffffff', sourceType: 'new' };
  state.edits.push(edit); state.selectedId = edit.id; renderPage(); renderProperties(); setTimeout(() => { elements.text.focus(); elements.text.select(); }, 0);
}
function deleteSelected() { if (!state.selectedId) return; state.edits = state.edits.filter((edit) => edit.id !== state.selectedId); state.selectedId = null; renderPage(); renderProperties(); }

function chooseStandardFont(edit) {
  const family = (edit.fontFamily || '').toLowerCase();
  const isTimes = /(times|serif|georgia|cambria|garamond)/.test(family);
  const isCourier = /(courier|mono|consolas|menlo)/.test(family);
  if (isTimes) {
    if (edit.bold && edit.italic) return StandardFonts.TimesRomanBoldItalic;
    if (edit.bold) return StandardFonts.TimesRomanBold;
    if (edit.italic) return StandardFonts.TimesRomanItalic;
    return StandardFonts.TimesRoman;
  }
  if (isCourier) {
    if (edit.bold && edit.italic) return StandardFonts.CourierBoldOblique;
    if (edit.bold) return StandardFonts.CourierBold;
    if (edit.italic) return StandardFonts.CourierOblique;
    return StandardFonts.Courier;
  }
  if (edit.bold && edit.italic) return StandardFonts.HelveticaBoldOblique;
  if (edit.bold) return StandardFonts.HelveticaBold;
  if (edit.italic) return StandardFonts.HelveticaOblique;
  return StandardFonts.Helvetica;
}
function isStandardLike(edit) {
  return /(arial|helvetica|times|serif|courier|mono|consolas|georgia|cambria|garamond)/i.test(edit.fontFamily || '');
}

async function makeTextPng(edit, pixelScale = 3) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(2, Math.ceil(edit.width * pixelScale));
  canvas.height = Math.max(2, Math.ceil(edit.height * pixelScale));
  const ctx = canvas.getContext('2d'); ctx.scale(pixelScale, pixelScale);
  ctx.clearRect(0,0,edit.width,edit.height);
  const c = edit.color; ctx.fillStyle = c; ctx.textBaseline = 'top'; ctx.font = fontCss(edit, edit.fontSize);
  const lineHeight = edit.fontSize * 1.08;
  edit.text.split(/\r?\n/).forEach((line, i) => ctx.fillText(line, 1, i * lineHeight, Math.max(1, edit.width - 2)));
  const blob = await new Promise((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('Could not render replacement text.')), 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}

async function savePdf() {
  if (!state.pdfBytes) return; setBusy(true); showError();
  try {
    const pdfDoc = await PDFDocument.load(state.pdfBytes.slice()); const pdfPages = pdfDoc.getPages();
    const fontCache = new Map();
    for (const edit of state.edits) {
      const page = pdfPages[edit.pageIndex], preview = state.pages[edit.pageIndex]; if (!page || !preview) continue;
      const xScale = page.getWidth() / preview.width, yScale = page.getHeight() / preview.height;
      const x = edit.x * xScale, width = edit.width * xScale, height = edit.height * yScale, y = page.getHeight() - edit.y * yScale - height;
      if (edit.coverOriginal) {
        const c = hexToRgb(edit.coverColor); page.drawRectangle({ x, y, width, height, color: rgb(c.r, c.g, c.b) });
      }
      const c = hexToRgb(edit.color), size = edit.fontSize * yScale;
      if (isStandardLike(edit)) {
        const fontKey = chooseStandardFont(edit);
        if (!fontCache.has(fontKey)) fontCache.set(fontKey, await pdfDoc.embedFont(fontKey));
        const font = fontCache.get(fontKey);
        edit.text.split(/\r?\n/).forEach((line, index) => page.drawText(line, {
          x: x + 1 * xScale, y: y + height - size - index * size * 1.08,
          size, font, color: rgb(c.r, c.g, c.b), maxWidth: Math.max(1, width - 2 * xScale)
        }));
      } else {
        // For non-standard/embedded fonts, render with the detected browser font to preserve appearance as closely as possible.
        const pngBytes = await makeTextPng(edit);
        const png = await pdfDoc.embedPng(pngBytes);
        page.drawImage(png, { x, y, width, height });
      }
    }
    const bytes = await pdfDoc.save(); const blob = new Blob([bytes], { type: 'application/pdf' }); const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = state.fileName; document.body.appendChild(anchor); anchor.click(); anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) { showError(error instanceof Error ? error.message : 'Unable to save this PDF.'); }
  finally { setBusy(false); }
}

elements.openTop.addEventListener('change', (event) => loadPdf(event.target.files?.[0]));
elements.openWelcome.addEventListener('change', (event) => loadPdf(event.target.files?.[0]));
elements.download.addEventListener('click', savePdf); elements.addText.addEventListener('click', addText); elements.delete.addEventListener('click', deleteSelected);
elements.zoom.addEventListener('change', () => { state.zoom = Number(elements.zoom.value); renderPage(); });
elements.pageStage.addEventListener('click', () => { state.selectedId = null; renderPage(); renderProperties(); });
elements.text.addEventListener('input', () => updateSelected({ text: elements.text.value }));
elements.fontSize.addEventListener('input', () => updateSelected({ fontSize: Number(elements.fontSize.value) || 6 }));
elements.fontFamily.addEventListener('input', () => updateSelected({ fontFamily: elements.fontFamily.value || 'Arial' }));
elements.textColor.addEventListener('input', () => updateSelected({ color: elements.textColor.value }));
elements.width.addEventListener('input', () => updateSelected({ width: Math.max(20, Number(elements.width.value) || 20) }));
elements.height.addEventListener('input', () => updateSelected({ height: Math.max(10, Number(elements.height.value) || 10) }));
elements.cover.addEventListener('change', () => updateSelected({ coverOriginal: elements.cover.checked }));
elements.coverColor.addEventListener('input', () => updateSelected({ coverColor: elements.coverColor.value }));
