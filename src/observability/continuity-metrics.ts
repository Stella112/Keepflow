const startedAt = new Date();
let successfulPacks = 0;
let failedPacks = 0;
let totalGenerationMs = 0;
let generatedArtifacts = 0;

export function recordContinuityPackSuccess(latencyMs: number, artifactCount: number): void {
  successfulPacks += 1;
  totalGenerationMs += Math.max(0, latencyMs);
  generatedArtifacts += Math.max(0, artifactCount);
}

export function recordContinuityPackFailure(): void {
  failedPacks += 1;
}

export function continuityMetricsSnapshot() {
  return {
    scope: 'process_lifetime',
    process_started_at: startedAt.toISOString(),
    successful_paid_packs: successfulPacks,
    failed_generation_attempts: failedPacks,
    generated_artifacts: generatedArtifacts,
    average_generation_ms:
      successfulPacks === 0 ? null : Math.round(totalGenerationMs / successfulPacks),
    privacy: 'No request bodies, descriptions, locations, identifiers, wallet addresses, or artifact contents are stored in these counters.',
  } as const;
}
