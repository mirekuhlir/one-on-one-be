import { access } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const currentFilePath = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(currentFilePath), "..");

async function main() {
	const migrationPathArg = process.argv[2]?.trim();

	if (!migrationPathArg) {
		throw new Error(
			"Missing migration path. Usage: npm run db:migrate -- database/migrations/<file>.sql",
		);
	}

	const databaseUrl = loadDatabaseUrl();
	const migrationPath = resolveMigrationPath(migrationPathArg);

	await access(migrationPath);

	await runCommand("psql", [
		databaseUrl,
		"-v",
		"ON_ERROR_STOP=1",
		"-1",
		"-f",
		migrationPath,
	]);

	console.log(`Applied migration ${migrationPath}`);
}

function loadDatabaseUrl() {
	dotenv.config({ path: resolve(repoRoot, ".env") });

	const value = process.env.DATABASE_URL?.trim();

	if (!value) {
		throw new Error("Missing DATABASE_URL. Define it in .env or the current shell.");
	}

	return value;
}

function resolveMigrationPath(inputPath: string) {
	return isAbsolute(inputPath) ? inputPath : resolve(repoRoot, inputPath);
}

function runCommand(command: string, args: string[]) {
	return new Promise<void>((resolvePromise, reject) => {
		const child = spawn(command, args, {
			cwd: repoRoot,
			env: process.env,
			stdio: "inherit",
		});

		child.on("error", (error) => {
			if ("code" in error && error.code === "ENOENT") {
				reject(
					new Error(
						`Command "${command}" is not available. Install PostgreSQL CLI tools so "${command}" is on PATH.`,
					),
				);
				return;
			}

			reject(error);
		});

		child.on("close", (code) => {
			if (code !== 0) {
				reject(new Error(`${command} failed with exit code ${code}.`));
				return;
			}

			resolvePromise();
		});
	});
}

main().catch((error) => {
	console.error(
		error instanceof Error ? error.message : "Unknown database migration failure.",
	);
	process.exit(1);
});
