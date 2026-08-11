const pdfjsLib = window.pdfjsLib;
const PDFLib = window.PDFLib;

if (!pdfjsLib) throw new Error('PDF.js did not load.');
if (!PDFLib) throw new Error('pdf-lib did not load.');

const { PDFDocument, StandardFonts, rgb } = PDFLib;

const state = {
  pdfBytes: null,
  fileName: 'edited-document.pdf',
  pdfProxy: null,
  pages: [],
  pageIndex: 0,
  zoomMode: 'fit',
  zoom: 1,
  edits: [],
  selectedId: null,
  sourceIndex: new Map(),
  preparing: new Map(),
  loadingTask: null,
  lastDownloadUrl: null,
};

const $ = (id) => window.document.getElementById(id);
const el = {
  welcome: $('welcome'),
  workspace: $('workspace'),
  error: $('error'),
  status: $('status'),
  busy: $('busyOverlay'),
  busyMessage: $('busyMessage'),
  openTop: $('openPdfTop'),
  openWelcome: $('openPdfWelcome'),
  download: $('downloadButton'),
  fallback: $('downloadFallback'),
  thumbnails: $('thumbnailList'),
  pageCanvas: $('pageCanvas'),
  pageStage: $('pageStage'),
  pageCount: $('pageCount'),
  addText: $('addTextButton'),
  delete: $('deleteButton'),
  zoom: $('zoomSelect'),
  prev: $('prevPageButton'),
  next: $('nextPageButton'),
  emptyProperties: $('emptyProperties'),
  propertyForm: $('propertyForm'),
  text: $('textInput'),
  fontSize: $('fontSizeInput'),
  fontFamily: $('fontFamilyInput'),
  fontStyle: $('fontStyleValue'),
  textColor: $('textColorInput'),
  width: $('widthInput'),
  height: $('heightInput'),
  cover: $('coverInput'),
  coverColor: $('coverColorInput'),
  coverColorLabel: $('coverColorLabel'),
  sourceInfo: $('sourceInfo'),
};

function setBusy(value, message = 'Processing PDF…') {
  if (el.busyMessage) el.busyMessage.textContent = message;
  el.busy.classList.toggle('hidden', !value);
}

function setStatus(message = '') {
  if (!el.status) return;
  el.status.textContent = message;
  el.status.classList.toggle('hidden', !message);
}

function showError(message = '') {
  el.error.textContent = message;
  el.error.classList.toggle('hidden', !message);
}

function withTimeout(promise, ms, message) {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(message)), ms);
    Promise.resolve(promise).then(
      (value) => { window.clearTimeout(timer); resolve(value); },
      (error) => { window.clearTimeout(timer); reject(error); },
    );
  });
}

function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function makeId() { return `e-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`; }
function selectedEdit() { return state.edits.find((edit) => edit.id === state.selectedId) || null; }

function rgbToHex(r, g, b) {
  return `#${[r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('')}`;
}

function hexToRgb(hex) {
  const clean = String(hex || '#000000').replace('#', '');
  const n = Number.parseInt(clean, 16) || 0;
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}

function normaliseFamily(value = '') {
  let family = String(value).replace(/["']/g, '').split(',')[0].trim();
  if (!family || /^sans-serif$/i.test(family)) return 'Arial';
  if (/^serif$/i.test(family)) return 'Times New Roman';
  if (/^monospace$/i.test(family)) return 'Courier New';
  if (/^[A-Z]{6}\+/.test(family)) family = family.slice(7);
  if (/^(g_|font|f\d+)/i.test(family)) return 'Arial';
  return family;
}

function fontTraits(fontName = '', family = '') {
  const probe = `${fontName} ${family}`.toLowerCase();
  return {
    bold: /(bold|black|heavy|semibold|demi)/.test(probe),
    italic: /(italic|oblique)/.test(probe),
  };
}

function fontCss(edit, size = edit.fontSize) {
  const family = JSON.stringify(edit.fontFamily || 'Arial');
  return `${edit.italic ? 'italic ' : ''}${edit.bold ? '700 ' : '400 '}${Math.max(1, size)}px ${family}, Arial, sans-serif`;
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
      if (data[i + 3] < 32) continue;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const chroma = Math.max(r, g, b) - Math.min(r, g, b);
      const score = lum - chroma * 0.15;
      if (!best || score < best.score) best = { r, g, b, score };
    }
    return best && best.score < 225 ? rgbToHex(best.r, best.g, best.b) : '#111111';
  } catch (_) { return '#111111'; }
}

function sampleBackgroundColor(ctx, x, y, width, height) {
  try {
    const points = [
      [x - 3, y + height / 2],
      [x + width + 3, y + height / 2],
      [x + width / 2, y - 3],
      [x + width / 2, y + height + 3],
    ];
    const colors = [];
    for (const [px, py] of points) {
      const sx = clamp(Math.round(px), 0, ctx.canvas.width - 1);
      const sy = clamp(Math.round(py), 0, ctx.canvas.height - 1);
      const data = ctx.getImageData(sx, sy, 1, 1).data;
      if (data[3] > 32) colors.push([data[0], data[1], data[2]]);
    }
    if (!colors.length) return '#ffffff';
    const avg = [0, 1, 2].map((k) => colors.reduce((sum, c) => sum + c[k], 0) / colors.length);
    return rgbToHex(avg[0], avg[1], avg[2]);
  } catch (_) { return '#ffffff'; }
}

async function readPdfFile(file) {
  if (!file) throw new Error('No PDF was selected.');
  if (typeof file.arrayBuffer === 'function') {
    try {
      const buffer = await withTimeout(file.arrayBuffer(), 30000, 'The browser took too long to read this PDF.');
      return new Uint8Array(buffer);
    } catch (error) {
      console.warn('File.arrayBuffer failed; falling back to FileReader.', error);
    }
  }

  return withTimeout(new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) resolve(new Uint8Array(reader.result));
      else reject(new Error('The browser returned an invalid PDF buffer.'));
    };
    reader.onerror = () => reject(reader.error || new Error('Could not read the PDF file.'));
    reader.onabort = () => reject(new Error('Reading the PDF was cancelled.'));
    reader.readAsArrayBuffer(file);
  }), 30000, 'The browser took too long to read this PDF.');
}

function revokePagePreview(page) {
  if (page && page.imageUrl && page.objectUrl) {
    try { URL.revokeObjectURL(page.imageUrl); } catch (_) {}
  }
}

function canvasToPreviewUrl(canvas) {
  return new Promise((resolve, reject) => {
    if (typeof canvas.toBlob === 'function') {
      canvas.toBlob((blob) => {
        if (!blob) {
          try { resolve({ url: canvas.toDataURL('image/png'), objectUrl: false }); }
          catch (error) { reject(error); }
          return;
        }
        resolve({ url: URL.createObjectURL(blob), objectUrl: true });
      }, 'image/png');
      return;
    }
    try { resolve({ url: canvas.toDataURL('image/png'), objectUrl: false }); }
    catch (error) { reject(error); }
  });
}

async function preparePage(index) {
  const descriptor = state.pages[index];
  if (!descriptor) throw new Error('Page does not exist.');
  if (descriptor.prepared) return descriptor;
  if (state.preparing.has(index)) return state.preparing.get(index);

  const task = (async () => {
    const page = await withTimeout(state.pdfProxy.getPage(index + 1), 30000, `Page ${index + 1} could not be loaded.`);
    const viewport = page.getViewport({ scale: 1.5 });
    const canvas = window.document.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil(viewport.width));
    canvas.height = Math.max(1, Math.ceil(viewport.height));
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('This browser could not create the PDF canvas.');

    const renderTask = page.render({ canvasContext: context, viewport, canvas });
    await withTimeout(renderTask.promise, 45000, `Rendering page ${index + 1} took too long.`);

    const textContent = await withTimeout(page.getTextContent(), 30000, `Reading text on page ${index + 1} took too long.`);
    const textItems = [];

    textContent.items.forEach((item, itemIndex) => {
      if (!item || typeof item.str !== 'string' || !item.str.trim()) return;
      const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
      const style = (textContent.styles && textContent.styles[item.fontName]) || {};
      const fontHeight = Math.max(6, Math.hypot(tx[2], tx[3]));
      const ascent = typeof style.ascent === 'number' ? style.ascent : (typeof style.descent === 'number' ? 1 + style.descent : 0.8);
      const top = tx[5] - fontHeight * ascent;
      const left = tx[4];
      const width = Math.max(4, Math.abs(item.width || 0) * viewport.scale);
      const height = Math.max(fontHeight * 1.12, 8);
      const family = normaliseFamily(style.fontFamily || item.fontName || 'Arial');
      const traits = fontTraits(item.fontName, family);
      const sourceId = `p${index}-t${itemIndex}`;
      const textItem = {
        sourceId,
        text: item.str,
        x: left,
        y: top,
        width,
        height,
        fontSize: fontHeight,
        fontFamily: family,
        bold: traits.bold,
        italic: traits.italic,
        color: sampleInkColor(context, left, top, width, height),
        backgroundColor: sampleBackgroundColor(context, left, top, width, height),
      };
      textItems.push(textItem);
      state.sourceIndex.set(sourceId, textItem);
    });

    const preview = await canvasToPreviewUrl(canvas);
    descriptor.width = viewport.width;
    descriptor.height = viewport.height;
    descriptor.imageUrl = preview.url;
    descriptor.objectUrl = preview.objectUrl;
    descriptor.textItems = textItems;
    descriptor.prepared = true;
    descriptor.pdfWidth = page.view ? Math.abs(page.view[2] - page.view[0]) : viewport.width / viewport.scale;
    descriptor.pdfHeight = page.view ? Math.abs(page.view[3] - page.view[1]) : viewport.height / viewport.scale;
    return descriptor;
  })();

  state.preparing.set(index, task);
  try { return await task; }
  finally { state.preparing.delete(index); }
}

function resetDocumentState() {
  state.pages.forEach(revokePagePreview);
  state.pdfBytes = null;
  state.pdfProxy = null;
  state.pages = [];
  state.pageIndex = 0;
  state.edits = [];
  state.selectedId = null;
  state.sourceIndex.clear();
  state.preparing.clear();
  if (state.lastDownloadUrl) {
    try { URL.revokeObjectURL(state.lastDownloadUrl); } catch (_) {}
    state.lastDownloadUrl = null;
  }
  if (el.fallback) el.fallback.classList.add('hidden');
}

async function loadPdf(file) {
  if (!file) return;
  setBusy(true, 'Reading PDF file…');
  showError();
  setStatus();

  try {
    resetDocumentState();
    const bytes = await readPdfFile(file);
    if (!bytes.length) throw new Error('The selected PDF is empty.');

    setBusy(true, 'Opening PDF…');
    const loadingTask = pdfjsLib.getDocument({
      data: bytes.slice(),
      useSystemFonts: true,
      isEvalSupported: false,
    });
    state.loadingTask = loadingTask;
    const pdf = await withTimeout(loadingTask.promise, 45000, 'The PDF engine could not open this file within 45 seconds.');

    state.pdfBytes = bytes;
    state.pdfProxy = pdf;
    state.pages = Array.from({ length: pdf.numPages }, (_, index) => ({
      number: index + 1,
      width: 612 * 1.5,
      height: 792 * 1.5,
      imageUrl: '',
      objectUrl: false,
      textItems: [],
      prepared: false,
    }));
    state.pageIndex = 0;
    state.fileName = `${file.name.replace(/\.pdf$/i, '') || 'document'}-edited.pdf`;

    el.welcome.classList.add('hidden');
    el.workspace.classList.remove('hidden');
    el.download.disabled = false;
    renderThumbnails();

    setBusy(true, 'Rendering page 1…');
    await preparePage(0);
    renderAll();
    setStatus(`Loaded ${pdf.numPages} page${pdf.numPages === 1 ? '' : 's'}. Tap or click existing text to edit it.`);
  } catch (error) {
    console.error(error);
    showError(error instanceof Error ? error.message : 'Unable to open this PDF.');
    if (!state.pdfProxy) {
      el.workspace.classList.add('hidden');
      el.welcome.classList.remove('hidden');
    }
  } finally {
    setBusy(false);
    if (el.openTop) el.openTop.value = '';
    if (el.openWelcome) el.openWelcome.value = '';
  }
}

function calculatedZoom(page) {
  if (!page) return 1;
  if (state.zoomMode !== 'fit') return state.zoom;
  const available = Math.max(280, el.pageStage.clientWidth - 28);
  return clamp(available / page.width, 0.2, 1.15);
}

function renderAll() {
  renderThumbnails();
  renderPage();
  renderProperties();
}

function renderThumbnails() {
  el.thumbnails.replaceChildren();
  state.pages.forEach((page, index) => {
    const button = window.document.createElement('button');
    button.type = 'button';
    button.className = `thumbnail${index === state.pageIndex ? ' active' : ''}`;
    if (page.prepared && page.imageUrl) {
      const image = window.document.createElement('img');
      image.src = page.imageUrl;
      image.alt = `Page ${index + 1}`;
      button.appendChild(image);
    } else {
      const placeholder = window.document.createElement('span');
      placeholder.className = 'thumbnail-placeholder';
      placeholder.textContent = String(index + 1);
      button.appendChild(placeholder);
    }
    const label = window.document.createElement('span');
    label.textContent = `Page ${index + 1}`;
    button.appendChild(label);
    button.addEventListener('click', () => goToPage(index));
    el.thumbnails.appendChild(button);
  });
}

function renderPage() {
  const page = state.pages[state.pageIndex];
  if (!page || !page.prepared) return;
  const zoom = calculatedZoom(page);
  el.pageCount.textContent = `Page ${state.pageIndex + 1} of ${state.pages.length}`;
  el.prev.disabled = state.pageIndex <= 0;
  el.next.disabled = state.pageIndex >= state.pages.length - 1;
  el.pageCanvas.style.width = `${page.width * zoom}px`;
  el.pageCanvas.style.height = `${page.height * zoom}px`;
  el.pageCanvas.replaceChildren();

  const image = window.document.createElement('img');
  image.src = page.imageUrl;
  image.alt = `PDF page ${state.pageIndex + 1}`;
  image.draggable = false;
  image.className = 'pdf-page-image';
  el.pageCanvas.appendChild(image);

  page.textItems.forEach((item) => {
    const edited = state.edits.some((edit) => edit.sourceId === item.sourceId);
    const hit = window.document.createElement('button');
    hit.type = 'button';
    hit.className = `source-text-hit${edited ? ' edited' : ''}`;
    hit.title = edited ? 'This text has been edited' : `Edit “${item.text}”`;
    hit.setAttribute('aria-label', `Edit text: ${item.text}`);
    Object.assign(hit.style, {
      left: `${item.x * zoom}px`,
      top: `${item.y * zoom}px`,
      width: `${Math.max(item.width, 8) * zoom}px`,
      height: `${Math.max(item.height, 8) * zoom}px`,
    });
    hit.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      selectSourceText(item);
    });
    el.pageCanvas.appendChild(hit);
  });

  state.edits.filter((edit) => edit.pageIndex === state.pageIndex).forEach((edit) => {
    const box = window.document.createElement('div');
    box.className = `text-overlay${edit.id === state.selectedId ? ' selected' : ''}`;
    Object.assign(box.style, {
      left: `${edit.x * zoom}px`,
      top: `${edit.y * zoom}px`,
      width: `${edit.width * zoom}px`,
      height: `${edit.height * zoom}px`,
      backgroundColor: edit.coverOriginal ? edit.coverColor : 'transparent',
      color: edit.color,
      fontSize: `${edit.fontSize * zoom}px`,
      fontFamily: `${JSON.stringify(edit.fontFamily)}, Arial, sans-serif`,
      fontWeight: edit.bold ? '700' : '400',
      fontStyle: edit.italic ? 'italic' : 'normal',
      lineHeight: '1.05',
    });
    box.textContent = edit.text;
    box.addEventListener('click', (event) => {
      event.stopPropagation();
      state.selectedId = edit.id;
      renderPage();
      renderProperties();
    });
    box.addEventListener('dblclick', (event) => beginInlineEdit(event, edit, box));
    box.addEventListener('pointerdown', (event) => {
      if (!box.isContentEditable) beginDrag(event, edit);
    });
    el.pageCanvas.appendChild(box);
  });
}

async function goToPage(index) {
  if (index < 0 || index >= state.pages.length || index === state.pageIndex && state.pages[index].prepared) return;
  state.pageIndex = index;
  state.selectedId = null;
  renderThumbnails();
  if (!state.pages[index].prepared) {
    setBusy(true, `Rendering page ${index + 1}…`);
    showError();
    try { await preparePage(index); }
    catch (error) { showError(error instanceof Error ? error.message : `Unable to render page ${index + 1}.`); }
    finally { setBusy(false); }
  }
  renderAll();
}

function selectSourceText(item) {
  let edit = state.edits.find((entry) => entry.sourceId === item.sourceId);
  if (!edit) {
    edit = {
      id: makeId(),
      sourceId: item.sourceId,
      pageIndex: state.pageIndex,
      x: item.x,
      y: item.y,
      width: Math.max(item.width + 4, 24),
      height: Math.max(item.height + 2, 12),
      text: item.text,
      originalText: item.text,
      fontSize: item.fontSize,
      fontFamily: item.fontFamily,
      bold: item.bold,
      italic: item.italic,
      color: item.color,
      coverOriginal: true,
      coverColor: item.backgroundColor || '#ffffff',
      sourceType: 'existing',
    };
    state.edits.push(edit);
  }
  state.selectedId = edit.id;
  renderPage();
  renderProperties();
  window.setTimeout(() => {
    el.text.focus();
    if (typeof el.text.select === 'function') el.text.select();
    if (window.matchMedia && window.matchMedia('(max-width: 820px)').matches) {
      el.propertyForm.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, 0);
}

function beginInlineEdit(event, edit, box) {
  event.preventDefault();
  event.stopPropagation();
  state.selectedId = edit.id;
  box.contentEditable = 'true';
  box.classList.add('inline-editing');
  box.focus();
  try {
    const selection = window.getSelection();
    const range = window.document.createRange();
    range.selectNodeContents(box);
    selection.removeAllRanges();
    selection.addRange(range);
  } catch (_) {}

  const finish = () => {
    edit.text = box.innerText.replace(/\n$/, '');
    box.contentEditable = 'false';
    box.classList.remove('inline-editing');
    box.removeEventListener('blur', finish);
    renderPage();
    renderProperties();
  };
  box.addEventListener('blur', finish);
  box.addEventListener('input', () => {
    edit.text = box.innerText;
    el.text.value = edit.text;
  });
  box.addEventListener('keydown', (keyEvent) => {
    if (keyEvent.key === 'Escape') box.blur();
  });
}

function beginDrag(event, edit) {
  if (event.pointerType === 'mouse' && event.button !== 0) return;
  event.preventDefault();
  state.selectedId = edit.id;
  renderProperties();
  const startX = event.clientX;
  const startY = event.clientY;
  const initialX = edit.x;
  const initialY = edit.y;
  const page = state.pages[state.pageIndex];
  const zoom = calculatedZoom(page);

  const move = (moveEvent) => {
    edit.x = Math.max(0, Math.min(page.width - edit.width, initialX + (moveEvent.clientX - startX) / zoom));
    edit.y = Math.max(0, Math.min(page.height - edit.height, initialY + (moveEvent.clientY - startY) / zoom));
    renderPage();
  };
  const stop = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', stop);
    window.removeEventListener('pointercancel', stop);
  };
  window.addEventListener('pointermove', move, { passive: false });
  window.addEventListener('pointerup', stop, { once: true });
  window.addEventListener('pointercancel', stop, { once: true });
}

function renderProperties() {
  const edit = selectedEdit();
  el.delete.disabled = !edit;
  el.emptyProperties.classList.toggle('hidden', !!edit);
  el.propertyForm.classList.toggle('hidden', !edit);
  if (!edit) return;

  el.text.value = edit.text;
  el.fontSize.value = Number(edit.fontSize.toFixed(1));
  el.textColor.value = edit.color;
  el.fontFamily.value = edit.fontFamily || 'Arial';
  el.fontStyle.textContent = `${edit.bold ? 'Bold' : 'Regular'}${edit.italic ? ' Italic' : ''}`;
  el.width.value = Math.round(edit.width);
  el.height.value = Math.round(edit.height);
  el.cover.checked = edit.coverOriginal;
  el.coverColor.value = edit.coverColor;
  el.coverColorLabel.classList.toggle('hidden', !edit.coverOriginal);
  el.sourceInfo.textContent = edit.sourceType === 'existing' ? `Existing PDF text: “${edit.originalText}”` : 'New text';
}

function updateSelected(patch) {
  const edit = selectedEdit();
  if (!edit) return;
  Object.assign(edit, patch);
  renderPage();
  renderProperties();
}

function addText() {
  const page = state.pages[state.pageIndex];
  if (!page || !page.prepared) return;
  const edit = {
    id: makeId(), sourceId: null, pageIndex: state.pageIndex,
    x: page.width * 0.2, y: page.height * 0.2, width: 220, height: 48,
    text: 'New text', originalText: '', fontSize: 18, fontFamily: 'Arial',
    bold: false, italic: false, color: '#111827', coverOriginal: false,
    coverColor: '#ffffff', sourceType: 'new',
  };
  state.edits.push(edit);
  state.selectedId = edit.id;
  renderPage();
  renderProperties();
  window.setTimeout(() => { el.text.focus(); if (el.text.select) el.text.select(); }, 0);
}

function deleteSelected() {
  if (!state.selectedId) return;
  state.edits = state.edits.filter((edit) => edit.id !== state.selectedId);
  state.selectedId = null;
  renderPage();
  renderProperties();
}

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

function dataUrlToBytes(dataUrl) {
  const comma = dataUrl.indexOf(',');
  const binary = window.atob(comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function makeTextPng(edit, pixelScale = 3) {
  const canvas = window.document.createElement('canvas');
  canvas.width = Math.max(2, Math.ceil(edit.width * pixelScale));
  canvas.height = Math.max(2, Math.ceil(edit.height * pixelScale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not render replacement text.');
  ctx.scale(pixelScale, pixelScale);
  ctx.clearRect(0, 0, edit.width, edit.height);
  ctx.fillStyle = edit.color;
  ctx.textBaseline = 'top';
  ctx.font = fontCss(edit, edit.fontSize);
  const lineHeight = edit.fontSize * 1.08;
  edit.text.split(/\r?\n/).forEach((line, i) => ctx.fillText(line, 1, i * lineHeight, Math.max(1, edit.width - 2)));
  return dataUrlToBytes(canvas.toDataURL('image/png'));
}

function isIOSLike() {
  const ua = navigator.userAgent || '';
  return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

async function ensurePreviewDescriptor(index) {
  if (state.pages[index] && !state.pages[index].prepared) await preparePage(index);
  return state.pages[index];
}

async function savePdf() {
  if (!state.pdfBytes) return;
  showError();
  setStatus();

  let iosWindow = null;
  if (isIOSLike()) {
    try {
      iosWindow = window.open('', '_blank');
      if (iosWindow && iosWindow.document) {
        iosWindow.document.write('<!doctype html><title>Preparing PDF</title><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:system-ui;padding:24px">Preparing your edited PDF…</body>');
      }
    } catch (_) { iosWindow = null; }
  }

  setBusy(true, 'Creating edited PDF…');
  try {
    const pdfDoc = await PDFDocument.load(state.pdfBytes.slice());
    const pdfPages = pdfDoc.getPages();
    const fontCache = new Map();

    for (const edit of state.edits) {
      const preview = await ensurePreviewDescriptor(edit.pageIndex);
      const page = pdfPages[edit.pageIndex];
      if (!page || !preview) continue;
      const xScale = page.getWidth() / preview.width;
      const yScale = page.getHeight() / preview.height;
      const x = edit.x * xScale;
      const width = edit.width * xScale;
      const height = edit.height * yScale;
      const y = page.getHeight() - edit.y * yScale - height;

      if (edit.coverOriginal) {
        const cover = hexToRgb(edit.coverColor);
        page.drawRectangle({ x, y, width, height, color: rgb(cover.r, cover.g, cover.b) });
      }

      const color = hexToRgb(edit.color);
      const size = edit.fontSize * yScale;
      if (isStandardLike(edit)) {
        const fontKey = chooseStandardFont(edit);
        if (!fontCache.has(fontKey)) fontCache.set(fontKey, await pdfDoc.embedFont(fontKey));
        const font = fontCache.get(fontKey);
        edit.text.split(/\r?\n/).forEach((line, lineIndex) => {
          page.drawText(line, {
            x: x + 1 * xScale,
            y: y + height - size - lineIndex * size * 1.08,
            size,
            font,
            color: rgb(color.r, color.g, color.b),
            maxWidth: Math.max(1, width - 2 * xScale),
          });
        });
      } else {
        const pngBytes = await makeTextPng(edit);
        const png = await pdfDoc.embedPng(pngBytes);
        page.drawImage(png, { x, y, width, height });
      }
    }

    const bytes = await pdfDoc.save();
    const blob = new Blob([bytes], { type: 'application/pdf' });
    if (state.lastDownloadUrl) {
      try { URL.revokeObjectURL(state.lastDownloadUrl); } catch (_) {}
    }
    const url = URL.createObjectURL(blob);
    state.lastDownloadUrl = url;

    el.fallback.href = url;
    el.fallback.download = state.fileName;
    el.fallback.textContent = isIOSLike() ? 'Open finished PDF' : 'Download again';
    el.fallback.classList.remove('hidden');

    if (isIOSLike()) {
      if (iosWindow && !iosWindow.closed) {
        iosWindow.location.href = url;
        setStatus('The edited PDF opened in a new tab. Use Share → Save to Files on iPhone/iPad.');
      } else {
        setStatus('Your edited PDF is ready. Tap “Open finished PDF”, then use Share → Save to Files.');
      }
    } else {
      const anchor = window.document.createElement('a');
      anchor.href = url;
      anchor.download = state.fileName;
      anchor.style.display = 'none';
      window.document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setStatus('Edited PDF created. If the download did not start, use “Download again”.');
    }
  } catch (error) {
    console.error(error);
    if (iosWindow && !iosWindow.closed) iosWindow.close();
    showError(error instanceof Error ? error.message : 'Unable to save this PDF.');
  } finally {
    setBusy(false);
  }
}

function onFileInput(event) {
  const files = event.target.files;
  loadPdf(files && files.length ? files[0] : null);
}

el.openTop.addEventListener('change', onFileInput);
el.openWelcome.addEventListener('change', onFileInput);
el.download.addEventListener('click', savePdf);
el.addText.addEventListener('click', addText);
el.delete.addEventListener('click', deleteSelected);
el.prev.addEventListener('click', () => goToPage(state.pageIndex - 1));
el.next.addEventListener('click', () => goToPage(state.pageIndex + 1));
el.zoom.addEventListener('change', () => {
  if (el.zoom.value === 'fit') {
    state.zoomMode = 'fit';
  } else {
    state.zoomMode = 'fixed';
    state.zoom = Number(el.zoom.value) || 1;
  }
  renderPage();
});
el.pageStage.addEventListener('click', () => {
  state.selectedId = null;
  renderPage();
  renderProperties();
});
el.text.addEventListener('input', () => updateSelected({ text: el.text.value }));
el.fontSize.addEventListener('input', () => updateSelected({ fontSize: Number(el.fontSize.value) || 6 }));
el.fontFamily.addEventListener('input', () => updateSelected({ fontFamily: el.fontFamily.value || 'Arial' }));
el.textColor.addEventListener('input', () => updateSelected({ color: el.textColor.value }));
el.width.addEventListener('input', () => updateSelected({ width: Math.max(20, Number(el.width.value) || 20) }));
el.height.addEventListener('input', () => updateSelected({ height: Math.max(10, Number(el.height.value) || 10) }));
el.cover.addEventListener('change', () => updateSelected({ coverOriginal: el.cover.checked }));
el.coverColor.addEventListener('input', () => updateSelected({ coverColor: el.coverColor.value }));

window.addEventListener('resize', () => {
  if (state.zoomMode === 'fit') renderPage();
});

window.addEventListener('beforeunload', () => {
  state.pages.forEach(revokePagePreview);
  if (state.lastDownloadUrl) {
    try { URL.revokeObjectURL(state.lastDownloadUrl); } catch (_) {}
  }
});

setStatus(`Build universal-1.0.0 • PDF.js ${pdfjsLib.version || ''}`);
