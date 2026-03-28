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

function renderHtml({
	subject,
	previewText,
	body,
	actionLabel,
	actionUrl,
}: Omit<AuthEmailInput, "to">) {
	return `
		<div style="background:#f4f1ea;padding:32px 16px;font-family:Georgia,'Times New Roman',serif;color:#1f2937;">
			<div style="max-width:560px;margin:0 auto;background:#fffdf8;border:1px solid #e7dfd1;border-radius:18px;padding:32px;">
				<p style="margin:0 0 12px;font-size:12px;letter-spacing:0.12em;text-transform:uppercase;color:#8a6a3f;">
					${previewText}
				</p>
				<h1 style="margin:0 0 16px;font-size:28px;line-height:1.2;color:#111827;">${subject}</h1>
				<p style="margin:0 0 24px;font-size:16px;line-height:1.7;color:#374151;">${body}</p>
				<p style="margin:0 0 28px;">
					<a href="${actionUrl}" style="display:inline-block;background:#9a3412;color:#fffdf8;text-decoration:none;padding:14px 22px;border-radius:999px;font-size:15px;font-weight:600;">
						${actionLabel}
					</a>
				</p>
				<p style="margin:0;font-size:13px;line-height:1.6;color:#6b7280;word-break:break-all;">
					If the button does not work, open this URL:<br />${actionUrl}
				</p>
			</div>
		</div>
	`;
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

	await emailConfig.resend.emails.send({
		from: emailConfig.from,
		to,
		subject,
		text: `${body}\n\n${actionLabel}: ${actionUrl}`,
		html: renderHtml({
			subject,
			previewText,
			body,
			actionLabel,
			actionUrl,
		}),
	});
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
