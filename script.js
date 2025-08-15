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
const buscarBtn = document.getElementById("buscarBtn");
const cancelarBtn = document.getElementById("cancelarBtn");
const progressSection = document.getElementById("progressSection");
const progressText = document.getElementById("progressText");
const progressBar = document.getElementById("progressBar");
const resultsSection = document.getElementById("resultsSection");
const resultsBody = document.getElementById("resultsBody");
const downloadBtn = document.getElementById("downloadBtn");
const exhaustedWarning = document.getElementById("exhaustedWarning");

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

  setLoadingState(true);
  showProgressSection();
  clearResults();
  updateProgress(0, quantidade, 0, 0);

  try {
    const sseSuccess = await tryServerSentEvents(nicho, local, quantidade, somenteWhatsapp);
    if (!sseSuccess) await fallbackFetch(nicho, local, quantidade, somenteWhatsapp);
  } catch (error) {
    console.error("Search failed:", error);
    alert("Erro ao buscar leads. Tente novamente.");
    setLoadingState(false);
  }
}

function tryServerSentEvents(nicho, local, quantidade, somenteWhatsapp) {
  return new Promise((resolve) => {
    try {
      const verify = somenteWhatsapp ? 1 : 0;
      const tok = _getToken();
      // token via query param para SSE
      const url = `${BACKEND}/leads/stream?nicho=${encodeURIComponent(nicho)}&local=${encodeURIComponent(local)}&n=${quantidade}&verify=${verify}${tok ? `&token=${encodeURIComponent(tok)}` : ""}`;
      currentEventSource = new EventSource(url);

      let hasStarted = false;
      const timeout = setTimeout(() => {
        if (!hasStarted) {
          try { currentEventSource.close(); } catch {}
          currentEventSource = null;
          resolve(false);
        }
      }, 5000);

      currentEventSource.addEventListener("start", () => {
        hasStarted = true; clearTimeout(timeout);
      });

      currentEventSource.addEventListener("progress", (event) => {
        try {
          const data = JSON.parse(event.data);
          waCount = data.wa_count || 0;
          nonWaCount = data.non_wa_count || 0;
          const currentForBar = lastSomenteWhatsapp ? waCount : (data.searched || 0);
          updateProgress(currentForBar, targetCount, waCount, nonWaCount);
        } catch {}
      });

      currentEventSource.addEventListener("item", (event) => {
        try {
          const data = JSON.parse(event.data);
          if (!lastSomenteWhatsapp || data.has_whatsapp) {
            addLeadToTable(data.phone);
            collectedLeads.push({ phone: data.phone });
          }
        } catch {}
      });

      currentEventSource.addEventListener("done", (event) => {
        try {
          const data = JSON.parse(event.data);
          const currentForBar = lastSomenteWhatsapp ? (data.wa_count || waCount) : (data.searched || 0);
          updateProgress(currentForBar, targetCount, data.wa_count || waCount, data.non_wa_count || nonWaCount);
          if (data.exhausted && collectedLeads.length < targetCount) showExhaustedWarning();
          try { currentEventSource.close(); } catch {}
          currentEventSource = null;
          setLoadingState(false);
          showDownloadButton();
          resolve(true);
        } catch {
          try { currentEventSource.close(); } catch {}
          currentEventSource = null;
          setLoadingState(false);
          resolve(true);
        }
      });

      currentEventSource.onerror = () => {
        try { currentEventSource.close(); } catch {}
        currentEventSource = null;
        if (!hasStarted) { clearTimeout(timeout); resolve(false); }
        else { setLoadingState(false); resolve(true); }
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

    if (data.items && Array.isArray(data.items)) {
      for (let i = 0; i < data.items.length; i++) {
        const item = data.items[i];
        if (!somenteWhatsapp || item.has_whatsapp) {
          addLeadToTable(item.phone);
          collectedLeads.push({ phone: item.phone });
        }
        const currentForBar = lastSomenteWhatsapp ? (waCount || 0) : (data.searched || data.items.length);
        updateProgress(currentForBar, targetCount, waCount, nonWaCount);
        if (i < data.items.length - 1) await new Promise((r) => setTimeout(r, 50));
      }
    }

    if (data.exhausted && collectedLeads.length < targetCount) showExhaustedWarning();
    setLoadingState(false);
    showDownloadButton();
  } catch (error) {
    console.error("Fallback fetch failed:", error);
    throw error;
  }
}

function cancelSearch() {
  if (currentEventSource) { try { currentEventSource.close(); } catch {} currentEventSource = null; }
  setLoadingState(false);
  updateProgressText("Cancelado");
}

function setLoadingState(loading) {
  if (loading) {
    if (buscarBtn) { buscarBtn.classList.add("loading"); buscarBtn.disabled = true; }
    if (cancelarBtn) cancelarBtn.style.display = "inline-flex";
    if (exhaustedWarning) exhaustedWarning.style.display = "none";
  } else {
    if (buscarBtn) { buscarBtn.classList.remove("loading"); buscarBtn.disabled = false; }
    if (cancelarBtn) cancelarBtn.style.display = "none";
  }
}

function showProgressSection(){ if (progressSection) progressSection.style.display="block"; if (resultsSection) resultsSection.style.display="block"; }
function clearResults(){ if (resultsBody) resultsBody.innerHTML=""; if (downloadBtn) downloadBtn.style.display="none"; if (exhaustedWarning) exhaustedWarning.style.display="none"; }

function updateProgress(current,total,wa,nonWa){
  const currentValue = lastSomenteWhatsapp ? wa : current;
  const percentage = total > 0 ? Math.round((currentValue / total) * 100) : 0;
  if (progressBar) { progressBar.style.width = `${percentage}%`; progressBar.setAttribute("aria-valuenow", String(percentage)); }
  if (lastSomenteWhatsapp) updateProgressText(`WhatsApp ${wa} de ${total}`);
  else updateProgressText(`Coletados ${current} de ${total} (WA: ${wa} | Não WA: ${nonWa})`);
}

function updateProgressText(text){ if (progressText) progressText.textContent = text; }
function showExhaustedWarning(){ if (exhaustedWarning) exhaustedWarning.style.display="flex"; }

function addLeadToTable(phone) {
  if (!resultsBody) return;
  const row = document.createElement("tr");
  row.innerHTML = `<td>${escapeHtml(phone)}</td>`;
  resultsBody.appendChild(row);
  row.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function showDownloadButton(){ if (downloadBtn && collectedLeads.length > 0) downloadBtn.style.display = "inline-flex"; }

function downloadCSV() {
  if (collectedLeads.length === 0) { alert("Nenhum lead para baixar."); return; }
  try{
    let csvContent = "\ufeffphone\n";
    collectedLeads.forEach((l)=>{ csvContent += `${l.phone}\n`; });
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = `smart-leads-${new Date().toISOString().split("T")[0]}.csv`; link.style.display = "none";
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }catch{ alert("Erro ao baixar CSV. Tente novamente."); }
}

function escapeHtml(text){ const div = document.createElement("div"); div.textContent = text; return div.innerHTML; }
