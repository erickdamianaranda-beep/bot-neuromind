// index.js
/**
 * NeuroMIND – WhatsApp Bot con seguimiento y botones
 * Requiere: express, axios, dotenv, openai
 *
 * npm i express axios dotenv openai
 */

import 'dotenv/config';
import express from 'express';
import axios from 'axios';
import OpenAI from 'openai';

// ===== ENV =====
const PORT = process.env.PORT || 10000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'neuromind_verify';
const WA_TOKEN = process.env.WHATSAPP_TOKEN || '';
const PHONE_ID = process.env.PHONE_NUMBER_ID || '';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const CALENDLY_URL =
  process.env.CALENDLY_URL ||
  'https://calendly.com/erick-damian-ceo-de-neuromind-ia/junta-ceo-de-neuromind';

if (!WA_TOKEN || !PHONE_ID) {
  console.warn('⚠️ Falta WHATSAPP_TOKEN o PHONE_NUMBER_ID en .env');
}

// ===== OpenAI =====
let openai = null;
if (OPENAI_API_KEY) {
  openai = new OpenAI({ apiKey: OPENAI_API_KEY });
} else {
  console.warn('⚠️ Falta OPENAI_API_KEY, se usará respuesta básica.');
}

// ===== Config =====
const GRAPH_URL = `https://graph.facebook.com/v20.0/${PHONE_ID}/messages`;

const EXAMPLES = [
  'ANX → https://anx.mx',
  'Radical Transforma → https://radicaltransforma.com',
  'Air Plus TX → https://airplustx.com',
  'APS Display → https://apsdisplay.com',
  'Fumigaciones CDMX → https://fumigacionescdmxyareametropolitana.com',
];

const FOLLOWUP_15M = `👋 Hola, veo que aún no has agendado tu llamada. ¿Quieres que te envíe más *ejemplos de páginas web* o prefieres que te comparta *cómo funciona el proceso*?`;
const FOLLOWUP_24H = `Recordatorio rápido: esta semana tu página web profesional está desde *$4,500 MXN*. ¿Quieres que te mande más info o te comparto el enlace para agendar?`;
const FOLLOWUP_48H = `Último recordatorio 🤝 Aún puedes aprovechar la promoción en páginas web. ¿Te mando el enlace para agendar o prefieres que te envíe ejemplos?`;

// Botones sugeridos
const MAIN_BUTTONS = [
  { id: 'agendar',  title: '📅 Agendar' },
  { id: 'ejemplos', title: '🌐 Ver ejemplos' },
  { id: 'precios',  title: '💸 Precios' },
  { id: 'paquetes', title: '💻 Paquetes (Agencias)' },
];

// ===== Prompt Maestro =====
const SYSTEM_PROMPT = `
Eres Erick Damián, CEO de *NeuroMIND*. Hablas SIEMPRE en primera persona como Erick.
Voz: profesional, segura, cercana y consultiva. Mensajes cortos (2–4 líneas), máximo 1–2 emojis (🙌🚀✨✅👉😊).
Sin tecnicismos ni mención de IA/APIs. Si preguntan "¿eres bot?", responde: "No, soy Erick. Te ayudo por aquí 😊".

OBJETIVO
• Atender como humano, resolver dudas rápido y llevar a una mini llamada de 10–15 min.
• Primero pregunto si prefiere mañana o tarde; luego sugiero 1–2 horas o comparto este link: ${CALENDLY_URL}.
• Infiero lo técnico por contexto; solo pregunto si hace falta y con una frase suave.
• Siempre cierro con una acción (agendar, ver ejemplos, precios o paquetes).

SONDEO LIBRE (una pregunta por mensaje)
• "¿Es tu primera página web o ya has tenido una? 🙌"
• "Cuéntame rápido, ¿de qué trata tu negocio?"
• "¿Qué buscas ahora: web informativa, tienda online o landing para captar clientes? 🚀"
• "¿Quieres que me encargue también de la parte técnica o prefieres que optimice lo que ya tienes?"

RESPUESTAS RÁPIDAS (FAQ)
• ⏱️ Con contenidos listos, la web queda aprox. en 5–7 días.
• 🔍 Incluye SEO base y carga rápida.
• 🎯 Landing enfocada a conversiones con WhatsApp/formulario.
• 🛒 Si es tienda: pasarela, catálogo e inventarios los definimos en la mini llamada.
• 🖼️ Con 3–5 fotos y tu logo arrancamos; yo te apoyo con textos base.

CAMPAÑAS ACTUALES
1) Agencias de Marketing
   • Precio por web: *$4,500 MXN*.
   • Paquetes:
     – Starter (2 webs/mes): $8,500 MXN (ahorro $500).
     – Growth (5 webs/mes): $20,000 MXN (ahorro $2,500).
     – Partner (10 webs/mes): $38,000 MXN (ahorro $7,000).
   • Beneficios: entrego en 5 días hábiles, diseño premium y servicio “invisible” (la agencia se lleva el crédito), pueden revender desde $12,000 MXN.
   • Respuesta:
     "Soy tu proveedor invisible de páginas web: tú las revendes desde $12,000 MXN o más y yo las desarrollo desde $4,500. También manejo paquetes con descuento por volumen. ¿Quieres que te muestre ejemplos?"

2) PYMES
   • Promoción: *$5,999 MXN* con dominio + hosting + SSL incluidos.
   • Si ya tienen dominio y hosting: *$4,500 MXN*.
   • Incluye: diseño premium responsivo, SEO base y 5 días hábiles.
   • Respuesta:
     "Tengo una promoción para PYMES: tu web profesional cuesta $5,999 MXN con hosting y dominio. Si ya cuentas con ellos, te queda en $4,500 MXN. ¿Agendamos una llamada para platicar y avanzar?"

3) Público General
   • Web profesional desde *$4,500 MXN* (si ya tienen hosting/dominio) o *$5,999 MXN* con todo incluido.
   • Incluye: diseño premium, responsive y 5 días hábiles.
   • Respuesta:
     "Estoy manejando una promoción: tu web desde $4,500 MXN si ya tienes hosting y dominio, o $5,999 MXN con todo incluido. ¿Quieres que te comparta ejemplos para que veas la calidad?"

EJEMPLOS REALES (menciona 1–3 según el caso)
${EXAMPLES.map(e => `• ${e}`).join('\n')}

SEGUIMIENTO AUTOMÁTICO
• Tras 15–30 min: ofrece botones “Agendar”, “Ver ejemplos”, “Precios”, “Paquetes para agencias”.
• Tras 24 h: recuerda la promo y ofrece agendar o más info.
• Tras 48 h: último recordatorio amable con CTA claro.

BOTONES (si aplica)
• 📅 Agendar → ${CALENDLY_URL}
• 🌐 Ver ejemplos → enviar 2–3 del listado
• 💸 Precios → explicar $4,500 / $5,999 y paquetes
• 💻 Paquetes (Agencias) → Starter/Growth/Partner y ahorros

CIERRES / CTA
• “Súper. ¿Te acomoda más en la *mañana* o en la *tarde*? 👉 Si prefieres, agenda directo aquí: ${CALENDLY_URL}”
• Micro-resumen antes de cerrar: “Súper: *landing para leads* y yo me encargo de lo técnico. ¿Voy bien?”
• Una sola pregunta a la vez y terminar siempre con una que avance.
`;

// ===== Memoria por usuario =====
const memory = new Map();
/**
 * getUserState(waId) -> { history:[], timers:{}, lastSeen:number }
 */
function getUserState(waId) {
  if (!memory.has(waId)) {
    memory.set(waId, { history: [], timers: {}, lastSeen: Date.now() });
  }
  return memory.get(waId);
}

// ===== Utilidades WhatsApp =====
async function sendText(to, body) {
  try {
    await axios.post(
      GRAPH_URL,
      {
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body },
      },
      { headers: { Authorization: `Bearer ${WA_TOKEN}` } }
    );
  } catch (err) {
    console.error('sendText error:', err?.response?.data || err.message);
  }
}

async function sendButtons(to, text, buttons = MAIN_BUTTONS) {
  // Interactivos tipo botones "reply"
  const btns = buttons.slice(0, 3).map((b) => ({
    type: 'reply',
    reply: { id: b.id, title: b.title },
  }));
  try {
    await axios.post(
      GRAPH_URL,
      {
        messaging_product: 'whatsapp',
        to,
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text },
          action: { buttons: btns },
        },
      },
      { headers: { Authorization: `Bearer ${WA_TOKEN}` } }
    );
  } catch (err) {
    console.error('sendButtons error:', err?.response?.data || err.message);
  }
}

// ===== Seguimientos =====
function scheduleFollowups(waId, to) {
  const state = getUserState(waId);

  // Limpia timers previos
  for (const key of Object.keys(state.timers)) {
    clearTimeout(state.timers[key]);
  }
  state.timers = {};

  // 15–30 min (usamos 20 min)
  state.timers.t15 = setTimeout(async () => {
    await sendButtons(to, FOLLOWUP_15M, MAIN_BUTTONS);
  }, 20 * 60 * 1000);

  // 24h / 48h (nota: en hosting free pueden no ejecutarse si duerme)
  state.timers.t24 = setTimeout(async () => {
    await sendText(to, FOLLOWUP_24H);
  }, 24 * 60 * 60 * 1000);

  state.timers.t48 = setTimeout(async () => {
    await sendText(to, FOLLOWUP_48H);
  }, 48 * 60 * 60 * 1000);
}

// ===== LLM =====
async function llmReply(waId, userText) {
  const state = getUserState(waId);
  state.history.push({ role: 'user', content: userText });
  // Mantener historial corto
  if (state.history.length > 12) state.history.splice(0, state.history.length - 12);

  if (!openai) {
    // Fallback sin OpenAI
    return `¡Hola! Soy Erick Damián, CEO de NeuroMIND 🙌\nCuéntame rápido qué necesitas (web informativa, tienda o landing) y te ayudo a agendar una mini llamada: ${CALENDLY_URL}`;
  }

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...state.history,
  ];

  try {
    const resp = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages,
      temperature: 0.6,
    });
    const text =
      resp.choices?.[0]?.message?.content?.trim() ||
      `Perfecto. ¿Te acomoda más mañana o tarde? 👉 Agenda aquí: ${CALENDLY_URL}`;
    // Guardar salida del asistente
    state.history.push({ role: 'assistant', content: text });
    return text;
  } catch (err) {
    console.error('OpenAI error:', err?.response?.data || err.message);
    return `Listo. ¿Te acomoda más mañana o en la tarde? 👉 Agenda aquí: ${CALENDLY_URL}`;
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
  try {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.sendStatus(403);
  } catch {
    return res.sendStatus(500);
  }
});

// Recepción de eventos
app.post('/webhook', async (req, res) => {
  // Responder lo antes posible a Meta
  res.sendStatus(200);

  try {
    const entry = req.body?.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;

    // Mensajes entrantes
    const messages = value?.messages;
    const statuses = value?.statuses;

    if (Array.isArray(messages)) {
      for (const msg of messages) {
        const from = msg.from; // waId
        const type = msg.type;

        // Limpia o reprograma seguimientos al recibir mensaje
        scheduleFollowups(from, from);

        // Extraer texto (texto normal o reply a botón)
        let userText = '';
        if (type === 'text') userText = msg.text?.body || '';
        if (type === 'interactive') {
          const interactive = msg.interactive;
          if (interactive?.type === 'button_reply') {
            userText = interactive.button_reply?.id || interactive.button_reply?.title || '';
          } else if (interactive?.type === 'list_reply') {
            userText = interactive.list_reply?.id || interactive.list_reply?.title || '';
          }
        }
        if (!userText) userText = '[mensaje_no_soportado]';

        // Ruteo por botones
        const lower = userText.toLowerCase();
        if (['agendar', 'agenda', 'cita', 'calendario'].some(k => lower.includes(k))) {
          await sendText(from, `Perfecto 🙌 ¿Te acomoda más *mañana* o *tarde*? Si prefieres, puedes agendar directo aquí: ${CALENDLY_URL}`);
          continue;
        }
        if (lower.includes('ejemplos')) {
          const list = EXAMPLES.slice(0, 3).join('\n');
          await sendText(from, `Aquí tienes algunos ejemplos de webs entregadas:\n${list}\n\n¿Quieres que agendemos una mini llamada? 👉 ${CALENDLY_URL}`);
          continue;
        }
        if (lower.includes('precios')) {
          await sendText(
            from,
            `Precios rápidos:\n• $4,500 MXN si ya tienes hosting/dominio.\n• $5,999 MXN con hosting + dominio + SSL incluidos.\n• Agencias: desde $4,500 por web.\n\n¿Te acomoda mañana o tarde para una mini llamada? 👉 ${CALENDLY_URL}`
          );
          continue;
        }
        if (lower.includes('paquetes')) {
          await sendText(
            from,
            `Paquetes para Agencias:\n• Starter (2 webs): $8,500 MXN (ahorro $500)\n• Growth (5 webs): $20,000 MXN (ahorro $2,500)\n• Partner (10 webs): $38,000 MXN (ahorro $7,000)\n\n¿Te muestro ejemplos o agendamos directo? 👉 ${CALENDLY_URL}`
          );
          continue;
        }

        // LLM
        const reply = await llmReply(from, userText);
        // Si el modelo no incluye CTA, añadimos botones
        await sendText(from, reply);

        // Si el mensaje fue corto y de saludo / inicio, ofrece botones
        if (/hola|buenas|qué tal|buen dia|buen día|saludo/i.test(userText)) {
          await sendButtons(from, '¿Qué te gustaría hacer ahora?', MAIN_BUTTONS);
        }
      }
    }

    // Estados de mensajes (entregados, leídos, etc.)
    if (Array.isArray(statuses)) {
      // Puedes loguear o reaccionar a "failed" para reintentos.
      // console.log(JSON.stringify(statuses, null, 2));
    }
  } catch (err) {
    console.error('Webhook error:', err?.response?.data || err.message);
  }
});

// Iniciar
app.listen(PORT, () => {
  console.log(`🤖 Bot en puerto ${PORT}`);
});

