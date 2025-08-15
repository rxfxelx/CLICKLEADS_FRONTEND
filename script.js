// ===== Config =====
const BACKEND = API_BASE(); // vem do auth.js

// ===== Estado da busca =====
let es = null;
let abortado = false;
let alvo = 0;
let waCount = 0;
let nonWaCount = 0;
let searched = 0;
const vistos = new Set();       // dedup
const coletados = [];           // ordem de chegada

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
function updateProgress(city=""){
  const pct = Math.max(0, Math.min(100, Math.floor((waCount/alvo)*100)));
  progressBar.style.width = pct + "%";
  progressBar.setAttribute("aria-valuenow", String(pct));
  progressText.textContent =
    `Coletados ${waCount} de ${alvo} (WA: ${waCount} | Não WA: ${nonWaCount})` +
    (city ? ` — Cidade: ${city}` : "");
  if(coletados.length > 0){
    btnDownload.style.display = "inline-block";
  }
}
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

// ===== Fallback JSON =====
async function fallbackFetch(nicho, local, n, somenteWA){
  const verify = somenteWA ? 1 : 0;
  const qAuth = buildSSEAuthQS();
  const url = `${BACKEND}/leads?nicho=${encodeURIComponent(nicho)}&local=${encodeURIComponent(local)}&n=${n}&verify=${verify}` + (qAuth ? `&${qAuth}` : "");
  const r = await fetch(url);
  if(!r.ok) throw new Error(`HTTP ${r.status}`);
  const data = await r.json();
  (data.items || data.leads || []).forEach(row => renderRow(row.phone));
  waCount = coletados.length;
  updateProgress();
  setBusy(false);
}

// ===== SSE =====
function startStream(nicho, local, n, somenteWA){
  const verify = somenteWA ? 1 : 0;
  const qAuth = buildSSEAuthQS();
  const url = `${BACKEND}/leads/stream?nicho=${encodeURIComponent(nicho)}&local=${encodeURIComponent(local)}&n=${n}&verify=${verify}` + (qAuth ? `&${qAuth}` : "");

  try{
    es = new EventSource(url, { withCredentials: false });

    es.addEventListener("start", () => { /* noop */ });

    es.addEventListener("city", (e) => {
      const d = JSON.parse(e.data||"{}");
      updateProgress(d.name || "");
    });

    es.addEventListener("item", (e) => {
      const d = JSON.parse(e.data||"{}");
      if(d.phone){
        renderRow(d.phone);
        if(d.has_whatsapp) waCount++;
        updateProgress();
        if(waCount >= alvo && es){
          es.close(); es = null; setBusy(false);
        }
      }
    });

    es.addEventListener("progress", (e) => {
      const d = JSON.parse(e.data||"{}");
      if(typeof d.wa_count === "number") waCount = d.wa_count;
      if(typeof d.non_wa_count === "number") nonWaCount = d.non_wa_count;
      if(typeof d.searched === "number") searched = d.searched;
      updateProgress(d.city || "");
    });

    es.addEventListener("done", (e) => {
      const d = JSON.parse(e.data||"{}");
      if(typeof d.wa_count === "number") waCount = d.wa_count;
      if(typeof d.non_wa_count === "number") nonWaCount = d.non_wa_count;
      if(d.exhausted) exhaustedWarning.style.display = "flex";
      updateProgress();
      if(es){ es.close(); es = null; }
      setBusy(false);
    });

    es.onerror = () => {
      if(abortado){ abortado = false; return; }
      if(es){ es.close(); es = null; }
      // fallback para JSON
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
  const local = document.getElementById("local").value.trim();
  const n = Math.max(1, Math.min(500, parseInt(document.getElementById("quantidade").value || "1", 10)));
  const somenteWA = document.getElementById("somenteWhatsapp").checked;

  alvo = n;
  resetUI();
  setBusy(true);
  startStream(nicho, local, n, somenteWA);
});

btnCancelar.addEventListener("click", () => {
  abortado = true;
  if(es){ es.close(); es = null; }
  setBusy(false);
});

btnDownload.addEventListener("click", csvDownload);

// Inicializa estado visual
resetUI();
setBusy(false);
