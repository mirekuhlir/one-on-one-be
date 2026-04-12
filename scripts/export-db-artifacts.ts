import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import dotenv from "dotenv";

const currentFilePath = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(currentFilePath), "..");
const databaseUrl = loadDatabaseUrl();

const schemaOutputPath = resolve(repoRoot, "database/db_schema.sql");
const settingsOutputPath = resolve(repoRoot, "database/pg_settings.txt");

async function main() {
	await mkdir(dirname(schemaOutputPath), { recursive: true });

	const schema = await runCommand("pg_dump", ["--schema-only", databaseUrl]);
	await writeFile(schemaOutputPath, schema, "utf8");

	const settings = await runCommand("psql", [
		databaseUrl,
		"-v",
		"ON_ERROR_STOP=1",
		"-P",
		"pager=off",
		"-c",
		"SELECT name, setting, short_desc AS description FROM pg_settings ORDER BY name;",
	]);
	await writeFile(settingsOutputPath, settings, "utf8");

	console.log(`Updated ${schemaOutputPath}`);
	console.log(`Updated ${settingsOutputPath}`);
}

function loadDatabaseUrl() {
	dotenv.config({ path: resolve(repoRoot, ".env") });

	const value = process.env.DATABASE_URL?.trim();

	if (!value) {
		throw new Error("Missing DATABASE_URL. Define it in .env or the current shell.");
	}

	return value;
}

function runCommand(command: string, args: string[]) {
	return new Promise<string>((resolveOutput, reject) => {
		const child = spawn(command, args, {
			cwd: repoRoot,
			env: process.env,
			stdio: ["ignore", "pipe", "pipe"],
		});

		let stdout = "";
		let stderr = "";

		child.stdout.on("data", (chunk) => {
			stdout += chunk.toString();
		});

		child.stderr.on("data", (chunk) => {
			stderr += chunk.toString();
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
				const details = stderr.trim() || stdout.trim() || `Exit code ${code}`;
				reject(new Error(`${command} failed: ${details}`));
				return;
			}

			resolveOutput(stdout);
		});
	});
}

main().catch((error) => {
	console.error(
		error instanceof Error ? error.message : "Unknown database export failure.",
	);
	process.exit(1);
});
