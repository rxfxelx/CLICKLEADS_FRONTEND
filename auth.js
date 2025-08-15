// === Config ===
const API = (typeof window !== "undefined" && (window.BACKEND || (typeof BACKEND !== "undefined" ? BACKEND : null)))
  || "https://clickleads.up.railway.app";

const TOKEN_KEY   = "auth_token";
const DEVICE_KEY  = "device_id";
const SESSION_KEY = "session_id";

// === Helpers ===
function getToken(){ try{ return localStorage.getItem(TOKEN_KEY) || ""; }catch{ return ""; } }
function setToken(t){ try{ localStorage.setItem(TOKEN_KEY, t); }catch{} }
function clearToken(){ try{ localStorage.removeItem(TOKEN_KEY); }catch{} }

function getSessionId(){ try{ return localStorage.getItem(SESSION_KEY) || ""; }catch{ return ""; } }
function setSessionId(s){ try{ if(s) localStorage.setItem(SESSION_KEY, s); }catch{} }

function getDeviceId(){
  try{
    let id = localStorage.getItem(DEVICE_KEY);
    if(!id){
      id = "WEB-" + Math.random().toString(36).slice(2) + "-" + Date.now().toString(36);
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  }catch{ return "WEB-UNKNOWN"; }
}
function setDeviceId(v){ try{ if(v) localStorage.setItem(DEVICE_KEY, v); }catch{} }

// ===== UI (login modal) =====
function showLogin(){ const m = document.getElementById("loginModal"); if(m) m.style.display = "flex"; }
function hideLogin(){ const m = document.getElementById("loginModal"); if(m) m.style.display = "none"; }

// ===== Sessão =====
async function validateSession(){
  const tok = getToken();
  if(!tok){ showLogin(); return; }
  try{
    const r = await fetch(`${API}/auth/me`, { headers:{ Authorization:`Bearer ${tok}` }});
    if(!r.ok) throw new Error();
  }catch{
    clearToken(); setSessionId(""); showLogin();
  }
}

// ===== Login =====
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
    if(!data?.access_token) throw new Error("Resposta inválida.");

    // Backend retorna "sid" (alguns retornam "session_id"). Salvar ambos se vierem.
    setSessionId(data.sid || data.session_id || "");
    // Se backend devolver "device", use o mesmo id para casar com a sessão
    if(data.device){ setDeviceId(data.device); }

    setToken(data.access_token);
    if(msgEl) msgEl.textContent = "OK";
    hideLogin();
  }catch(err){
    if(msgEl) msgEl.textContent = String(err?.message || "Falha no login");
  }
}

// ===== Logout =====
function doLogout(){ clearToken(); setSessionId(""); showLogin(); }

// ===== QS para SSE (requer access + sid + device) =====
function buildSSEAuthQS(){
  const access = getToken();
  const sid = getSessionId();
  const dev = getDeviceId();
  if(!access || !sid || !dev) return "";
  return `access=${encodeURIComponent(access)}&sid=${encodeURIComponent(sid)}&device=${encodeURIComponent(dev)}`;
}

document.addEventListener("DOMContentLoaded", validateSession);
