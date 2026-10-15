import { isAbsolute, relative, resolve, sep } from "node:path";

const SAFE_FILE_STEM = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function isSafeFileStem(value: string): boolean {
  return SAFE_FILE_STEM.test(value) && value !== "." && value !== "..";
}

export function assertSafeFileStem(value: string, label = "file name"): void {
  if (!isSafeFileStem(value)) {
    throw new Error(`${label} must start with a letter or number and contain only letters, numbers, dot, underscore or hyphen`);
  }
}

export function isPathInside(base: string, candidate: string): boolean {
  const rel = relative(resolve(base), resolve(candidate));
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

export function resolveInside(base: string, ...parts: string[]): string {
  const candidate = resolve(base, ...parts);
  if (!isPathInside(base, candidate)) throw new Error(`path escapes ${resolve(base)}: ${candidate}`);
  return candidate;
}
