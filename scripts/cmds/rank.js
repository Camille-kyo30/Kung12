const Canvas = require("canvas");
const path = require("path");
const { randomString } = global.utils;

// ═══════════════════════════════════════
// 🎨 𝙋𝙊𝙇𝙄𝙎𝙀𝙎
// Chargement défensif : si les fichiers de police n'existent pas,
// on retombe sur "sans-serif" plutôt que de crasher la commande.
// ═══════════════════════════════════════

let FONT_BOLD = "sans-serif";
let FONT_SEMI = "sans-serif";

try {
	Canvas.registerFont(`${__dirname}/assets/font/BeVietnamPro-Bold.ttf`, { family: "BeVietnamPro-Bold" });
	FONT_BOLD = "BeVietnamPro-Bold";
} catch { /* police absente, on garde le fallback */ }

try {
	Canvas.registerFont(`${__dirname}/assets/font/BeVietnamPro-SemiBold.ttf`, { family: "BeVietnamPro-SemiBold" });
	FONT_SEMI = "BeVietnamPro-SemiBold";
} catch { /* police absente, on garde le fallback */ }

let deltaNext;
const expToLevel = (exp, deltaNextLevel = deltaNext) => Math.floor((1 + Math.sqrt(1 + 8 * exp / deltaNextLevel)) / 2);
const levelToExp = (level, deltaNextLevel = deltaNext) => Math.floor(((Math.pow(level, 2) - level) * deltaNextLevel) / 2);
global.client.makeRankCard = makeRankCard;

module.exports = {
	config: {
		name: "rank",
		version: "2.0",
		author: "NTKhang",
		editor: "Camille Uchiha",
		countDown: 5,
		role: 0,
		description: {
			vi: "Xem level của bạn hoặc người được tag. Có thể tag nhiều người",
			en: "View your level or the level of the tagged person. You can tag many people",
			fr: "Affiche ton niveau ou celui d'une personne taguée. Plusieurs tags possibles"
		},
		category: "rank",
		guide: {
			vi: "   {pn} [để trống | @tags]",
			en: "   {pn} [empty | @tags]",
			fr: "   {pn} [vide | @tags]"
		},
		envConfig: {
			deltaNext: 5
		}
	},

	onStart: async function ({ message, event, usersData, threadsData, commandName, envCommands, api }) {
		deltaNext = envCommands[commandName].deltaNext;
		let targetUsers;
		const arrayMentions = Object.keys(event.mentions);

		if (arrayMentions.length == 0)
			targetUsers = [event.senderID];
		else
			targetUsers = arrayMentions;

		const rankCards = await Promise.all(targetUsers.map(async userID => {
			const buffer = await makeRankCard(userID, usersData, threadsData, event.threadID, deltaNext, api);
			return {
				data: buffer,
				path: `${randomString(10)}.png`
			};
		}));

		return message.reply({
			attachment: rankCards.map(c => c.data)
		});
	},

	onChat: async function ({ usersData, event }) {
		let { exp } = await usersData.get(event.senderID);
		if (isNaN(exp) || typeof exp != "number")
			exp = 0;
		try {
			await usersData.set(event.senderID, {
				exp: exp + 1
			});
		}
		catch (e) { }
	}
};

// ═══════════════════════════════════════
// 🎨 𝙏𝙃𝙀̀𝙈𝙀 𝙋𝘼𝙍 𝘿𝙀́𝙁𝘼𝙐𝙏
// Personnalisable par thread via threadsData "data.customRankCard"
// { bgFrom, bgTo, accentFrom, accentTo, cardColor }
// ═══════════════════════════════════════

const DEFAULT_THEME = {
	bgFrom: "#0a0e1c",
	bgTo: "#1a1409",
	cardColor: "rgba(255,255,255,0.045)",
	accentFrom: "#5b8cff",
	accentTo: "#ffd23f",
	trackColor: "rgba(255,255,255,0.08)",
	textPrimary: "#eef1ff",
	textSecondary: "#8891b5",
	textMuted: "#5f6890"
};

async function makeRankCard(userID, usersData, threadsData, threadID, deltaNext, api = global.GoatBot.fcaApi) {
	const { exp } = await usersData.get(userID);
	const levelUser = expToLevel(exp, deltaNext);

	const expNextLevel = levelToExp(levelUser + 1, deltaNext) - levelToExp(levelUser, deltaNext);
	const currentExp = expNextLevel - (levelToExp(levelUser + 1, deltaNext) - exp);

	const allUser = await usersData.getAll();
	allUser.sort((a, b) => b.exp - a.exp);
	const rankIndex = allUser.findIndex(user => user.userID == userID) + 1;

	const name = allUser[rankIndex - 1]?.name || await usersData.getName(userID);
	const avatarUrl = await usersData.getAvatarUrl(userID);

	const customTheme = await threadsData.get(threadID, "data.customRankCard") || {};
	const theme = { ...DEFAULT_THEME, ...customTheme };

	return buildRankCard({
		name,
		level: levelUser,
		rankLabel: `#${rankIndex} / ${allUser.length}`,
		currentExp,
		expNextLevel,
		avatarUrl,
		theme
	});
}

// ═══════════════════════════════════════
// 🖼️ 𝘾𝙊𝙉𝙎𝙏𝙍𝙐𝘾𝙏𝙄𝙊𝙉 𝘿𝙀 𝙇𝘼 𝘾𝘼𝙍𝙏𝙀
// Design carte large "profil pro" : anneau de progression autour de
// l'avatar, badges rang/niveau, barre d'XP en dégradé, décor discret.
// Aucun emoji dessiné (uniquement du texte latin + des formes vectorielles)
// pour rester lisible quelle que soit la police système disponible.
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

function fitText(ctx, text, maxWidth, startSize, fontFamily, minSize = 16) {
	let size = startSize;
	ctx.font = `bold ${size}px ${fontFamily}`;
	while (ctx.measureText(text).width > maxWidth && size > minSize) {
		size -= 1;
		ctx.font = `bold ${size}px ${fontFamily}`;
	}
	return size;
}

function truncate(str, max) {
	return str.length > max ? str.slice(0, max - 1) + "…" : str;
}

async function buildRankCard({ name, level, rankLabel, currentExp, expNextLevel, avatarUrl, theme }) {

	const W = 1200;
	const H = 380;
	const padX = 60;

	const canvas = Canvas.createCanvas(W, H);
	const ctx = canvas.getContext("2d");

	// ── Fond dégradé ──
	const bg = ctx.createLinearGradient(0, 0, W, H);
	bg.addColorStop(0, theme.bgFrom);
	bg.addColorStop(1, theme.bgTo);
	ctx.fillStyle = bg;
	ctx.fillRect(0, 0, W, H);

	// Halos décoratifs discrets
	ctx.globalAlpha = 0.14;
	ctx.fillStyle = theme.accentFrom;
	ctx.beginPath();
	ctx.arc(100, -20, 220, 0, Math.PI * 2);
	ctx.fill();
	ctx.fillStyle = theme.accentTo;
	ctx.beginPath();
	ctx.arc(W - 60, H + 40, 240, 0, Math.PI * 2);
	ctx.fill();
	ctx.globalAlpha = 1;

	// ── Carte principale + ombre portée ──
	ctx.save();
	ctx.shadowColor = "rgba(0,0,0,0.5)";
	ctx.shadowBlur = 30;
	ctx.shadowOffsetY = 12;
	roundRect(ctx, 16, 16, W - 32, H - 32, 28);
	ctx.fillStyle = theme.cardColor;
	ctx.fill();
	ctx.restore();

	roundRect(ctx, 16, 16, W - 32, H - 32, 28);
	ctx.strokeStyle = "rgba(255,255,255,0.10)";
	ctx.lineWidth = 1.5;
	ctx.stroke();

	// ── Avatar + anneau de progression ──
	const cx = padX + 110;
	const cy = H / 2;
	const ringR = 105;
	const ringWidth = 10;
	const avatarR = ringR - ringWidth - 6;

	// piste (fond de l'anneau)
	ctx.beginPath();
	ctx.arc(cx, cy, ringR, 0, Math.PI * 2);
	ctx.strokeStyle = theme.trackColor;
	ctx.lineWidth = ringWidth;
	ctx.stroke();

	// progression (dégradé, part du haut, sens horaire)
	const progressRatio = Math.max(0.02, Math.min(1, currentExp / expNextLevel));
	const startAngle = -Math.PI / 2;
	const endAngle = startAngle + progressRatio * Math.PI * 2;

	const ringGrad = ctx.createLinearGradient(cx - ringR, cy - ringR, cx + ringR, cy + ringR);
	ringGrad.addColorStop(0, theme.accentFrom);
	ringGrad.addColorStop(1, theme.accentTo);

	ctx.beginPath();
	ctx.arc(cx, cy, ringR, startAngle, endAngle);
	ctx.strokeStyle = ringGrad;
	ctx.lineWidth = ringWidth;
	ctx.lineCap = "round";
	ctx.stroke();
	ctx.lineCap = "butt";

	// avatar rond
	try {
		const avatarImg = await Canvas.loadImage(avatarUrl);
		ctx.save();
		ctx.beginPath();
		ctx.arc(cx, cy, avatarR, 0, Math.PI * 2);
		ctx.clip();
		ctx.drawImage(avatarImg, cx - avatarR, cy - avatarR, avatarR * 2, avatarR * 2);
		ctx.restore();
	} catch {
		// pas d'avatar récupérable : fond neutre à la place
		ctx.beginPath();
		ctx.arc(cx, cy, avatarR, 0, Math.PI * 2);
		ctx.fillStyle = "#222842";
		ctx.fill();
	}

	// badge niveau, superposé en bas de l'avatar
	const badgeR = 30;
	const badgeX = cx + avatarR * 0.68;
	const badgeY = cy + avatarR * 0.68;

	ctx.beginPath();
	ctx.arc(badgeX, badgeY, badgeR, 0, Math.PI * 2);
	ctx.fillStyle = theme.bgFrom;
	ctx.fill();

	ctx.beginPath();
	ctx.arc(badgeX, badgeY, badgeR - 4, 0, Math.PI * 2);
	const badgeGrad = ctx.createLinearGradient(badgeX - badgeR, badgeY - badgeR, badgeX + badgeR, badgeY + badgeR);
	badgeGrad.addColorStop(0, theme.accentFrom);
	badgeGrad.addColorStop(1, theme.accentTo);
	ctx.fillStyle = badgeGrad;
	ctx.fill();

	ctx.font = `bold 12px ${FONT_SEMI}`;
	ctx.fillStyle = "#0a0e1c";
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	ctx.fillText("NIV", badgeX, badgeY - 9);
	ctx.font = `bold 20px ${FONT_BOLD}`;
	ctx.fillText(String(level), badgeX, badgeY + 9);
	ctx.textAlign = "left";
	ctx.textBaseline = "alphabetic";

	// ── Zone de droite : nom, rang, XP ──
	const rightX = cx + ringR + 55;
	const rightW = W - padX - rightX;

	// Nom (taille auto-ajustée)
	const nameSize = fitText(ctx, name, rightW - 180, 46, FONT_BOLD, 22);
	ctx.font = `bold ${nameSize}px ${FONT_BOLD}`;
	ctx.fillStyle = theme.textPrimary;
	ctx.fillText(truncate(name, 26), rightX, 128);

	// Badge de rang, aligné à droite
	ctx.font = `bold 20px ${FONT_SEMI}`;
	const rankW = ctx.measureText(rankLabel).width + 34;
	roundRect(ctx, W - padX - rankW, 90, rankW, 42, 21);
	ctx.fillStyle = `${theme.accentFrom}22`;
	ctx.fill();
	ctx.strokeStyle = `${theme.accentFrom}66`;
	ctx.lineWidth = 1;
	ctx.stroke();
	ctx.fillStyle = theme.accentFrom;
	ctx.textAlign = "center";
	ctx.fillText(rankLabel, W - padX - rankW / 2, 118);
	ctx.textAlign = "left";

	// Libellé sous le nom
	ctx.font = `16px ${FONT_SEMI}`;
	ctx.fillStyle = theme.textSecondary;
	ctx.fillText("PROGRESSION VERS LE NIVEAU SUIVANT", rightX, 158);

	// ── Barre d'XP ──
	const barY = 185;
	const barH = 26;
	const barW = rightW;

	roundRect(ctx, rightX, barY, barW, barH, barH / 2);
	ctx.fillStyle = theme.trackColor;
	ctx.fill();

	const filledW = Math.max(barH, barW * progressRatio);
	const barGrad = ctx.createLinearGradient(rightX, 0, rightX + filledW, 0);
	barGrad.addColorStop(0, theme.accentFrom);
	barGrad.addColorStop(1, theme.accentTo);

	roundRect(ctx, rightX, barY, filledW, barH, barH / 2);
	ctx.fillStyle = barGrad;
	ctx.fill();

	// Texte XP sous la barre
	ctx.font = `15px ${FONT_SEMI}`;
	ctx.fillStyle = theme.textSecondary;
	ctx.fillText(`${currentExp} / ${expNextLevel} XP`, rightX, barY + barH + 28);

	ctx.textAlign = "right";
	ctx.fillStyle = theme.textMuted;
	ctx.font = `13px ${FONT_SEMI}`;
	ctx.fillText(`${Math.round(progressRatio * 100)}%`, rightX + barW, barY + barH + 28);
	ctx.textAlign = "left";

	// ── Ligne de statistiques additionnelle ──
	const statsY = 270;
	ctx.strokeStyle = "rgba(255,255,255,0.08)";
	ctx.beginPath();
	ctx.moveTo(rightX, statsY - 20);
	ctx.lineTo(rightX + barW, statsY - 20);
	ctx.stroke();

	function stat(x, label, value) {
		ctx.font = `12px ${FONT_SEMI}`;
		ctx.fillStyle = theme.textMuted;
		ctx.fillText(label, x, statsY + 8);
		ctx.font = `bold 20px ${FONT_BOLD}`;
		ctx.fillStyle = theme.textPrimary;
		ctx.fillText(value, x, statsY + 34);
	}

	const statGap = barW / 3;
	stat(rightX, "NIVEAU", String(level));
	stat(rightX + statGap, "CLASSEMENT", rankLabel);
	stat(rightX + statGap * 2, "EXPÉRIENCE TOTALE", String(currentExp + levelToExp(level, deltaNext)));

	return canvas.toBuffer("image/png");
}
