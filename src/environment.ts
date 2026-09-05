import { pathToFileURL } from "node:url";

export function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required`);
  }
  return value;
}

export function isMainModule(moduleUrl: string): boolean {
  return process.argv[1] !== undefined &&
    moduleUrl === pathToFileURL(process.argv[1]).href;
}
