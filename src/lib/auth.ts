import { betterAuth } from "better-auth";
import { anonymous } from "better-auth/plugins";
import { Pool } from "pg";

export const auth = betterAuth({
	database: new Pool({
		connectionString: process.env.DATABASE_URL,
	}),
	advanced: {
		useSecureCookies: true,
		defaultCookieAttributes: {
			httpOnly: true,
			secure: true,
			sameSite: "none",
		},
	},
	emailAndPassword: {
		enabled: true,
	},
	plugins: [anonymous()],

	trustedOrigins: process.env.CLIENT_ORIGIN
		? process.env.CLIENT_ORIGIN.split(",").map((origin) => origin.trim())
		: [],
});
