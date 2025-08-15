// === Config ===
const API = (typeof window !== "undefined" && (window.BACKEND || (typeof BACKEND !== "undefined" ? BACKEND : null)))
  || "https://clickleads.up.railway.app";

const TOKEN_KEY  = "auth_token";
const DEVICE_KEY = "device_id";
const SESSION_KEY = "session_id";

// === Helpers ===
function getToken(){ try{ return localStorage.getItem(TOKEN_KEY) || ""; }catch{ return ""; } }
function setToken(t){ try{ localStorage.setItem(TOKEN_KEY, t); }catch{} }
function clearToken(){ try{ localStorage.removeItem(TOKEN_KEY); }catch{} }
function getSessionId(){ try{ return localStorage.getItem(SESSION_KEY) || ""; }catch{ return ""; } }
function setSessionId(s){ try{ localStorage.setItem(SESSION_KEY, s); }catch{} }
function getDeviceId(){
  try{
    let id = localStorage.getItem(DEVICE_KEY);
    if(!id){ id = "WEB-" + Math.random().toString(36).slice(2) + "-" + Date.now().toString(36); localStorage.setItem(DEVICE_KEY, id); }
    return id;
  }catch{ return "WEB-UNKNOWN"; }
}

// ===== UI (login modal simples) =====
function showLogin(){
  const modal = document.getElementById("loginModal");
  if(modal) modal.style.display = "flex";
}
function hideLogin(){
  const modal = document.getElementById("loginModal");
  if(modal) modal.style.display = "none";
}

// ===== Validação rápida de sessão =====
async function validateSession(){
  const tok = getToken();
  if(!tok){ showLogin(); return; }
  try{
    const r = await fetch(`${API}/auth/me`, { headers:{ Authorization:`Bearer ${tok}` }});
    if(!r.ok) throw new Error("not ok");
    // ok
  }catch{
    clearToken();
    showLogin();
  }
}

// === Submit do login (vinculado no onsubmit do seu form) ===
async function handleLoginSubmit(e){
  e.preventDefault();
  const msgEl   = document.getElementById("lg_msg");
  const emailEl = document.getElementById("lg_email");
  const passEl  = document.getElementById("lg_senha");

  const email = (emailEl?.value || "").trim();
  const password = passEl?.value || "";
  if(!email || !password){ if(msgEl) msgEl.textContent = "Preencha e-mail e senha."; return; }

  try{
    if(msgEl) msgEl.textContent = "Entrando...";
    const res = await fetch(`${API}/auth/login`, {
      method: "POST",
      headers: { "Content-Type":"application/json" },
      body: JSON.stringify({ email, password, device_id: getDeviceId() })
    });
    const data = await res.json().catch(()=>({}));
    if(!res.ok) throw new Error(data?.detail || `Erro ${res.status}`);
    if(!data?.access_token) throw new Error("Resposta inválida do servidor.");

    if(data.session_id){ setSessionId(data.session_id); }
    setToken(data.access_token);  // <- chave auth_token garantida
    if(msgEl) msgEl.textContent = "OK";
    hideLogin();
  }catch(err){
    if(msgEl) msgEl.textContent = String(err?.message || err || "Falha no login");
  }
}

// ===== Logout =====
function doLogout(){
  clearToken();
  try{ localStorage.removeItem(SESSION_KEY); }catch{}
  hideLogin();
  showLogin();
}

// ===== QS para SSE (compatível com backend) =====
function buildSSEAuthQS(){
  const access = getToken();
  const sid = getSessionId();
  const dev = getDeviceId();
  if(!access || !sid || !dev) return "";
  return `access=${encodeURIComponent(access)}&sid=${encodeURIComponent(sid)}&device=${encodeURIComponent(dev)}`;
}

// Boot
document.addEventListener("DOMContentLoaded", validateSession);
