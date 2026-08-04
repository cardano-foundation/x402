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
  ownerToken: string;
  expiresAt: number;
}

/** Result of attempting to claim a protected operation. */
export type CardanoOperationClaimResult =
  | { status: "claimed" }
  | { status: "transaction-conflict" }
  | { status: "request-conflict" }
  | { status: "in-progress" }
  | { status: "completed"; response: CardanoStoredResponse }
  | { status: "completed-without-response" }
  | { status: "capacity-exceeded" };

/**
 * Persistence boundary for protected-operation idempotency.
 *
 * Implementations used by multiple workers or pods MUST make `claim()` an
 * atomic compare-and-set operation in shared durable storage.
 */
export interface CardanoOperationStore {
  claim(claim: CardanoOperationClaim): Promise<CardanoOperationClaimResult>;
  complete(
    key: string,
    ownerToken: string,
    response: CardanoStoredResponse,
    responseBytes: number,
  ): Promise<"stored" | "response-too-large" | "not-owner">;
  release(key: string, ownerToken: string): Promise<void>;
}

/** Capacity controls for the process-local protected-operation store. */
export interface InMemoryCardanoOperationStoreOptions {
  maxEntries?: number;
  maxResponseBytes?: number;
  maxTotalResponseBytes?: number;
}

interface OperationRecord extends CardanoOperationClaim {
  completed: boolean;
  response?: CardanoStoredResponse;
  responseBytes: number;
}

/** Bounded process-local store for tests and explicitly single-process servers. */
export class InMemoryCardanoOperationStore implements CardanoOperationStore {
  private readonly records = new Map<string, OperationRecord>();
  private readonly maxEntries: number;
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
   * Atomically claims an operation or returns its existing state.
   *
   * @param claim - Payment, request, owner and expiry binding.
   * @returns The claim outcome.
   */
  async claim(claim: CardanoOperationClaim): Promise<CardanoOperationClaimResult> {
    this.prune(Date.now());
    const existing = this.records.get(claim.key);
    if (existing) {
      if (existing.txHash !== claim.txHash) return { status: "transaction-conflict" };
      if (existing.fingerprint !== claim.fingerprint) return { status: "request-conflict" };
      if (!existing.completed) return { status: "in-progress" };
      if (!existing.response) return { status: "completed-without-response" };
      return { status: "completed", response: cloneResponse(existing.response) };
    }
    if (this.records.size >= this.maxEntries) return { status: "capacity-exceeded" };
    this.records.set(claim.key, { ...claim, completed: false, responseBytes: 0 });
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
    if (!record || record.ownerToken !== ownerToken) return "not-owner";
    record.completed = true;
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
   * Releases a claim only when the owner token matches.
   *
   * @param key - Logical payment key.
   * @param ownerToken - Claimant's owner token.
   */
  async release(key: string, ownerToken: string): Promise<void> {
    const record = this.records.get(key);
    if (record?.ownerToken === ownerToken) this.delete(key, record);
  }

  /**
   * Removes expired records.
   *
   * @param now - Current epoch milliseconds.
   */
  private prune(now: number): void {
    for (const [key, record] of this.records) {
      if (record.expiresAt <= now) this.delete(key, record);
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
}

/** Atomic claim for a canonical Cardano transaction. */
export interface CardanoSubmissionClaim {
  txHash: string;
  mode: CardanoSubmissionMode;
  ownerToken: string;
  expiresAt: number;
}

/** Persistence boundary for facilitator transaction and Masumi-terms claims. */
export interface CardanoSettlementStore {
  claimTerms(input: {
    digest: string;
    txHash: string;
    expiresAt: number;
  }): Promise<"claimed" | "same-transaction" | "transaction-conflict" | "capacity-exceeded">;
  claimSubmission(
    claim: CardanoSubmissionClaim,
  ): Promise<"fresh" | "in-flight" | "submitted" | "mode-conflict" | "capacity-exceeded">;
  markSubmitted(txHash: string, ownerToken: string): Promise<void>;
  releaseSubmission(txHash: string, ownerToken: string): Promise<void>;
}

interface SubmissionRecord extends CardanoSubmissionClaim {
  inFlight: boolean;
  submitted: boolean;
}

/** Bounded process-local facilitator store. Use a shared implementation in a cluster. */
export class InMemoryCardanoSettlementStore implements CardanoSettlementStore {
  private readonly submissions = new Map<string, SubmissionRecord>();
  private readonly terms = new Map<string, { txHash: string; expiresAt: number }>();
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
   * Binds a Masumi terms digest to one transaction.
   *
   * @param input - Digest, transaction and expiry binding.
   * @param input.digest - Canonical Masumi terms digest.
   * @param input.txHash - Canonical Cardano transaction ID.
   * @param input.expiresAt - Claim expiry in epoch milliseconds.
   * @returns The claim outcome.
   */
  async claimTerms(input: {
    digest: string;
    txHash: string;
    expiresAt: number;
  }): Promise<"claimed" | "same-transaction" | "transaction-conflict" | "capacity-exceeded"> {
    this.prune(Date.now());
    const existing = this.terms.get(input.digest);
    if (existing) {
      return existing.txHash === input.txHash ? "same-transaction" : "transaction-conflict";
    }
    if (this.entryCount() >= this.maxEntries) return "capacity-exceeded";
    this.terms.set(input.digest, { txHash: input.txHash, expiresAt: input.expiresAt });
    return "claimed";
  }

  /**
   * Atomically claims one canonical transaction and submission mode.
   *
   * @param claim - Transaction, mode, owner and expiry binding.
   * @returns The claim outcome.
   */
  async claimSubmission(
    claim: CardanoSubmissionClaim,
  ): Promise<"fresh" | "in-flight" | "submitted" | "mode-conflict" | "capacity-exceeded"> {
    this.prune(Date.now());
    const existing = this.submissions.get(claim.txHash);
    if (existing) {
      if (existing.mode !== claim.mode) return "mode-conflict";
      return existing.inFlight ? "in-flight" : "submitted";
    }
    if (this.entryCount() >= this.maxEntries) return "capacity-exceeded";
    this.submissions.set(claim.txHash, {
      ...claim,
      inFlight: true,
      submitted: false,
    });
    return "fresh";
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
    }
  }

  /**
   * Releases an owned transaction claim.
   *
   * @param txHash - Canonical transaction ID.
   * @param ownerToken - Claimant's owner token.
   */
  async releaseSubmission(txHash: string, ownerToken: string): Promise<void> {
    const record = this.submissions.get(txHash);
    if (record?.ownerToken === ownerToken) this.submissions.delete(txHash);
  }

  /**
   * Counts all retained records against the shared entry limit.
   *
   * @returns Combined number of retained terms and submission records.
   */
  private entryCount(): number {
    return this.submissions.size + this.terms.size;
  }

  /**
   * Removes expired terms and submission records.
   *
   * @param now - Current epoch milliseconds.
   */
  private prune(now: number): void {
    for (const [key, record] of this.submissions) {
      if (record.expiresAt <= now) this.submissions.delete(key);
    }
    for (const [key, record] of this.terms) {
      if (record.expiresAt <= now) this.terms.delete(key);
    }
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
