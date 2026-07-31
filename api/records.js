const API_BASE = "https://api.github.com";

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

	return entries.map((entry) => ({
		id: entry?.id || crypto.randomUUID(),
		date: entry?.date || "",
		place: entry?.place || "",
		drinker: entry?.drinker || "",
		whisky: entry?.whisky || "",
		category: entry?.category || "",
		imageUrl: entry?.imageUrl || "",
		caskType: entry?.caskType || "",
		nose: entry?.nose || "",
		palate: entry?.palate || "",
		finish: entry?.finish || "",
		memo: entry?.memo || ""
	}));
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
