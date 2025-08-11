const BACKEND = "https://clickleads-backend-production.up.railway.app";

// Estado
let currentEventSource = null;
let collectedLeads = [];
let targetCount = 0;
let waCount = 0;
let nonWaCount = 0;

// DOM
const statusBtn = document.getElementById("statusBtn");
const statusIndicator = statusBtn.querySelector(".status-indicator");
const statusText = statusBtn.querySelector(".status-text");
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
  checkServerStatus();
  setupEventListeners();
});

function setupEventListeners() {
  statusBtn.addEventListener("click", checkServerStatus);
  leadsForm.addEventListener("submit", handleFormSubmit);
  cancelarBtn.addEventListener("click", cancelSearch);
  downloadBtn.addEventListener("click", downloadCSV);
}

async function checkServerStatus() {
  try {
    statusText.textContent = "Verificando...";
    statusIndicator.className = "status-indicator";
    const response = await fetch(`${BACKEND}/health`, { method: "GET" });
    if (response.ok) {
      statusText.textContent = "Online";
      statusIndicator.className = "status-indicator online";
    } else throw new Error();
  } catch {
    statusText.textContent = "Offline";
    statusIndicator.className = "status-indicator offline";
  }
}

async function handleFormSubmit(event) {
  event.preventDefault();

  const formData = new FormData(leadsForm);
  const nicho = formData.get("nicho").trim();
  const local = formData.get("local").trim();
  const quantidade = Number.parseInt(formData.get("quantidade"));
  const somenteWhatsapp = formData.get("somenteWhatsapp") === "on";

  if (!nicho || !local || quantidade < 1 || quantidade > 500) {
    alert("Por favor, preencha todos os campos corretamente.");
    return;
  }

  // reset
  collectedLeads = [];
  targetCount = quantidade;
  waCount = 0;
  nonWaCount = 0;

  setLoadingState(true);
  showProgressSection();
  clearResults();
  updateProgress(0, quantidade, 0, 0);

  try {
    const ok = await tryServerSentEvents(nicho, local, quantidade, somenteWhatsapp);
    if (!ok) await fallbackFetch(nicho, local, quantidade, somenteWhatsapp);
  } catch (err) {
    console.error(err);
    alert("Erro ao buscar leads. Tente novamente.");
    setLoadingState(false);
  }
}

function tryServerSentEvents(nicho, local, quantidade, somenteWhatsapp) {
  return new Promise((resolve) => {
    try {
      const verify = somenteWhatsapp ? 1 : 0;
      const url = `${BACKEND}/leads/stream?nicho=${encodeURIComponent(nicho)}&local=${encodeURIComponent(local)}&n=${quantidade}&verify=${verify}`;
      currentEventSource = new EventSource(url);

      let hasStarted = false;
      const startTimeout = setTimeout(() => {
        if (!hasStarted) {
          currentEventSource.close();
          resolve(false);
        }
      }, 5000);

      currentEventSource.addEventListener("start", (e) => {
        hasStarted = true;
        clearTimeout(startTimeout);
        try {
          const data = JSON.parse(e.data || "{}");
          targetCount = data.target || quantidade; // usa alvo do backend se vier
        } catch {}
        updateProgress(0, targetCount, 0, 0);
      });

      currentEventSource.addEventListener("progress", (e) => {
        try {
          const data = JSON.parse(e.data);
          waCount = data.wa_count ?? waCount;
          nonWaCount = data.non_wa_count ?? nonWaCount;
          updateProgress(data.searched ?? 0, targetCount, waCount, nonWaCount);
        } catch {}
      });

      currentEventSource.addEventListener("item", (e) => {
        try {
          const data = JSON.parse(e.data);
          // BACKEND já filtra quando verify=1 → SEM checar has_whatsapp
          if (data.phone) {
            addLeadToTable(data.phone);
            collectedLeads.push({ phone: data.phone });
          }
          // mantém contadores atualizados
          waCount = data.wa_count ?? waCount;
          nonWaCount = data.non_wa_count ?? nonWaCount;
          updateProgress(data.searched ?? 0, targetCount, waCount, nonWaCount);
          showDownloadButton();
        } catch {}
      });

      currentEventSource.addEventListener("done", (e) => {
        try {
          const data = JSON.parse(e.data || "{}");
          if (data.exhausted && collectedLeads.length < targetCount) {
            showExhaustedWarning();
          }
        } catch {}
        currentEventSource.close();
        currentEventSource = null;
        setLoadingState(false);
        showDownloadButton();
        resolve(true);
      });

      currentEventSource.onerror = () => {
        currentEventSource.close();
        currentEventSource = null;
        if (!hasStarted) resolve(false);
        else {
          setLoadingState(false);
          resolve(true);
        }
      };
    } catch {
      resolve(false);
    }
  });
}

async function fallbackFetch(nicho, local, quantidade, somenteWhatsapp) {
  const verify = somenteWhatsapp ? 1 : 0;
  const url = `${BACKEND}/leads?nicho=${encodeURIComponent(nicho)}&local=${encodeURIComponent(local)}&n=${quantidade}&verify=${verify}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();

  waCount = data.wa_count ?? waCount;
  nonWaCount = data.non_wa_count ?? nonWaCount;

  const list = Array.isArray(data.items) ? data.items : [];
  for (let i = 0; i < list.length; i++) {
    const phone = list[i].phone;
    if (phone) {
      addLeadToTable(phone);
      collectedLeads.push({ phone });
    }
    updateProgress(data.searched ?? collectedLeads.length, targetCount, waCount, nonWaCount);
    if (i < list.length - 1) await new Promise((r) => setTimeout(r, 30));
  }

  if (data.exhausted && collectedLeads.length < targetCount) showExhaustedWarning();
  setLoadingState(false);
  showDownloadButton();
}

function cancelSearch() {
  if (currentEventSource) {
    currentEventSource.close();
    currentEventSource = null;
  }
  setLoadingState(false);
  updateProgressText("Cancelado");
}

function setLoadingState(loading) {
  if (loading) {
    buscarBtn.classList.add("loading");
    buscarBtn.disabled = true;
    cancelarBtn.style.display = "inline-flex";
    exhaustedWarning.style.display = "none";
  } else {
    buscarBtn.classList.remove("loading");
    buscarBtn.disabled = false;
    cancelarBtn.style.display = "none";
  }
}

function showProgressSection() {
  progressSection.style.display = "block";
  resultsSection.style.display = "block";
}

function clearResults() {
  resultsBody.innerHTML = "";
  downloadBtn.style.display = "none";
  exhaustedWarning.style.display = "none";
}

function updateProgress(current, total, wa, nonWa) {
  const pct = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;
  progressBar.style.width = `${pct}%`;
  progressBar.setAttribute("aria-valuenow", pct);
  updateProgressText(`Coletados ${current} de ${total} (WA: ${wa} | Não WA: ${nonWa})`);
}

function updateProgressText(text) {
  progressText.textContent = text;
}

function showExhaustedWarning() {
  exhaustedWarning.style.display = "flex";
}

function addLeadToTable(phone) {
  const row = document.createElement("tr");
  row.innerHTML = `<td>${escapeHtml(phone)}</td>`;
  resultsBody.appendChild(row);
  row.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function showDownloadButton() {
  if (collectedLeads.length > 0) downloadBtn.style.display = "inline-flex";
}

function downloadCSV() {
  if (!collectedLeads.length) {
    alert("Nenhum lead para baixar.");
    return;
  }
  let csv = "\ufeffphone\n";
  collectedLeads.forEach((l) => (csv += `${l.phone}\n`));
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `smart-leads-${new Date().toISOString().split("T")[0]}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}
