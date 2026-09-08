const axios = require("axios");
const fs = require("fs");
const path = require("path");
const os = require("os");

module.exports.config = {
  name: "mini",
  version: "1.3",
  hasPermssion: 0,
  credits: "Camille Uchiha 🍓",
  description: "Discute avec Mini Bot (IA) — texte, vocal et analyse d'image",
  commandCategory: "IA",
  usages: "[message] | vocal [message] | (envoyer une photo)",
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

async function askMini({ api, event, message, getLang }, uid) {
  const { threadID, messageID } = event;

  if (!message) {
    return api.sendMessage(getLang("noMessage"), threadID, messageID);
  }

  const quota = checkQuota(uid);
  if (!quota) {
    const q = getQuota(uid);
    return api.sendMessage(getLang("quotaReached", q.count, DAILY_QUOTA_LIMIT), threadID, messageID);
  }

  api.sendTypingIndicator(threadID);

  const history = conversationHistory.get(uid) || [];

  try {
    const res = await axios.post(
      `${MINI_BOT_API_URL}/api/v1/chat`,
      { message, history, uid },
      { headers: authHeaders(), timeout: 30000 }
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

    global.GoatBot.onReply.set(sent.messageID, { commandName: "mini", author: event.senderID });
  } catch (err) {
    const status = err?.response?.status;
    if (status === 429) return api.sendMessage(getLang("quotaError"), threadID, messageID);
    const errMsg = err?.response?.data?.error || err.message || "Erreur inconnue";
    return api.sendMessage(getLang("error", errMsg), threadID, messageID);
  }
}

async function askMiniVoice({ api, event, message, getLang }, uid) {
  const { threadID, messageID } = event;

  if (!message) {
    return api.sendMessage(getLang("noMessage"), threadID, messageID);
  }

  const quota = checkQuota(uid);
  if (!quota) {
    const q = getQuota(uid);
    return api.sendMessage(getLang("quotaReached", q.count, DAILY_QUOTA_LIMIT), threadID, messageID);
  }

  api.sendTypingIndicator(threadID);

  const history = conversationHistory.get(uid) || [];
  let filePath;

  try {
    const res = await axios.post(
      `${MINI_BOT_API_URL}/api/v1/chat/voice`,
      { message, history, uid },
      { headers: authHeaders(), timeout: 45000 }
    );

    const raw = res.data?.raw || "";
    const audioBase64 = res.data?.audio || "";

    if (!raw || !audioBase64) {
      return api.sendMessage(getLang("error", "Réponse vocale vide reçue."), threadID, messageID);
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
    if (status === 429) return api.sendMessage(getLang("quotaError"), threadID, messageID);
    const errMsg = err?.response?.data?.error || err.message || "Erreur inconnue";
    return api.sendMessage(getLang("error", errMsg), threadID, messageID);
  } finally {
    if (filePath) fs.unlink(filePath, () => {});
  }
}

async function askMiniImage({ api, event, message, imageUrl, getLang }, uid) {
  const { threadID, messageID } = event;

  const quota = checkQuota(uid);
  if (!quota) {
    const q = getQuota(uid);
    return api.sendMessage(getLang("quotaReached", q.count, DAILY_QUOTA_LIMIT), threadID, messageID);
  }

  api.sendTypingIndicator(threadID);

  try {
    const res = await axios.post(
      `${MINI_BOT_API_URL}/api/v1/chat/image`,
      { message, imageUrl, uid },
      { headers: authHeaders(), timeout: 30000 }
    );

    const raw = res.data?.raw || "";
    if (!raw) {
      return api.sendMessage(getLang("error", "Réponse vide reçue."), threadID, messageID);
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
    if (status === 429) return api.sendMessage(getLang("quotaError"), threadID, messageID);
    const errMsg = err?.response?.data?.error || err.message || "Erreur inconnue";
    return api.sendMessage(getLang("error", errMsg), threadID, messageID);
  }
}

module.exports.onStart = async function ({ api, event, args, getLang }) {
  const uid = event.senderID;
  const photoUrl = findPhotoUrl(event, null);

  if (photoUrl) {
    const message = args.join(" ").trim() || "Décris cette image en détail.";
    return askMiniImage({ api, event, message, imageUrl: photoUrl, getLang }, uid);
  }

  const first = (args[0] || "").toLowerCase();
  if (first === "vocal") {
    const message = args.slice(1).join(" ").trim();
    return askMiniVoice({ api, event, message, getLang }, uid);
  }

  const message = args.join(" ").trim();
  return askMini({ api, event, message, getLang }, uid);
};

module.exports.onReply = async function ({ api, event, Reply, getLang }) {
  if (Reply.author && Reply.author !== event.senderID) return;

  const uid = event.senderID;
  const photoUrl = findPhotoUrl(event, Reply);

  if (photoUrl) {
    const message = event.body?.trim() || "Décris cette image en détail.";
    return askMiniImage({ api, event, message, imageUrl: photoUrl, getLang }, uid);
  }

  const voiceMatch = event.body?.trim().match(/^vocal\s+(.+)/i);
  if (voiceMatch) {
    return askMiniVoice({ api, event, message: voiceMatch[1].trim(), getLang }, uid);
  }

  const message = event.body?.trim();
  return askMini({ api, event, message, getLang }, uid);
};

module.exports.onChat = async function ({ api, event, getLang }) {
  const body = event.body?.trim() || "";
  const photoUrl = findPhotoUrl(event, null);
  const uid = event.senderID;

  if (photoUrl) {
    return askMiniImage({ api, event, message: body, imageUrl: photoUrl, getLang }, uid);
  }

  if (!body) return;

  const voiceMatch = body.match(/^mini\s+vocal\s+(.+)/i);
  if (voiceMatch) {
    return askMiniVoice({ api, event, message: voiceMatch[1].trim(), getLang }, uid);
  }

  const match = body.match(/^mini\s+(.+)/i);
  if (!match) return;

  return askMini({ api, event, message: match[1].trim(), getLang }, uid);
};
