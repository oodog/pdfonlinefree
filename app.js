import * as pdfjsLib from 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.1.200/build/pdf.mjs';
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.1.200/build/pdf.worker.mjs';

const { PDFDocument, StandardFonts, rgb } = window.PDFLib;
const state = { pdfBytes: null, fileName: 'edited-document.pdf', pages: [], pageIndex: 0, zoom: 1, edits: [], selectedId: null };
const $ = (id) => document.getElementById(id);
const elements = {
  welcome: $('welcome'), workspace: $('workspace'), error: $('error'), busy: $('busyOverlay'),
  openTop: $('openPdfTop'), openWelcome: $('openPdfWelcome'), download: $('downloadButton'),
  thumbnails: $('thumbnailList'), pageCanvas: $('pageCanvas'), pageStage: $('pageStage'), pageCount: $('pageCount'),
  addText: $('addTextButton'), delete: $('deleteButton'), zoom: $('zoomSelect'),
  emptyProperties: $('emptyProperties'), propertyForm: $('propertyForm'), text: $('textInput'), fontSize: $('fontSizeInput'),
  textColor: $('textColorInput'), width: $('widthInput'), height: $('heightInput'), cover: $('coverInput'),
  coverColor: $('coverColorInput'), coverColorLabel: $('coverColorLabel')
};

function setBusy(value) { elements.busy.classList.toggle('hidden', !value); }
function showError(message = '') { elements.error.textContent = message; elements.error.classList.toggle('hidden', !message); }
function selectedEdit() { return state.edits.find((edit) => edit.id === state.selectedId) || null; }
function makeId() { return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`; }
function hexToRgb(hex) { const n = Number.parseInt(hex.replace('#', ''), 16); return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 }; }

async function loadPdf(file) {
  if (!file) return;
  setBusy(true); showError();
  try {
    state.pages.forEach((page) => URL.revokeObjectURL(page.imageUrl));
    const bytes = new Uint8Array(await file.arrayBuffer());
    const pdf = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
    const pages = [];
    for (let number = 1; number <= pdf.numPages; number += 1) {
      const page = await pdf.getPage(number);
      const viewport = page.getViewport({ scale: 1.5 });
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
      await page.render({ canvasContext: context, viewport, canvas }).promise;
      const blob = await new Promise((resolve, reject) => canvas.toBlob((result) => result ? resolve(result) : reject(new Error('Could not render page.')), 'image/png'));
      pages.push({ width: viewport.width, height: viewport.height, imageUrl: URL.createObjectURL(blob) });
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
  state.edits.filter((edit) => edit.pageIndex === state.pageIndex).forEach((edit) => {
    const box = document.createElement('div'); box.className = `text-overlay${edit.id === state.selectedId ? ' selected' : ''}`;
    Object.assign(box.style, { left: `${edit.x * state.zoom}px`, top: `${edit.y * state.zoom}px`, width: `${edit.width * state.zoom}px`, height: `${edit.height * state.zoom}px`, backgroundColor: edit.coverOriginal ? edit.coverColor : 'transparent', color: edit.color, fontSize: `${edit.fontSize * state.zoom}px` });
    box.textContent = edit.text;
    box.addEventListener('click', (event) => { event.stopPropagation(); state.selectedId = edit.id; renderPage(); renderProperties(); });
    box.addEventListener('pointerdown', (event) => beginDrag(event, edit));
    elements.pageCanvas.appendChild(box);
  });
}

function beginDrag(event, edit) {
  event.preventDefault(); state.selectedId = edit.id; renderProperties();
  const startX = event.clientX, startY = event.clientY, initialX = edit.x, initialY = edit.y, page = state.pages[state.pageIndex];
  const move = (moveEvent) => { edit.x = Math.max(0, Math.min(page.width - edit.width, initialX + (moveEvent.clientX - startX) / state.zoom)); edit.y = Math.max(0, Math.min(page.height - edit.height, initialY + (moveEvent.clientY - startY) / state.zoom)); renderPage(); };
  const stop = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop); };
  window.addEventListener('pointermove', move); window.addEventListener('pointerup', stop);
}

function renderProperties() {
  const edit = selectedEdit(); elements.delete.disabled = !edit;
  elements.emptyProperties.classList.toggle('hidden', !!edit); elements.propertyForm.classList.toggle('hidden', !edit);
  if (!edit) return;
  elements.text.value = edit.text; elements.fontSize.value = edit.fontSize; elements.textColor.value = edit.color;
  elements.width.value = Math.round(edit.width); elements.height.value = Math.round(edit.height); elements.cover.checked = edit.coverOriginal;
  elements.coverColor.value = edit.coverColor; elements.coverColorLabel.classList.toggle('hidden', !edit.coverOriginal);
}

function updateSelected(patch) { const edit = selectedEdit(); if (!edit) return; Object.assign(edit, patch); renderPage(); renderProperties(); }
function addText() {
  const page = state.pages[state.pageIndex]; if (!page) return;
  const edit = { id: makeId(), pageIndex: state.pageIndex, x: page.width * .2, y: page.height * .2, width: 220, height: 48, text: 'Edit this text', fontSize: 18, color: '#111827', coverOriginal: true, coverColor: '#ffffff' };
  state.edits.push(edit); state.selectedId = edit.id; renderPage(); renderProperties();
}
function deleteSelected() { if (!state.selectedId) return; state.edits = state.edits.filter((edit) => edit.id !== state.selectedId); state.selectedId = null; renderPage(); renderProperties(); }

async function savePdf() {
  if (!state.pdfBytes) return; setBusy(true); showError();
  try {
    const document = await PDFDocument.load(state.pdfBytes.slice()); const font = await document.embedFont(StandardFonts.Helvetica); const pdfPages = document.getPages();
    state.edits.forEach((edit) => {
      const page = pdfPages[edit.pageIndex], preview = state.pages[edit.pageIndex]; if (!page || !preview) return;
      const xScale = page.getWidth() / preview.width, yScale = page.getHeight() / preview.height;
      const x = edit.x * xScale, width = edit.width * xScale, height = edit.height * yScale, y = page.getHeight() - edit.y * yScale - height;
      if (edit.coverOriginal) { const c = hexToRgb(edit.coverColor); page.drawRectangle({ x, y, width, height, color: rgb(c.r, c.g, c.b) }); }
      const c = hexToRgb(edit.color), size = edit.fontSize * yScale;
      edit.text.split(/\r?\n/).forEach((line, index) => page.drawText(line, { x: x + 3 * xScale, y: y + height - size - index * size * 1.2, size, font, color: rgb(c.r, c.g, c.b), maxWidth: Math.max(1, width - 6 * xScale) }));
    });
    const bytes = await document.save(); const blob = new Blob([bytes], { type: 'application/pdf' }); const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = state.fileName; document.body.appendChild(anchor); anchor.click(); anchor.remove(); URL.revokeObjectURL(url);
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
elements.textColor.addEventListener('input', () => updateSelected({ color: elements.textColor.value }));
elements.width.addEventListener('input', () => updateSelected({ width: Math.max(20, Number(elements.width.value) || 20) }));
elements.height.addEventListener('input', () => updateSelected({ height: Math.max(10, Number(elements.height.value) || 10) }));
elements.cover.addEventListener('change', () => updateSelected({ coverOriginal: elements.cover.checked }));
elements.coverColor.addEventListener('input', () => updateSelected({ coverColor: elements.coverColor.value }));
