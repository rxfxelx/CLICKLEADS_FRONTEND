<script>
/* ===== Auth minimal (1 sessão ativa por conta) ===== */
const AUTH = { access: null, sid: null, hbTimer: null };

function getDeviceId(){
  const K = "smartleads_device_id";
  let v = localStorage.getItem(K);
  if(!v){
    v = crypto.getRandomValues(new Uint8Array(16)).join("-");
    localStorage.setItem(K, v);
  }
  return v;
}

async function authLogin(email, password){
  const r = await fetch(`${BACKEND}/auth/login`, {
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body: JSON.stringify({ email, password, device_id: getDeviceId() })
  });
  if (r.status === 423) throw new Error("Já existe um dispositivo conectado.");
  if (!r.ok) throw new Error("Login inválido.");
  const data = await r.json();
  AUTH.access = data.access_token;
  AUTH.sid = data.session_id;
  startHeartbeat();
}

function startHeartbeat(){
  stopHeartbeat();
  AUTH.hbTimer = setInterval(async ()=>{
    try{
      await fetch(`${BACKEND}/auth/heartbeat?session_id=${encodeURIComponent(AUTH.sid)}&device_id=${encodeURIComponent(getDeviceId())}`, {
        method:"POST",
        headers:{ "Authorization": `Bearer ${AUTH.access}` }
      });
    }catch(_){}
  }, 30000);
}
function stopHeartbeat(){
  if(AUTH.hbTimer){ clearInterval(AUTH.hbTimer); AUTH.hbTimer=null; }
}

async function tryRefresh(){
  const rr = await fetch(`${BACKEND}/auth/refresh?device_id=${encodeURIComponent(getDeviceId())}`, {
    method:"POST",
    credentials:"include"
  });
  if(rr.ok){
    const d = await rr.json();
    AUTH.access = d.access_token;
    AUTH.sid = d.session_id;
    startHeartbeat();
    return true;
  }
  return false;
}

async function apiFetch(url, opts={}){
  opts.headers = Object.assign({}, opts.headers, {
    "Authorization": `Bearer ${AUTH.access}`,
    "X-Device-ID": getDeviceId()
  });
  let resp = await fetch(url, opts);
  if(resp.status === 401){
    const ok = await tryRefresh();
    if (ok) {
      opts.headers.Authorization = `Bearer ${AUTH.access}`;
      resp = await fetch(url, opts);
    }
  } else if (resp.status === 423) {
    alert("Já existe um dispositivo conectado usando esta conta.");
  }
  return resp;
}

/* ===== Login UI (modal) ===== */
function showLogin(){
  const el = document.getElementById("loginModal");
  if (el) el.style.display="flex";
}
function hideLogin(){
  const el = document.getElementById("loginModal");
  if (el) el.style.display="none";
}
async function handleLoginSubmit(e){
  e.preventDefault();
  const email = document.getElementById("lg_email").value.trim();
  const senha = document.getElementById("lg_senha").value;
  const msg = document.getElementById("lg_msg");
  msg.textContent="Entrando...";
  try{
    await authLogin(email, senha);
    msg.textContent="";
    hideLogin();
  }catch(err){
    msg.textContent = err.message || "Erro de login";
  }
}

/* Expor no escopo global */
window.AUTH = AUTH;
window.apiFetch = apiFetch;
window.getDeviceId = getDeviceId;
window.showLogin = showLogin;
window.handleLoginSubmit = handleLoginSubmit;
window.tryRefresh = tryRefresh;
</script>
