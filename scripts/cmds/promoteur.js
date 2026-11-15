const axios = require("axios");

module.exports = {
  config: {
    name: "promote",
    version: "1.0.0",
    author: "Camille Uchiha",
    countDown: 5,
    role: 1,
    description: {
      en: "Promote a user to group administrator."
    },
    category: "group",
    guide: {
      en: "Reply to a message, mention a user, or provide a user ID to promote them to admin."
    }
  },

  onStart: async function ({ message, event, args, api }) {
    const { threadID, messageReply, mentions } = event;
    let targetID;

    try {
      // Identification de l'utilisateur à promouvoir
      if (messageReply) {
        targetID = messageReply.senderID;
      } else if (Object.keys(mentions).length > 0) {
        targetID = Object.keys(mentions)[0];
      } else if (args[0] && !isNaN(args[0])) {
        targetID = args[0];
      } else {
        return message.reply("🎀 Mini bot 🎀\n━━━━━━━━━━━━━━\nVeuillez répondre à un utilisateur, le mentionner ou entrer son ID pour le nommer admin.\n━━━━━━━━━━━━━━");
      }

      // Récupération des informations du groupe pour vérifier les permissions du bot
      const threadInfo = await api.getThreadInfo(threadID);
      const botID = api.getCurrentUserID();
      const isAdmin = threadInfo.adminIDs.some(admin => admin.id === botID);

      if (!isAdmin) {
        return message.reply("🎀 Mini bot 🎀\n━━━━━━━━━━━━━━\nErreur : Je dois être administrateur du groupe pour pouvoir promouvoir un membre.\n━━━━━━━━━━━━━━");
      }

      // Action de promotion
      await api.changeAdminStatus(threadID, targetID, true);

      return message.reply("🎀 Mini bot 🎀\n━━━━━━━━━━━━━━\nL'utilisateur a été promu administrateur du groupe avec succès !\n━━━━━━━━━━━━━━");

    } catch (error) {
      return message.reply(`🎀 Mini bot 🎀\n━━━━━━━━━━━━━━\nUne erreur est survenue lors de la promotion : ${error.message}\n━━━━━━━━━━━━━━`);
    }
  }
};
