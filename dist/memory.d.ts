export type AxmemStorageLayout = "standalone" | "axiom" | "auto";
export declare function resolveAxmemStorageDir(cwd: string, layout?: AxmemStorageLayout): string;
export declare function setAxmemStorageLayout(layout?: AxmemStorageLayout, cwd?: string): string;
export type AgentMemoryPack = {
    schema: "axiom.agent_memory_pack.v0";
    version: 1;
    task: {
        id: string;
        title: string;
        tags: string[];
        canonical_tags?: string[];
        agent_tags?: string[];
        created_at: string;
        updated_at: string;
    };
    summary: {
        goal?: string;
        last_completed_step?: string;
        next_recommended_step?: string;
        resume_prompt?: string;
        recent_message?: string;
        resume_command?: string;
    };
    semantic_refs: MemorySemanticRef[];
    decisions: MemoryDecision[];
    commands: MemoryCommandEvidence[];
    next_actions: string[];
    invalidated_hypotheses?: MemoryInvalidatedHypothesis[];
    evidence: MemoryEvidence[];
    strata?: MemoryStratum[];
    nodes?: MemoryGraphNode[];
    anchors?: MemoryAnchor[];
};
export type AgentMemoryIndex = {
    schema: "axiom.agent_memory_index.v0";
    version: 1;
    updated_at: string;
    entries: AgentMemoryIndexEntry[];
};
export type MemorySearchStoreManifest = {
    schema: "axiom.agent_memory_search_store.v0";
    version: 1;
    built_at: string;
    updated_at: string;
    source_index_hash: string;
    source_entry_count: number;
    token_files: Record<string, string>;
    document_files: Record<string, string>;
    document_layout?: "files" | "sharded";
    document_shard_files?: Record<string, string>;
    entry_hashes: Record<string, string>;
    embedding?: MemoryEmbeddingMetadata;
    vector_cells?: Record<string, string[]>;
    vector_cell_files?: Record<string, string>;
    corruption_recovery_count: number;
};
export type MemoryEmbeddingMetadata = {
    schema: "axiom.agent_memory_embedding_metadata.v0";
    model_id: string;
    dimensions: number;
    normalization: "l2";
    corpus_fingerprint: string;
    generated_at: string;
};
export type MemorySearchStoreBuildResult = {
    schema: "axiom.agent_memory_search_store_build.v0";
    status: "ok";
    reason: "manual" | "write" | "reindex" | "corruption_recovery";
    manifest_path: string;
    source_entry_count: number;
    token_count: number;
    document_count: number;
    source_index_hash: string;
    corruption_recovery_count: number;
};
export type MemorySearchStoreCompareCase = {
    id: string;
    query?: string;
    taskId?: string;
    mode?: MemoryRecallMode;
    profile?: MemoryRecallProfile;
    limit?: number;
};
export type MemorySearchStoreCompareResult = {
    schema: "axiom.agent_memory_search_store_compare.v0";
    status: "ok" | "failed";
    case_count: number;
    cases: {
        id: string;
        comparison_status: "matched" | "mismatched" | "not_compared";
        search_exercised: boolean;
        json_top_task_id?: string;
        search_top_task_id?: string;
        json_task_ids: string[];
        search_task_ids: string[];
        json_no_strong_match: boolean;
        search_no_strong_match: boolean;
        passed: boolean;
    }[];
};
export type AgentMemoryIndexEntry = {
    task_id: string;
    title: string;
    pack_path: string;
    created_at: string;
    updated_at: string;
    tags: string[];
    canonical_tags?: string[];
    agent_tags?: string[];
    semantic_refs: MemorySemanticRef[];
    score_hints: string[];
    invalidated_score_hints?: string[];
    strata_refs?: MemoryStratumRef[];
    anchor_hints?: string[];
    summary_preview?: AgentMemoryPack["summary"];
    decision_hints?: MemoryDecision[];
    command_hints?: MemoryCommandEvidence[];
    next_action_hints?: string[];
    invalidated_hypotheses?: MemoryInvalidatedHypothesis[];
    evidence_refs?: MemoryEvidenceRef[];
    strata_previews?: MemoryProjectedStratum[];
    anchor_refs?: MemoryProjectedAnchor[];
    raw_evidence_chars?: number;
    pack_json_chars?: number;
    evidence_count: number;
    command_count: number;
    graph_node_count?: number;
    anchor_count?: number;
    invalidated_hypothesis_count?: number;
    resume_command?: string;
    source_scope?: string;
};
export type MemorySemanticRef = {
    kind: string;
    name: string;
};
export type MemoryDecision = {
    kind: string;
    summary: string;
    node?: string;
    reason?: string;
};
export type MemoryCommandEvidence = {
    command: string;
    status?: string;
    summary?: string;
    source: "context_test_run" | "session_log" | "agent_ingest";
};
export type MemoryEvidence = {
    id: string;
    kind: string;
    path?: string;
    summary: string;
    data: unknown;
};
export type MemoryEvidenceRef = {
    id: string;
    kind: string;
    path?: string;
    summary: string;
};
export type MemoryInvalidatedHypothesis = {
    hypothesis: string;
    reason?: string;
    invalidated_by: string[];
    next_better_hypothesis?: string;
    source?: "capture_option" | "evidence" | "agent_ingest";
};
export type MemoryIngestDocument = {
    schema?: "axiom.agent_memory_ingest.v0";
    task?: {
        id?: string;
        title?: string;
        tags?: string[];
        canonical_tags?: string[];
        agent_tags?: string[];
    };
    task_id?: string;
    title?: string;
    tags?: string[];
    summary?: Partial<AgentMemoryPack["summary"]> | string;
    semantic_refs?: MemorySemanticRef[];
    decisions?: (MemoryDecision | string)[];
    commands?: (MemoryCommandEvidence | string)[];
    next_actions?: string[];
    invalidated_hypotheses?: MemoryInvalidatedHypothesis[];
    evidence?: (Partial<MemoryEvidence> & {
        data?: unknown;
    })[];
    strata?: Partial<MemoryStratum>[];
    nodes?: Partial<MemoryGraphNode>[];
    anchors?: Partial<MemoryAnchor>[];
};
export type MemoryStratum = {
    id: string;
    part: string;
    name: string;
    kind: string;
    node_ids: string[];
    score_hints: string[];
};
export type MemoryGraphNodeStatus = "active" | "invalidated" | "stale" | "speculative";
export type MemoryTrustTier = "proved" | "contracted" | "hypothesis" | "invalidated";
export type MemoryAccessTier = "L0_RAM_INDEX" | "L1_PACK_LRU" | "L2_SEARCH_STORE" | "L2_COMPRESSED_PACK" | "L3_VECTOR_INDEX";
export type MemoryTierCacheEntryStats = {
    pack_path: string;
    compressed_bytes: number;
    persisted: boolean;
    dirty: boolean;
    pinned: boolean;
    access_count: number;
};
export type MemoryTierCacheStats = {
    schema: "axiom.agent_memory_tier_cache_stats.v0";
    pack_cache_entries: number;
    pack_cache_bytes: number;
    pack_cache_max_bytes: number;
    pinned_entries: number;
    dirty_entries: number;
    entries: MemoryTierCacheEntryStats[];
};
export type MemoryTierEvictionResult = {
    schema: "axiom.agent_memory_tier_eviction.v0";
    status: "ok" | "blocked";
    requested_max_bytes: number;
    evicted_count: number;
    evicted_pack_paths: string[];
    skipped_pinned_count: number;
    persisted_before_evict_count: number;
    blocked_pack_paths: string[];
    remaining_pack_cache_bytes: number;
    remaining_pack_cache_entries: number;
};
export type MemoryTierStageResult = {
    schema: "axiom.agent_memory_tier_stage.v0";
    status: "ok";
    pack_path: string;
    compressed_bytes: number;
    pinned: boolean;
};
export type MemoryPrefetchResult = {
    schema: "axiom.agent_memory_prefetch.v0";
    status: "ok";
    seed_task_ids: string[];
    prefetched_task_ids: string[];
    skipped_task_ids: string[];
    candidate_count: number;
    cache_before_bytes: number;
    cache_after_bytes: number;
};
export type MemoryGraphNode = {
    id: string;
    part: string;
    stratum: string;
    kind: string;
    title: string;
    summary?: string;
    status?: MemoryGraphNodeStatus;
    trust_tier?: MemoryTrustTier;
    tags?: string[];
    semantic_refs?: MemorySemanticRef[];
    evidence_refs?: string[];
    score_hints?: string[];
};
export type MemoryAnchorType = "relates_to" | "depends_on" | "invalidates" | "fixes" | "causes" | "conflicts_with" | "supersedes" | "uses" | "evidenced_by" | "reproduced_by" | "resumes";
export type MemoryAnchorStatus = "active" | "invalidated" | "stale" | "speculative";
export type MemoryAnchor = {
    id: string;
    type: MemoryAnchorType | string;
    from: string;
    to: string;
    status: MemoryAnchorStatus;
    summary?: string;
    evidence_refs?: string[];
    score_hints?: string[];
    weight?: number;
};
export type MemoryStratumRef = {
    id: string;
    part: string;
    name: string;
    kind: string;
    node_count: number;
};
export type MemoryProjectedNode = {
    id: string;
    kind: string;
    title: string;
    status?: MemoryGraphNodeStatus;
    evidence_refs?: string[];
};
export type MemoryProjectedStratum = MemoryStratumRef & {
    nodes: MemoryProjectedNode[];
};
export type MemoryProjectedAnchor = {
    id: string;
    type: string;
    from: string;
    from_title?: string;
    to: string;
    to_title?: string;
    status: MemoryAnchorStatus;
    summary?: string;
    evidence_refs?: string[];
    weight?: number;
};
export type MemoryCaptureResult = {
    schema: "axiom.agent_memory_capture.v0";
    status: "ok";
    task_id: string;
    title: string;
    pack_path: string;
    index_path: string;
    evidence_count: number;
    command_count: number;
    metrics: MemoryPackMetrics;
};
export type MemoryIngestResult = {
    schema: "axiom.agent_memory_ingest_result.v0";
    status: "ok";
    task_id: string;
    title: string;
    pack_path: string;
    index_path: string;
    evidence_count: number;
    command_count: number;
    graph_node_count: number;
    anchor_count: number;
    metrics: MemoryPackMetrics;
};
export type MemoryReindexResult = {
    schema: "axiom.agent_memory_reindex.v0";
    status: "ok";
    reason: "manual" | "auto_upgrade";
    index_path: string;
    pack_count: number;
    entry_count: number;
    entries: {
        task_id: string;
        title: string;
        pack_path: string;
        graph_node_count: number;
        anchor_count: number;
        invalidated_hypothesis_count: number;
    }[];
};
export type MemoryDeleteResult = {
    schema: "axiom.agent_memory_delete.v0";
    status: "ok" | "not_found" | "dry_run";
    dry_run: boolean;
    requested_task_ids: string[];
    matched_task_ids: string[];
    missing_task_ids: string[];
    target_pack_paths: string[];
    deleted_task_ids: string[];
    deleted_pack_paths: string[];
    index_path: string;
    reindexed: boolean;
    remaining_entry_count: number;
};
export type MemoryUpdateResult = {
    schema: "axiom.agent_memory_update_result.v0";
    status: "ok";
    task_id: string;
    title: string;
    pack_path: string;
    index_path: string;
    appended_decision_count: number;
    appended_next_action_count: number;
    appended_semantic_ref_count: number;
    invalidated_hypothesis_count: number;
    evidence_count: number;
    command_count: number;
    graph_node_count: number;
    anchor_count: number;
    metrics: MemoryPackMetrics;
};
export type MemoryHandoffGuardResult = {
    schema: "axiom.agent_memory_handoff_guard.v0";
    status: "ok" | "warn" | "fail";
    changed_lines: number;
    added_lines: number;
    deleted_lines: number;
    changed_file_count: number;
    threshold: number;
    since_hours: number;
    recent_handoff_task_ids: string[];
    message: string;
    git_available: boolean;
};
export type AutoMemoryCaptureResult = MemoryCaptureResult | {
    schema: "axiom.agent_memory_auto_capture.v0";
    status: "skipped";
    reason: "no_context";
};
export type MemoryRecallResult = {
    schema: "axiom.agent_memory_recall.v0";
    status: "ok";
    query?: string;
    file?: string;
    task_id?: string;
    mode: MemoryRecallMode;
    profile: MemoryRecallProfile;
    hydration: MemoryRecallHydration;
    no_strong_match: boolean;
    strong_match_min_score: number;
    access_tiers: MemoryAccessTier[];
    results: MemoryRecallItem[];
    metrics: MemoryRecallMetrics;
    prefetch?: MemoryPrefetchResult;
};
export type MemoryFreshness = "fresh" | "recent" | "aging" | "old";
export type MemoryScoreComponent = {
    name: string;
    score: number;
    detail?: string;
};
export type MemoryScoreExplanation = {
    total: number;
    matched_terms: string[];
    unmatched_terms: string[];
    components: MemoryScoreComponent[];
};
export type MemoryRecallTimingMetrics = {
    read_parse_ms: number;
    candidate_selection_ms: number;
    ranking_ms: number;
    hydration_ms: number;
    total_ms: number;
};
export type MemoryProfiledRecallResult = MemoryRecallResult & {
    timings_ms: MemoryRecallTimingMetrics;
};
export type MemoryRecallMode = "current" | "history";
export type MemoryRecallProfile = "ultra" | "focused" | "full";
export type MemoryRecallProfileLimits = {
    default_limit: number;
    decision_limit: number;
    command_limit: number;
    next_action_limit: number;
    invalidated_hypothesis_limit: number;
    evidence_ref_limit: number;
    projected_strata_limit: number;
    projected_nodes_per_stratum_limit: number;
    projected_anchor_limit: number;
};
export type MemoryRecallHydration = {
    include_evidence: boolean;
    include_graph: boolean;
};
export type MemoryRecallItem = {
    task_id: string;
    title: string;
    score: number;
    recall_mode: MemoryRecallMode;
    recall_profile: MemoryRecallProfile;
    truncated: boolean;
    pack_path: string;
    created_at: string;
    updated_at: string;
    age_days: number;
    freshness: MemoryFreshness;
    source_scope?: string;
    tags: string[];
    canonical_tags: string[];
    agent_tags: string[];
    semantic_refs: MemorySemanticRef[];
    summary: AgentMemoryPack["summary"];
    decisions: MemoryDecision[];
    commands: MemoryCommandEvidence[];
    next_actions: string[];
    invalidated_hypotheses: MemoryInvalidatedHypothesis[];
    invalidated: boolean;
    invalidated_match_count: number;
    invalidated_score_penalty: number;
    invalidated_score_boost: number;
    projected_strata: MemoryProjectedStratum[];
    projected_anchors: MemoryProjectedAnchor[];
    evidence_refs: MemoryEvidenceRef[];
    full_evidence?: MemoryEvidence[];
    full_graph?: {
        strata: MemoryStratum[];
        nodes: MemoryGraphNode[];
        anchors: MemoryAnchor[];
    };
    score_explanation?: MemoryScoreExplanation;
    metrics: MemoryRecallMetrics;
};
export type MemoryRecallBenchmarkCase = {
    id: string;
    query: string;
    expected_task_ids?: string[];
    expect_no_strong_match?: boolean;
    max_rank?: number;
    mode?: MemoryRecallMode;
    profile?: MemoryRecallProfile;
    limit?: number;
};
export type MemoryRecallBenchmarkCaseResult = {
    id: string;
    query: string;
    mode: MemoryRecallMode;
    profile: MemoryRecallProfile;
    expected_task_ids: string[];
    expect_no_strong_match: boolean;
    max_rank?: number;
    predicted_no_strong_match: boolean;
    top_score: number;
    top_task_id?: string;
    rank?: number;
    reciprocal_rank: number;
    passed: boolean;
};
export type MemoryRecallBenchmarkReport = {
    schema: "axiom.agent_memory_benchmark.v0";
    status: "ok" | "failed";
    corpus_version: string;
    case_count: number;
    positive_case_count: number;
    no_strong_match_case_count: number;
    recall_at_1: number;
    recall_at_3: number;
    mrr: number;
    no_strong_match_precision: number;
    no_strong_match_accuracy: number;
    strong_match_min_score: number;
    results: MemoryRecallBenchmarkCaseResult[];
};
export type AgentMemoryRegistry = {
    schema: "axiom.agent_memory_registry.v0";
    version: 1;
    updated_at: string;
    projects: AgentMemoryProjectEntry[];
};
export type AgentMemoryProjectStorage = "copied" | "attached";
export type AgentMemoryProjectVisibility = "local" | "shared" | "global";
export type AgentMemoryProjectEntry = {
    project_id: string;
    title: string;
    workspace_path: string;
    storage: AgentMemoryProjectStorage;
    project_path?: string;
    index_path: string;
    pack_base_path: string;
    visibility: AgentMemoryProjectVisibility;
    agent_scope: string;
    domain_tags: string[];
    score_hints: string[];
    task_count: number;
    published_at: string;
    updated_at: string;
};
export type MemoryProjectPublishResult = {
    schema: "axiom.agent_memory_project_publish.v0";
    status: "ok";
    project_id: string;
    title: string;
    storage: AgentMemoryProjectStorage;
    registry_path: string;
    project_path?: string;
    index_path: string;
    task_count: number;
    copied_pack_count: number;
};
export type GlobalMemoryRecallResult = {
    schema: "axiom.agent_memory_global_recall.v0";
    status: "ok";
    query?: string;
    file?: string;
    task_id?: string;
    project_id?: string;
    mode: MemoryRecallMode;
    profile: MemoryRecallProfile;
    hydration: MemoryRecallHydration;
    no_strong_match: boolean;
    strong_match_min_score: number;
    access_tiers: MemoryAccessTier[];
    results: GlobalMemoryRecallItem[];
    metrics: MemoryRecallMetrics;
};
export type GlobalMemoryRecallItem = MemoryRecallItem & {
    project_id: string;
    project_title: string;
    storage: AgentMemoryProjectStorage;
    workspace_path: string;
    visibility: AgentMemoryProjectVisibility;
    agent_scope: string;
};
export type SessionMemoryEventKind = "assistant_update" | "user_message" | "command_run" | "command_result" | "grep_result" | "patch_applied" | "file_touched" | "test_result" | "decision" | "risk" | "next_action" | "note" | string;
export type SessionMemoryAnchor = {
    type: string;
    from: string;
    to: string;
    summary?: string;
    weight?: number;
};
export type SessionProfileFactStatus = "active" | "superseded";
export type SessionProfileFactConfidence = "explicit_user_statement";
export type SessionProfileFact = {
    key: string;
    value: string;
    recorded_at: string;
    source_event: string;
    confidence: SessionProfileFactConfidence;
    status: SessionProfileFactStatus;
    superseded_by?: string;
    superseded_at?: string;
};
export type SessionMemoryIndex = {
    schema: "axiom.agent_session_memory_index.v0";
    version: 1;
    session_id: string;
    created_at: string;
    updated_at: string;
    workspace_path: string;
    last_sequence: number;
    entries: SessionMemoryIndexEntry[];
    recent_messages: SessionMemoryRecentMessage[];
};
export type SessionMemoryIndexEntry = {
    sequence: number;
    event_id: string;
    kind: SessionMemoryEventKind;
    title: string;
    summary: string;
    created_at: string;
    profile_fact?: SessionProfileFact;
    chunk_path: string;
    tags: string[];
    files: string[];
    command?: string;
    status?: string;
    evidence_preview?: string;
    evidence_chars: number;
    compressed_bytes: number;
    score_hints: string[];
    evidence_refs: MemoryEvidenceRef[];
    anchors: SessionMemoryAnchor[];
};
export type SessionMemoryRecentMessage = {
    event_id: string;
    role: "assistant" | "user" | "system" | "tool" | "unknown";
    summary: string;
    created_at: string;
};
export type SessionMemoryCurrent = {
    schema: "axiom.agent_session_memory_current.v0";
    version: 1;
    active_session_id: string;
    updated_at: string;
};
export type SessionMemoryAppendResult = {
    schema: "axiom.agent_session_memory_append.v0";
    status: "ok";
    session_id: string;
    event_id: string;
    sequence: number;
    index_path: string;
    chunk_path: string;
    anchor_count: number;
    evidence_chars: number;
    compressed_bytes: number;
};
export type SessionMemoryListResult = {
    schema: "axiom.agent_session_memory_list.v0";
    status: "ok";
    sessions: SessionMemoryListItem[];
};
export type SessionMemoryListItem = {
    session_id: string;
    created_at: string;
    updated_at: string;
    event_count: number;
    recent_messages: SessionMemoryRecentMessage[];
    index_path: string;
};
export type SessionMemoryRecallResult = {
    schema: "axiom.agent_session_memory_recall.v0";
    status: "ok";
    session_id?: string;
    query?: string;
    event_id?: string;
    profile: MemoryRecallProfile;
    hydration: MemoryRecallHydration;
    results: SessionMemoryRecallItem[];
    recent_messages: SessionMemoryRecentMessage[];
    metrics: MemoryRecallMetrics;
};
export type SessionMemoryRecallItem = SessionMemoryIndexEntry & {
    score: number;
    truncated: boolean;
    full_evidence?: MemoryEvidence[];
};
export type MemoryWorkingWindowPendingEvent = {
    kind: SessionMemoryEventKind;
    title?: string;
    summary?: string;
    text?: string;
    command?: string;
    status?: string;
    files?: string[];
    tags?: string[];
    role?: SessionMemoryRecentMessage["role"];
};
export type MemoryWorkingWindowBreadcrumb = {
    source: "session" | "memory";
    id: string;
    summary: string;
    recall_hint: string;
};
export type MemoryWorkingWindowToolSpec = {
    name: "axmem_recall";
    description: string;
    input_schema: {
        source: ("session" | "memory" | "both")[];
        query: string;
        task_id?: string;
        event_id?: string;
        profile: MemoryRecallProfile[];
    };
};
export type MemoryWorkingWindowResult = {
    schema: "axiom.agent_memory_working_window.v0";
    status: "ok";
    session_id?: string;
    token_budget: number;
    estimated_tokens: number;
    truncated: boolean;
    system_prompt?: string;
    pinned_task_id?: string;
    pinned_card?: MemoryRecallItem;
    recent_events: SessionMemoryRecallItem[];
    active_cards: MemoryRecallItem[];
    breadcrumbs: MemoryWorkingWindowBreadcrumb[];
    tools: MemoryWorkingWindowToolSpec[];
    prefetch?: MemoryPrefetchResult;
};
export type MemoryWorkingWindowFlushResult = {
    schema: "axiom.agent_memory_working_window_flush.v0";
    status: "ok" | "blocked";
    appended_events: SessionMemoryAppendResult[];
    eviction: MemoryTierEvictionResult;
    window: MemoryWorkingWindowResult;
};
export type MemoryWorkingWindowRecallToolResult = {
    schema: "axiom.agent_memory_recall_tool.v0";
    status: "ok";
    source: "session" | "memory" | "both";
    session?: SessionMemoryRecallResult;
    memory?: MemoryRecallResult;
    estimated_tokens: number;
};
export type MemoryPackMetrics = {
    raw_evidence_chars: number;
    pack_json_chars: number;
    compressed_pack_bytes: number;
    estimated_raw_tokens: number;
    estimated_pack_json_tokens: number;
    json_to_compressed_ratio: number;
};
export type MemoryRecallMetrics = {
    raw_evidence_chars: number;
    compressed_pack_bytes: number;
    recall_chars: number;
    estimated_raw_tokens: number;
    estimated_recall_tokens: number;
    estimated_context_tokens_saved: number;
    estimated_context_savings_ratio: number;
    json_to_compressed_ratio: number;
};
export declare function packMemoryPack(pack: AgentMemoryPack): Buffer;
export declare function unpackMemoryPack(bytes: Buffer | Uint8Array): AgentMemoryPack;
export declare function captureMemoryPack(input: {
    cwd: string;
    taskId: string;
    title: string;
    tags?: string[];
    invalidatedHypotheses?: MemoryInvalidatedHypothesis[];
    resumeCommand?: string;
}): MemoryCaptureResult;
export declare function ingestMemoryPack(input: {
    cwd: string;
    document: MemoryIngestDocument;
    taskId?: string;
    title?: string;
    tags?: string[];
}): MemoryIngestResult;
export declare function autoCaptureMemoryPack(input: {
    cwd: string;
    taskId?: string;
    title?: string;
    tags?: string[];
}): AutoMemoryCaptureResult;
export declare function appendSessionMemory(input: {
    cwd: string;
    sessionId?: string;
    kind: SessionMemoryEventKind;
    title?: string;
    summary?: string;
    text?: string;
    command?: string;
    status?: string;
    files?: string[];
    tags?: string[];
    role?: SessionMemoryRecentMessage["role"];
}): SessionMemoryAppendResult;
export declare function listSessionMemory(input: {
    cwd: string;
}): SessionMemoryListResult;
export declare function recallSessionMemory(input: {
    cwd: string;
    sessionId?: string;
    query?: string;
    eventId?: string;
    limit?: number;
    includeEvidence?: boolean;
    profile?: MemoryRecallProfile;
}): SessionMemoryRecallResult;
export declare function buildMemoryWorkingWindow(input: {
    cwd: string;
    sessionId?: string;
    taskId?: string;
    query?: string;
    systemPrompt?: string;
    tokenBudget?: number;
    recentEventLimit?: number;
    activeCardLimit?: number;
    includeTool?: boolean;
    prefetch?: boolean;
}): MemoryWorkingWindowResult;
export declare function flushMemoryWorkingWindow(input: {
    cwd: string;
    sessionId?: string;
    pendingEvents?: MemoryWorkingWindowPendingEvent[];
    taskId?: string;
    query?: string;
    systemPrompt?: string;
    tokenBudget?: number;
    recentEventLimit?: number;
    activeCardLimit?: number;
    maxPackCacheBytes?: number;
    prefetch?: boolean;
}): MemoryWorkingWindowFlushResult;
export declare function runAxmemRecallTool(input: {
    cwd: string;
    source?: "session" | "memory" | "both";
    sessionId?: string;
    query?: string;
    taskId?: string;
    eventId?: string;
    profile?: MemoryRecallProfile;
    limit?: number;
    includeEvidence?: boolean;
}): MemoryWorkingWindowRecallToolResult;
export declare function readSessionMemoryIndex(cwd: string, sessionId?: string): SessionMemoryIndex;
export declare function reindexMemory(input: {
    cwd: string;
    reason?: "manual" | "auto_upgrade";
}): MemoryReindexResult;
export declare function deleteMemory(input: {
    cwd: string;
    taskIds: string[];
    dryRun?: boolean;
}): MemoryDeleteResult;
export declare function updateMemoryPack(input: {
    cwd: string;
    taskId: string;
    title?: string;
    summary?: string;
    appendDecisions?: string[];
    appendNextActions?: string[];
    semanticRefs?: MemorySemanticRef[];
    tags?: string[];
    invalidatedHypotheses?: MemoryInvalidatedHypothesis[];
    evidence?: (Partial<MemoryEvidence> & {
        data?: unknown;
    })[];
}): MemoryUpdateResult;
export declare function guardMemoryHandoff(input: {
    cwd: string;
    threshold?: number;
    sinceHours?: number;
    failOnWarn?: boolean;
}): MemoryHandoffGuardResult;
export declare function readMemoryIndex(cwd: string): AgentMemoryIndex;
export declare function prefetchMemoryPacks(input: {
    cwd: string;
    seedTaskIds: string[];
    limit?: number;
    maxCacheBytes?: number;
}): MemoryPrefetchResult;
export declare function recallMemory(input: {
    cwd: string;
    taskId?: string;
    query?: string;
    file?: string;
    limit?: number;
    includeEvidence?: boolean;
    includeGraph?: boolean;
    mode?: MemoryRecallMode;
    profile?: MemoryRecallProfile;
    prefetch?: boolean;
    prefetchLimit?: number;
    explainScore?: boolean;
}): MemoryRecallResult;
export declare function recallMemoryProfiled(input: {
    cwd: string;
    taskId?: string;
    query?: string;
    file?: string;
    limit?: number;
    includeEvidence?: boolean;
    includeGraph?: boolean;
    mode?: MemoryRecallMode;
    profile?: MemoryRecallProfile;
    prefetch?: boolean;
    prefetchLimit?: number;
    explainScore?: boolean;
}): MemoryProfiledRecallResult;
export declare function evaluateMemoryRecallBenchmark(input: {
    cwd: string;
    cases: MemoryRecallBenchmarkCase[];
    corpusVersion?: string;
    profile?: MemoryRecallProfile;
    limit?: number;
    strongMatchMinScore?: number;
}): MemoryRecallBenchmarkReport;
export declare function buildMemorySearchStore(input: {
    cwd: string;
    index?: AgentMemoryIndex;
    reason?: MemorySearchStoreBuildResult["reason"];
    corruptionRecoveryCount?: number;
}): MemorySearchStoreBuildResult;
export declare function compareMemorySearchStore(input: {
    cwd: string;
    cases: MemorySearchStoreCompareCase[];
}): MemorySearchStoreCompareResult;
export declare function publishMemoryProject(input: {
    cwd: string;
    memoryHome?: string;
    projectId?: string;
    title?: string;
    visibility?: AgentMemoryProjectVisibility;
    agentScope?: string;
    domainTags?: string[];
}): MemoryProjectPublishResult;
export declare function attachMemoryProject(input: {
    memoryHome?: string;
    workspacePath: string;
    projectId?: string;
    title?: string;
    visibility?: AgentMemoryProjectVisibility;
    agentScope?: string;
    domainTags?: string[];
}): MemoryProjectPublishResult;
export declare function readGlobalMemoryRegistry(memoryHome?: string): AgentMemoryRegistry;
export declare function recallGlobalMemory(input: {
    memoryHome?: string;
    projectId?: string;
    taskId?: string;
    query?: string;
    file?: string;
    limit?: number;
    includeEvidence?: boolean;
    includeGraph?: boolean;
    mode?: MemoryRecallMode;
    profile?: MemoryRecallProfile;
    explainScore?: boolean;
}): GlobalMemoryRecallResult;
export declare function renderMemoryIndex(index: AgentMemoryIndex): string;
export declare function renderMemoryCapture(result: MemoryCaptureResult): string;
export declare function renderMemoryIngest(result: MemoryIngestResult): string;
export declare function renderMemoryUpdate(result: MemoryUpdateResult): string;
export declare function renderMemoryHandoffGuard(result: MemoryHandoffGuardResult): string;
export declare function renderMemoryReindex(result: MemoryReindexResult): string;
export declare function renderMemoryDelete(result: MemoryDeleteResult): string;
export declare function renderMemoryProjectPublish(result: MemoryProjectPublishResult): string;
export declare function renderMemoryProjects(registry: AgentMemoryRegistry): string;
export declare function renderRecallCardChars(item: Omit<MemoryRecallItem, "metrics">): number;
export declare function renderMemoryRecall(result: MemoryRecallResult): string;
export declare function renderGlobalMemoryRecall(result: GlobalMemoryRecallResult): string;
export declare function renderSessionMemoryList(result: SessionMemoryListResult): string;
export declare function renderSessionMemoryAppend(result: SessionMemoryAppendResult): string;
export declare function renderSessionMemoryRecall(result: SessionMemoryRecallResult): string;
export declare function validateMemoryPack(pack: AgentMemoryPack): void;
export declare function stageMemoryPackInHotTier(input: {
    cwd: string;
    pack: AgentMemoryPack;
    packPath?: string;
    pinned?: boolean;
    pinReason?: string;
}): MemoryTierStageResult;
export declare function getMemoryTierCacheStats(): MemoryTierCacheStats;
export declare function clearMemoryTierCaches(): void;
export declare function pinMemoryPackTierEntry(input: {
    cwd: string;
    packPath: string;
    reason?: string;
}): boolean;
export declare function unpinMemoryPackTierEntry(input: {
    cwd: string;
    packPath: string;
}): boolean;
export declare function promoteMemoryPackTierEntry(input: {
    cwd: string;
    packPath: string;
}): boolean;
export declare function evictMemoryTiers(input?: {
    cwd?: string;
    maxCompressedBytes?: number;
}): MemoryTierEvictionResult;
