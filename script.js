const BACKEND = window.BACKEND || "https://clickleads.up.railway.app";

function _getToken(){ try{ return localStorage.getItem("auth_token") || ""; }catch{ return ""; } }

let currentEventSource = null;
let collectedLeads = [];
let targetCount = 0;
let waCount = 0;
let nonWaCount = 0;
let lastSomenteWhatsapp = false;

const leadsForm = document.getElementById("leadsForm");
const cancelarBtn = document.getElementById("cancelarBtn");
const downloadBtn = document.getElementById("downloadBtn");
const resultsBody = document.getElementById("resultsBody");
const waCountEl = document.getElementById("waCount");
const nonWaCountEl = document.getElementById("nonWaCount");
const searchedCountEl = document.getElementById("searchedCount");
const progressFill = document.getElementById("progressFill");
const progressText = document.getElementById("progressText");
const exhaustedWarning = document.getElementById("exhaustedWarning");

document.addEventListener("DOMContentLoaded", () => {
  if (leadsForm) leadsForm.addEventListener("submit", handleFormSubmit);
  if (cancelarBtn) cancelarBtn.addEventListener("click", cancelSearch);
  if (downloadBtn) downloadBtn.addEventListener("click", downloadCSV);
});

async function handleFormSubmit(event) {
  event.preventDefault();
  if (!_getToken()) { alert("Faça login antes de buscar."); return; }

  const fd = new FormData(leadsForm);
  const nicho = (fd.get("nicho") || "").toString().trim();
  const local = (fd.get("local") || "").toString().trim();
  const quantidade = Number.parseInt(fd.get("quantidade"));
  const somenteWhatsapp = fd.get("somenteWhatsapp") === "on";
  lastSomenteWhatsapp = somenteWhatsapp;

  if (!nicho || !local || Number.isNaN(quantidade) || quantidade < 1 || quantidade > 500) {
    alert("Preencha os campos corretamente.");
    return;
  }

  collectedLeads = [];
  targetCount = quantidade;
  waCount = 0; nonWaCount = 0;
  resultsBody.innerHTML = "";
  exhaustedWarning.style.display = "none";
  updateProgress(0, targetCount, 0, 0);
  updateProgressText("Iniciando...");
  setLoadingState(true);

  const ok = await tryServerSentEvents(nicho, local, quantidade, somenteWhatsapp);
  if (!ok) {
    try {
      await fallbackFetch(nicho, local, quantidade, somenteWhatsapp);
      updateProgressText("Concluído");
    } catch {
      alert("Erro ao buscar leads.");
    } finally {
      setLoadingState(false);
    }
  }
}

function setLoadingState(loading) {
  const btn = document.getElementById("buscarBtn");
  if (btn) {
    btn.disabled = loading;
    btn.querySelector(".btn-text").textContent = loading ? "Buscando..." : "Buscar Leads";
    btn.querySelector(".btn-spinner").style.display = loading ? "inline-block" : "none";
  }
  cancelarBtn.style.display = loading ? "inline-block" : "none";
}

function tryServerSentEvents(nicho, local, quantidade, somenteWhatsapp) {
  return new Promise((resolve) => {
    try {
      const verify = somenteWhatsapp ? 1 : 0;

      const authQS = (typeof buildSSEAuthQS === "function") ? buildSSEAuthQS() : "";
      const url = `${BACKEND}/leads/stream?nicho=${encodeURIComponent(nicho)}&local=${encodeURIComponent(local)}&n=${quantidade}&verify=${verify}${authQS ? `&${authQS}` : ""}`;

      currentEventSource = new EventSource(url);

      let started = false;
      const timeout = setTimeout(() => {
        if (!started) { try { currentEventSource.close(); } catch {}; currentEventSource = null; resolve(false); }
      }, 5000);

      currentEventSource.addEventListener("start", () => { started = true; clearTimeout(timeout); });

      currentEventSource.addEventListener("progress", (event) => {
        try {
          const data = JSON.parse(event.data);
          waCount = data.wa_count || 0;
          nonWaCount = data.non_wa_count || 0;
          const cur = lastSomenteWhatsapp ? waCount : (data.searched || 0);
          updateProgress(cur, targetCount, waCount, nonWaCount);
          if (searchedCountEl) searchedCountEl.textContent = String(data.searched || 0);
        } catch {}
      });

      currentEventSource.addEventListener("item", (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data && data.phone) { addLeadToTable(data.phone); updateProgress(collectedLeads.length, targetCount, waCount, nonWaCount); }
        } catch {}
      });

      currentEventSource.addEventListener("done", (event) => {
        try {
          const data = JSON.parse(event.data);
          waCount = data.wa_count || waCount;
          nonWaCount = data.non_wa_count || nonWaCount;
          updateProgress(lastSomenteWhatsapp ? waCount : collectedLeads.length, targetCount, waCount, nonWaCount);
          if (searchedCountEl) searchedCountEl.textContent = String(data.searched || 0);
          if (data.exhausted) showExhaustedWarning();
        } catch {}
        try { currentEventSource.close(); } catch {}
        currentEventSource = null;
        setLoadingState(false);
        resolve(true);
      });

      currentEventSource.onerror = () => { try { currentEventSource.close(); } catch {}; currentEventSource = null; resolve(false); };
    } catch { resolve(false); }
  });
}

async function fallbackFetch(nicho, local, quantidade, somenteWhatsapp) {
  const verify = somenteWhatsapp ? 1 : 0;
  const url = `${BACKEND}/leads?nicho=${encodeURIComponent(nicho)}&local=${encodeURIComponent(local)}&n=${quantidade}&verify=${verify}`;
  const tok = _getToken();
  const headers = tok ? { "Authorization": `Bearer ${tok}` } : {};
  const r = await fetch(url, { headers });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const data = await r.json();

  waCount = data.wa_count || 0;
  nonWaCount = data.non_wa_count || 0;
  const list = (data.leads || []).map(x => x.phone);
  for (const p of list) addLeadToTable(p);

  updateProgress(lastSomenteWhatsapp ? waCount : collectedLeads.length, targetCount, waCount, nonWaCount);
  if (searchedCountEl) searchedCountEl.textContent = String(data.searched || list.length || 0);
  if (data.exhausted) showExhaustedWarning();
}

function updateProgress(current, total, wa, nonWa) {
  const pct = Math.max(0, Math.min(100, total ? (current / total) * 100 : 0));
  if (progressFill) progressFill.style.width = `${pct.toFixed(1)}%`;
  if (waCountEl) waCountEl.textContent = String(wa);
  if (nonWaCountEl) nonWaCountEl.textContent = String(nonWa);
  updateProgressText(`${Math.round(pct)}%`);
}
function updateProgressText(t){ if (progressText) progressText.textContent = t; }
function showExhaustedWarning(){ if (exhaustedWarning) exhaustedWarning.style.display = "block"; }

function addLeadToTable(phone){
  if (!resultsBody) return;
  const tr = document.createElement("tr");
  const td = document.createElement("td");
  td.textContent = phone;
  tr.appendChild(td);
  resultsBody.appendChild(tr);
  collectedLeads.push({ phone });
}

function cancelSearch(){
  if (currentEventSource){ try { currentEventSource.close(); } catch {} currentEventSource = null; }
  setLoadingState(false);
  updateProgressText("Cancelado");
}

function downloadCSV(){
  if (collectedLeads.length === 0){ alert("Nenhum lead para baixar."); return; }
  let csv = "\ufeffphone\n";
  for (const l of collectedLeads) csv += `${l.phone}\n`;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `smart-leads-${new Date().toISOString().split("T")[0]}.csv`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
