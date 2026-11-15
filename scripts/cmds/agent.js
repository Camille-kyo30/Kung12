const axios = require("axios");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { execFile } = require("child_process");

/*
  🎀 Mini bot 🎀 — Agent IA sans clé
  Tu lui parles normalement, il travaille tout seul sur le dossier du bot (ton fork cloné) :
  il lit, modifie, enregistre et envoie sur GitHub avec git. Aucune clé GitHub dans le bot :
  il utilise l'accès git déjà configuré sur ton serveur. IA : API Christus gemini-v2 (sans clé).
*/

const AI_URL = process.env.MINI_BOT_API_URL || "https://christus-s-apis.vercel.app/api/na/ai/gemini-v2";
const REPO_DIR = path.resolve(process.env.REPO_DIR || process.cwd());
const MAX_STEPS = 8;
const MAX_WRITES = 3;          // fichiers modifiés au maximum par demande
const MAX_FILE_CHARS = 20000;  // taille maximale d'un fichier écrit
const READ_CHARS = 3500;       // lu par morceau
const MAX_LEN = 1800;

const memory = new Map(); // uid -> résumés des demandes passées

const SENSITIVE = [
  /(^|\/)\.env(\..*)?$/i, /(^|\/)account\.txt$/i, /(^|\/)config\.json$/i, /(^|\/)fbstate.*$/i,
  /(^|\/)appstate.*\.json$/i, /(^|\/)cookies?.*\.(json|txt)$/i, /\.(pem|key|p12)$/i, /(^|\/)\.code-live\.json$/i
];
const isSensitive = rel => SENSITIVE.some(re => re.test(rel));

/* ───────────── Outils de base ───────────── */

function chunk(text, size = MAX_LEN) {
  const parts = [];
  let rest = String(text);
  while (rest.length > size) {
    let cut = rest.lastIndexOf("\n", size);
    if (cut < size / 2) cut = size;
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n/, "");
  }
  parts.push(rest);
  return parts;
}

function cleanForMessenger(t) {
  return String(t).replace(/\*\*(.+?)\*\*/g, "$1").replace(/^#{1,6}\s*/gm, "").replace(/`{3}[a-z]*\n?/gi, "").trim();
}

function extractText(d) {
  if (d == null) return "";
  if (typeof d === "string") return d;
  if (Array.isArray(d)) return d.map(extractText).filter(Boolean).join("\n");
  if (typeof d === "object") {
    for (const k of ["response", "result", "answer", "text", "message", "content", "data", "output", "reply"]) {
      const v = extractText(d[k]);
      if (v) return v;
    }
  }
  return "";
}

async function askAI(prompt) {
  let lastErr;
  for (let i = 0; i < 2; i++) {
    try {
      const res = await axios.post(AI_URL, { prompt }, { timeout: 45000, headers: { "Content-Type": "application/json" } });
      const text = extractText(res.data).trim();
      if (text) return text;
      lastErr = new Error("Réponse vide de l'API");
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

// Premier objet JSON équilibré dans la réponse de l'IA (même entouré de texte ou de ```json)
function parseAction(raw) {
  const s = String(raw);
  for (let start = s.indexOf("{"); start !== -1; start = s.indexOf("{", start + 1)) {
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < s.length; i++) {
      const c = s[i];
      if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true;
      else if (c === "{") depth++;
      else if (c === "}" && --depth === 0) {
        try { const o = JSON.parse(s.slice(start, i + 1)); if (o && o.action) return o; } catch (_) {}
        break;
      }
    }
  }
  return null;
}

function git(args) {
  return new Promise(resolve => {
    execFile("git", args, { cwd: REPO_DIR, timeout: 60000, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } }, (err, stdout, stderr) => {
      resolve({ ok: !err, out: String(stdout || "").trim(), err: String(stderr || (err && err.message) || "").trim() });
    });
  });
}
const maskUrl = t => String(t).replace(/(https?:\/\/)[^@\s/]+@/g, "$1***@");

// Chemin sûr : toujours à l'intérieur du dossier du bot, jamais .git / node_modules / fichier sensible
function safePath(rel, { forWrite } = {}) {
  if (typeof rel !== "string" || !rel.trim() || rel.includes("\0")) throw new Error("chemin invalide");
  const full = path.resolve(REPO_DIR, rel.replace(/^[\\/]+/, ""));
  const r = path.relative(REPO_DIR, full).split(path.sep).join("/");
  if (!r || r.startsWith("..") || path.isAbsolute(r)) throw new Error("chemin hors du dossier du bot");
  if (/(^|\/)(\.git|node_modules)(\/|$)/.test(r)) throw new Error("dossier protégé");
  if (isSensitive(r)) throw new Error("fichier sensible (mots de passe/config) : je n'y touche pas");
  if (forWrite && /\.bak$/.test(r)) throw new Error("fichier de sauvegarde");
  return { full, rel: r };
}

function maskSecrets(code) {
  return code.replace(/((?:api[_-]?key|apikey|token|secret|password|passwd|authorization)["']?\s*[:=]\s*["'`])([^"'`\n]{8,})(["'`])/gi, "$1***masqué***$3");
}

function syntaxProblem(rel, code) {
  if (!/\.js$/.test(rel)) return null;
  try { new vm.Script(code, { filename: rel }); return null; } catch (e) { return String(e.message).split("\n")[0]; }
}

/* ───────────── Actions que l'agent peut choisir ───────────── */

const ACTIONS = {
  async list_files(a) {
    const { full, rel } = a.path ? safePath(a.path) : { full: REPO_DIR, rel: "" };
    const items = fs.readdirSync(full, { withFileTypes: true })
      .filter(d => d.name !== ".git" && d.name !== "node_modules" && !isSensitive(d.name))
      .map(d => `${d.isDirectory() ? "📁" : "📄"} ${rel ? rel + "/" : ""}${d.name}`);
    return items.slice(0, 80).join("\n") + (items.length > 80 ? `\n… ${items.length - 80} autres` : "");
  },

  async read_file(a) {
    const { full, rel } = safePath(a.path);
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) throw new Error(`« ${rel} » n'existe pas`);
    const code = maskSecrets(fs.readFileSync(full, "utf8"));
    const off = Math.max(parseInt(a.offset, 10) || 0, 0);
    const part = code.slice(off, off + READ_CHARS);
    return `${rel} (${code.length} caractères, de ${off} à ${off + part.length})\n${part}${off + READ_CHARS < code.length ? `\n[… suite : offset ${off + READ_CHARS}]` : ""}`;
  },

  async write_file(a, run) {
    const { full, rel } = safePath(a.path, { forWrite: true });
    if (typeof a.content !== "string" || !a.content.trim()) throw new Error("contenu vide");
    if (a.content.length > MAX_FILE_CHARS) throw new Error(`fichier trop long (max ${MAX_FILE_CHARS} caractères)`);
    if (!run.written.has(rel) && run.written.size >= MAX_WRITES) throw new Error(`limite atteinte : ${MAX_WRITES} fichiers par demande`);
    const bad = syntaxProblem(rel, a.content);
    if (bad) throw new Error(`le code a une erreur de syntaxe (${bad}) : corrige-le et renvoie le fichier complet`);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    const existed = fs.existsSync(full);
    if (existed) fs.copyFileSync(full, `${full}.bak`);
    fs.writeFileSync(full, a.content.replace(/\s*$/, "\n"), "utf8");
    run.written.add(rel);
    return `${existed ? "modifié" : "créé"} : ${rel} (syntaxe vérifiée${/\.js$/.test(rel) ? "" : " : non applicable"})`;
  },

  async git_status() {
    const r = await git(["status", "--short", "-b"]);
    if (!r.ok) throw new Error(maskUrl(r.err));
    return r.out.split("\n").filter(l => !isSensitive(l.slice(3))).join("\n") || "rien à signaler";
  },

  async git_diff(a) {
    if (a.path) safePath(a.path);
    const r = await git(a.path ? ["diff", "--", a.path] : ["diff", "--stat"]);
    if (!r.ok) throw new Error(maskUrl(r.err));
    return (r.out || "aucune différence").slice(0, 3000);
  },

  async git_log(a) {
    const n = Math.min(Math.max(parseInt(a.count, 10) || 5, 1), 15);
    const r = await git(["log", `-${n}`, "--pretty=%h %s (%cr)"]);
    if (!r.ok) throw new Error(maskUrl(r.err));
    return r.out || "aucun commit";
  },

  async git_pull() {
    const dirty = (await git(["status", "--porcelain"])).out.split("\n").filter(Boolean);
    if (dirty.length) throw new Error("des changements ne sont pas encore envoyés : fais d'abord git_push");
    const r = await git(["pull", "--ff-only"]);
    if (!r.ok) throw new Error(maskUrl(r.err).split("\n").slice(-2).join(" "));
    return r.out.split("\n").slice(-4).join("\n");
  },

  async git_push(a) {
    const msg = String(a.message || "Mise à jour par l'agent Mini bot").replace(/[\r\n]+/g, " ").replace(/["`$\\]/g, "").slice(0, 100);
    await git(["add", "-A"]);
    const staged = (await git(["diff", "--cached", "--name-only"])).out.split("\n").filter(Boolean);
    const blocked = staged.filter(f => isSensitive(f) || /\.bak$/.test(f));
    for (const f of blocked) await git(["reset", "-q", "--", f]);
    const left = (await git(["diff", "--cached", "--name-only"])).out.split("\n").filter(Boolean);
    if (left.length) {
      const c = await git(["-c", "user.name=Mini bot", "-c", "user.email=minibot@users.noreply.github.com", "commit", "-m", msg]);
      if (!c.ok) throw new Error(maskUrl(c.err).slice(0, 200));
    }
    const branch = (await git(["rev-parse", "--abbrev-ref", "HEAD"])).out;
    let p = await git(["push"]);
    if (!p.ok && /no upstream/i.test(p.err)) p = await git(["push", "-u", "origin", branch]);
    if (!p.ok) {
      const e = maskUrl(p.err);
      if (/Authentication|Permission denied|could not read Username|403|401/i.test(e)) throw new Error("GitHub refuse l'accès : le dossier du bot n'est pas connecté à ton compte (les changements sont enregistrés localement)");
      if (/rejected|non-fast-forward|fetch first/i.test(e)) throw new Error("GitHub a des changements que tu n'as pas : fais git_pull d'abord (enregistré localement)");
      throw new Error(e.split("\n").slice(-2).join(" ").slice(0, 200));
    }
    return `${left.length ? `commit « ${msg} » (${left.length} fichier(s)) et ` : ""}envoyé sur la branche ${branch}` + (blocked.length ? `; non envoyés car sensibles : ${blocked.join(", ")}` : "");
  }
};

/* ───────────── Boucle de l'agent ───────────── */

const SYSTEM = `Tu es « Mini bot », un agent IA mignon et compétent créé par Camille Uchiha. Tu travailles sur le dossier du bot GoatBot (un fork GitHub cloné) et tu décides seul des actions pour accomplir la demande.
Réponds UNIQUEMENT par un objet JSON, une seule action à la fois, sans texte autour :
{"action":"list_files","path":""}
{"action":"read_file","path":"cmds/ping.js","offset":0}
{"action":"write_file","path":"cmds/ping.js","content":"CONTENU COMPLET DU FICHIER"}
{"action":"git_status"}
{"action":"git_diff","path":""}
{"action":"git_log","count":5}
{"action":"git_pull"}
{"action":"git_push","message":"message de commit"}
{"action":"final_answer","text":"réponse claire en français, ton amical, appelle l'utilisateur par son prénom"}

Règles :
- Avant de modifier un fichier existant, lis-le d'abord (read_file) puis renvoie TOUT le fichier modifié dans write_file, jamais un morceau.
- Tu ne peux pas supprimer de fichier, exécuter de commandes, ni toucher à config.json, account.txt, .env, cookies ou clés.
- N'utilise git_push que si l'utilisateur demande d'envoyer / publier / pousser sur GitHub, ou de tout faire.
- Si une action échoue, lis l'erreur et corrige ; si c'est impossible, explique-le franchement dans final_answer. N'invente jamais un résultat.
- Termine TOUJOURS par final_answer en disant précisément ce que tu as fait (fichiers touchés, push fait ou non) et, si tu as modifié une commande, rappelle de taper « cmd load <nom> ».`;

function trunc(s, n = 1500) { s = String(s); return s.length > n ? s.slice(0, n) + "…" : s; }

async function runAgent(ctx, task) {
  const { message, userName, uid } = ctx;
  const run = { written: new Set() };
  const past = memory.get(uid) || [];
  const log = []; // étapes de cette demande
  let notFormatted = 0;

  for (let step = 0; step < MAX_STEPS; step++) {
    const prompt =
      `${SYSTEM}\n\nPrénom de l'utilisateur : ${userName}\n` +
      (past.length ? `Demandes précédentes :\n${past.slice(-5).map(p => `- ${p}`).join("\n")}\n` : "") +
      `\nDemande actuelle : ${task}\n\nÉtapes déjà faites :\n` +
      (log.length ? log.map((l, i) => `${i + 1}. ${JSON.stringify(l.a).slice(0, 300)}\n   → ${trunc(l.r)}`).join("\n") : "(aucune)") +
      `\n\nDonne maintenant la prochaine action en JSON.`;

    const raw = await askAI(prompt);
    const a = parseAction(raw);

    if (!a) {
      if (++notFormatted >= 2) {
        // L'IA répond en texte libre : on le montre tel quel plutôt que d'échouer
        return say(message, cleanForMessenger(raw) || "Je n'ai pas réussi à formuler d'action. Peux-tu reformuler ?");
      }
      log.push({ a: { action: "erreur" }, r: "Ta réponse n'était pas un JSON valide. Réponds uniquement par un objet JSON." });
      continue;
    }

    if (a.action === "final_answer") {
      const text = cleanForMessenger(a.text || "C'est fait !");
      const acts = log.filter(l => l.a.action === "write_file" && !l.err).length;
      memory.set(uid, [...past, `${task} → ${trunc(text, 150)}`].slice(-10));
      return say(message, `🎀 Mini bot 🎀\n━━━━━━━━━\n\n${text}${acts ? `\n\n📝 ${run.written.size} fichier(s) touché(s) : ${[...run.written].join(", ")}` : ""}`);
    }

    const fn = ACTIONS[a.action];
    if (!fn) { log.push({ a, r: `Action inconnue : ${a.action}`, err: true }); continue; }
    try {
      const r = await fn(a, run);
      log.push({ a: a.action === "write_file" ? { ...a, content: `(${String(a.content).length} caractères)` } : a, r });
    } catch (e) {
      log.push({ a: a.action === "write_file" ? { ...a, content: "(…)" } : a, r: `ERREUR : ${e.message}`, err: true });
    }
  }
  const touched = run.written.size ? `\nFichiers déjà modifiés : ${[...run.written].join(", ")}.` : "";
  return message.reply(`🎀 Mini bot 🎀\n━━━━━━━━━\n\nJ'ai fait plusieurs étapes sans réussir à conclure.${touched}\nVérifie avec « github status », ou redonne-moi plus de précisions.`);
}

async function say(message, text) {
  for (const p of chunk(text)) await message.reply(p);
}

const HELLO =
  "🎀 Salut, je suis ton agent IA (sans clé) ! Parle-moi normalement, par exemple :\n" +
  "• liste les fichiers des commandes\n" +
  "• montre-moi le contenu de cmds/aria.js\n" +
  "• ajoute une commande ping qui répond pong\n" +
  "• corrige l'erreur dans blackliste.js puis envoie sur GitHub\n" +
  "• qu'est-ce qui a changé depuis le dernier commit ?\n\n" +
  "Je travaille sur le dossier du bot avec git. Je ne touche jamais aux mots de passe ni à config.json.";

module.exports = {
  config: {
    name: "agent",
    aliases: ["ia-agent", "dev"],
    version: "3.0.0",
    author: "Camille Uchiha",
    countDown: 5,
    role: 2,
    description: { en: "🎀 Mini bot 🎀 — agent IA sans clé : lit, modifie et envoie ton code sur GitHub" },
    category: "owner",
    guide: { en: "{pn} <demande en langage naturel>\n{pn} reset : oublier les demandes précédentes" }
  },

  onStart: async function ({ message, event, args, role, usersData }) {
    let userName = "toi";
    try { const n = await usersData.getName(event.senderID); if (n) userName = n.split(" ")[0]; } catch (_) {}
    if ((role || 0) < 2) return message.reply(`Désolée ${userName}, l'agent est réservé au propriétaire du bot.`);

    const text = args.join(" ").trim();
    if (!text) return message.reply(HELLO);
    if (text.toLowerCase() === "reset") { memory.delete(event.senderID); return message.reply("C'est noté, j'ai tout oublié. On repart de zéro ✨"); }

    // Le bot doit être dans un dépôt git pour travailler : sinon il le dit
    const ctx = { message, userName, uid: event.senderID };
    message.reply("⏳ Je m'en occupe...");
    try {
      await runAgent(ctx, text);
    } catch (e) {
      const m = e && e.response ? `l'API de l'IA ne répond pas (${e.response.status})` : String((e && e.message) || e);
      message.reply(`❌ Oups, ${userName}, ${maskUrl(m)}. Réessaie dans un instant.`);
    }
  },

  // Répondre au message de l'agent continue la conversation
  onReply: async function (params) {
    return module.exports.onStart({ ...params, args: String(params.event.body || "").split(/\s+/).filter(Boolean) });
  }
};
        
