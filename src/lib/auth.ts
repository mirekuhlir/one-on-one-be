import { betterAuth } from "better-auth";
import { anonymous } from "better-auth/plugins";
import { Pool } from "pg";

export const dbPool = new Pool({
	connectionString: process.env.DATABASE_URL,
});

export const auth = betterAuth({
	database: dbPool,
	advanced: {
		useSecureCookies: true,
		defaultCookieAttributes: {
			httpOnly: true,
			secure: true,
			//TODO
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
