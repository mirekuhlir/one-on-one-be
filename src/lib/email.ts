import { Resend } from "resend";
import { authEnv } from "./env.js";

type AuthEmailInput = {
	to: string;
	subject: string;
	previewText: string;
	body: string;
	actionLabel: string;
	actionUrl: string;
};

const resend = authEnv.resendApiKey ? new Resend(authEnv.resendApiKey) : null;

function assertEmailConfig() {
	if (!resend || !authEnv.resendFromEmail) {
		throw new Error(
			"Auth email delivery is not configured. Set RESEND_API_KEY and RESEND_FROM_EMAIL.",
		);
	}

	return {
		resend,
		from: authEnv.resendFromEmail,
	};
}

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

/** Minimal semantic HTML: headings, paragraphs, plain link — no layout/styling. */
function renderHtml({
	subject,
	previewText,
	body,
	actionLabel,
	actionUrl,
}: Omit<AuthEmailInput, "to">) {
	const e = escapeHtml;
	return `<h1>${e(subject)}</h1>
<h2>${e(previewText)}</h2>
<p>${e(body)}</p>
<p><a href="${e(actionUrl)}">${e(actionLabel)}</a></p>
<p>If the link does not work, copy this URL:</p>
<p>${e(actionUrl)}</p>`;
}

function renderPlainText({
	subject,
	previewText,
	body,
	actionLabel,
	actionUrl,
}: Omit<AuthEmailInput, "to">) {
	return [
		subject,
		"",
		previewText,
		"",
		body,
		"",
		`${actionLabel}: ${actionUrl}`,
		"",
		"If the link does not work, copy this URL:",
		actionUrl,
	].join("\n");
}

async function sendAuthEmail({
	to,
	subject,
	previewText,
	body,
	actionLabel,
	actionUrl,
}: AuthEmailInput) {
	const emailConfig = assertEmailConfig();

	const { data, error } = await emailConfig.resend.emails.send({
		from: emailConfig.from,
		to,
		subject,
		text: renderPlainText({
			subject,
			previewText,
			body,
			actionLabel,
			actionUrl,
		}),
		html: renderHtml({
			subject,
			previewText,
			body,
			actionLabel,
			actionUrl,
		}),
	});

	if (error) {
		throw new Error(`Resend API error (${error.name}): ${error.message}`);
	}

	if (!data?.id) {
		throw new Error("Resend API returned no email id");
	}
}

export async function sendVerificationEmail(input: {
	to: string;
	url: string;
}) {
	await sendAuthEmail({
		to: input.to,
		subject: "Verify your email",
		previewText: "Confirm your email address to finish registration",
		body: "Open the link below to verify your email address and activate your account.",
		actionLabel: "Verify email",
		actionUrl: input.url,
	});
}

export async function sendPasswordResetEmail(input: {
	to: string;
	url: string;
}) {
	await sendAuthEmail({
		to: input.to,
		subject: "Reset your password",
		previewText: "Use this link to set a new password",
		body: "Open the link below to choose a new password for your account. If you did not request this, you can ignore this email.",
		actionLabel: "Reset password",
		actionUrl: input.url,
	});
}

export async function sendExistingUserSignUpNotice(input: { to: string }) {
	await sendAuthEmail({
		to: input.to,
		subject: "Someone tried to register with your email",
		previewText: "Security notice for your account email",
		body: "A registration attempt was made using this email address. If that was you, try signing in instead. If not, no action is required.",
		actionLabel: "Open app",
		actionUrl:
			authEnv.clientOrigins[0] ||
			authEnv.betterAuthUrl ||
			"http://localhost:4000",
	});
}
