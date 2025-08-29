// == index.js ==
// NeuroMIND – WhatsApp Bot con sondeo humano, memoria corta y recordatorios
// Requiere: express, axios, dotenv, openai

import 'dotenv/config';
import express from 'express';
import axios from 'axios';
import OpenAI from 'openai';

// ===== ENV =====
const PORT = process.env.PORT || 10000;

const VERIFY_TOKEN   = process.env.VERIFY_TOKEN   || 'neuromind_verify';
const WA_TOKEN       = process.env.WHATSAPP_TOKEN || '';                // token del usuario de sistema
const PHONE_ID       = process.env.PHONE_NUMBER_ID || '';               // solo dígitos
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const CALENDLY_URL   = process.env.CALENDLY_URL   || 'https://calendly.com/erick-damian-ceo-de-neuromind-ia/junta-ceo-de-neuromind';

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

// ===== Mensajes de seguimiento (texto plano, sin botones) =====
const FOLLOWUP_15M =
  '👋 Quedo atento. Si te sirve, te mando ejemplos o te explico el proceso en 2 min y listo. ¿Por dónde te gustaría empezar?';

const FOLLOWUP_24H =
  'Solo para no perder tu mensaje: esta semana la web queda desde $4,500 (o $5,999 con hosting+dominio). ¿Te mando ejemplos o prefieres ver precios/paquetes?';

const FOLLOWUP_48H =
  `Cierro por aquí para no molestarte. Si quieres retomar, te dejo mi agenda: ${CALENDLY_URL}. Con gusto lo vemos cuando te acomode 🙌`;

// ===== PROMPT MAESTRO (Erick Damián) =====
const SYSTEM_PROMPT = `
Hablas en primera persona como **Erick Damián, CEO de NeuroMIND**.
Tono: cercano, consultivo, profesional y cálido (WhatsApp real). Nunca digas que eres bot o IA.
Mensajes de 1–3 líneas y máximo 1–2 emojis.
Una sola pregunta por mensaje y espera respuesta antes de continuar.
Evita tecnicismos; explica simple. Usa micro-resúmenes: "Súper: web informativa, ya tienes hosting y buscas más clientes. ¿Voy bien?".

OBJETIVO
1) Entender el caso (sondeo) y despejar dudas.
2) Si hay fit, proponer una mini-llamada de 10–15 min. Ofrece mañana o tarde; si prefiere link: ${CALENDLY_URL}.
3) Si el lead pide demasiados datos técnicos o una cotización formal, propone llamada (ahorra ida y vuelta).

QUÉ AVERIGUAR (pregunta solo si aplica por lo que el lead diga)
- Giro/negocio y objetivo (atraer clientes, profesionalizar, e-commerce, etc.).
- Si ya tiene web / dominio / hosting.
- Tipo: informativa, landing de captación o tienda.
- Contenidos disponibles: logo, 3–5 fotos, textos base.
- Urgencia/ventana de entrega.
- Si es agencia: volumen y si busca proveedor invisible.

DETECCIÓN DE INTENCIÓN
- Agencia → proveedor invisible, $4,500 por web, paquetes y ahorros.
- Pyme/General → $5,999 con hosting+dominio o $4,500 si ya los tiene.

OFERTA (menciónala cuando haga sentido, no todo de golpe)
- Precios: $4,500 MXN si ya tiene hosting+dominio; $5,999 MXN con hosting+dominio+SSL.
- Entrega 5–7 días hábiles (con contenidos listos).
- Incluye: diseño premium responsivo, SEO básico, carga rápida.
- Landing enfocada a conversiones (WhatsApp/formulario).
- Tienda: pasarela, catálogo e inventario se ven en la mini-llamada.
- Arranque: con logo + 3–5 fotos + textos base (apoyo con copy).

EJEMPLOS (menciona 2–3 si el lead lo pide o ayuda):
${EXAMPLES.join(', ')}

FAqs (breve + pregunta de avance)
- ¿Tiempo? 5–7 días hábiles con contenidos listos. ¿Para cuándo te gustaría tenerla?
- ¿Incluye SEO? Sí, SEO básico y carga rápida. Si quieres algo avanzado, lo vemos en la llamada.
- ¿Pagos? Podemos dividir. Lo vemos en la llamada.
- ¿Garantía/Cambios? Ajustes razonables y pruebas antes de publicar.
- ¿Factura? Sí, sin problema.
- ¿Tienda? Se define pasarela, catálogo e inventario en 10–15 min.

CIERRE SUAVE (cuando haya fit o dudas largas)
"Perfecto. Para no darte lata con mensajes, te propongo una mini-llamada de 10–15 min y te explico todo paso a paso. ¿Te acomoda mañana o tarde? Si prefieres, agenda aquí: ${CALENDLY_URL}"

RECORDATORIOS QUE HARÁ EL SISTEMA (no los mandes tú a menos que el motor te pida redactarlos):
- 20–30 min sin respuesta: "Quedo atento… ¿ejemplos o proceso?"
- 24 h: mención precio desde $4,500.
- 48 h: despedida + agenda.

Firma implícita: Erick Damián – CEO de NeuroMIND.
`;

// ===== Memoria por usuario (historial + timers) =====
const memory = new Map(); // key: waid => { history:[], lastSeen: Date, timers:{} }

function getUserState(waid) {
  if (!memory.has(waid)) {
    memory.set(waid, { history: [], lastSeen: Date.now(), timers: {} });
  }
  return memory.get(waid);
}

// ===== Utilidades WhatsApp =====
async function sendText(to, body) {
  // Partir mensajes largos por seguridad (~1000 chars)
  const chunks = [];
  const maxLen = 950;
  for (let i = 0; i < body.length; i += maxLen) {
    chunks.push(body.slice(i, i + maxLen));
  }
  for (const part of chunks) {
    try {
      await axios.post(
        GRAPH_URL,
        { messaging_product: 'whatsapp', to, type: 'text', text: { body: part } },
        { headers: { Authorization: `Bearer ${WA_TOKEN}` } }
      );
    } catch (err) {
      console.error('sendText error:', err?.response?.data || err.message);
    }
  }
}

// ===== Seguimientos programados (si la instancia se mantiene activa) =====
function scheduleFollowups(waid, to) {
  const state = getUserState(waid);

  // Limpia timers previos
  Object.values(state.timers).forEach((t) => clearTimeout(t));
  state.timers = {};

  // 20–30 min (usamos 20 min)
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

  // Mantener historial corto
  state.history.push({ role: 'user', content: userText });
  if (state.history.length > 12) state.history.splice(0, state.history.length - 12);

  // Sin clave: fallback humano básico
  if (!openai) {
    return `¡Hola! Soy Erick Damián, CEO de NeuroMIND 🙌
Cuéntame rápido qué necesitas (web informativa, landing o tienda) y te ayudo a avanzar. Si prefieres agendar directo: ${CALENDLY_URL}`;
  }

  try {
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...state.history
    ];
    const resp = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages,
      temperature: 0.6
    });
    const text =
      resp.choices?.[0]?.message?.content?.trim() ||
      `Perfecto. ¿Te acomoda más mañana o tarde? Si prefieres, agenda aquí: ${CALENDLY_URL}`;

    // Guardar salida del asistente
    state.history.push({ role: 'assistant', content: text });
    return text;
  } catch (err) {
    console.error('OpenAI error:', err?.response?.data || err.message);
    return `Listo. ¿Te acomoda mañana o en la tarde? 👉 Agenda aquí: ${CALENDLY_URL}`;
  }
}

// ===== Servidor =====
const app = express();
app.use(express.json());

app.get('/', (_req, res) => {
  res.send('Neuromind bot OK');
});

// Meta Webhook Verify (GET)
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token && mode === 'subscribe' && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

// Meta Webhook Receiver (POST)
app.post('/webhook', async (req, res) => {
  try {
    const body = req.body;
    const change = body?.entry?.[0]?.changes?.[0]?.value;
    const messages = change?.messages;

    // Ignora notificaciones de status
    if (!messages) return res.sendStatus(200);

    const msg = messages[0];
    const from = msg?.from; // waid
    const txt = msg?.text?.body?.trim();

    if (!from) return res.sendStatus(200);

    // Solo procesamos texto. Si viene audio/imágenes, pedimos texto.
    if (!txt) {
      await sendText(
        from,
        '¿Podrías escribirme en texto lo que necesitas? Así te ayudo más rápido 🙌'
      );
      return res.sendStatus(200);
    }

    // Genera respuesta con LLM
    const reply = await llmReply(from, txt);
    await sendText(from, reply);

    // Reprograma followups cada vez que hay interacción
    scheduleFollowups(from, from);

    res.sendStatus(200);
  } catch (err) {
    console.error('Webhook error:', err?.response?.data || err.message);
    res.sendStatus(200);
  }
});

app.listen(PORT, () => {
  console.log(`🤖 Bot en puerto ${PORT}`);
});

