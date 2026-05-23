import type {
	Handler,
	HandlerEvent,
	HandlerResponse,
} from "@netlify/functions";

import { STORAGE_KEYS } from "../../src/shared/constants";

const resolveBaseUrl = (event: HandlerEvent) => {
	const configuredBaseUrl = process.env.URL || process.env.DEPLOY_PRIME_URL;
	if (configuredBaseUrl) {
		return configuredBaseUrl.replace(/\/$/, "");
	}

	const forwardedHost =
		event.headers["x-forwarded-host"] ||
		event.headers.host ||
		event.multiValueHeaders.host?.[0];
	const forwardedProtocol = event.headers["x-forwarded-proto"] || "https";
	if (!forwardedHost) {
		throw new Error("Unable to determine callback host.");
	}

	return `${forwardedProtocol}://${forwardedHost}`.replace(/\/$/, "");
};

const handler: Handler = async (event): Promise<HandlerResponse> => {
	const clientId = process.env.VITE_ANNICT_CLIENT_ID;
	const clientSecret = process.env.ANNICT_CLIENT_SECRET;
	if (!clientId || !clientSecret) {
		return {
			body: "Missing Annict OAuth environment variables.",
			statusCode: 500,
		};
	}

	const code = event.queryStringParameters?.code;
	const error = event.queryStringParameters?.error;
	if (typeof error === "string") {
		return {
			body: "Annict authorization was denied.",
			statusCode: 403,
		};
	}

	if (typeof code !== "string") {
		return {
			body: "Missing authorization code.",
			statusCode: 400,
		};
	}

	const redirectUri = `${resolveBaseUrl(event)}/.netlify/functions/annict-callback`;
	const tokenResponse = await fetch("https://api.annict.com/oauth/token", {
		body: JSON.stringify({
			client_id: clientId,
			client_secret: clientSecret,
			code,
			grant_type: "authorization_code",
			redirect_uri: redirectUri,
		}),
		headers: {
			"Content-Type": "application/json",
			"User-Agent": "tamate/1.0 (+https://github.com/ci7lus/tamate)",
		},
		method: "POST",
	});

	if (!tokenResponse.ok) {
		return {
			body: await tokenResponse.text(),
			statusCode: 502,
		};
	}

	const payload = (await tokenResponse.json()) as { access_token?: string };
	if (typeof payload.access_token !== "string") {
		return {
			body: "Annict access token was not returned.",
			statusCode: 502,
		};
	}

	return {
		body: `<!doctype html><html lang="ja"><body><script>
localStorage.setItem(${JSON.stringify(STORAGE_KEYS.annictAccessToken)}, ${JSON.stringify(payload.access_token)});
const pendingPath = localStorage.getItem(${JSON.stringify(STORAGE_KEYS.pendingAuthPath)});
const lastVisitedPath = localStorage.getItem(${JSON.stringify(STORAGE_KEYS.lastVisitedPath)}) || "/";
localStorage.removeItem(${JSON.stringify(STORAGE_KEYS.pendingAuthPath)});
location.replace(pendingPath || lastVisitedPath);
</script></body></html>`,
		headers: {
			"Cache-Control": "no-store",
			"Content-Type": "text/html; charset=utf-8",
		},
		statusCode: 200,
	};
};

export { handler };
