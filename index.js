// == index.js ==
// NeuroMIND – Bot WhatsApp + Mini-Inbox + Pausa automática al responder manualmente

import 'dotenv/config';
import express from 'express';
import axios from 'axios';
import OpenAI from 'openai';

// ===== ENV =====
const PORT = process.env.PORT || 10000;

const VERIFY_TOKEN   = process.env.VERIFY_TOKEN   || 'neuromind_verify';
const WA_TOKEN       = process.env.WHATSAPP_TOKEN || '';
const PHONE_ID       = process.env.PHONE_NUMBER_ID || '';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const CALENDLY_URL   = process.env.CALENDLY_URL   || 'https://calendly.com/erick-damian-ceo-de-neuromind-ia/junta-ceo-de-neuromind';

// Control operador (mini-inbox)
const BOT_MODE = process.env.BOT_MODE || 'auto'; // 'auto' | 'manual' | 'off'
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const TAKEOVER_MIN = parseInt(process.env.TAKEOVER_MINUTES || '90', 10);

if (!WA_TOKEN || !PHONE_ID) {
  console.warn('⚠️ Falta WHATSAPP_TOKEN o PHONE_NUMBER_ID en variables de entorno.');
}

let openai = null;
if (OPENAI_API_KEY) {
  openai = new OpenAI({ apiKey: OPENAI_API_KEY });
} else {
  console.warn('⚠️ Falta OPENAI_API_KEY, se usará respuesta básica.');
}

// ===== Config WhatsApp =====
const GRAPH_URL = `https://graph.facebook.com/v20.0/${PHONE_ID}/messages`;

// ===== Ejemplos =====
const EXAMPLES = [
  'anx.mx',
  'radicaltransforma.com',
  'airplustx.com',
  'apsdisplay.com',
  'fumigacionescdmxyareametropolitana.com'
];

// ===== Seguimientos =====
const FOLLOWUP_15M =
  '👋 Quedo atento. Si te sirve, te mando 2–3 ejemplos o te explico el proceso en 1 minuto. ¿Por dónde te gustaría empezar?';
const FOLLOWUP_24H =
  'Solo para no perder tu mensaje: esta semana la página web profesional queda desde $4,500 (o $5,999 con hosting+dominio). ¿Te mando ejemplos o prefieres ver el paso a paso?';
const FOLLOWUP_48H =
  `Cierro por aquí para no molestarte. Si quieres retomar, te dejo mi agenda: ${CALENDLY_URL}. Con gusto lo vemos cuando te acomode 🙌`;

// ===== PROMPT MAESTRO (Erick Damián) =====
const SYSTEM_PROMPT = `
Hablas en primera persona como **Erick Damián, CEO de NeuroMIND**.
Tono: cercano, consultivo, profesional y cálido (WhatsApp real). Nunca digas que eres bot o IA.
Mensajes cortos (1–3 líneas) y máximo 1–2 emojis.
Una sola pregunta por mensaje y espera respuesta antes de continuar.
Evita tecnicismos; explica simple. Usa micro-resúmenes: "Súper: página web profesional para atraer clientes. ¿Voy bien?".

OBJETIVO
1) Entender el caso (sondeo) y despejar dudas.
2) Si hay fit, proponer una mini-llamada de 10–15 min. Ofrece mañana o tarde; si prefiere link: ${CALENDLY_URL}.
3) Si el lead pide demasiados datos técnicos o una cotización formal, propone llamada (ahorra ida y vuelta).

OFERTA (menciónala cuando haga sentido, no todo de golpe)
- Desarrollamos **páginas web profesionales** con estructura estándar incluida:
  • Inicio (hero + propuesta de valor)
  • Menú/Navegación claro
  • Nosotros
  • Servicios
  • Información de la empresa (ubicación, certificaciones, datos)
  • Contacto con **botón de WhatsApp**
- Entrega **5–7 días hábiles** (con contenidos listos).
- Incluye: diseño premium responsivo, SEO básico y carga rápida.
- Arranque: con logo + 3–5 fotos + textos base (apoyo con copy si hace falta).
- Precios: **$5,999 MXN** con hosting+dominio+SSL, o **$4,500 MXN** si ya cuenta con hosting+dominio.

QUÉ AVERIGUAR (pregunta solo si aplica por lo que el lead diga)
- Giro/negocio y objetivo (atraer clientes, profesionalizar, etc.).
- Si ya tiene dominio / hosting o lo incluimos.
- Estilo deseado (serio/corporativo vs moderno/dinámico).
- Si tiene logo y 3–5 fotos; si no, ofrece apoyo con textos base.
- Si requiere secciones extra (portafolio, testimonios, preguntas frecuentes, etc.).
- Urgencia/ventana de entrega.
- Si es agencia: volumen y si busca proveedor invisible.

EJEMPLOS (menciona 2–3 cuando ayude):
${EXAMPLES.join(', ')}

FAQ (breve + pregunta de avance)
- ¿Tiempo? 5–7 días hábiles con contenidos listos. ¿Para cuándo te gustaría tenerla?
- ¿Incluye SEO? Sí, SEO básico y carga rápida. Si quieres algo más avanzado, lo vemos en la llamada.
- ¿Pagos? Podemos dividir; lo vemos en la llamada.
- ¿Garantía/Cambios? Ajustes razonables y pruebas antes de publicar.
- ¿Factura? Sí, sin problema.

CIERRE SUAVE (cuando haya fit o dudas largas)
"Perfecto. Para no darte lata con mensajes, te propongo una mini-llamada de 10–15 min y te explico todo paso a paso. ¿Te acomoda mañana o tarde? Si prefieres, agenda aquí: ${CALENDLY_URL}"

RECORDATORIOS QUE HARÁ EL SISTEMA (no los mandes tú salvo que te lo pidan):
- 20–30 min sin respuesta: "Quedo atento… ¿ejemplos o proceso?"
- 24 h: mención precio desde $4,500.
- 48 h: despedida + agenda.

Importante: **Nunca menciones “tipos de páginas”** (no digas informativa, tienda, landing, etc.). Di siempre **página web profesional**.
Firma implícita: Erick Damián – CEO de NeuroMIND.
`;

// ===== Memoria por usuario (historial + timers) =====
const memory = new Map(); // waid => { history: [], lastSeen:number, timers:{} }

function getUserState(waid) {
  if (!memory.has(waid)) {
    memory.set(waid, { history: [], lastSeen: Date.now(), timers: {} });
  }
  return memory.get(waid);
}

// ===== Mini-Inbox (memoria simple) =====
const manualSet = new Set();             // waid con pausa activa (no responde el bot)
const chats = new Map();                 // waid -> { name, messages: [{dir:'in'|'out', text, ts}] }
const releaseTimers = new Map();         // waid -> timeout para auto-reanudar

function pushMsg(waid, dir, text) {
  if (!chats.has(waid)) chats.set(waid, { name: waid, messages: [] });
  chats.get(waid).messages.push({ dir, text, ts: Date.now() });
  const arr = chats.get(waid).messages;
  if (arr.length > 200) arr.shift();
}

// ===== Utilidades WhatsApp =====
async function sendText(to, body) {
  // Partir mensajes largos por seguridad
  const parts = [];
  const maxLen = 950;
  for (let i = 0; i < body.length; i += maxLen) parts.push(body.slice(i, i + maxLen));

  for (const text of parts) {
    try {
      await axios.post(
        GRAPH_URL,
        { messaging_product: 'whatsapp', to, type: 'text', text: { body: text } },
        { headers: { Authorization: `Bearer ${WA_TOKEN}` } }
      );
    } catch (err) {
      console.error('sendText error:', err?.response?.data || err.message);
    }
  }
}

// ===== Seguimientos programados =====
function scheduleFollowups(waid, to) {
  const state = getUserState(waid);

  // Limpia timers previos
  Object.values(state.timers).forEach((t) => clearTimeout(t));
  state.timers = {};

  // 20 min
  state.timers.t20 = setTimeout(async () => {
    await sendText(to, FOLLOWUP_15M);
  }, 20 * 60 * 1000);

  // 24 h
  state.timers.t24 = setTimeout(async () => {
    await sendText(to, FOLLOWUP_24H);
  }, 24 * 60 * 60 * 1000);

  // 48 h
  state.timers.t48 = setTimeout(async () => {
    await sendText(to, FOLLOWUP_48H);
  }, 48 * 60 * 60 * 1000);
}

// ===== LLM =====
async function llmReply(waid, userText) {
  const state = getUserState(waid);
  state.lastSeen = Date.now();

  state.history.push({ role: 'user', content: userText });
  if (state.history.length > 12) state.history.splice(0, state.history.length - 12);

  if (!openai) {
    return `¡Hola! Soy Erick Damián, CEO de NeuroMIND 🙌
Cuéntame rápido sobre tu **página web profesional**: ¿de qué trata tu negocio y si ya tienes dominio/hosting? Incluimos Inicio, Menú, Nosotros, Servicios, Información de la empresa y Contacto con botón de WhatsApp. Si prefieres agendar directo: ${CALENDLY_URL}`;
  }

  try {
    const messages = [{ role: 'system', content: SYSTEM_PROMPT }, ...state.history];
    const resp = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages,
      temperature: 0.6
    });
    const text =
      resp.choices?.[0]?.message?.content?.trim() ||
      `Perfecto. ¿Te acomoda más mañana o tarde para una mini llamada? Si prefieres, agenda aquí: ${CALENDLY_URL}`;

    // Guarda salida del asistente
    state.history.push({ role: 'assistant', content: text });
    return text;
  } catch (err) {
    console.error('OpenAI error:', err?.response?.data || err.message);
    return `Listo. Te ayudo personalmente con tu **página web profesional** (Inicio, Menú, Nosotros, Servicios, Información de la empresa y Contacto con WhatsApp). ¿Te acomoda mañana o en la tarde? 👉 Agenda aquí: ${CALENDLY_URL}`;
  }
}

// ===== Server =====
const app = express();
app.use(express.json());

// Salud
app.get('/', (_req, res) => {
  res.send('Neuromind bot OK');
});

// Verificación webhook
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token && mode === 'subscribe' && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

// Recepción de eventos
app.post('/webhook', async (req, res) => {
  try {
    const change = req.body?.entry?.[0]?.changes?.[0]?.value;
    const messages = change?.messages;
    if (!messages) return res.sendStatus(200);

    const msg = messages[0];
    const from = msg?.from;
    const txt = msg?.text?.body?.trim();

    if (!from) return res.sendStatus(200);

    // Guarda entrada para el panel
    pushMsg(from, 'in', txt || '[no-text]');

    // BOT apagado: no responder
    if (BOT_MODE === 'off') return res.sendStatus(200);

    // MODO manual + pausa activa: no responder (y reprogramar auto-reanudar)
    if (BOT_MODE === 'manual' && manualSet.has(from)) {
      if (releaseTimers.has(from)) clearTimeout(releaseTimers.get(from));
      releaseTimers.set(
        from,
        setTimeout(async () => {
          manualSet.delete(from);
          await sendText(from, '¿Seguimos? Te apoyo con ejemplos o te explico el proceso en 1 minuto 🙌');
          scheduleFollowups(from, from);
          releaseTimers.delete(from);
        }, TAKEOVER_MIN * 60 * 1000)
      );
      return res.sendStatus(200);
    }

    // Si no hay texto, pide texto
    if (!txt) {
      await sendText(from, '¿Podrías escribirme en texto lo que necesitas? Así te ayudo más rápido 🙌');
      pushMsg(from, 'out', '¿Podrías escribirme en texto lo que necesitas? Así te ayudo más rápido 🙌');
      return res.sendStatus(200);
    }

    // Respuesta LLM
    const reply = await llmReply(from, txt);
    await sendText(from, reply);
    pushMsg(from, 'out', reply);

    // Programar seguimientos
    scheduleFollowups(from, from);

    res.sendStatus(200);
  } catch (err) {
    console.error('Webhook error:', err?.response?.data || err.message);
    res.sendStatus(200);
  }
});

// ====== Helpers de admin ======
function assertAdmin(req, res) {
  const token = req.headers['x-admin-token'] || req.query.token || req.body?.token;
  if (!ADMIN_TOKEN || token !== ADMIN_TOKEN) {
    res.status(401).json({ ok: false, error: 'unauthorized' });
    return false;
  }
  return true;
}

// Lista de chats
app.get('/api/chats', (req, res) => {
  if (!assertAdmin(req, res)) return;
  const list = [...chats.entries()].map(([waid, c]) => {
    const last = c.messages[c.messages.length - 1];
    return {
      waid,
      lastMsg: last?.text || '',
      lastDir: last?.dir || 'in',
      lastAt: last?.ts || 0,
      paused: manualSet.has(waid)
    };
  }).sort((a,b) => b.lastAt - a.lastAt);
  res.json({ ok:true, data:list });
});

// Mensajes de un chat
app.get('/api/messages', (req, res) => {
  if (!assertAdmin(req, res)) return;
  const waid = String(req.query.waid || '');
  const c = chats.get(waid) || { messages: [] };
  res.json({ ok:true, data:c.messages });
});

// Enviar mensaje manual y PAUSAR al bot automáticamente
app.post('/api/send', async (req, res) => {
  if (!assertAdmin(req, res)) return;
  const { to, text } = req.body || {};
  if (!to || !text) return res.status(400).json({ ok:false, error:'to and text required' });

  try {
    await sendText(to, text);
    pushMsg(to, 'out', text);

    // Activa pausa
    manualSet.add(to);
    if (releaseTimers.has(to)) clearTimeout(releaseTimers.get(to));
    releaseTimers.set(
      to,
      setTimeout(async () => {
        manualSet.delete(to);
        await sendText(to, '¿Seguimos? Te apoyo con ejemplos o te explico el proceso en 1 minuto 🙌');
        scheduleFollowups(to, to);
        releaseTimers.delete(to);
      }, TAKEOVER_MIN * 60 * 1000)
    );

    res.json({ ok:true });
  } catch (e) {
    console.error('manual send error:', e?.response?.data || e.message);
    res.status(500).json({ ok:false });
  }
});

// Pausar/Reanudar manualmente
app.post('/api/takeover', (req, res) => {
  if (!assertAdmin(req, res)) return;
  const { waid, minutes = TAKEOVER_MIN } = req.body || {};
  if (!waid) return res.status(400).json({ ok:false, error:'waid required' });

  manualSet.add(waid);
  if (releaseTimers.has(waid)) clearTimeout(releaseTimers.get(waid));
  releaseTimers.set(
    waid,
    setTimeout(async () => {
      manualSet.delete(waid);
      await sendText(waid, '¿Seguimos? Te apoyo con ejemplos o te explico el proceso en 1 minuto 🙌');
      scheduleFollowups(waid, waid);
      releaseTimers.delete(waid);
    }, parseInt(minutes,10) * 60 * 1000)
  );

  res.json({ ok:true, waid, minutes });
});

app.post('/api/release', (req, res) => {
  if (!assertAdmin(req, res)) return;
  const { waid } = req.body || {};
  if (!waid) return res.status(400).json({ ok:false, error:'waid required' });
  manualSet.delete(String(waid));
  if (releaseTimers.has(waid)) clearTimeout(releaseTimers.get(waid));
  releaseTimers.delete(waid);
  res.json({ ok:true });
});

// ===== Panel web muy simple =====
app.get('/inbox', (req, res) => {
  res.setHeader('Content-Type','text/html; charset=utf-8');
  res.end(`<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Neuromind Inbox</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  body{font-family:system-ui,Segoe UI,Arial,sans-serif;margin:0;display:flex;height:100vh}
  #side{width:320px;border-right:1px solid #eee;overflow:auto}
  #main{flex:1;display:flex;flex-direction:column}
  header{padding:10px 12px;border-bottom:1px solid #eee;display:flex;gap:8px;align-items:center}
  input,button{font:inherit}
  .chat{padding:10px 12px;border-bottom:1px solid #f2f2f2;cursor:pointer}
  .chat.paused{background:#fff7e6}
  .msglist{flex:1;overflow:auto;padding:12px;background:#fafafa}
  .bubble{max-width:70%;margin:6px 0;padding:8px 10px;border-radius:10px;white-space:pre-wrap}
  .in{background:#fff;border:1px solid #eee;align-self:flex-start}
  .out{background:#dff4ff;border:1px solid #bfe8ff;align-self:flex-end}
  .controls{display:flex;gap:8px;padding:10px;border-top:1px solid #eee}
  .controls input[type=text]{flex:1;padding:8px}
</style>
</head>
<body>
  <div id="side">
    <header>
      <input id="token" placeholder="ADMIN_TOKEN" />
      <button onclick="saveToken()">OK</button>
    </header>
    <div id="chats"></div>
  </div>
  <div id="main">
    <header>
      <div id="title">Selecciona un chat</div>
      <div style="margin-left:auto;display:flex;gap:6px">
        <button onclick="takeover()">Pausar</button>
        <button onclick="release()">Reanudar</button>
      </div>
    </header>
    <div id="msgs" class="msglist"></div>
    <div class="controls">
      <input id="to" placeholder="waid (52155...)" />
      <input id="text" placeholder="Escribe tu mensaje..." />
      <button onclick="send()">Enviar</button>
    </div>
  </div>

<script>
let TOKEN = localStorage.getItem('admintoken') || '';
let current = '';

document.getElementById('token').value = TOKEN;

function saveToken(){ TOKEN = document.getElementById('token').value.trim(); localStorage.setItem('admintoken', TOKEN); loadChats(); }

async function loadChats(){
  if(!TOKEN) return;
  const r = await fetch('/api/chats?token='+encodeURIComponent(TOKEN));
  const j = await r.json(); if(!j.ok) return alert('Token inválido');
  const c = document.getElementById('chats'); c.innerHTML='';
  j.data.forEach(row=>{
    const d = document.createElement('div');
    d.className='chat'+(row.paused?' paused':'');
    d.textContent = row.waid + ' — ' + (row.lastMsg || '');
    d.onclick = ()=>{ current=row.waid; document.getElementById('title').textContent=row.waid; document.getElementById('to').value=row.waid; loadMsgs(); };
    c.appendChild(d);
  });
}

async function loadMsgs(){
  if(!TOKEN || !current) return;
  const r = await fetch('/api/messages?token='+encodeURIComponent(TOKEN)+'&waid='+encodeURIComponent(current));
  const j = await r.json(); if(!j.ok) return alert('Token inválido');
  const m = document.getElementById('msgs'); m.innerHTML='';
  j.data.forEach(x=>{
    const b = document.createElement('div');
    b.className='bubble '+(x.dir==='out'?'out':'in');
    b.textContent = x.text;
    m.appendChild(b);
  });
  m.scrollTop = m.scrollHeight;
}

async function send(){
  const to = document.getElementById('to').value.trim();
  const text = document.getElementById('text').value.trim();
  if(!to || !text) return;
  const r = await fetch('/api/send',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:TOKEN,to,text})});
  const j = await r.json(); if(!j.ok) return alert('Error al enviar');
  document.getElementById('text').value='';
  loadMsgs(); loadChats();
}

async function takeover(){
  if(!current) return;
  const mins = prompt('Minutos de pausa', '90') || '90';
  const r = await fetch('/api/takeover',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:TOKEN,waid:current,minutes:parseInt(mins,10)})});
  const j = await r.json(); if(!j.ok) return alert('Error');
  loadChats();
}

async function release(){
  if(!current) return;
  const r = await fetch('/api/release',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:TOKEN,waid:current})});
  const j = await r.json(); if(!j.ok) return alert('Error');
  loadChats();
}

saveToken();
setInterval(()=>{ if(current) loadMsgs(); loadChats(); }, 5000);
</script>
</body>
</html>`);
});

app.listen(PORT, () => {
  console.log(`🤖 Bot en puerto ${PORT}`);
});

