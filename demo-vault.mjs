/*
 * Builds a throwaway Obsidian vault for trying the plugin out by hand, and opens it.
 *
 *   npm run demo              set up ./demo-vault and open it in Obsidian
 *   npm run demo -- --fresh   delete the vault first, discarding its settings
 *   npm run demo -- --no-open just write the vault, do not launch Obsidian
 *
 * The plugin's three files are symlinked rather than copied, so `npm run dev` in another terminal
 * rebuilds straight into the vault; reloading Obsidian is enough to pick a rebuild up.
 *
 * Obsidian can only open vaults it has in its own registry, so this adds the demo vault to
 * obsidian.json (backed up once, next to the original, and never removing anything). A running
 * Obsidian keeps that list in memory and will not notice a new entry, so it has to be restarted before
 * the vault can be opened.
 */

import { execFile, execFileSync } from "child_process";
import { createHash } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const repoRoot = path.dirname(fileURLToPath(import.meta.url));
const vaultDir = path.join(repoRoot, "demo-vault");
const notesDir = path.join(repoRoot, "demo", "notes");

const args = process.argv.slice(2);
const fresh = args.includes("--fresh");
const open = !args.includes("--no-open");

const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, "manifest.json"), "utf8"));
const pluginId = manifest.id;
const pluginFiles = ["main.js", "manifest.json", "styles.css"];

function fail(message) {
	console.error(`\n  ${message}\n`);
	process.exit(1);
}

if (fresh && fs.existsSync(vaultDir)) {
	fs.rmSync(vaultDir, { recursive: true, force: true });
	console.log("  Removed the existing demo vault.");
}

const missing = pluginFiles.filter(file => !fs.existsSync(path.join(repoRoot, file)));
if (missing.length > 0) {
	fail(`Missing ${missing.join(", ")}. Run \`npm run build\` (or \`npm run dev\`) first.`);
}

// Notes are copied from demo/notes, which is the versioned source of truth, so editing a note inside
// the vault is a scratch edit that the next run discards.
fs.mkdirSync(vaultDir, { recursive: true });
for (const note of fs.readdirSync(notesDir)) {
	fs.copyFileSync(path.join(notesDir, note), path.join(vaultDir, note));
}

const pluginDir = path.join(vaultDir, ".obsidian", "plugins", pluginId);
fs.mkdirSync(pluginDir, { recursive: true });
for (const file of pluginFiles) {
	const link = path.join(pluginDir, file);
	fs.rmSync(link, { force: true });
	fs.symlinkSync(path.join(repoRoot, file), link);
}

// Enable the plugin. Written only when absent, so settings changed in the vault survive a re-run.
const enabledPlugins = path.join(vaultDir, ".obsidian", "community-plugins.json");
if (!fs.existsSync(enabledPlugins)) {
	fs.writeFileSync(enabledPlugins, JSON.stringify([pluginId], null, 2) + "\n");
}

console.log(`  Demo vault ready at ${vaultDir}`);
console.log(`  ${pluginFiles.join(", ")} are symlinked, so \`npm run dev\` rebuilds land here.`);

/** Where Obsidian keeps the list of vaults it knows about. */
function vaultRegistryPath() {
	const home = os.homedir();
	switch (process.platform) {
		case "darwin":
			return path.join(home, "Library", "Application Support", "obsidian", "obsidian.json");
		case "win32":
			return path.join(process.env.APPDATA ?? path.join(home, "AppData", "Roaming"), "obsidian", "obsidian.json");
		default:
			return path.join(process.env.XDG_CONFIG_HOME ?? path.join(home, ".config"), "obsidian", "obsidian.json");
	}
}

/**
 * Adds the demo vault to Obsidian's registry, since `obsidian://open` only resolves vaults already in
 * it. Existing entries are never touched, and the original file is backed up the first time.
 * Returns false if the registry could not be read, in which case the vault has to be opened by hand.
 */
function registerVault() {
	const registryPath = vaultRegistryPath();
	if (!fs.existsSync(registryPath)) {
		console.log(`  Could not find Obsidian's vault list at ${registryPath}.`);
		return false;
	}

	let registry;
	try {
		registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
	} catch (error) {
		console.log(`  Could not read Obsidian's vault list (${error.message}).`);
		return false;
	}

	const vaults = registry.vaults ?? (registry.vaults = {});
	if (Object.values(vaults).some(vault => vault.path === vaultDir)) {
		return true;
	}

	const backup = `${registryPath}.backup-before-demo-vault`;
	if (!fs.existsSync(backup)) {
		fs.copyFileSync(registryPath, backup);
		console.log(`  Backed up Obsidian's vault list to ${backup}`);
	}

	// Obsidian keys vaults by a 16 hex character id; deriving it from the path keeps re-runs idempotent
	// even if the entry is dropped and re-added.
	const id = createHash("sha256").update(vaultDir).digest("hex").slice(0, 16);
	vaults[id] = { path: vaultDir, ts: Date.now() };
	fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2) + "\n");
	console.log("  Registered the demo vault with Obsidian.");
	return true;
}

function obsidianIsRunning() {
	try {
		if (process.platform === "win32") {
			const output = execFileSync("tasklist", ["/fi", "imagename eq Obsidian.exe", "/nh"],
				{ encoding: "utf8", stdio: "pipe" });
			return /obsidian/i.test(output);
		}
		// pgrep prints matching pids and exits non-zero when there are none, so reaching here is the
		// answer — its output is a pid, not the process name.
		execFileSync("pgrep", ["-x", "Obsidian"], { stdio: "pipe" });
		return true;
	} catch {
		return false;
	}
}

if (!open) {
	process.exit(0);
}

if (!registerVault()) {
	console.log(`\n  Open it by hand instead: Obsidian -> Open folder as vault -> ${vaultDir}\n`);
	process.exit(0);
}

if (obsidianIsRunning()) {
	// A running Obsidian holds its vault list in memory, so it cannot see the entry just written — and
	// it rewrites the file from memory when it quits, which drops the entry again. Re-running this
	// command puts it back.
	console.log(`
  Obsidian is already running, and only reads its vault list at startup.

  Quit Obsidian and run \`npm run demo\` again, and it will open the demo vault
  directly. Or restart Obsidian yourself and pick "demo-vault" from the vault
  switcher in the bottom left.
`);
	process.exit(0);
}

const uri = `obsidian://open?path=${encodeURIComponent(vaultDir)}`;
const opener = process.platform === "darwin"
	? { command: "open", args: [uri] }
	: process.platform === "win32"
		? { command: "cmd", args: ["/c", "start", "", uri] }
		: { command: "xdg-open", args: [uri] };

execFile(opener.command, opener.args, error => {
	if (error) {
		console.error(`\n  Could not launch Obsidian automatically (${error.message}).`);
		console.error(`  Open this vault by hand instead: ${vaultDir}\n`);
		process.exit(1);
	}
	console.log("  Opening in Obsidian.");
});
