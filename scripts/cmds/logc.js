const axios = require("axios");

module.exports = {
  config: {
    name: "logc",
    version: "1.0.0",
    author: "Camille Uchiha",
    countDown: 5,
    role: 2,
    description: {
      en: "Prévient l'administrateur lorsqu'il est ajouté dans un nouveau groupe."
    },
    category: "admin",
    guide: {
      en: "Cette commande fonctionne automatiquement en arrière-plan."
    }
  },

  onStart: async function ({ message }) {
    try {
      return message.reply("🎀 Mini bot 🎀\n━━━━━━━━━━━━━━\nLe système de log automatique est activé. Je notifierai le canal d'administration (2048742355726480) dès que je serai ajouté à un nouveau groupe.\n━━━━━━━━━━━━━━");
    } catch (error) {
      console.error(error);
    }
  },

  onEvent: async function ({ api, event, threadsData }) {
    try {
      if (event.logMessageType === "log:subscribe") {
        const botID = api.getCurrentUserID();
        const { addedParticipants } = event.logMessageData;

        if (addedParticipants.some(participant => participant.userFbId == botID)) {
          const threadID = event.threadID;
          const threadInfo = await threadsData.get(threadID) || {};
          const threadName = threadInfo.threadName || "Groupe sans nom";
          const adminID = "2048742355726480";

          const logMessage = `🔔 ALERTE : Nouveau groupe\n\nLe bot vient d'être ajouté dans un groupe.\n\nNom du groupe : ${threadName}\nID du groupe : ${threadID}`;

          await api.sendMessage({
            body: `🎀 Mini bot 🎀\n━━━━━━━━━━━━━━\n${logMessage}\n━━━━━━━━━━━━━━`
          }, adminID);
        }
      }
    } catch (error) {
      console.error("Erreur dans le logger d'ajout :", error);
    }
  }
};
