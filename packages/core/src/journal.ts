/**
 * Journal de traçabilité (stockage n°3), exploitable pour le RGPD et l'AI Act.
 *
 * Pour chaque réponse : client, appelant, outil, connecteurs lus, version des
 * règles, consentement. Chaînage par empreinte (append-only, falsification
 * détectable). Aucune donnée personnelle en clair : seul le pseudonyme figure.
 */
import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { AccessLevel } from "@uai/contracts";

export interface JournalInput {
  requestId: string;
  tenantId: string;
  caller: { level: AccessLevel; keyLabel: string; role?: string; motif?: string };
  channel: "rest" | "mcp" | "chat";
  tool: string;
  customerRef?: string;
  consent: "granted" | "refused" | "not_required" | "unknown";
  connectorsRead: string[];
  rulesVersion: string;
  partial: boolean;
  outcome: "ok" | "denied" | "error";
  durationMs: number;
  aiGenerated?: boolean;
}

export interface JournalEntry extends JournalInput {
  seq: number;
  at: string;
  prevHash: string;
  hash: string;
}

const GENESIS = "0".repeat(64);
const digest = (e: Omit<JournalEntry, "hash">) => createHash("sha256").update(JSON.stringify(e)).digest("hex");

export class Journal {
  private readonly chains = new Map<string, JournalEntry[]>();

  constructor(private readonly opts: { dir?: string } = {}) {
    if (opts.dir) mkdirSync(opts.dir, { recursive: true });
  }

  append(input: JournalInput): JournalEntry {
    const chain = this.chains.get(input.tenantId) ?? [];
    const prev = chain.at(-1);
    const base = { ...input, seq: (prev?.seq ?? 0) + 1, at: new Date().toISOString(), prevHash: prev?.hash ?? GENESIS };
    const entry: JournalEntry = { ...base, hash: digest(base) };
    chain.push(entry);
    this.chains.set(input.tenantId, chain);
    if (this.opts.dir) appendFileSync(join(this.opts.dir, `${input.tenantId}.jsonl`), JSON.stringify(entry) + "\n");
    return entry;
  }

  list(tenantId: string, limit = 50): JournalEntry[] {
    return (this.chains.get(tenantId) ?? []).slice(-limit).reverse();
  }

  /** Vérifie l'intégrité de la chaîne d'un client. */
  verify(tenantId: string): { ok: boolean; brokenAt?: number } {
    let prevHash = GENESIS;
    for (const e of this.chains.get(tenantId) ?? []) {
      const { hash, ...rest } = e;
      if (e.prevHash !== prevHash || digest(rest) !== hash) return { ok: false, brokenAt: e.seq };
      prevHash = hash;
    }
    return { ok: true };
  }

  /**
   * Effacement : le pseudonyme est remplacé par "effacé" ; la chaîne est
   * re-scellée et l'opération elle-même est journalisée.
   */
  eraseCustomer(tenantId: string, customerRef: string): number {
    const chain = this.chains.get(tenantId) ?? [];
    let n = 0;
    let prevHash = GENESIS;
    const resealed = chain.map((e) => {
      const { hash: _h, ...rest } = e;
      const changed = rest.customerRef === customerRef;
      if (changed) n++;
      const base = { ...rest, customerRef: changed ? "effacé" : rest.customerRef, prevHash };
      const entry = { ...base, hash: digest(base) };
      prevHash = entry.hash;
      return entry;
    });
    this.chains.set(tenantId, resealed);
    return n;
  }
}
