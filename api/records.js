const API_BASE = "https://api.github.com";
const WINE_CATEGORIES = new Set(["스파클링", "화이트", "레드", "디저트"]);
const TEA_CATEGORIES = new Set(["녹차", "백차", "황차", "청차", "홍차", "흑차"]);
const TEA_SUBCATEGORIES = new Set(["육보차", "고수차", "무이암차", "보이차", "단총"]);

function hasText(value) {
	return Boolean(String(value || "").trim());
}

function inferLegacyDrinkCategory(entry) {
	const category = String(entry?.category || "").trim();
	const detailLabel = String(entry?.detailLabel || "").trim();
	const caskType = String(entry?.caskType || "").trim();

	if (hasText(entry?.wineCountry) || hasText(entry?.wineCountryCustom) || detailLabel === "국가") {
		return "wine";
	}

	if (hasText(entry?.teaSubcategory) || detailLabel === "하위카테고리" || TEA_SUBCATEGORIES.has(caskType)) {
		return "tea";
	}

	if (WINE_CATEGORIES.has(category)) {
		return "wine";
	}

	if (TEA_CATEGORIES.has(category)) {
		return "tea";
	}

	return "whisky";
}

function getEntryDrinkCategory(entry) {
	const explicit = String(entry?.drinkCategory || entry?.drinkType || "").trim();
	if (explicit === "whisky" || explicit === "wine" || explicit === "tea") {
		return explicit;
	}

	return inferLegacyDrinkCategory(entry);
}

function getDrinkDetailLabel(entry) {
	if (hasText(entry?.detailLabel)) {
		return entry.detailLabel;
	}

	const drinkCategory = getEntryDrinkCategory(entry);
	if (drinkCategory === "wine") {
		return "국가";
	}

	if (drinkCategory === "tea") {
		return "하위카테고리";
	}

	return "캐스크";
}

function getDrinkDetailValue(entry) {
	if (hasText(entry?.detailValue)) {
		return String(entry.detailValue).trim();
	}

	const drinkCategory = getEntryDrinkCategory(entry);
	if (drinkCategory === "wine") {
		return String(entry?.wineCountryCustom || entry?.wineCountry || "").trim();
	}

	if (drinkCategory === "tea") {
		return String(entry?.teaSubcategory || "").trim();
	}

	return String(entry?.caskType || "").trim();
}

function getConfig() {
	return {
		token: process.env.GITHUB_TOKEN,
		owner: process.env.GITHUB_OWNER || "worldbookmap",
		repo: process.env.GITHUB_REPO || "drinking",
		branch: process.env.GITHUB_BRANCH || "main",
		path: process.env.GITHUB_RECORDS_PATH || "records.json"
	};
}

function sendJson(res, status, body) {
	res.status(status).setHeader("Content-Type", "application/json; charset=utf-8");
	res.end(JSON.stringify(body));
}

function normalizeEntries(entries) {
	if (!Array.isArray(entries)) {
		return [];
	}

	return entries.map((entry) => {
		const drinkCategory = getEntryDrinkCategory(entry);
		return {
			id: entry?.id || crypto.randomUUID(),
			createdAt: entry?.createdAt || "",
			date: entry?.date || "",
			place: entry?.place || "",
			drinker: entry?.drinker || "",
			whisky: entry?.whisky || "",
			drinkCategory,
			drinkType: drinkCategory,
			category: entry?.category || "",
			imageUrl: entry?.imageUrl || "",
			caskType: entry?.caskType || "",
			wineCountry: entry?.wineCountry || "",
			wineCountryCustom: entry?.wineCountryCustom || "",
			teaSubcategory: entry?.teaSubcategory || "",
			detailLabel: getDrinkDetailLabel(entry),
			detailValue: getDrinkDetailValue(entry),
			nose: entry?.nose || "",
			palate: entry?.palate || "",
			finish: entry?.finish || "",
			memo: entry?.memo || ""
		};
	});
}

async function githubRequest(path, options = {}) {
	const response = await fetch(`${API_BASE}${path}`, options);
	const text = await response.text();
	let data;

	try {
		data = text ? JSON.parse(text) : {};
	} catch {
		data = { message: text || "GitHub API parse error" };
	}

	if (!response.ok) {
		throw new Error(data.message || "GitHub API request failed");
	}

	return data;
}

async function readRecordsFromGithub(config) {
	const path = `/repos/${config.owner}/${config.repo}/contents/${encodeURIComponent(config.path)}?ref=${encodeURIComponent(config.branch)}`;

	const file = await githubRequest(path, {
		headers: {
			Authorization: `Bearer ${config.token}`,
			Accept: "application/vnd.github+json"
		}
	});

	const raw = Buffer.from(file.content, "base64").toString("utf8");
	const parsed = JSON.parse(raw);
	return {
		entries: normalizeEntries(parsed),
		sha: file.sha
	};
}

async function writeRecordsToGithub(config, entries, previousSha) {
	const path = `/repos/${config.owner}/${config.repo}/contents/${encodeURIComponent(config.path)}`;
	const payload = Buffer.from(JSON.stringify(entries, null, 2), "utf8").toString("base64");

	return githubRequest(path, {
		method: "PUT",
		headers: {
			Authorization: `Bearer ${config.token}`,
			Accept: "application/vnd.github+json",
			"Content-Type": "application/json"
		},
		body: JSON.stringify({
			message: `Update ${config.path} from Vercel app`,
			content: payload,
			branch: config.branch,
			sha: previousSha
		})
	});
}

export default async function handler(req, res) {
	if (req.method !== "GET" && req.method !== "POST") {
		return sendJson(res, 405, { error: "Method not allowed" });
	}

	const config = getConfig();
	if (!config.token) {
		return sendJson(res, 500, {
			error: "Missing GITHUB_TOKEN in Vercel environment variables"
		});
	}

	try {
		if (req.method === "GET") {
			const { entries } = await readRecordsFromGithub(config);
			return sendJson(res, 200, { entries });
		}

		const incomingEntries = normalizeEntries(req.body?.entries);
		const { sha } = await readRecordsFromGithub(config);
		const result = await writeRecordsToGithub(config, incomingEntries, sha);

		return sendJson(res, 200, {
			ok: true,
			commitSha: result.commit?.sha || ""
		});
	} catch (error) {
		return sendJson(res, 500, {
			error: error instanceof Error ? error.message : "Unknown API error"
		});
	}
}
