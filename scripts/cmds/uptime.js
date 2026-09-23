const fs = require("fs-extra");
const path = require("path");
const os = require("os");
const { createCanvas } = require("canvas");

const cacheDir = path.join(__dirname, "cache");

module.exports = {
	config: {
		name: "uptime",
		aliases: ["ut", "temps"],
		version: "1.0",
		author: "Camille Uchiha",
		countDown: 5,
		role: 0,

		description: {
			en: "Show the bot's uptime as a visual card",
			fr: "Affiche le temps de fonctionnement du bot en carte visuelle"
		},

		category: "info",

		guide: {
			en: "{pn} → show uptime",
			fr: "{pn} → afficher l'uptime"
		}
	},

	onStart: async function ({ message }) {

		try {
			const imgPath = await renderUptimeCard();

			await message.reply({
				attachment: fs.createReadStream(imgPath)
			});

			setTimeout(() => { fs.remove(imgPath).catch(() => {}); }, 20000);

		} catch (e) {
			return message.reply(`⚠️ Erreur lors de la génération de l'uptime : ${e.message}`);
		}
	}
};

// ═══════════════════════════════════════
// 🔧 𝙐𝙏𝙄𝙇𝙎
// ═══════════════════════════════════════

function roundRect(ctx, x, y, w, h, r) {
	ctx.beginPath();
	ctx.moveTo(x + r, y);
	ctx.arcTo(x + w, y, x + w, y + h, r);
	ctx.arcTo(x + w, y + h, x, y + h, r);
	ctx.arcTo(x, y + h, x, y, r);
	ctx.arcTo(x, y, x + w, y, r);
	ctx.closePath();
}

function glowText(ctx, text, x, y, color, blur = 16) {
	ctx.save();
	ctx.shadowColor = color;
	ctx.shadowBlur = blur;
	ctx.fillText(text, x, y);
	ctx.fillText(text, x, y);
	ctx.restore();
}

function progressBar(ctx, x, y, w, h, percent, colorStart, colorEnd, track) {
	roundRect(ctx, x, y, w, h, h / 2);
	ctx.fillStyle = track;
	ctx.fill();

	const filledW = Math.max(h, (w * Math.min(100, percent)) / 100);
	const grad = ctx.createLinearGradient(x, 0, x + filledW, 0);
	grad.addColorStop(0, colorStart);
	grad.addColorStop(1, colorEnd);

	roundRect(ctx, x, y, filledW, h, h / 2);
	ctx.fillStyle = grad;
	ctx.fill();
}

function formatUptime(seconds) {
	const d = Math.floor(seconds / 86400);
	const h = Math.floor((seconds % 86400) / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	const s = Math.floor(seconds % 60);

	const parts = [];
	if (d > 0) parts.push(`${d}j`);
	if (h > 0 || d > 0) parts.push(`${h}h`);
	parts.push(`${m}m`);
	if (d === 0 && h === 0) parts.push(`${s}s`);

	return parts.join(" ");
}

function formatBytes(bytes) {
	const gb = bytes / (1024 ** 3);
	return `${gb.toFixed(2)} GB`;
}

function formatDate(date) {
	return date.toLocaleString("fr-FR", {
		day: "2-digit",
		month: "2-digit",
		year: "numeric",
		hour: "2-digit",
		minute: "2-digit"
	});
}

// ═══════════════════════════════════════
// 🎨 𝘾𝘼𝙍𝙏𝙀 𝙐𝙋𝙏𝙄𝙈𝙀
// Aucun emoji dessiné dans le canvas : uniquement du texte latin
// et des formes vectorielles, pour rester lisible partout.
// ═══════════════════════════════════════

async function renderUptimeCard() {

	const W = 900;
	const H = 520;
	const padX = 55;

	const canvas = createCanvas(W, H);
	const ctx = canvas.getContext("2d");

	// ── Fond dégradé nuit × miel ──
	const bg = ctx.createLinearGradient(0, 0, W, H);
	bg.addColorStop(0, "#0a0e1c");
	bg.addColorStop(0.5, "#121a30");
	bg.addColorStop(1, "#1a1409");
	ctx.fillStyle = bg;
	ctx.fillRect(0, 0, W, H);

	ctx.globalAlpha = 0.15;
	ctx.fillStyle = "#5b8cff";
	ctx.beginPath();
	ctx.arc(90, 70, 180, 0, Math.PI * 2);
	ctx.fill();
	ctx.fillStyle = "#ffd23f";
	ctx.beginPath();
	ctx.arc(W - 80, H - 60, 200, 0, Math.PI * 2);
	ctx.fill();
	ctx.globalAlpha = 1;

	// ── Carte principale + ombre ──
	ctx.save();
	ctx.shadowColor = "rgba(0,0,0,0.5)";
	ctx.shadowBlur = 30;
	ctx.shadowOffsetY = 12;
	roundRect(ctx, 24, 24, W - 48, H - 48, 28);
	ctx.fillStyle = "rgba(255,255,255,0.045)";
	ctx.fill();
	ctx.restore();

	roundRect(ctx, 24, 24, W - 48, H - 48, 28);
	ctx.strokeStyle = "rgba(255,255,255,0.12)";
	ctx.lineWidth = 1.5;
	ctx.stroke();

	// ── Logo circulaire ──
	const logoR = 30;
	const logoX = padX + logoR;
	const logoY = 78;
	const logoGrad = ctx.createLinearGradient(
		logoX - logoR, logoY - logoR, logoX + logoR, logoY + logoR
	);
	logoGrad.addColorStop(0, "#5b8cff");
	logoGrad.addColorStop(1, "#ffd23f");
	ctx.beginPath();
	ctx.arc(logoX, logoY, logoR, 0, Math.PI * 2);
	ctx.fillStyle = logoGrad;
	ctx.fill();

	ctx.font = "bold 15px sans-serif";
	ctx.fillStyle = "#0a0e1c";
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	ctx.fillText("N×B", logoX, logoY + 1);
	ctx.textAlign = "left";
	ctx.textBaseline = "alphabetic";

	// ── Titre + badge statut ──
	const titleX = logoX + logoR + 18;
	ctx.font = "bold 30px sans-serif";
	ctx.fillStyle = "#ffffff";
	glowText(ctx, "NAGI × BACHIRA — UPTIME", titleX, 70, "#5b8cff", 16);

	ctx.font = "bold 12px sans-serif";
	const statusLabel = "EN LIGNE";
	const statusW = ctx.measureText(statusLabel).width + 26;
	roundRect(ctx, titleX, 82, statusW, 24, 12);
	ctx.fillStyle = "rgba(126,231,135,0.15)";
	ctx.fill();
	ctx.strokeStyle = "rgba(126,231,135,0.5)";
	ctx.lineWidth = 1;
	ctx.stroke();

	ctx.beginPath();
	ctx.arc(titleX + 14, 94, 4, 0, Math.PI * 2);
	ctx.fillStyle = "#7ee787";
	ctx.fill();
	ctx.fillStyle = "#7ee787";
	ctx.fillText(statusLabel, titleX + 24, 98);

	// ── Séparateur ──
	ctx.strokeStyle = "rgba(255,255,255,0.10)";
	ctx.beginPath();
	ctx.moveTo(padX, 135);
	ctx.lineTo(W - padX, 135);
	ctx.stroke();

	// ── Grand chiffre d'uptime ──
	const uptimeSeconds = process.uptime();
	const uptimeLabel = formatUptime(uptimeSeconds);

	ctx.font = "12px sans-serif";
	ctx.fillStyle = "#6e7796";
	ctx.fillText("TEMPS DE FONCTIONNEMENT", padX, 175);

	ctx.font = "bold 64px sans-serif";
	ctx.fillStyle = "#ffffff";
	glowText(ctx, uptimeLabel, padX, 245, "#ffd23f", 20);

	const startedAt = new Date(Date.now() - uptimeSeconds * 1000);
	ctx.font = "15px sans-serif";
	ctx.fillStyle = "#8891b5";
	ctx.fillText(`Démarré le ${formatDate(startedAt)}`, padX, 275);

	// ── Cartes secondaires (Node.js / Plateforme) ──
	const cardY = 305;
	const cardH = 80;
	const cardW = (W - padX * 2 - 20) / 2;

	function infoCard(x, label, value, color) {
		roundRect(ctx, x, cardY, cardW, cardH, 16);
		ctx.fillStyle = "rgba(255,255,255,0.035)";
		ctx.fill();
		ctx.strokeStyle = "rgba(255,255,255,0.08)";
		ctx.lineWidth = 1;
		ctx.stroke();

		ctx.font = "12px sans-serif";
		ctx.fillStyle = "#6e7796";
		ctx.fillText(label, x + 20, cardY + 28);

		ctx.font = "bold 20px sans-serif";
		ctx.fillStyle = color;
		ctx.fillText(value, x + 20, cardY + 58);
	}

	infoCard(padX, "NODE.JS", process.version, "#5b8cff");
	infoCard(padX + cardW + 20, "PLATEFORME", `${os.platform()} (${os.arch()})`, "#ffd23f");

	// ── Barres système ──
	const totalMem = os.totalmem();
	const freeMem = os.freemem();
	const usedMem = totalMem - freeMem;
	const memPercent = (usedMem / totalMem) * 100;

	const cpuLoad = os.loadavg()[0];
	const cpuPercent = Math.min(100, (cpuLoad / os.cpus().length) * 100);

	const barsY = cardY + cardH + 45;

	ctx.font = "14px sans-serif";
	ctx.fillStyle = "#dfe4fa";
	ctx.fillText(`RAM  ${formatBytes(usedMem)} / ${formatBytes(totalMem)}`, padX, barsY);
	progressBar(ctx, padX, barsY + 12, W - padX * 2, 14, memPercent, "#5b8cff", "#9d5bff", "rgba(255,255,255,0.08)");

	const cpuY = barsY + 55;
	ctx.fillStyle = "#dfe4fa";
	ctx.fillText(`CPU  ${cpuPercent.toFixed(1)}%`, padX, cpuY);
	progressBar(ctx, padX, cpuY + 12, W - padX * 2, 14, cpuPercent, "#ffd23f", "#ff8a3f", "rgba(255,255,255,0.08)");

	// ── Pied de page ──
	const footerY = H - 34;
	ctx.strokeStyle = "rgba(255,255,255,0.08)";
	ctx.beginPath();
	ctx.moveTo(padX, footerY - 22);
	ctx.lineTo(W - padX, footerY - 22);
	ctx.stroke();

	ctx.font = "italic 12px sans-serif";
	ctx.fillStyle = "#5f6890";
	ctx.fillText("Nagi veille depuis le début, Bachira compte les secondes.", padX, footerY);

	ctx.textAlign = "right";
	ctx.fillStyle = "#4a5378";
	ctx.fillText(formatDate(new Date()), W - padX, footerY);
	ctx.textAlign = "left";

	await fs.ensureDir(cacheDir);
	const imgPath = path.join(cacheDir, `uptime_${Date.now()}.png`);
	await fs.writeFile(imgPath, canvas.toBuffer("image/png"));

	return imgPath;
}
