import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const files = [
  join(root, "README.md"),
  join(root, "CONTRIBUTING.md"),
  join(root, "SECURITY.md"),
  ...markdownFiles(join(root, "agents")),
  ...markdownFiles(join(root, "docs")),
];
const failures = [];

for (const file of files) {
  const markdown = readFileSync(file, "utf8");
  for (const match of markdown.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const target = match[1]?.trim();
    if (target === undefined || /^(?:https?:|mailto:|#)/.test(target)) continue;
    const clean = target.split("#", 1)[0]?.split("?", 1)[0];
    if (clean === undefined || clean.length === 0) continue;
    let candidate = clean.startsWith("/")
      ? join(root, "docs", clean.slice(1))
      : resolve(dirname(file), clean);
    if (extname(candidate) === "" && !existsSync(candidate)) candidate += ".md";
    if (!existsSync(candidate)) failures.push(`${file}: ${target}`);
  }
}

if (failures.length > 0) {
  console.error("Broken local documentation links:\n" + failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Checked local links in ${files.length} Markdown files.`);
}

function markdownFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name.startsWith(".") ? [] : markdownFiles(path);
    return statSync(path).isFile() && path.endsWith(".md") ? [path] : [];
  });
}
