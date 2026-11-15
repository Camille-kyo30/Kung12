const axios = require("axios");

module.exports = {
  config: {
    name: "joingc",
    version: "1.0.0",
    author: "Camille Uchiha",
    countDown: 5,
    role: 0,
    description: {
      en: "Affiche la liste des groupes où le bot est présent et permet de les rejoindre."
    },
    category: "utility",
    guide: {
      en: "{pn} : pour voir la liste des groupes.\n{pn} <numéro> : pour rejoindre le groupe correspondant."
    }
  },

  onStart: async function ({ message, event, args, api }) {
    try {
      // Récupération de la liste des conversations (limite à 50)
      const threadList = await api.getThreadList(50, null, ["INBOX"]);
      
      // Filtrage pour ne garder que les groupes actifs
      const groups = threadList.filter(t => t.isGroup && t.threadID !== event.threadID);

      if (args.length === 0) {
        if (groups.length === 0) {
          return message.reply("🎀 Mini bot 🎀\n━━━━━━━━━━━━━━\nAucun autre groupe trouvé.\n━━━━━━━━━━━━━━");
        }

        let msg = "Liste des groupes disponibles :\n\n";
        groups.forEach((group, index) => {
          msg += `${index + 1}. ${group.name || "Groupe sans nom"}\n(ID: ${group.threadID})\n\n`;
        });
        msg += "Utilisez /joingc <numéro> pour rejoindre.";

        return message.reply(`🎀 Mini bot 🎀\n━━━━━━━━━━━━━━\n${msg}\n━━━━━━━━━━━━━━`);
      }

      // Si l'utilisateur a choisi un numéro
      const index = parseInt(args[0]) - 1;

      if (isNaN(index) || index < 0 || index >= groups.length) {
        return message.reply("🎀 Mini bot 🎀\n━━━━━━━━━━━━━━\nNuméro invalide. Veuillez choisir un nombre dans la liste.\n━━━━━━━━━━━━━━");
      }

      const targetGroup = groups[index];

      // Tentative d'ajout de l'utilisateur au groupe cible
      await api.addUserToGroup(event.senderID, targetGroup.threadID, (err) => {
        if (err) {
          return message.reply(`🎀 Mini bot 🎀\n━━━━━━━━━━━━━━\nErreur : Je ne peux pas vous ajouter à "${targetGroup.name}". Assurez-vous que je suis administrateur dans ce groupe.\n━━━━━━━━━━━━━━`);
        } else {
          return message.reply(`🎀 Mini bot 🎀\n━━━━━━━━━━━━━━\nSuccès ! Je vous ai ajouté au groupe : ${targetGroup.name}\n━━━━━━━━━━━━━━`);
        }
      });

    } catch (error) {
      console.error(error);
      return message.reply("🎀 Mini bot 🎀\n━━━━━━━━━━━━━━\nUne erreur est survenue lors de l'exécution de la commande.\n━━━━━━━━━━━━━━");
    }
  }
};
