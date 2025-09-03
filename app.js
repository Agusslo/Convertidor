/* MasterCode — Convertidor en el navegador
   Soporta:
   - IMG: jpg ↔ png ↔ webp (via <canvas>)
   - IMG → PDF (via jsPDF)
   - PDF → IMG (via PDF.js + JSZip)
   - DOCX → PDF (mammoth -> HTML -> html2pdf)
   - TXT/MD → PDF (showdown/html2pdf)
*/

const state = {
  files: [],
  targetFormat: 'auto',
  imgQuality: 0.92,
  pdfPageSize: 'a4'
};

// UI refs
const fileInput = document.getElementById('fileInput');
const dropArea  = document.getElementById('dropArea');
const browseBtn = document.getElementById('browseBtn');
const fileList  = document.getElementById('fileList');
const targetSel = document.getElementById('targetFormat');
const convertBtn= document.getElementById('convertBtn');
const imgQuality= document.getElementById('imgQuality');
const pdfPageSz = document.getElementById('pdfPageSize');
const progress  = document.getElementById('progressBar');
const logEl     = document.getElementById('log');

// Helpers
const log = (msg) => {
  const time = new Date().toLocaleTimeString();
  logEl.innerHTML += `[${time}] ${msg}<br>`;
  logEl.scrollTop = logEl.scrollHeight;
};
const setProgress = (p) => progress.style.width = `${Math.max(0,Math.min(100,p))}%`;

// ✔ Detectores robustos (nombre + MIME)
const isImage = (name, type) => {
  const t = (type || '').toLowerCase();
  const n = (name || '').toLowerCase();
  if (t.startsWith('image/')) return /(png|jpeg|jpg|webp)$/.test(t);
  return /\.(png|jpe?g|webp)$/.test(n);
};
const isDocx  = (name, type) =>
  /application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document/i.test(type || '') ||
  /\.docx$/i.test(name || '');
const isTxt   = (name, type) => /^text\/plain/i.test(type || '') || /\.txt$/i.test(name || '');
const isMd    = (name, type) => /^text\/markdown/i.test(type || '') || /\.md$/i.test(name || '');
const isPdf   = (name, type) => /application\/pdf/i.test(type || '') || /\.pdf$/i.test(name || '');

// Si usás la versión CDN, en index.html ya se expone window.pdfjsLib y se setea el worker.
// Lo tomamos por si lo necesitáramos acá:
const pdfjsLibGlobal = window.pdfjsLib;

// Populate suitable output formats based on selection
function refreshFormatOptions() {
  const any = state.files;
  const opts = new Set();

  let hasImg=false, hasDocx=false, hasTxt=false, hasMd=false, hasPdf=false;
  for (const f of any) {
    const t = f.type || '';
    const n = f.name || '';
    hasImg  ||= isImage(n, t);
    hasDocx ||= isDocx(n, t);
    hasTxt  ||= isTxt(n, t);
    hasMd   ||= isMd(n, t);
    hasPdf  ||= isPdf(n, t);
  }

  opts.add('auto');
  if (hasImg){ 
    opts.add('png'); opts.add('jpg'); opts.add('webp'); opts.add('pdf');
    opts.add('ico');
  }
  if (hasDocx){ opts.add('pdf'); }
  if (hasTxt || hasMd){ opts.add('pdf'); }
  if (hasPdf){ opts.add('png'); opts.add('jpg'); } // PDF → imágenes

  targetSel.innerHTML = '';
  for (const v of opts) {
    const o = document.createElement('option');
    o.value = v; o.textContent = v.toUpperCase();
    targetSel.appendChild(o);
  }
  targetSel.value = state.targetFormat = 'auto';
}


function addFiles(files) {
  for (const f of files) {
    state.files.push(f);
  }
  renderList();
  refreshFormatOptions();
}

function renderList() {
  fileList.innerHTML = '';
  state.files.forEach((f, idx) => {
    const li = document.createElement('li');
    li.className = 'file-item';
    const name = document.createElement('div');
    name.innerHTML = `<strong>${f.name}</strong><br /><small>${f.type || '(sin MIME)'} — ${formatBytes(f.size)}</small>`;
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = tagForFile(f);
    const del = document.createElement('button');
    del.textContent = '✕';
    del.title = 'Quitar';
    del.className = 'primary';
    del.style.padding = '4px 10px';
    del.style.background = 'linear-gradient(135deg, #ff6b6b, #ff8e8e)';
    del.onclick = () => { state.files.splice(idx,1); renderList(); refreshFormatOptions(); };
    li.appendChild(name); li.appendChild(badge); li.appendChild(del);
    fileList.appendChild(li);
  });
}
const formatBytes = (b) => {
  if (!b && b!==0) return '—';
  const units = ['B','KB','MB','GB']; let i = 0;
  while (b >= 1024 && i < units.length-1) { b/=1024; i++; }
  return `${b.toFixed(1)} ${units[i]}`;
};
const tagForFile = (f) => {
  const n=f.name||'', t=f.type||'';
  // prioridad: DOCX / PDF / MD / TXT antes que Imagen
  if (isDocx(n,t)) return 'DOCX';
  if (isPdf(n,t))  return 'PDF';
  if (isMd(n,t))   return 'MD';
  if (isTxt(n,t))  return 'TXT';
  if (isImage(n,t))return 'Imagen';
  return 'Archivo';
};

// File input / drag & drop
browseBtn.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', (e) => addFiles(e.target.files));

['dragenter','dragover'].forEach(ev => dropArea.addEventListener(ev, (e)=>{
  e.preventDefault(); e.stopPropagation(); dropArea.classList.add('dragging');
}));
['dragleave','drop'].forEach(ev => dropArea.addEventListener(ev, (e)=>{
  e.preventDefault(); e.stopPropagation(); dropArea.classList.remove('dragging');
}));
dropArea.addEventListener('drop', (e)=>{
  addFiles(e.dataTransfer.files);
});

// Controls
imgQuality.addEventListener('change', e => state.imgQuality = Number(e.target.value || 0.92));
pdfPageSz.addEventListener('change', e => state.pdfPageSize = e.target.value || 'a4');
targetSel.addEventListener('change', e => state.targetFormat = e.target.value || 'auto');

convertBtn.addEventListener('click', async ()=>{
  if (!state.files.length) { alert('Agregá archivos primero'); return; }
  setProgress(0); log('Iniciando conversión...');
  const total = state.files.length;
  let done = 0;

  for (const file of state.files) {
    try {
      await convertOne(file, state.targetFormat);
      done++;
      setProgress(Math.round(100 * done/total));
    } catch (err) {
      const msg = err?.message || (err?.target && err.type) || String(err);
      console.error(err);
      log(`⚠️ Error con ${file.name}: ${msg}`);
    }
  }
  log('✅ Conversión completa');
});

async function convertOne(file, target) {
  const name = file.name; const type = file.type || '';
  let out = target;

  // Autodetección con prioridad correcta
  if (target === 'auto') {
    if      (isDocx(name,type)) out = 'pdf';
    else if (isTxt(name,type))  out = 'pdf';
    else if (isMd(name,type))   out = 'pdf';
    else if (isPdf(name,type))  out = 'png'; // PDF → imágenes (zip) por default
    else if (isImage(name,type))out = 'png'; // IMG → PNG por default
    else throw new Error('Formato no soportado.');
  }

  // --- Imagenes ---
  if (isImage(name,type)) {
    if (out === 'ico') {
      log(`IMG: ${name} → ICO`);
      return await imageToIco(file);           
    }
    if (['png','jpg','webp'].includes(out)) {
      log(`IMG: ${name} → ${out.toUpperCase()}`);
      return await convertImageToImage(file, out, state.imgQuality);
    }
    if (out === 'pdf') {
      log(`IMG: ${name} → PDF`);
      return await imagesToPdf([file], state.pdfPageSize);
    }
  }

  // --- PDFs ---
  if (isPdf(name,type)) {
    if (['png','jpg'].includes(out)) {
      log(`PDF: ${name} → ${out.toUpperCase()} (ZIP)`);
      return await pdfToImagesZip(file, out);
    }
  }

  // --- DOCX ---
  if (isDocx(name,type) && out === 'pdf') {
    log(`DOCX: ${name} → PDF (básico)`);
    return await docxToPdf(file);
  }

  // --- TXT / MD ---
  if ((isTxt(name,type) || isMd(name,type)) && out === 'pdf') {
    log(`${isMd(name,type)?'MD':'TXT'}: ${name} → PDF`);
    return await textLikeToPdf(file);
  }

  throw new Error('Combinación no soportada.');
}


/* --- Converters --- */
function readFileAsDataURL(file){
  return new Promise((res,rej)=>{
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.onerror = rej;
    fr.readAsDataURL(file);
  });
}
function readFileAsText(file){
  return new Promise((res,rej)=>{
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.onerror = rej;
    fr.readAsText(file);
  });
}

async function convertImageToImage(file, outFmt, quality=0.92){
  const dataUrl = await readFileAsDataURL(file);
  const img = await loadImage(dataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const mime = outFmt==='jpg' ? 'image/jpeg' :
               outFmt==='png' ? 'image/png' : 'image/webp';
  const outUrl = canvas.toDataURL(mime, quality);
  const blob = dataURLtoBlob(outUrl);
  downloadBlob(blob, replaceExt(file.name, `.${outFmt}`));
}
function loadImage(src){
  return new Promise((res,rej)=>{
    const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src;
  });
}
function dataURLtoBlob(dataurl){
  const arr = dataurl.split(','), mime = arr[0].match(/:(.*?);/)[1];
  const bstr = atob(arr[1]); let n = bstr.length; const u8arr = new Uint8Array(n);
  while(n--){ u8arr[n] = bstr.charCodeAt(n); }
  return new Blob([u8arr], {type:mime});
}
function replaceExt(filename, newExt){
  return filename.replace(/\.[^.]+$/,'') + newExt;
}
function downloadBlob(blob, filename){
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

async function imagesToPdf(files, pageSize='a4'){
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ unit:'pt', format: pageSize==='auto'?'a4':pageSize });

  for (let idx=0; idx<files.length; idx++){
    const f = files[idx];
    const dataUrl = await readFileAsDataURL(f);
    const img = await loadImage(dataUrl);
    let pageW = pdf.internal.pageSize.getWidth();
    let pageH = pdf.internal.pageSize.getHeight();

    if (pageSize === 'auto') {
      // dimensionar página a la imagen
      const ratio = img.naturalWidth / img.naturalHeight;
      pageW = 595; pageH = Math.round(pageW / ratio);
      if (idx===0) pdf.setPage(1); // first page exists
      pdf.internal.pageSize.width = pageW;
      pdf.internal.pageSize.height = pageH;
    } else {
      if (idx>0) pdf.addPage(pageSize);
    }

    // Escalar manteniendo proporción
    const maxW = pageW - 40, maxH = pageH - 40;
    let w = img.naturalWidth, h = img.naturalHeight;
    const scale = Math.min(maxW / w, maxH / h);
    w = w * scale; h = h * scale;
    const x = (pageW - w)/2, y = (pageH - h)/2;

    pdf.addImage(dataUrl, 'JPEG', x, y, w, h); // PDF acepta PNG/JPEG; usamos JPEG genérico
  }

  pdf.save('imagenes.pdf');
}

async function pdfToImagesZip(file, outFmt='png'){
  const zip = new JSZip();
  // Usamos la instancia global expuesta en index.html (CDN) si existe
  const pdfjsLib = globalThis.pdfjsLib || pdfjsLibGlobal;
  // ⚠ No forzamos worker local si estás usando CDN
  // Si algún día pasás a libs locales, podrías habilitar:
  // pdfjsLib.GlobalWorkerOptions.workerSrc = './libs/pdf.worker.min.mjs';

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++){
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = viewport.width; canvas.height = viewport.height;
    await page.render({ canvasContext: ctx, viewport }).promise;
    const mime = outFmt==='jpg' ? 'image/jpeg' : 'image/png';
    const dataUrl = canvas.toDataURL(mime, 0.95);
    const blob = dataURLtoBlob(dataUrl);
    zip.file(`page-${String(pageNumber).padStart(2,'0')}.${outFmt}`, blob);
    setProgress(Math.round((pageNumber/pdf.numPages)*100));
  }
  const content = await zip.generateAsync({type:'blob'});
  downloadBlob(content, replaceExt(file.name, `-${outFmt}.zip`));
}

async function docxToPdf(file){
  // 1) DOCX -> HTML (mammoth)
  const arrayBuffer = await file.arrayBuffer();
  const { value: html } = await window.mammoth.convertToHtml({arrayBuffer});

  // 2) Armamos un contenedor con estilos "print"
  const wrapper = document.createElement('div');
  wrapper.className = 'printable';
  wrapper.innerHTML = `
    <style>
      /* Fuerza look claro para PDF */
      .printable, .printable * {
        color:#111 !important;
        background:#fff !important;
      }
      .printable {
        padding:16px;
        line-height:1.5;
        font-size:12pt;
        font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji","Segoe UI Emoji";
      }
      .printable h1{ font-size:20pt; margin:0 0 10px; }
      .printable h2{ font-size:16pt; margin:16px 0 8px; }
      .printable h3{ font-size:14pt; margin:12px 0 6px; }
      .printable p{ margin:6px 0; }
      .printable ul, .printable ol{ margin:6px 0 6px 20px; }
      .printable table{ border-collapse:collapse; width:100%; }
      .printable th, .printable td{ border:1px solid #ddd; padding:6px; }
    </style>
    <div>${html}</div>
  `;

  // 3) HTML -> PDF
  await html2pdf().from(wrapper).set({
    margin: 10,
    filename: replaceExt(file.name, '.pdf'),
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2, backgroundColor: '#ffffff' }, // fondo blanco sólido
    jsPDF: { unit: 'pt', format: state.pdfPageSize==='auto'?'a4':state.pdfPageSize, orientation: 'portrait' }
  }).save();
}


async function textLikeToPdf(file){
  const text = await readFileAsText(file);

  // Si es MD, lo pasamos a HTML; si es TXT, lo envolvemos en <pre>
  let inner = `<pre style="white-space:pre-wrap;word-break:break-word">${escapeHtml(text)}</pre>`;
  if (isMd(file.name, file.type)) {
    const conv = new showdown.Converter({ tables:true, strikethrough:true, simplifiedAutoLink:true });
    inner = conv.makeHtml(text);
  }

  const wrapper = document.createElement('div');
  wrapper.className = 'printable';
  wrapper.innerHTML = `
    <style>
      .printable, .printable * { color:#111 !important; background:#fff !important; }
      .printable { padding:16px; line-height:1.5; font-size:12pt; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; }
      .printable h1{ font-size:20pt; margin:0 0 10px; }
      .printable h2{ font-size:16pt; margin:16px 0 8px; }
      .printable h3{ font-size:14pt; margin:12px 0 6px; }
      .printable pre{ font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace; }
      .printable table{ border-collapse:collapse; width:100%; }
      .printable th, .printable td{ border:1px solid #ddd; padding:6px; }
      /* cortes de página opcionales: agrega class="page-break" en MD si querés */
      .page-break { page-break-before: always; }
    </style>
    <div>${inner}</div>
  `;

  await html2pdf().from(wrapper).set({
    margin: 12,
    filename: replaceExt(file.name, '.pdf'),
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2, backgroundColor: '#ffffff' },
    jsPDF: { unit: 'pt', format: state.pdfPageSize==='auto'?'a4':state.pdfPageSize, orientation: 'portrait' }
  }).save();
}

// IMG → ICO (único tamaño, por defecto 32x32)
async function imageToIco(file, size = 32){
  const dataUrl = await readFileAsDataURL(file);
  const img = await loadImage(dataUrl);

  // Canvas cuadrado
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0,0,size,size);
  // Ajuste simple: rellenamos el canvas escalando la imagen a size x size
  ctx.drawImage(img, 0, 0, size, size);

  // Obtenemos PNG desde el canvas (ICO moderno permite PNG embebido)
  const pngDataUrl = canvas.toDataURL('image/png');
  const pngBytes = Uint8Array.from(atob(pngDataUrl.split(',')[1]), c => c.charCodeAt(0));

  // Header ICO (un solo entry con PNG)
  const header = new Uint8Array([
    0,0,              // reserved
    1,0,              // type: 1 = icon
    1,0,              // count: 1 imagen
    size===256?0:size,// width (0=256)
    size===256?0:size,// height (0=256)
    0,                // colors (0 = truecolor)
    0,                // reserved
    1,0,              // planes
    32,0,             // bit count
    ...intToBytes(pngBytes.length,4), // size of image data
    22,0,0,0          // offset (6+16 = 22)
  ]);

  const blob = new Blob([header, pngBytes], { type: 'image/x-icon' });
  downloadBlob(blob, replaceExt(file.name, '.ico'));
}

// helper para escribir enteros little-endian
function intToBytes(num, bytes){
  const arr = [];
  for (let i=0;i<bytes;i++) arr.push((num >> (8*i)) & 0xFF);
  return arr;
}


function escapeHtml(s){
  return s.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;', "'":'&#39;'}[m]));
}
