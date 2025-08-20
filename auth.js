// === Storage keys ===
const TOKEN_KEY   = "auth_token";
const DEVICE_KEY  = "device_id";
const SESSION_KEY = "session_id";

// === API base ===
function API_BASE () {
  return (typeof window !== "undefined" && window.BACKEND)
    ? window.BACKEND
    : "https://web-production-e49bb.up.railway.app";
}

// === Helpers de storage ===
function getToken(){ try{ return localStorage.getItem(TOKEN_KEY) || ""; }catch{ return ""; } }
function setToken(t){ try{ if(t) localStorage.setItem(TOKEN_KEY, t); }catch{} }
function clearToken(){ try{ localStorage.removeItem(TOKEN_KEY); }catch{} }

function getSessionId(){ try{ return localStorage.getItem(SESSION_KEY) || ""; }catch{ return ""; } }
function setSessionId(s){ try{ if(s) localStorage.setItem(SESSION_KEY, s); }catch{} }
function clearSessionId(){ try{ localStorage.removeItem(SESSION_KEY); }catch{} }

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
function validateSession(){ getToken() ? hideLogin() : showLogin(); }

// === Login ===
async function handleLoginSubmit(e){
  e.preventDefault();
  const msgEl   = document.getElementById("lg_msg");
  const emailEl = document.getElementById("lg_email");
  const passEl  = document.getElementById("lg_senha");

  const email = (emailEl?.value || "").trim();
  const password = passEl?.value || "";

  if(!email || !password){
    if(msgEl) msgEl.textContent = "Preencha e-mail e senha.";
    return;
  }

  try{
    if(msgEl) msgEl.textContent = "Entrando...";
    const res = await fetch(`${API_BASE()}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ email, password, device_id: getDeviceId() })
    });

    let data = {};
    try { data = await res.json(); } catch { /* pode não vir JSON */ }

    if(!res.ok){
      const serverMsg = data?.detail || data?.message || `${res.status} ${res.statusText}`;
      throw new Error(serverMsg);
    }

    const token = data.access_token || data.token || data.access;
    const sid   = data.sid || data.session_id || data.session || data.id;
    const dev   = data.device || null;

    if(!token) throw new Error("Resposta sem token.");

    setToken(token);
    if(sid) setSessionId(sid);
    if(dev) setDeviceId(dev);

    if(msgEl) msgEl.textContent = "OK";
    hideLogin();
  }catch(err){
    if(msgEl) msgEl.textContent = String(err?.message || "Falha no login");
  }
}

// === Logout ===
function doLogout(){
  clearToken();
  clearSessionId();     // <- limpando corretamente o session_id
  showLogin();
}

// === QS para SSE ===
function buildSSEAuthQS({withQuestionMark=false} = {}){
  const access = getToken();
  const sid = getSessionId() || "shared";
  const dev = getDeviceId() || "shared";
  if(!access) return "";

  const pairs = [
    ["access", access],
    ["token", access],
    ["authorization", access],
    ["sid", sid],
    ["session_id", sid],
    ["device", dev],
    ["device_id", dev],
  ].filter(([,v]) => v && String(v).length > 0);

  const qs = pairs.map(([k,v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
  return withQuestionMark ? `?${qs}` : qs;
}

// === Bind automático, se existir um form com id="loginForm" ===
document.addEventListener("DOMContentLoaded", () => {
  validateSession();
  const form = document.getElementById("loginForm");
  if(form) form.addEventListener("submit", handleLoginSubmit);
});

// Expor no window (útil para onsubmit/doLogout no HTML)
if (typeof window !== "undefined") {
  window.API_BASE = API_BASE;
  window.handleLoginSubmit = handleLoginSubmit;
  window.doLogout = doLogout;
  window.buildSSEAuthQS = buildSSEAuthQS;
}
