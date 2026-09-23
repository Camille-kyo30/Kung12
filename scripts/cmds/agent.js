const axios = require("axios");

module.exports.config = {
  name: "agent",
  version: "2.0",
  hasPermssion: 2,
  credits: "Camille Uchiha 🍓",
  description: "Agent IA autonome pour gérer un dépôt GitHub — parle-lui naturellement",
  commandCategory: "Développement",
  usages: "<demande en langage naturel>",
  cooldowns: 5,
};

const MINI_BOT_API_URL = process.env.MINI_BOT_API_URL || "https://mini-api-r6rw.onrender.com";
const MINI_BOT_API_KEY = process.env.MINI_BOT_API_KEY || "";
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || "";
const GITHUB_API = "https://api.github.com";

const userRepo = new Map();
const conversationMemory = new Map(); // uid -> historique des actions passées (contexte)

function ghHeaders() {
  return {
    Authorization: `Bearer ${GITHUB_TOKEN}`,
    Accept: "application/vnd.github+json",
  };
}

function getRepo(uid) {
  return userRepo.get(uid) || process.env.GITHUB_DEFAULT_REPO || null;
}

function miniHeaders() {
  return {
    "Content-Type": "application/json",
    ...(MINI_BOT_API_KEY ? { "x-api-key": MINI_BOT_API_KEY } : {}),
  };
}

// ---------- Actions GitHub ----------

async function getFileContent(repo, path, ref) {
  const url = `${GITHUB_API}/repos/${repo}/contents/${encodeURIComponent(path)}${ref ? `?ref=${ref}` : ""}`;
  const res = await axios.get(url, { headers: ghHeaders() });
  const content = Buffer.from(res.data.content, "base64").toString("utf-8");
  return { content, sha: res.data.sha };
}

async function listFiles(repo, dirPath = "") {
  const res = await axios.get(
    `${GITHUB_API}/repos/${repo}/contents/${encodeURIComponent(dirPath)}`,
    { headers: ghHeaders() }
  );
  return Array.isArray(res.data) ? res.data.map((f) => `${f.type === "dir" ? "📁" : "📄"} ${f.path}`) : [];
}

async function getDefaultBranch(repo) {
  const res = await axios.get(`${GITHUB_API}/repos/${repo}`, { headers: ghHeaders() });
  return res.data.default_branch;
}

async function upsertFile(repo, path, newContent, message, branch) {
  let sha;
  try {
    const existing = await getFileContent(repo, path, branch);
    sha = existing.sha;
  } catch {
    sha = undefined;
  }

  const res = await axios.put(
    `${GITHUB_API}/repos/${repo}/contents/${encodeURIComponent(path)}`,
    {
      message,
      content: Buffer.from(newContent, "utf-8").toString("base64"),
      ...(branch ? { branch } : {}),
      ...(sha ? { sha } : {}),
    },
    { headers: ghHeaders() }
  );
  return res.data.commit?.sha?.slice(0, 7) || "ok";
}

async function createIssue(repo, title, body) {
  const res = await axios.post(
    `${GITHUB_API}/repos/${repo}/issues`,
    { title, body },
    { headers: ghHeaders() }
  );
  return res.data.html_url;
}

async function createBranch(repo, newBranch, fromBranch) {
  const base = fromBranch || (await getDefaultBranch(repo));
  const refRes = await axios.get(
    `${GITHUB_API}/repos/${repo}/git/ref/heads/${base}`,
    { headers: ghHeaders() }
  );
  const sha = refRes.data.object.sha;

  await axios.post(
    `${GITHUB_API}/repos/${repo}/git/refs`,
    { ref: `refs/heads/${newBranch}`, sha },
    { headers: ghHeaders() }
  );
  return newBranch;
}

async function createPullRequest(repo, head, base, title, body) {
  const targetBase = base || (await getDefaultBranch(repo));
  const res = await axios.post(
    `${GITHUB_API}/repos/${repo}/pulls`,
    { head, base: targetBase, title, body },
    { headers: ghHeaders() }
  );
  return res.data.html_url;
}

// ---------- Appel IA ----------

async function askAI(systemPrompt, userMessage) {
  const res = await axios.post(
    `${MINI_BOT_API_URL}/api/v1/agent`,
    { systemPrompt, message: userMessage },
    { headers: miniHeaders(), timeout: 30000 }
  );
  return res.data?.raw || "";
}

function parseJsonAction(raw) {
  const cleaned = raw.replace(/^```json\n?/, "").replace(/^```\n?/, "").replace(/```$/, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

// ---------- Boucle agent autonome (ReAct) ----------

async function runAgentLoop({ api, event }, uid, task) {
  const { threadID, messageID } = event;
  const repo = getRepo(uid);

  if (!repo) {
    return api.sendMessage(
      "🤖 Je n'ai pas encore de dépôt configuré. Dis-moi par exemple :\n\"utilise le dépôt Camille-kyo30/Mini-Api-\"",
      threadID,
      messageID
    );
  }

  const history = conversationMemory.get(uid) || [];
  const maxSteps = 6;
  let steps = 0;

  const baseSystemPrompt = `Tu es un agent IA autonome et compétent qui gère le dépôt GitHub "${repo}" pour l'utilisateur.
Tu comprends le langage naturel et tu décides toi-même des actions à effectuer pour accomplir la demande.
Réponds UNIQUEMENT en JSON valide, une seule action à la fois, sans texte autour, parmi :
{"action":"list_files","path":""}
{"action":"read_file","path":"..."}
{"action":"write_file","path":"...","content":"...","message":"message de commit","branch":null}
{"action":"create_issue","title":"...","body":"..."}
{"action":"create_branch","name":"...","from":null}
{"action":"create_pr","head":"...","base":null,"title":"...","body":"..."}
{"action":"final_answer","text":"réponse claire et humaine à donner à l'utilisateur"}

Règles :
- Pour "write_file", génère TOUJOURS le contenu complet et fonctionnel du fichier dans "content".
- N'utilise "branch" que si l'utilisateur a demandé explicitement de travailler sur une branche spécifique, sinon laisse null (branche par défaut).
- Termine TOUJOURS par "final_answer" avec une explication claire de ce que tu as fait.
- Sois concis dans "final_answer", en français, ton naturel et amical.`;

  for (steps = 0; steps < maxSteps; steps++) {
    api.sendTypingIndicator(threadID);

    const systemPrompt = `${baseSystemPrompt}\n\nDemande de l'utilisateur : ${task}\n\nActions déjà effectuées cette session :\n${JSON.stringify(history.slice(-10), null, 2)}`;

    const raw = await askAI(systemPrompt, task);
    const action = parseJsonAction(raw);

    if (!action || !action.action) {
      return api.sendMessage(
        `🤖 Mini Bot 🤖\n━━━━━━━━━\n\nJ'ai eu du mal à formuler une action claire. Peux-tu reformuler ta demande ?`,
        threadID,
        messageID
      );
    }

    if (action.action === "final_answer") {
      history.push({ task, summary: action.text });
      conversationMemory.set(uid, history.slice(-15));
      return api.sendMessage(
        `🤖 Mini Bot 🤖\n━━━━━━━━━\n\n${action.text}`,
        threadID,
        messageID
      );
    }

    try {
      let result;
      switch (action.action) {
        case "list_files":
          result = (await listFiles(repo, action.path || "")).join("\n");
          break;
        case "read_file":
          result = (await getFileContent(repo, action.path)).content.slice(0, 1500);
          break;
        case "write_file":
          result = `Commit ${await upsertFile(repo, action.path, action.content, action.message || "Mise à jour via agent", action.branch)}`;
          break;
        case "create_issue":
          result = `Issue créée : ${await createIssue(repo, action.title, action.body)}`;
          break;
        case "create_branch":
          result = `Branche "${await createBranch(repo, action.name, action.from)}" créée`;
          break;
        case "create_pr":
          result = `PR créée : ${await createPullRequest(repo, action.head, action.base, action.title, action.body)}`;
          break;
        default:
          result = `Action inconnue : ${action.action}`;
      }
      history.push({ action: action.action, params: action, result });
    } catch (err) {
      const errMsg = err?.response?.data?.message || err.message;
      history.push({ action: action.action, params: action, error: errMsg });
    }
  }

  return api.sendMessage(
    `🤖 Mini Bot 🤖\n━━━━━━━━━\n\nJ'ai effectué plusieurs actions mais je n'ai pas pu conclure clairement. Peux-tu vérifier sur GitHub ou me redonner plus de précisions ?`,
    threadID,
    messageID
  );
}

// ---------- Détection "changer de dépôt" en langage naturel ----------

function detectRepoChange(text) {
  const match = text.match(/(?:utilise|dépôt|repo|repository)\s*[:\s]*([\w.-]+\/[\w.-]+)/i);
  return match ? match[1] : null;
}

// ---------- Commande principale ----------

module.exports.onStart = async function ({ api, event, args }) {
  const { threadID, messageID, senderID } = event;
  const text = args.join(" ").trim();

  if (!GITHUB_TOKEN) {
    return api.sendMessage("⚠️ GITHUB_TOKEN n'est pas configuré.", threadID, messageID);
  }

  if (!text) {
    return api.sendMessage(
      "🤖 Salut, je suis ton agent IA GitHub !\n\nParle-moi normalement, par exemple :\n" +
      "• \"utilise le dépôt Camille-kyo30/Mini-Api-\"\n" +
      "• \"liste les fichiers du projet\"\n" +
      "• \"montre-moi le contenu de config.js\"\n" +
      "• \"ajoute un endpoint /ping qui renvoie pong\"\n" +
      "• \"crée une issue pour le bug du TTS\"\n" +
      "• \"crée une branche fix-tts et corrige le paramètre voice dedans\"",
      threadID,
      messageID
    );
  }

  const repoMention = detectRepoChange(text);
  if (repoMention) {
    userRepo.set(senderID, repoMention);
    return api.sendMessage(`✅ D'accord, je travaille maintenant sur ${repoMention}. Que veux-tu que je fasse ?`, threadID, messageID);
  }

  return runAgentLoop({ api, event }, senderID, text);
};

module.exports.onReply = async function ({ api, event, Reply }) {
  if (Reply.author && Reply.author !== event.senderID) return;
  const text = event.body?.trim();
  if (!text) return;

  const repoMention = detectRepoChange(text);
  if (repoMention) {
    userRepo.set(event.senderID, repoMention);
    return api.sendMessage(`✅ D'accord, je travaille maintenant sur ${repoMention}. Que veux-tu que je fasse ?`, event.threadID, event.messageID);
  }

  return runAgentLoop({ api, event }, event.senderID, text);
};
