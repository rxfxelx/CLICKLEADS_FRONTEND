// === Storage keys ===
const TOKEN_KEY   = "auth_token";
const DEVICE_KEY  = "device_id";
const SESSION_KEY = "session_id";

// Lê sempre o BACKEND atual na hora da chamada
function API_BASE(){
  return (typeof window !== "undefined" && (window.BACKEND || (typeof BACKEND !== "undefined" ? BACKEND : ""))) ||
         "https://seu-backend.aqui"; // opcional: troque pela sua URL
}

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

// === UI modal ===
function showLogin(){ const m = document.getElementById("loginModal"); if(m) m.style.display = "flex"; }
function hideLogin(){ const m = document.getElementById("loginModal"); if(m) m.style.display = "none"; }

// === Sessão ===
async function validateSession(){
  const tok = getToken();
  if(!tok){ showLogin(); return; }
  try{
    const r = await fetch(`${API_BASE()}/auth/me`, { headers:{ Authorization:`Bearer ${tok}` }});
    if(!r.ok) throw new Error();
  }catch{
    clearToken(); setSessionId(""); showLogin();
  }
}

// === Login ===
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
    const res = await fetch(`${API_BASE()}/auth/login`, {
      method: "POST",
      headers: { "Content-Type":"application/json" },
      body: JSON.stringify({ email, password, device_id: getDeviceId() })
    });
    const data = await res.json().catch(()=>({}));
    if(!res.ok) throw new Error(data?.detail || `Erro ${res.status}`);
    if(!data?.access_token) throw new Error("Resposta inválida.");

    setSessionId(data.sid || data.session_id || "");
    if(data.device){ setDeviceId(data.device); }
    setToken(data.access_token);

    if(msgEl) msgEl.textContent = "OK";
    hideLogin();
  }catch(err){
    if(msgEl) msgEl.textContent = String(err?.message || "Falha no login");
  }
}

// === Logout ===
function doLogout(){
  clearToken();
  setSessionId("");
  try{ localStorage.removeItem(DEVICE_KEY); }catch{}
  showLogin();
}

function buildSSEAuthQS(){
  const access = getToken();
  const sid = getSessionId();
  const dev = getDeviceId();
  if(!access || !sid || !dev) return "";
  return `access=${encodeURIComponent(access)}&sid=${encodeURIComponent(sid)}&device=${encodeURIComponent(dev)}`;
}

document.addEventListener("DOMContentLoaded", validateSession);
