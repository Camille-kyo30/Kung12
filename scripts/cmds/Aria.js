const axios = require("axios");

const API_URL = "https://christus-s-apis.vercel.app/api/na/ai/gemini-v2";

// ✏️ Change ce texte pour changer la personnalité du bot
const PERSONA =
  "Tu es Mini bot 🎀, un adorable mini bot créé par Camille Uchiha. " +
  "Tu parles avec gentillesse, tu utilises quelques emojis et tu réponds en 2-3 phrases maximum. " +
  "Tu réponds toujours dans la langue de l'utilisateur. " +
  "Si on te demande qui t'a créé, tu réponds : Camille Uchiha.";

// Mémoire courte par utilisateur (les 6 derniers échanges)
const history = new Map();
const MAX_HISTORY = 6;

function buildPrompt(uid, question, name) {
  const past = (history.get(uid) || [])
    .map(h => `Utilisateur: ${h.q}\nMini bot: ${h.a}`)
    .join("\n");
  return (
    `${PERSONA}\n` +
    `Tu parles avec ${name}. Appelle-le/la par son prénom (${name}) dans tes réponses, de façon naturelle.\n\n` +
    (past ? `Conversation précédente :\n${past}\n\n` : "") +
    `Utilisateur: ${question}\nMini bot:`
  );
}

async function request(prompt) {
  const { data } = await axios.post(
    API_URL,
    { prompt },
    {
      timeout: 45000,
      headers: { "Content-Type": "application/json", "User-Agent": "Mozilla/5.0" }
    }
  );
  return data;
}

// Cherche le texte de la réponse, même si l'API l'imbrique dans un objet
function extractText(v, depth = 0) {
  if (v == null || depth > 5) return "";
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.map(x => extractText(x, depth + 1)).filter(Boolean).join("\n");
  if (typeof v === "object") {
    const keys = ["response", "answer", "result", "text", "content", "message", "output", "reply", "data"];
    for (const k of keys) {
      if (k in v) {
        const t = extractText(v[k], depth + 1);
        if (t && !/^Response generated successfully$/i.test(t)) return t;
      }
    }
  }
  return "";
}

async function askAria(question, uid, name) {
  const prompt = buildPrompt(uid, question, name);
  let data;
  try {
    data = await request(prompt);
  } catch (e) {
    console.error("[aria] 1er essai :", e.response?.status, JSON.stringify(e.response?.data));
    data = await request(prompt); // 2e essai
  }

  console.log("[aria] réponse API :", JSON.stringify(data).slice(0, 500));
  const raw = extractText(data);
  if (!raw) throw new Error("Réponse vide de l'API");

  // Messenger n'affiche pas le markdown
  const text = String(raw).replace(/\*\*/g, "").replace(/^#{1,6}\s*/gm, "").trim();

  const list = history.get(uid) || [];
  list.push({ q: question, a: text });
  history.set(uid, list.slice(-MAX_HISTORY));
  return text;
}

function deco(text) {
  return `🎀 Mini bot 🎀\n━━━━━━━━━━━━━━\n${text}\n━━━━━━━━━━━━━━`;
}

async function handle({ message, event, question, commandName, usersData }) {
  try {
    let name = "l'utilisateur";
    try {
      const full = await usersData.getName(event.senderID);
      if (full) name = full.split(" ")[0]; // prénom
    } catch (_) {}
    const answer = await askAria(question, event.senderID, name);
    message.reply(deco(answer), (err, info) => {
      if (err || !info) return;
      global.GoatBot.onReply.set(info.messageID, {
        commandName,
        author: event.senderID,
        messageID: info.messageID
      });
    });
  } catch (e) {
    console.error("[aria]", e.response?.status, e.code, e.message);
    message.reply(
      deco(`❌ Erreur : ${e.response?.status || e.code || e.message}\nL'API ne répond pas, réessaie plus tard.`)
    );
  }
}

module.exports = {
  config: {
    name: "aria",
    aliases: ["bot", "mini"],
    version: "1.1.0",
    author: "Camille Uchiha",
    countDown: 3,
    role: 0,
    description: {
      en: "Mini bot créé par Camille Uchiha – réponds à ses messages pour continuer la discussion"
    },
    category: "ai",
    guide: {
      en: "{pn} <ton message>"
    }
  },

  onStart: async function ({ message, event, args, commandName, usersData }) {
    const question = args.join(" ").trim();
    if (!question)
      return message.reply(deco("❓ Écris un message. Exemple : aria salut !"));
    await handle({ message, event, question, commandName, usersData });
  },

  // Continuer la conversation en répondant au message du bot
  onReply: async function ({ message, event, Reply, commandName, usersData }) {
    if (event.senderID !== Reply.author) return;
    const question = (event.body || "").trim();
    if (!question) return;
    await handle({ message, event, question, commandName, usersData });
  }
};
