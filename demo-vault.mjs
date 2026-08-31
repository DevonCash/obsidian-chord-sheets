/*
 * Builds a throwaway Obsidian vault for trying the plugin out by hand, and opens it.
 *
 *   npm run demo              set up ./demo-vault and open it in Obsidian
 *   npm run demo -- --fresh   delete the vault first, discarding its settings
 *   npm run demo -- --no-open just write the vault, do not launch Obsidian
 *
 * The plugin's three files are symlinked rather than copied, so `npm run dev` in another terminal
 * rebuilds straight into the vault; reloading Obsidian is enough to pick a rebuild up.
 */

import { execFile } from "child_process";
import fs from "fs";
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

if (!open) {
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
	console.log("  Opening in Obsidian. First time, it will ask to trust the vault.");
});
