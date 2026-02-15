import type { FastifyInstance } from "fastify";

function parseTimeoutMs(value: string | undefined) {
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		return 10_000;
	}
	return Math.floor(parsed);
}

function parseTtl(value: string | undefined) {
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed < 0) {
		return 0;
	}
	return Math.floor(parsed);
}

type IceServer = {
	urls?: string[] | string;
};

function toUrlArray(urls: IceServer["urls"]) {
	if (Array.isArray(urls)) {
		return urls;
	}
	if (typeof urls === "string") {
		return [urls];
	}
	return [];
}

export async function turnRoutes(fastify: FastifyInstance) {
	fastify.get("/credentials", async (_request, reply) => {
		const keyId = process.env.CF_TURN_KEY_ID;
		const apiToken = process.env.CF_TURN_API_TOKEN;
		const ttl = parseTtl(process.env.CF_TURN_TTL);
		const baseUrl =
			process.env.CF_TURN_BASE_URL ?? "https://rtc.live.cloudflare.com";
		const timeoutMs = parseTimeoutMs(process.env.CF_TURN_TIMEOUT_MS);

		if (!keyId || !apiToken) {
			reply.status(500).send({
				error: "Missing TURN configuration",
				code: "TURN_CONFIG_MISSING",
			});
			return;
		}

		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

		try {
			const response = await fetch(
				`${baseUrl}/v1/turn/keys/${keyId}/credentials/generate-ice-servers`,
				{
					method: "POST",
					headers: {
						Authorization: `Bearer ${apiToken}`,
						"Content-Type": "application/json",
					},
					body: JSON.stringify({ ttl }),
					signal: controller.signal,
				},
			);

			reply.header("Cache-Control", "no-store");

			const contentType = response.headers.get("content-type") ?? "";
			const isJson = contentType.includes("application/json");

			if (!response.ok) {
				const upstreamBody = isJson
					? await response.json().catch(() => null)
					: await response.text().catch(() => null);

				fastify.log.error(
					{ status: response.status, upstreamBody },
					"Cloudflare TURN upstream error",
				);

				reply.status(response.status).send({
					error: "Unable to fetch TURN credentials",
					code: "TURN_UPSTREAM_ERROR",
					status: response.status,
					upstream: upstreamBody,
				});
				return;
			}

			if (isJson) {
				const data = (await response.json()) as { iceServers?: IceServer[] };
				const servers = Array.isArray(data.iceServers) ? data.iceServers : [];

				const stunUrls = servers.flatMap((server) =>
					toUrlArray(server.urls).filter((url) => url.startsWith("stun:")),
				);

				const turnUrls = servers.flatMap((server) =>
					toUrlArray(server.urls).filter(
						(url) => url.startsWith("turn:") || url.startsWith("turns:"),
					),
				);

				reply.send({
					stun: stunUrls,
					turn: turnUrls,
				});
				return;
			}

			const text = await response.text();
			reply.send({ data: text });
		} catch (error) {
			if (error instanceof Error && error.name === "AbortError") {
				reply.status(504).send({
					error: "TURN upstream timeout",
					code: "TURN_UPSTREAM_TIMEOUT",
				});
				return;
			}

			fastify.log.error(error, "TURN endpoint failure");
			reply.status(502).send({
				error: "Unable to fetch TURN credentials",
				code: "TURN_FETCH_FAILED",
			});
		} finally {
			clearTimeout(timeoutId);
		}
	});
}
