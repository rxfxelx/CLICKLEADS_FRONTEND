const BACKEND = window.BACKEND || "https://clickleads.up.railway.app";

// token para autori
function _getToken(){ try{ return localStorage.getItem("auth_token") || ""; }catch{ return ""; } }

// Estado
let currentEventSource = null;
let collectedLeads = [];
let targetCount = 0;
let waCount = 0;
let nonWaCount = 0;
let lastSomenteWhatsapp = false;

// DOM
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

// Init
document.addEventListener("DOMContentLoaded", () => {
  setupEventListeners();
});

function setupEventListeners() {
  if (leadsForm) leadsForm.addEventListener("submit", handleFormSubmit);
  if (cancelarBtn) cancelarBtn.addEventListener("click", cancelSearch);
  if (downloadBtn) downloadBtn.addEventListener("click", downloadCSV);
}

async function handleFormSubmit(event) {
  event.preventDefault();
  const token = _getToken();
  if (!token) { alert("Faça login para usar."); return; }

  const formData = new FormData(leadsForm);
  const nicho = (formData.get("nicho") || "").toString().trim();
  const local = (formData.get("local") || "").toString().trim();
  const quantidade = Number.parseInt(formData.get("quantidade"));
  const somenteWhatsapp = formData.get("somenteWhatsapp") === "on";
  lastSomenteWhatsapp = somenteWhatsapp;

  if (!nicho || !local || Number.isNaN(quantidade) || quantidade < 1 || quantidade > 500) {
    alert("Por favor, preencha todos os campos corretamente.");
    return;
  }

  collectedLeads = [];
  targetCount = quantidade;
  waCount = 0;
  nonWaCount = 0;
  resultsBody.innerHTML = "";
  exhaustedWarning.style.display = "none";
  updateProgress(0, targetCount, 0, 0);
  updateProgressText("Iniciando...");
  setLoadingState(true);

  try {
    const ok = await tryServerSentEvents(nicho, local, quantidade, somenteWhatsapp);
    if (!ok) {
      await fallbackFetch(nicho, local, quantidade, somenteWhatsapp);
      updateProgressText("Concluído");
      setLoadingState(false);
    }
  } catch (error) {
    console.error("Search failed:", error);
    alert("Erro ao buscar leads. Tente novamente.");
    setLoadingState(false);
  }
}

function setLoadingState(loading) {
  const buscarBtn = document.getElementById("buscarBtn");
  if (buscarBtn) {
    buscarBtn.disabled = loading;
    buscarBtn.querySelector(".btn-text").textContent = loading ? "Buscando..." : "Buscar Leads";
    buscarBtn.querySelector(".btn-spinner").style.display = loading ? "inline-block" : "none";
  }
  cancelarBtn.style.display = loading ? "inline-block" : "none";
}

function tryServerSentEvents(nicho, local, quantidade, somenteWhatsapp) {
  return new Promise((resolve) => {
    try {
      const verify = somenteWhatsapp ? 1 : 0;
      const tok = _getToken();

      // --- AUTH para SSE (backend exige access + sid + device). Fallback para ?token= se buildSSEAuthQS não existir.
      const authQS = (typeof buildSSEAuthQS==="function" ? buildSSEAuthQS() : (tok ? `token=${encodeURIComponent(tok)}` : ""));
      const url = `${BACKEND}/leads/stream?nicho=${encodeURIComponent(nicho)}&local=${encodeURIComponent(local)}&n=${quantidade}&verify=${verify}${authQS ? `&${authQS}` : ""}`;
      currentEventSource = new EventSource(url);

      let hasStarted = false;
      const timeout = setTimeout(() => {
        if (!hasStarted) {
          try { currentEventSource.close(); } catch {}
          currentEventSource = null;
          resolve(false); // usa fallback
        }
      }, 5000);

      currentEventSource.addEventListener("start", () => {
        hasStarted = true;
        clearTimeout(timeout);
      });

      currentEventSource.addEventListener("progress", (event) => {
        try {
          const data = JSON.parse(event.data);
          waCount = data.wa_count || 0;
          nonWaCount = data.non_wa_count || 0;
          const currentForBar = lastSomenteWhatsapp ? waCount : (data.searched || 0);
          updateProgress(currentForBar, targetCount, waCount, nonWaCount);
          if (searchedCountEl) searchedCountEl.textContent = String(data.searched || 0);
        } catch {}
      });

      currentEventSource.addEventListener("item", (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data && data.phone) {
            addLeadToTable(data.phone);
            const currentForBar = lastSomenteWhatsapp ? collectedLeads.length : collectedLeads.length;
            updateProgress(currentForBar, targetCount, waCount, nonWaCount);
          }
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

      currentEventSource.onerror = () => {
        try { currentEventSource.close(); } catch {}
        currentEventSource = null;
        if (!hasStarted) {
          clearTimeout(timeout);
          resolve(false);
        } else {
          setLoadingState(false);
        }
      };
    } catch { resolve(false); }
  });
}

async function fallbackFetch(nicho, local, quantidade, somenteWhatsapp) {
  try {
    const verify = somenteWhatsapp ? 1 : 0;
    const url = `${BACKEND}/leads?nicho=${encodeURIComponent(nicho)}&local=${encodeURIComponent(local)}&n=${quantidade}&verify=${verify}`;
    const headers = {};
    const tok = _getToken();
    if (tok) headers["Authorization"] = `Bearer ${tok}`;

    const response = await fetch(url, { headers });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    const data = await response.json();

    waCount = data.wa_count || 0;
    nonWaCount = data.non_wa_count || 0;
    const list = (data.leads || []).map(x => x.phone);
    for (const phone of list) addLeadToTable(phone);

    updateProgress(lastSomenteWhatsapp ? waCount : collectedLeads.length, targetCount, waCount, nonWaCount);
    if (searchedCountEl) searchedCountEl.textContent = String(data.searched || list.length || 0);
    if (data.exhausted) showExhaustedWarning();
  } catch (error) {
    console.error("Fallback fetch failed:", error);
    alert("Erro ao buscar leads via fallback.");
  }
}

function updateProgress(current, total, wa, nonWa) {
  const pct = Math.max(0, Math.min(100, total ? (current / total) * 100 : 0));
  if (progressFill) progressFill.style.width = `${pct.toFixed(1)}%`;
  if (waCountEl) waCountEl.textContent = String(wa);
  if (nonWaCountEl) nonWaCountEl.textContent = String(nonWa);
  updateProgressText(`${Math.round(pct)}%`);
}
function updateProgressText(text) { if (progressText) progressText.textContent = text; }
function showExhaustedWarning() { if (exhaustedWarning) exhaustedWarning.style.display = "block"; }

function addLeadToTable(phone) {
  if (!resultsBody) return;
  const tr = document.createElement("tr");
  const td = document.createElement("td");
  td.textContent = phone;
  tr.appendChild(td);
  resultsBody.appendChild(tr);
  collectedLeads.push({ phone });
}

function cancelSearch() {
  if (currentEventSource) {
    try { currentEventSource.close(); } catch {}
    currentEventSource = null;
  }
  setLoadingState(false);
  updateProgressText("Cancelado");
}

function downloadCSV() {
  if (collectedLeads.length === 0) {
    alert("Nenhum lead para baixar.");
    return;
  }
  let csvContent = "\ufeffphone\n";
  collectedLeads.forEach((lead) => { csvContent += `${lead.phone}\n`; });
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `smart-leads-${new Date().toISOString().split("T")[0]}.csv`;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
