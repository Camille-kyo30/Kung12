const axios = require("axios");

module.exports.config = {
  name: "mini",
  version: "1.0",
  hasPermssion: 0,
  credits: "Camille Uchiha 🍓",
  description: "Discute avec Mini Bot (IA)",
  commandCategory: "IA",
  usages: "[message]",
  cooldowns: 3,
  usePrefix: false,
};

module.exports.langs = {
  fr: {
    noMessage: "🎀 Écris un message après la commande !\nExemple : mini Salut, comment ça va ?",
    error: "⚠️ Une erreur est survenue avec Mini Bot :\n%1",
    quotaError: "⏳ Trop de demandes en ce moment, réessaie dans un instant.",
    quotaReached: "🚫 Quota journalier atteint (%1/%2). Réessaie demain !",
  },
};

const conversationHistory = new Map();
const quotaTracker = new Map();

const MINI_BOT_API_URL = process.env.MINI_BOT_API_URL || "https://mini-api-1-bo1d.onrender.com";
const MINI_BOT_API_KEY = process.env.MINI_BOT_API_KEY || "";
const DAILY_QUOTA_LIMIT = Number(process.env.DAILY_QUOTA_LIMIT || 200);

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function getQuota(uid) {
  const today = todayStr();
  const entry = quotaTracker.get(uid);
  if (!entry || entry.date !== today) {
    const fresh = { count: 0, date: today };
    quotaTracker.set(uid, fresh);
    return fresh;
  }
  return entry;
}

async function askMini({ api, event, message, getLang }, uid) {
  const { threadID, messageID } = event;

  if (!message) {
    return api.sendMessage(getLang("noMessage"), threadID, messageID);
  }

  const quota = getQuota(uid);
  if (quota.count >= DAILY_QUOTA_LIMIT) {
    return api.sendMessage(
      getLang("quotaReached", quota.count, DAILY_QUOTA_LIMIT),
      threadID,
      messageID
    );
  }

  api.sendTypingIndicator(threadID);

  const history = conversationHistory.get(uid) || [];

  try {
    const res = await axios.post(
      `${MINI_BOT_API_URL}/api/v1/chat`,
      { message, history, uid },
      {
        headers: {
          "Content-Type": "application/json",
          ...(MINI_BOT_API_KEY ? { "x-api-key": MINI_BOT_API_KEY } : {}),
        },
        timeout: 30000,
      }
    );

    const raw = res.data?.raw || "";

    if (!raw) {
      return api.sendMessage(getLang("error", "Réponse vide reçue."), threadID, messageID);
    }

    quota.count += 1;
    quotaTracker.set(uid, quota);

    history.push({ role: "user", content: message });
    history.push({ role: "assistant", content: raw });
    conversationHistory.set(uid, history.slice(-20));

    const sent = await api.sendMessage(
      `🎀 Mini Bot 🎀\n━━━━━━━━━\n\n${raw}\n\n📊 Quota : ${quota.count}/${DAILY_QUOTA_LIMIT}`,
      threadID,
      messageID
    );

    global.GoatBot.onReply.set(sent.messageID, {
      commandName: "mini",
      author: event.senderID,
    });
  } catch (err) {
    const status = err?.response?.status;
    if (status === 429) {
      return api.sendMessage(getLang("quotaError"), threadID, messageID);
    }
    const errMsg = err?.response?.data?.error || err.message || "Erreur inconnue";
    return api.sendMessage(getLang("error", errMsg), threadID, messageID);
  }
}

module.exports.onStart = async function ({ api, event, args, getLang }) {
  const message = args.join(" ").trim();
  const uid = event.senderID;
  return askMini({ api, event, message, getLang }, uid);
};

module.exports.onReply = async function ({ api, event, Reply, getLang }) {
  if (Reply.author && Reply.author !== event.senderID) return;

  const message = event.body?.trim();
  const uid = event.senderID;
  return askMini({ api, event, message, getLang }, uid);
};

// Filet de sécurité : détecte "mini <message>" même si le dispatcher
// n'a pas déclenché onStart (conflit de commandes sans préfixe, etc.)
module.exports.onChat = async function ({ api, event, getLang }) {
  const body = event.body?.trim();
  if (!body) return;

  const match = body.match(/^mini\s+(.+)/i);
  if (!match) return;

  const message = match[1].trim();
  const uid = event.senderID;
  return askMini({ api, event, message, getLang }, uid);
};
