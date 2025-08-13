const BACKEND = "https://web-production-4e6c9.up.railway.app";

// Estado da aplicação
let currentEventSource = null;
let collectedLeads = [];
let targetCount = 0;
let waCount = 0;
let nonWaCount = 0;
// >>> novo: lembrar se o modo é “Somente WhatsApp”
let lastSomenteWhatsapp = false;

// Elementos DOM
const statusBtn = document.getElementById("statusBtn");
const statusIndicator = statusBtn?.querySelector(".status-indicator");
const statusText = statusBtn?.querySelector(".status-text");
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

// Inicialização
document.addEventListener("DOMContentLoaded", () => {
  if (statusBtn) checkServerStatus();
  setupEventListeners();
});

// Event listeners
function setupEventListeners() {
  if (statusBtn) statusBtn.addEventListener("click", checkServerStatus);
  if (leadsForm) leadsForm.addEventListener("submit", handleFormSubmit);
  if (cancelarBtn) cancelarBtn.addEventListener("click", cancelSearch);
  if (downloadBtn) downloadBtn.addEventListener("click", downloadCSV);
}

// Verificar status do servidor
async function checkServerStatus() {
  if (!statusText || !statusIndicator) return; // sem botão no HTML
  try {
    statusText.textContent = "Verificando...";
    statusIndicator.className = "status-indicator";

    const response = await fetch(`${BACKEND}/health`, { method: "GET" });
    if (response.ok) {
      statusText.textContent = "Online";
      statusIndicator.className = "status-indicator online";
    } else {
      throw new Error("Server responded with error");
    }
  } catch (error) {
    console.error("Status check failed:", error);
    statusText.textContent = "Offline";
    statusIndicator.className = "status-indicator offline";
  }
}

// Manipular envio do formulário
async function handleFormSubmit(event) {
  event.preventDefault();

  const formData = new FormData(leadsForm);
  const nicho = (formData.get("nicho") || "").toString().trim();
  const local = (formData.get("local") || "").toString().trim();
  const quantidade = Number.parseInt(formData.get("quantidade"));
  const somenteWhatsapp = formData.get("somenteWhatsapp") === "on";
  // >>> novo: guardar para uso nos updates
  lastSomenteWhatsapp = somenteWhatsapp;

  if (!nicho || !local || Number.isNaN(quantidade) || quantidade < 1 || quantidade > 500) {
    alert("Por favor, preencha todos os campos corretamente.");
    return;
  }

  // Reset estado
  collectedLeads = [];
  targetCount = quantidade;
  waCount = 0;
  nonWaCount = 0;

  // UI de loading
  setLoadingState(true);
  showProgressSection();
  clearResults();
  updateProgress(0, quantidade, 0, 0);

  try {
    // Tentar SSE primeiro
    const sseSuccess = await tryServerSentEvents(nicho, local, quantidade, somenteWhatsapp);

    if (!sseSuccess) {
      // Fallback para fetch normal
      await fallbackFetch(nicho, local, quantidade, somenteWhatsapp);
    }
  } catch (error) {
    console.error("Search failed:", error);
    alert("Erro ao buscar leads. Tente novamente.");
    setLoadingState(false);
  }
}

// Tentar Server-Sent Events
function tryServerSentEvents(nicho, local, quantidade, somenteWhatsapp) {
  return new Promise((resolve) => {
    try {
      const verify = somenteWhatsapp ? 1 : 0;
      const url = `${BACKEND}/leads/stream?nicho=${encodeURIComponent(nicho)}&local=${encodeURIComponent(local)}&n=${quantidade}&verify=${verify}`;
      currentEventSource = new EventSource(url);

      let hasStarted = false;
      const timeout = setTimeout(() => {
        if (!hasStarted) {
          try { currentEventSource.close(); } catch {}
          currentEventSource = null;
          resolve(false); // Fallback
        }
      }, 5000);

      currentEventSource.addEventListener("start", (event) => {
        hasStarted = true;
        clearTimeout(timeout);
        console.log("SSE started:", event.data);
      });

      currentEventSource.addEventListener("progress", (event) => {
        try {
          const data = JSON.parse(event.data);
          waCount = data.wa_count || 0;
          nonWaCount = data.non_wa_count || 0;

          // >>> alterado: se "Somente WhatsApp", a barra mostra progresso por WA
          const currentForBar = lastSomenteWhatsapp ? waCount : (data.searched || 0);
          updateProgress(currentForBar, targetCount, waCount, nonWaCount);
        } catch (error) {
          console.error("Error parsing SSE progress:", error);
        }
      });

      currentEventSource.addEventListener("item", (event) => {
        try {
          const data = JSON.parse(event.data);
          // Quando verify=1 no backend, só vem has_whatsapp = true
          if (!somenteWhatsapp || data.has_whatsapp) {
            addLeadToTable(data.phone);
            collectedLeads.push({ phone: data.phone });
          }
        } catch (error) {
          console.error("Error parsing SSE item:", error);
        }
      });

      currentEventSource.addEventListener("done", (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log("SSE completed:", data);

          // >>> ajusta barra final com base no modo
          const currentForBar = lastSomenteWhatsapp ? (data.wa_count || waCount) : (data.searched || 0);
          updateProgress(currentForBar, targetCount, data.wa_count || waCount, data.non_wa_count || nonWaCount);

          if (data.exhausted && collectedLeads.length < targetCount) {
            showExhaustedWarning();
          }

          try { currentEventSource.close(); } catch {}
          currentEventSource = null;
          setLoadingState(false);
          showDownloadButton();
          resolve(true);
        } catch (error) {
          console.error("Error parsing SSE done:", error);
          try { currentEventSource.close(); } catch {}
          currentEventSource = null;
          setLoadingState(false);
          resolve(true);
        }
      });

      currentEventSource.onerror = (error) => {
        console.error("SSE error:", error);
        try { currentEventSource.close(); } catch {}
        currentEventSource = null;
        if (!hasStarted) {
          clearTimeout(timeout);
          resolve(false); // Fallback
        } else {
          setLoadingState(false);
          resolve(true); // Partial success
        }
      };
    } catch (error) {
      console.error("SSE setup failed:", error);
      resolve(false);
    }
  });
}

// Fallback para fetch normal
async function fallbackFetch(nicho, local, quantidade, somenteWhatsapp) {
  try {
    const verify = somenteWhatsapp ? 1 : 0;
    const url = `${BACKEND}/leads?nicho=${encodeURIComponent(nicho)}&local=${encodeURIComponent(local)}&n=${quantidade}&verify=${verify}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();

    waCount = data.wa_count || 0;
    nonWaCount = data.non_wa_count || 0;

    // Simular progresso para melhor UX
    if (data.items && Array.isArray(data.items)) {
      for (let i = 0; i < data.items.length; i++) {
        const item = data.items[i];
        if (!somenteWhatsapp || item.has_whatsapp) {
          addLeadToTable(item.phone);
          collectedLeads.push({ phone: item.phone });
        }

        // >>> alterado: se “Somente WhatsApp”, a barra usa waCount; senão searched
        const currentForBar = lastSomenteWhatsapp
          ? (waCount || 0)
          : (data.searched || data.items.length);

        updateProgress(currentForBar, targetCount, waCount, nonWaCount);

        // Pequeno delay para simular streaming
        if (i < data.items.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      }
    }

    if (data.exhausted && collectedLeads.length < targetCount) {
      showExhaustedWarning();
    }

    setLoadingState(false);
    showDownloadButton();
  } catch (error) {
    console.error("Fallback fetch failed:", error);
    throw error;
  }
}

// Cancelar busca
function cancelSearch() {
  if (currentEventSource) {
    try { currentEventSource.close(); } catch {}
    currentEventSource = null;
  }

  setLoadingState(false);
  updateProgressText("Cancelado");
}

// Atualizar estado de loading
function setLoadingState(loading) {
  if (loading) {
    if (buscarBtn) {
      buscarBtn.classList.add("loading");
      buscarBtn.disabled = true;
    }
    if (cancelarBtn) cancelarBtn.style.display = "inline-flex";
    if (exhaustedWarning) exhaustedWarning.style.display = "none";
  } else {
    if (buscarBtn) {
      buscarBtn.classList.remove("loading");
      buscarBtn.disabled = false;
    }
    if (cancelarBtn) cancelarBtn.style.display = "none";
  }
}

// Mostrar seção de progresso
function showProgressSection() {
  if (progressSection) progressSection.style.display = "block";
  if (resultsSection) resultsSection.style.display = "block";
}

// Limpar resultados
function clearResults() {
  if (resultsBody) resultsBody.innerHTML = "";
  if (downloadBtn) downloadBtn.style.display = "none";
  if (exhaustedWarning) exhaustedWarning.style.display = "none";
}

// >>> alterado: se lastSomenteWhatsapp, a barra e o texto focam em WA
function updateProgress(current, total, wa, nonWa) {
  const currentValue = lastSomenteWhatsapp ? wa : current;
  const percentage = total > 0 ? Math.round((currentValue / total) * 100) : 0;

  if (progressBar) {
    progressBar.style.width = `${percentage}%`;
    progressBar.setAttribute("aria-valuenow", String(percentage));
  }

  if (lastSomenteWhatsapp) {
    updateProgressText(`WhatsApp ${wa} de ${total}`);
  } else {
    updateProgressText(`Coletados ${current} de ${total} (WA: ${wa} | Não WA: ${nonWa})`);
  }
}

// Atualizar texto do progresso
function updateProgressText(text) {
  if (progressText) progressText.textContent = text;
}

function showExhaustedWarning() {
  if (exhaustedWarning) exhaustedWarning.style.display = "flex";
}

// Adicionar lead à tabela
function addLeadToTable(phone) {
  if (!resultsBody) return;
  const row = document.createElement("tr");
  row.innerHTML = `<td>${escapeHtml(phone)}</td>`;
  resultsBody.appendChild(row);

  // Scroll para o final da tabela
  row.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

// Mostrar botão de download
function showDownloadButton() {
  if (downloadBtn && collectedLeads.length > 0) {
    downloadBtn.style.display = "inline-flex";
  }
}

function downloadCSV() {
  if (collectedLeads.length === 0) {
    alert("Nenhum lead para baixar.");
    return;
  }

  try {
    // Criar conteúdo CSV com BOM para compatibilidade com Excel
    let csvContent = "\ufeffphone\n"; // BOM + cabeçalho

    // Only export WhatsApp numbers (já filtrados quando 'Somente WhatsApp' estiver marcado)
    collectedLeads.forEach((lead) => {
      csvContent += `${lead.phone}\n`;
    });

    // Criar e baixar arquivo
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.download = `smart-leads-${new Date().toISOString().split("T")[0]}.csv`;
    link.style.display = "none";

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    URL.revokeObjectURL(url);
  } catch (error) {
    console.error("CSV download failed:", error);
    alert("Erro ao baixar CSV. Tente novamente.");
  }
}

// Utilitário para escapar HTML
function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// Utilitário para timeout em fetch (não usado, mas mantido)
function fetchWithTimeout(url, options = {}, timeout = 5000) {
  return Promise.race([
    fetch(url, options),
    new Promise((_, reject) => setTimeout(() => reject(new Error("Request timeout")), timeout)),
  ]);
}
