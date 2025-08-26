import 'dotenv/config';
import express from 'express';
import axios from 'axios';

const app = express();
app.use(express.json());

// Variables del entorno
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'neuromind_verify';
const WA_TOKEN     = process.env.WHATSAPP_TOKEN;
const PHONE_ID     = process.env.PHONE_NUMBER_ID;
const OPENAI_KEY   = process.env.OPENAI_API_KEY;
const PORT         = process.env.PORT || 3000;

// Enviar mensaje a WhatsApp
async function sendWhatsApp(to, text) {
  const url = `https://graph.facebook.com/v20.0/${PHONE_ID}/messages`;
  await axios.post(url, {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body: text }
  }, { headers: { Authorization: `Bearer ${WA_TOKEN}` }});
}

// Preguntar a ChatGPT
async function askOpenAI(history, userMessage) {
  const systemPrompt = `
Eres Erick Damian, fundador de Neuromind. Hablas cálido, humano y directo.
Haces preguntas para entender, ayudas antes de vender y usas emojis con moderación.
Nunca digas que eres un bot. Responde corto y termina con una pregunta.
  `.trim();

  const res = await axios.post('https://api.openai.com/v1/chat/completions', {
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: systemPrompt },
      ...history,
      { role: "user", content: userMessage }
    ],
    temperature: 0.7
  }, { headers: { Authorization: `Bearer ${OPENAI_KEY}` }});

  return res.data.choices[0].message.content.trim();
}

// Memoria por cliente
const memory = new Map();

// Verificación de webhook
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === VERIFY_TOKEN) return res.status(200).send(challenge);
  res.sendStatus(403);
});

// Recepción de mensajes
app.post('/webhook', async (req, res) => {
  try {
    const entry = req.body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const msg = value?.messages?.[0];
    const from = msg?.from;
    const text = msg?.text?.body?.trim();

    if (from && text) {
      const hist = memory.get(from) || [];
      let reply;
      if (hist.length === 0) {
        reply = "¡Hola! 👋 Qué gusto saludarte. Cuéntame, ¿ya tienes página web o sería tu primera vez para hacer crecer tu negocio? 🚀";
      } else {
        reply = await askOpenAI(hist, text);
      }
      await sendWhatsApp(from, reply);
      hist.push({ role: "user", content: text });
      hist.push({ role: "assistant", content: reply });
      memory.set(from, hist.slice(-12));
    }
    res.sendStatus(200);
  } catch (e) {
    console.error(e?.response?.data || e);
    res.sendStatus(200);
  }
});

// Iniciar servidor
app.listen(PORT, () => console.log('🤖 Bot listo en puerto', PORT));
