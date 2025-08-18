// ===== Config =====
const BACKEND = API_BASE(); // vem do auth.js

// ===== Estado =====
let es = null;
let abortado = false;
let alvo = 0;
let waCount = 0;
let nonWaCount = 0;
let searched = 0;
let doneSeen = false;
const vistos = new Set();
const coletados = [];

// watchdog para SSE silencioso
let idleTimer = null;
const IDLE_MS = 25000;

// ===== DOM =====
const form = document.getElementById("leadsForm");
const btnBuscar = document.getElementById("buscarBtn");
const btnCancelar = document.getElementById("cancelarBtn");
const btnDownload = document.getElementById("downloadBtn");
const progressSec = document.getElementById("progressSection");
const resultsSec = document.getElementById("resultsSection");
const progressText = document.getElementById("progressText");
const progressBar = document.getElementById("progressBar");
const exhaustedWarning = document.getElementById("exhaustedWarning");
const resultsBody = document.getElementById("resultsBody");

// ===== Util =====
function onlyOneCity(t){ return (t||"").split(",")[0].trim(); }

function bumpIdle(){
  if(idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if(es){ try{ es.close(); }catch{} es = null; }
    if(window.__lastParams){
      const { nicho, local, n, somenteWA } = window.__lastParams;
      fallbackFetch(nicho, local, n, somenteWA).catch(()=>setBusy(false));
    }
  }, IDLE_MS);
}

function setBusy(b){
  if(b){
    btnBuscar.disabled = true;
    btnBuscar.querySelector(".btn-text").textContent = "Buscando...";
    btnCancelar.style.display = "inline-block";
  }else{
    btnBuscar.disabled = false;
    btnBuscar.querySelector(".btn-text").textContent = "Buscar Leads";
    btnCancelar.style.display = "none";
  }
}

function resetUI(){
  waCount = 0; nonWaCount = 0; searched = 0;
  doneSeen = false;
  vistos.clear(); coletados.length = 0;
  resultsBody.innerHTML = "";
  progressBar.style.width = "0%";
  progressBar.setAttribute("aria-valuenow","0");
  progressText.textContent = "Coletados 0 de 0 (WA: 0 | Não WA: 0)";
  exhaustedWarning.style.display = "none";
  btnDownload.style.display = "none";
  progressSec.style.display = "block";
  resultsSec.style.display = "block";
}

function renderRow(phone){
  if(vistos.has(phone)) return;
  vistos.add(phone);
  coletados.push(phone);
  const tr = document.createElement("tr");
  const td = document.createElement("td");
  td.textContent = phone;
  tr.appendChild(td);
  resultsBody.appendChild(tr);
}

function maybeShowCSV(){
  const can = coletados.length > 0 && (doneSeen || waCount >= alvo);
  btnDownload.style.display = can ? "inline-block" : "none";
}

function updateProgress(city=""){
  const pct = Math.max(0, Math.min(100, Math.floor((waCount/alvo)*100)));
  progressBar.style.width = pct + "%";
  progressBar.setAttribute("aria-valuenow", String(pct));
  progressText.textContent =
    `Coletados ${waCount} de ${alvo} (WA: ${waCount} | Não WA: ${nonWaCount})` +
    (city ? ` — Cidade: ${city}` : "");
  maybeShowCSV();
}

// ===== CSV =====
function csvDownload(){
  const header = "phone\n";
  const body = coletados.map(p => String(p).trim()).join("\n");
  const blob = new Blob([header + body], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "leads.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// ===== Fallback JSON com “plano B” =====
async function fallbackFetch(nicho, local, n, somenteWA){
  const qAuth = buildSSEAuthQS();
  const url = (verify) =>
    `${BACKEND}/leads?nicho=${encodeURIComponent(nicho)}&local=${encodeURIComponent(local)}&n=${n}&verify=${verify}` +
    (qAuth ? `&${qAuth}` : "");

  // 1ª tentativa: respeita o checkbox
  let r = await fetch(url(somenteWA ? 1 : 0));
  if(!r.ok) throw new Error(`HTTP ${r.status}`);
  let data = await r.json();
  let rows = (data.items || data.leads || []).map(x => x.phone);

  // Se “Somente WhatsApp” e veio vazio, tenta sem filtro para não ficar travado
  if(somenteWA && rows.length === 0){
    try{
      r = await fetch(url(0));
      if(r.ok){
        data = await r.json();
        rows = (data.items || data.leads || []).map(x => x.phone);
      }
    }catch{}
  }

  rows.forEach(p => renderRow(p));
  waCount = coletados.length;
  doneSeen = true;
  updateProgress(local);
  setBusy(false);
}

// ===== SSE =====
function startStream(nicho, local, n, somenteWA){
  const verify = somenteWA ? 1 : 0;
  const qAuth = buildSSEAuthQS();
  const url = `${BACKEND}/leads/stream?nicho=${encodeURIComponent(nicho)}&local=${encodeURIComponent(local)}&n=${n}&verify=${verify}` + (qAuth ? `&${qAuth}` : "");

  try{
    es = new EventSource(url, { withCredentials: false });
    bumpIdle();

    es.addEventListener("start", () => bumpIdle());

    es.addEventListener("city", (e) => {
      const d = JSON.parse(e.data||"{}");
      updateProgress(d.name || local);
      bumpIdle();
    });

    es.addEventListener("item", (e) => {
      const d = JSON.parse(e.data||"{}");
      if(d.phone){
        renderRow(d.phone);
        if(d.has_whatsapp) waCount++;
        updateProgress(local);
        bumpIdle();
        if(waCount >= alvo && es){
          doneSeen = true;
          updateProgress(local);
          es.close(); es = null; setBusy(false);
        }
      }
    });

    es.addEventListener("progress", (e) => {
      const d = JSON.parse(e.data||"{}");
      if(typeof d.wa_count === "number") waCount = d.wa_count;
      if(typeof d.non_wa_count === "number") nonWaCount = d.non_wa_count;
      if(typeof d.searched === "number") searched = d.searched;
      updateProgress(local);
      bumpIdle();
    });

    es.addEventListener("done", (e) => {
      const d = JSON.parse(e.data||"{}");
      if(typeof d.wa_count === "number") waCount = d.wa_count;
      if(typeof d.non_wa_count === "number") nonWaCount = d.non_wa_count;
      if(d.exhausted) exhaustedWarning.style.display = "flex";
      doneSeen = true;
      updateProgress(local);
      if(es){ es.close(); es = null; }
      if(idleTimer) clearTimeout(idleTimer);
      setBusy(false);
    });

    es.onerror = () => {
      if(abortado){ abortado = false; return; }
      if(es){ es.close(); es = null; }
      if(idleTimer) clearTimeout(idleTimer);
      fallbackFetch(nicho, local, n, somenteWA).catch(()=>setBusy(false));
    };
  }catch{
    fallbackFetch(nicho, local, n, somenteWA).catch(()=>setBusy(false));
  }
}

// ===== Listeners =====
form.addEventListener("submit", (ev) => {
  ev.preventDefault();
  const nicho = document.getElementById("nicho").value.trim();
  const localRaw = document.getElementById("local").value.trim();
  const local = onlyOneCity(localRaw);
  document.getElementById("local").value = local;
  const n = Math.max(1, Math.min(500, parseInt(document.getElementById("quantidade").value || "1", 10)));
  const somenteWA = document.getElementById("somenteWhatsapp").checked;

  window.__lastParams = { nicho, local, n, somenteWA };

  alvo = n;
  resetUI();
  setBusy(true);
  startStream(nicho, local, n, somenteWA);
});

btnCancelar.addEventListener("click", () => {
  abortado = true;
  if(es){ es.close(); es = null; }
  if(idleTimer) clearTimeout(idleTimer);
  setBusy(false);
});

btnDownload.addEventListener("click", csvDownload);

// Inicializa
resetUI();
setBusy(false);
