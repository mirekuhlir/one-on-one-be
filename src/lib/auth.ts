import { betterAuth } from "better-auth";
import { fromNodeHeaders } from "better-auth/node";
import { anonymous } from "better-auth/plugins";
import type { FastifyReply } from "fastify";
import { Pool } from "pg";
import {
	sendExistingUserSignUpNotice,
	sendPasswordResetEmail,
	sendVerificationEmail,
} from "./email.js";
import { authEnv, getConfiguredSocialProviders } from "./env.js";

export const dbPool = new Pool({
	connectionString: process.env.DATABASE_URL,
});

const useSecureCookies =
	authEnv.isProduction ||
	authEnv.betterAuthUrl?.startsWith("https://") === true;

const socialProviders = Object.fromEntries(
	getConfiguredSocialProviders()
		.filter((provider) => provider.enabled)
		.map((provider) => {
			const config = authEnv.socialProviders[provider.id];

			return [
				provider.id,
				{
					clientId: config.clientId,
					clientSecret: config.clientSecret,
				},
			];
		}),
);

export const auth = betterAuth({
	database: dbPool,
	session: {
		// Keep session lifetime aligned with anonymous user cleanup.
		expiresIn: 60 * 60 * 24,
		// Prevent rolling refresh from extending sessions past the 24h cleanup window.
		disableSessionRefresh: true,
	},
	advanced: {
		useSecureCookies,
		defaultCookieAttributes: {
			httpOnly: true,
			secure: useSecureCookies,
			sameSite: useSecureCookies ? "none" : "lax",
		},
	},
	account: {
		accountLinking: {
			enabled: true,
			allowDifferentEmails: false,
			updateUserInfoOnLink: false,
			trustedProviders: [],
		},
	},
	emailVerification: {
		sendOnSignIn: true,
		sendOnSignUp: true,
		sendVerificationEmail: async ({ user, url }) => {
			await sendVerificationEmail({
				to: user.email,
				url,
			});
		},
	},
	emailAndPassword: {
		enabled: true,
		requireEmailVerification: true,
		revokeSessionsOnPasswordReset: true,
		resetPasswordTokenExpiresIn: 60 * 60,
		sendResetPassword: async ({ user, url }) => {
			await sendPasswordResetEmail({
				to: user.email,
				url,
			});
		},
		onExistingUserSignUp: async ({ user }: { user: { email: string } }) => {
			await sendExistingUserSignUpNotice({
				to: user.email,
			});
		},
	},
	socialProviders,
	plugins: [
		anonymous({
			onLinkAccount: async ({ anonymousUser, newUser, ctx }) => {
				ctx.context.logger.info(
					"Anonymous user upgraded to persistent account",
					{
						anonymousUserId: anonymousUser.user.id,
						newUserId: newUser.user.id,
					},
				);
			},
		}),
	],

	trustedOrigins: authEnv.clientOrigins,
});

export function getConfiguredAuthProviders() {
	return getConfiguredSocialProviders();
}

export function getAuthSession(
	headers: Record<string, string | string[] | undefined>,
) {
	return auth.api.getSession({
		headers: fromNodeHeaders(headers),
	});
}

export async function getUserAuthState(userId: string) {
	const result = await dbPool.query<{ providerId: string }>(
		`SELECT DISTINCT "providerId" AS "providerId"
		 FROM public.account
		 WHERE "userId" = $1
		 ORDER BY "providerId" ASC`,
		[userId],
	);

	const providers = result.rows.map((row) => row.providerId);

	return {
		providers,
		hasPassword: providers.includes("credential"),
	};
}

export function buildAuthHeaders(
	headers: Record<string, string | string[] | undefined>,
) {
	const requestHeaders = new Headers();

	Object.entries(headers).forEach(([key, value]) => {
		if (!value) {
			return;
		}

		if (Array.isArray(value)) {
			value.forEach((entry) => {
				requestHeaders.append(key, entry);
			});
			return;
		}

		requestHeaders.append(key, value.toString());
	});

	return requestHeaders;
}

export async function proxyAuthRequest(input: {
	method: string;
	path: string;
	headers: Record<string, string | string[] | undefined>;
	body?: unknown;
}) {
	if (!authEnv.betterAuthUrl) {
		throw new Error("BETTER_AUTH_URL is not configured");
	}

	const request = new Request(new URL(input.path, authEnv.betterAuthUrl), {
		method: input.method,
		headers: buildAuthHeaders(input.headers),
		...(input.body ? { body: JSON.stringify(input.body) } : {}),
	});

	return auth.handler(request);
}

export async function sendAuthResponse(
	reply: FastifyReply,
	response: Response,
) {
	reply.status(response.status);
	response.headers.forEach((value, key) => {
		reply.header(key, value);
	});

	const contentType = response.headers.get("content-type") || "";
	const payload = await response.text();

	if (!payload) {
		return reply.send(null);
	}

	if (contentType.includes("application/json")) {
		return reply.send(JSON.parse(payload));
	}

	return reply.send(payload);
}
