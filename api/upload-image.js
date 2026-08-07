const API_BASE = "https://api.github.com";

function getConfig() {
	return {
		token: process.env.GITHUB_TOKEN,
		owner: process.env.GITHUB_OWNER || "worldbookmap",
		repo: process.env.GITHUB_REPO || "drinking",
		branch: process.env.GITHUB_BRANCH || "main",
		uploadDir: process.env.GITHUB_UPLOAD_DIR || "uploads",
		publicBase:
			process.env.GITHUB_PUBLIC_BASE ||
			`https://raw.githubusercontent.com/${process.env.GITHUB_OWNER || "worldbookmap"}/${process.env.GITHUB_REPO || "drinking"}/${process.env.GITHUB_BRANCH || "main"}`
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

function sanitizeFileName(name) {
	return (name || "image")
		.toLowerCase()
		.replace(/[^a-z0-9._-]/g, "-")
		.replace(/-+/g, "-")
		.slice(0, 60);
}

function getExtensionFromMime(mimeType) {
	const map = {
		"image/jpeg": "jpg",
		"image/png": "png",
		"image/webp": "webp",
		"image/gif": "gif",
		"image/heic": "heic",
		"image/heif": "heif"
	};
	return map[mimeType] || "jpg";
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

async function uploadToGithub(config, filePath, base64Content) {
	// Encode each path segment, but keep '/' as separators for GitHub contents API.
	const encodedPath = String(filePath)
		.split("/")
		.filter(Boolean)
		.map((segment) => encodeURIComponent(segment))
		.join("/");
	const apiPath = `/repos/${config.owner}/${config.repo}/contents/${encodedPath}`;

	return githubRequest(apiPath, {
		method: "PUT",
		headers: {
			Authorization: `Bearer ${config.token}`,
			Accept: "application/vnd.github+json",
			"Content-Type": "application/json"
		},
		body: JSON.stringify({
			message: `Upload image ${filePath} from Vercel app`,
			content: base64Content,
			branch: config.branch
		})
	});
}

export default async function handler(req, res) {
	if (req.method !== "POST") {
		return sendJson(res, 405, { error: "Method not allowed" });
	}

	const config = getConfig();
	if (!config.token) {
		return sendJson(res, 500, {
			error: "Missing GITHUB_TOKEN in Vercel environment variables"
		});
	}

	try {
		const { fileName, mimeType, dataUrl } = req.body || {};
		if (!dataUrl || typeof dataUrl !== "string") {
			return sendJson(res, 400, { error: "dataUrl is required" });
		}

		const matched = dataUrl.match(/^data:(.+);base64,(.+)$/);
		if (!matched) {
			return sendJson(res, 400, { error: "Invalid dataUrl format" });
		}

		const actualMimeType = mimeType || matched[1];
		if (!String(actualMimeType).startsWith("image/")) {
			return sendJson(res, 400, { error: "Only image uploads are allowed" });
		}

		const base64Content = matched[2];
		const extension = getExtensionFromMime(actualMimeType);
		const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
		const random = Math.random().toString(36).slice(2, 8);
		const baseName = sanitizeFileName(fileName).replace(/\.[a-z0-9]+$/, "") || "image";
		const relativePath = `${config.uploadDir}/${timestamp}-${baseName}-${random}.${extension}`;

		const uploadResult = await uploadToGithub(config, relativePath, base64Content);

		const publicBase = config.publicBase.replace(/\/$/, "");
		const branchUrl = `${publicBase}/${relativePath}`;
		const commitSha = uploadResult?.commit?.sha || "";
		const commitUrl = commitSha
			? `https://raw.githubusercontent.com/${config.owner}/${config.repo}/${commitSha}/${relativePath}`
			: "";
		const publicUrl = commitUrl || branchUrl;
		return sendJson(res, 200, {
			ok: true,
			url: publicUrl,
			path: relativePath,
			commitSha,
			branchUrl
		});
	} catch (error) {
		return sendJson(res, 500, {
			error: error instanceof Error ? error.message : "Unknown upload error"
		});
	}
}
