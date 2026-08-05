import { randomBytes } from "node:crypto";

import type { CardanoSubmissionMode } from "./types";

/** Response retained after a protected Cardano operation completes. */
export interface CardanoStoredResponse {
  status: number;
  contentType: string;
  headers: Record<string, string>;
  body: unknown;
  isRaw: boolean;
}

/** Atomic claim for one paid protected operation. */
export interface CardanoOperationClaim {
  key: string;
  txHash: string;
  fingerprint: string;
  requirementsFingerprint: string;
  replayChallenge?: string;
  requireReplayChallenge: boolean;
  ownerToken: string;
}

/** Result of attempting to claim a protected operation. */
export type CardanoOperationClaimResult =
  | { status: "claimed" }
  | { status: "transaction-conflict" }
  | { status: "request-conflict" }
  | { status: "in-progress" }
  | { status: "ambiguous" }
  | { status: "completed"; response: CardanoStoredResponse }
  | { status: "completed-without-response" }
  | { status: "challenge-invalid" }
  | { status: "capacity-exceeded" };

/** Binding stored for an opaque challenge issued in a 402 response. */
export interface CardanoReplayChallengeBinding {
  fingerprint: string;
  requirementsFingerprint: string;
  expiresAt: number;
}

/** Result of issuing a replay challenge. */
export type CardanoReplayChallengeResult =
  | { status: "issued"; challenge: string }
  | { status: "capacity-exceeded" };

/**
 * Persistence boundary for protected-operation idempotency.
 *
 * Production implementations MUST make `claim()` an atomic compare-and-set
 * operation in durable storage shared by every worker and deployment.
 */
export interface CardanoOperationStore {
  issueChallenge(binding: CardanoReplayChallengeBinding): Promise<CardanoReplayChallengeResult>;
  validateChallenge(
    challenge: string,
    binding: Omit<CardanoReplayChallengeBinding, "expiresAt">,
  ): Promise<boolean>;
  claim(claim: CardanoOperationClaim): Promise<CardanoOperationClaimResult>;
  complete(
    key: string,
    ownerToken: string,
    response: CardanoStoredResponse,
    responseBytes: number,
  ): Promise<"stored" | "response-too-large" | "not-owner">;
  markAmbiguous(key: string, ownerToken: string): Promise<"stored" | "not-owner">;
  release(key: string, ownerToken: string): Promise<void>;
}

/** Capacity controls for the process-local protected-operation store. */
export interface InMemoryCardanoOperationStoreOptions {
  maxEntries?: number;
  maxChallenges?: number;
  maxResponseBytes?: number;
  maxTotalResponseBytes?: number;
}

interface OperationRecord extends CardanoOperationClaim {
  state: "in-progress" | "ambiguous" | "completed";
  response?: CardanoStoredResponse;
  responseBytes: number;
}

interface ReplayChallengeRecord extends CardanoReplayChallengeBinding {
  claimedKey?: string;
}

/** Bounded process-local store for tests and explicitly single-process servers. */
export class InMemoryCardanoOperationStore implements CardanoOperationStore {
  private readonly records = new Map<string, OperationRecord>();
  private readonly challenges = new Map<string, ReplayChallengeRecord>();
  private readonly maxEntries: number;
  private readonly maxChallenges: number;
  private readonly maxResponseBytes: number;
  private readonly maxTotalResponseBytes: number;
  private totalResponseBytes = 0;

  /**
   * Creates a bounded process-local operation store.
   *
   * @param options - Entry and response-byte limits.
   */
  constructor(options: InMemoryCardanoOperationStoreOptions = {}) {
    this.maxEntries = positiveInteger(options.maxEntries ?? 4096, "maxEntries");
    this.maxChallenges = positiveInteger(options.maxChallenges ?? 4096, "maxChallenges");
    this.maxResponseBytes = nonNegativeInteger(
      options.maxResponseBytes ?? 2 * 1024 * 1024,
      "maxResponseBytes",
    );
    this.maxTotalResponseBytes = nonNegativeInteger(
      options.maxTotalResponseBytes ?? 64 * 1024 * 1024,
      "maxTotalResponseBytes",
    );
  }

  /**
   * Issues a fresh opaque challenge bound to one protected request and quote.
   *
   * @param binding - Request, requirements and expiry binding.
   * @returns The challenge, or a capacity failure.
   */
  async issueChallenge(
    binding: CardanoReplayChallengeBinding,
  ): Promise<CardanoReplayChallengeResult> {
    if (!Number.isSafeInteger(binding.expiresAt) || binding.expiresAt <= Date.now()) {
      throw new Error("replay challenge expiry must be a future safe integer");
    }
    this.pruneExpiredChallenges();
    if (this.challenges.size >= this.maxChallenges) return { status: "capacity-exceeded" };
    let challenge: string;
    do {
      challenge = randomBytes(32).toString("hex");
    } while (this.challenges.has(challenge));
    this.challenges.set(challenge, { ...binding });
    return { status: "issued", challenge };
  }

  /**
   * Checks that an echoed challenge belongs to this request and requirement.
   * A challenge retained by an operation remains valid for idempotent retries
   * after its issuance lifetime; an expired unused challenge does not.
   *
   * @param challenge - Opaque challenge echoed by the client.
   * @param binding - Expected request and requirement fingerprints.
   * @returns Whether the challenge is valid for this response.
   */
  async validateChallenge(
    challenge: string,
    binding: Omit<CardanoReplayChallengeBinding, "expiresAt">,
  ): Promise<boolean> {
    const record = this.challenges.get(challenge);
    if (
      record &&
      record.fingerprint === binding.fingerprint &&
      record.requirementsFingerprint === binding.requirementsFingerprint
    ) {
      if (record.expiresAt > Date.now()) return true;
      if (record.claimedKey && this.records.get(record.claimedKey)?.replayChallenge === challenge) {
        return true;
      }
      this.challenges.delete(challenge);
      return false;
    }
    for (const operation of this.records.values()) {
      if (
        operation.replayChallenge === challenge &&
        operation.fingerprint === binding.fingerprint &&
        operation.requirementsFingerprint === binding.requirementsFingerprint
      ) {
        return true;
      }
    }
    return false;
  }

  /**
   * Atomically claims an operation or returns its existing state.
   *
   * @param claim - Payment, request and owner binding.
   * @returns The claim outcome.
   */
  async claim(claim: CardanoOperationClaim): Promise<CardanoOperationClaimResult> {
    const existing = this.records.get(claim.key);
    if (existing) {
      if (
        existing.replayChallenge !== undefined
          ? existing.replayChallenge !== claim.replayChallenge
          : claim.requireReplayChallenge
      ) {
        return { status: "challenge-invalid" };
      }
      if (existing.txHash !== claim.txHash) return { status: "transaction-conflict" };
      if (existing.fingerprint !== claim.fingerprint) return { status: "request-conflict" };
      if (existing.state === "in-progress") return { status: "in-progress" };
      if (existing.state === "ambiguous") return { status: "ambiguous" };
      if (!existing.response) return { status: "completed-without-response" };
      return { status: "completed", response: cloneResponse(existing.response) };
    }
    let replayChallenge: string | undefined;
    if (claim.replayChallenge !== undefined || claim.requireReplayChallenge) {
      const challenge =
        claim.replayChallenge === undefined
          ? undefined
          : this.challenges.get(claim.replayChallenge);
      if (
        !challenge ||
        challenge.expiresAt <= Date.now() ||
        challenge.fingerprint !== claim.fingerprint ||
        challenge.requirementsFingerprint !== claim.requirementsFingerprint ||
        (challenge.claimedKey !== undefined && challenge.claimedKey !== claim.key)
      ) {
        return { status: "challenge-invalid" };
      }
      replayChallenge = claim.replayChallenge;
    }
    if (this.records.size >= this.maxEntries) return { status: "capacity-exceeded" };
    this.records.set(claim.key, {
      ...claim,
      ...(replayChallenge ? { replayChallenge } : {}),
      state: "in-progress",
      responseBytes: 0,
    });
    if (replayChallenge) {
      const challenge = this.challenges.get(replayChallenge);
      if (challenge) challenge.claimedKey = claim.key;
    }
    return { status: "claimed" };
  }

  /**
   * Completes an owned claim and retains its bounded response.
   *
   * @param key - Logical payment key.
   * @param ownerToken - Unpredictable token returned by the claimant.
   * @param response - Handler response to retain.
   * @param responseBytes - Buffered response size used for capacity checks.
   * @returns Storage outcome.
   */
  async complete(
    key: string,
    ownerToken: string,
    response: CardanoStoredResponse,
    responseBytes: number,
  ): Promise<"stored" | "response-too-large" | "not-owner"> {
    const record = this.records.get(key);
    if (!record || record.ownerToken !== ownerToken || record.state !== "in-progress") {
      return "not-owner";
    }
    record.state = "completed";
    if (
      responseBytes > this.maxResponseBytes ||
      this.totalResponseBytes - record.responseBytes + responseBytes > this.maxTotalResponseBytes
    ) {
      this.totalResponseBytes -= record.responseBytes;
      record.response = undefined;
      record.responseBytes = 0;
      return "response-too-large";
    }
    this.totalResponseBytes -= record.responseBytes;
    record.response = cloneResponse(response);
    record.responseBytes = responseBytes;
    this.totalResponseBytes += responseBytes;
    return "stored";
  }

  /**
   * Permanently retains an owned claim when the handler may have produced side
   * effects but no response can be replayed safely.
   *
   * @param key - Logical payment key.
   * @param ownerToken - Claimant's owner token.
   * @returns Whether the owned claim was retained.
   */
  async markAmbiguous(key: string, ownerToken: string): Promise<"stored" | "not-owner"> {
    const record = this.records.get(key);
    if (!record || record.ownerToken !== ownerToken || record.state !== "in-progress") {
      return "not-owner";
    }
    record.state = "ambiguous";
    record.response = undefined;
    this.totalResponseBytes -= record.responseBytes;
    record.responseBytes = 0;
    return "stored";
  }

  /**
   * Releases a claim only when the owner token matches.
   *
   * @param key - Logical payment key.
   * @param ownerToken - Claimant's owner token.
   */
  async release(key: string, ownerToken: string): Promise<void> {
    const record = this.records.get(key);
    if (record?.ownerToken === ownerToken && record.state === "in-progress") {
      this.delete(key, record);
    }
  }

  /**
   * Deletes a record and updates byte accounting.
   *
   * @param key - Record key.
   * @param record - Record being deleted.
   */
  private delete(key: string, record: OperationRecord): void {
    this.totalResponseBytes -= record.responseBytes;
    this.records.delete(key);
  }

  /** Removes expired, unused quote challenges before capacity checks. */
  private pruneExpiredChallenges(): void {
    const now = Date.now();
    for (const [challenge, binding] of this.challenges) {
      if (binding.expiresAt <= now) this.challenges.delete(challenge);
    }
  }
}

/** Atomic claim for a canonical Cardano transaction. */
export interface CardanoSubmissionClaim {
  txHash: string;
  mode: CardanoSubmissionMode;
  ownerToken: string;
}

/** One atomic facilitator claim for transaction and optional Masumi terms. */
export interface CardanoSettlementClaim extends CardanoSubmissionClaim {
  termsDigest?: string;
}

/** Result of claiming a facilitator settlement. */
export type CardanoSettlementClaimResult =
  | "fresh"
  | "in-flight"
  | "submitted"
  | "rejected"
  | "mode-conflict"
  | "terms-conflict"
  | "capacity-exceeded";

/** Persistence boundary for facilitator transaction and Masumi-terms claims. */
export interface CardanoSettlementStore {
  claimSettlement(claim: CardanoSettlementClaim): Promise<CardanoSettlementClaimResult>;
  markSubmitted(txHash: string, ownerToken: string): Promise<void>;
  markRejected(txHash: string, ownerToken: string): Promise<void>;
}

interface SubmissionRecord extends CardanoSettlementClaim {
  inFlight: boolean;
  submitted: boolean;
  rejected: boolean;
}

/** Bounded process-local facilitator store for tests and disposable development. */
export class InMemoryCardanoSettlementStore implements CardanoSettlementStore {
  private readonly submissions = new Map<string, SubmissionRecord>();
  private readonly terms = new Map<string, { txHash: string }>();
  private readonly maxEntries: number;

  /**
   * Creates a bounded process-local settlement store.
   *
   * @param maxEntries - Combined submission and terms entry limit.
   */
  constructor(maxEntries = 4096) {
    this.maxEntries = positiveInteger(maxEntries, "maxEntries");
  }

  /**
   * Atomically claims one canonical transaction, submission mode and optional
   * Masumi terms digest. No partial terms binding is left on failure.
   *
   * @param claim - Transaction, mode and owner binding.
   * @returns The claim outcome.
   */
  async claimSettlement(claim: CardanoSettlementClaim): Promise<CardanoSettlementClaimResult> {
    const existingTerms = claim.termsDigest ? this.terms.get(claim.termsDigest) : undefined;
    if (existingTerms && existingTerms.txHash !== claim.txHash) return "terms-conflict";

    const existing = this.submissions.get(claim.txHash);
    if (existing) {
      if (existing.mode !== claim.mode) return "mode-conflict";
      if (existing.termsDigest !== claim.termsDigest) return "terms-conflict";
    }

    const requiredEntries = (existing ? 0 : 1) + (claim.termsDigest && !existingTerms ? 1 : 0);
    if (this.entryCount() + requiredEntries > this.maxEntries) return "capacity-exceeded";

    if (claim.termsDigest && !existingTerms) {
      this.terms.set(claim.termsDigest, { txHash: claim.txHash });
    }
    if (!existing) {
      this.submissions.set(claim.txHash, {
        txHash: claim.txHash,
        mode: claim.mode,
        ...(claim.termsDigest ? { termsDigest: claim.termsDigest } : {}),
        ownerToken: claim.ownerToken,
        inFlight: true,
        submitted: false,
        rejected: false,
      });
      return "fresh";
    }
    if (existing.rejected) return "rejected";
    return existing.inFlight ? "in-flight" : "submitted";
  }

  /**
   * Marks an owned transaction claim as submitted.
   *
   * @param txHash - Canonical transaction ID.
   * @param ownerToken - Claimant's owner token.
   */
  async markSubmitted(txHash: string, ownerToken: string): Promise<void> {
    const record = this.submissions.get(txHash);
    if (record?.ownerToken === ownerToken) {
      record.inFlight = false;
      record.submitted = true;
      record.rejected = false;
    }
  }

  /**
   * Permanently records a definitive pre-ledger rejection. Retaining this
   * tombstone prevents a paid retry from resubmitting the same invalid bytes.
   *
   * @param txHash - Canonical transaction ID.
   * @param ownerToken - Claimant's owner token.
   */
  async markRejected(txHash: string, ownerToken: string): Promise<void> {
    const record = this.submissions.get(txHash);
    if (record?.ownerToken === ownerToken) {
      record.inFlight = false;
      record.submitted = false;
      record.rejected = true;
    }
  }

  /**
   * Counts all retained records against the shared entry limit.
   *
   * @returns Combined number of retained terms and submission records.
   */
  private entryCount(): number {
    return this.submissions.size + this.terms.size;
  }
}

/**
 * Copies a retained response so callers cannot mutate store state.
 *
 * @param response - Stored response.
 * @returns Independent response copy.
 */
function cloneResponse(response: CardanoStoredResponse): CardanoStoredResponse {
  return {
    ...response,
    headers: { ...response.headers },
    body: Buffer.isBuffer(response.body)
      ? Buffer.from(response.body)
      : structuredClone(response.body),
  };
}

/**
 * Validates a positive safe integer setting.
 *
 * @param value - Candidate value.
 * @param name - Setting name used in errors.
 * @returns Validated value.
 */
function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new Error(`${name} must be a positive integer`);
  return value;
}

/**
 * Validates a non-negative safe integer setting.
 *
 * @param value - Candidate value.
 * @param name - Setting name used in errors.
 * @returns Validated value.
 */
function nonNegativeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return value;
}
