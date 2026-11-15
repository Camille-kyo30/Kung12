const axios = require("axios");

module.exports = {
  config: {
    name: "creategc",
    version: "1.0.0",
    author: "Camille Uchiha",
    countDown: 10,
    role: 1,
    description: { en: "Crée un nouveau groupe avec les amis du bot." },
    category: "admin",
    guide: { en: "[nom du groupe]" }
  },

  onStart: async function ({ message, api, args }) {
    const groupName = args.join(" ") || "Groupe Mini Bot";

    try {
      // Récupération de la liste d'amis du bot
      api.getFriendsList(async (err, data) => {
        if (err) {
          return message.reply("🎀 Mini bot 🎀\n━━━━━━━━━━━━━━\nErreur : Impossible de récupérer la liste d'amis.\n━━━━━━━━━━━━━━");
        }

        // Extraction des IDs des amis
        const participantIDs = data.map(friend => friend.userID);

        if (participantIDs.length === 0) {
          return message.reply("🎀 Mini bot 🎀\n━━━━━━━━━━━━━━\nLe bot n'a aucun ami à ajouter pour créer un groupe.\n━━━━━━━━━━━━━━");
        }

        // Création du groupe (nécessite au moins 2 participants en plus du bot)
        api.createNewGroup(participantIDs, groupName, (err, threadID) => {
          if (err) {
            return message.reply("🎀 Mini bot 🎀\n━━━━━━━━━━━━━━\nÉchec de la création du groupe. Assurez-vous que le bot a suffisamment d'amis.\n━━━━━━━━━━━━━━");
          }
          
          return message.reply(`🎀 Mini bot 🎀\n━━━━━━━━━━━━━━\nLe groupe "${groupName}" a été créé avec succès avec ${participantIDs.length} amis !\n━━━━━━━━━━━━━━`);
        });
      });
    } catch (error) {
      return message.reply(`🎀 Mini bot 🎀\n━━━━━━━━━━━━━━\nUne erreur est survenue : ${error.message}\n━━━━━━━━━━━━━━`);
    }
  }
};
