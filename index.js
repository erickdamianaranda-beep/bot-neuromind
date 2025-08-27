// index.js
import 'dotenv/config';
import express from 'express';
import axios from 'axios';

const app = express();
app.use(express.json());

// ===== Variables de entorno =====
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'neuromind_verify';
const WA_TOKEN     = process.env.WHATSAPP_TOKEN; 
const PHONE_ID     = process.env.PHONE_NUMBER_ID;
const OPENAI_KEY   = process.env.OPENAI_API_KEY;
const CALENDLY_URL = process.env.CALENDLY_URL || 'https://calendly.com/erickdamianaranda/junta-ceo-de-neuromind';
const PORT         = process.env.PORT || 3000;

// ===== Memoria simple por usuario =====
const memory = new Map(); // wa_id -> [{role, content}]

// ===== Enviar texto a WhatsApp =====
async function sendWhatsApp(to, body) {
  const url = `https://graph.facebook.com/v20.0/${PHONE_ID}/messages`;
  await axios.post(
    url,
    {
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body }
    },
    { headers: { Authorization: `Bearer ${WA_TOKEN}` } }
  );
}

// ===== Prompt maestro (humano, sondeo libre, con emojis) =====
const systemPrompt = `
Hablas como Erick Damian, CEO de Neuromind. Natural, cercano y entusiasta.
Mensajes cortos con 1–2 emojis (🙌🚀✨✅👉). Nada de tecnicismos ni mención de IA/APIs.
Si te preguntan si eres un bot, responde: "No, soy Erick. Te ayudo por aquí 😊".

Objetivo: atender como humano, sondear de forma libre (sin cuestionario rígido), resolver dudas en 2–4 líneas
y llevar a una mini llamada de 10–15 min sin imponer horarios.
Primero pregunta si prefiere mañana o tarde; luego sugiere 1–2 horas o comparte el link {{CALENDLY_URL}}.
Infieres la parte técnica por lo que diga; solo preguntas si hace falta con una frase suave.

Sondeo libre (una pregunta por mensaje, solo lo necesario):
• “¿Es tu primera página web o ya has tenido una? 🙌”
• “Cuéntame rápido, ¿de qué trata tu negocio?”
• “¿Qué buscas ahora: web informativa, tienda online o landing para captar clientes? 🚀”
• “¿Quieres que también me encargue de la parte técnica o prefieres que optimice lo que ya tienes?” (solo si es necesario)

Respuestas rápidas típicas:
• ⏱️ Con contenidos listos, la web queda aprox en 5–7 días.
• 🔍 Incluye SEO base y carga rápida.
• 🎯 Landing enfocada a conversiones con WhatsApp/formulario.
• 🛒 En tienda vemos pasarela, catálogo e inventarios en la mini llamada.
• 🖼️ Con 3–5 fotos y tu logo arrancamos; yo te apoyo con textos base.

Agenda sin forzar:
• “Súper. ¿Te acomoda más en la mañana o en la tarde? 👉 Si prefieres, agenda directo aquí: {{CALENDLY_URL}}”
• Si acepta: “Hola 👋, como quedamos, mañana nos vemos para tu junta con el CEO de NeuroMind 🚀
  Para mayor comodidad puedes agendar tu cita directamente en este link:
  👉 {{CALENDLY_URL}}
  Así tendrás tu espacio confirmado y nos aseguramos de darte la atención completa 🙌.”

Usa micro-resúmenes (“Súper: landing para leads y yo me encargo de lo técnico. ¿Voy bien?”)
y termina siempre con una pregunta que haga avanzar.
`;

// ===== OpenAI =====
async function askOpenAI(history, userMessage) {
  const messages = [
    { role: 'system', content: systemPrompt.replaceAll('{{CALENDLY_URL}}', CALENDLY_URL) },
    ...history,
    { role: 'user', content: userMessage }
  ];

  const r = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    {
      model: 'gpt-3.5-turbo',
      temperature: 0.55,
      max_tokens: 420,
      messages
    },
    { headers: { Authorization: `Bearer ${OPENAI_KEY}` } }
  );

  return r.data.choices[0].message.content.trim();
}

// ===== Webhook: verificación (Meta) =====
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

// ===== Webhook: recepción de mensajes =====
app.post('/webhook', async (req, res) => {
  try {
    const msg  = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    const from = msg?.from;
    const text = msg?.text?.body?.trim();
    if (!from || !text) return res.sendStatus(200);

    const hist = memory.get(from) || [];
    let reply;

    const lower = text.toLowerCase();

    // 1) ¿Eres bot?
    if (/(eres|soy)\s+(un\s+)?bot|hablo\s+con\s+un\s+bot/.test(lower)) {
      reply = 'No, soy Erick. Te ayudo por aquí 😊 ¿Me cuentas rápido de qué trata tu negocio?';
    }
    // 2) Intención de agendar/cita explícita
    else if (/(agenda(r|la|me)|agénda(me|la)|cita|programa(r|la|me))/i.test(lower)) {
      reply =
`Hola 👋, como quedamos, mañana nos vemos para tu junta con el CEO de NeuroMind 🚀
Para mayor comodidad puedes agendar tu cita directamente en este link:
👉 ${CALENDLY_URL}

Así tendrás tu espacio confirmado y nos aseguramos de darte la atención completa 🙌.
¿Te acomoda más en la mañana o en la tarde?`;
    }
    // 3) Primer mensaje → bienvenida
    else if (hist.length === 0) {
      reply = '🙌 ¡Hola! Soy Erick de Neuromind. Gracias por escribirme. ¿Es tu primera página web o ya has tenido una?';
    }
    // 4) Flujo general con IA (sondeo libre + tono humano)
    else {
      reply = await askOpenAI(hist.slice(-12), text);
    }

    await sendWhatsApp(from, reply);

    // guardar historial (máx 12 turnos)
    hist.push({ role: 'user', content: text });
    hist.push({ role: 'assistant', content: reply });
    memory.set(from, hist.slice(-12));

    res.sendStatus(200);
  } catch (e) {
    console.error('Webhook error:', e?.response?.data || e);
    res.sendStatus(200);
  }
});

// ===== Healthcheck =====
app.get('/', (_, res) => res.send('Neuromind bot OK'));

// ===== Start =====
app.listen(PORT, () => console.log(`🤖 Bot en puerto ${PORT}`));
