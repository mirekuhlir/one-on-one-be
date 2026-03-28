const SUPPORTED_SOCIAL_PROVIDERS = [
	"google",
	"apple",
	"github",
	"facebook",
] as const;

type SupportedSocialProvider = (typeof SUPPORTED_SOCIAL_PROVIDERS)[number];

type ProviderEnvConfig = {
	clientIdEnv: string;
	clientSecretEnv: string;
};

const PROVIDER_ENV_CONFIG: Record<SupportedSocialProvider, ProviderEnvConfig> =
	{
		google: {
			clientIdEnv: "GOOGLE_CLIENT_ID",
			clientSecretEnv: "GOOGLE_CLIENT_SECRET",
		},
		apple: {
			clientIdEnv: "APPLE_CLIENT_ID",
			clientSecretEnv: "APPLE_CLIENT_SECRET",
		},
		github: {
			clientIdEnv: "GITHUB_CLIENT_ID",
			clientSecretEnv: "GITHUB_CLIENT_SECRET",
		},
		facebook: {
			clientIdEnv: "FACEBOOK_CLIENT_ID",
			clientSecretEnv: "FACEBOOK_CLIENT_SECRET",
		},
	};

function readEnv(name: string) {
	const value = process.env[name]?.trim();
	return value ? value : undefined;
}

function readCsvEnv(name: string) {
	const value = readEnv(name);
	if (!value) {
		return [];
	}

	return value
		.split(",")
		.map((item) => item.trim())
		.filter(Boolean);
}

function buildSocialProviderEnv() {
	return SUPPORTED_SOCIAL_PROVIDERS.reduce(
		(acc, provider) => {
			const { clientIdEnv, clientSecretEnv } = PROVIDER_ENV_CONFIG[provider];
			const clientId = readEnv(clientIdEnv);
			const clientSecret = readEnv(clientSecretEnv);

			acc[provider] = {
				clientId,
				clientSecret,
				enabled: Boolean(clientId && clientSecret),
			};

			return acc;
		},
		{} as Record<
			SupportedSocialProvider,
			{ clientId?: string; clientSecret?: string; enabled: boolean }
		>,
	);
}

export const authEnv = {
	isProduction: process.env.NODE_ENV === "production",
	betterAuthSecret: readEnv("BETTER_AUTH_SECRET"),
	betterAuthUrl: readEnv("BETTER_AUTH_URL"),
	databaseUrl: readEnv("DATABASE_URL"),
	clientOrigins: readCsvEnv("CLIENT_ORIGIN"),
	resendApiKey: readEnv("RESEND_API_KEY"),
	resendFromEmail: readEnv("RESEND_FROM_EMAIL"),
	socialProviders: buildSocialProviderEnv(),
};

export function getConfiguredSocialProviders() {
	return SUPPORTED_SOCIAL_PROVIDERS.map((provider) => ({
		id: provider,
		enabled: authEnv.socialProviders[provider].enabled,
	}));
}

export function assertAuthRuntimeConfig() {
	const missing = [
		["BETTER_AUTH_SECRET", authEnv.betterAuthSecret],
		["BETTER_AUTH_URL", authEnv.betterAuthUrl],
		["DATABASE_URL", authEnv.databaseUrl],
		["RESEND_API_KEY", authEnv.resendApiKey],
		["RESEND_FROM_EMAIL", authEnv.resendFromEmail],
	].filter(([, value]) => !value);

	if (missing.length > 0) {
		throw new Error(
			`Missing required auth environment variables: ${missing
				.map(([name]) => name)
				.join(", ")}`,
		);
	}
}
