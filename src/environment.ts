import { pathToFileURL } from "node:url";

export function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required`);
  }
  return value;
}

export function optionalEnvironment(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value.length === 0 ? undefined : value;
}

export function environmentPort(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new Error(`${name} must be a valid TCP port`);
  }
  return value;
}

export function isMainModule(moduleUrl: string): boolean {
  return process.argv[1] !== undefined &&
    moduleUrl === pathToFileURL(process.argv[1]).href;
}
