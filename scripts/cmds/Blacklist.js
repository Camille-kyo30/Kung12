const FRAME = "🍥━━━━━━━━━━━━━━🍥";

/* ───── Anti-spam : réglages (modifie ces valeurs si tu veux) ───── */
const SPAM_LIMIT = 4;            // 4 commandes envoyées...
const SPAM_WINDOW = 6000;        // ...en 6 secondes = 1 infraction
const MAX_OFFENSES = 3;          // 3 infractions = expulsion
const OFFENSE_TTL = 30 * 60000;  // les infractions sont oubliées après 30 minutes
const hits = new Map();          // "groupe:utilisateur" -> heures des dernières commandes
const offenses = new Map();      // "groupe:utilisateur" -> { count, last }

// Les fonctions de l'API fca fonctionnent par callback : on les transforme en promesses
function getThreadInfo(api, threadID) {
  return new Promise((resolve, reject) =>
    api.getThreadInfo(threadID, (err, data) => (err ? reject(err) : resolve(data)))
  );
}
function removeUser(api, uid, threadID) {
  return new Promise((resolve, reject) =>
    api.removeUserFromGroup(uid, threadID, err => (err ? reject(err) : resolve()))
  );
}

function getPrefix(threadID) {
  try {
    return global.utils.getPrefix(threadID);
  } catch (_) {
    return (global.GoatBot && global.GoatBot.config && global.GoatBot.config.prefix) || "";
  }
}

function getProtectedIDs() {
  const cfg = (global.GoatBot && global.GoatBot.config) || {};
  return [...(cfg.adminBot || []), ...(cfg.devUsers || [])].map(String);
}

// L'anti-spam est actif par défaut ; `blackliste antispam off` le coupe dans un groupe
async function antispamEnabled(threadsData, threadID) {
  try {
    const v = await threadsData.get(threadID, "data.antispamBL");
    return v !== false;
  } catch (_) {
    return true;
  }
}

function naruto(title, body) {
  return `${FRAME}\n${title}\n${FRAME}\n${body}\n${FRAME}`;
}

function now() {
  return new Date().toLocaleString("fr-FR", { timeZone: "Africa/Abidjan" });
}

// Trouve la cible : message cité, mention ou identifiant (UID)
function getTarget(event, args) {
  const mentions = event.mentions || {};
  const mentionIDs = Object.keys(mentions);
  let rest = args.join(" ");

  if (event.messageReply) {
    return { uid: String(event.messageReply.senderID), reason: rest.trim() };
  }
  if (mentionIDs.length) {
    for (const n of Object.values(mentions)) rest = rest.replace(n, "");
    return { uid: String(mentionIDs[0]), reason: rest.replace(/\s+/g, " ").trim() };
  }
  if (/^\d{5,}$/.test(args[0] || "")) {
    return { uid: args[0], reason: args.slice(1).join(" ").trim() };
  }
  return null;
}

async function nameOf(usersData, uid) {
  try {
    return (await usersData.getName(uid)) || uid;
  } catch (_) {
    return uid;
  }
}

async function isBanned(usersData, uid) {
  try {
    const data = await usersData.get(uid);
    return data?.banned?.status === true;
  } catch (_) {
    return false;
  }
}

module.exports = {
  config: {
    name: "blackliste",
    aliases: ["blacklist", "scelle"],
    version: "1.0.0",
    author: "Camille Uchiha",
    countDown: 3,
    role: 2, // propriétaire / admin du bot
    description: {
      en: "Liste noire style Naruto : le bot ne répond plus aux utilisateurs scellés, dattebayo !"
    },
    category: "owner",
    guide: {
      en:
        "{pn} add @user [raison] : sceller un utilisateur\n" +
        "{pn} remove @user : briser le sceau\n" +
        "{pn} list : voir le Bingo Book\n" +
        "{pn} antispam on/off : expulse ceux qui spamment le bot (si le bot est admin)\n" +
        "(on peut aussi répondre à un message, ou donner l'UID)"
    }
  },

  onStart: async function ({ api, event, args, message, usersData, threadsData }) {
    const sub = (args[0] || "").toLowerCase();
    const rest = args.slice(1);

    try {
      /* ───── ANTI-SPAM ON / OFF ───── */
      if (sub === "antispam") {
        const choice = (args[1] || "").toLowerCase();
        if (["on", "off"].includes(choice)) {
          await threadsData.set(event.threadID, choice === "on", "data.antispamBL");
          return message.reply(
            naruto(
              choice === "on" ? "🛡️ GARDE ACTIVÉE 🛡️" : "😴 GARDE ENDORMIE 😴",
              choice === "on"
                ? `Dattebayo ! Le spam de commandes sera puni (${MAX_OFFENSES} infractions = expulsion).`
                : "L'anti-spam est coupé dans ce groupe, dattebayo !"
            )
          );
        }
        const on = await antispamEnabled(threadsData, event.threadID);
        return message.reply(
          naruto(
            "🛡️ ANTI-SPAM 🛡️",
            `État : ${on ? "activé ✅" : "désactivé ❌"}\n` +
              `Règle : ${SPAM_LIMIT} commandes en ${SPAM_WINDOW / 1000} s = 1 infraction, ${MAX_OFFENSES} infractions = expulsion.\n\n` +
              "blackliste antispam on / off"
          )
        );
      }

      /* ───── LISTE ───── */
      if (["list", "liste", "bingo"].includes(sub)) {
        const all = await usersData.getAll();
        const banned = all.filter(u => u.banned?.status === true);
        if (!banned.length) {
          return message.reply(
            naruto("📜 BINGO BOOK 📜", "Aucun ninja renégat, le village est en paix, dattebayo ! 🍜")
          );
        }
        const shown = banned.slice(0, 20);
        const lines = shown.map(
          (u, i) =>
            `${i + 1}. ${u.name || u.userID}\n   🆔 ${u.userID}\n   📜 ${u.banned.reason || "Aucune raison"}\n   🕒 ${u.banned.date || "?"}`
        );
        const more = banned.length > shown.length ? `\n… et ${banned.length - shown.length} autre(s) ninja(s).` : "";
        return message.reply(
          naruto(`📜 BINGO BOOK — ${banned.length} ninja(s) scellé(s) 📜`, `${lines.join("\n\n")}${more}`)
        );
      }

      /* ───── AJOUT / RETRAIT ───── */
      const isAdd = ["add", "ajouter", "ban", "bannir", "sceller"].includes(sub);
      const isRemove = ["remove", "rm", "retirer", "unban", "kai"].includes(sub);

      if (!isAdd && !isRemove) {
        return message.reply(
          naruto(
            "🌀 JUTSU DE SCELLEMENT 🌀",
            "Je n'ai pas compris ce jutsu, dattebayo !\n\n" +
              "🔒 blackliste add @ninja [raison]\n" +
              "🔓 blackliste remove @ninja\n" +
              "📜 blackliste list\n\n" +
              "Tu peux aussi répondre à son message, ou donner son UID. Believe it !"
          )
        );
      }

      const target = getTarget(event, rest);
      if (!target) {
        return message.reply(
          naruto("❓ QUI, DATTEBAYO ? ❓", "Mentionne un ninja, réponds à son message ou donne son UID !")
        );
      }

      const { uid } = target;
      const targetName = await nameOf(usersData, uid);

      if (isAdd) {
        // Les Hokage (admins), le bot et toi-même sont protégés
        const cfg = (global.GoatBot && global.GoatBot.config) || {};
        const protectedIDs = [...(cfg.adminBot || []), ...(cfg.devUsers || [])].map(String);
        const botID = String(api.getCurrentUserID());

        if (uid === botID) {
          return message.reply(naruto("🚫 IMPOSSIBLE 🚫", "Tu ne peux pas me sceller moi-même, dattebayo !"));
        }
        if (uid === String(event.senderID) || protectedIDs.includes(uid)) {
          return message.reply(
            naruto("🚫 IMPOSSIBLE 🚫", `${targetName} est un Hokage : on ne scelle pas les chefs du village, dattebayo !`)
          );
        }
        if (await isBanned(usersData, uid)) {
          return message.reply(naruto("⚠️ DÉJÀ SCELLÉ ⚠️", `${targetName} est déjà dans le Bingo Book, dattebayo !`));
        }

        const reason = target.reason || "Aucune raison donnée";
        await usersData.set(uid, { banned: { status: true, reason, date: now() } });

        return message.reply(
          naruto(
            "🔒 JUTSU DE SCELLEMENT ! 🔒",
            `Dattebayo ! ${targetName} est banni du village de la Feuille !\n\n` +
              `🥷 Ninja : ${targetName}\n🆔 UID : ${uid}\n📜 Raison : ${reason}\n\n` +
              "Je ne répondrai plus à ce ninja. Un vrai ninja n'oublie jamais sa parole, believe it ! 🍥"
          )
        );
      }

      // Retrait
      if (!(await isBanned(usersData, uid))) {
        return message.reply(
          naruto("⚠️ AUCUN SCEAU ⚠️", `${targetName} n'est pas dans le Bingo Book, dattebayo !`)
        );
      }
      await usersData.set(uid, { banned: { status: false, reason: null, date: null } });

      return message.reply(
        naruto(
          "🔓 KAI ! SCEAU BRISÉ 🔓",
          `${targetName} est pardonné et peut de nouveau parler avec moi, dattebayo !\n\n` +
            "Ne lâche jamais, c'est ça mon chemin du ninja ! 🍜"
        )
      );
    } catch (e) {
      console.error("[blackliste]", e);
      return message.reply(
        naruto("💥 JUTSU RATÉ 💥", `Une erreur est survenue, dattebayo !\n${e?.message || "inconnue"}`)
      );
    }
  },

  /* ───── ANTI-SPAM : tourne sur chaque message du groupe ───── */
  onChat: async function ({ api, event, message, usersData, threadsData }) {
    try {
      const { threadID, senderID, body } = event;
      if (!body || event.isGroup === false) return;

      const botID = String(api.getCurrentUserID());
      const uid = String(senderID);
      if (uid === botID || getProtectedIDs().includes(uid)) return;

      // On ne compte que les messages qui utilisent le bot (commandes avec préfixe)
      const prefix = getPrefix(threadID);
      if (!prefix || !body.startsWith(prefix) || body.length === prefix.length) return;
      if (!(await antispamEnabled(threadsData, threadID))) return;

      const key = `${threadID}:${uid}`;
      const t = Date.now();
      const recent = (hits.get(key) || []).filter(x => t - x < SPAM_WINDOW);
      recent.push(t);
      hits.set(key, recent);
      if (recent.length < SPAM_LIMIT) return;
      hits.delete(key); // une nouvelle rafale sera nécessaire pour la prochaine infraction

      // Les admins du groupe ne peuvent pas être expulsés : on les laisse tranquilles
      const threadInfo = await getThreadInfo(api, threadID);
      const adminIDs = (threadInfo.adminIDs || []).map(a => String(a.id || a));
      if (adminIDs.includes(uid)) return;
      const botIsAdmin = adminIDs.includes(botID);

      const prev = offenses.get(key);
      const count = (prev && t - prev.last < OFFENSE_TTL ? prev.count : 0) + 1;
      offenses.set(key, { count, last: t });
      const name = await nameOf(usersData, uid);
      const mention = [{ tag: name, id: uid }];

      if (count < MAX_OFFENSES) {
        const left = MAX_OFFENSES - count;
        return message.reply({
          body: naruto(
            `⚠️ AVERTISSEMENT ${count}/${MAX_OFFENSES} ⚠️`,
            `${name}, calme-toi, dattebayo ! Tu lances trop de jutsus d'un coup.\n\n` +
              `Encore ${left} infraction(s) et ${botIsAdmin ? "tu seras expulsé du village" : "je ne répondrai plus à tes jutsus"} ! 🍥`
          ),
          mentions: mention
        });
      }

      // 3e infraction : expulsion si le bot est admin, sinon scellement
      offenses.delete(key);
      let kicked = false;
      if (botIsAdmin) {
        try {
          await removeUser(api, uid, threadID);
          kicked = true;
        } catch (e) {
          console.error("[blackliste] expulsion impossible :", e?.message || e);
        }
      }

      if (kicked) {
        return message.reply(
          naruto(
            "🚪 EXPULSÉ DU VILLAGE ! 🚪",
            `${name} a abusé de mes jutsus malgré les avertissements.\n` +
              "Dattebayo ! La Feuille ne tolère pas le spam, believe it ! 🍥"
          )
        );
      }

      await usersData.set(uid, {
        banned: { status: true, reason: "Spam du bot (anti-spam automatique)", date: now() }
      });
      return message.reply({
        body: naruto(
          "🔒 JUTSU DE SCELLEMENT ! 🔒",
          `${name} a spammé le bot ${MAX_OFFENSES} fois, dattebayo !\n` +
            (botIsAdmin
              ? "Je n'ai pas pu l'expulser, donc je le scelle : je ne répondrai plus à ce ninja."
              : "Je ne suis pas admin du groupe, donc je ne peux pas l'expulser : je le scelle, je ne répondrai plus à ce ninja.") +
            "\n\n🔓 Pour le pardonner : blackliste remove"
        ),
        mentions: mention
      });
    } catch (e) {
      console.error("[blackliste] anti-spam :", e?.message || e);
    }
  }
};
                            
