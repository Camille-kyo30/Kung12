const axios = require("axios");
const fs = require("fs");
const path = require("path");
const os = require("os");

module.exports.config = {
  name: "mini",
  version: "1.6",
  hasPermssion: 0,
  credits: "Camille Uchiha 🍓",
  description: "Discute avec Mini Bot (IA) — texte, vocal et analyse d'image",
  commandCategory: "IA",
  usages: "[message] | vocal [message] | (reply sur une photo)",
  cooldowns: 3,
  usePrefix: false,
};

const conversationHistory = new Map();
const quotaTracker = new Map();
const nameCache = new Map();

const MINI_BOT_API_URL = process.env.MINI_BOT_API_URL || "https://mini-api-r6rw.onrender.com";
const MINI_BOT_API_KEY = process.env.MINI_BOT_API_KEY || "";
const DAILY_QUOTA_LIMIT = Number(process.env.DAILY_QUOTA_LIMIT || 200);

const MSG = {
  noMessage: "🎀 Écris un message après la commande !\nExemple : mini Salut, comment ça va ?",
  error: (detail) => `⚠️ Une erreur est survenue avec Mini Bot :\n${detail}`,
  quotaError: "⏳ Trop de demandes en ce moment, réessaie dans un instant.",
  quotaReached: (count, limit) => `🚫 Quota journalier atteint (${count}/${limit}). Réessaie demain !`,
};

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

function checkQuota(uid) {
  const quota = getQuota(uid);
  if (quota.count >= DAILY_QUOTA_LIMIT) return null;
  return quota;
}

function authHeaders() {
  return {
    "Content-Type": "application/json",
    ...(MINI_BOT_API_KEY ? { "x-api-key": MINI_BOT_API_KEY } : {}),
  };
}

/** Récupère (et met en cache) le prénom de l'utilisateur pour que l'IA puisse l'appeler par son nom */
async function resolveName(api, uid) {
  if (nameCache.has(uid)) return nameCache.get(uid);
  try {
    const info = await api.getUserInfo(uid);
    const name = info?.[uid]?.name || "";
    nameCache.set(uid, name);
    return name;
  } catch {
    return "";
  }
}

/** Cherche une photo uniquement sur le message direct ou le message cité (reply) */
function findPhotoUrl(event, Reply) {
  const sources = [
    event?.attachments,
    event?.messageReply?.attachments,
    Reply?.attachments,
    Reply?.messageReply?.attachments,
  ];

  for (const list of sources) {
    if (Array.isArray(list)) {
      const photo = list.find((a) => a?.type === "photo");
      if (photo?.url) return photo.url;
    }
  }

  return null;
}

async function askMini({ api, event }, uid) {
  const { threadID, messageID } = event;
  const message = event.__miniMessage;

  if (!message) {
    return api.sendMessage(MSG.noMessage, threadID, messageID);
  }

  const quota = checkQuota(uid);
  if (!quota) {
    const q = getQuota(uid);
    return api.sendMessage(MSG.quotaReached(q.count, DAILY_QUOTA_LIMIT), threadID, messageID);
  }

  api.sendTypingIndicator(threadID);
  const name = await resolveName(api, uid);

  const history = conversationHistory.get(uid) || [];

  try {
    const res = await axios.post(
      `${MINI_BOT_API_URL}/api/v1/chat`,
      { message, history, uid, name },
      { headers: authHeaders(), timeout: 30000 }
    );

    const raw = res.data?.raw || "";
    if (!raw) {
      return api.sendMessage(MSG.error("Réponse vide reçue."), threadID, messageID);
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

    global.GoatBot.onReply.set(sent.messageID, { commandName: "mini", author: event.senderID });
  } catch (err) {
    const status = err?.response?.status;
    if (status === 429) return api.sendMessage(MSG.quotaError, threadID, messageID);
    const errMsg = err?.response?.data?.error || err.message || "Erreur inconnue";
    return api.sendMessage(MSG.error(errMsg), threadID, messageID);
  }
}

async function askMiniVoice({ api, event }, uid) {
  const { threadID, messageID } = event;
  const message = event.__miniMessage;

  if (!message) {
    return api.sendMessage(MSG.noMessage, threadID, messageID);
  }

  const quota = checkQuota(uid);
  if (!quota) {
    const q = getQuota(uid);
    return api.sendMessage(MSG.quotaReached(q.count, DAILY_QUOTA_LIMIT), threadID, messageID);
  }

  api.sendTypingIndicator(threadID);
  const name = await resolveName(api, uid);

  const history = conversationHistory.get(uid) || [];
  let filePath;

  try {
    const res = await axios.post(
      `${MINI_BOT_API_URL}/api/v1/chat/voice`,
      { message, history, uid, name },
      { headers: authHeaders(), timeout: 45000 }
    );

    const raw = res.data?.raw || "";
    const audioBase64 = res.data?.audio || "";

    if (!raw || !audioBase64) {
      return api.sendMessage(MSG.error("Réponse vocale vide reçue."), threadID, messageID);
    }

    quota.count += 1;
    quotaTracker.set(uid, quota);

    history.push({ role: "user", content: message });
    history.push({ role: "assistant", content: raw });
    conversationHistory.set(uid, history.slice(-20));

    filePath = path.join(os.tmpdir(), `mini_${uid}_${Date.now()}.mp3`);
    fs.writeFileSync(filePath, Buffer.from(audioBase64, "base64"));

    const sent = await api.sendMessage(
      {
        body: `🎀 Mini Bot 🎀\n━━━━━━━━━\n\n${raw}\n\n📊 Quota : ${quota.count}/${DAILY_QUOTA_LIMIT}`,
        attachment: fs.createReadStream(filePath),
      },
      threadID,
      messageID
    );

    global.GoatBot.onReply.set(sent.messageID, { commandName: "mini", author: event.senderID });
  } catch (err) {
    const status = err?.response?.status;
    if (status === 429) return api.sendMessage(MSG.quotaError, threadID, messageID);
    const errMsg = err?.response?.data?.error || err.message || "Erreur inconnue";
    return api.sendMessage(MSG.error(errMsg), threadID, messageID);
  } finally {
    if (filePath) fs.unlink(filePath, () => {});
  }
}

async function askMiniImage({ api, event }, uid) {
  const { threadID, messageID } = event;
  const message = event.__miniMessage;
  const imageUrl = event.__miniImageUrl;

  const quota = checkQuota(uid);
  if (!quota) {
    const q = getQuota(uid);
    return api.sendMessage(MSG.quotaReached(q.count, DAILY_QUOTA_LIMIT), threadID, messageID);
  }

  api.sendTypingIndicator(threadID);
  const name = await resolveName(api, uid);

  try {
    const res = await axios.post(
      `${MINI_BOT_API_URL}/api/v1/chat/image`,
      { message, imageUrl, uid, name },
      { headers: authHeaders(), timeout: 30000 }
    );

    const raw = res.data?.raw || "";
    if (!raw) {
      return api.sendMessage(MSG.error("Réponse vide reçue."), threadID, messageID);
    }

    quota.count += 1;
    quotaTracker.set(uid, quota);

    const sent = await api.sendMessage(
      `🎀 Mini Bot 🎀\n━━━━━━━━━\n\n${raw}\n\n📊 Quota : ${quota.count}/${DAILY_QUOTA_LIMIT}`,
      threadID,
      messageID
    );

    global.GoatBot.onReply.set(sent.messageID, { commandName: "mini", author: event.senderID });
  } catch (err) {
    const status = err?.response?.status;
    if (status === 429) return api.sendMessage(MSG.quotaError, threadID, messageID);
    const errMsg = err?.response?.data?.error || err.message || "Erreur inconnue";
    return api.sendMessage(MSG.error(errMsg), threadID, messageID);
  }
}

module.exports.onStart = async function ({ api, event, args }) {
  const uid = event.senderID;
  const photoUrl = findPhotoUrl(event, null);

  if (photoUrl) {
    event.__miniMessage = args.join(" ").trim() || "Décris cette image en détail.";
    event.__miniImageUrl = photoUrl;
    return askMiniImage({ api, event }, uid);
  }

  const first = (args[0] || "").toLowerCase();
  if (first === "vocal") {
    event.__miniMessage = args.slice(1).join(" ").trim();
    return askMiniVoice({ api, event }, uid);
  }

  event.__miniMessage = args.join(" ").trim();
  return askMini({ api, event }, uid);
};

module.exports.onReply = async function ({ api, event, Reply }) {
  if (Reply.author && Reply.author !== event.senderID) return;

  const uid = event.senderID;
  const photoUrl = findPhotoUrl(event, Reply);

  if (photoUrl) {
    event.__miniMessage = event.body?.trim() || "Décris cette image en détail.";
    event.__miniImageUrl = photoUrl;
    return askMiniImage({ api, event }, uid);
  }

  const voiceMatch = event.body?.trim().match(/^vocal\s+(.+)/i);
  if (voiceMatch) {
    event.__miniMessage = voiceMatch[1].trim();
    return askMiniVoice({ api, event }, uid);
  }

  event.__miniMessage = event.body?.trim();
  return askMini({ api, event }, uid);
};

/** Uniquement déclenché si le message commence par "mini" — pas d'analyse automatique de toute photo */
module.exports.onChat = async function ({ api, event }) {
  const body = event.body?.trim() || "";
  const uid = event.senderID;

  if (!body) return;

  const miniMatch = body.match(/^mini(?:\s+(.*))?$/i);
  if (!miniMatch) return;

  const rest = (miniMatch[1] || "").trim();
  const photoUrl = findPhotoUrl(event, null);

  if (photoUrl) {
    event.__miniMessage = rest || "Décris cette image en détail.";
    event.__miniImageUrl = photoUrl;
    return askMiniImage({ api, event }, uid);
  }

  const voiceMatch = rest.match(/^vocal\s+(.+)/i);
  if (voiceMatch) {
    event.__miniMessage = voiceMatch[1].trim();
    return askMiniVoice({ api, event }, uid);
  }

  if (!rest) return;

  event.__miniMessage = rest;
  return askMini({ api, event }, uid);
};
