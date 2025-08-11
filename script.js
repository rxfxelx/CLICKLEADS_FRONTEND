const BACKEND = "https://clickleads-backend-production.up.railway.app";

// Estado da aplicação
let currentEventSource = null
let collectedLeads = []
let targetCount = 0
let waCount = 0
let nonWaCount = 0

// Elementos DOM
const statusBtn = document.getElementById("statusBtn")
const statusIndicator = statusBtn.querySelector(".status-indicator")
const statusText = statusBtn.querySelector(".status-text")
const leadsForm = document.getElementById("leadsForm")
const buscarBtn = document.getElementById("buscarBtn")
const cancelarBtn = document.getElementById("cancelarBtn")
const progressSection = document.getElementById("progressSection")
const progressText = document.getElementById("progressText")
const progressBar = document.getElementById("progressBar")
const resultsSection = document.getElementById("resultsSection")
const resultsBody = document.getElementById("resultsBody")
const downloadBtn = document.getElementById("downloadBtn")
const exhaustedWarning = document.getElementById("exhaustedWarning")

// Inicialização
document.addEventListener("DOMContentLoaded", () => {
  checkServerStatus()
  setupEventListeners()
})

// Event listeners
function setupEventListeners() {
  statusBtn.addEventListener("click", checkServerStatus)
  leadsForm.addEventListener("submit", handleFormSubmit)
  cancelarBtn.addEventListener("click", cancelSearch)
  downloadBtn.addEventListener("click", downloadCSV)
}

// Verificar status do servidor
async function checkServerStatus() {
  try {
    statusText.textContent = "Verificando..."
    statusIndicator.className = "status-indicator"

    const response = await fetch(`${BACKEND}/health`, {
      method: "GET",
      timeout: 5000,
    })

    if (response.ok) {
      statusText.textContent = "Online"
      statusIndicator.className = "status-indicator online"
    } else {
      throw new Error("Server responded with error")
    }
  } catch (error) {
    console.error("Status check failed:", error)
    statusText.textContent = "Offline"
    statusIndicator.className = "status-indicator offline"
  }
}

// Manipular envio do formulário
async function handleFormSubmit(event) {
  event.preventDefault()

  const formData = new FormData(leadsForm)
  const nicho = formData.get("nicho").trim()
  const local = formData.get("local").trim()
  const quantidade = Number.parseInt(formData.get("quantidade"))
  const somenteWhatsapp = formData.get("somenteWhatsapp") === "on"

  if (!nicho || !local || quantidade < 1 || quantidade > 500) {
    alert("Por favor, preencha todos os campos corretamente.")
    return
  }

  // Reset estado
  collectedLeads = []
  targetCount = quantidade
  waCount = 0
  nonWaCount = 0

  // UI de loading
  setLoadingState(true)
  showProgressSection()
  clearResults()
  updateProgress(0, quantidade, 0, 0)

  try {
    // Tentar SSE primeiro
    const sseSuccess = await tryServerSentEvents(nicho, local, quantidade, somenteWhatsapp)

    if (!sseSuccess) {
      // Fallback para fetch normal
      await fallbackFetch(nicho, local, quantidade, somenteWhatsapp)
    }
  } catch (error) {
    console.error("Search failed:", error)
    alert("Erro ao buscar leads. Tente novamente.")
    setLoadingState(false)
  }
}

// Tentar Server-Sent Events
function tryServerSentEvents(nicho, local, quantidade, somenteWhatsapp) {
  return new Promise((resolve) => {
    try {
      const verify = somenteWhatsapp ? 1 : 0
      const url = `${BACKEND}/leads/stream?nicho=${encodeURIComponent(nicho)}&local=${encodeURIComponent(local)}&n=${quantidade}&verify=${verify}`
      currentEventSource = new EventSource(url)

      let hasStarted = false
      const timeout = setTimeout(() => {
        if (!hasStarted) {
          currentEventSource.close()
          resolve(false) // Fallback
        }
      }, 5000)

      currentEventSource.addEventListener("start", (event) => {
        hasStarted = true
        clearTimeout(timeout)
        console.log("SSE started:", event.data)
      })

      currentEventSource.addEventListener("progress", (event) => {
        try {
          const data = JSON.parse(event.data)
          waCount = data.wa_count || 0
          nonWaCount = data.non_wa_count || 0
          updateProgress(data.searched || 0, targetCount, waCount, nonWaCount)
        } catch (error) {
          console.error("Error parsing SSE progress:", error)
        }
      })

      currentEventSource.addEventListener("item", (event) => {
        try {
          const data = JSON.parse(event.data)
          if (!somenteWhatsapp || data.has_whatsapp) {
            addLeadToTable(data.phone)
            collectedLeads.push({ phone: data.phone })
          }
        } catch (error) {
          console.error("Error parsing SSE item:", error)
        }
      })

      currentEventSource.addEventListener("done", (event) => {
        try {
          const data = JSON.parse(event.data)
          console.log("SSE completed:", event.data)

          if (data.exhausted && collectedLeads.length < targetCount) {
            showExhaustedWarning()
          }

          currentEventSource.close()
          currentEventSource = null
          setLoadingState(false)
          showDownloadButton()
          resolve(true)
        } catch (error) {
          console.error("Error parsing SSE done:", error)
          currentEventSource.close()
          currentEventSource = null
          setLoadingState(false)
          resolve(true)
        }
      })

      currentEventSource.onerror = (error) => {
        console.error("SSE error:", error)
        currentEventSource.close()
        currentEventSource = null
        if (!hasStarted) {
          clearTimeout(timeout)
          resolve(false) // Fallback
        } else {
          setLoadingState(false)
          resolve(true) // Partial success
        }
      }
    } catch (error) {
      console.error("SSE setup failed:", error)
      resolve(false)
    }
  })
}

// Fallback para fetch normal
async function fallbackFetch(nicho, local, quantidade, somenteWhatsapp) {
  try {
    const verify = somenteWhatsapp ? 1 : 0
    const url = `${BACKEND}/leads?nicho=${encodeURIComponent(nicho)}&local=${encodeURIComponent(local)}&n=${quantidade}&verify=${verify}`
    const response = await fetch(url)

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    const data = await response.json()

    waCount = data.wa_count || 0
    nonWaCount = data.non_wa_count || 0

    // Simular progresso para melhor UX
    if (data.items && Array.isArray(data.items)) {
      for (let i = 0; i < data.items.length; i++) {
        const item = data.items[i]
        if (!somenteWhatsapp || item.has_whatsapp) {
          addLeadToTable(item.phone)
          collectedLeads.push({ phone: item.phone })
        }
        updateProgress(data.searched || data.items.length, targetCount, waCount, nonWaCount)

        // Pequeno delay para simular streaming
        if (i < data.items.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 50))
        }
      }
    }

    if (data.exhausted && collectedLeads.length < targetCount) {
      showExhaustedWarning()
    }

    setLoadingState(false)
    showDownloadButton()
  } catch (error) {
    console.error("Fallback fetch failed:", error)
    throw error
  }
}

// Cancelar busca
function cancelSearch() {
  if (currentEventSource) {
    currentEventSource.close()
    currentEventSource = null
  }

  setLoadingState(false)
  updateProgressText("Cancelado")
}

// Atualizar estado de loading
function setLoadingState(loading) {
  if (loading) {
    buscarBtn.classList.add("loading")
    buscarBtn.disabled = true
    cancelarBtn.style.display = "inline-flex"
    exhaustedWarning.style.display = "none"
  } else {
    buscarBtn.classList.remove("loading")
    buscarBtn.disabled = false
    cancelarBtn.style.display = "none"
  }
}

// Mostrar seção de progresso
function showProgressSection() {
  progressSection.style.display = "block"
  resultsSection.style.display = "block"
}

// Limpar resultados
function clearResults() {
  resultsBody.innerHTML = ""
  downloadBtn.style.display = "none"
  exhaustedWarning.style.display = "none"
}

function updateProgress(current, total, wa, nonWa) {
  const percentage = total > 0 ? Math.round((current / total) * 100) : 0
  progressBar.style.width = `${percentage}%`
  progressBar.setAttribute("aria-valuenow", percentage)
  updateProgressText(`Coletados ${current} de ${total} (WA: ${wa} | Não WA: ${nonWa})`)
}

// Atualizar texto do progresso
function updateProgressText(text) {
  progressText.textContent = text
}

function showExhaustedWarning() {
  exhaustedWarning.style.display = "flex"
}

// Adicionar lead à tabela
function addLeadToTable(phone) {
  const row = document.createElement("tr")
  row.innerHTML = `<td>${escapeHtml(phone)}</td>`
  resultsBody.appendChild(row)

  // Scroll para o final da tabela
  row.scrollIntoView({ behavior: "smooth", block: "nearest" })
}

// Mostrar botão de download
function showDownloadButton() {
  if (collectedLeads.length > 0) {
    downloadBtn.style.display = "inline-flex"
  }
}

function downloadCSV() {
  if (collectedLeads.length === 0) {
    alert("Nenhum lead para baixar.")
    return
  }

  try {
    // Criar conteúdo CSV com BOM para compatibilidade com Excel
    let csvContent = "\ufeffphone\n" // BOM + cabeçalho

    // Only export WhatsApp numbers (which are already filtered in collectedLeads)
    collectedLeads.forEach((lead) => {
      csvContent += `${lead.phone}\n`
    })

    // Criar e baixar arquivo
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)

    const link = document.createElement("a")
    link.href = url
    link.download = `smart-leads-${new Date().toISOString().split("T")[0]}.csv`
    link.style.display = "none"

    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)

    // Limpar URL do objeto
    URL.revokeObjectURL(url)
  } catch (error) {
    console.error("CSV download failed:", error)
    alert("Erro ao baixar CSV. Tente novamente.")
  }
}

// Utilitário para escapar HTML
function escapeHtml(text) {
  const div = document.createElement("div")
  div.textContent = text
  return div.innerHTML
}

// Utilitário para timeout em fetch
function fetchWithTimeout(url, options = {}, timeout = 5000) {
  return Promise.race([
    fetch(url, options),
    new Promise((_, reject) => setTimeout(() => reject(new Error("Request timeout")), timeout)),
  ])
}
