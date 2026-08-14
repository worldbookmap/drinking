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

	if (hasText(entry?.wineCountry) || hasText(entry?.wineCountryCustom) || detailLabel === "국가" || detailLabel === "지역") {
		return "wine";
	}

	if (hasText(entry?.teaSubcategory) || detailLabel === "하위카테고리" || detailLabel === "품종" || TEA_SUBCATEGORIES.has(caskType)) {
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
		if (getEntryDrinkCategory(entry) === "tea" && entry.detailLabel === "하위카테고리") {
			return "품종";
		}
		if (getEntryDrinkCategory(entry) === "wine" && entry.detailLabel === "국가") {
			return "지역";
		}
		return entry.detailLabel;
	}

	const drinkCategory = getEntryDrinkCategory(entry);
	if (drinkCategory === "wine") {
		return "지역";
	}

	if (drinkCategory === "tea") {
		return "품종";
	}

	return "캐스크";
}

function getDrinkDetailValue(entry) {
	if (hasText(entry?.detailValue)) {
		return String(entry.detailValue).trim();
	}

	const drinkCategory = getEntryDrinkCategory(entry);
	if (drinkCategory === "wine") {
		return String(entry?.wineCountry || entry?.wineCountryCustom || "").trim();
	}

	if (drinkCategory === "tea") {
		return String(entry?.teaSubcategory || "").trim();
	}

	return String(entry?.caskType || "").trim();
}

function createEmptyWineRating() {
	return {
		body: "",
		acidity: "",
		tannin: "",
		alcohol: "",
		sweetness: "",
		complexity: "",
		balance: ""
	};
}

function normalizeWineRating(rating) {
	const normalized = createEmptyWineRating();
	if (!rating || typeof rating !== "object") {
		return normalized;
	}

	for (const key of Object.keys(normalized)) {
		const value = Number(rating[key]);
		normalized[key] = Number.isInteger(value) && value >= 1 && value <= 5 ? String(value) : "";
	}

	return normalized;
}

function getConfig() {
	return {
		token: process.env.GITHUB_TOKEN,
		owner: process.env.GITHUB_OWNER || "worldbookmap",
		repo: process.env.GITHUB_REPO || "drinking",
		branch: process.env.GITHUB_BRANCH || "main",
		path: process.env.GITHUB_RECORDS_PATH || "records.json",
		uploadDir: process.env.GITHUB_UPLOAD_DIR || "uploads"
	};
}

function sendJson(res, status, body) {
	res.status(status);
	res.setHeader("Content-Type", "application/json; charset=utf-8");
	res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
	res.setHeader("Pragma", "no-cache");
	res.setHeader("Expires", "0");
	res.end(JSON.stringify(body));
}

function normalizeEntries(entries) {
	if (!Array.isArray(entries)) {
		return [];
	}

	return entries.map((entry) => {
		const drinkCategory = getEntryDrinkCategory(entry);
		const rating = normalizeWineRating(entry?.rating);
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
			teaLeafImageUrl: entry?.teaLeafImageUrl || entry?.labelImageUrl || "",
			labelImageUrl: entry?.labelImageUrl || entry?.teaLeafImageUrl || "",
			whiskyDistillery: entry?.whiskyDistillery || "",
			caskType: entry?.caskType || "",
			wineCountry: entry?.wineCountry || "",
			wineCountryCustom: entry?.wineCountryCustom || "",
			wineRegion: entry?.wineRegion || "",
			teaSubcategory: entry?.teaSubcategory || "",
			teaChinaProvince: entry?.teaChinaProvince || "",
			detailLabel: getDrinkDetailLabel(entry),
			detailValue: getDrinkDetailValue(entry),
			nose: entry?.nose || "",
			palate: entry?.palate || "",
			rating,
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
	const path = `/repos/${config.owner}/${config.repo}/contents/${encodeURIComponent(config.path)}?ref=${encodeURIComponent(config.branch)}&t=${Date.now()}`;

	const file = await githubRequest(path, {
		headers: {
			Authorization: `Bearer ${config.token}`,
			Accept: "application/vnd.github+json",
			"Cache-Control": "no-cache"
		}
	});

	const raw = Buffer.from(file.content, "base64").toString("utf8");
	const parsed = JSON.parse(raw);
	const normalized = normalizeRecordsPayload(parsed);
	return {
		entries: normalized.entries,
		customTraitCatalogs: normalized.customTraitCatalogs,
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

function encodePathBySegment(path) {
	return String(path || "")
		.split("/")
		.filter(Boolean)
		.map((segment) => encodeURIComponent(segment))
		.join("/");
}

function normalizeUploadDir(uploadDir) {
	return String(uploadDir || "uploads").replace(/^\/+|\/+$/g, "") || "uploads";
}

function extractManagedUploadPath(url, config) {
	const normalizedUploadDir = normalizeUploadDir(config.uploadDir);
	const cleaned = String(url || "").trim();
if (!cleaned) {
		return "";
	}

	if (cleaned.startsWith(`${normalizedUploadDir}/`)) {
		return cleaned;
	}

	try {
		const parsed = new URL(cleaned);
		if (parsed.hostname !== "raw.githubusercontent.com") {
			return "";
		}

		const parts = parsed.pathname.split("/").filter(Boolean);
		if (parts.length < 4) {
			return "";
		}

		const owner = parts[0];
		const repo = parts[1];
		if (owner !== config.owner || repo !== config.repo) {
			return "";
		}

		const relativePath = decodeURIComponent(parts.slice(3).join("/"));
		if (!relativePath.startsWith(`${normalizedUploadDir}/`)) {
			return "";
		}

		return relativePath;
	} catch {
		return "";
	}
}

function collectImageUrls(entries) {
	const set = new Set();
	for (const entry of entries || []) {
		const imageUrl = String(entry?.imageUrl || "").trim();
		if (imageUrl) {
			set.add(imageUrl);
		}

		const teaLeafImageUrl = String(entry?.teaLeafImageUrl || "").trim();
		if (teaLeafImageUrl) {
			set.add(teaLeafImageUrl);
		}

		const labelImageUrl = String(entry?.labelImageUrl || "").trim();
		if (labelImageUrl) {
			set.add(labelImageUrl);
		}
	}
	return set;
}

function collectDeletedManagedUploadPaths(previousEntries, nextEntries, config) {
	const previousUrls = collectImageUrls(previousEntries);
	const nextUrls = collectImageUrls(nextEntries);
	const paths = new Set();

	for (const url of previousUrls) {
		if (nextUrls.has(url)) {
			continue;
		}

		const managedPath = extractManagedUploadPath(url, config);
		if (managedPath) {
			paths.add(managedPath);
		}
	}

	return [...paths];
}

async function getFileShaFromGithub(config, filePath) {
	const encodedPath = encodePathBySegment(filePath);
	const path = `/repos/${config.owner}/${config.repo}/contents/${encodedPath}?ref=${encodeURIComponent(config.branch)}`;

	try {
		const file = await githubRequest(path, {
			headers: {
				Authorization: `Bearer ${config.token}`,
				Accept: "application/vnd.github+json"
			}
		});
		return String(file?.sha || "");
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error || "");
		if (message.includes("Not Found")) {
			return "";
		}
		throw error;
	}
}

async function deleteFileFromGithub(config, filePath, sha) {
	const encodedPath = encodePathBySegment(filePath);
	const path = `/repos/${config.owner}/${config.repo}/contents/${encodedPath}`;

	return githubRequest(path, {
		method: "DELETE",
		headers: {
			Authorization: `Bearer ${config.token}`,
			Accept: "application/vnd.github+json",
			"Content-Type": "application/json"
		},
		body: JSON.stringify({
			message: `Delete orphaned image ${filePath} from Vercel app`,
			sha,
			branch: config.branch
		})
	});
}

async function deleteUploadsFromGithub(config, paths) {
	let deleted = 0;
	let skipped = 0;
	const failed = [];

	for (const path of paths) {
		try {
			const sha = await getFileShaFromGithub(config, path);
			if (!sha) {
				skipped += 1;
				continue;
			}

			await deleteFileFromGithub(config, path, sha);
			deleted += 1;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error || "Unknown delete error");
			if (message.includes("Not Found")) {
				skipped += 1;
				continue;
			}
			failed.push({ path, error: message });
		}
	}

	return {
		requested: paths.length,
		deleted,
		skipped,
		failed
	};
}

export default async function handler(req, res) {
	if (req.method !== "GET" && req.method !== "POST" && req.method !== "DELETE") {
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
			const { entries, customTraitCatalogs } = await readRecordsFromGithub(config);
			return sendJson(res, 200, { entries, customTraitCatalogs });
		}

		if (req.method === "DELETE") {
			const removedUploadPaths = collectDeletedManagedUploadPaths([{ imageUrl: req.body?.url || "" }], [], config);
			const imageCleanup = await deleteUploadsFromGithub(config, removedUploadPaths);
			return sendJson(res, 200, {
				ok: true,
				imageCleanup
			});
		}

		const incomingEntries = normalizeEntries(req.body?.entries);
		const { entries: previousEntries, sha } = await readRecordsFromGithub(config);
		const result = await writeRecordsToGithub(config, incomingEntries, sha);
		const removedUploadPaths = collectDeletedManagedUploadPaths(previousEntries, incomingEntries, config);
		const imageCleanup = await deleteUploadsFromGithub(config, removedUploadPaths);

		return sendJson(res, 200, {
			ok: true,
			commitSha: result.commit?.sha || "",
			imageCleanup
		});
	} catch (error) {
		return sendJson(res, 500, {
			error: error instanceof Error ? error.message : "Unknown API error"
		});
	}
}
