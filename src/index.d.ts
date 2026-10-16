export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export type Operation =
  | { op: "add" | "replace" | "test"; path: string; value: unknown }
  | { op: "remove"; path: string }
  | { op: "move" | "copy"; from: string; path: string };

export class PatchError extends Error {
  readonly op?: unknown;
  readonly index?: number;
}

export function diff(before: unknown, after: unknown, options?: { arrayKey?: string }): Operation[];
export function apply<T = unknown>(document: unknown, patch: readonly Operation[]): T;
export function equal(a: unknown, b: unknown): boolean;
export function escapePointer(segment: string | number): string;
export function parsePointer(pointer: string): string[];
export function summarize(patch: readonly Operation[]): string;
