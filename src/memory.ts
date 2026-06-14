import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import * as zlib from "node:zlib"
import { spawnSync } from "node:child_process"
import { performance } from "node:perf_hooks"
import { readContext, readContextHistory, readSessionLog, type AgentContext, type ContextHistoryEntry, type SessionLogEntry } from "./context"

export type AxmemStorageLayout = "standalone" | "axiom" | "auto"

const standaloneDir = ".axmem"
const axiomCompatDir = ".axiom"
let axiomDir = standaloneDir

export function resolveAxmemStorageDir(cwd: string, layout: AxmemStorageLayout = "auto"): string {
    if (layout === "standalone") return standaloneDir
    if (layout === "axiom") return axiomCompatDir
    if (fs.existsSync(path.join(cwd, standaloneDir, memoryDir))) return standaloneDir
    if (fs.existsSync(path.join(cwd, axiomCompatDir, memoryDir))) return axiomCompatDir
    return standaloneDir
}

export function setAxmemStorageLayout(layout: AxmemStorageLayout = "auto", cwd = process.cwd()): string {
    axiomDir = resolveAxmemStorageDir(cwd, layout)
    return axiomDir
}
const memoryDir = "memory"
const indexFileName = "index.axmem.json"
const searchStoreDir = "search"
const searchManifestFileName = "manifest.axsearch.json"
const sessionMemoryDir = "sessions"
const sessionIndexFileName = "index.axsession.json"
const currentSessionFileName = "current.axsession.json"

const MAGIC = Buffer.from([0x41, 0x58, 0x4d, 0x45, 0x4d, 0x00, 0x00, 0x00])
const VERSION = 1
const CODEC_ZLIB = 1
const HEADER_LEN = 32
const GRAPH_NODE_RECALL_LIMIT = 8
const GRAPH_ANCHOR_RECALL_LIMIT = 6
const GRAPH_ANCHOR_ENDPOINT_RESERVE = 2
const EXPLICIT_ANCHOR_DEFAULT_WEIGHT = 50
const MEMORY_EVIDENCE_LIMIT = 80
const MEMORY_EVIDENCE_DATA_CHAR_LIMIT = 4_000
const MEMORY_PACK_JSON_CHAR_LIMIT = 512_000
const MEMORY_INDEX_SCORE_HINT_LIMIT = 160
const MEMORY_INDEX_ANCHOR_HINT_LIMIT = 80
const MEMORY_INDEX_SUMMARY_PREVIEW_CHAR_LIMIT = 800
const MEMORY_INDEX_TEXT_PREVIEW_CHAR_LIMIT = 600
const MEMORY_INDEX_DECISION_HINT_LIMIT = 8
const MEMORY_INDEX_COMMAND_HINT_LIMIT = 8
const MEMORY_INDEX_NEXT_ACTION_HINT_LIMIT = 12
const MEMORY_INDEX_INVALIDATED_HINT_LIMIT = 8
const MEMORY_INDEX_EVIDENCE_REF_LIMIT = 12
const MEMORY_INDEX_STRATA_PREVIEW_LIMIT = 8
const MEMORY_INDEX_ANCHOR_REF_LIMIT = 12
const MEMORY_STRATA_PREVIEW_NODE_LIMIT = 4
const MEMORY_RECALL_STRONG_MATCH_MIN_SCORE = 24
const MEMORY_PACK_CACHE_MAX_COMPRESSED_BYTES = 8 * 1024 * 1024
const MEMORY_VECTOR_DIMENSIONS = 64
const MEMORY_VECTOR_MODEL_ID = "axiom-local-hash-bow-v1"
const MEMORY_SEARCH_DOCUMENT_SHARD_COUNT = 1024
const MEMORY_SEARCH_INLINE_VECTOR_CELL_LIMIT = 1_000
const MEMORY_HANDOFF_GUARD_CHANGED_LINE_THRESHOLD = 2_000
const MEMORY_HANDOFF_GUARD_RECENT_HOURS = 24
let memoryIndexGeneration = 0
let memoryPackCacheBytes = 0
const memoryIndexCache = new Map<string, MemoryIndexCacheEntry>()
const memoryPackCache = new Map<string, MemoryPackCacheEntry>()
const memorySearchManifestCache = new Map<string, MemorySearchManifestCacheEntry>()
const memoryIndexHashCache = new Map<string, MemoryIndexHashCacheEntry>()

function memoryMutationActive(id: string): boolean {
    return (process.env.AXIOM_AXMEM_MUTATE ?? process.env.AXIOM_MUTATE ?? "") === id
}
const MEMORY_RECALL_PROFILE_LIMITS: Record<MemoryRecallProfile, MemoryRecallProfileLimits> = {
    ultra: {
        default_limit: 3,
        decision_limit: 3,
        command_limit: 3,
        next_action_limit: 3,
        invalidated_hypothesis_limit: 3,
        evidence_ref_limit: 2,
        projected_strata_limit: 3,
        projected_nodes_per_stratum_limit: 2,
        projected_anchor_limit: 3
    },
    focused: {
        default_limit: 5,
        decision_limit: 10,
        command_limit: 10,
        next_action_limit: 20,
        invalidated_hypothesis_limit: 10,
        evidence_ref_limit: 20,
        projected_strata_limit: 6,
        projected_nodes_per_stratum_limit: 6,
        projected_anchor_limit: 6
    },
    full: {
        default_limit: 5,
        decision_limit: 100,
        command_limit: 100,
        next_action_limit: 100,
        invalidated_hypothesis_limit: 100,
        evidence_ref_limit: 100,
        projected_strata_limit: 12,
        projected_nodes_per_stratum_limit: 12,
        projected_anchor_limit: 12
    }
}
const CANONICAL_TAG_ALIASES: Record<string, string> = {
    agent: "agent",
    agents: "agent",
    asset: "assets",
    assets: "assets",
    backend: "backend",
    bevy: "bevy",
    build: "build",
    cache: "cache",
    camera: "camera",
    checkpoint: "checkpoint",
    cli: "cli",
    collision: "physics",
    compiler: "compiler",
    context: "context",
    diagnostics: "diagnostics",
    docs: "docs",
    documentation: "docs",
    effect: "effects",
    effects: "effects",
    event: "semantic",
    frontend: "frontend",
    fx: "effects",
    game: "game",
    graphics: "graphics",
    invariant: "semantic",
    lexer: "compiler",
    lod: "lod",
    lowering: "compiler",
    memory: "memory",
    mesh: "mesh",
    parser: "compiler",
    physics: "physics",
    policy: "policy",
    registry: "registry",
    render: "graphics",
    rendering: "graphics",
    runtime: "runtime",
    rust: "rust",
    scenario: "semantic",
    security: "security",
    semantic: "semantic",
    semantics: "semantic",
    sql: "sql",
    storage: "storage",
    test: "tests",
    tests: "tests",
    typescript: "typescript",
    ui: "frontend"
}

export type AgentMemoryPack = {
    schema: "axiom.agent_memory_pack.v0"
    version: 1
    task: {
        id: string
        title: string
        tags: string[]
        canonical_tags?: string[]
        agent_tags?: string[]
        created_at: string
        updated_at: string
    }
    summary: {
        goal?: string
        last_completed_step?: string
        next_recommended_step?: string
        resume_prompt?: string
        recent_message?: string
        resume_command?: string
    }
    semantic_refs: MemorySemanticRef[]
    decisions: MemoryDecision[]
    commands: MemoryCommandEvidence[]
    next_actions: string[]
    invalidated_hypotheses?: MemoryInvalidatedHypothesis[]
    evidence: MemoryEvidence[]
    strata?: MemoryStratum[]
    nodes?: MemoryGraphNode[]
    anchors?: MemoryAnchor[]
}

export type AgentMemoryIndex = {
    schema: "axiom.agent_memory_index.v0"
    version: 1
    updated_at: string
    entries: AgentMemoryIndexEntry[]
}

type MemoryIndexCacheEntry = {
    file_path: string
    content_hash: string
    mtime_ms: number
    size: number
    generation: number
    index: AgentMemoryIndex
}

type MemoryPackCacheEntry = {
    file_path: string
    absolute_path: string
    content_hash: string
    mtime_ms: number
    size: number
    compressed_bytes: number
    persisted: boolean
    dirty: boolean
    pinned: boolean
    pin_reason?: string
    access_count: number
    last_accessed_ms: number
    pack: AgentMemoryPack
}

type MemorySearchManifestCacheEntry = {
    file_path: string
    mtime_ms: number
    size: number
    manifest: MemorySearchStoreManifest
}

type MemoryIndexHashCacheEntry = {
    file_path: string
    mtime_ms: number
    size: number
    hash: string
}

export type MemorySearchStoreManifest = {
    schema: "axiom.agent_memory_search_store.v0"
    version: 1
    built_at: string
    updated_at: string
    source_index_hash: string
    source_entry_count: number
    token_files: Record<string, string>
    document_files: Record<string, string>
    document_layout?: "files" | "sharded"
    document_shard_files?: Record<string, string>
    entry_hashes: Record<string, string>
    embedding?: MemoryEmbeddingMetadata
    vector_cells?: Record<string, string[]>
    vector_cell_files?: Record<string, string>
    corruption_recovery_count: number
}

export type MemoryEmbeddingMetadata = {
    schema: "axiom.agent_memory_embedding_metadata.v0"
    model_id: string
    dimensions: number
    normalization: "l2"
    corpus_fingerprint: string
    generated_at: string
}

type MemorySearchPosting = {
    task_id: string
    weight: number
}

type MemorySearchPostingsFile = {
    schema: "axiom.agent_memory_search_postings.v0"
    version: 1
    token: string
    postings: MemorySearchPosting[]
}

type MemorySearchDocumentFile = {
    schema: "axiom.agent_memory_search_document.v0"
    version: 1
    task_id: string
    terms: Record<string, number>
    embedding_cells: string[]
    entry: AgentMemoryIndexEntry
}

type MemorySearchDocumentShardFile = {
    schema: "axiom.agent_memory_search_document_shard.v0"
    version: 1
    shard_id: string
    documents: Record<string, MemorySearchDocumentFile>
}

type MemorySearchVectorCellFile = {
    schema: "axiom.agent_memory_vector_cell.v0"
    version: 1
    cell: string
    task_ids: string[]
}

export type MemorySearchStoreBuildResult = {
    schema: "axiom.agent_memory_search_store_build.v0"
    status: "ok"
    reason: "manual" | "write" | "reindex" | "corruption_recovery"
    manifest_path: string
    source_entry_count: number
    token_count: number
    document_count: number
    source_index_hash: string
    corruption_recovery_count: number
}

export type MemorySearchStoreCompareCase = {
    id: string
    query?: string
    taskId?: string
    mode?: MemoryRecallMode
    profile?: MemoryRecallProfile
    limit?: number
}

export type MemorySearchStoreCompareResult = {
    schema: "axiom.agent_memory_search_store_compare.v0"
    status: "ok" | "failed"
    case_count: number
    cases: {
        id: string
        comparison_status: "matched" | "mismatched" | "not_compared"
        search_exercised: boolean
        json_top_task_id?: string
        search_top_task_id?: string
        json_task_ids: string[]
        search_task_ids: string[]
        json_no_strong_match: boolean
        search_no_strong_match: boolean
        passed: boolean
    }[]
}

export type AgentMemoryIndexEntry = {
    task_id: string
    title: string
    pack_path: string
    created_at: string
    updated_at: string
    tags: string[]
    canonical_tags?: string[]
    agent_tags?: string[]
    semantic_refs: MemorySemanticRef[]
    score_hints: string[]
    invalidated_score_hints?: string[]
    strata_refs?: MemoryStratumRef[]
    anchor_hints?: string[]
    summary_preview?: AgentMemoryPack["summary"]
    decision_hints?: MemoryDecision[]
    command_hints?: MemoryCommandEvidence[]
    next_action_hints?: string[]
    invalidated_hypotheses?: MemoryInvalidatedHypothesis[]
    evidence_refs?: MemoryEvidenceRef[]
    strata_previews?: MemoryProjectedStratum[]
    anchor_refs?: MemoryProjectedAnchor[]
    raw_evidence_chars?: number
    pack_json_chars?: number
    evidence_count: number
    command_count: number
    graph_node_count?: number
    anchor_count?: number
    invalidated_hypothesis_count?: number
    resume_command?: string
    source_scope?: string
}

export type MemorySemanticRef = {
    kind: string
    name: string
}

export type MemoryDecision = {
    kind: string
    summary: string
    node?: string
    reason?: string
}

export type MemoryCommandEvidence = {
    command: string
    status?: string
    summary?: string
    source: "context_test_run" | "session_log" | "agent_ingest"
}

export type MemoryEvidence = {
    id: string
    kind: string
    path?: string
    summary: string
    data: unknown
}

export type MemoryEvidenceRef = {
    id: string
    kind: string
    path?: string
    summary: string
}

export type MemoryInvalidatedHypothesis = {
    hypothesis: string
    reason?: string
    invalidated_by: string[]
    next_better_hypothesis?: string
    source?: "capture_option" | "evidence" | "agent_ingest"
}

export type MemoryIngestDocument = {
    schema?: "axiom.agent_memory_ingest.v0"
    task?: {
        id?: string
        title?: string
        tags?: string[]
        canonical_tags?: string[]
        agent_tags?: string[]
    }
    task_id?: string
    title?: string
    tags?: string[]
    summary?: Partial<AgentMemoryPack["summary"]> | string
    semantic_refs?: MemorySemanticRef[]
    decisions?: (MemoryDecision | string)[]
    commands?: (MemoryCommandEvidence | string)[]
    next_actions?: string[]
    invalidated_hypotheses?: MemoryInvalidatedHypothesis[]
    evidence?: (Partial<MemoryEvidence> & { data?: unknown })[]
    strata?: Partial<MemoryStratum>[]
    nodes?: Partial<MemoryGraphNode>[]
    anchors?: Partial<MemoryAnchor>[]
}

export type MemoryStratum = {
    id: string
    part: string
    name: string
    kind: string
    node_ids: string[]
    score_hints: string[]
}

export type MemoryGraphNodeStatus = "active" | "invalidated" | "stale" | "speculative"
export type MemoryTrustTier = "proved" | "contracted" | "hypothesis" | "invalidated"
export type MemoryAccessTier = "L0_RAM_INDEX" | "L1_PACK_LRU" | "L2_SEARCH_STORE" | "L2_COMPRESSED_PACK" | "L3_VECTOR_INDEX"

export type MemoryTierCacheEntryStats = {
    pack_path: string
    compressed_bytes: number
    persisted: boolean
    dirty: boolean
    pinned: boolean
    access_count: number
}

export type MemoryTierCacheStats = {
    schema: "axiom.agent_memory_tier_cache_stats.v0"
    pack_cache_entries: number
    pack_cache_bytes: number
    pack_cache_max_bytes: number
    pinned_entries: number
    dirty_entries: number
    entries: MemoryTierCacheEntryStats[]
}

export type MemoryTierEvictionResult = {
    schema: "axiom.agent_memory_tier_eviction.v0"
    status: "ok" | "blocked"
    requested_max_bytes: number
    evicted_count: number
    evicted_pack_paths: string[]
    skipped_pinned_count: number
    persisted_before_evict_count: number
    blocked_pack_paths: string[]
    remaining_pack_cache_bytes: number
    remaining_pack_cache_entries: number
}

export type MemoryTierStageResult = {
    schema: "axiom.agent_memory_tier_stage.v0"
    status: "ok"
    pack_path: string
    compressed_bytes: number
    pinned: boolean
}

export type MemoryPrefetchResult = {
    schema: "axiom.agent_memory_prefetch.v0"
    status: "ok"
    seed_task_ids: string[]
    prefetched_task_ids: string[]
    skipped_task_ids: string[]
    candidate_count: number
    cache_before_bytes: number
    cache_after_bytes: number
}

export type MemoryGraphNode = {
    id: string
    part: string
    stratum: string
    kind: string
    title: string
    summary?: string
    status?: MemoryGraphNodeStatus
    trust_tier?: MemoryTrustTier
    tags?: string[]
    semantic_refs?: MemorySemanticRef[]
    evidence_refs?: string[]
    score_hints?: string[]
}

export type MemoryAnchorType =
    | "relates_to"
    | "depends_on"
    | "invalidates"
    | "fixes"
    | "causes"
    | "conflicts_with"
    | "supersedes"
    | "uses"
    | "evidenced_by"
    | "reproduced_by"
    | "resumes"

export type MemoryAnchorStatus = "active" | "invalidated" | "stale" | "speculative"

export type MemoryAnchor = {
    id: string
    type: MemoryAnchorType | string
    from: string
    to: string
    status: MemoryAnchorStatus
    summary?: string
    evidence_refs?: string[]
    score_hints?: string[]
    weight?: number
}

export type MemoryStratumRef = {
    id: string
    part: string
    name: string
    kind: string
    node_count: number
}

export type MemoryProjectedNode = {
    id: string
    kind: string
    title: string
    status?: MemoryGraphNodeStatus
    evidence_refs?: string[]
}

export type MemoryProjectedStratum = MemoryStratumRef & {
    nodes: MemoryProjectedNode[]
}

export type MemoryProjectedAnchor = {
    id: string
    type: string
    from: string
    from_title?: string
    to: string
    to_title?: string
    status: MemoryAnchorStatus
    summary?: string
    evidence_refs?: string[]
    weight?: number
}

export type MemoryCaptureResult = {
    schema: "axiom.agent_memory_capture.v0"
    status: "ok"
    task_id: string
    title: string
    pack_path: string
    index_path: string
    evidence_count: number
    command_count: number
    metrics: MemoryPackMetrics
}

export type MemoryIngestResult = {
    schema: "axiom.agent_memory_ingest_result.v0"
    status: "ok"
    task_id: string
    title: string
    pack_path: string
    index_path: string
    evidence_count: number
    command_count: number
    graph_node_count: number
    anchor_count: number
    metrics: MemoryPackMetrics
}

export type MemoryReindexResult = {
    schema: "axiom.agent_memory_reindex.v0"
    status: "ok"
    reason: "manual" | "auto_upgrade"
    index_path: string
    pack_count: number
    entry_count: number
    entries: {
        task_id: string
        title: string
        pack_path: string
        graph_node_count: number
        anchor_count: number
        invalidated_hypothesis_count: number
    }[]
}

export type MemoryDeleteResult = {
    schema: "axiom.agent_memory_delete.v0"
    status: "ok" | "not_found" | "dry_run"
    dry_run: boolean
    requested_task_ids: string[]
    matched_task_ids: string[]
    missing_task_ids: string[]
    target_pack_paths: string[]
    deleted_task_ids: string[]
    deleted_pack_paths: string[]
    index_path: string
    reindexed: boolean
    remaining_entry_count: number
}

export type MemoryUpdateResult = {
    schema: "axiom.agent_memory_update_result.v0"
    status: "ok"
    task_id: string
    title: string
    pack_path: string
    index_path: string
    appended_decision_count: number
    appended_next_action_count: number
    appended_semantic_ref_count: number
    invalidated_hypothesis_count: number
    evidence_count: number
    command_count: number
    graph_node_count: number
    anchor_count: number
    metrics: MemoryPackMetrics
}

export type MemoryHandoffGuardResult = {
    schema: "axiom.agent_memory_handoff_guard.v0"
    status: "ok" | "warn" | "fail"
    changed_lines: number
    added_lines: number
    deleted_lines: number
    changed_file_count: number
    threshold: number
    since_hours: number
    recent_handoff_task_ids: string[]
    message: string
    git_available: boolean
}

export type AutoMemoryCaptureResult = MemoryCaptureResult | {
    schema: "axiom.agent_memory_auto_capture.v0"
    status: "skipped"
    reason: "no_context"
}

export type MemoryRecallResult = {
    schema: "axiom.agent_memory_recall.v0"
    status: "ok"
    query?: string
    file?: string
    task_id?: string
    mode: MemoryRecallMode
    profile: MemoryRecallProfile
    hydration: MemoryRecallHydration
    no_strong_match: boolean
    strong_match_min_score: number
    access_tiers: MemoryAccessTier[]
    results: MemoryRecallItem[]
    metrics: MemoryRecallMetrics
    prefetch?: MemoryPrefetchResult
}

export type MemoryFreshness = "fresh" | "recent" | "aging" | "old"

export type MemoryScoreComponent = {
    name: string
    score: number
    detail?: string
}

export type MemoryScoreExplanation = {
    total: number
    matched_terms: string[]
    unmatched_terms: string[]
    components: MemoryScoreComponent[]
}

export type MemoryRecallTimingMetrics = {
    read_parse_ms: number
    candidate_selection_ms: number
    ranking_ms: number
    hydration_ms: number
    total_ms: number
}

export type MemoryProfiledRecallResult = MemoryRecallResult & {
    timings_ms: MemoryRecallTimingMetrics
}

export type MemoryRecallMode = "current" | "history"
export type MemoryRecallProfile = "ultra" | "focused" | "full"

export type MemoryRecallProfileLimits = {
    default_limit: number
    decision_limit: number
    command_limit: number
    next_action_limit: number
    invalidated_hypothesis_limit: number
    evidence_ref_limit: number
    projected_strata_limit: number
    projected_nodes_per_stratum_limit: number
    projected_anchor_limit: number
}

export type MemoryRecallHydration = {
    include_evidence: boolean
    include_graph: boolean
}

export type MemoryRecallItem = {
    task_id: string
    title: string
    score: number
    recall_mode: MemoryRecallMode
    recall_profile: MemoryRecallProfile
    truncated: boolean
    pack_path: string
    created_at: string
    updated_at: string
    age_days: number
    freshness: MemoryFreshness
    source_scope?: string
    tags: string[]
    canonical_tags: string[]
    agent_tags: string[]
    semantic_refs: MemorySemanticRef[]
    summary: AgentMemoryPack["summary"]
    decisions: MemoryDecision[]
    commands: MemoryCommandEvidence[]
    next_actions: string[]
    invalidated_hypotheses: MemoryInvalidatedHypothesis[]
    invalidated: boolean
    invalidated_match_count: number
    invalidated_score_penalty: number
    invalidated_score_boost: number
    projected_strata: MemoryProjectedStratum[]
    projected_anchors: MemoryProjectedAnchor[]
    evidence_refs: MemoryEvidenceRef[]
    full_evidence?: MemoryEvidence[]
    full_graph?: {
        strata: MemoryStratum[]
        nodes: MemoryGraphNode[]
        anchors: MemoryAnchor[]
    }
    score_explanation?: MemoryScoreExplanation
    metrics: MemoryRecallMetrics
}

export type MemoryRecallBenchmarkCase = {
    id: string
    query: string
    expected_task_ids?: string[]
    expect_no_strong_match?: boolean
    max_rank?: number
    mode?: MemoryRecallMode
    profile?: MemoryRecallProfile
    limit?: number
}

export type MemoryRecallBenchmarkCaseResult = {
    id: string
    query: string
    mode: MemoryRecallMode
    profile: MemoryRecallProfile
    expected_task_ids: string[]
    expect_no_strong_match: boolean
    max_rank?: number
    predicted_no_strong_match: boolean
    top_score: number
    top_task_id?: string
    rank?: number
    reciprocal_rank: number
    passed: boolean
}

export type MemoryRecallBenchmarkReport = {
    schema: "axiom.agent_memory_benchmark.v0"
    status: "ok" | "failed"
    corpus_version: string
    case_count: number
    positive_case_count: number
    no_strong_match_case_count: number
    recall_at_1: number
    recall_at_3: number
    mrr: number
    no_strong_match_precision: number
    no_strong_match_accuracy: number
    strong_match_min_score: number
    results: MemoryRecallBenchmarkCaseResult[]
}

export type AgentMemoryRegistry = {
    schema: "axiom.agent_memory_registry.v0"
    version: 1
    updated_at: string
    projects: AgentMemoryProjectEntry[]
}

export type AgentMemoryProjectStorage = "copied" | "attached"
export type AgentMemoryProjectVisibility = "local" | "shared" | "global"

export type AgentMemoryProjectEntry = {
    project_id: string
    title: string
    workspace_path: string
    storage: AgentMemoryProjectStorage
    project_path?: string
    index_path: string
    pack_base_path: string
    visibility: AgentMemoryProjectVisibility
    agent_scope: string
    domain_tags: string[]
    score_hints: string[]
    task_count: number
    published_at: string
    updated_at: string
}

export type MemoryProjectPublishResult = {
    schema: "axiom.agent_memory_project_publish.v0"
    status: "ok"
    project_id: string
    title: string
    storage: AgentMemoryProjectStorage
    registry_path: string
    project_path?: string
    index_path: string
    task_count: number
    copied_pack_count: number
}

export type GlobalMemoryRecallResult = {
    schema: "axiom.agent_memory_global_recall.v0"
    status: "ok"
    query?: string
    file?: string
    task_id?: string
    project_id?: string
    mode: MemoryRecallMode
    profile: MemoryRecallProfile
    hydration: MemoryRecallHydration
    no_strong_match: boolean
    strong_match_min_score: number
    access_tiers: MemoryAccessTier[]
    results: GlobalMemoryRecallItem[]
    metrics: MemoryRecallMetrics
}

export type GlobalMemoryRecallItem = MemoryRecallItem & {
    project_id: string
    project_title: string
    storage: AgentMemoryProjectStorage
    workspace_path: string
    visibility: AgentMemoryProjectVisibility
    agent_scope: string
}

export type SessionMemoryEventKind =
    | "assistant_update"
    | "user_message"
    | "command_run"
    | "command_result"
    | "grep_result"
    | "patch_applied"
    | "file_touched"
    | "test_result"
    | "decision"
    | "risk"
    | "next_action"
    | "note"
    | string

export type SessionMemoryAnchor = {
    type: string
    from: string
    to: string
    summary?: string
    weight?: number
}

export type SessionProfileFactStatus = "active" | "superseded"
export type SessionProfileFactConfidence = "explicit_user_statement"

export type SessionProfileFact = {
    key: string
    value: string
    recorded_at: string
    source_event: string
    confidence: SessionProfileFactConfidence
    status: SessionProfileFactStatus
    superseded_by?: string
    superseded_at?: string
}

export type SessionMemoryIndex = {
    schema: "axiom.agent_session_memory_index.v0"
    version: 1
    session_id: string
    created_at: string
    updated_at: string
    workspace_path: string
    last_sequence: number
    entries: SessionMemoryIndexEntry[]
    recent_messages: SessionMemoryRecentMessage[]
}

export type SessionMemoryIndexEntry = {
    sequence: number
    event_id: string
    kind: SessionMemoryEventKind
    title: string
    summary: string
    created_at: string
    profile_fact?: SessionProfileFact
    chunk_path: string
    tags: string[]
    files: string[]
    command?: string
    status?: string
    evidence_preview?: string
    evidence_chars: number
    compressed_bytes: number
    score_hints: string[]
    evidence_refs: MemoryEvidenceRef[]
    anchors: SessionMemoryAnchor[]
}

export type SessionMemoryRecentMessage = {
    event_id: string
    role: "assistant" | "user" | "system" | "tool" | "unknown"
    summary: string
    created_at: string
}

export type SessionMemoryCurrent = {
    schema: "axiom.agent_session_memory_current.v0"
    version: 1
    active_session_id: string
    updated_at: string
}

export type SessionMemoryAppendResult = {
    schema: "axiom.agent_session_memory_append.v0"
    status: "ok"
    session_id: string
    event_id: string
    sequence: number
    index_path: string
    chunk_path: string
    anchor_count: number
    evidence_chars: number
    compressed_bytes: number
}

export type SessionMemoryListResult = {
    schema: "axiom.agent_session_memory_list.v0"
    status: "ok"
    sessions: SessionMemoryListItem[]
}

export type SessionMemoryListItem = {
    session_id: string
    created_at: string
    updated_at: string
    event_count: number
    recent_messages: SessionMemoryRecentMessage[]
    index_path: string
}

export type SessionMemoryRecallResult = {
    schema: "axiom.agent_session_memory_recall.v0"
    status: "ok"
    session_id?: string
    query?: string
    event_id?: string
    profile: MemoryRecallProfile
    hydration: MemoryRecallHydration
    results: SessionMemoryRecallItem[]
    recent_messages: SessionMemoryRecentMessage[]
    metrics: MemoryRecallMetrics
}

export type SessionMemoryRecallItem = SessionMemoryIndexEntry & {
    score: number
    truncated: boolean
    full_evidence?: MemoryEvidence[]
}

export type MemoryWorkingWindowPendingEvent = {
    kind: SessionMemoryEventKind
    title?: string
    summary?: string
    text?: string
    command?: string
    status?: string
    files?: string[]
    tags?: string[]
    role?: SessionMemoryRecentMessage["role"]
}

export type MemoryWorkingWindowBreadcrumb = {
    source: "session" | "memory"
    id: string
    summary: string
    recall_hint: string
}

export type MemoryWorkingWindowToolSpec = {
    name: "axmem_recall"
    description: string
    input_schema: {
        source: ("session" | "memory" | "both")[]
        query: string
        task_id?: string
        event_id?: string
        profile: MemoryRecallProfile[]
    }
}

export type MemoryWorkingWindowResult = {
    schema: "axiom.agent_memory_working_window.v0"
    status: "ok"
    session_id?: string
    token_budget: number
    estimated_tokens: number
    truncated: boolean
    system_prompt?: string
    pinned_task_id?: string
    pinned_card?: MemoryRecallItem
    recent_events: SessionMemoryRecallItem[]
    active_cards: MemoryRecallItem[]
    breadcrumbs: MemoryWorkingWindowBreadcrumb[]
    tools: MemoryWorkingWindowToolSpec[]
    prefetch?: MemoryPrefetchResult
}

export type MemoryWorkingWindowFlushResult = {
    schema: "axiom.agent_memory_working_window_flush.v0"
    status: "ok" | "blocked"
    appended_events: SessionMemoryAppendResult[]
    eviction: MemoryTierEvictionResult
    window: MemoryWorkingWindowResult
}

export type MemoryWorkingWindowRecallToolResult = {
    schema: "axiom.agent_memory_recall_tool.v0"
    status: "ok"
    source: "session" | "memory" | "both"
    session?: SessionMemoryRecallResult
    memory?: MemoryRecallResult
    estimated_tokens: number
}

export type MemoryPackMetrics = {
    raw_evidence_chars: number
    pack_json_chars: number
    compressed_pack_bytes: number
    estimated_raw_tokens: number
    estimated_pack_json_tokens: number
    json_to_compressed_ratio: number
}

export type MemoryRecallMetrics = {
    raw_evidence_chars: number
    compressed_pack_bytes: number
    recall_chars: number
    estimated_raw_tokens: number
    estimated_recall_tokens: number
    estimated_context_tokens_saved: number
    estimated_context_savings_ratio: number
    json_to_compressed_ratio: number
}

export function packMemoryPack(pack: AgentMemoryPack): Buffer {
    validateMemoryPack(pack)
    const json = Buffer.from(JSON.stringify(pack), "utf8")
    assertWritableMemoryPackBudget(pack, json.length)
    const payload = zlib.deflateSync(json, { level: zlib.constants.Z_BEST_COMPRESSION })
    const out = Buffer.alloc(HEADER_LEN + payload.length)
    MAGIC.copy(out, 0)
    out.writeUInt16LE(VERSION, 8)
    out.writeUInt16LE(CODEC_ZLIB, 10)
    out.writeUInt32LE(0, 12)
    out.writeBigUInt64LE(BigInt(json.length), 16)
    out.writeBigUInt64LE(BigInt(payload.length), 24)
    payload.copy(out, HEADER_LEN)
    return out
}

function assertWritableMemoryPackBudget(pack: AgentMemoryPack, jsonChars: number): void {
    if (pack.evidence.length > MEMORY_EVIDENCE_LIMIT) {
        throw new Error(`axmem: evidence count ${pack.evidence.length} exceeds budget ${MEMORY_EVIDENCE_LIMIT}`)
    }

    if (jsonChars > MEMORY_PACK_JSON_CHAR_LIMIT) {
        throw new Error(`axmem: pack JSON size ${jsonChars} exceeds budget ${MEMORY_PACK_JSON_CHAR_LIMIT}`)
    }
}

export function unpackMemoryPack(bytes: Buffer | Uint8Array): AgentMemoryPack {
    const pack = decodeMemoryPack(bytes)
    validateMemoryPack(pack)
    return pack
}

function decodeMemoryPack(bytes: Buffer | Uint8Array): AgentMemoryPack {
    const data = Buffer.from(bytes)

    if (data.length < HEADER_LEN) {
        throw new Error("axmem: file is too small to contain a header")
    }

    if (!data.subarray(0, MAGIC.length).equals(MAGIC)) {
        throw new Error("axmem: bad magic")
    }

    const version = data.readUInt16LE(8)
    if (version !== VERSION) {
        throw new Error(`axmem: unsupported version ${version}, expected ${VERSION}`)
    }

    const codec = data.readUInt16LE(10)
    if (codec !== CODEC_ZLIB) {
        throw new Error(`axmem: unsupported codec id ${codec}`)
    }

    const flags = data.readUInt32LE(12)
    if (flags !== 0) {
        throw new Error(`axmem: unsupported flags 0x${flags.toString(16).padStart(8, "0")}`)
    }

    const jsonLen = Number(data.readBigUInt64LE(16))
    const payloadLen = Number(data.readBigUInt64LE(24))
    const expectedLen = HEADER_LEN + payloadLen
    if (data.length !== expectedLen) {
        throw new Error(`axmem: payload length mismatch, header says ${payloadLen} bytes but file has ${Math.max(0, data.length - HEADER_LEN)}`)
    }

    const json = zlib.inflateSync(data.subarray(HEADER_LEN))
    if (json.length !== jsonLen) {
        throw new Error(`axmem: decoded JSON length mismatch, header says ${jsonLen} bytes but decoded ${json.length}`)
    }

    const pack = JSON.parse(json.toString("utf8")) as AgentMemoryPack
    return pack
}

export function captureMemoryPack(input: {
    cwd: string
    taskId: string
    title: string
    tags?: string[]
    invalidatedHypotheses?: MemoryInvalidatedHypothesis[]
    resumeCommand?: string
}): MemoryCaptureResult {
    const now = new Date().toISOString()
    const context = readContext(input.cwd)
    const history = readContextHistory(input.cwd)
    const sessionLog = readSessionLog(input.cwd)
    const taskId = normalizeTaskId(input.taskId)
    const packPath = path.join(axiomDir, memoryDir, `${taskId}.axmem`)
    const previous = readExistingPack(input.cwd, packPath)
    const evidence = mergeEvidence(previous?.evidence, collectEvidence(input.cwd, taskId, context, history.entries, sessionLog))
    const recentMessages = collectRecentMemoryMessages(taskId, context, sessionLog, evidence)
    const commands = uniqueBy([
        ...(previous?.commands ?? []),
        ...collectCommands(context, sessionLog, taskId)
    ], (command) => `${command.source}:${command.command}`).slice(-200)
    const decisions = uniqueBy([
        ...(previous?.decisions ?? []),
        ...collectDecisions(context)
    ], (decision) => `${decision.kind}:${decision.node ?? ""}:${decision.summary}`).slice(-200)
    const semanticRefs = uniqueBy([
        ...(previous?.semantic_refs ?? []),
        ...collectSemanticRefs(context, evidence)
    ], (ref) => `${ref.kind}:${ref.name}`)
    const agentTags = collectAgentTags({
        previous,
        inputTags: input.tags ?? [],
        context,
        semanticRefs,
        recentMessages
    })
    const canonicalTags = collectCanonicalTags(agentTags)
    const tags = uniqueStrings([
        ...canonicalTags,
        ...agentTags
    ])
    const invalidatedHypotheses = collectInvalidatedHypotheses({
        previous,
        explicit: input.invalidatedHypotheses ?? [],
        messages: recentMessages
    })
    const resumeCommand = input.resumeCommand ?? previous?.summary.resume_command ?? defaultResumeCommand(taskId)
    const pack: AgentMemoryPack = {
        schema: "axiom.agent_memory_pack.v0",
        version: 1,
        task: {
            id: taskId,
            title: input.title,
            tags,
            canonical_tags: canonicalTags,
            agent_tags: agentTags,
            created_at: previous?.task.created_at ?? now,
            updated_at: now
        },
        summary: {
            goal: context?.current_goal ?? previous?.summary.goal,
            last_completed_step: context?.last_completed_step ?? previous?.summary.last_completed_step,
            next_recommended_step: context?.next_recommended_step ?? previous?.summary.next_recommended_step,
            resume_prompt: context?.resume_prompt ?? previous?.summary.resume_prompt,
            recent_message: recentMessages[recentMessages.length - 1] ?? previous?.summary.recent_message,
            resume_command: resumeCommand
        },
        semantic_refs: semanticRefs,
        decisions,
        commands,
        next_actions: uniqueStrings([
            ...(previous?.next_actions ?? []),
            context?.next_recommended_step
        ]).slice(-50),
        invalidated_hypotheses: invalidatedHypotheses,
        evidence
    }
    const graph = buildMemoryGraph(pack)
    pack.strata = graph.strata
    pack.nodes = graph.nodes
    pack.anchors = graph.anchors

    const packed = writeMemoryPackFile(input.cwd, packPath, pack)

    const entry = memoryIndexEntry(pack, packPath)
    const index = upsertIndexEntry(readMemoryIndex(input.cwd), entry)
    writeMemoryIndex(input.cwd, index)
    upsertMemorySearchStoreEntry(input.cwd, index, entry)
    refreshAttachedGlobalProjectForWorkspace(input.cwd)

    return {
        schema: "axiom.agent_memory_capture.v0",
        status: "ok",
        task_id: taskId,
        title: input.title,
        pack_path: normalizePath(packPath),
        index_path: normalizePath(path.join(axiomDir, memoryDir, indexFileName)),
        evidence_count: evidence.length,
        command_count: commands.length,
        metrics: memoryPackMetrics(pack, packed.length)
    }
}

export function ingestMemoryPack(input: {
    cwd: string
    document: MemoryIngestDocument
    taskId?: string
    title?: string
    tags?: string[]
}): MemoryIngestResult {
    const now = new Date().toISOString()
    const document = input.document ?? {}
    const taskId = normalizeTaskId(input.taskId ?? document.task?.id ?? document.task_id ?? "")
    const packPath = path.join(axiomDir, memoryDir, `${taskId}.axmem`)
    const previous = readExistingPack(input.cwd, packPath)
    const title = input.title ?? document.task?.title ?? document.title ?? previous?.task.title ?? taskId
    const summary = normalizeIngestSummary(document.summary)
    const semanticRefs = uniqueBy([
        ...(previous?.semantic_refs ?? []),
        ...(document.semantic_refs ?? []).filter((ref) => ref.kind && ref.name)
    ], (ref) => `${ref.kind}:${ref.name}`)
    const decisions = uniqueBy([
        ...(previous?.decisions ?? []),
        ...normalizeIngestDecisions(document.decisions ?? [])
    ], (decision) => `${decision.kind}:${decision.node ?? ""}:${decision.summary}`).slice(-300)
    const commands = uniqueBy([
        ...(previous?.commands ?? []),
        ...normalizeIngestCommands(document.commands ?? [])
    ], (command) => `${command.source}:${command.command}`).slice(-300)
    const nextActions = uniqueStrings([
        ...(previous?.next_actions ?? []),
        ...(document.next_actions ?? [])
    ]).slice(-120)
    let invalidatedHypotheses = uniqueBy([
        ...packInvalidatedHypotheses(previous),
        ...normalizeIngestInvalidatedHypotheses(document.invalidated_hypotheses ?? [])
    ], invalidatedHypothesisKey).slice(-160)
    const evidence = mergeEvidence(previous?.evidence, normalizeIngestEvidence(taskId, document))
    const agentTags = uniqueStrings([
        ...packAgentTags(previous),
        ...(input.tags ?? []).map(normalizeTag),
        ...(document.task?.agent_tags ?? []).map(normalizeTag),
        ...(document.task?.tags ?? []).map(normalizeTag),
        ...(document.tags ?? []).map(normalizeTag),
        ...semanticRefs.flatMap((ref) => [normalizeTag(ref.kind), normalizeTag(ref.name)]),
        ...(document.nodes ?? []).flatMap((node) => (node.tags ?? []).map(normalizeTag))
    ]).slice(-240)
    const canonicalTags = uniqueStrings([
        ...packCanonicalTags(previous),
        ...(document.task?.canonical_tags ?? []).map(normalizeTag),
        ...collectCanonicalTags(agentTags)
    ]).slice(-100)
    const tags = uniqueStrings([
        ...canonicalTags,
        ...agentTags
    ])
    const pack: AgentMemoryPack = {
        schema: "axiom.agent_memory_pack.v0",
        version: 1,
        task: {
            id: taskId,
            title,
            tags,
            canonical_tags: canonicalTags,
            agent_tags: agentTags,
            created_at: previous?.task.created_at ?? now,
            updated_at: now
        },
        summary: {
            goal: summary.goal ?? previous?.summary.goal,
            last_completed_step: summary.last_completed_step ?? previous?.summary.last_completed_step,
            next_recommended_step: summary.next_recommended_step ?? previous?.summary.next_recommended_step,
            resume_prompt: summary.resume_prompt ?? previous?.summary.resume_prompt,
            recent_message: summary.recent_message ?? previous?.summary.recent_message,
            resume_command: summary.resume_command ?? previous?.summary.resume_command ?? defaultResumeCommand(taskId)
        },
        semantic_refs: semanticRefs,
        decisions,
        commands,
        next_actions: nextActions,
        invalidated_hypotheses: invalidatedHypotheses,
        evidence
    }
    const explicitGraph = normalizeIngestGraph(taskId, selectMemoryGraphPart(pack), document)
    invalidatedHypotheses = uniqueBy([
        ...invalidatedHypotheses,
        ...invalidatedHypothesesFromGraph({
            nodes: [...packGraphNodes(previous), ...explicitGraph.nodes],
            anchors: [...packMemoryAnchors(previous), ...explicitGraph.anchors]
        })
    ], invalidatedHypothesisKey).slice(-160)
    pack.invalidated_hypotheses = invalidatedHypotheses

    const autoGraph = buildMemoryGraph(pack)
    pack.strata = mergeMemoryStrata(autoGraph.strata, packMemoryStrata(previous), explicitGraph.strata)
    pack.nodes = mergeGraphNodes(autoGraph.nodes, packGraphNodes(previous), explicitGraph.nodes)
    pack.anchors = mergeMemoryAnchors(autoGraph.anchors, packMemoryAnchors(previous), explicitGraph.anchors)

    const packed = writeMemoryPackFile(input.cwd, packPath, pack)

    const entry = memoryIndexEntry(pack, packPath)
    const index = upsertIndexEntry(readMemoryIndex(input.cwd), entry)
    writeMemoryIndex(input.cwd, index)
    upsertMemorySearchStoreEntry(input.cwd, index, entry)
    refreshAttachedGlobalProjectForWorkspace(input.cwd)

    return {
        schema: "axiom.agent_memory_ingest_result.v0",
        status: "ok",
        task_id: taskId,
        title,
        pack_path: normalizePath(packPath),
        index_path: normalizePath(path.join(axiomDir, memoryDir, indexFileName)),
        evidence_count: evidence.length,
        command_count: commands.length,
        graph_node_count: packGraphNodes(pack).length,
        anchor_count: packMemoryAnchors(pack).length,
        metrics: memoryPackMetrics(pack, packed.length)
    }
}

export function autoCaptureMemoryPack(input: {
    cwd: string
    taskId?: string
    title?: string
    tags?: string[]
}): AutoMemoryCaptureResult {
    const context = readContext(input.cwd)

    if (!context) {
        return {
            schema: "axiom.agent_memory_auto_capture.v0",
            status: "skipped",
            reason: "no_context"
        }
    }

    return captureMemoryPack({
        cwd: input.cwd,
        taskId: input.taskId ?? context.module,
        title: input.title ?? context.current_goal,
        tags: uniqueStrings(["auto", ...(input.tags ?? [])])
    })
}

export function appendSessionMemory(input: {
    cwd: string
    sessionId?: string
    kind: SessionMemoryEventKind
    title?: string
    summary?: string
    text?: string
    command?: string
    status?: string
    files?: string[]
    tags?: string[]
    role?: SessionMemoryRecentMessage["role"]
}): SessionMemoryAppendResult {
    const now = new Date().toISOString()
    const sessionId = resolveActiveSessionId(input.cwd, input.sessionId, now)
    const index = readSessionMemoryIndex(input.cwd, sessionId)
    const sequence = index.last_sequence + 1
    const sanitizedSummary = sanitizeSessionCaptureText(input.summary)
    const sanitizedText = sanitizeSessionCaptureText(input.text)
    const summary = compactSessionSummary(sanitizedSummary || sanitizedText || input.command || input.title || input.kind)
    const title = input.title ?? sessionEventTitle(input.kind, summary)
    const text = sanitizedText || summary
    const files = uniqueStrings([
        ...(input.files ?? []),
        ...extractSessionFileRefs(`${input.command ?? ""}\n${text}`)
    ]).map(normalizePath)
    const eventId = `e${String(sequence).padStart(6, "0")}-${shortHash(`${sessionId}\n${input.kind}\n${title}\n${text}\n${now}`)}`
    const chunkPath = normalizePath(path.join(axiomDir, memoryDir, sessionMemoryDir, sessionId, "chunks", `${String(sequence).padStart(6, "0")}-${eventId}.axmem`))
    const tags = uniqueStrings([
        "session",
        normalizeTag(String(input.kind)),
        ...(input.tags ?? []).map(normalizeTag)
    ])
    const evidence: MemoryEvidence = {
        id: `session_event:${eventId}`,
        kind: "session_event",
        path: chunkPath,
        summary,
        data: {
            schema: "axiom.agent_session_memory_event.v0",
            session_id: sessionId,
            event_id: eventId,
            sequence,
            kind: input.kind,
            title,
            summary,
            text,
            command: input.command,
            status: input.status,
            files,
            tags,
            created_at: now
        }
    }
    const previous = index.entries[index.entries.length - 1]
    const sessionAnchors = sessionAutoAnchors({
        eventId,
        previousEventId: previous?.event_id,
        files,
        command: input.command,
        kind: input.kind,
        status: input.status
    })
    const graph = sessionMemoryGraph({
        sessionId,
        eventId,
        kind: input.kind,
        title,
        summary,
        files,
        evidenceId: evidence.id,
        anchors: sessionAnchors,
        previous
    })
    const pack: AgentMemoryPack = {
        schema: "axiom.agent_memory_pack.v0",
        version: 1,
        task: {
            id: normalizeTaskId(`session-${sessionId}-${String(sequence).padStart(6, "0")}`),
            title: `Session ${sessionId} #${sequence}: ${title}`,
            tags,
            canonical_tags: collectCanonicalTags(tags),
            agent_tags: tags,
            created_at: now,
            updated_at: now
        },
        summary: {
            goal: `Session memory event ${input.kind}`,
            last_completed_step: summary,
            recent_message: isRecentMessageKind(input.kind) ? summary : undefined,
            resume_command: `node dist/cli.js memory session recall --session ${sessionId} --event ${eventId} --profile focused`
        },
        semantic_refs: files.map((file) => ({ kind: "file", name: file })),
        decisions: sessionMemoryDecisions(input.kind, summary),
        commands: input.command ? [{
            command: input.command,
            status: input.status,
            summary,
            source: "agent_ingest"
        }] : [],
        next_actions: input.kind === "next_action" ? [summary] : [],
        invalidated_hypotheses: [],
        evidence: [evidence],
        strata: graph.strata,
        nodes: graph.nodes,
        anchors: graph.anchors
    }
    const packed = packMemoryPack(pack)
    const absoluteChunkPath = path.join(input.cwd, chunkPath)
    fs.mkdirSync(path.dirname(absoluteChunkPath), { recursive: true })
    fs.writeFileSync(absoluteChunkPath, packed)

    const entry: SessionMemoryIndexEntry = {
        sequence,
        event_id: eventId,
        kind: input.kind,
        title,
        summary,
        created_at: now,
        chunk_path: chunkPath,
        tags,
        files,
        command: input.command,
        status: input.status,
        evidence_preview: compactSessionEvidence(text),
        evidence_chars: jsonCharLength(evidence.data),
        compressed_bytes: packed.length,
        score_hints: sessionScoreHints({
            sessionId,
            eventId,
            kind: input.kind,
            title,
            summary,
            text,
            command: input.command,
            status: input.status,
            files,
            tags,
            anchors: sessionAnchors
        }),
        evidence_refs: memoryEvidenceRefs([evidence]),
        anchors: sessionAnchors
    }
    let updated = upsertSessionEntry(index, entry, input.role)
    updated = appendSessionProfileFacts({
        cwd: input.cwd,
        sessionId,
        index: updated,
        source: entry,
        facts: extractSessionProfileFacts({
            text,
            kind: input.kind,
            role: input.role,
            recordedAt: now,
            sourceEventId: eventId
        })
    })
    writeSessionMemoryIndex(input.cwd, updated)
    writeCurrentSession(input.cwd, sessionId)

    return {
        schema: "axiom.agent_session_memory_append.v0",
        status: "ok",
        session_id: sessionId,
        event_id: eventId,
        sequence,
        index_path: normalizePath(path.join(axiomDir, memoryDir, sessionMemoryDir, sessionId, sessionIndexFileName)),
        chunk_path: chunkPath,
        anchor_count: sessionAnchors.length,
        evidence_chars: entry.evidence_chars,
        compressed_bytes: packed.length
    }
}

export function listSessionMemory(input: { cwd: string }): SessionMemoryListResult {
    const root = path.join(input.cwd, axiomDir, memoryDir, sessionMemoryDir)
    const sessions: SessionMemoryListItem[] = []

    if (fs.existsSync(root)) {
        for (const fileName of fs.readdirSync(root).sort()) {
            const indexPath = path.join(root, fileName, sessionIndexFileName)
            if (!fs.existsSync(indexPath)) continue
            const index = readSessionMemoryIndexFile(indexPath)
            sessions.push({
                session_id: index.session_id,
                created_at: index.created_at,
                updated_at: index.updated_at,
                event_count: index.entries.length,
                recent_messages: index.recent_messages.slice(-6),
                index_path: normalizePath(path.relative(input.cwd, indexPath))
            })
        }
    }

    return {
        schema: "axiom.agent_session_memory_list.v0",
        status: "ok",
        sessions: sessions.sort((left, right) => right.updated_at.localeCompare(left.updated_at) || left.session_id.localeCompare(right.session_id))
    }
}

export function recallSessionMemory(input: {
    cwd: string
    sessionId?: string
    query?: string
    eventId?: string
    limit?: number
    includeEvidence?: boolean
    profile?: MemoryRecallProfile
}): SessionMemoryRecallResult {
    const sessionId = resolveExistingSessionId(input.cwd, input.sessionId)
    if (!sessionId) {
        return {
            schema: "axiom.agent_session_memory_recall.v0",
            status: "ok",
            session_id: input.sessionId,
            query: input.query,
            event_id: input.eventId,
            profile: recallProfile(input),
            hydration: recallHydration({ includeEvidence: input.includeEvidence }, recallProfile(input)),
            results: [],
            recent_messages: [],
            metrics: aggregateSessionRecallMetrics([])
        }
    }

    const index = readSessionMemoryIndex(input.cwd, sessionId)
    const profile = recallProfile(input)
    const limits = sessionRecallLimits(profile)
    const limit = input.limit ?? limits.event_limit
    const hydration = recallHydration({ includeEvidence: input.includeEvidence }, profile)
    const scored = index.entries
        .map((entry) => ({ entry, score: scoreSessionEntry(entry, { query: input.query, eventId: input.eventId }) }))
        .filter((item) => item.score > 0)
        .sort((left, right) => right.score - left.score || right.entry.sequence - left.entry.sequence)
        .slice(0, limit)
    const results = scored.map(({ entry, score }) => sessionRecallItem(input.cwd, entry, score, hydration, profile))

    return {
        schema: "axiom.agent_session_memory_recall.v0",
        status: "ok",
        session_id: sessionId,
        query: input.query,
        event_id: input.eventId,
        profile,
        hydration,
        results,
        recent_messages: index.recent_messages.slice(-limits.recent_message_limit),
        metrics: aggregateSessionRecallMetrics(results)
    }
}

export function buildMemoryWorkingWindow(input: {
    cwd: string
    sessionId?: string
    taskId?: string
    query?: string
    systemPrompt?: string
    tokenBudget?: number
    recentEventLimit?: number
    activeCardLimit?: number
    includeTool?: boolean
    prefetch?: boolean
}): MemoryWorkingWindowResult {
    const tokenBudget = input.tokenBudget ?? 50_000
    const sessionId = resolveExistingSessionId(input.cwd, input.sessionId)
    const index = sessionId ? readSessionMemoryIndex(input.cwd, sessionId) : undefined
    const recentEventLimit = input.recentEventLimit ?? 8
    const recentEntries = index?.entries.slice(-recentEventLimit) ?? []
    const hydration = recallHydration({ includeEvidence: true }, "focused")
    let recentEvents = recentEntries.map((entry) => sessionRecallItem(input.cwd, entry, 1000 + entry.sequence, hydration, "focused"))
    let breadcrumbs = (index?.entries.slice(0, Math.max(0, index.entries.length - recentEntries.length)) ?? [])
        .map(sessionEntryBreadcrumb)

    const pinnedCard = input.taskId
        ? recallMemory({
            cwd: input.cwd,
            taskId: input.taskId,
            profile: "ultra",
            limit: 1
        }).results[0]
        : undefined
    let activeRecall: MemoryRecallResult | undefined
    if (input.query) {
        activeRecall = recallMemory({
            cwd: input.cwd,
            query: input.query,
            profile: "ultra",
            limit: input.activeCardLimit ?? 3,
            prefetch: input.prefetch,
            prefetchLimit: 2
        })
    }
    let activeCards = activeRecall?.results ?? []
    let systemPrompt = input.systemPrompt ? compactMemoryText(input.systemPrompt, Math.max(256, tokenBudget * 3)) : undefined
    const tools = input.includeTool === false ? [] : [axmemRecallToolSpec()]
    let truncated = false

    let window = makeMemoryWorkingWindow({
        sessionId,
        tokenBudget,
        systemPrompt,
        pinnedTaskId: input.taskId,
        pinnedCard,
        recentEvents,
        activeCards,
        breadcrumbs,
        tools,
        prefetch: activeRecall?.prefetch
    })

    while (window.estimated_tokens > tokenBudget && activeCards.length > 1) {
        truncated = true
        const removed = activeCards.pop()
        if (removed) breadcrumbs.unshift(memoryCardBreadcrumb(removed))
        window = makeMemoryWorkingWindow({
            sessionId,
            tokenBudget,
            systemPrompt,
            pinnedTaskId: input.taskId,
            pinnedCard,
            recentEvents,
            activeCards,
            breadcrumbs,
            tools,
            prefetch: activeRecall?.prefetch,
            truncated
        })
    }

    while (window.estimated_tokens > tokenBudget && recentEvents.length > 1) {
        truncated = true
        const removed = recentEvents.shift()
        if (removed) breadcrumbs.unshift(sessionRecallBreadcrumb(removed))
        window = makeMemoryWorkingWindow({
            sessionId,
            tokenBudget,
            systemPrompt,
            pinnedTaskId: input.taskId,
            pinnedCard,
            recentEvents,
            activeCards,
            breadcrumbs,
            tools,
            prefetch: activeRecall?.prefetch,
            truncated
        })
    }

    while (window.estimated_tokens > tokenBudget && recentEvents.length > 0 && !pinnedCard) {
        truncated = true
        const removed = recentEvents.shift()
        if (removed) breadcrumbs.unshift(sessionRecallBreadcrumb(removed))
        window = makeMemoryWorkingWindow({
            sessionId,
            tokenBudget,
            systemPrompt,
            pinnedTaskId: input.taskId,
            pinnedCard,
            recentEvents,
            activeCards,
            breadcrumbs,
            tools,
            prefetch: activeRecall?.prefetch,
            truncated
        })
    }

    if (window.estimated_tokens > tokenBudget && breadcrumbs.length > 17) {
        truncated = true
        breadcrumbs = compactWorkingWindowBreadcrumbs(breadcrumbs, 16)
        window = makeMemoryWorkingWindow({
            sessionId,
            tokenBudget,
            systemPrompt,
            pinnedTaskId: input.taskId,
            pinnedCard,
            recentEvents,
            activeCards,
            breadcrumbs,
            tools,
            prefetch: activeRecall?.prefetch,
            truncated
        })
    }

    while (window.estimated_tokens > tokenBudget && activeCards.length > 0) {
        truncated = true
        const removed = activeCards.pop()
        if (removed) breadcrumbs.unshift(memoryCardBreadcrumb(removed))
        window = makeMemoryWorkingWindow({
            sessionId,
            tokenBudget,
            systemPrompt,
            pinnedTaskId: input.taskId,
            pinnedCard,
            recentEvents,
            activeCards,
            breadcrumbs,
            tools,
            prefetch: activeRecall?.prefetch,
            truncated
        })
    }

    if (window.estimated_tokens > tokenBudget && systemPrompt) {
        truncated = true
        const reserveChars = Math.max(256, tokenBudget * 2)
        systemPrompt = compactMemoryText(systemPrompt, reserveChars)
        window = makeMemoryWorkingWindow({
            sessionId,
            tokenBudget,
            systemPrompt,
            pinnedTaskId: input.taskId,
            pinnedCard,
            recentEvents,
            activeCards,
            breadcrumbs,
            tools,
            prefetch: activeRecall?.prefetch,
            truncated
        })
    }

    return window
}

export function flushMemoryWorkingWindow(input: {
    cwd: string
    sessionId?: string
    pendingEvents?: MemoryWorkingWindowPendingEvent[]
    taskId?: string
    query?: string
    systemPrompt?: string
    tokenBudget?: number
    recentEventLimit?: number
    activeCardLimit?: number
    maxPackCacheBytes?: number
    prefetch?: boolean
}): MemoryWorkingWindowFlushResult {
    const appendedEvents: SessionMemoryAppendResult[] = []
    if (!memoryMutationActive("drop_write_before_flush")) {
        for (const event of input.pendingEvents ?? []) {
            appendedEvents.push(appendSessionMemory({
                cwd: input.cwd,
                sessionId: input.sessionId,
                kind: event.kind,
                title: event.title,
                summary: event.summary,
                text: event.text,
                command: event.command,
                status: event.status,
                files: event.files,
                tags: event.tags,
                role: event.role
            }))
        }
    }
    const eviction = evictMemoryTiers({
        cwd: input.cwd,
        maxCompressedBytes: input.maxPackCacheBytes ?? 0
    })
    const window = buildMemoryWorkingWindow({
        cwd: input.cwd,
        sessionId: appendedEvents[0]?.session_id ?? input.sessionId,
        taskId: input.taskId,
        query: input.query,
        systemPrompt: input.systemPrompt,
        tokenBudget: input.tokenBudget,
        recentEventLimit: input.recentEventLimit,
        activeCardLimit: input.activeCardLimit,
        prefetch: input.prefetch
    })
    return {
        schema: "axiom.agent_memory_working_window_flush.v0",
        status: eviction.status,
        appended_events: appendedEvents,
        eviction,
        window
    }
}

export function runAxmemRecallTool(input: {
    cwd: string
    source?: "session" | "memory" | "both"
    sessionId?: string
    query?: string
    taskId?: string
    eventId?: string
    profile?: MemoryRecallProfile
    limit?: number
    includeEvidence?: boolean
}): MemoryWorkingWindowRecallToolResult {
    const source = input.source ?? "both"
    const profile = input.profile ?? "focused"
    const session = source === "session" || source === "both"
        ? recallSessionMemory({
            cwd: input.cwd,
            sessionId: input.sessionId,
            query: input.query,
            eventId: input.eventId,
            profile,
            limit: input.limit,
            includeEvidence: input.includeEvidence ?? profile === "full"
        })
        : undefined
    const memory = source === "memory" || source === "both"
        ? recallMemory({
            cwd: input.cwd,
            taskId: input.taskId,
            query: input.query,
            profile,
            limit: input.limit,
            includeEvidence: input.includeEvidence ?? profile === "full"
        })
        : undefined
    return {
        schema: "axiom.agent_memory_recall_tool.v0",
        status: "ok",
        source,
        session,
        memory,
        estimated_tokens: estimateTokens(jsonCharLength({ session, memory }))
    }
}

function makeMemoryWorkingWindow(input: {
    sessionId?: string
    tokenBudget: number
    systemPrompt?: string
    pinnedTaskId?: string
    pinnedCard?: MemoryRecallItem
    recentEvents: SessionMemoryRecallItem[]
    activeCards: MemoryRecallItem[]
    breadcrumbs: MemoryWorkingWindowBreadcrumb[]
    tools: MemoryWorkingWindowToolSpec[]
    prefetch?: MemoryPrefetchResult
    truncated?: boolean
}): MemoryWorkingWindowResult {
    const estimatedTokens = estimateTokens(jsonCharLength({
        system_prompt: input.systemPrompt,
        pinned_task_id: input.pinnedTaskId,
        pinned_card: input.pinnedCard,
        recent_events: input.recentEvents,
        active_cards: input.activeCards,
        breadcrumbs: input.breadcrumbs,
        tools: input.tools
    }))
    return {
        schema: "axiom.agent_memory_working_window.v0",
        status: "ok",
        session_id: input.sessionId,
        token_budget: input.tokenBudget,
        estimated_tokens: estimatedTokens,
        truncated: input.truncated === true || estimatedTokens > input.tokenBudget,
        system_prompt: input.systemPrompt,
        pinned_task_id: input.pinnedTaskId,
        pinned_card: input.pinnedCard,
        recent_events: input.recentEvents,
        active_cards: input.activeCards,
        breadcrumbs: input.breadcrumbs,
        tools: input.tools,
        prefetch: input.prefetch
    }
}

function axmemRecallToolSpec(): MemoryWorkingWindowToolSpec {
    return {
        name: "axmem_recall",
        description: "Recall exact session events or AXMEM task cards when a breadcrumb or active query points outside the working window.",
        input_schema: {
            source: ["session", "memory", "both"],
            query: "text query for the missing state",
            task_id: "optional AXMEM task id",
            event_id: "optional session event id",
            profile: ["ultra", "focused", "full"]
        }
    }
}

function sessionEntryBreadcrumb(entry: SessionMemoryIndexEntry): MemoryWorkingWindowBreadcrumb {
    return {
        source: "session",
        id: entry.event_id,
        summary: compactSessionSummary(`#${entry.sequence} ${entry.kind}: ${entry.summary}`, 180),
        recall_hint: `axmem_recall source=session event_id=${entry.event_id}`
    }
}

function sessionRecallBreadcrumb(entry: SessionMemoryRecallItem): MemoryWorkingWindowBreadcrumb {
    return {
        source: "session",
        id: entry.event_id,
        summary: compactSessionSummary(`#${entry.sequence} ${entry.kind}: ${entry.summary}`, 180),
        recall_hint: `axmem_recall source=session event_id=${entry.event_id}`
    }
}

function memoryCardBreadcrumb(item: MemoryRecallItem): MemoryWorkingWindowBreadcrumb {
    return {
        source: "memory",
        id: item.task_id,
        summary: compactMemoryText(`${item.title}: ${Object.values(item.summary).filter(Boolean).join(" ")}`, 180),
        recall_hint: `axmem_recall source=memory task_id=${item.task_id}`
    }
}

function compactWorkingWindowBreadcrumbs(breadcrumbs: MemoryWorkingWindowBreadcrumb[], keepTail: number): MemoryWorkingWindowBreadcrumb[] {
    if (breadcrumbs.length <= keepTail + 1) return breadcrumbs
    const omittedCount = breadcrumbs.length - keepTail
    return [
        {
            source: "session",
            id: `session-history:${omittedCount}`,
            summary: `${omittedCount} older flushed session breadcrumbs are available through AXMEM session recall.`,
            recall_hint: "axmem_recall source=session query=<missing older state>"
        },
        ...breadcrumbs.slice(-keepTail)
    ]
}

export function readSessionMemoryIndex(cwd: string, sessionId?: string): SessionMemoryIndex {
    const resolvedSessionId = sessionId ? normalizeSessionId(sessionId) : resolveExistingSessionId(cwd)
    if (!resolvedSessionId) {
        return emptySessionMemoryIndex(cwd, makeSessionId(new Date()))
    }
    const filePath = path.join(cwd, axiomDir, memoryDir, sessionMemoryDir, resolvedSessionId, sessionIndexFileName)
    if (!fs.existsSync(filePath)) {
        return emptySessionMemoryIndex(cwd, resolvedSessionId)
    }
    return readSessionMemoryIndexFile(filePath)
}

export function reindexMemory(input: {
    cwd: string
    reason?: "manual" | "auto_upgrade"
}): MemoryReindexResult {
    const rebuilt = rebuildMemoryIndexFromPackDirectory(input.cwd, path.join(axiomDir, memoryDir))
    writeMemoryIndex(input.cwd, rebuilt.index)
    buildMemorySearchStore({
        cwd: input.cwd,
        index: rebuilt.index,
        reason: "reindex"
    })
    refreshAttachedGlobalProjectForWorkspace(input.cwd)
    return memoryReindexResult(input.reason ?? "manual", rebuilt.index)
}

export function deleteMemory(input: {
    cwd: string
    taskIds: string[]
    dryRun?: boolean
}): MemoryDeleteResult {
    const requestedTaskIds = uniqueStrings(input.taskIds.map((taskId) => normalizeTaskId(taskId)))
    if (requestedTaskIds.length === 0) {
        throw new Error("memory delete requires at least one --task <id>")
    }

    const index = readMemoryIndex(input.cwd)
    const entriesByTaskId = new Map(index.entries.map((entry) => [normalizeTaskId(entry.task_id), entry]))
    const targets: { task_id: string; pack_path: string; absolute_path: string }[] = []
    const missingTaskIds: string[] = []

    for (const taskId of requestedTaskIds) {
        const entry = entriesByTaskId.get(taskId)
        const packPath = entry?.pack_path ?? normalizePath(path.join(axiomDir, memoryDir, `${taskId}.axmem`))
        const absolutePath = resolveDeletableMemoryPackPath(input.cwd, packPath)
        if (fs.existsSync(absolutePath)) {
            targets.push({
                task_id: entry?.task_id ?? taskId,
                pack_path: normalizePath(path.relative(input.cwd, absolutePath)),
                absolute_path: absolutePath
            })
        } else {
            missingTaskIds.push(taskId)
        }
    }

    if (input.dryRun) {
        return {
            schema: "axiom.agent_memory_delete.v0",
            status: "dry_run",
            dry_run: true,
            requested_task_ids: requestedTaskIds,
            matched_task_ids: targets.map((target) => target.task_id),
            missing_task_ids: missingTaskIds,
            target_pack_paths: targets.map((target) => target.pack_path),
            deleted_task_ids: [],
            deleted_pack_paths: [],
            index_path: normalizePath(path.join(axiomDir, memoryDir, indexFileName)),
            reindexed: false,
            remaining_entry_count: index.entries.length
        }
    }

    for (const target of targets) {
        removeMemoryPackCacheEntry(input.cwd, target.pack_path)
        fs.unlinkSync(target.absolute_path)
    }

    const reindexed = targets.length > 0
        ? reindexMemory({ cwd: input.cwd, reason: "manual" })
        : undefined

    return {
        schema: "axiom.agent_memory_delete.v0",
        status: targets.length > 0 ? "ok" : "not_found",
        dry_run: false,
        requested_task_ids: requestedTaskIds,
        matched_task_ids: targets.map((target) => target.task_id),
        missing_task_ids: missingTaskIds,
        target_pack_paths: targets.map((target) => target.pack_path),
        deleted_task_ids: targets.map((target) => target.task_id),
        deleted_pack_paths: targets.map((target) => target.pack_path),
        index_path: normalizePath(path.join(axiomDir, memoryDir, indexFileName)),
        reindexed: targets.length > 0,
        remaining_entry_count: reindexed?.entry_count ?? index.entries.length
    }
}

export function updateMemoryPack(input: {
    cwd: string
    taskId: string
    title?: string
    summary?: string
    appendDecisions?: string[]
    appendNextActions?: string[]
    semanticRefs?: MemorySemanticRef[]
    tags?: string[]
    invalidatedHypotheses?: MemoryInvalidatedHypothesis[]
    evidence?: (Partial<MemoryEvidence> & { data?: unknown })[]
}): MemoryUpdateResult {
    const taskId = normalizeTaskId(input.taskId)
    const packPath = path.join(axiomDir, memoryDir, `${taskId}.axmem`)
    const previous = readExistingPack(input.cwd, packPath)
    if (!previous) {
        throw new Error(`memory update: task '${taskId}' does not exist`)
    }

    const document: MemoryIngestDocument = {
        task: {
            id: taskId,
            title: input.title ?? previous.task.title,
            tags: input.tags
        },
        summary: input.summary,
        semantic_refs: input.semanticRefs,
        decisions: input.appendDecisions,
        next_actions: input.appendNextActions,
        invalidated_hypotheses: input.invalidatedHypotheses,
        evidence: input.evidence
    }
    const result = ingestMemoryPack({
        cwd: input.cwd,
        document,
        taskId,
        title: input.title ?? previous.task.title,
        tags: input.tags
    })

    return {
        schema: "axiom.agent_memory_update_result.v0",
        status: "ok",
        task_id: result.task_id,
        title: result.title,
        pack_path: result.pack_path,
        index_path: result.index_path,
        appended_decision_count: input.appendDecisions?.length ?? 0,
        appended_next_action_count: input.appendNextActions?.length ?? 0,
        appended_semantic_ref_count: input.semanticRefs?.length ?? 0,
        invalidated_hypothesis_count: input.invalidatedHypotheses?.length ?? 0,
        evidence_count: result.evidence_count,
        command_count: result.command_count,
        graph_node_count: result.graph_node_count,
        anchor_count: result.anchor_count,
        metrics: result.metrics
    }
}

export function guardMemoryHandoff(input: {
    cwd: string
    threshold?: number
    sinceHours?: number
    failOnWarn?: boolean
}): MemoryHandoffGuardResult {
    const threshold = input.threshold ?? MEMORY_HANDOFF_GUARD_CHANGED_LINE_THRESHOLD
    const sinceHours = input.sinceHours ?? MEMORY_HANDOFF_GUARD_RECENT_HOURS
    const gitRoot = gitOutput(input.cwd, ["rev-parse", "--show-toplevel"])
    if (!gitRoot.ok) {
        return {
            schema: "axiom.agent_memory_handoff_guard.v0",
            status: "ok",
            changed_lines: 0,
            added_lines: 0,
            deleted_lines: 0,
            changed_file_count: 0,
            threshold,
            since_hours: sinceHours,
            recent_handoff_task_ids: [],
            message: "No git worktree detected; handoff guard skipped.",
            git_available: false
        }
    }

    const stats = gitChangedLineStats(input.cwd)
    const recentHandoffs = recentMemoryHandoffTaskIds(input.cwd, sinceHours)
    const needsHandoff = stats.changed_lines >= threshold
    const hasHandoff = recentHandoffs.length > 0
    const status: MemoryHandoffGuardResult["status"] = needsHandoff && !hasHandoff
        ? input.failOnWarn ? "fail" : "warn"
        : "ok"
    const message = needsHandoff && !hasHandoff
        ? `Large workspace change (${stats.changed_lines} changed lines) has no handoff card in the last ${sinceHours}h.`
        : hasHandoff
            ? `Handoff guard satisfied by ${recentHandoffs.join(", ")}.`
            : `Handoff guard ok: ${stats.changed_lines} changed lines below threshold ${threshold}.`

    return {
        schema: "axiom.agent_memory_handoff_guard.v0",
        status,
        changed_lines: stats.changed_lines,
        added_lines: stats.added_lines,
        deleted_lines: stats.deleted_lines,
        changed_file_count: stats.changed_file_count,
        threshold,
        since_hours: sinceHours,
        recent_handoff_task_ids: recentHandoffs,
        message,
        git_available: true
    }
}

export function readMemoryIndex(cwd: string): AgentMemoryIndex {
    const filePath = path.join(cwd, axiomDir, memoryDir, indexFileName)

    if (!fs.existsSync(filePath)) {
        return emptyMemoryIndex()
    }

    const index = readMemoryIndexFile(filePath)
    if (!memoryIndexNeedsUpgrade(index)) {
        return index
    }

    const rebuilt = rebuildMemoryIndexFromPackDirectory(cwd, path.join(axiomDir, memoryDir))
    writeMemoryIndex(cwd, rebuilt.index)
    return rebuilt.index
}

function recallHydration(input: { includeEvidence?: boolean; includeGraph?: boolean }, profile: MemoryRecallProfile): MemoryRecallHydration {
    return {
        include_evidence: profile === "full" || input.includeEvidence === true,
        include_graph: profile === "full" || input.includeGraph === true
    }
}

function recallMode(input: { mode?: MemoryRecallMode }): MemoryRecallMode {
    return input.mode ?? "current"
}

function recallProfile(input: { profile?: MemoryRecallProfile }): MemoryRecallProfile {
    return input.profile ?? "ultra"
}

function recallProfileLimits(profile: MemoryRecallProfile): MemoryRecallProfileLimits {
    return MEMORY_RECALL_PROFILE_LIMITS[profile]
}

function maybePrefetchMemoryRecall(
    cwd: string,
    result: MemoryRecallResult,
    input: { prefetch?: boolean; prefetchLimit?: number }
): MemoryRecallResult {
    if (!input.prefetch || result.results.length === 0) return result
    return {
        ...result,
        prefetch: prefetchMemoryPacks({
            cwd,
            seedTaskIds: result.results.map((item) => item.task_id),
            limit: input.prefetchLimit
        })
    }
}

export function prefetchMemoryPacks(input: {
    cwd: string
    seedTaskIds: string[]
    limit?: number
    maxCacheBytes?: number
}): MemoryPrefetchResult {
    const index = readMemoryIndex(input.cwd)
    const normalizedSeedIds = uniqueStrings(input.seedTaskIds.map(normalizeTaskId))
    const seeds = normalizedSeedIds
        .map((taskId) => index.entries.find((entry) => entry.task_id === taskId))
        .filter((entry): entry is AgentMemoryIndexEntry => entry !== undefined)
    const cacheBeforeBytes = memoryPackCacheBytes
    if (seeds.length === 0) {
        return {
            schema: "axiom.agent_memory_prefetch.v0",
            status: "ok",
            seed_task_ids: normalizedSeedIds,
            prefetched_task_ids: [],
            skipped_task_ids: [],
            candidate_count: 0,
            cache_before_bytes: cacheBeforeBytes,
            cache_after_bytes: memoryPackCacheBytes
        }
    }

    const seedIds = new Set(seeds.map((entry) => entry.task_id))
    const candidates = index.entries
        .filter((entry) => !seedIds.has(entry.task_id))
        .map((entry) => ({
            entry,
            score: Math.max(...seeds.map((seed) => memoryPrefetchCandidateScore(seed, entry)))
        }))
        .filter((candidate) => candidate.score > 0)
        .sort((left, right) => right.score - left.score || right.entry.updated_at.localeCompare(left.entry.updated_at) || left.entry.task_id.localeCompare(right.entry.task_id))
    const limit = input.limit ?? 3
    const prefetchedTaskIds: string[] = []
    const skippedTaskIds: string[] = []
    for (const candidate of candidates.slice(0, limit)) {
        try {
            readMemoryPackCached(input.cwd, candidate.entry.pack_path)
            prefetchedTaskIds.push(candidate.entry.task_id)
        } catch {
            skippedTaskIds.push(candidate.entry.task_id)
        }
    }
    if (input.maxCacheBytes !== undefined) {
        evictMemoryTiers({ cwd: input.cwd, maxCompressedBytes: input.maxCacheBytes })
    }
    return {
        schema: "axiom.agent_memory_prefetch.v0",
        status: "ok",
        seed_task_ids: normalizedSeedIds,
        prefetched_task_ids: prefetchedTaskIds,
        skipped_task_ids: skippedTaskIds,
        candidate_count: candidates.length,
        cache_before_bytes: cacheBeforeBytes,
        cache_after_bytes: memoryPackCacheBytes
    }
}

function memoryPrefetchCandidateScore(seed: AgentMemoryIndexEntry, candidate: AgentMemoryIndexEntry): number {
    if (memoryMutationActive("prefetch_recency_only")) {
        return memoryPrefetchRecencyScore(candidate)
    }

    let score = 0
    const seedSemanticRefs = new Set(seed.semantic_refs.map(memorySemanticRefKey))
    const candidateSemanticRefs = new Set(candidate.semantic_refs.map(memorySemanticRefKey))
    for (const ref of candidateSemanticRefs) {
        if (seedSemanticRefs.has(ref)) score += 42
    }

    const seedTags = new Set([
        ...seed.tags,
        ...(seed.canonical_tags ?? []),
        ...(seed.agent_tags ?? [])
    ].map(normalizeTag).filter(Boolean))
    const candidateTags = new Set([
        ...candidate.tags,
        ...(candidate.canonical_tags ?? []),
        ...(candidate.agent_tags ?? [])
    ].map(normalizeTag).filter(Boolean))
    for (const tag of candidateTags) {
        if (seedTags.has(tag)) score += 8
    }

    const seedAnchorText = memoryPrefetchAnchorText(seed)
    const candidateAnchorText = memoryPrefetchAnchorText(candidate)
    if (seedAnchorText.includes(candidate.task_id.toLowerCase()) || seedAnchorText.includes(candidate.title.toLowerCase())) score += 36
    if (candidateAnchorText.includes(seed.task_id.toLowerCase()) || candidateAnchorText.includes(seed.title.toLowerCase())) score += 36

    const semanticHintText = [
        ...seed.semantic_refs.flatMap((ref) => [ref.kind, ref.name]),
        ...candidate.semantic_refs.flatMap((ref) => [ref.kind, ref.name])
    ].join("\n").toLowerCase()
    for (const term of queryTerms(candidate.title)) {
        if (term.length >= 5 && semanticHintText.includes(term)) score += 2
    }

    if (score === 0) return 0

    return score + memoryPrefetchRecencyScore(candidate)
}

function memoryPrefetchRecencyScore(candidate: AgentMemoryIndexEntry): number {
    const ageMs = Date.now() - Date.parse(candidate.updated_at)
    if (!Number.isFinite(ageMs)) return 0
    return Math.max(0, 6 - ageMs / (1000 * 60 * 60 * 24 * 30))
}

function memorySemanticRefKey(ref: MemorySemanticRef): string {
    return `${normalizeTag(ref.kind)}:${normalizeTag(ref.name)}`
}

function memoryPrefetchAnchorText(entry: AgentMemoryIndexEntry): string {
    return (entry.anchor_refs ?? []).flatMap((anchor) => [
        anchor.id,
        anchor.type,
        anchor.from,
        anchor.from_title,
        anchor.to,
        anchor.to_title,
        anchor.summary
    ]).filter(Boolean).join("\n").toLowerCase()
}

export function recallMemory(input: {
    cwd: string
    taskId?: string
    query?: string
    file?: string
    limit?: number
    includeEvidence?: boolean
    includeGraph?: boolean
    mode?: MemoryRecallMode
    profile?: MemoryRecallProfile
    prefetch?: boolean
    prefetchLimit?: number
    explainScore?: boolean
}): MemoryRecallResult {
    const profile = recallProfile(input)
    const searchStoreRecall = input.file ? undefined : recallMemoryFromSearchStore({
        cwd: input.cwd,
        taskId: input.taskId,
        query: input.query,
        limit: input.limit,
        hydration: recallHydration(input, profile),
        mode: recallMode(input),
        profile,
        explainScore: input.explainScore
    })
    if (searchStoreRecall) return maybePrefetchMemoryRecall(input.cwd, searchStoreRecall, input)

    const index = readMemoryIndex(input.cwd)
    return maybePrefetchMemoryRecall(input.cwd, recallMemoryFromIndex({
        index,
        basePath: input.cwd,
        taskId: input.taskId,
        query: input.query,
        file: input.file,
        limit: input.limit,
        hydration: recallHydration(input, profile),
        mode: recallMode(input),
        profile,
        explainScore: input.explainScore
    }), input)
}

export function recallMemoryProfiled(input: {
    cwd: string
    taskId?: string
    query?: string
    file?: string
    limit?: number
    includeEvidence?: boolean
    includeGraph?: boolean
    mode?: MemoryRecallMode
    profile?: MemoryRecallProfile
    prefetch?: boolean
    prefetchLimit?: number
    explainScore?: boolean
}): MemoryProfiledRecallResult {
    const started = performance.now()
    const profile = recallProfile(input)
    const searchTimings: Partial<Pick<MemoryRecallTimingMetrics, "candidate_selection_ms" | "ranking_ms" | "hydration_ms">> = {}
    const searchStoreRecall = input.file ? undefined : recallMemoryFromSearchStore({
        cwd: input.cwd,
        taskId: input.taskId,
        query: input.query,
        limit: input.limit,
        hydration: recallHydration(input, profile),
        mode: recallMode(input),
        profile,
        explainScore: input.explainScore,
        timingsSink: searchTimings
    })
    if (searchStoreRecall) {
        const finished = performance.now()
        return {
            ...maybePrefetchMemoryRecall(input.cwd, searchStoreRecall, input),
            timings_ms: {
                read_parse_ms: 0,
                candidate_selection_ms: searchTimings.candidate_selection_ms ?? 0,
                ranking_ms: searchTimings.ranking_ms ?? 0,
                hydration_ms: searchTimings.hydration_ms ?? 0,
                total_ms: round2(finished - started)
            }
        }
    }

    const index = readMemoryIndex(input.cwd)
    const afterRead = performance.now()
    const measured = recallMemoryFromIndexMeasured({
        index,
        basePath: input.cwd,
        taskId: input.taskId,
        query: input.query,
        file: input.file,
        limit: input.limit,
        hydration: recallHydration(input, profile),
        mode: recallMode(input),
        profile,
        explainScore: input.explainScore
    })
    const finished = performance.now()
    return {
        ...maybePrefetchMemoryRecall(input.cwd, measured.result, input),
        timings_ms: {
            read_parse_ms: round2(afterRead - started),
            candidate_selection_ms: measured.timings_ms.candidate_selection_ms,
            ranking_ms: measured.timings_ms.ranking_ms,
            hydration_ms: measured.timings_ms.hydration_ms,
            total_ms: round2(finished - started)
        }
    }
}

export function evaluateMemoryRecallBenchmark(input: {
    cwd: string
    cases: MemoryRecallBenchmarkCase[]
    corpusVersion?: string
    profile?: MemoryRecallProfile
    limit?: number
    strongMatchMinScore?: number
}): MemoryRecallBenchmarkReport {
    const strongMatchMinScore = input.strongMatchMinScore ?? MEMORY_RECALL_STRONG_MATCH_MIN_SCORE
    const results = input.cases.map((testCase): MemoryRecallBenchmarkCaseResult => {
        const profile = testCase.profile ?? input.profile ?? "ultra"
        const mode = testCase.mode ?? "current"
        const recall = recallMemory({
            cwd: input.cwd,
            query: testCase.query,
            mode,
            profile,
            limit: testCase.limit ?? input.limit ?? 5
        })
        const expectedTaskIds = (testCase.expected_task_ids ?? []).map(normalizeTaskId)
        const top = recall.results[0]
        const rankIndex = expectedTaskIds.length > 0
            ? recall.results.findIndex((item) => expectedTaskIds.includes(item.task_id))
            : -1
        const rank = rankIndex >= 0 ? rankIndex + 1 : undefined
        const predictedNoStrongMatch = !top || top.score < strongMatchMinScore
        const expectNoStrongMatch = testCase.expect_no_strong_match === true
        const maxRank = testCase.max_rank
        const reciprocalRank = rank ? 1 / rank : 0
        const passed = expectNoStrongMatch
            ? predictedNoStrongMatch
            : rank !== undefined && rank <= (maxRank ?? (testCase.limit ?? input.limit ?? 5)) && !predictedNoStrongMatch

        return {
            id: testCase.id,
            query: testCase.query,
            mode,
            profile,
            expected_task_ids: expectedTaskIds,
            expect_no_strong_match: expectNoStrongMatch,
            max_rank: maxRank,
            predicted_no_strong_match: predictedNoStrongMatch,
            top_score: top?.score ?? 0,
            top_task_id: top?.task_id,
            rank,
            reciprocal_rank: round4(reciprocalRank),
            passed
        }
    })
    const positiveResults = results.filter((item) => !item.expect_no_strong_match)
    const noStrongMatchResults = results.filter((item) => item.expect_no_strong_match)
    const predictedNoStrongMatchResults = results.filter((item) => item.predicted_no_strong_match)
    const trueNoStrongMatchPredictions = predictedNoStrongMatchResults.filter((item) => item.expect_no_strong_match)
    const recallAt1 = positiveResults.length === 0 ? 0 : positiveResults.filter((item) => item.rank !== undefined && item.rank <= 1).length / positiveResults.length
    const recallAt3 = positiveResults.length === 0 ? 0 : positiveResults.filter((item) => item.rank !== undefined && item.rank <= 3).length / positiveResults.length
    const mrr = positiveResults.length === 0 ? 0 : sum(positiveResults, (item) => item.reciprocal_rank) / positiveResults.length
    const noStrongMatchPrecision = predictedNoStrongMatchResults.length === 0 ? 1 : trueNoStrongMatchPredictions.length / predictedNoStrongMatchResults.length
    const noStrongMatchAccuracy = noStrongMatchResults.length === 0 ? 1 : noStrongMatchResults.filter((item) => item.predicted_no_strong_match).length / noStrongMatchResults.length

    return {
        schema: "axiom.agent_memory_benchmark.v0",
        status: results.every((item) => item.passed) ? "ok" : "failed",
        corpus_version: input.corpusVersion ?? "adhoc",
        case_count: results.length,
        positive_case_count: positiveResults.length,
        no_strong_match_case_count: noStrongMatchResults.length,
        recall_at_1: round4(recallAt1),
        recall_at_3: round4(recallAt3),
        mrr: round4(mrr),
        no_strong_match_precision: round4(noStrongMatchPrecision),
        no_strong_match_accuracy: round4(noStrongMatchAccuracy),
        strong_match_min_score: strongMatchMinScore,
        results
    }
}

export function buildMemorySearchStore(input: {
    cwd: string
    index?: AgentMemoryIndex
    reason?: MemorySearchStoreBuildResult["reason"]
    corruptionRecoveryCount?: number
}): MemorySearchStoreBuildResult {
    const index = input.index ?? readMemoryIndex(input.cwd)
    const manifest = emptyMemorySearchManifest(input.cwd, index, input.corruptionRecoveryCount ?? 0)
    const postings = new Map<string, MemorySearchPosting[]>()
    const documents = new Map<string, Record<string, MemorySearchDocumentFile>>()
    const vectorCells = new Map<string, string[]>()
    const docsDir = memorySearchDocsDir(input.cwd)
    const postingsDir = memorySearchPostingsDir(input.cwd)
    const vectorDir = memorySearchVectorDir(input.cwd)
    fs.mkdirSync(docsDir, { recursive: true })
    fs.mkdirSync(postingsDir, { recursive: true })
    fs.mkdirSync(vectorDir, { recursive: true })

    for (const entry of index.entries) {
        const terms = entrySearchTerms(entry)
        const document = makeMemorySearchDocument(entry, terms)
        const shardId = memorySearchDocumentShardId(entry.task_id)
        const shard = documents.get(shardId) ?? {}
        shard[entry.task_id] = document
        documents.set(shardId, shard)
        manifest.entry_hashes[entry.task_id] = hashMemoryIndexEntry(entry)
        for (const cell of embeddingCellsForTerms(Object.keys(terms))) {
            const group = vectorCells.get(cell) ?? []
            group.push(entry.task_id)
            vectorCells.set(cell, group)
        }
        for (const [token, weight] of Object.entries(terms)) {
            const group = postings.get(token) ?? []
            group.push({ task_id: entry.task_id, weight })
            postings.set(token, group)
        }
    }

    for (const [shardId, shardDocuments] of documents) {
        writeMemorySearchDocumentShard(input.cwd, shardId, shardDocuments)
        manifest.document_shard_files![shardId] = normalizePath(path.relative(input.cwd, memorySearchDocumentShardPath(input.cwd, shardId)))
    }
    for (const [token, group] of postings) {
        writeMemorySearchPostings(input.cwd, token, group)
        manifest.token_files[token] = normalizePath(path.relative(input.cwd, memorySearchPostingPath(input.cwd, token)))
    }
    for (const [cell, taskIds] of vectorCells) {
        const sortedTaskIds = uniqueStrings(taskIds).sort()
        writeMemorySearchVectorCell(input.cwd, cell, sortedTaskIds)
        manifest.vector_cell_files![cell] = normalizePath(path.relative(input.cwd, memorySearchVectorCellPath(input.cwd, cell)))
        if (sortedTaskIds.length <= MEMORY_SEARCH_INLINE_VECTOR_CELL_LIMIT) {
            manifest.vector_cells![cell] = sortedTaskIds
        }
    }
    manifest.embedding = memoryEmbeddingMetadata(index)
    writeMemorySearchManifest(input.cwd, manifest)

    return {
        schema: "axiom.agent_memory_search_store_build.v0",
        status: "ok",
        reason: input.reason ?? "manual",
        manifest_path: normalizePath(path.relative(input.cwd, memorySearchManifestPath(input.cwd))),
        source_entry_count: index.entries.length,
        token_count: Object.keys(manifest.token_files).length,
        document_count: manifest.source_entry_count,
        source_index_hash: manifest.source_index_hash,
        corruption_recovery_count: manifest.corruption_recovery_count
    }
}

export function compareMemorySearchStore(input: {
    cwd: string
    cases: MemorySearchStoreCompareCase[]
}): MemorySearchStoreCompareResult {
    const cases = input.cases.map((testCase) => {
        const profile = testCase.profile ?? "ultra"
        const mode = testCase.mode ?? "current"
        const hydration = recallHydration({}, profile)
        const index = readMemoryIndex(input.cwd)
        const json = recallMemoryFromIndex({
            index,
            basePath: input.cwd,
            taskId: testCase.taskId,
            query: testCase.query,
            limit: testCase.limit,
            hydration,
            mode,
            profile
        })
        const search = recallMemoryFromSearchStore({
            cwd: input.cwd,
            taskId: testCase.taskId,
            query: testCase.query,
            limit: testCase.limit,
            hydration,
            mode,
            profile,
            disableRecovery: false
        })
        const jsonTopTaskId = json.results[0]?.task_id
        const searchTopTaskId = search?.results[0]?.task_id
        const jsonTaskIds = json.results.map((item) => item.task_id)
        const searchTaskIds = search?.results.map((item) => item.task_id) ?? []
        const searchExercised = search !== undefined && (searchTaskIds.length > 0 || jsonTaskIds.length === 0)
        const sameTopK = searchExercised && jsonTaskIds.length === searchTaskIds.length && jsonTaskIds.every((taskId, index) => taskId === searchTaskIds[index])
        const sameNoStrongMatch = searchExercised && json.no_strong_match === search.no_strong_match
        const passed = sameTopK && sameNoStrongMatch
        const comparisonStatus: MemorySearchStoreCompareResult["cases"][number]["comparison_status"] = !searchExercised
            ? "not_compared"
            : passed ? "matched" : "mismatched"
        return {
            id: testCase.id,
            comparison_status: comparisonStatus,
            search_exercised: searchExercised,
            json_top_task_id: jsonTopTaskId,
            search_top_task_id: searchTopTaskId,
            json_task_ids: jsonTaskIds,
            search_task_ids: searchTaskIds,
            json_no_strong_match: json.no_strong_match,
            search_no_strong_match: search?.no_strong_match ?? false,
            passed
        }
    })
    return {
        schema: "axiom.agent_memory_search_store_compare.v0",
        status: cases.every((item) => item.passed) ? "ok" : "failed",
        case_count: cases.length,
        cases
    }
}

function recallMemoryFromSearchStore(input: {
    cwd: string
    taskId?: string
    query?: string
    file?: string
    limit?: number
    hydration: MemoryRecallHydration
    mode: MemoryRecallMode
    profile: MemoryRecallProfile
    allowWeakResults?: boolean
    disableRecovery?: boolean
    explainScore?: boolean
    timingsSink?: Partial<Pick<MemoryRecallTimingMetrics, "candidate_selection_ms" | "ranking_ms" | "hydration_ms">>
}): MemoryRecallResult | undefined {
    const manifestPath = memorySearchManifestPath(input.cwd)
    if (!fs.existsSync(manifestPath)) return undefined

    try {
        const manifest = readMemorySearchManifest(input.cwd)
        const currentIndexHash = readCurrentMemoryIndexHash(input.cwd)
        if (currentIndexHash && manifest.source_index_hash !== currentIndexHash) {
            if (input.disableRecovery) return undefined
            buildMemorySearchStore({
                cwd: input.cwd,
                index: readMemoryIndex(input.cwd),
                reason: "corruption_recovery",
                corruptionRecoveryCount: manifest.corruption_recovery_count + 1
            })
            return recallMemoryFromSearchStore({ ...input, disableRecovery: true })
        }

        const limit = input.limit ?? recallProfileLimits(input.profile).default_limit
        const candidateStarted = performance.now()
        const unrankedCandidates = searchStoreCandidates(input.cwd, manifest, input)
        const afterCandidateSelection = performance.now()
        const candidates = unrankedCandidates
            .sort(compareMemoryCandidates)
            .slice(0, limit)
        const afterRanking = performance.now()
        const hydratedResults = candidates.map(({ entry, score }) => {
            const explanation = input.explainScore ? scoreEntryDetailed(entry, input, score).explanation : undefined
            if (input.profile === "ultra" && !input.hydration.include_evidence && !input.hydration.include_graph) {
                return memoryRecallItemFromIndex(entry, score, input.query, input.mode, input.profile, explanation)
            }
            const cached = readMemoryPackCached(input.cwd, entry.pack_path)
            return memoryRecallItem(cached.pack, entry.pack_path, score, cached.compressed_bytes, input.query, input.hydration, input.mode, input.profile, explanation)
        })
        const afterHydration = performance.now()
        if (input.timingsSink) {
            input.timingsSink.candidate_selection_ms = round2(afterCandidateSelection - candidateStarted)
            input.timingsSink.ranking_ms = round2(afterRanking - afterCandidateSelection)
            input.timingsSink.hydration_ms = round2(afterHydration - afterRanking)
        }
        const noStrongMatch = input.allowWeakResults ? false : shouldReturnNoStrongMatch(input, hydratedResults)
        const results = noStrongMatch ? [] : hydratedResults
        return {
            schema: "axiom.agent_memory_recall.v0",
            status: "ok",
            query: input.query,
            file: input.file ? normalizeMemoryFilePath(input.file) : undefined,
            task_id: input.taskId,
            mode: input.mode,
            profile: input.profile,
            hydration: input.hydration,
            no_strong_match: noStrongMatch,
            strong_match_min_score: MEMORY_RECALL_STRONG_MATCH_MIN_SCORE,
            access_tiers: memoryAccessTiersForSearchRecall(input, candidates),
            results,
            metrics: aggregateRecallMetrics(results)
        }
    } catch (error) {
        if (input.disableRecovery) {
            throw error
        }
        buildMemorySearchStore({
            cwd: input.cwd,
            index: readMemoryIndex(input.cwd),
            reason: "corruption_recovery",
            corruptionRecoveryCount: (readMemorySearchManifestBestEffort(input.cwd)?.corruption_recovery_count ?? 0) + 1
        })
        return recallMemoryFromSearchStore({ ...input, disableRecovery: true })
    }
}

function upsertMemorySearchStoreEntry(cwd: string, index: AgentMemoryIndex, entry: AgentMemoryIndexEntry): void {
    try {
        const manifest = fs.existsSync(memorySearchManifestPath(cwd))
            ? readMemorySearchManifest(cwd)
            : emptyMemorySearchManifest(cwd, index, 0)
        const previousDocument = readMemorySearchDocument(cwd, manifest, entry.task_id)
        const previousTerms = previousDocument?.terms ?? {}
        const previousCells = previousDocument?.embedding_cells ?? []
        const nextTerms = entrySearchTerms(entry)
        const nextCells = embeddingCellsForTerms(Object.keys(nextTerms))
        manifest.document_shard_files = manifest.document_shard_files ?? {}
        manifest.vector_cell_files = manifest.vector_cell_files ?? {}
        manifest.vector_cells = manifest.vector_cells ?? {}
        writeMemorySearchDocument(cwd, manifest, entry, nextTerms)

        const affectedTokens = uniqueStrings([
            ...Object.keys(previousTerms),
            ...Object.keys(nextTerms)
        ])
        for (const token of affectedTokens) {
            const postings = readMemorySearchPostings(cwd, manifest, token)
                .filter((posting) => posting.task_id !== entry.task_id)
            const nextWeight = nextTerms[token]
            if (typeof nextWeight === "number" && nextWeight > 0) {
                postings.push({ task_id: entry.task_id, weight: nextWeight })
            }
            if (postings.length > 0) {
                writeMemorySearchPostings(cwd, token, postings)
                manifest.token_files[token] = normalizePath(path.relative(cwd, memorySearchPostingPath(cwd, token)))
            } else {
                const filePath = memorySearchPostingPath(cwd, token)
                if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
                delete manifest.token_files[token]
            }
        }

        const affectedCells = uniqueStrings([...previousCells, ...nextCells])
        for (const cell of affectedCells) {
            const current = readMemorySearchVectorCell(cwd, manifest, cell)
            const next = uniqueStrings([
                ...current.filter((taskId) => taskId !== entry.task_id),
                ...(nextCells.includes(cell) ? [entry.task_id] : [])
            ]).sort()
            if (next.length > 0) {
                writeMemorySearchVectorCell(cwd, cell, next)
                manifest.vector_cell_files[cell] = normalizePath(path.relative(cwd, memorySearchVectorCellPath(cwd, cell)))
                if (next.length <= MEMORY_SEARCH_INLINE_VECTOR_CELL_LIMIT) {
                    manifest.vector_cells[cell] = next
                } else {
                    delete manifest.vector_cells[cell]
                }
            } else {
                const filePath = memorySearchVectorCellPath(cwd, cell)
                if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
                delete manifest.vector_cells[cell]
                delete manifest.vector_cell_files[cell]
            }
        }

        manifest.updated_at = new Date().toISOString()
        manifest.source_index_hash = hashMemoryIndex(index)
        manifest.source_entry_count = index.entries.length
        manifest.embedding = memoryEmbeddingMetadata(index)
        if (!memorySearchUsesDocumentShards(manifest)) {
            manifest.document_files[entry.task_id] = normalizePath(path.relative(cwd, memorySearchDocumentPath(cwd, entry.task_id)))
        }
        manifest.entry_hashes[entry.task_id] = hashMemoryIndexEntry(entry)
        writeMemorySearchManifest(cwd, manifest)
    } catch {
        buildMemorySearchStore({
            cwd,
            index,
            reason: "corruption_recovery",
            corruptionRecoveryCount: (readMemorySearchManifestBestEffort(cwd)?.corruption_recovery_count ?? 0) + 1
        })
    }
}

function searchStoreCandidates(
    cwd: string,
    manifest: MemorySearchStoreManifest,
    input: { taskId?: string; query?: string; file?: string; mode?: MemoryRecallMode; limit?: number; profile?: MemoryRecallProfile }
): { entry: AgentMemoryIndexEntry; score: number }[] {
    if (input.taskId) {
        const taskId = normalizeTaskId(input.taskId)
        const doc = readMemorySearchDocument(cwd, manifest, taskId)
        if (!doc) return []
        return [{ entry: doc.entry, score: scoreEntry(doc.entry, input) }]
    }

    const terms = memoryMutationActive("ignore_query_terms") ? [] : queryTerms(input.query)
    if (terms.length === 0) return []
    const candidateIds = new Set<string>()
    const lexicalCandidateIds = new Set<string>()
    const vectorWeights = new Map<string, number>()
    for (const term of terms) {
        for (const posting of readMemorySearchPostings(cwd, manifest, term)) {
            candidateIds.add(posting.task_id)
            lexicalCandidateIds.add(posting.task_id)
        }
    }
    const requestedLimit = input.limit ?? (input.profile ? recallProfileLimits(input.profile).default_limit : MEMORY_RECALL_PROFILE_LIMITS.ultra.default_limit)
    const useVectorBackfill = memoryMutationActive("ann_only_rerank") || lexicalCandidateIds.size < requestedLimit
    if (useVectorBackfill) {
        for (const cell of embeddingCellsForTerms(expandedVectorTerms(terms))) {
            for (const taskId of readMemorySearchVectorCell(cwd, manifest, cell)) {
                candidateIds.add(taskId)
                vectorWeights.set(taskId, (vectorWeights.get(taskId) ?? 0) + 4)
            }
        }
    }

    const candidateRows: {
        entry: AgentMemoryIndexEntry
        deterministicScore: number
        vectorScore: number
        rawVectorScore: number
    }[] = []
    for (const taskId of candidateIds) {
        const doc = readMemorySearchDocument(cwd, manifest, taskId)
        if (!doc) continue
        const rawVectorScore = Math.min(24, vectorWeights.get(taskId) ?? 0)
        const invalidatedPenaltyActive = (input.mode ?? "current") === "current"
            && invalidatedHintMatchCount(doc.entry.invalidated_score_hints ?? [], terms) >= 2
        const vectorScore = invalidatedPenaltyActive && !memoryMutationActive("ann_only_rerank")
            ? 0
            : rawVectorScore
        const baseScore = scoreEntry(doc.entry, input)
        const deterministicScore = invalidatedPenaltyActive && !memoryMutationActive("ann_only_rerank") && baseScore <= 0
            ? 1
            : baseScore
        candidateRows.push({ entry: doc.entry, deterministicScore, vectorScore, rawVectorScore })
    }
    const hasDeterministicCandidate = candidateRows.some((row) => row.deterministicScore > 0)
    const candidates: { entry: AgentMemoryIndexEntry; score: number }[] = []
    for (const row of candidateRows) {
        const vectorScore = hasDeterministicCandidate && row.deterministicScore <= 0 && !memoryMutationActive("ann_only_rerank")
            ? 0
            : row.vectorScore
        const score = memoryMutationActive("ann_only_rerank")
            ? row.rawVectorScore
            : row.deterministicScore + vectorScore
        if (score > 0) candidates.push({ entry: row.entry, score })
    }
    return candidates
}

function emptyMemorySearchManifest(cwd: string, index: AgentMemoryIndex, corruptionRecoveryCount: number): MemorySearchStoreManifest {
    const now = new Date().toISOString()
    return {
        schema: "axiom.agent_memory_search_store.v0",
        version: 1,
        built_at: now,
        updated_at: now,
        source_index_hash: hashMemoryIndex(index),
        source_entry_count: index.entries.length,
        token_files: {},
        document_files: {},
        document_layout: "sharded",
        document_shard_files: {},
        entry_hashes: {},
        embedding: memoryEmbeddingMetadata(index),
        vector_cells: {},
        vector_cell_files: {},
        corruption_recovery_count: corruptionRecoveryCount
    }
}

function memorySearchBaseDir(cwd: string): string {
    return path.join(cwd, axiomDir, memoryDir, searchStoreDir)
}

function memorySearchDocsDir(cwd: string): string {
    return path.join(memorySearchBaseDir(cwd), "docs")
}

function memorySearchPostingsDir(cwd: string): string {
    return path.join(memorySearchBaseDir(cwd), "postings")
}

function memorySearchVectorDir(cwd: string): string {
    return path.join(memorySearchBaseDir(cwd), "vectors")
}

function memorySearchManifestPath(cwd: string): string {
    return path.join(memorySearchBaseDir(cwd), searchManifestFileName)
}

function memorySearchDocumentPath(cwd: string, taskId: string): string {
    return path.join(memorySearchDocsDir(cwd), `${normalizeTaskId(taskId)}.json`)
}

function memorySearchDocumentShardId(taskId: string): string {
    const bucket = Math.abs(Number.parseInt(shortHash(normalizeTaskId(taskId)), 36)) % MEMORY_SEARCH_DOCUMENT_SHARD_COUNT
    return `s${bucket.toString(36).padStart(3, "0")}`
}

function memorySearchDocumentShardPath(cwd: string, shardId: string): string {
    return path.join(memorySearchDocsDir(cwd), `${shardId}.json`)
}

function memorySearchPostingPath(cwd: string, token: string): string {
    return path.join(memorySearchPostingsDir(cwd), `${shortHash(token)}.json`)
}

function memorySearchVectorCellPath(cwd: string, cell: string): string {
    return path.join(memorySearchVectorDir(cwd), `${shortHash(cell)}.json`)
}

function writeMemorySearchManifest(cwd: string, manifest: MemorySearchStoreManifest): void {
    const filePath = memorySearchManifestPath(cwd)
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, `${JSON.stringify(manifest)}\n`, "utf8")
    const stat = fs.statSync(filePath)
    const absolute = normalizePath(path.resolve(filePath))
    memorySearchManifestCache.set(absolute, {
        file_path: normalizePath(filePath),
        mtime_ms: stat.mtimeMs,
        size: stat.size,
        manifest
    })
}

function readMemorySearchManifest(cwd: string): MemorySearchStoreManifest {
    const filePath = memorySearchManifestPath(cwd)
    const absolute = normalizePath(path.resolve(filePath))
    const stat = fs.statSync(filePath)
    const cached = memorySearchManifestCache.get(absolute)
    if (cached && cached.mtime_ms === stat.mtimeMs && cached.size === stat.size) {
        return cached.manifest
    }
    const manifest = JSON.parse(fs.readFileSync(filePath, "utf8")) as MemorySearchStoreManifest
    if (manifest.schema !== "axiom.agent_memory_search_store.v0" || manifest.version !== 1) {
        throw new Error("axmem search store: unsupported manifest")
    }
    memorySearchManifestCache.set(absolute, {
        file_path: normalizePath(filePath),
        mtime_ms: stat.mtimeMs,
        size: stat.size,
        manifest
    })
    return manifest
}

function readMemorySearchManifestBestEffort(cwd: string): MemorySearchStoreManifest | undefined {
    try {
        return readMemorySearchManifest(cwd)
    } catch {
        return undefined
    }
}

function makeMemorySearchDocument(entry: AgentMemoryIndexEntry, terms: Record<string, number>): MemorySearchDocumentFile {
    return {
        schema: "axiom.agent_memory_search_document.v0",
        version: 1,
        task_id: entry.task_id,
        terms,
        embedding_cells: embeddingCellsForTerms(Object.keys(terms)),
        entry
    }
}

function writeMemorySearchDocument(cwd: string, manifest: MemorySearchStoreManifest, entry: AgentMemoryIndexEntry, terms: Record<string, number>): void {
    const document = makeMemorySearchDocument(entry, terms)
    if (memorySearchUsesDocumentShards(manifest)) {
        const shardId = memorySearchDocumentShardId(entry.task_id)
        const shard = readMemorySearchDocumentShard(cwd, manifest, shardId)
        shard.documents[entry.task_id] = document
        writeMemorySearchDocumentShard(cwd, shardId, shard.documents)
        manifest.document_shard_files![shardId] = normalizePath(path.relative(cwd, memorySearchDocumentShardPath(cwd, shardId)))
        delete manifest.document_files[entry.task_id]
        return
    }
    const filePath = memorySearchDocumentPath(cwd, entry.task_id)
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, `${JSON.stringify(document)}\n`, "utf8")
    manifest.document_files[entry.task_id] = normalizePath(path.relative(cwd, filePath))
}

function readMemorySearchDocument(cwd: string, manifest: MemorySearchStoreManifest, taskId: string): MemorySearchDocumentFile | undefined {
    if (memorySearchUsesDocumentShards(manifest)) {
        if (memoryMutationActive("ignore_search_document_shards")) return undefined
        const shardId = memorySearchDocumentShardId(taskId)
        const shard = readMemorySearchDocumentShard(cwd, manifest, shardId)
        return shard.documents[taskId]
    }
    const relative = manifest.document_files[taskId]
    if (!relative) return undefined
    const filePath = path.join(cwd, relative)
    const document = JSON.parse(fs.readFileSync(filePath, "utf8")) as MemorySearchDocumentFile
    if (document.schema !== "axiom.agent_memory_search_document.v0" || document.version !== 1 || document.task_id !== taskId) {
        throw new Error(`axmem search store: invalid document for ${taskId}`)
    }
    return document
}

function memorySearchUsesDocumentShards(manifest: MemorySearchStoreManifest): boolean {
    return manifest.document_layout === "sharded" || Object.keys(manifest.document_shard_files ?? {}).length > 0
}

function writeMemorySearchDocumentShard(cwd: string, shardId: string, documents: Record<string, MemorySearchDocumentFile>): void {
    const file: MemorySearchDocumentShardFile = {
        schema: "axiom.agent_memory_search_document_shard.v0",
        version: 1,
        shard_id: shardId,
        documents
    }
    const filePath = memorySearchDocumentShardPath(cwd, shardId)
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, `${JSON.stringify(file)}\n`, "utf8")
}

function readMemorySearchDocumentShard(cwd: string, manifest: MemorySearchStoreManifest, shardId: string): MemorySearchDocumentShardFile {
    const relative = manifest.document_shard_files?.[shardId]
    const filePath = relative ? path.join(cwd, relative) : memorySearchDocumentShardPath(cwd, shardId)
    if (!fs.existsSync(filePath)) {
        return {
            schema: "axiom.agent_memory_search_document_shard.v0",
            version: 1,
            shard_id: shardId,
            documents: {}
        }
    }
    const file = JSON.parse(fs.readFileSync(filePath, "utf8")) as MemorySearchDocumentShardFile
    if (file.schema !== "axiom.agent_memory_search_document_shard.v0" || file.version !== 1 || file.shard_id !== shardId) {
        throw new Error(`axmem search store: invalid document shard for ${shardId}`)
    }
    return file
}

function writeMemorySearchPostings(cwd: string, token: string, postings: MemorySearchPosting[]): void {
    const file: MemorySearchPostingsFile = {
        schema: "axiom.agent_memory_search_postings.v0",
        version: 1,
        token,
        postings: postings
            .sort((left, right) => right.weight - left.weight || left.task_id.localeCompare(right.task_id))
    }
    const filePath = memorySearchPostingPath(cwd, token)
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, `${JSON.stringify(file)}\n`, "utf8")
}

function readMemorySearchPostings(cwd: string, manifest: MemorySearchStoreManifest, token: string): MemorySearchPosting[] {
    const relative = manifest.token_files[token]
    if (!relative) return []
    const filePath = path.join(cwd, relative)
    const file = JSON.parse(fs.readFileSync(filePath, "utf8")) as MemorySearchPostingsFile
    if (file.schema !== "axiom.agent_memory_search_postings.v0" || file.version !== 1 || file.token !== token) {
        throw new Error(`axmem search store: invalid postings for ${token}`)
    }
    return file.postings
}

function writeMemorySearchVectorCell(cwd: string, cell: string, taskIds: string[]): void {
    const file: MemorySearchVectorCellFile = {
        schema: "axiom.agent_memory_vector_cell.v0",
        version: 1,
        cell,
        task_ids: taskIds
    }
    const filePath = memorySearchVectorCellPath(cwd, cell)
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, `${JSON.stringify(file)}\n`, "utf8")
}

function readMemorySearchVectorCell(cwd: string, manifest: MemorySearchStoreManifest, cell: string): string[] {
    const inline = manifest.vector_cells?.[cell]
    if (inline) return inline
    if (memoryMutationActive("ignore_vector_cell_files")) return []
    const relative = manifest.vector_cell_files?.[cell]
    if (!relative) return []
    const filePath = path.join(cwd, relative)
    const file = JSON.parse(fs.readFileSync(filePath, "utf8")) as MemorySearchVectorCellFile
    if (file.schema !== "axiom.agent_memory_vector_cell.v0" || file.version !== 1 || file.cell !== cell) {
        throw new Error(`axmem search store: invalid vector cell for ${cell}`)
    }
    return file.task_ids
}

function entrySearchTerms(entry: AgentMemoryIndexEntry): Record<string, number> {
    const values = [
        entry.task_id,
        entry.title,
        ...entry.tags,
        ...(entry.canonical_tags ?? []),
        ...(entry.agent_tags ?? []),
        entry.resume_command ?? "",
        ...entry.score_hints,
        ...(entry.strata_refs ?? []).flatMap((stratum) => [stratum.part, stratum.name, stratum.kind]),
        ...(entry.anchor_hints ?? []),
        ...entry.semantic_refs.flatMap((ref) => [ref.kind, ref.name])
    ]
    const terms: Record<string, number> = {}
    for (const value of values) {
        for (const term of queryTerms(value)) {
            terms[term] = (terms[term] ?? 0) + 1
        }
    }
    return terms
}

function memoryEmbeddingMetadata(index: AgentMemoryIndex): MemoryEmbeddingMetadata {
    return {
        schema: "axiom.agent_memory_embedding_metadata.v0",
        model_id: MEMORY_VECTOR_MODEL_ID,
        dimensions: MEMORY_VECTOR_DIMENSIONS,
        normalization: "l2",
        corpus_fingerprint: hashMemoryIndex(index),
        generated_at: new Date().toISOString()
    }
}

function expandedVectorTerms(terms: string[]): string[] {
    const aliases: Record<string, string[]> = {
        database: ["sqlite", "fts", "store"],
        db: ["sqlite", "fts", "store"],
        recover: ["recovery", "corruption"],
        recovery: ["recover", "corruption"],
        semantic: ["meaning", "vector", "embedding"],
        embeddings: ["embedding", "vector"],
        vector: ["embedding", "semantic"],
        cache: ["lru", "hot", "warm"],
        proof: ["soundness", "trust", "invariant"],
        quality: ["benchmark", "recall-at-k", "mrr"]
    }
    return uniqueStrings([
        ...terms,
        ...terms.flatMap((term) => aliases[term] ?? [])
    ])
}

function embeddingCellsForTerms(terms: string[]): string[] {
    const cells = new Set<string>()
    for (const term of terms) {
        const bucket = Math.abs(Number.parseInt(shortHash(term), 36)) % MEMORY_VECTOR_DIMENSIONS
        cells.add(`h${bucket}`)
    }
    return [...cells].sort()
}

function hashMemoryIndex(index: AgentMemoryIndex): string {
    return shortHash(JSON.stringify({
        schema: index.schema,
        version: index.version,
        entries: index.entries.map((entry) => hashMemoryIndexEntry(entry))
    }))
}

function hashMemoryIndexEntry(entry: AgentMemoryIndexEntry): string {
    return shortHash(JSON.stringify(entry))
}

function readCurrentMemoryIndexHash(cwd: string): string | undefined {
    const filePath = path.join(cwd, axiomDir, memoryDir, indexFileName)
    if (!fs.existsSync(filePath)) return undefined
    try {
        const absolute = normalizePath(path.resolve(filePath))
        const stat = fs.statSync(filePath)
        const cached = memoryIndexHashCache.get(absolute)
        if (cached && cached.mtime_ms === stat.mtimeMs && cached.size === stat.size) {
            return cached.hash
        }
        const index = JSON.parse(fs.readFileSync(filePath, "utf8")) as AgentMemoryIndex
        if (index.schema !== "axiom.agent_memory_index.v0" || index.version !== 1 || !Array.isArray(index.entries)) return undefined
        const hash = hashMemoryIndex(index)
        memoryIndexHashCache.set(absolute, {
            file_path: normalizePath(filePath),
            mtime_ms: stat.mtimeMs,
            size: stat.size,
            hash
        })
        return hash
    } catch {
        return undefined
    }
}

function recallMemoryFromIndex(input: {
    index: AgentMemoryIndex
    basePath: string
    taskId?: string
    query?: string
    file?: string
    limit?: number
    hydration: MemoryRecallHydration
    mode: MemoryRecallMode
    profile: MemoryRecallProfile
    allowWeakResults?: boolean
    explainScore?: boolean
}): MemoryRecallResult {
    return recallMemoryFromIndexMeasured(input).result
}

function recallMemoryFromIndexMeasured(input: {
    index: AgentMemoryIndex
    basePath: string
    taskId?: string
    query?: string
    file?: string
    limit?: number
    hydration: MemoryRecallHydration
    mode: MemoryRecallMode
    profile: MemoryRecallProfile
    allowWeakResults?: boolean
    explainScore?: boolean
}): { result: MemoryRecallResult; timings_ms: Pick<MemoryRecallTimingMetrics, "candidate_selection_ms" | "ranking_ms" | "hydration_ms"> } {
    const limit = input.limit ?? recallProfileLimits(input.profile).default_limit
    const candidateStarted = performance.now()
    const candidates = input.index.entries
        .map((entry) => ({ entry, score: scoreEntry(entry, input) }))
        .filter((item) => item.score > 0)
    const afterCandidateSelection = performance.now()
    const scored = candidates
        .sort(compareMemoryCandidates)
        .slice(0, limit)
    const afterRanking = performance.now()

    const hydratedResults = scored.map(({ entry, score }) => {
        const explanation = input.explainScore ? scoreEntryDetailed(entry, input, score).explanation : undefined
        if (input.profile === "ultra" && !input.hydration.include_evidence && !input.hydration.include_graph) {
            return memoryRecallItemFromIndex(entry, score, input.query, input.mode, input.profile, explanation)
        }
        const cached = readMemoryPackCached(input.basePath, entry.pack_path)
        return memoryRecallItem(cached.pack, entry.pack_path, score, cached.compressed_bytes, input.query, input.hydration, input.mode, input.profile, explanation)
    })
    const afterHydration = performance.now()
    const noStrongMatch = input.allowWeakResults ? false : shouldReturnNoStrongMatch(input, hydratedResults)
    const results = noStrongMatch ? [] : hydratedResults

    return {
        result: {
        schema: "axiom.agent_memory_recall.v0",
        status: "ok",
        query: input.query,
        file: input.file ? normalizeMemoryFilePath(input.file) : undefined,
        task_id: input.taskId,
        mode: input.mode,
        profile: input.profile,
        hydration: input.hydration,
        no_strong_match: noStrongMatch,
        strong_match_min_score: MEMORY_RECALL_STRONG_MATCH_MIN_SCORE,
        access_tiers: memoryAccessTiersForIndexRecall(input),
        results,
        metrics: aggregateRecallMetrics(results)
        },
        timings_ms: {
            candidate_selection_ms: round2(afterCandidateSelection - candidateStarted),
            ranking_ms: round2(afterRanking - afterCandidateSelection),
            hydration_ms: round2(afterHydration - afterRanking)
        }
    }
}

function compareMemoryCandidates(
    left: { entry: AgentMemoryIndexEntry; score: number },
    right: { entry: AgentMemoryIndexEntry; score: number }
): number {
    if (memoryMutationActive("random_order")) {
        return left.entry.task_id.localeCompare(right.entry.task_id)
    }

    return right.score - left.score || right.entry.updated_at.localeCompare(left.entry.updated_at) || left.entry.task_id.localeCompare(right.entry.task_id)
}

function shouldReturnNoStrongMatch(
    input: { taskId?: string; query?: string },
    results: Pick<MemoryRecallItem,
        | "score"
        | "invalidated_match_count"
        | "task_id"
        | "title"
        | "tags"
        | "canonical_tags"
        | "agent_tags"
        | "semantic_refs"
        | "summary"
        | "decisions"
        | "next_actions"
        | "projected_strata"
        | "projected_anchors"
        | "evidence_refs"
    >[]
): boolean {
    if (input.taskId) return false
    if (!(input.query ?? "").trim()) return false
    if ((results[0]?.invalidated_match_count ?? 0) >= 2) return false
    const top = results[0]
    const topScore = top?.score ?? 0
    if (topScore < MEMORY_RECALL_STRONG_MATCH_MIN_SCORE) return true

    const secondScore = results[1]?.score ?? 0
    const margin = topScore - secondScore
    const quality = top ? recallTopMatchQuality(input.query, top) : { term_count: 0, matched_count: 0, coverage: 0, anchor_coverage: 0 }
    if (quality.term_count >= 4) {
        if (quality.matched_count <= 1) return true
        if (quality.anchor_coverage === 0 && quality.coverage < 0.6 && margin < 80) return true
        if (quality.coverage < 0.4 && margin < 60) return true
        if (quality.coverage < 0.5 && topScore < 140 && margin < 35) return true
    } else if (quality.term_count >= 2 && quality.coverage < 0.34 && margin < 50) {
        return true
    }
    if (topScore < 45 && margin < 8) return true
    if (topScore < 65 && margin < 4) return true
    return false
}

function recallTopMatchQuality(
    query: string | undefined,
    item: Pick<MemoryRecallItem,
        | "task_id"
        | "title"
        | "tags"
        | "canonical_tags"
        | "agent_tags"
        | "semantic_refs"
        | "summary"
        | "decisions"
        | "next_actions"
        | "projected_strata"
        | "projected_anchors"
        | "evidence_refs"
    >
): { term_count: number; matched_count: number; coverage: number; anchor_coverage: number } {
    const terms = recallQualityTerms(query)
    if (terms.length === 0) return { term_count: 0, matched_count: 0, coverage: 0, anchor_coverage: 0 }

    const anchorText = recallQualityText([
        item.task_id,
        item.title,
        ...item.tags,
        ...item.canonical_tags,
        ...item.agent_tags,
        ...item.semantic_refs.flatMap((ref) => [ref.kind, ref.name])
    ])
    const bodyText = recallQualityText([
        anchorText.raw,
        ...Object.values(item.summary ?? {}),
        ...item.decisions.flatMap((decision) => [decision.kind, decision.summary, decision.reason]),
        ...item.next_actions,
        ...item.projected_strata.flatMap((stratum) => [
            stratum.part,
            stratum.name,
            stratum.kind,
            ...stratum.nodes.flatMap((node) => [node.kind, node.title, node.status])
        ]),
        ...item.projected_anchors.flatMap((anchor) => [
            anchor.type,
            anchor.from_title,
            anchor.to_title,
            anchor.summary,
            anchor.status
        ]),
        ...item.evidence_refs.flatMap((evidence) => [evidence.kind, evidence.path, evidence.summary])
    ])
    let totalWeight = 0
    let matchedWeight = 0
    let anchorMatchedWeight = 0
    let matchedCount = 0
    for (const term of terms) {
        totalWeight += term.weight
        const anchorMatched = recallQualityMatches(anchorText, term.variants)
        const matched = anchorMatched || recallQualityMatches(bodyText, term.variants)
        if (matched) {
            matchedCount++
            matchedWeight += term.weight
        }
        if (anchorMatched) anchorMatchedWeight += term.weight
    }
    return {
        term_count: terms.length,
        matched_count: matchedCount,
        coverage: totalWeight === 0 ? 0 : matchedWeight / totalWeight,
        anchor_coverage: totalWeight === 0 ? 0 : anchorMatchedWeight / totalWeight
    }
}

function recallQualityTerms(query: string | undefined): { variants: string[]; weight: number }[] {
    const stopTerms = new Set(["a", "an", "and", "de", "du", "for", "in", "la", "le", "of", "on", "or", "the", "then", "to"])
    const genericTerms = new Set(["agent", "card", "data", "file", "fixed", "memory", "metric", "note", "quality", "query", "recall", "saved", "source", "test", "tests", "token", "tokens", "wrong"])
    return queryTerms(query)
        .filter((term) => term.length > 0 && !stopTerms.has(term))
        .map((term) => {
            const variants = uniqueStrings([term, recallQualityStem(term), term.replace(/[^a-z0-9]+/g, "")]).filter((variant) => variant.length > 0)
            let weight = genericTerms.has(term) ? 0.75 : 1
            if (term.length >= 12) weight += 0.5
            if (/\d/.test(term)) weight += 0.4
            return { variants, weight }
        })
}

function recallQualityStem(term: string): string {
    if (term.length <= 4) return term
    if (term.endsWith("ies")) return `${term.slice(0, -3)}y`
    if (term.endsWith("ing") && term.length > 6) return term.slice(0, -3)
    if (term.endsWith("ed") && term.length > 5) return term.slice(0, -2)
    if (term.endsWith("es") && term.length > 5) return term.slice(0, -2)
    if (term.endsWith("s") && term.length > 5) return term.slice(0, -1)
    return term
}

function recallQualityText(values: (string | undefined)[]): { raw: string; compact: string } {
    const raw = values.filter((value): value is string => typeof value === "string" && value.length > 0).join("\n").toLowerCase()
    return { raw, compact: raw.replace(/[^a-z0-9]+/g, "") }
}

function recallQualityMatches(text: { raw: string; compact: string }, variants: string[]): boolean {
    return variants.some((variant) => text.raw.includes(variant) || (variant.length >= 4 && text.compact.includes(variant.replace(/[^a-z0-9]+/g, ""))))
}

function memoryAccessTiersForIndexRecall(input: { profile?: MemoryRecallProfile; hydration?: MemoryRecallHydration }): MemoryAccessTier[] {
    return uniqueMemoryAccessTiers([
        "L0_RAM_INDEX",
        ...(input.profile && input.profile !== "ultra" ? ["L1_PACK_LRU", "L2_COMPRESSED_PACK"] as MemoryAccessTier[] : []),
        ...(input.hydration?.include_evidence || input.hydration?.include_graph ? ["L2_COMPRESSED_PACK"] as MemoryAccessTier[] : [])
    ])
}

function memoryAccessTiersForSearchRecall(
    input: { query?: string; profile?: MemoryRecallProfile; hydration?: MemoryRecallHydration },
    _candidates: { entry: AgentMemoryIndexEntry; score: number }[]
): MemoryAccessTier[] {
    return uniqueMemoryAccessTiers([
        "L2_SEARCH_STORE",
        ...(queryTerms(input.query).length > 0 ? ["L3_VECTOR_INDEX"] as MemoryAccessTier[] : []),
        ...(input.profile && input.profile !== "ultra" ? ["L1_PACK_LRU", "L2_COMPRESSED_PACK"] as MemoryAccessTier[] : []),
        ...(input.hydration?.include_evidence || input.hydration?.include_graph ? ["L2_COMPRESSED_PACK"] as MemoryAccessTier[] : [])
    ])
}

function uniqueMemoryAccessTiers(tiers: MemoryAccessTier[]): MemoryAccessTier[] {
    return uniqueStrings(tiers) as MemoryAccessTier[]
}

export function publishMemoryProject(input: {
    cwd: string
    memoryHome?: string
    projectId?: string
    title?: string
    visibility?: AgentMemoryProjectVisibility
    agentScope?: string
    domainTags?: string[]
}): MemoryProjectPublishResult {
    const localIndex = readMemoryIndex(input.cwd)
    const now = new Date().toISOString()
    const memoryHome = resolveMemoryHome(input.memoryHome)
    const projectId = normalizeProjectId(input.projectId ?? path.basename(input.cwd))
    const title = input.title ?? projectId
    const projectPath = path.join(memoryHome, "projects", projectId)
    const packDir = path.join(projectPath, "packs")
    fs.mkdirSync(packDir, { recursive: true })

    const publishedEntries = localIndex.entries.map((entry) => {
        const packFileName = path.basename(entry.pack_path)
        const sourcePackPath = path.join(input.cwd, entry.pack_path)
        const targetPackPath = path.join(packDir, packFileName)

        if (!fs.existsSync(sourcePackPath)) {
            throw new Error(`axmem publish: pack for task ${entry.task_id} is missing at ${entry.pack_path}`)
        }

        fs.copyFileSync(sourcePackPath, targetPackPath)
        return {
            ...entry,
            pack_path: normalizePath(path.join("packs", packFileName))
        }
    })
    const publishedIndex: AgentMemoryIndex = {
        ...localIndex,
        updated_at: now,
        entries: publishedEntries
    }
    const indexPath = path.join(projectPath, indexFileName)
    fs.writeFileSync(indexPath, `${JSON.stringify(publishedIndex, null, 2)}\n`, "utf8")

    const registry = readGlobalMemoryRegistry(memoryHome)
    const previous = registry.projects.find((project) => project.project_id === projectId)
    const project: AgentMemoryProjectEntry = {
        project_id: projectId,
        title,
        workspace_path: normalizePath(path.resolve(input.cwd)),
        storage: "copied",
        project_path: normalizePath(projectPath),
        index_path: normalizePath(indexPath),
        pack_base_path: normalizePath(projectPath),
        visibility: input.visibility ?? "shared",
        agent_scope: input.agentScope ?? "generic",
        domain_tags: uniqueStrings(input.domainTags ?? []),
        score_hints: projectScoreHints(projectId, title, input.domainTags ?? [], publishedIndex),
        task_count: publishedIndex.entries.length,
        published_at: previous?.published_at ?? now,
        updated_at: now
    }
    const updated = upsertRegistryProject(registry, project)
    writeGlobalMemoryRegistry(memoryHome, updated)

    return {
        schema: "axiom.agent_memory_project_publish.v0",
        status: "ok",
        project_id: projectId,
        title,
        storage: "copied",
        registry_path: normalizePath(globalRegistryPath(memoryHome)),
        project_path: normalizePath(projectPath),
        index_path: normalizePath(indexPath),
        task_count: publishedIndex.entries.length,
        copied_pack_count: publishedIndex.entries.length
    }
}

export function attachMemoryProject(input: {
    memoryHome?: string
    workspacePath: string
    projectId?: string
    title?: string
    visibility?: AgentMemoryProjectVisibility
    agentScope?: string
    domainTags?: string[]
}): MemoryProjectPublishResult {
    const workspacePath = path.resolve(input.workspacePath)
    const indexPath = path.join(workspacePath, axiomDir, memoryDir, indexFileName)
    if (!fs.existsSync(indexPath)) {
        throw new Error(`axmem attach: no local memory index found at ${normalizePath(indexPath)}`)
    }
    const index = readMemoryIndex(workspacePath)
    const now = new Date().toISOString()
    const memoryHome = resolveMemoryHome(input.memoryHome)
    const projectId = normalizeProjectId(input.projectId ?? path.basename(workspacePath))
    const title = input.title ?? projectId
    const registry = readGlobalMemoryRegistry(memoryHome)
    const previous = registry.projects.find((project) => project.project_id === projectId)
    const project: AgentMemoryProjectEntry = {
        project_id: projectId,
        title,
        workspace_path: normalizePath(workspacePath),
        storage: "attached",
        index_path: normalizePath(indexPath),
        pack_base_path: normalizePath(workspacePath),
        visibility: input.visibility ?? "shared",
        agent_scope: input.agentScope ?? "generic",
        domain_tags: uniqueStrings(input.domainTags ?? []),
        score_hints: projectScoreHints(projectId, title, input.domainTags ?? [], index),
        task_count: index.entries.length,
        published_at: previous?.published_at ?? now,
        updated_at: now
    }
    const updated = upsertRegistryProject(registry, project)
    writeGlobalMemoryRegistry(memoryHome, updated)

    return {
        schema: "axiom.agent_memory_project_publish.v0",
        status: "ok",
        project_id: projectId,
        title,
        storage: "attached",
        registry_path: normalizePath(globalRegistryPath(memoryHome)),
        index_path: normalizePath(indexPath),
        task_count: index.entries.length,
        copied_pack_count: 0
    }
}

export function readGlobalMemoryRegistry(memoryHome?: string): AgentMemoryRegistry {
    const filePath = globalRegistryPath(resolveMemoryHome(memoryHome))

    if (!fs.existsSync(filePath)) {
        return emptyMemoryRegistry()
    }

    let parsed: AgentMemoryRegistry
    try {
        parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as AgentMemoryRegistry
    } catch (error) {
        throw new Error(`axmem registry: unable to read registry JSON (${error instanceof Error ? error.message : String(error)})`)
    }
    if (parsed.schema !== "axiom.agent_memory_registry.v0" || parsed.version !== 1 || !Array.isArray(parsed.projects)) {
        throw new Error("axmem registry: unsupported or invalid registry schema")
    }
    return parsed
}

export function recallGlobalMemory(input: {
    memoryHome?: string
    projectId?: string
    taskId?: string
    query?: string
    file?: string
    limit?: number
    includeEvidence?: boolean
    includeGraph?: boolean
    mode?: MemoryRecallMode
    profile?: MemoryRecallProfile
    explainScore?: boolean
}): GlobalMemoryRecallResult {
    const registry = readGlobalMemoryRegistry(input.memoryHome)
    const projectId = input.projectId ? normalizeProjectId(input.projectId) : undefined
    const profile = recallProfile(input)
    const limit = input.limit ?? recallProfileLimits(profile).default_limit
    const hydration = recallHydration(input, profile)
    const mode = recallMode(input)
    const projects = projectId
        ? registry.projects.filter((project) => project.project_id === projectId)
        : registry.projects

    if (projectId && projects.length === 0) {
        throw new Error(`axmem registry: project '${projectId}' is not registered`)
    }

    const results: GlobalMemoryRecallItem[] = []
    for (const project of projects) {
        let index: AgentMemoryIndex
        try {
            index = readProjectMemoryIndex(project)
        } catch (error) {
            throw new Error(`axmem registry: unable to read project ${project.project_id} index (${error instanceof Error ? error.message : String(error)})`)
        }
        const recalled = recallMemoryFromIndex({
            index,
            basePath: project.pack_base_path,
            taskId: input.taskId,
            query: input.query,
            file: input.file,
            limit,
            hydration,
            mode,
            profile,
            allowWeakResults: true,
            explainScore: input.explainScore
        })
        const projectScore = scoreProject(project, input)

        for (const item of recalled.results) {
            const score = item.score + projectScore
            results.push({
                ...item,
                score,
                score_explanation: input.explainScore
                    ? scoreExplanationWithProject(item.score_explanation, score, projectScore)
                    : item.score_explanation,
                project_id: project.project_id,
                project_title: project.title,
                storage: project.storage,
                workspace_path: project.workspace_path,
                visibility: project.visibility,
                agent_scope: project.agent_scope
            })
        }
    }

    const ranked = dedupeGlobalMemoryResults(results)
        .sort((left, right) => right.score - left.score || left.project_id.localeCompare(right.project_id) || left.task_id.localeCompare(right.task_id))
        .slice(0, limit)
    const noStrongMatch = shouldReturnNoStrongMatch(input, ranked)
    const sorted = noStrongMatch ? [] : ranked

    return {
        schema: "axiom.agent_memory_global_recall.v0",
        status: "ok",
        query: input.query,
        file: input.file ? normalizeMemoryFilePath(input.file) : undefined,
        task_id: input.taskId,
        project_id: projectId,
        mode,
        profile,
        hydration,
        no_strong_match: noStrongMatch,
        strong_match_min_score: MEMORY_RECALL_STRONG_MATCH_MIN_SCORE,
        access_tiers: memoryAccessTiersForIndexRecall({ profile, hydration }),
        results: sorted,
        metrics: aggregateRecallMetrics(sorted)
    }
}

export function renderMemoryIndex(index: AgentMemoryIndex): string {
    const lines = ["Axiom agent memory:"]

    if (index.entries.length === 0) {
        lines.push("    <empty>")
        return lines.join("\n")
    }

    for (const entry of index.entries.slice().sort((left, right) => right.updated_at.localeCompare(left.updated_at))) {
        lines.push(`- ${entry.task_id}: ${entry.title}`)
        lines.push(`  updated: ${entry.updated_at}`)
        lines.push(`  pack: ${entry.pack_path}`)
        if ((entry.canonical_tags ?? []).length > 0) {
            lines.push(`  canonical: ${(entry.canonical_tags ?? []).slice(0, 8).join(", ")}`)
        }
        if ((entry.agent_tags ?? entry.tags).length > 0) {
            lines.push(`  agent tags: ${(entry.agent_tags ?? entry.tags).slice(0, 8).join(", ")}`)
        }
    }

    return lines.join("\n")
}

export function renderMemoryCapture(result: MemoryCaptureResult): string {
    return [
        `Captured memory task ${result.task_id}: ${result.title}`,
        `Pack: ${result.pack_path}`,
        `Index: ${result.index_path}`,
        `Evidence: ${result.evidence_count}`,
        `Commands: ${result.command_count}`,
        `Metrics: raw evidence ${result.metrics.raw_evidence_chars} chars; pack JSON ${result.metrics.pack_json_chars} chars; compressed ${result.metrics.compressed_pack_bytes} bytes; ratio ${result.metrics.json_to_compressed_ratio}x`
    ].join("\n")
}

export function renderMemoryIngest(result: MemoryIngestResult): string {
    return [
        `Ingested memory task ${result.task_id}: ${result.title}`,
        `Pack: ${result.pack_path}`,
        `Index: ${result.index_path}`,
        `Evidence: ${result.evidence_count}`,
        `Commands: ${result.command_count}`,
        `Graph: ${result.graph_node_count} nodes; ${result.anchor_count} anchors`,
        `Metrics: raw evidence ${result.metrics.raw_evidence_chars} chars; pack JSON ${result.metrics.pack_json_chars} chars; compressed ${result.metrics.compressed_pack_bytes} bytes; ratio ${result.metrics.json_to_compressed_ratio}x`
    ].join("\n")
}

export function renderMemoryUpdate(result: MemoryUpdateResult): string {
    return [
        `Updated memory task ${result.task_id}: ${result.title}`,
        `Pack: ${result.pack_path}`,
        `Index: ${result.index_path}`,
        `Appended: ${result.appended_decision_count} decisions; ${result.appended_next_action_count} next actions; ${result.appended_semantic_ref_count} refs; ${result.invalidated_hypothesis_count} invalidations`,
        `Graph: ${result.graph_node_count} nodes; ${result.anchor_count} anchors`
    ].join("\n")
}

export function renderMemoryHandoffGuard(result: MemoryHandoffGuardResult): string {
    return [
        `AXMEM handoff guard: ${result.status}`,
        result.message,
        `Changed lines: ${result.changed_lines} (+${result.added_lines}/-${result.deleted_lines}) across ${result.changed_file_count} files`,
        `Threshold: ${result.threshold}; handoff window: ${result.since_hours}h`,
        result.recent_handoff_task_ids.length > 0 ? `Recent handoffs: ${result.recent_handoff_task_ids.join(", ")}` : "Recent handoffs: <none>"
    ].join("\n")
}

export function renderMemoryReindex(result: MemoryReindexResult): string {
    const lines = [
        `Reindexed agent memory (${result.reason})`,
        `Index: ${result.index_path}`,
        `Packs: ${result.pack_count}`,
        `Entries: ${result.entry_count}`
    ]
    for (const entry of result.entries.slice(0, 10)) {
        lines.push(`- ${entry.task_id}: ${entry.graph_node_count} graph nodes; ${entry.anchor_count} anchors`)
    }
    if (result.entries.length > 10) {
        lines.push(`... ${result.entries.length - 10} more`)
    }
    return lines.join("\n")
}

export function renderMemoryDelete(result: MemoryDeleteResult): string {
    const lines = [
        result.dry_run
            ? `AXMEM delete dry-run: ${result.matched_task_ids.length} matched, ${result.missing_task_ids.length} missing`
            : result.status === "ok"
                ? `Deleted AXMEM tasks: ${result.deleted_task_ids.join(", ")}`
                : "No AXMEM tasks matched for deletion",
        `Index: ${result.index_path}`,
        `Reindexed: ${result.reindexed ? "yes" : "no"}`,
        `Remaining entries: ${result.remaining_entry_count}`
    ]
    const paths = result.dry_run ? result.target_pack_paths : result.deleted_pack_paths
    for (const packPath of paths) {
        lines.push(`- ${packPath}`)
    }
    if (result.missing_task_ids.length > 0) {
        lines.push(`Missing: ${result.missing_task_ids.join(", ")}`)
    }
    return lines.join("\n")
}

export function renderMemoryProjectPublish(result: MemoryProjectPublishResult): string {
    const lines = [
        `Published memory project ${result.project_id}: ${result.title}`,
        `Storage: ${result.storage}`,
        `Registry: ${result.registry_path}`,
        `Index: ${result.index_path}`,
        `Tasks: ${result.task_count}`,
        `Copied packs: ${result.copied_pack_count}`
    ]
    if (result.project_path) lines.splice(3, 0, `Project: ${result.project_path}`)
    return lines.join("\n")
}

export function renderMemoryProjects(registry: AgentMemoryRegistry): string {
    const lines = ["Axiom global memory projects:"]

    if (registry.projects.length === 0) {
        lines.push("    <empty>")
        return lines.join("\n")
    }

    for (const project of registry.projects.slice().sort((left, right) => right.updated_at.localeCompare(left.updated_at) || left.project_id.localeCompare(right.project_id))) {
        lines.push(`- ${project.project_id}: ${project.title}`)
        lines.push(`  storage: ${project.storage}; visibility: ${project.visibility}; agent: ${project.agent_scope}`)
        lines.push(`  updated: ${project.updated_at}`)
        lines.push(`  workspace: ${project.workspace_path}`)
        lines.push(`  index: ${project.index_path}`)
        lines.push(`  tasks: ${project.task_count}`)
        if (project.domain_tags.length > 0) {
            lines.push(`  tags: ${project.domain_tags.slice(0, 8).join(", ")}`)
        }
    }

    return lines.join("\n")
}

// Canonical per-item card body (everything between the header line and the
// metrics line). Shared by the local and global renderers AND by the recall
// metric, so the reported `recall_chars` equals the bytes actually emitted.
function renderRecallCardLines(item: Omit<MemoryRecallItem, "metrics">): string[] {
    const lines: string[] = []
    lines.push(`  recorded: ${item.created_at}`)
    if (item.updated_at !== item.created_at) lines.push(`  updated: ${item.updated_at}`)
    if (item.summary.goal) lines.push(`  goal: ${item.summary.goal}`)
    if (item.summary.last_completed_step) lines.push(`  last: ${item.summary.last_completed_step}`)
    if (item.summary.next_recommended_step) lines.push(`  next: ${item.summary.next_recommended_step}`)
    if (item.summary.recent_message) lines.push(`  recent: ${item.summary.recent_message}`)
    if (item.summary.resume_command) lines.push(`  resume: ${item.summary.resume_command}`)
    if (item.canonical_tags.length > 0) lines.push(`  canonical: ${item.canonical_tags.slice(0, 8).join(", ")}`)
    if (item.agent_tags.length > 0) lines.push(`  agent tags: ${item.agent_tags.slice(0, 8).join(", ")}`)
    if (item.semantic_refs.length > 0) {
        lines.push(`  refs: ${item.semantic_refs.slice(0, 6).map((ref) => `${ref.kind}:${ref.name}`).join(", ")}`)
    }
    if (item.projected_strata.length > 0) {
        lines.push(`  strata: ${item.projected_strata.slice(0, 4).map((stratum) => `${stratum.part}/${stratum.name}(${stratum.nodes.length}/${stratum.node_count})`).join(", ")}`)
    }
    if (item.projected_anchors.length > 0) {
        lines.push(`  anchors: ${item.projected_anchors.slice(0, 4).map(renderProjectedAnchor).join(" | ")}`)
    }
    if (item.decisions.length > 0) {
        lines.push(`  decisions: ${item.decisions.slice(0, 3).map((decision) => decision.summary).join(" | ")}`)
    }
    if (item.invalidated) {
        if (item.recall_mode === "history") {
            lines.push(`  history: query matched invalidated hypothesis (${item.invalidated_match_count} terms; score boost ${item.invalidated_score_boost})`)
        } else {
            lines.push(`  warning: query matched invalidated hypothesis (${item.invalidated_match_count} terms; score penalty ${item.invalidated_score_penalty})`)
        }
    }
    if (item.invalidated_hypotheses.length > 0) {
        lines.push(`  invalidated: ${item.invalidated_hypotheses.slice(0, 3).map((hypothesis) => hypothesis.hypothesis).join(" | ")}`)
    }
    if (item.commands.length > 0) {
        lines.push(`  commands: ${item.commands.slice(0, 3).map((command) => command.command).join(" | ")}`)
    }
    if (item.truncated) {
        lines.push("  truncated: bounded recall card; use --profile full --json to hydrate exact evidence and graph")
    }
    lines.push(`  evidence: ${item.evidence_refs.length} refs in ${item.pack_path}`)
    if (item.full_evidence) {
        lines.push(`  full evidence: ${item.full_evidence.length} exact items hydrated; use --json to inspect`)
    }
    if (item.full_graph) {
        lines.push(`  full graph: ${item.full_graph.strata.length} strata, ${item.full_graph.nodes.length} nodes, ${item.full_graph.anchors.length} anchors hydrated; use --json to inspect`)
    }
    return lines
}

// Characters of the rendered text card an agent actually consumes (header +
// body). This is what `recall_chars` measures, so the savings figure is honest.
// Exported so the soundness suite can assert recall_chars == emitted card bytes.
export function renderRecallCardChars(item: Omit<MemoryRecallItem, "metrics">): number {
    const header = `- ${item.task_id}: ${item.title} (score ${item.score})`
    return [header, renderMemoryFreshnessLine(item), ...renderRecallCardLines(item), ...renderMemoryScoreExplanationLines(item)].join("\n").length
}

export function renderMemoryRecall(result: MemoryRecallResult): string {
    const lines = [`Axiom memory recall (profile ${result.profile}, mode ${result.mode}):`]

    if (result.results.length === 0) {
        lines.push(result.no_strong_match
            ? `    <no strong match; threshold score ${result.strong_match_min_score}>`
            : "    <empty>")
        return lines.join("\n")
    }

    for (const item of result.results) {
        lines.push(`- ${item.task_id}: ${item.title} (score ${item.score})`)
        lines.push(renderMemoryFreshnessLine(item))
        lines.push(...renderRecallCardLines(item))
        lines.push(...renderMemoryScoreExplanationLines(item))
        lines.push(`  metrics: source ${item.metrics.raw_evidence_chars} chars -> card ${item.metrics.recall_chars} chars; saved ~${item.metrics.estimated_context_tokens_saved} tokens (${Math.round(item.metrics.estimated_context_savings_ratio * 100)}%)`)
    }

    lines.push(`Total estimated saved tokens: ${result.metrics.estimated_context_tokens_saved}`)

    return lines.join("\n")
}

export function renderGlobalMemoryRecall(result: GlobalMemoryRecallResult): string {
    const lines = [`Axiom global memory recall (profile ${result.profile}, mode ${result.mode}):`]

    if (result.results.length === 0) {
        lines.push(result.no_strong_match
            ? `    <no strong match; threshold score ${result.strong_match_min_score}>`
            : "    <empty>")
        return lines.join("\n")
    }

    for (const item of result.results) {
        lines.push(`- ${item.project_id}/${item.task_id}: ${item.title} (score ${item.score})`)
        lines.push(`  project: ${item.project_title}; storage: ${item.storage}; visibility: ${item.visibility}; agent: ${item.agent_scope}`)
        lines.push(renderMemoryFreshnessLine(item))
        lines.push(...renderRecallCardLines(item))
        lines.push(...renderMemoryScoreExplanationLines(item))
        lines.push(`  workspace: ${item.workspace_path}`)
        lines.push(`  metrics: source ${item.metrics.raw_evidence_chars} chars -> card ${item.metrics.recall_chars} chars; saved ~${item.metrics.estimated_context_tokens_saved} tokens (${Math.round(item.metrics.estimated_context_savings_ratio * 100)}%)`)
    }

    lines.push(`Total estimated saved tokens: ${result.metrics.estimated_context_tokens_saved}`)

    return lines.join("\n")
}

function renderMemoryFreshnessLine(item: Pick<MemoryRecallItem, "age_days" | "freshness" | "source_scope">): string {
    const scope = item.source_scope ? `; source scope: ${item.source_scope}` : ""
    const verify = item.freshness === "old" ? "; verify against files/sources" : ""
    return `  freshness: ${item.freshness}; age ${item.age_days}d${scope}${verify}`
}

function renderMemoryScoreExplanationLines(item: Pick<MemoryRecallItem, "score_explanation">): string[] {
    const explanation = item.score_explanation
    if (!explanation) return []
    const lines = [
        `  score: matched [${explanation.matched_terms.join(", ") || "<none>"}]; unmatched [${explanation.unmatched_terms.join(", ") || "<none>"}]`
    ]
    for (const component of explanation.components.slice(0, 10)) {
        const detail = component.detail ? ` (${component.detail})` : ""
        lines.push(`    - ${component.name}: ${component.score}${detail}`)
    }
    return lines
}

export function renderSessionMemoryList(result: SessionMemoryListResult): string {
    const lines = ["Axiom session memory sessions:"]

    if (result.sessions.length === 0) {
        lines.push("    <empty>")
        return lines.join("\n")
    }

    for (const session of result.sessions) {
        lines.push(`- ${session.session_id}: ${session.event_count} events, updated ${session.updated_at}`)
        for (const message of session.recent_messages.slice(-3)) {
            lines.push(`  recent ${message.role}: ${message.summary}`)
        }
        lines.push(`  index: ${session.index_path}`)
    }

    return lines.join("\n")
}

export function renderSessionMemoryAppend(result: SessionMemoryAppendResult): string {
    return [
        `Session memory appended: ${result.session_id}/${result.event_id}`,
        `  sequence: ${result.sequence}`,
        `  chunk: ${result.chunk_path}`,
        `  index: ${result.index_path}`,
        `  anchors: ${result.anchor_count}; evidence ${result.evidence_chars} chars -> ${result.compressed_bytes} bytes`
    ].join("\n")
}

export function renderSessionMemoryRecall(result: SessionMemoryRecallResult): string {
    const lines = [`Axiom session memory recall (profile ${result.profile}${result.session_id ? `, session ${result.session_id}` : ""}):`]

    if (result.recent_messages.length > 0) {
        lines.push("Recent messages:")
        for (const message of result.recent_messages) {
            lines.push(`- ${message.role}: ${message.summary}`)
        }
    }

    if (result.results.length === 0) {
        lines.push("Events:")
        lines.push("    <empty>")
        return lines.join("\n")
    }

    lines.push("Events:")
    for (const item of result.results) {
        lines.push(`- #${item.sequence} ${item.event_id} ${item.kind}: ${item.title} (score ${item.score})`)
        lines.push(`  summary: ${item.summary}`)
        if (item.command) lines.push(`  command: ${item.command}`)
        if (item.status) lines.push(`  status: ${item.status}`)
        if (item.files.length > 0) lines.push(`  files: ${item.files.slice(0, 6).join(", ")}`)
        if (item.anchors.length > 0) {
            lines.push(`  anchors: ${item.anchors.slice(0, 6).map(renderSessionAnchor).join(" | ")}`)
        }
        if (item.evidence_preview) lines.push(`  preview: ${item.evidence_preview}`)
        if (item.truncated) lines.push("  truncated: compact session card; use --profile focused or --full/--include-evidence for exact text")
        if (item.full_evidence) lines.push(`  full evidence: ${item.full_evidence.length} items hydrated; use --json to inspect`)
        lines.push(`  chunk: ${item.chunk_path}`)
    }

    lines.push(`Total estimated saved tokens: ${result.metrics.estimated_context_tokens_saved}`)
    return lines.join("\n")
}

function renderSessionAnchor(anchor: SessionMemoryAnchor): string {
    return `${anchor.type} ${compactMemoryLabel(anchor.from)} -> ${compactMemoryLabel(anchor.to)}`
}

function renderProjectedAnchor(anchor: MemoryProjectedAnchor): string {
    const from = compactMemoryLabel(anchor.from_title ?? anchor.from)
    const to = compactMemoryLabel(anchor.to_title ?? anchor.to)
    const status = anchor.status === "active" ? "" : `:${anchor.status}`
    return `${anchor.type}${status} ${from} -> ${to}`
}

function compactMemoryLabel(value: string): string {
    return value.length > 64 ? `${value.slice(0, 61)}...` : value
}

function collectEvidence(
    cwd: string,
    taskId: string,
    context: AgentContext | undefined,
    history: ContextHistoryEntry[],
    sessionLog: SessionLogEntry[]
): MemoryEvidence[] {
    const evidence: MemoryEvidence[] = []

    if (context) {
        evidence.push({
            id: "context",
            kind: "context",
            path: normalizePath(path.join(axiomDir, "context.axctx.json")),
            summary: `Latest context for module ${context.module}`,
            data: context
        })
    }

    const relatedHistory = context
        ? history.filter((entry) => entry.module === context.module || entry.current_goal.includes(taskId) || entry.last_completed_step.includes(taskId))
        : history.filter((entry) => entry.current_goal.includes(taskId) || entry.last_completed_step.includes(taskId))
    if (relatedHistory.length > 0) {
        evidence.push({
            id: "context_history",
            kind: "context_history",
            path: normalizePath(path.join(axiomDir, "context-history.axctx.json")),
            summary: `${relatedHistory.length} related context history entries`,
            data: relatedHistory.slice(-20)
        })
    }

    const relatedSession = sessionLog.filter((entry) => sessionEntryMatches(entry, taskId, context))
    if (relatedSession.length > 0) {
        evidence.push({
            id: "session_log",
            kind: "session_log",
            path: normalizePath(path.join(axiomDir, "session.axlog.jsonl")),
            summary: `${relatedSession.length} related session log entries`,
            data: relatedSession.slice(-50)
        })
    }

    evidence.push(...readRelatedCheckpointEvidence(cwd, taskId, context))
    return evidence
}

function mergeEvidence(previous: MemoryEvidence[] | undefined, current: MemoryEvidence[]): MemoryEvidence[] {
    const byId = new Map<string, MemoryEvidence>()

    for (const item of previous ?? []) {
        byId.set(item.id, item)
    }

    for (const item of current) {
        byId.set(item.id, mergeEvidenceItem(byId.get(item.id), item))
    }

    return boundMemoryEvidence([...byId.values()])
}

function mergeEvidenceItem(previous: MemoryEvidence | undefined, current: MemoryEvidence): MemoryEvidence {
    if (!previous) return current
    if (current.kind === "context") return current

    if (Array.isArray(previous.data) && Array.isArray(current.data)) {
        const merged = uniqueUnknownArray([...previous.data, ...current.data]).slice(-200)
        return {
            ...current,
            summary: current.summary.replace(/^\d+/, String(merged.length)),
            data: merged
        }
    }

    return current
}

function boundMemoryEvidence(evidence: MemoryEvidence[]): MemoryEvidence[] {
    return uniqueBy(evidence, (item) => item.id)
        .slice(-MEMORY_EVIDENCE_LIMIT)
        .map((item) => ({
            ...item,
            summary: compactMemoryLabel(item.summary),
            data: boundMemoryEvidenceData(item.data)
        }))
}

function boundMemoryEvidenceData(data: unknown): unknown {
    const json = stableJson(data)
    if (json.length <= MEMORY_EVIDENCE_DATA_CHAR_LIMIT) return data

    return {
        schema: "axiom.agent_memory_truncated_evidence.v0",
        original_json_chars: json.length,
        preview_json: json.slice(0, MEMORY_EVIDENCE_DATA_CHAR_LIMIT)
    }
}

function uniqueUnknownArray(values: unknown[]): unknown[] {
    const seen = new Set<string>()
    const out: unknown[] = []

    for (const value of values) {
        const key = stableJson(value)
        if (seen.has(key)) continue
        seen.add(key)
        out.push(value)
    }

    return out
}

function stableJson(value: unknown): string {
    return JSON.stringify(value)
}

function readRelatedCheckpointEvidence(cwd: string, taskId: string, context: AgentContext | undefined): MemoryEvidence[] {
    const evidence: MemoryEvidence[] = []
    const folders = [
        { kind: "work_checkpoint", dir: path.join(cwd, axiomDir, "work") },
        { kind: "patch_checkpoint", dir: path.join(cwd, axiomDir, "patches") },
        { kind: "context_checkpoint", dir: path.join(cwd, axiomDir, "checkpoints") }
    ]

    for (const folder of folders) {
        if (!fs.existsSync(folder.dir)) continue

        for (const fileName of fs.readdirSync(folder.dir).filter((name) => name.endsWith(".json")).sort()) {
            const filePath = path.join(folder.dir, fileName)
            const raw = fs.readFileSync(filePath, "utf8")
            if (!checkpointMatches(raw, taskId, context)) continue

            evidence.push({
                id: `${folder.kind}:${fileName}`,
                kind: folder.kind,
                path: normalizePath(path.relative(cwd, filePath)),
                summary: `${folder.kind} ${fileName}`,
                data: JSON.parse(raw) as unknown
            })
        }
    }

    return evidence
}

function collectRecentMemoryMessages(
    taskId: string,
    context: AgentContext | undefined,
    sessionLog: SessionLogEntry[],
    evidence: MemoryEvidence[]
): string[] {
    const evidenceMessages = evidence.flatMap((item) => extractEvidenceDataMessages(item))
    const sessionMessages = sessionLog
        .filter((entry) => sessionEntryMatches(entry, taskId, context))
        .map((entry) => entry.summary)

    return uniqueStringsByLastOccurrence([
        ...evidenceMessages,
        ...sessionMessages
    ]).slice(-50)
}

function extractEvidenceMessages(item: MemoryEvidence): string[] {
    return [item.summary, ...extractEvidenceDataMessages(item)]
}

function extractEvidenceDataMessages(item: MemoryEvidence): string[] {
    const messages: string[] = []
    collectSummaryFields(item.data, messages)
    const latestChange = latestLastChangeSummary(item.data)
    if (latestChange) messages.push(latestChange)
    return messages
}

function latestLastChangeSummary(value: unknown): string | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
    const record = value as Record<string, unknown>
    if (!Array.isArray(record.last_changes)) return undefined
    const latest = record.last_changes[0]
    if (!latest || typeof latest !== "object" || Array.isArray(latest)) return undefined
    const summary = (latest as Record<string, unknown>).summary
    return typeof summary === "string" ? summary : undefined
}

function collectSummaryFields(value: unknown, messages: string[]): void {
    if (Array.isArray(value)) {
        for (const item of value) collectSummaryFields(item, messages)
        return
    }

    if (!value || typeof value !== "object") return
    const record = value as Record<string, unknown>
    if (typeof record.summary === "string") messages.push(record.summary)

    for (const child of Object.values(record)) {
        if (child && typeof child === "object") collectSummaryFields(child, messages)
    }
}

function collectAgentTags(input: {
    previous: AgentMemoryPack | undefined
    inputTags: string[]
    context: AgentContext | undefined
    semanticRefs: MemorySemanticRef[]
    recentMessages: string[]
}): string[] {
    return uniqueStrings([
        ...packAgentTags(input.previous),
        ...input.inputTags.map(normalizeTag),
        input.context?.module ? normalizeTag(input.context.module) : undefined,
        input.context?.target ? normalizeTag(input.context.target) : undefined,
        ...input.semanticRefs.flatMap((ref) => [normalizeTag(ref.kind), normalizeTag(ref.name)]),
        ...input.recentMessages.flatMap(extractInlineTags)
    ]).slice(-200)
}

function collectCanonicalTags(agentTags: string[]): string[] {
    return uniqueStrings(agentTags.map((tag) => CANONICAL_TAG_ALIASES[tag])).slice(-80)
}

function extractInlineTags(message: string): string[] {
    const tags: string[] = []
    for (const match of message.matchAll(/(?:tags?|agent_tags?)\s*[:=]\s*([A-Za-z0-9_. ,;/-]+)/gi)) {
        tags.push(...uniqueStrings((match[1] ?? "").split(/[,\s;]+/).map(normalizeTag)))
    }
    return tags
}

function collectInvalidatedHypotheses(input: {
    previous: AgentMemoryPack | undefined
    explicit: MemoryInvalidatedHypothesis[]
    messages: string[]
}): MemoryInvalidatedHypothesis[] {
    const parsed = input.messages.flatMap(parseInvalidatedHypothesesFromMessage)
    return uniqueBy([
        ...packInvalidatedHypotheses(input.previous),
        ...input.explicit.map((item) => ({
            ...item,
            hypothesis: item.hypothesis.trim(),
            reason: item.reason?.trim(),
            next_better_hypothesis: item.next_better_hypothesis?.trim(),
            invalidated_by: item.invalidated_by.length > 0 ? item.invalidated_by : ["capture_option"],
            source: item.source ?? "capture_option" as const
        })).filter((item) => item.hypothesis),
        ...parsed
    ], (item) => `${item.hypothesis.toLowerCase()}:${item.reason?.toLowerCase() ?? ""}`).slice(-100)
}

function parseInvalidatedHypothesesFromMessage(message: string): MemoryInvalidatedHypothesis[] {
    const patterns = [
        /hypothesis\s+invalidated\s*[:=-]\s*([^.\n]+)/gi,
        /invalidated\s+hypothesis\s*[:=-]\s*([^.\n]+)/gi,
        /hypoth[eè]se\s+invalid[ée]e?\s*[:=-]\s*([^.\n]+)/gi,
        /hypothese\s+invalidee\s*[:=-]\s*([^.\n]+)/gi,
        /fausse\s+piste\s*[:=-]\s*([^.\n]+)/gi
    ]
    const out: MemoryInvalidatedHypothesis[] = []

    for (const pattern of patterns) {
        for (const match of message.matchAll(pattern)) {
            const parsed = parseInvalidatedHypothesisBody(match[1], message)
            if (parsed) out.push(parsed)
        }
    }

    return out
}

function parseInvalidatedHypothesisBody(body: string, sourceMessage: string): MemoryInvalidatedHypothesis | undefined {
    const parts = body.split(/\s*;\s*/).map((part) => part.trim()).filter(Boolean)
    const hypothesis = parts.shift()?.replace(/^(hypothesis|hypoth[eè]se)\s*[:=-]\s*/i, "").trim()
    if (!hypothesis) return undefined

    let reason: string | undefined
    let nextBetterHypothesis: string | undefined
    for (const part of parts) {
        if (/^(reason|raison|because|car)\s*[:=-]/i.test(part)) {
            reason = part.replace(/^(reason|raison|because|car)\s*[:=-]\s*/i, "").trim()
        } else if (/^(next|next better hypothesis|prochaine|meilleure piste)\s*[:=-]/i.test(part)) {
            nextBetterHypothesis = part.replace(/^(next|next better hypothesis|prochaine|meilleure piste)\s*[:=-]\s*/i, "").trim()
        }
    }

    return {
        hypothesis,
        reason,
        invalidated_by: [`message:${sourceMessage.slice(0, 120)}`],
        next_better_hypothesis: nextBetterHypothesis,
        source: "evidence"
    }
}

function defaultResumeCommand(taskId: string): string {
    return `node dist/cli.js memory recall --task ${taskId}`
}

function packCanonicalTags(pack: AgentMemoryPack | undefined): string[] {
    if (!pack) return []
    return Array.isArray(pack.task.canonical_tags) ? pack.task.canonical_tags : collectCanonicalTags(pack.task.tags ?? [])
}

function packAgentTags(pack: AgentMemoryPack | undefined): string[] {
    if (!pack) return []
    return Array.isArray(pack.task.agent_tags) ? pack.task.agent_tags : uniqueStrings((pack.task.tags ?? []).map(normalizeTag))
}

function packInvalidatedHypotheses(pack: AgentMemoryPack | undefined): MemoryInvalidatedHypothesis[] {
    return Array.isArray(pack?.invalidated_hypotheses) ? pack.invalidated_hypotheses : []
}

function packMemoryStrata(pack: AgentMemoryPack | undefined): MemoryStratum[] {
    return Array.isArray(pack?.strata) ? pack.strata : []
}

function packGraphNodes(pack: AgentMemoryPack | undefined): MemoryGraphNode[] {
    return Array.isArray(pack?.nodes) ? pack.nodes : []
}

function packMemoryAnchors(pack: AgentMemoryPack | undefined): MemoryAnchor[] {
    return Array.isArray(pack?.anchors) ? pack.anchors : []
}

function normalizeIngestSummary(summary: MemoryIngestDocument["summary"]): Partial<AgentMemoryPack["summary"]> {
    if (typeof summary === "string") {
        return {
            recent_message: summary,
            resume_prompt: summary
        }
    }
    if (!summary || typeof summary !== "object" || Array.isArray(summary)) return {}
    return {
        goal: typeof summary.goal === "string" ? summary.goal : undefined,
        last_completed_step: typeof summary.last_completed_step === "string" ? summary.last_completed_step : undefined,
        next_recommended_step: typeof summary.next_recommended_step === "string" ? summary.next_recommended_step : undefined,
        resume_prompt: typeof summary.resume_prompt === "string" ? summary.resume_prompt : undefined,
        recent_message: typeof summary.recent_message === "string" ? summary.recent_message : undefined,
        resume_command: typeof summary.resume_command === "string" ? summary.resume_command : undefined
    }
}

function normalizeIngestDecisions(decisions: (MemoryDecision | string)[]): MemoryDecision[] {
    return decisions
        .map((decision) => {
            if (typeof decision === "string") {
                return {
                    kind: "agent_note",
                    summary: decision
                }
            }
            return {
                kind: decision.kind || "agent_note",
                node: decision.node,
                summary: decision.summary,
                reason: decision.reason
            }
        })
        .filter((decision) => decision.summary)
}

function normalizeIngestCommands(commands: (MemoryCommandEvidence | string)[]): MemoryCommandEvidence[] {
    return commands
        .map((command) => {
            if (typeof command === "string") {
                return {
                    command,
                    source: "agent_ingest" as const
                }
            }
            return {
                command: command.command,
                status: command.status,
                summary: command.summary,
                source: command.source ?? "agent_ingest"
            }
        })
        .filter((command) => command.command)
}

function normalizeIngestInvalidatedHypotheses(hypotheses: MemoryInvalidatedHypothesis[]): MemoryInvalidatedHypothesis[] {
    const normalized: MemoryInvalidatedHypothesis[] = []
    for (const item of hypotheses) {
        const hypothesis = item.hypothesis?.trim()
        if (!hypothesis) continue
        normalized.push({
            hypothesis,
            reason: item.reason?.trim(),
            next_better_hypothesis: item.next_better_hypothesis?.trim(),
            invalidated_by: item.invalidated_by?.length > 0 ? item.invalidated_by : ["agent_ingest"],
            source: item.source ?? "agent_ingest"
        })
    }
    return normalized
}

function invalidatedHypothesesFromGraph(graph: { nodes: MemoryGraphNode[]; anchors: MemoryAnchor[] }): MemoryInvalidatedHypothesis[] {
    const byId = new Map(graph.nodes.map((node) => [node.id, node]))
    const hypotheses: MemoryInvalidatedHypothesis[] = []

    for (const node of graph.nodes) {
        if (node.status !== "invalidated") continue
        const hypothesis = node.title.trim()
        if (!hypothesis) continue
        hypotheses.push({
            hypothesis,
            reason: node.summary?.trim(),
            invalidated_by: uniqueStrings([node.id, ...(node.evidence_refs ?? [])]),
            source: "agent_ingest"
        })
    }

    for (const anchor of graph.anchors) {
        if (anchor.type !== "invalidates") continue
        const fromNode = byId.get(anchor.from)
        const toNode = byId.get(anchor.to)
        const hypothesis = (fromNode?.title ?? anchor.from).trim()
        if (!hypothesis) continue
        hypotheses.push({
            hypothesis,
            reason: anchor.summary?.trim() || (toNode ? `Invalidates ${toNode.title}` : undefined),
            invalidated_by: uniqueStrings([anchor.id, ...(anchor.evidence_refs ?? [])]),
            next_better_hypothesis: toNode && toNode.id !== fromNode?.id ? toNode.title : undefined,
            source: "agent_ingest"
        })
    }

    return uniqueBy(hypotheses, invalidatedHypothesisKey).slice(-160)
}

function invalidatedHypothesisKey(item: MemoryInvalidatedHypothesis): string {
    return item.hypothesis.trim().toLowerCase()
}

function normalizeIngestEvidence(taskId: string, document: MemoryIngestDocument): MemoryEvidence[] {
    const exactIngest: MemoryEvidence = {
        id: `agent_ingest:${shortHash(JSON.stringify(document))}`,
        kind: "agent_ingest",
        summary: `Conscious agent memory ingest for ${taskId}`,
        data: document
    }
    const provided = (document.evidence ?? []).map((item) => {
        const kind = item.kind || "agent_note"
        const summary = item.summary || item.path || kind
        return {
            id: item.id || `${kind}:${shortHash(`${summary}\n${JSON.stringify(item.data ?? {})}`)}`,
            kind,
            path: item.path,
            summary,
            data: item.data ?? summary
        }
    })
    return [exactIngest, ...provided]
}

function normalizeIngestGraph(taskId: string, part: string, document: MemoryIngestDocument): {
    strata: MemoryStratum[]
    nodes: MemoryGraphNode[]
    anchors: MemoryAnchor[]
} {
    const defaultStratum: MemoryStratum = {
        id: graphId("stratum", taskId, part, "agent_ingest", "agent"),
        part,
        name: "agent_ingest",
        kind: "agent",
        node_ids: [],
        score_hints: uniqueStrings([part, "agent_ingest", "agent"])
    }
    const strata = new Map<string, MemoryStratum>([[defaultStratum.id, defaultStratum]])
    for (const item of document.strata ?? []) {
        const name = item.name || item.id || "agent_ingest"
        const kind = item.kind || "agent"
        const id = item.id || graphId("stratum", taskId, part, name, kind)
        strata.set(id, {
            id,
            part: item.part || part,
            name,
            kind,
            node_ids: uniqueStrings(item.node_ids ?? []),
            score_hints: uniqueStrings([...(item.score_hints ?? []), item.part, name, kind])
        })
    }

    const nodes = new Map<string, MemoryGraphNode>()
    const addNodeToStratum = (node: MemoryGraphNode): void => {
        if (!strata.has(node.stratum)) {
            strata.set(node.stratum, {
                id: node.stratum,
                part: node.part,
                name: node.stratum,
                kind: "agent",
                node_ids: [],
                score_hints: uniqueStrings([node.part, node.stratum])
            })
        }
        const stratum = strata.get(node.stratum)
        if (stratum && !stratum.node_ids.includes(node.id)) {
            stratum.node_ids.push(node.id)
        }
    }

    for (const item of document.nodes ?? []) {
        const title = item.title || item.summary || item.id || "ingested node"
        const kind = item.kind || "agent_note"
        const id = item.id || graphId("node", taskId, part, kind, title)
        const stratum = item.stratum || defaultStratum.id
        const node: MemoryGraphNode = {
            id,
            part: item.part || part,
            stratum,
            kind,
            title,
            summary: item.summary,
            status: normalizeGraphNodeStatus(item.status),
            trust_tier: normalizeTrustTier(item.trust_tier, normalizeGraphNodeStatus(item.status)),
            tags: uniqueStrings(item.tags ?? []),
            semantic_refs: (item.semantic_refs ?? []).filter((ref) => ref.kind && ref.name),
            evidence_refs: uniqueStrings(item.evidence_refs ?? []),
            score_hints: uniqueStrings([...(item.score_hints ?? []), title, item.summary, kind])
        }
        nodes.set(id, node)
        addNodeToStratum(node)
    }

    const anchors = new Map<string, MemoryAnchor>()
    for (const item of document.anchors ?? []) {
        const type = item.type || "relates_to"
        const from = item.from
        const to = item.to
        if (!from || !to) continue
        const anchor: MemoryAnchor = {
            id: item.id || graphId("anchor", taskId, type, from, to, item.summary ?? ""),
            type,
            from,
            to,
            status: normalizeAnchorStatus(item.status),
            summary: item.summary,
            evidence_refs: uniqueStrings(item.evidence_refs ?? []),
            score_hints: uniqueStrings([...(item.score_hints ?? []), type, from, to, item.summary]),
            weight: typeof item.weight === "number" ? item.weight : EXPLICIT_ANCHOR_DEFAULT_WEIGHT
        }
        anchors.set(anchor.id, anchor)
        for (const endpoint of [from, to]) {
            if (nodes.has(endpoint)) continue
            const node: MemoryGraphNode = {
                id: endpoint,
                part,
                stratum: defaultStratum.id,
                kind: "anchor_endpoint",
                title: endpoint,
                status: "active",
                trust_tier: "hypothesis",
                score_hints: [endpoint]
            }
            nodes.set(endpoint, node)
            addNodeToStratum(node)
        }
    }

    return {
        strata: [...strata.values()].map((stratum) => ({
            ...stratum,
            node_ids: uniqueStrings(stratum.node_ids),
            score_hints: uniqueStrings(stratum.score_hints)
        })),
        nodes: [...nodes.values()],
        anchors: [...anchors.values()]
    }
}

function normalizeGraphNodeStatus(status: string | undefined): MemoryGraphNodeStatus {
    return status === "invalidated" || status === "stale" || status === "speculative" ? status : "active"
}

function normalizeTrustTier(tier: string | undefined, status: MemoryGraphNodeStatus): MemoryTrustTier {
    if (status === "invalidated") return "invalidated"
    if (tier === "proved" || tier === "contracted" || tier === "hypothesis") return tier
    return status === "speculative" ? "hypothesis" : "contracted"
}

function normalizeAnchorStatus(status: string | undefined): MemoryAnchorStatus {
    return status === "invalidated" || status === "stale" || status === "speculative" ? status : "active"
}

function mergeMemoryStrata(...groups: (MemoryStratum[] | undefined)[]): MemoryStratum[] {
    const byId = new Map<string, MemoryStratum>()
    for (const group of groups) {
        for (const item of group ?? []) {
            const previous = byId.get(item.id)
            byId.set(item.id, previous ? {
                ...previous,
                ...item,
                node_ids: uniqueStrings([...(previous.node_ids ?? []), ...(item.node_ids ?? [])]),
                score_hints: uniqueStrings([...(previous.score_hints ?? []), ...(item.score_hints ?? [])])
            } : {
                ...item,
                node_ids: uniqueStrings(item.node_ids ?? []),
                score_hints: uniqueStrings(item.score_hints ?? [])
            })
        }
    }
    return [...byId.values()].slice(-400)
}

function mergeGraphNodes(...groups: (MemoryGraphNode[] | undefined)[]): MemoryGraphNode[] {
    const byId = new Map<string, MemoryGraphNode>()
    for (const group of groups) {
        for (const item of group ?? []) {
            const previous = byId.get(item.id)
            byId.set(item.id, previous ? {
                ...previous,
                ...item,
                tags: uniqueStrings([...(previous.tags ?? []), ...(item.tags ?? [])]),
                semantic_refs: uniqueBy([...(previous.semantic_refs ?? []), ...(item.semantic_refs ?? [])], (ref) => `${ref.kind}:${ref.name}`),
                evidence_refs: uniqueStrings([...(previous.evidence_refs ?? []), ...(item.evidence_refs ?? [])]),
                score_hints: uniqueStrings([...(previous.score_hints ?? []), ...(item.score_hints ?? [])])
            } : {
                ...item,
                tags: uniqueStrings(item.tags ?? []),
                semantic_refs: uniqueBy(item.semantic_refs ?? [], (ref) => `${ref.kind}:${ref.name}`),
                evidence_refs: uniqueStrings(item.evidence_refs ?? []),
                score_hints: uniqueStrings(item.score_hints ?? [])
            })
        }
    }
    return [...byId.values()].slice(-600)
}

function mergeMemoryAnchors(...groups: (MemoryAnchor[] | undefined)[]): MemoryAnchor[] {
    const byId = new Map<string, MemoryAnchor>()
    for (const group of groups) {
        for (const item of group ?? []) {
            const previous = byId.get(item.id)
            byId.set(item.id, previous ? {
                ...previous,
                ...item,
                evidence_refs: uniqueStrings([...(previous.evidence_refs ?? []), ...(item.evidence_refs ?? [])]),
                score_hints: uniqueStrings([...(previous.score_hints ?? []), ...(item.score_hints ?? [])]),
                weight: Math.max(normalizedAnchorWeight(previous), normalizedAnchorWeight(item)) || undefined
            } : {
                ...item,
                evidence_refs: uniqueStrings(item.evidence_refs ?? []),
                score_hints: uniqueStrings(item.score_hints ?? [])
            })
        }
    }
    return [...byId.values()].slice(-800)
}

function buildMemoryGraph(pack: AgentMemoryPack): {
    strata: MemoryStratum[]
    nodes: MemoryGraphNode[]
    anchors: MemoryAnchor[]
} {
    const part = selectMemoryGraphPart(pack)
    const strata = new Map<string, MemoryStratum>()
    const nodes = new Map<string, MemoryGraphNode>()
    const anchors = new Map<string, MemoryAnchor>()

    const addStratum = (name: string, kind: string): MemoryStratum => {
        const id = graphId("stratum", pack.task.id, part, name, kind)
        const existing = strata.get(id)
        if (existing) return existing

        const stratum: MemoryStratum = {
            id,
            part,
            name,
            kind,
            node_ids: [],
            score_hints: uniqueStrings([part, name, kind])
        }
        strata.set(id, stratum)
        return stratum
    }

    const addNode = (input: {
        stratum_name: string
        stratum_kind: string
        kind: string
        title: string
        summary?: string
        status?: MemoryGraphNodeStatus
        trust_tier?: MemoryTrustTier
        tags?: string[]
        semantic_refs?: MemorySemanticRef[]
        evidence_refs?: string[]
        score_hints?: (string | undefined)[]
    }): MemoryGraphNode => {
        const stratum = addStratum(input.stratum_name, input.stratum_kind)
        const id = graphId("node", pack.task.id, part, input.stratum_name, input.kind, input.title, input.summary ?? "")
        const previous = nodes.get(id)
        const node: MemoryGraphNode = previous ? {
            ...previous,
            tags: uniqueStrings([...(previous.tags ?? []), ...(input.tags ?? [])]),
            semantic_refs: uniqueBy([...(previous.semantic_refs ?? []), ...(input.semantic_refs ?? [])], (ref) => `${ref.kind}:${ref.name}`),
            evidence_refs: uniqueStrings([...(previous.evidence_refs ?? []), ...(input.evidence_refs ?? [])]),
            score_hints: uniqueStrings([...(previous.score_hints ?? []), ...(input.score_hints ?? [])])
        } : {
            id,
            part,
            stratum: stratum.id,
            kind: input.kind,
            title: input.title,
            summary: input.summary,
            status: input.status ?? "active",
            trust_tier: input.trust_tier ?? normalizeTrustTier(undefined, input.status ?? "active"),
            tags: uniqueStrings(input.tags ?? []),
            semantic_refs: input.semantic_refs,
            evidence_refs: uniqueStrings(input.evidence_refs ?? []),
            score_hints: uniqueStrings([
                part,
                input.stratum_name,
                input.stratum_kind,
                input.kind,
                input.title,
                ...compactIndexTextSignals(input.summary),
                ...(input.tags ?? []),
                ...(input.score_hints ?? []),
                ...(input.semantic_refs ?? []).flatMap((ref) => [ref.kind, ref.name])
            ])
        }

        nodes.set(id, node)
        if (!stratum.node_ids.includes(id)) stratum.node_ids.push(id)
        stratum.score_hints = uniqueStrings([
            ...stratum.score_hints,
            input.title,
            ...compactIndexTextSignals(input.summary),
            ...(input.tags ?? []),
            ...(input.score_hints ?? [])
        ]).slice(-80)
        return node
    }

    const addAnchor = (input: {
        type: MemoryAnchorType | string
        from: string
        to: string
        status?: MemoryAnchorStatus
        summary?: string
        evidence_refs?: string[]
        score_hints?: (string | undefined)[]
        weight?: number
    }): MemoryAnchor | undefined => {
        if (input.from === input.to) return undefined
        const id = graphId("anchor", pack.task.id, input.type, input.from, input.to, input.summary ?? "")
        const previous = anchors.get(id)
        const anchor: MemoryAnchor = previous ? {
            ...previous,
            evidence_refs: uniqueStrings([...(previous.evidence_refs ?? []), ...(input.evidence_refs ?? [])]),
            score_hints: uniqueStrings([...(previous.score_hints ?? []), ...(input.score_hints ?? [])])
        } : {
            id,
            type: input.type,
            from: input.from,
            to: input.to,
            status: input.status ?? "active",
            summary: input.summary,
            evidence_refs: uniqueStrings(input.evidence_refs ?? []),
            score_hints: uniqueStrings([
                input.type,
                ...compactIndexTextSignals(input.summary),
                ...(input.evidence_refs ?? []),
                ...(input.score_hints ?? [])
            ]),
            weight: input.weight
        }
        anchors.set(id, anchor)
        return anchor
    }

    const summaryText = uniqueStrings([
        pack.summary.goal,
        pack.summary.last_completed_step,
        pack.summary.next_recommended_step,
        pack.summary.recent_message,
        pack.summary.resume_command
    ]).join(" | ")
    const contextEvidenceRefs = evidenceIdsByKind(pack.evidence, ["context", "context_history", "session_log", "context_checkpoint"])
    const summaryNode = addNode({
        stratum_name: "context",
        stratum_kind: "summary",
        kind: "summary",
        title: pack.task.title,
        summary: summaryText || pack.task.title,
        tags: pack.task.tags,
        semantic_refs: pack.semantic_refs.slice(0, 20),
        evidence_refs: contextEvidenceRefs,
        score_hints: [pack.task.id, pack.task.title]
    })

    const semanticNodes = new Map<string, MemoryGraphNode>()
    for (const ref of pack.semantic_refs.slice(-120)) {
        const node = addNode({
            stratum_name: "semantic",
            stratum_kind: "semantic_ref",
            kind: ref.kind,
            title: `${ref.kind}:${ref.name}`,
            summary: `Semantic reference ${ref.kind}:${ref.name}`,
            semantic_refs: [ref],
            score_hints: [ref.kind, ref.name]
        })
        semanticNodes.set(`${ref.kind}:${ref.name}`.toLowerCase(), node)
        addAnchor({
            type: "relates_to",
            from: summaryNode.id,
            to: node.id,
            summary: `Task summary references ${ref.kind}:${ref.name}`,
            score_hints: [ref.kind, ref.name]
        })
    }

    for (const decision of pack.decisions.slice(-100)) {
        const title = decision.node ? `${decision.kind}:${decision.node}` : decision.kind
        const node = addNode({
            stratum_name: "decisions",
            stratum_kind: "decision",
            kind: decision.kind,
            title,
            summary: decision.summary,
            semantic_refs: decision.node ? [{ kind: decision.kind, name: decision.node }] : undefined,
            evidence_refs: contextEvidenceRefs,
            score_hints: ["decision", decision.node, decision.reason]
        })
        addAnchor({
            type: "relates_to",
            from: summaryNode.id,
            to: node.id,
            summary: decision.summary,
            evidence_refs: contextEvidenceRefs,
            score_hints: [decision.kind, decision.node, decision.reason]
        })

        if (decision.node) {
            const semanticNode = semanticNodes.get(`${decision.kind}:${decision.node}`.toLowerCase()) ?? semanticNodes.get(`behavior:${decision.node}`.toLowerCase())
            if (semanticNode) {
                addAnchor({
                    type: "relates_to",
                    from: node.id,
                    to: semanticNode.id,
                    summary: `Decision touches ${semanticNode.title}`,
                    evidence_refs: contextEvidenceRefs,
                    score_hints: [decision.node, semanticNode.title]
                })
            }
        }
    }

    for (const command of pack.commands.slice(-100)) {
        const commandEvidenceRefs = command.source === "context_test_run"
            ? evidenceIdsByKind(pack.evidence, ["context"])
            : evidenceIdsByKind(pack.evidence, ["session_log"])
        const node = addNode({
            stratum_name: "commands",
            stratum_kind: "command",
            kind: "command",
            title: command.command,
            summary: command.summary ?? command.status,
            evidence_refs: commandEvidenceRefs,
            score_hints: [command.status, command.source]
        })
        addAnchor({
            type: "reproduced_by",
            from: summaryNode.id,
            to: node.id,
            summary: command.summary ?? command.command,
            evidence_refs: commandEvidenceRefs,
            score_hints: [command.command, command.status]
        })
    }

    for (const action of pack.next_actions.slice(-80)) {
        const node = addNode({
            stratum_name: "next_actions",
            stratum_kind: "next_action",
            kind: "next_action",
            title: action,
            summary: action,
            evidence_refs: contextEvidenceRefs,
            score_hints: [action]
        })
        addAnchor({
            type: "depends_on",
            from: summaryNode.id,
            to: node.id,
            summary: `Next action for ${pack.task.id}`,
            evidence_refs: contextEvidenceRefs,
            score_hints: [action]
        })
    }

    if (pack.summary.resume_command) {
        const node = addNode({
            stratum_name: "resume",
            stratum_kind: "resume_command",
            kind: "resume_command",
            title: pack.summary.resume_command,
            summary: `Recommended resume command for ${pack.task.id}`,
            evidence_refs: contextEvidenceRefs,
            score_hints: [pack.summary.resume_command]
        })
        addAnchor({
            type: "resumes",
            from: summaryNode.id,
            to: node.id,
            summary: `Resume ${pack.task.id}`,
            evidence_refs: contextEvidenceRefs,
            score_hints: [pack.summary.resume_command]
        })
    }

    for (const hypothesis of packInvalidatedHypotheses(pack).slice(-80)) {
        const node = addNode({
            stratum_name: "invalidated",
            stratum_kind: "invalidated_hypothesis",
            kind: "invalidated_hypothesis",
            title: hypothesis.hypothesis,
            summary: hypothesis.reason,
            status: "invalidated",
            evidence_refs: contextEvidenceRefs,
            score_hints: [hypothesis.hypothesis, hypothesis.reason, hypothesis.next_better_hypothesis, ...hypothesis.invalidated_by]
        })
        addAnchor({
            type: "invalidates",
            from: node.id,
            to: summaryNode.id,
            summary: hypothesis.reason ?? `Invalidated hypothesis for ${pack.task.id}`,
            evidence_refs: contextEvidenceRefs,
            score_hints: [hypothesis.hypothesis, hypothesis.reason, hypothesis.next_better_hypothesis]
        })

        if (hypothesis.next_better_hypothesis) {
            const nextNode = addNode({
                stratum_name: "next_actions",
                stratum_kind: "next_action",
                kind: "next_hypothesis",
                title: hypothesis.next_better_hypothesis,
                summary: `Better hypothesis after invalidating: ${hypothesis.hypothesis}`,
                evidence_refs: contextEvidenceRefs,
                score_hints: [hypothesis.next_better_hypothesis]
            })
            addAnchor({
                type: "supersedes",
                from: nextNode.id,
                to: node.id,
                summary: `Better hypothesis supersedes invalidated path`,
                evidence_refs: contextEvidenceRefs,
                score_hints: [hypothesis.next_better_hypothesis, hypothesis.hypothesis]
            })
        }
    }

    for (const item of pack.evidence.slice(-160)) {
        const node = addNode({
            stratum_name: "evidence",
            stratum_kind: "exact_evidence",
            kind: item.kind,
            title: item.summary,
            summary: item.path,
            evidence_refs: [item.id],
            score_hints: ["exact_evidence", item.id, item.kind, item.path, item.summary, ...extractEvidenceMessages(item)]
        })
        addAnchor({
            type: "evidenced_by",
            from: summaryNode.id,
            to: node.id,
            summary: item.summary,
            evidence_refs: [item.id],
            score_hints: [item.id, item.kind, item.path]
        })

        const evidenceText = JSON.stringify(item).toLowerCase()
        for (const semanticNode of semanticNodes.values()) {
            const semanticTitleParts = semanticNode.title.split(":")
            const semanticName = semanticTitleParts[semanticTitleParts.length - 1]?.toLowerCase() ?? ""
            if (evidenceText.includes(semanticNode.title.toLowerCase()) || evidenceText.includes(semanticName)) {
                addAnchor({
                    type: "evidenced_by",
                    from: semanticNode.id,
                    to: node.id,
                    summary: `${semanticNode.title} is evidenced by ${item.id}`,
                    evidence_refs: [item.id],
                    score_hints: [semanticNode.title, item.id, item.summary]
                })
            }
        }
    }

    return {
        strata: [...strata.values()].map((stratum) => ({
            ...stratum,
            node_ids: uniqueStrings(stratum.node_ids).slice(0, 240),
            score_hints: uniqueStrings(stratum.score_hints).slice(-80)
        })),
        nodes: [...nodes.values()].slice(-240),
        anchors: [...anchors.values()].slice(-320)
    }
}

function selectMemoryGraphPart(pack: AgentMemoryPack): string {
    const canonical = packCanonicalTags(pack)
    const preferred = ["bevy", "memory", "compiler", "runtime", "graphics", "physics", "frontend", "backend", "semantic", "storage", "game"]
    return preferred.find((tag) => canonical.includes(tag)) ?? canonical[0] ?? packAgentTags(pack)[0] ?? normalizeTag(pack.task.id) ?? "task"
}

function evidenceIdsByKind(evidence: MemoryEvidence[], kinds: string[]): string[] {
    const wanted = new Set(kinds)
    return evidence.filter((item) => wanted.has(item.kind)).map((item) => item.id)
}

function graphId(prefix: string, ...parts: string[]): string {
    return `${prefix}:${shortHash(parts.join("\u001f"))}`
}

function shortHash(text: string): string {
    let hash = 2166136261
    for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index)
        hash = Math.imul(hash, 16777619)
    }
    return (hash >>> 0).toString(36)
}

function shortBufferHash(bytes: Buffer | Uint8Array): string {
    let hash = 2166136261
    for (const byte of bytes) {
        hash ^= byte
        hash = Math.imul(hash, 16777619)
    }
    return (hash >>> 0).toString(36)
}

function collectCommands(context: AgentContext | undefined, sessionLog: SessionLogEntry[], taskId: string): MemoryCommandEvidence[] {
    const commands: MemoryCommandEvidence[] = []

    for (const test of context?.test_runs ?? []) {
        commands.push({
            command: test.command,
            status: test.status,
            summary: test.summary,
            source: "context_test_run"
        })
    }

    for (const entry of sessionLog.filter((item) => sessionEntryMatches(item, taskId, context))) {
        for (const command of entry.commands ?? []) {
            commands.push({
                command,
                status: entry.status,
                summary: entry.summary,
                source: "session_log"
            })
        }
    }

    return uniqueBy(commands, (command) => `${command.source}:${command.command}`)
}

function collectDecisions(context: AgentContext | undefined): MemoryDecision[] {
    return (context?.last_changes ?? []).map((change) => ({
        kind: change.kind,
        node: change.node,
        summary: change.summary,
        reason: change.reason
    }))
}

function collectSemanticRefs(context: AgentContext | undefined, evidence: MemoryEvidence[]): MemorySemanticRef[] {
    const refs = [...(context?.active_semantic_nodes ?? [])]

    for (const item of evidence) {
        collectRefsFromUnknown(item.data, refs)
    }

    return uniqueBy(refs.filter((ref) => ref.kind && ref.name), (ref) => `${ref.kind}:${ref.name}`)
}

function collectRefsFromUnknown(value: unknown, refs: MemorySemanticRef[]): void {
    if (Array.isArray(value)) {
        for (const item of value) collectRefsFromUnknown(item, refs)
        return
    }

    if (!value || typeof value !== "object") return
    const record = value as Record<string, unknown>

    const kind = typeof record.kind === "string" ? record.kind : undefined
    const name = typeof record.name === "string" ? record.name : typeof record.node === "string" ? record.node : undefined
    if (kind && name) refs.push({ kind, name })

    for (const child of Object.values(record)) {
        if (child && typeof child === "object") collectRefsFromUnknown(child, refs)
    }
}

function memoryIndexEntry(pack: AgentMemoryPack, packPath: string): AgentMemoryIndexEntry {
    const canonicalTags = packCanonicalTags(pack)
    const agentTags = packAgentTags(pack)
    const invalidatedHypotheses = packInvalidatedHypotheses(pack)
    const invalidatedScoreHints = invalidatedHypothesesScoreHints(invalidatedHypotheses)
    const graph = effectiveMemoryGraph(pack)
    const strata = graph.strata
    const graphNodes = graph.nodes
    const anchors = graph.anchors
    const strataRefs = memoryStrataRefs(strata)
    const anchorHints = memoryAnchorHints(anchors, graphNodes)
    const strataPreviews = memoryStrataPreviews(strata, graphNodes)
    const anchorRefs = memoryAnchorPreviews(anchors, graphNodes)
    const graphHints = memoryGraphScoreHints(strata, graphNodes, anchors)
    const scoreHints = boundedIndexScoreHints([
        pack.task.id,
        pack.task.title,
        ...pack.task.tags,
        ...canonicalTags,
        ...agentTags,
        ...compactIndexTextSignals(pack.summary.goal),
        ...compactIndexTextSignals(pack.summary.last_completed_step),
        ...compactIndexTextSignals(pack.summary.next_recommended_step),
        ...compactIndexTextSignals(pack.summary.recent_message),
        pack.summary.resume_command,
        ...pack.semantic_refs.flatMap((ref) => [ref.kind, ref.name]),
        ...pack.decisions.flatMap((decision) => compactIndexTextSignals(decision.summary)),
        ...pack.commands.flatMap((command) => [
            command.command,
            ...compactIndexTextSignals(command.summary),
            command.status,
            command.source
        ]),
        ...invalidatedScoreHints,
        ...graphHints,
        ...pack.evidence.flatMap((item) => indexableEvidenceMessages(item))
    ])

    return {
        task_id: pack.task.id,
        title: pack.task.title,
        pack_path: normalizePath(packPath),
        created_at: pack.task.created_at,
        updated_at: pack.task.updated_at,
        tags: pack.task.tags,
        canonical_tags: canonicalTags,
        agent_tags: agentTags,
        semantic_refs: pack.semantic_refs.slice(-120),
        score_hints: scoreHints,
        invalidated_score_hints: invalidatedScoreHints.slice(-MEMORY_INDEX_INVALIDATED_HINT_LIMIT),
        strata_refs: strataRefs,
        anchor_hints: anchorHints,
        summary_preview: compactMemorySummaryPreview(pack.summary),
        decision_hints: newestFirst(pack.decisions, MEMORY_INDEX_DECISION_HINT_LIMIT).map(compactMemoryDecisionPreview),
        command_hints: newestFirst(pack.commands, MEMORY_INDEX_COMMAND_HINT_LIMIT).map(compactMemoryCommandPreview),
        next_action_hints: newestFirst(pack.next_actions, MEMORY_INDEX_NEXT_ACTION_HINT_LIMIT)
            .map((action) => compactMemoryText(action, MEMORY_INDEX_TEXT_PREVIEW_CHAR_LIMIT)),
        invalidated_hypotheses: newestFirst(invalidatedHypotheses, MEMORY_INDEX_INVALIDATED_HINT_LIMIT).map(compactMemoryInvalidatedPreview),
        evidence_refs: newestFirst(memoryEvidenceRefs(pack.evidence), MEMORY_INDEX_EVIDENCE_REF_LIMIT).map(compactMemoryEvidenceRefPreview),
        strata_previews: strataPreviews,
        anchor_refs: anchorRefs,
        raw_evidence_chars: jsonCharLength(pack.evidence),
        pack_json_chars: jsonCharLength(pack),
        evidence_count: pack.evidence.length,
        command_count: pack.commands.length,
        graph_node_count: graphNodes.length,
        anchor_count: anchors.length,
        invalidated_hypothesis_count: invalidatedHypotheses.length,
        resume_command: pack.summary.resume_command,
        source_scope: memoryPackSourceScope(pack)
    }
}

function newestFirst<T>(items: T[], limit: number): T[] {
    if (limit <= 0) return []
    return items.slice(Math.max(0, items.length - limit)).reverse()
}

function compactMemorySummaryPreview(summary: AgentMemoryPack["summary"]): AgentMemoryPack["summary"] {
    const preview: AgentMemoryPack["summary"] = {}
    for (const key of ["goal", "last_completed_step", "next_recommended_step", "resume_prompt", "recent_message", "resume_command"] as const) {
        const value = compactOptionalMemoryText(summary[key], MEMORY_INDEX_SUMMARY_PREVIEW_CHAR_LIMIT)
        if (value) preview[key] = value
    }
    return preview
}

function compactMemoryDecisionPreview(decision: MemoryDecision): MemoryDecision {
    return {
        ...decision,
        summary: compactMemoryText(decision.summary, MEMORY_INDEX_TEXT_PREVIEW_CHAR_LIMIT),
        node: compactOptionalMemoryText(decision.node, MEMORY_INDEX_TEXT_PREVIEW_CHAR_LIMIT),
        reason: compactOptionalMemoryText(decision.reason, MEMORY_INDEX_TEXT_PREVIEW_CHAR_LIMIT)
    }
}

function compactMemoryCommandPreview(command: MemoryCommandEvidence): MemoryCommandEvidence {
    return {
        ...command,
        command: compactMemoryText(command.command, MEMORY_INDEX_TEXT_PREVIEW_CHAR_LIMIT),
        status: compactOptionalMemoryText(command.status, MEMORY_INDEX_TEXT_PREVIEW_CHAR_LIMIT),
        summary: compactOptionalMemoryText(command.summary, MEMORY_INDEX_TEXT_PREVIEW_CHAR_LIMIT)
    }
}

function compactMemoryInvalidatedPreview(hypothesis: MemoryInvalidatedHypothesis): MemoryInvalidatedHypothesis {
    return {
        ...hypothesis,
        hypothesis: compactMemoryText(hypothesis.hypothesis, MEMORY_INDEX_TEXT_PREVIEW_CHAR_LIMIT),
        reason: compactOptionalMemoryText(hypothesis.reason, MEMORY_INDEX_TEXT_PREVIEW_CHAR_LIMIT),
        next_better_hypothesis: compactOptionalMemoryText(hypothesis.next_better_hypothesis, MEMORY_INDEX_TEXT_PREVIEW_CHAR_LIMIT),
        invalidated_by: hypothesis.invalidated_by.map((item) => compactMemoryText(item, MEMORY_INDEX_TEXT_PREVIEW_CHAR_LIMIT))
    }
}

function compactMemoryEvidenceRefPreview(ref: MemoryEvidenceRef): MemoryEvidenceRef {
    return {
        ...ref,
        path: compactOptionalMemoryText(ref.path, MEMORY_INDEX_TEXT_PREVIEW_CHAR_LIMIT),
        summary: compactMemoryText(ref.summary, MEMORY_INDEX_TEXT_PREVIEW_CHAR_LIMIT)
    }
}

function compactMemoryText(value: string, maxLength: number): string {
    const compact = value.replace(/\s+/g, " ").trim()
    if (compact.length <= maxLength) return compact
    return `${compact.slice(0, Math.max(0, maxLength - 3))}...`
}

function compactOptionalMemoryText(value: string | undefined, maxLength: number): string | undefined {
    if (value === undefined) return undefined
    const compact = compactMemoryText(value, maxLength)
    return compact.length > 0 ? compact : undefined
}

function memoryStrataRefs(strata: MemoryStratum[]): MemoryStratumRef[] {
    return strata.map((stratum) => ({
        id: stratum.id,
        part: stratum.part,
        name: stratum.name,
        kind: stratum.kind,
        node_count: stratum.node_ids.length
    }))
}

function memoryAnchorHints(anchors: MemoryAnchor[], nodes: MemoryGraphNode[]): string[] {
    const byId = new Map(nodes.map((node) => [node.id, node]))
    return boundedIndexScoreHints(anchors.flatMap((anchor) => {
        const from = byId.get(anchor.from)
        const to = byId.get(anchor.to)
        const exactEvidenceEndpoint = isExactEvidenceGraphNode(from) || isExactEvidenceGraphNode(to)
        if (exactEvidenceEndpoint) {
            return [anchor.type, anchor.status]
        }
        return [
            anchor.type,
            anchor.status,
            ...compactIndexTextSignals(anchor.summary),
            from?.title,
            to?.title,
            ...(anchor.score_hints ?? [])
        ]
    }), MEMORY_INDEX_ANCHOR_HINT_LIMIT)
}

function boundedIndexScoreHints(values: (string | undefined)[], limit = MEMORY_INDEX_SCORE_HINT_LIMIT): string[] {
    return uniqueStringsByLastOccurrence(values)
        .map((value) => compactMemoryLabel(value))
        .filter((value) => value.length > 0)
        .slice(-limit)
}

function compactIndexTextSignals(value: string | undefined): string[] {
    const text = (value ?? "").replace(/\s+/g, " ").trim()
    if (!text) return []
    if (text.length <= 64) return [text]

    const generic = new Set([
        "about", "agent", "agents", "card", "cards", "context", "data", "evidence",
        "file", "files", "fixed", "general", "index", "memory", "notes", "project",
        "quality", "query", "recall", "runtime", "semantic", "source", "summary",
        "test", "tests", "token", "tokens", "updated", "wrong"
    ])
    const identifiers = text.match(/[A-Za-z0-9][A-Za-z0-9_.:/-]{3,}/g) ?? []
    const lexical = queryTerms(text)
        .filter((term) => term.length >= 6 && !generic.has(term))
    return uniqueStrings([
        ...identifiers.filter((item) => item.length <= 96),
        ...lexical
    ]).slice(-28)
}

function indexableEvidenceMessages(item: MemoryEvidence): string[] {
    if (item.kind === "patch_checkpoint") return []
    return extractEvidenceMessages(item).flatMap(compactIndexTextSignals)
}

function isExactEvidenceGraphNode(node: MemoryGraphNode | undefined): boolean {
    return (node?.score_hints ?? []).includes("exact_evidence")
}

function memoryEvidenceRefs(evidence: MemoryEvidence[]): MemoryEvidenceRef[] {
    return evidence.map((item) => ({
        id: item.id,
        kind: item.kind,
        path: item.path,
        summary: item.summary
    }))
}

function memoryStrataPreviews(strata: MemoryStratum[], nodes: MemoryGraphNode[]): MemoryProjectedStratum[] {
    const byStratum = new Map<string, MemoryGraphNode[]>()
    for (const node of nodes) {
        const group = byStratum.get(node.stratum) ?? []
        group.push(node)
        byStratum.set(node.stratum, group)
    }

    return strata
        .map((stratum) => ({
            id: stratum.id,
            part: stratum.part,
            name: stratum.name,
            kind: stratum.kind,
            node_count: stratum.node_ids.length,
            nodes: (byStratum.get(stratum.id) ?? [])
                .sort((left, right) => graphNodeRank(left) - graphNodeRank(right) || left.title.localeCompare(right.title) || left.id.localeCompare(right.id))
                .slice(0, MEMORY_STRATA_PREVIEW_NODE_LIMIT)
                .map((node) => ({
                    id: node.id,
                    kind: node.kind,
                    title: compactMemoryLabel(node.title),
                    status: node.status,
                    evidence_refs: node.evidence_refs
                }))
        }))
        .filter((stratum) => stratum.nodes.length > 0)
        .sort((left, right) => graphStratumRank(left) - graphStratumRank(right) || left.name.localeCompare(right.name))
        .slice(0, MEMORY_INDEX_STRATA_PREVIEW_LIMIT)
}

function memoryAnchorPreviews(anchors: MemoryAnchor[], nodes: MemoryGraphNode[]): MemoryProjectedAnchor[] {
    const byId = new Map(nodes.map((node) => [node.id, node]))
    return anchors
        .filter((anchor) => byId.has(anchor.from) && byId.has(anchor.to))
        .sort((left, right) => normalizedAnchorWeight(right) - normalizedAnchorWeight(left) ||
            anchorTypePriority(right.type) - anchorTypePriority(left.type) ||
            left.type.localeCompare(right.type) ||
            left.id.localeCompare(right.id))
        .slice(0, MEMORY_INDEX_ANCHOR_REF_LIMIT)
        .map((anchor) => {
            const from = byId.get(anchor.from)
            const to = byId.get(anchor.to)
            return {
                id: anchor.id,
                type: anchor.type,
                from: anchor.from,
                from_title: from ? compactMemoryLabel(from.title) : undefined,
                to: anchor.to,
                to_title: to ? compactMemoryLabel(to.title) : undefined,
                status: anchor.status,
                summary: compactOptionalMemoryText(anchor.summary, MEMORY_INDEX_TEXT_PREVIEW_CHAR_LIMIT),
                evidence_refs: anchor.evidence_refs,
                weight: anchor.weight
            }
        })
}

function effectiveMemoryGraph(pack: AgentMemoryPack): {
    strata: MemoryStratum[]
    nodes: MemoryGraphNode[]
    anchors: MemoryAnchor[]
} {
    const strata = packMemoryStrata(pack)
    const nodes = packGraphNodes(pack)
    const anchors = packMemoryAnchors(pack)
    if (strata.length > 0 || nodes.length > 0 || anchors.length > 0) {
        return { strata, nodes, anchors }
    }
    return buildMemoryGraph(pack)
}

function memoryGraphScoreHints(strata: MemoryStratum[], nodes: MemoryGraphNode[], anchors: MemoryAnchor[]): string[] {
    return boundedIndexScoreHints([
        ...strata.flatMap((stratum) => stratum.kind === "exact_evidence"
            ? [stratum.part, stratum.name, stratum.kind]
            : [stratum.part, stratum.name, stratum.kind, ...stratum.score_hints]),
        ...nodes.flatMap((node) => graphNodeScoreHintsForIndex(node)),
        ...memoryAnchorHints(anchors, nodes)
    ])
}

function graphNodeScoreHintsForIndex(node: MemoryGraphNode): string[] {
    if (isExactEvidenceGraphNode(node)) {
        return [
            node.part,
            node.kind,
            node.status,
            ...(node.tags ?? []),
            ...(node.semantic_refs ?? []).flatMap((ref) => [ref.kind, ref.name])
        ].filter((value): value is string => !!value)
    }

    return [
        node.part,
        node.kind,
        node.title,
        ...compactIndexTextSignals(node.summary),
        node.status,
        ...(node.tags ?? []),
        ...(node.score_hints ?? []),
        ...(node.semantic_refs ?? []).flatMap((ref) => [ref.kind, ref.name])
    ].filter((value): value is string => !!value)
}

function upsertIndexEntry(index: AgentMemoryIndex, entry: AgentMemoryIndexEntry): AgentMemoryIndex {
    return {
        schema: "axiom.agent_memory_index.v0",
        version: 1,
        updated_at: new Date().toISOString(),
        entries: [
            ...index.entries.filter((item) => item.task_id !== entry.task_id),
            entry
        ].sort((left, right) => left.task_id.localeCompare(right.task_id))
    }
}

function resolveDeletableMemoryPackPath(cwd: string, packPath: string): string {
    const memoryRoot = path.resolve(cwd, axiomDir, memoryDir)
    const absolutePath = memoryPackAbsolutePath(cwd, packPath)
    const relativeFromMemoryRoot = path.relative(memoryRoot, absolutePath)
    const normalizedRelative = normalizePath(relativeFromMemoryRoot)
    if (relativeFromMemoryRoot === "" || relativeFromMemoryRoot.startsWith("..") || path.isAbsolute(relativeFromMemoryRoot)) {
        throw new Error(`memory delete refuses pack outside the active AXMEM memory directory: ${packPath}`)
    }
    if (normalizedRelative.startsWith("sessions/") || normalizedRelative.startsWith("search/")) {
        throw new Error(`memory delete refuses non-task memory path: ${packPath}`)
    }
    if (path.extname(absolutePath) !== ".axmem") {
        throw new Error(`memory delete refuses non-.axmem path: ${packPath}`)
    }
    return absolutePath
}

function writeMemoryIndex(cwd: string, index: AgentMemoryIndex): void {
    const filePath = path.join(cwd, axiomDir, memoryDir, indexFileName)
    writeMemoryIndexFile(filePath, index)
}

function writeMemoryIndexFile(filePath: string, index: AgentMemoryIndex): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    const raw = `${JSON.stringify(index, null, 2)}\n`
    fs.writeFileSync(filePath, raw, "utf8")
    updateMemoryIndexCache(filePath, raw, index)
}

function emptyMemoryIndex(): AgentMemoryIndex {
    return {
        schema: "axiom.agent_memory_index.v0",
        version: 1,
        updated_at: new Date(0).toISOString(),
        entries: []
    }
}

function rebuildMemoryIndexFromPackDirectory(basePath: string, relativePackDir: string): { index: AgentMemoryIndex; packCount: number } {
    const absolutePackDir = path.join(basePath, relativePackDir)
    const entries: AgentMemoryIndexEntry[] = []

    if (fs.existsSync(absolutePackDir)) {
        for (const fileName of fs.readdirSync(absolutePackDir).filter((item) => item.endsWith(".axmem")).sort()) {
            const packPath = path.join(relativePackDir, fileName)
            const absolutePackPath = path.join(basePath, packPath)
            let pack: AgentMemoryPack
            try {
                pack = readMemoryPackFileRepairing(absolutePackPath).pack
            } catch (error) {
                throw new Error(`axmem reindex: unable to read pack ${normalizePath(packPath)} (${error instanceof Error ? error.message : String(error)})`)
            }
            entries.push(memoryIndexEntry(pack, packPath))
        }
    }

    return {
        index: {
            schema: "axiom.agent_memory_index.v0",
            version: 1,
            updated_at: new Date().toISOString(),
            entries: entries.sort((left, right) => left.task_id.localeCompare(right.task_id))
        },
        packCount: entries.length
    }
}

function memoryReindexResult(reason: MemoryReindexResult["reason"], index: AgentMemoryIndex): MemoryReindexResult {
    return {
        schema: "axiom.agent_memory_reindex.v0",
        status: "ok",
        reason,
        index_path: normalizePath(path.join(axiomDir, memoryDir, indexFileName)),
        pack_count: index.entries.length,
        entry_count: index.entries.length,
        entries: index.entries.map((entry) => ({
            task_id: entry.task_id,
            title: entry.title,
            pack_path: entry.pack_path,
            graph_node_count: entry.graph_node_count ?? 0,
            anchor_count: entry.anchor_count ?? 0,
            invalidated_hypothesis_count: entry.invalidated_hypothesis_count ?? 0
        }))
    }
}

function gitChangedLineStats(cwd: string): Pick<MemoryHandoffGuardResult, "changed_lines" | "added_lines" | "deleted_lines" | "changed_file_count"> {
    const tracked = parseGitNumstat(gitOutput(cwd, ["diff", "--numstat", "HEAD", "--"]).stdout)
    const untracked = untrackedGitLineStats(cwd)
    return {
        changed_lines: tracked.changed_lines + untracked.changed_lines,
        added_lines: tracked.added_lines + untracked.added_lines,
        deleted_lines: tracked.deleted_lines,
        changed_file_count: tracked.changed_file_count + untracked.changed_file_count
    }
}

function parseGitNumstat(stdout: string): Pick<MemoryHandoffGuardResult, "changed_lines" | "added_lines" | "deleted_lines" | "changed_file_count"> {
    let added = 0
    let deleted = 0
    let files = 0
    for (const line of stdout.split(/\r?\n/)) {
        const [addRaw, deleteRaw] = line.split(/\t/)
        if (!addRaw || !deleteRaw) continue
        const add = Number(addRaw)
        const del = Number(deleteRaw)
        if (Number.isFinite(add)) added += add
        if (Number.isFinite(del)) deleted += del
        files += 1
    }
    return {
        changed_lines: added + deleted,
        added_lines: added,
        deleted_lines: deleted,
        changed_file_count: files
    }
}

function untrackedGitLineStats(cwd: string): Pick<MemoryHandoffGuardResult, "changed_lines" | "added_lines" | "changed_file_count"> {
    const output = gitOutput(cwd, ["ls-files", "--others", "--exclude-standard"])
    if (!output.ok) return { changed_lines: 0, added_lines: 0, changed_file_count: 0 }
    let added = 0
    let files = 0
    for (const relative of output.stdout.split(/\r?\n/).filter(Boolean)) {
        const absolute = path.resolve(cwd, relative)
        if (!absolute.toLowerCase().startsWith(path.resolve(cwd).toLowerCase())) continue
        if (!fs.existsSync(absolute) || fs.statSync(absolute).isDirectory()) continue
        files += 1
        const stat = fs.statSync(absolute)
        if (stat.size > 1_000_000) {
            added += Math.ceil(stat.size / 40)
            continue
        }
        try {
            const text = fs.readFileSync(absolute, "utf8")
            added += text.length === 0 ? 0 : text.split(/\r?\n/).length
        } catch {
            added += Math.ceil(stat.size / 40)
        }
    }
    return {
        changed_lines: added,
        added_lines: added,
        changed_file_count: files
    }
}

function recentMemoryHandoffTaskIds(cwd: string, sinceHours: number): string[] {
    const cutoff = Date.now() - sinceHours * 60 * 60 * 1000
    const index = readMemoryIndex(cwd)
    return index.entries
        .filter((entry) => {
            const updated = Date.parse(entry.updated_at)
            if (!Number.isFinite(updated) || updated < cutoff) return false
            const tags = new Set([...(entry.tags ?? []), ...(entry.agent_tags ?? []), ...(entry.canonical_tags ?? [])].map((tag) => tag.toLowerCase()))
            return tags.has("handoff")
        })
        .sort((left, right) => right.updated_at.localeCompare(left.updated_at))
        .map((entry) => entry.task_id)
}

function gitOutput(cwd: string, args: string[]): { ok: boolean; stdout: string } {
    const result = spawnSync("git", ["-C", cwd, ...args], {
        encoding: "utf8",
        maxBuffer: 2 * 1024 * 1024
    })
    return {
        ok: result.status === 0,
        stdout: typeof result.stdout === "string" ? result.stdout : ""
    }
}

function memoryIndexNeedsUpgrade(index: AgentMemoryIndex): boolean {
    return index.entries.some((entry) => (
        !Array.isArray(entry.invalidated_score_hints) ||
        !Array.isArray(entry.strata_refs) ||
        !Array.isArray(entry.anchor_hints) ||
        !entry.summary_preview ||
        !Array.isArray(entry.decision_hints) ||
        !Array.isArray(entry.command_hints) ||
        !Array.isArray(entry.next_action_hints) ||
        !Array.isArray(entry.invalidated_hypotheses) ||
        !Array.isArray(entry.evidence_refs) ||
        !Array.isArray(entry.strata_previews) ||
        !Array.isArray(entry.anchor_refs) ||
        typeof entry.raw_evidence_chars !== "number" ||
        typeof entry.pack_json_chars !== "number" ||
        typeof entry.graph_node_count !== "number" ||
        typeof entry.anchor_count !== "number" ||
        typeof entry.invalidated_hypothesis_count !== "number"
    ))
}

function readMemoryIndexFile(filePath: string): AgentMemoryIndex {
    const raw = readTextFileForIndexCache(filePath)
    const hash = shortHash(raw)
    const absolute = normalizePath(path.resolve(filePath))
    const stat = fs.statSync(filePath)
    const cached = memoryIndexCache.get(absolute)
    if (cached?.content_hash === hash) {
        return cached.index
    }

    let parsed: AgentMemoryIndex
    try {
        parsed = JSON.parse(raw) as AgentMemoryIndex
    } catch (error) {
        throw new Error(`axmem index: unable to read index JSON (${error instanceof Error ? error.message : String(error)})`)
    }
    if (parsed.schema !== "axiom.agent_memory_index.v0" || parsed.version !== 1 || !Array.isArray(parsed.entries)) {
        throw new Error("axmem index: unsupported or invalid index schema")
    }
    memoryIndexCache.set(absolute, {
        file_path: normalizePath(filePath),
        content_hash: hash,
        mtime_ms: stat.mtimeMs,
        size: stat.size,
        generation: memoryIndexGeneration,
        index: parsed
    })
    return parsed
}

function readTextFileForIndexCache(filePath: string): string {
    return fs.readFileSync(filePath, "utf8")
}

function updateMemoryIndexCache(filePath: string, raw: string, index: AgentMemoryIndex): void {
    const absolute = normalizePath(path.resolve(filePath))
    const stat = fs.statSync(filePath)
    const hash = shortHash(raw)
    memoryIndexGeneration += 1
    memoryIndexCache.set(absolute, {
        file_path: normalizePath(filePath),
        content_hash: hash,
        mtime_ms: stat.mtimeMs,
        size: stat.size,
        generation: memoryIndexGeneration,
        index
    })
    memoryIndexHashCache.set(absolute, {
        file_path: normalizePath(filePath),
        mtime_ms: stat.mtimeMs,
        size: stat.size,
        hash: hashMemoryIndex(index)
    })
}

function readProjectMemoryIndex(project: AgentMemoryProjectEntry): AgentMemoryIndex {
    const index = readMemoryIndexFile(project.index_path)
    if (!memoryIndexNeedsUpgrade(index)) {
        return index
    }

    const relativePackDir = project.storage === "copied" ? "packs" : path.join(axiomDir, memoryDir)
    const rebuilt = rebuildMemoryIndexFromPackDirectory(project.pack_base_path, relativePackDir)
    writeMemoryIndexFile(project.index_path, rebuilt.index)
    return rebuilt.index
}

function resolveMemoryHome(memoryHome?: string): string {
    return path.resolve(memoryHome ?? process.env.AXMEM_MEMORY_HOME ?? process.env.AXIOM_MEMORY_HOME ?? path.join(os.homedir(), ".axmem"))
}

function globalRegistryPath(memoryHome: string): string {
    return path.join(memoryHome, "registry.axmem.json")
}

function emptyMemoryRegistry(): AgentMemoryRegistry {
    return {
        schema: "axiom.agent_memory_registry.v0",
        version: 1,
        updated_at: new Date(0).toISOString(),
        projects: []
    }
}

function writeGlobalMemoryRegistry(memoryHome: string, registry: AgentMemoryRegistry): void {
    const filePath = globalRegistryPath(memoryHome)
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, `${JSON.stringify(registry, null, 2)}\n`, "utf8")
}

function upsertRegistryProject(registry: AgentMemoryRegistry, project: AgentMemoryProjectEntry): AgentMemoryRegistry {
    return {
        schema: "axiom.agent_memory_registry.v0",
        version: 1,
        updated_at: new Date().toISOString(),
        projects: [
            ...registry.projects.filter((item) => item.project_id !== project.project_id),
            project
        ].sort((left, right) => left.project_id.localeCompare(right.project_id))
    }
}

function refreshAttachedGlobalProjectForWorkspace(cwd: string): void {
    try {
        const memoryHome = resolveMemoryHome()
        const registry = readGlobalMemoryRegistry(memoryHome)
        const workspacePath = normalizePath(path.resolve(cwd))
        const project = registry.projects.find((item) =>
            item.storage === "attached" &&
            normalizePath(path.resolve(item.workspace_path)).toLowerCase() === workspacePath.toLowerCase()
        )
        if (!project) return

        const indexPath = path.join(cwd, axiomDir, memoryDir, indexFileName)
        if (!fs.existsSync(indexPath)) return
        const index = readMemoryIndex(cwd)
        const updated = upsertRegistryProject(registry, {
            ...project,
            workspace_path: workspacePath,
            index_path: normalizePath(indexPath),
            pack_base_path: normalizePath(path.resolve(cwd)),
            score_hints: projectScoreHints(project.project_id, project.title, project.domain_tags, index),
            task_count: index.entries.length,
            updated_at: new Date().toISOString()
        })
        writeGlobalMemoryRegistry(memoryHome, updated)
    } catch {
        // Local memory writes must not fail because the optional global registry
        // is absent, locked, or temporarily malformed.
    }
}

// Patch-checkpoint paths (`.axpatch.json`, `patch_checkpoint:...`) accumulate by
// the dozen and flood a project's score hints, diluting the ranking signal.
// They carry no recall value, so keep them out of the aggregated project hints.
function isNoiseScoreHint(hint: string): boolean {
    return hint.includes(".axpatch.json")
        || hint.startsWith("patch_checkpoint")
        || hint.includes("/patches/")
        || hint.includes("\\patches\\")
}

function projectScoreHints(projectId: string, title: string, domainTags: string[], index: AgentMemoryIndex): string[] {
    return uniqueStrings([
        projectId,
        title,
        ...domainTags,
        ...index.entries.flatMap((entry) => [
            entry.task_id,
            entry.title,
            ...entry.tags,
            ...(entry.canonical_tags ?? []),
            ...(entry.agent_tags ?? []),
            entry.resume_command ?? "",
            ...entry.score_hints,
            ...entry.semantic_refs.flatMap((ref) => [ref.kind, ref.name])
        ])
    ].filter((hint) => hint.length > 0 && !isNoiseScoreHint(hint))).slice(-500)
}

function scoreProject(project: AgentMemoryProjectEntry, input: { projectId?: string; query?: string }): number {
    if (input.projectId && project.project_id === normalizeProjectId(input.projectId)) {
        return 100
    }

    const query = (input.query ?? "").trim().toLowerCase()
    if (!query) return 0

    const terms = query.split(/\s+/).filter(Boolean)
    const haystack = [
        project.project_id,
        project.title,
        project.workspace_path,
        project.visibility,
        project.agent_scope,
        ...project.domain_tags,
        ...project.score_hints
    ].join("\n").toLowerCase()
    let score = 0

    for (const term of terms) {
        if (project.project_id.toLowerCase() === term) score += 30
        if (project.domain_tags.some((tag) => tag.toLowerCase() === term)) score += 15
        if (haystack.includes(term)) score += 3
    }

    return score
}

function memoryFileRefScore(entry: AgentMemoryIndexEntry, filePath: string | undefined): number {
    const needle = normalizeMemoryFilePath(filePath)
    if (!needle) return 0
    const needleBase = path.posix.basename(needle)
    const needleTail = memoryFileTail(needle, 2)
    let best = 0

    for (const ref of entry.semantic_refs) {
        if (normalizeTag(ref.kind) !== "file") continue
        const candidate = normalizeMemoryFilePath(ref.name)
        if (!candidate) continue
        const candidateBase = path.posix.basename(candidate)
        const candidateTail = memoryFileTail(candidate, 2)

        if (candidate === needle) best = Math.max(best, 220)
        else if (candidate.endsWith(`/${needle}`) || needle.endsWith(`/${candidate}`)) best = Math.max(best, 180)
        else if (candidateTail && candidateTail === needleTail) best = Math.max(best, 145)
        else if (candidateBase && candidateBase === needleBase) best = Math.max(best, 72)
    }

    return best
}

function memoryFileTail(filePath: string, segmentCount: number): string {
    const segments = filePath.split("/").filter(Boolean)
    return segments.slice(-segmentCount).join("/")
}

function normalizeMemoryFilePath(filePath: string | undefined): string {
    if (!filePath) return ""
    return normalizePath(filePath)
        .trim()
        .replace(/^file:/i, "")
        .replace(/^\.\//, "")
        .replace(/\/+/g, "/")
        .toLowerCase()
}

function dedupeGlobalMemoryResults(results: GlobalMemoryRecallItem[]): GlobalMemoryRecallItem[] {
    const byWorkspaceTask = new Map<string, GlobalMemoryRecallItem>()
    for (const item of results) {
        const key = `${normalizePath(path.resolve(item.workspace_path)).toLowerCase()}::${item.task_id}`
        const previous = byWorkspaceTask.get(key)
        if (!previous || shouldPreferGlobalMemoryResult(item, previous)) {
            byWorkspaceTask.set(key, item)
        }
    }
    return [...byWorkspaceTask.values()]
}

function shouldPreferGlobalMemoryResult(candidate: GlobalMemoryRecallItem, current: GlobalMemoryRecallItem): boolean {
    const candidateStorage = globalMemoryStoragePreference(candidate.storage)
    const currentStorage = globalMemoryStoragePreference(current.storage)
    if (candidateStorage !== currentStorage) return candidateStorage > currentStorage
    if (candidate.score !== current.score) return candidate.score > current.score
    return candidate.project_id.localeCompare(current.project_id) < 0
}

function globalMemoryStoragePreference(storage: AgentMemoryProjectStorage): number {
    return storage === "attached" ? 2 : storage === "copied" ? 1 : 0
}

function scoreEntry(entry: AgentMemoryIndexEntry, input: { taskId?: string; query?: string; file?: string; mode?: MemoryRecallMode }): number {
    if (input.taskId) {
        return entry.task_id === normalizeTaskId(input.taskId) ? 1000 : 0
    }

    const fileScore = memoryFileRefScore(entry, input.file)
    const rawQuery = (input.query ?? "").trim()
    const query = rawQuery.toLowerCase()
    if (!query) {
        if (input.file) return fileScore
        return entry.updated_at ? 1 : 0
    }

    if (memoryMutationActive("ignore_query_terms")) {
        return entry.updated_at ? 1 : 0
    }

    const normalizedText = (value: string | undefined): string => (value ?? "").toLowerCase()
    const compactText = (value: string | undefined): string => normalizedText(value).replace(/[^a-z0-9]+/g, "")
    const splitCamel = (value: string): string => value.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    const stemTerm = (term: string): string => {
        if (term.length <= 4) return term
        if (term.endsWith("ies")) return `${term.slice(0, -3)}y`
        if (term.endsWith("ing") && term.length > 6) return term.slice(0, -3)
        if (term.endsWith("ed") && term.length > 5) return term.slice(0, -2)
        if (term.endsWith("es") && term.length > 5) return term.slice(0, -2)
        if (term.endsWith("s") && term.length > 5) return term.slice(0, -1)
        return term
    }
    const lexicalTerms = (value: string | undefined): string[] => uniqueStrings([
        ...queryTerms(value),
        ...queryTerms(splitCamel(value ?? "")),
        ...queryTerms(compactText(value)),
        ...queryTerms(value).map(stemTerm)
    ]).filter((term) => term.length > 0)
    const terms = uniqueStrings([
        ...lexicalTerms(rawQuery),
        ...queryTerms(query).map(stemTerm)
    ]).filter((term) => term.length > 0)
    let score = 0
    const includeIndexHints = !memoryMutationActive("ignore_score_hints")
    const strataHints = includeIndexHints ? (entry.strata_refs ?? []).flatMap((stratum) => [stratum.part, stratum.name, stratum.kind]) : []
    const anchorHints = includeIndexHints ? entry.anchor_hints ?? [] : []
    const strataHaystack = strataHints.join("\n").toLowerCase()
    const anchorHaystack = anchorHints.join("\n").toLowerCase()
    const scoreHints = includeIndexHints ? entry.score_hints : []
    const titleTerms = new Set(lexicalTerms(entry.title))
    const taskTerms = new Set(lexicalTerms(entry.task_id))
    const tagTerms = new Set(lexicalTerms([
        ...entry.tags,
        ...(entry.canonical_tags ?? []),
        ...(entry.agent_tags ?? [])
    ].join(" ")))
    const semanticTerms = new Set(lexicalTerms(entry.semantic_refs.flatMap((ref) => [ref.kind, ref.name]).join(" ")))
    const strataTerms = new Set(lexicalTerms(strataHints.join(" ")))
    const anchorTerms = new Set(lexicalTerms(anchorHints.join(" ")))
    const scoreHintTerms = new Set(lexicalTerms(scoreHints.join(" ")))
    const summaryTerms = new Set(lexicalTerms(Object.values(entry.summary_preview ?? {}).join(" ")))
    const titleCompact = compactText(entry.title)
    const taskCompact = compactText(entry.task_id)
    const tagCompact = compactText([
        ...entry.tags,
        ...(entry.canonical_tags ?? []),
        ...(entry.agent_tags ?? [])
    ].join(" "))
    const semanticCompact = compactText(entry.semantic_refs.flatMap((ref) => [ref.kind, ref.name]).join(" "))
    const hintCompact = compactText(scoreHints.join(" "))
    const currentHaystack = [
        entry.task_id,
        entry.title,
        ...entry.tags,
        ...(entry.canonical_tags ?? []),
        ...(entry.agent_tags ?? []),
        entry.resume_command ?? "",
        ...Object.values(entry.summary_preview ?? {}),
        ...entry.semantic_refs.flatMap((ref) => [ref.kind, ref.name])
    ].join("\n").toLowerCase()
    const haystack = [
        currentHaystack,
        ...scoreHints,
        ...strataHints,
        ...anchorHints
    ].join("\n").toLowerCase()
    const genericTerms = new Set([
        "agent",
        "asset",
        "assets",
        "cache",
        "card",
        "cards",
        "data",
        "file",
        "files",
        "fixed",
        "format",
        "general",
        "index",
        "memory",
        "metric",
        "note",
        "notes",
        "quality",
        "query",
        "recall",
        "runtime",
        "saved",
        "semantic",
        "source",
        "test",
        "tests",
        "token",
        "tokens",
        "wrong"
    ])
    const stopTerms = new Set(["a", "an", "and", "de", "du", "for", "in", "la", "le", "of", "on", "or", "the", "then", "to"])
    const termWeight = (term: string): number => {
        if (stopTerms.has(term)) return 0
        let weight = genericTerms.has(term) ? 0.65 : 1
        if (term.length >= 14) weight += 0.9
        else if (term.length >= 9) weight += 0.45
        if (/\d/.test(term)) weight += 0.55
        if (["axmem", "forgekit", "cityruntime", "local", "sfz", "sfasset", "sfskin", "pbrflat"].includes(term)) weight += 0.45
        return weight
    }
    const compactTermMatches = (haystackText: string, term: string): boolean => {
        const compactTerm = compactText(term)
        return compactTerm.length >= 4 && haystackText.includes(compactTerm)
    }
    const containsTerm = (text: string, term: string): boolean => text.includes(term) || compactTermMatches(compactText(text), term)
    const ownerCanonical = (owner: string): string => owner.startsWith("forgekit") ? "forgekit" : owner
    const ownerTermsFrom = (value: string): Set<string> => {
        const compact = compactText(value)
        const owners = new Set<string>()
        if (compact.includes("forgekit")) owners.add("forgekit")
        if (compact.includes("cityruntime")) owners.add("cityruntime")
        if (compact.includes("axmem")) owners.add("axmem")
        if (compact.includes("axiom")) owners.add("axiom")
        if (/(^|[^a-z0-9])local([^a-z0-9]|$)/.test(normalizedText(value)) || compact.startsWith("local3b")) owners.add("local")
        return owners
    }
    const compatibleOwner = (queryOwner: string, entryOwner: string): boolean => {
        const left = ownerCanonical(queryOwner)
        const right = ownerCanonical(entryOwner)
        if (left === right) return true
        return (left === "axmem" && right === "axiom") || (left === "axiom" && right === "axmem")
    }
    const primaryOwner = (): string | undefined => {
        const task = compactText(entry.task_id)
        const title = normalizedText(entry.title)
        for (const owner of ["local", "forgekit", "cityruntime", "axmem", "axiom"]) {
            if (task.startsWith(owner) || title.startsWith(owner)) return owner
        }
        for (const tag of [...entry.tags, ...(entry.canonical_tags ?? []), ...(entry.agent_tags ?? [])]) {
            const owners = [...ownerTermsFrom(tag)]
            if (owners.length > 0) return owners[0]
        }
        return undefined
    }
    const queryOwners = ownerTermsFrom(rawQuery)
    const entryOwner = primaryOwner()
    const ownerMatched = entryOwner ? [...queryOwners].some((owner) => compatibleOwner(owner, entryOwner)) : false
    const titleTaskTagText = [
        entry.task_id,
        entry.title,
        ...entry.tags,
        ...(entry.canonical_tags ?? []),
        ...(entry.agent_tags ?? [])
    ].join(" ")
    const titleTaskTagOwners = ownerTermsFrom(titleTaskTagText)
    let titleTaskTagMatchCount = 0
    let currentFieldMatchCount = 0
    let hintOnlyMatchCount = 0
    let titleMatchCount = 0
    let taskMatchCount = 0

    if (terms.length === 1) {
        const term = terms[0]
        if (termWeight(term) > 0 && (
            titleTerms.has(term) ||
            taskTerms.has(term) ||
            tagTerms.has(term) ||
            semanticTerms.has(term) ||
            strataTerms.has(term) ||
            anchorTerms.has(term)
        )) {
            score += 30
        }
    }

    for (const term of terms) {
        const weight = termWeight(term)
        if (weight === 0) continue
        let termScore = 0
        const titleMatch = titleTerms.has(term) || compactTermMatches(titleCompact, term)
        const taskMatch = taskTerms.has(term) || compactTermMatches(taskCompact, term)
        const tagMatch = tagTerms.has(term) || compactTermMatches(tagCompact, term)
        const semanticMatch = semanticTerms.has(term) || compactTermMatches(semanticCompact, term)
        const strataMatch = strataTerms.has(term) || strataHaystack.includes(term)
        const anchorMatch = anchorTerms.has(term) || anchorHaystack.includes(term)
        const scoreHintMatch = scoreHintTerms.has(term) || compactTermMatches(hintCompact, term)
        const summaryMatch = summaryTerms.has(term)
        const currentMatch = titleMatch || taskMatch || tagMatch || semanticMatch || summaryMatch || containsTerm(currentHaystack, term)

        if (taskMatch) {
            termScore += 34 * weight
            taskMatchCount++
            titleTaskTagMatchCount++
        }
        if (titleMatch) {
            termScore += 28 * weight
            titleMatchCount++
            titleTaskTagMatchCount++
        }
        if (tagMatch) {
            termScore += 22 * weight
            titleTaskTagMatchCount++
        }
        if (semanticMatch) termScore += 14 * weight
        if (summaryMatch) termScore += 8 * weight
        if (strataMatch) termScore += 8 * weight
        if (anchorMatch) termScore += 9 * weight
        if (scoreHintMatch) termScore += Math.min(12, 7 * weight)
        if (containsTerm(haystack, term)) termScore += genericTerms.has(term) ? 2 * weight : 4 * weight

        if (currentMatch) currentFieldMatchCount++
        if (!currentMatch && scoreHintMatch) hintOnlyMatchCount++
        score += Math.min(termScore, genericTerms.has(term) ? 32 : 58)
    }

    const meaningfulTermCount = terms.filter((term) => termWeight(term) > 0).length
    if (titleMatchCount >= 2) score += Math.min(70, titleMatchCount * 11 + (titleMatchCount / Math.max(1, meaningfulTermCount)) * 28)
    if (taskMatchCount >= 2) score += Math.min(80, taskMatchCount * 13 + (taskMatchCount / Math.max(1, meaningfulTermCount)) * 32)
    if (titleTaskTagMatchCount >= 3) score += Math.min(55, titleTaskTagMatchCount * 5)
    if (queryTerms(rawQuery).length === 1 && terms.some((term) => strataTerms.has(term) || anchorTerms.has(term))) {
        score += 30
    }
    let specificityBoost = 0
    for (const term of terms) {
        if (genericTerms.has(term) || stopTerms.has(term)) continue
        const strongFieldMatch = titleTerms.has(term) || taskTerms.has(term) || tagTerms.has(term) || semanticTerms.has(term)
        if (!strongFieldMatch) continue
        if (term.length >= 10 || /\d/.test(term)) specificityBoost += 5
        else if (term.length >= 7) specificityBoost += 3
    }
    score += Math.min(24, specificityBoost)
    score += memoryRecencyIntentBoost(rawQuery, entry.updated_at)
    score += fileScore
    if (queryOwners.size > 0) {
        if (ownerMatched) {
            score += queryOwners.has("local") && entryOwner === "local" ? 42 : 28
        } else if (entryOwner) {
            const highIntentMismatch = queryOwners.has("local") || queryOwners.has("forgekit") || queryOwners.has("cityruntime") || queryOwners.has("axmem")
            score -= highIntentMismatch ? 46 : 28
        }
        const incidentalOwnerMention = [...queryOwners].some((owner) => titleTaskTagOwners.has(owner)) && !ownerMatched
        if (incidentalOwnerMention) score -= 18
    }
    if (scoreHints.length > 48 && currentFieldMatchCount < 2) {
        score -= Math.min(65, (scoreHints.length - 48) * 0.45 + hintOnlyMatchCount * 8)
    }
    if (scoreHints.length > 48 && currentFieldMatchCount === 0 && hintOnlyMatchCount >= 3) {
        score = Math.min(score, 18)
    }
    if (hintOnlyMatchCount >= 4 && titleTaskTagMatchCount < 2) {
        score -= Math.min(45, hintOnlyMatchCount * 7)
    }
    score = Math.max(0, score)

    const invalidatedMatchCount = invalidatedHintMatchCount(entry.invalidated_score_hints ?? [], terms)
    if (invalidatedMatchCount === 0) return score

    if ((input.mode ?? "current") === "history") {
        return score + invalidatedHistoryBoost(invalidatedMatchCount, terms)
    }

    if (memoryMutationActive("drop_invalidated_penalty")) {
        return score
    }

    const penalty = invalidatedScorePenalty(invalidatedMatchCount)
    const fixTerms = new Set(["correct", "correction", "fixed", "fix", "fixe", "fixes", "honest", "honesty", "repair", "repaired", "resolved", "truth"])
    const fixSignal = [...fixTerms].some((term) => titleTerms.has(term) || taskTerms.has(term) || tagTerms.has(term) || summaryTerms.has(term))
    const protectedCurrentSignal = fixSignal && (titleMatchCount + taskMatchCount) >= 3 && titleTaskTagMatchCount >= 4
    const effectivePenalty = protectedCurrentSignal
        ? Math.max(20, penalty - Math.min(120, titleTaskTagMatchCount * 18))
        : penalty + Math.min(120, 24 + titleTaskTagMatchCount * 8)
    return score > 0 ? Math.max(1, score - effectivePenalty) : 0
}

function scoreEntryDetailed(
    entry: AgentMemoryIndexEntry,
    input: { taskId?: string; query?: string; file?: string; mode?: MemoryRecallMode },
    totalOverride?: number
): { score: number; explanation: MemoryScoreExplanation } {
    const score = totalOverride ?? scoreEntry(entry, input)
    const rawTerms = queryTerms(input.query)
    const normalized = (value: string | undefined): string => (value ?? "").toLowerCase()
    const compact = (value: string | undefined): string => normalized(value).replace(/[^a-z0-9]+/g, "")
    const fieldText = {
        task: `${entry.task_id}\n${entry.title}`.toLowerCase(),
        tags: [...entry.tags, ...(entry.canonical_tags ?? []), ...(entry.agent_tags ?? [])].join("\n").toLowerCase(),
        semantic: entry.semantic_refs.flatMap((ref) => [ref.kind, ref.name]).join("\n").toLowerCase(),
        summary: Object.values(entry.summary_preview ?? {}).join("\n").toLowerCase(),
        hints: entry.score_hints.join("\n").toLowerCase()
    }
    const contains = (text: string, term: string): boolean => text.includes(term) || compact(text).includes(compact(term))
    const componentScore = (name: string, text: string, weight: number): MemoryScoreComponent => {
        const count = rawTerms.filter((term) => term.length > 0 && contains(text, term)).length
        return { name, score: round2(count * weight), detail: count > 0 ? `${count}/${rawTerms.length} query terms` : undefined }
    }
    const components: MemoryScoreComponent[] = []
    if (input.taskId) {
        components.push({
            name: "task_id",
            score,
            detail: entry.task_id === normalizeTaskId(input.taskId) ? "exact task lookup" : "no task match"
        })
    } else {
        const fileScore = memoryFileRefScore(entry, input.file)
        if (fileScore > 0) components.push({ name: "file_ref", score: fileScore, detail: normalizeMemoryFilePath(input.file) })
        components.push(componentScore("title_task_id", fieldText.task, 31))
        components.push(componentScore("tags", fieldText.tags, 22))
        components.push(componentScore("semantic_refs", fieldText.semantic, 14))
        components.push(componentScore("summary_preview", fieldText.summary, 8))
        components.push(componentScore("score_hints", fieldText.hints, 7))
        const specificity = scoreExplanationSpecificityBonus(rawTerms, [fieldText.task, fieldText.tags, fieldText.semantic])
        if (specificity > 0) components.push({ name: "specificity", score: specificity, detail: "distinctive terms matched title/task/tags/refs" })
        const freshness = memoryRecencyIntentBoost(input.query, entry.updated_at)
        if (freshness > 0) components.push({ name: "freshness", score: freshness, detail: `${memoryFreshness(memoryAgeDays(entry.updated_at))}; recency intent detected` })
        const invalidatedMatches = invalidatedHintMatchCount(entry.invalidated_score_hints ?? [], rawTerms)
        if (invalidatedMatches > 0) {
            const invalidatedScore = (input.mode ?? "current") === "history"
                ? invalidatedHistoryBoost(invalidatedMatches, rawTerms)
                : -invalidatedScorePenalty(invalidatedMatches)
            components.push({ name: "invalidated_hypotheses", score: invalidatedScore, detail: `${invalidatedMatches} matched terms` })
        }
    }
    const matchedTerms = rawTerms.filter((term) => Object.values(fieldText).some((text) => contains(text, term)))
    const matched = uniqueStrings(matchedTerms)
    const unmatched = rawTerms.filter((term) => !matched.includes(term))
    const explained = round2(sum(components, (component) => component.score))
    const residual = round2(score - explained)
    if (Math.abs(residual) >= 0.01) {
        components.push({ name: "calibration_owner_margin", score: residual, detail: "owner, coverage, caps, vector backfill, or tie calibration" })
    }
    return {
        score,
        explanation: {
            total: score,
            matched_terms: matched,
            unmatched_terms: unmatched,
            components: components.filter((component) => component.score !== 0 || component.detail)
        }
    }
}

function scoreExplanationSpecificityBonus(terms: string[], strongFieldTexts: string[]): number {
    let score = 0
    for (const term of uniqueStrings(terms)) {
        if (term.length < 7 && !/\d/.test(term)) continue
        if (!strongFieldTexts.some((text) => text.includes(term) || text.replace(/[^a-z0-9]+/g, "").includes(term.replace(/[^a-z0-9]+/g, "")))) continue
        score += term.length >= 10 || /\d/.test(term) ? 5 : 3
    }
    return Math.min(24, score)
}

function scoreExplanationWithProject(
    explanation: MemoryScoreExplanation | undefined,
    total: number,
    projectScore: number
): MemoryScoreExplanation | undefined {
    if (!explanation) return undefined
    const components = projectScore === 0
        ? explanation.components
        : [...explanation.components, { name: "project_registry", score: projectScore, detail: "global registry project match" }]
    return {
        ...explanation,
        total,
        components
    }
}

function invalidatedHypothesesScoreHints(hypotheses: MemoryInvalidatedHypothesis[]): string[] {
    return uniqueStrings(hypotheses.flatMap((item) => [
        item.hypothesis,
        item.reason,
        item.next_better_hypothesis
    ]))
}

function invalidatedHintMatchCount(hints: string[], terms: string[]): number {
    if (terms.length === 0 || hints.length === 0) return 0
    const haystack = hints.join("\n").toLowerCase()
    return terms.filter((term) => haystack.includes(term)).length
}

function invalidatedScorePenalty(matchCount: number): number {
    // A single common query term overlapping an invalidated hypothesis is too
    // weak a signal to penalize or warn on; require at least two matching terms.
    if (matchCount < 2) return 0
    return Math.min(160, matchCount * 40)
}

function invalidatedHistoryBoost(matchCount: number, terms: string[]): number {
    return Math.min(120, matchCount * 20 + invalidatedHistoryIntentBonus(terms))
}

function invalidatedHistoryIntentBonus(terms: string[]): number {
    const intentTerms = new Set([
        "invalidated",
        "invalid",
        "false",
        "old",
        "stale",
        "abandoned",
        "history",
        "historique",
        "ancienne",
        "ancien",
        "hypothesis",
        "hypothese",
        "hypothse",
        "piste"
    ])
    return terms.some((term) => intentTerms.has(term)) ? 20 : 0
}

function invalidatedRecallMatch(hypotheses: MemoryInvalidatedHypothesis[], query: string | undefined, mode: MemoryRecallMode): {
    matched: boolean
    matchCount: number
    penalty: number
    boost: number
} {
    return invalidatedRecallMatchFromHints(invalidatedHypothesesScoreHints(hypotheses), query, mode)
}

function invalidatedRecallMatchFromHints(hints: string[], query: string | undefined, mode: MemoryRecallMode): {
    matched: boolean
    matchCount: number
    penalty: number
    boost: number
} {
    const terms = queryTerms(query)
    const matchCount = invalidatedHintMatchCount(hints, terms)
    const historyMode = mode === "history"
    return {
        // History mode surfaces any overlap (boost); current mode only warns /
        // penalizes on a meaningful match (>= 2 terms), so benign single-word
        // queries no longer trigger a spurious warning on every card.
        matched: historyMode ? matchCount > 0 : matchCount >= 2,
        matchCount,
        penalty: historyMode ? 0 : invalidatedScorePenalty(matchCount),
        boost: historyMode && matchCount > 0 ? invalidatedHistoryBoost(matchCount, terms) : 0
    }
}

function selectIndexStrataPreviews(entry: AgentMemoryIndexEntry, query: string | undefined): MemoryProjectedStratum[] {
    const previews = entry.strata_previews ?? []
    const terms = queryTerms(query)
    if (terms.length === 0) return previews
    const scored = previews
        .map((stratum) => ({ stratum, score: scoreProjectedStratum(stratum, terms) }))
        .filter((item) => item.score > 0)
        .sort((left, right) => right.score - left.score || graphStratumRank(left.stratum) - graphStratumRank(right.stratum) || left.stratum.name.localeCompare(right.stratum.name))
        .map((item) => item.stratum)
    return scored.length > 0 ? scored : previews
}

function selectIndexAnchorPreviews(entry: AgentMemoryIndexEntry, query: string | undefined): MemoryProjectedAnchor[] {
    const previews = entry.anchor_refs ?? []
    const terms = queryTerms(query)
    if (terms.length === 0) return previews
    const scored = previews
        .map((anchor) => ({ anchor, score: scoreProjectedAnchorPreview(anchor, terms) }))
        .filter((item) => item.score > 0)
        .sort((left, right) => normalizedProjectedAnchorWeight(right.anchor) - normalizedProjectedAnchorWeight(left.anchor) ||
            right.score - left.score ||
            anchorTypePriority(right.anchor.type) - anchorTypePriority(left.anchor.type) ||
            left.anchor.id.localeCompare(right.anchor.id))
        .map((item) => item.anchor)
    return scored.length > 0 ? scored : previews
}

function selectIndexEvidenceRefs(entry: AgentMemoryIndexEntry, query: string | undefined): MemoryEvidenceRef[] {
    const refs = entry.evidence_refs ?? []
    const terms = queryTerms(query)
    return refs
        .map((ref, index) => ({ ref, index, score: scoreEvidenceRef(ref, terms) }))
        .sort((left, right) => right.score - left.score || evidenceRefRank(left.ref) - evidenceRefRank(right.ref) || left.index - right.index)
        .map((item) => item.ref)
}

function scoreProjectedStratum(stratum: MemoryProjectedStratum, terms: string[]): number {
    const haystack = [
        stratum.part,
        stratum.name,
        stratum.kind,
        ...stratum.nodes.flatMap((node) => [node.kind, node.title, node.status, ...(node.evidence_refs ?? [])])
    ].join("\n").toLowerCase()
    return terms.reduce((score, term) => score + (haystack.includes(term) ? 1 : 0), 0)
}

function scoreEvidenceRef(ref: MemoryEvidenceRef, terms: string[]): number {
    const haystack = [ref.id, ref.kind, ref.path, ref.summary].join("\n").toLowerCase()
    const queryScore = terms.reduce((score, term) => score + (haystack.includes(term) ? 10 : 0), 0)
    return queryScore + Math.max(0, 8 - evidenceRefRank(ref))
}

function evidenceRefRank(ref: MemoryEvidenceRef): number {
    const ranks: Record<string, number> = {
        context_checkpoint: 0,
        context: 1,
        context_history: 2,
        session_log: 3,
        test_run: 4
    }
    return ranks[ref.kind] ?? 5
}

function scoreProjectedAnchorPreview(anchor: MemoryProjectedAnchor, terms: string[]): number {
    const haystack = [
        anchor.type,
        anchor.status,
        anchor.summary,
        anchor.from,
        anchor.from_title,
        anchor.to,
        anchor.to_title,
        ...(anchor.evidence_refs ?? [])
    ].join("\n").toLowerCase()
    return terms.reduce((score, term) => score + (haystack.includes(term) ? anchorTypePriority(anchor.type) + 1 : 0), normalizedProjectedAnchorWeight(anchor))
}

function normalizedProjectedAnchorWeight(anchor: MemoryProjectedAnchor): number {
    return typeof anchor.weight === "number" && Number.isFinite(anchor.weight) ? Math.max(0, anchor.weight) : 0
}

function limitProjectedStrata(strata: MemoryProjectedStratum[], limits: MemoryRecallProfileLimits): MemoryProjectedStratum[] {
    return strata.slice(0, limits.projected_strata_limit).map((stratum) => ({
        ...stratum,
        nodes: stratum.nodes.slice(0, limits.projected_nodes_per_stratum_limit)
    }))
}

function indexRecallTruncated(entry: AgentMemoryIndexEntry, limits: MemoryRecallProfileLimits): boolean {
    return (entry.decision_hints?.length ?? 0) > limits.decision_limit ||
        (entry.command_hints?.length ?? entry.command_count) > limits.command_limit ||
        (entry.next_action_hints?.length ?? 0) > limits.next_action_limit ||
        (entry.invalidated_hypotheses?.length ?? entry.invalidated_hypothesis_count ?? 0) > limits.invalidated_hypothesis_limit ||
        (entry.evidence_refs?.length ?? entry.evidence_count) > limits.evidence_ref_limit ||
        (entry.strata_previews?.length ?? entry.strata_refs?.length ?? 0) > limits.projected_strata_limit ||
        (entry.anchor_refs?.length ?? entry.anchor_count ?? 0) > limits.projected_anchor_limit ||
        (entry.strata_previews ?? []).some((stratum) => stratum.nodes.length > limits.projected_nodes_per_stratum_limit)
}

function packRecallTruncated(pack: AgentMemoryPack, graphProjection: { strata: MemoryProjectedStratum[]; anchors: MemoryProjectedAnchor[] }, limits: MemoryRecallProfileLimits): boolean {
    return pack.decisions.length > limits.decision_limit ||
        pack.commands.length > limits.command_limit ||
        pack.next_actions.length > limits.next_action_limit ||
        packInvalidatedHypotheses(pack).length > limits.invalidated_hypothesis_limit ||
        pack.evidence.length > limits.evidence_ref_limit ||
        graphProjection.strata.length > limits.projected_strata_limit ||
        graphProjection.anchors.length > limits.projected_anchor_limit ||
        graphProjection.strata.some((stratum) => stratum.nodes.length > limits.projected_nodes_per_stratum_limit)
}

function projectMemoryGraph(pack: AgentMemoryPack, query: string | undefined): {
    strata: MemoryProjectedStratum[]
    anchors: MemoryProjectedAnchor[]
} {
    const graph = effectiveMemoryGraph(pack)
    const strata = graph.strata
    const nodes = graph.nodes
    const anchors = graph.anchors
    if (strata.length === 0 || nodes.length === 0) {
        return { strata: [], anchors: [] }
    }

    const terms = queryTerms(query)
    const nodeById = new Map(nodes.map((node) => [node.id, node]))
    const stratumById = new Map(strata.map((stratum) => [stratum.id, stratum]))
    const selected = new Set<string>()
    const scoredNodes = nodes
        .map((node) => ({ node, score: scoreGraphNode(node, terms) }))
        .filter((item) => terms.length === 0 || item.score > 0)
        .sort((left, right) => right.score - left.score || graphNodeRank(left.node) - graphNodeRank(right.node) || left.node.title.localeCompare(right.node.title) || left.node.id.localeCompare(right.node.id))

    const initialNodeLimit = Math.max(1, GRAPH_NODE_RECALL_LIMIT - GRAPH_ANCHOR_ENDPOINT_RESERVE)
    for (const { node } of scoredNodes.slice(0, initialNodeLimit)) {
        selected.add(node.id)
    }

    if (selected.size === 0) {
        for (const node of nodes.slice(0, Math.min(4, GRAPH_NODE_RECALL_LIMIT))) {
            selected.add(node.id)
        }
    }

    const scoredAnchors = anchors
        .map((anchor) => ({ anchor, score: scoreGraphAnchor(anchor, nodeById, terms, selected) }))
        .filter((item) => item.score > 0)
        .sort((left, right) => compareGraphAnchorScores(left, right))
    const hasWeightedAnchors = scoredAnchors.some(({ anchor }) => normalizedAnchorWeight(anchor) > 0)
    const compactAnchorCandidates = hasWeightedAnchors
        ? scoredAnchors.filter(({ anchor }) => normalizedAnchorWeight(anchor) > 0)
        : scoredAnchors

    for (const { anchor } of compactAnchorCandidates) {
        if (selected.size >= GRAPH_NODE_RECALL_LIMIT) break
        if (selected.has(anchor.from) && nodeById.has(anchor.to)) selected.add(anchor.to)
        else if (selected.has(anchor.to) && nodeById.has(anchor.from)) selected.add(anchor.from)
        else {
            if (nodeById.has(anchor.from)) selected.add(anchor.from)
            if (selected.size < GRAPH_NODE_RECALL_LIMIT && nodeById.has(anchor.to)) selected.add(anchor.to)
        }
    }

    for (const { node } of scoredNodes) {
        if (selected.size >= GRAPH_NODE_RECALL_LIMIT) break
        selected.add(node.id)
    }

    if (hasWeightedAnchors) {
        const protectedAnchorEndpoints = new Set<string>()
        for (const { anchor } of compactAnchorCandidates.slice(0, GRAPH_ANCHOR_RECALL_LIMIT)) {
            ensureGraphEndpointSelected(anchor.from, selected, nodeById, protectedAnchorEndpoints)
            protectedAnchorEndpoints.add(anchor.from)
            ensureGraphEndpointSelected(anchor.to, selected, nodeById, protectedAnchorEndpoints)
            protectedAnchorEndpoints.add(anchor.to)
        }
    }

    const projectedAnchors = compactAnchorCandidates
        .filter(({ anchor }) => selected.has(anchor.from) && selected.has(anchor.to))
        .slice(0, GRAPH_ANCHOR_RECALL_LIMIT)
        .map(({ anchor }) => {
            const from = nodeById.get(anchor.from)
            const to = nodeById.get(anchor.to)
            return {
                id: anchor.id,
                type: anchor.type,
                from: anchor.from,
                from_title: from ? compactMemoryLabel(from.title) : undefined,
                to: anchor.to,
                to_title: to ? compactMemoryLabel(to.title) : undefined,
                status: anchor.status,
                summary: anchor.summary,
                evidence_refs: anchor.evidence_refs,
                weight: anchor.weight
            }
        })

    const nodesByStratum = new Map<string, MemoryGraphNode[]>()
    for (const id of selected) {
        const node = nodeById.get(id)
        if (!node) continue
        const group = nodesByStratum.get(node.stratum) ?? []
        group.push(node)
        nodesByStratum.set(node.stratum, group)
    }

    const projectedStrata: MemoryProjectedStratum[] = []
    for (const [stratumId, group] of nodesByStratum.entries()) {
        const stratum = stratumById.get(stratumId)
        if (!stratum) continue
        projectedStrata.push({
            id: stratum.id,
            part: stratum.part,
            name: stratum.name,
            kind: stratum.kind,
            node_count: stratum.node_ids.length,
            nodes: group
                .sort((left, right) => graphNodeRank(left) - graphNodeRank(right) || left.title.localeCompare(right.title))
                .slice(0, 6)
                .map((node) => ({
                    id: node.id,
                    kind: node.kind,
                    title: compactMemoryLabel(node.title),
                    status: node.status,
                    evidence_refs: node.evidence_refs
                }))
        })
    }
    projectedStrata.sort((left, right) => graphStratumRank(left) - graphStratumRank(right) || left.name.localeCompare(right.name))

    return {
        strata: projectedStrata,
        anchors: projectedAnchors
    }
}

function queryTerms(query: string | undefined): string[] {
    return uniqueStrings((query ?? "").trim().toLowerCase().split(/\s+/).map((term) => term.replace(/[^a-z0-9_.:-]+/g, ""))).filter((term) => term.length > 0)
}

function scoreGraphNode(node: MemoryGraphNode, terms: string[]): number {
    if (terms.length === 0) return Math.max(1, 20 - graphNodeRank(node))

    const haystack = [
        node.part,
        node.stratum,
        node.kind,
        node.title,
        node.summary,
        node.status,
        ...(node.tags ?? []),
        ...(node.evidence_refs ?? []),
        ...(node.score_hints ?? []),
        ...(node.semantic_refs ?? []).flatMap((ref) => [ref.kind, ref.name])
    ].join("\n").toLowerCase()
    let score = 0
    for (const term of terms) {
        if (node.title.toLowerCase() === term) score += 30
        if ((node.tags ?? []).some((tag) => tag.toLowerCase() === term)) score += 12
        if ((node.semantic_refs ?? []).some((ref) => ref.name.toLowerCase() === term || ref.kind.toLowerCase() === term)) score += 12
        if (haystack.includes(term)) score += node.status === "invalidated" ? 3 : 6
    }
    if (node.status === "invalidated") score = Math.max(1, score - 8)
    return score
}

function scoreGraphAnchor(anchor: MemoryAnchor, nodes: Map<string, MemoryGraphNode>, terms: string[], selected: Set<string>): number {
    const from = nodes.get(anchor.from)
    const to = nodes.get(anchor.to)
    const touchesSelected = selected.has(anchor.from) || selected.has(anchor.to)
    if (!from || !to || (!touchesSelected && terms.length === 0)) return 0

    let score = touchesSelected ? 10 : 0
    score += normalizedAnchorWeight(anchor)
    if (terms.length > 0) {
        const haystack = [
            anchor.type,
            anchor.status,
            anchor.summary,
            ...(anchor.evidence_refs ?? []),
            ...(anchor.score_hints ?? []),
            from.title,
            from.summary,
            to.title,
            to.summary
        ].join("\n").toLowerCase()
        for (const term of terms) {
            if (haystack.includes(term)) score += anchor.status === "invalidated" ? 2 : 5
        }
    }
    score += anchorTypePriority(anchor.type)
    if (anchor.status !== "active") score -= 4
    return Math.max(0, score)
}

function ensureGraphEndpointSelected(
    id: string,
    selected: Set<string>,
    nodes: Map<string, MemoryGraphNode>,
    protectedIds: Set<string>
): void {
    if (selected.has(id) || !nodes.has(id)) return
    if (selected.size >= GRAPH_NODE_RECALL_LIMIT) {
        const removable = [...selected]
            .map((selectedId) => nodes.get(selectedId))
            .filter((node): node is MemoryGraphNode => !!node && !protectedIds.has(node.id))
            .sort((left, right) => graphNodeRank(right) - graphNodeRank(left) || right.title.localeCompare(left.title) || right.id.localeCompare(left.id))[0]
        if (removable) selected.delete(removable.id)
    }
    if (selected.size < GRAPH_NODE_RECALL_LIMIT) selected.add(id)
}

function compareGraphAnchorScores(
    left: { anchor: MemoryAnchor; score: number },
    right: { anchor: MemoryAnchor; score: number }
): number {
    return normalizedAnchorWeight(right.anchor) - normalizedAnchorWeight(left.anchor) ||
        right.score - left.score ||
        anchorTypePriority(right.anchor.type) - anchorTypePriority(left.anchor.type) ||
        left.anchor.type.localeCompare(right.anchor.type) ||
        left.anchor.id.localeCompare(right.anchor.id)
}

function normalizedAnchorWeight(anchor: MemoryAnchor): number {
    return typeof anchor.weight === "number" && Number.isFinite(anchor.weight) ? Math.max(0, anchor.weight) : 0
}

function anchorTypePriority(type: string): number {
    const priorities: Record<string, number> = {
        invalidates: 30,
        supersedes: 26,
        fixes: 24,
        conflicts_with: 22,
        depends_on: 18,
        reproduced_by: 12,
        resumes: 10,
        uses: 8,
        evidenced_by: 4,
        relates_to: 2
    }
    return priorities[type] ?? 6
}

function graphNodeRank(node: MemoryGraphNode): number {
    if ((node.score_hints ?? []).includes("decision")) return 2
    const ranks: Record<string, number> = {
        summary: 0,
        invalidated_hypothesis: 1,
        decision: 2,
        next_action: 3,
        next_hypothesis: 3,
        resume_command: 4,
        command: 7
    }
    return ranks[node.kind] ?? (node.stratum.includes("semantic") ? 5 : node.stratum.includes("evidence") ? 8 : 6)
}

function graphStratumRank(stratum: Pick<MemoryProjectedStratum, "kind" | "name">): number {
    const ranks: Record<string, number> = {
        summary: 0,
        invalidated_hypothesis: 1,
        decision: 2,
        next_action: 3,
        resume_command: 4,
        command: 7,
        semantic_ref: 5,
        exact_evidence: 8
    }
    return ranks[stratum.kind] ?? (stratum.name === "evidence" ? 8 : 7)
}

function memoryAgeDays(updatedAt: string): number {
    const updated = Date.parse(updatedAt)
    if (!Number.isFinite(updated)) return 0
    return Math.max(0, round2((Date.now() - updated) / (1000 * 60 * 60 * 24)))
}

function memoryFreshness(ageDays: number): MemoryFreshness {
    if (ageDays <= 1) return "fresh"
    if (ageDays <= 14) return "recent"
    if (ageDays <= 90) return "aging"
    return "old"
}

function memoryQueryHasRecencyIntent(query: string | undefined): boolean {
    const text = (query ?? "").toLowerCase()
    return /\b(latest|recent|newest|current|today|yesterday|fresh|now|actuel|actuelle|recentes?|r[eé]centes?|aujourdhui|aujourd'hui|hier|dernier|derniere|derni[eè]re)\b/.test(text)
}

function memoryRecencyIntentBoost(query: string | undefined, updatedAt: string): number {
    if (!memoryQueryHasRecencyIntent(query)) return 0
    const freshness = memoryFreshness(memoryAgeDays(updatedAt))
    if (freshness === "fresh") return 14
    if (freshness === "recent") return 8
    if (freshness === "aging") return 2
    return 0
}

function memoryPackSourceScope(pack: AgentMemoryPack): string | undefined {
    for (const item of newestFirst(pack.evidence, pack.evidence.length)) {
        const data = item.data
        if (!data || typeof data !== "object") continue
        const sourceScope = (data as { source_scope?: unknown }).source_scope
        if (typeof sourceScope === "string" && sourceScope.trim()) {
            return compactMemoryText(sourceScope, MEMORY_INDEX_TEXT_PREVIEW_CHAR_LIMIT)
        }
    }
    return undefined
}

function memoryRecallItemFromIndex(
    entry: AgentMemoryIndexEntry,
    score: number,
    query: string | undefined,
    mode: MemoryRecallMode,
    profile: MemoryRecallProfile,
    scoreExplanation?: MemoryScoreExplanation
): MemoryRecallItem {
    const limits = recallProfileLimits(profile)
    const invalidatedHypotheses = (entry.invalidated_hypotheses ?? []).slice(0, limits.invalidated_hypothesis_limit)
    const invalidatedMatch = invalidatedRecallMatchFromHints(entry.invalidated_score_hints ?? [], query, mode)
    const ageDays = memoryAgeDays(entry.updated_at)
    const itemWithoutMetrics: Omit<MemoryRecallItem, "metrics"> = {
        task_id: entry.task_id,
        title: entry.title,
        score,
        recall_mode: mode,
        recall_profile: profile,
        truncated: indexRecallTruncated(entry, limits),
        pack_path: normalizePath(entry.pack_path),
        created_at: entry.created_at,
        updated_at: entry.updated_at,
        age_days: ageDays,
        freshness: memoryFreshness(ageDays),
        source_scope: entry.source_scope,
        tags: entry.tags,
        canonical_tags: entry.canonical_tags ?? [],
        agent_tags: entry.agent_tags ?? entry.tags,
        semantic_refs: entry.semantic_refs,
        summary: entry.summary_preview ?? { resume_command: entry.resume_command },
        decisions: (entry.decision_hints ?? []).slice(0, limits.decision_limit),
        commands: (entry.command_hints ?? []).slice(0, limits.command_limit),
        next_actions: (entry.next_action_hints ?? []).slice(0, limits.next_action_limit),
        invalidated_hypotheses: invalidatedHypotheses,
        invalidated: invalidatedMatch.matched,
        invalidated_match_count: invalidatedMatch.matchCount,
        invalidated_score_penalty: invalidatedMatch.penalty,
        invalidated_score_boost: invalidatedMatch.boost,
        projected_strata: limitProjectedStrata(selectIndexStrataPreviews(entry, query), limits),
        projected_anchors: selectIndexAnchorPreviews(entry, query).slice(0, limits.projected_anchor_limit),
        evidence_refs: selectIndexEvidenceRefs(entry, query).slice(0, limits.evidence_ref_limit),
        full_evidence: undefined,
        full_graph: undefined,
        score_explanation: scoreExplanation
    }

    return {
        ...itemWithoutMetrics,
        metrics: memoryRecallMetricsFromIndex(entry, itemWithoutMetrics)
    }
}

function memoryRecallItem(
    pack: AgentMemoryPack,
    packPath: string,
    score: number,
    compressedPackBytes: number,
    query: string | undefined,
    hydration: MemoryRecallHydration,
    mode: MemoryRecallMode,
    profile: MemoryRecallProfile,
    scoreExplanation?: MemoryScoreExplanation
): MemoryRecallItem {
    const limits = recallProfileLimits(profile)
    const invalidatedHypotheses = newestFirst(packInvalidatedHypotheses(pack), limits.invalidated_hypothesis_limit)
    const invalidatedMatch = invalidatedRecallMatch(invalidatedHypotheses, query, mode)
    const graphProjection = projectMemoryGraph(pack, query)
    const fullGraph = hydration.include_graph ? effectiveMemoryGraph(pack) : undefined
    const ageDays = memoryAgeDays(pack.task.updated_at)
    const itemWithoutMetrics: Omit<MemoryRecallItem, "metrics"> = {
        task_id: pack.task.id,
        title: pack.task.title,
        score,
        recall_mode: mode,
        recall_profile: profile,
        truncated: packRecallTruncated(pack, graphProjection, limits),
        pack_path: normalizePath(packPath),
        created_at: pack.task.created_at,
        updated_at: pack.task.updated_at,
        age_days: ageDays,
        freshness: memoryFreshness(ageDays),
        source_scope: memoryPackSourceScope(pack),
        tags: pack.task.tags,
        canonical_tags: packCanonicalTags(pack),
        agent_tags: packAgentTags(pack),
        semantic_refs: pack.semantic_refs,
        summary: pack.summary,
        decisions: newestFirst(pack.decisions, limits.decision_limit),
        commands: newestFirst(pack.commands, limits.command_limit),
        next_actions: newestFirst(pack.next_actions, limits.next_action_limit),
        invalidated_hypotheses: invalidatedHypotheses,
        invalidated: invalidatedMatch.matched,
        invalidated_match_count: invalidatedMatch.matchCount,
        invalidated_score_penalty: invalidatedMatch.penalty,
        invalidated_score_boost: invalidatedMatch.boost,
        projected_strata: limitProjectedStrata(graphProjection.strata, limits),
        projected_anchors: graphProjection.anchors.slice(0, limits.projected_anchor_limit),
        evidence_refs: newestFirst(memoryEvidenceRefs(pack.evidence), limits.evidence_ref_limit),
        full_evidence: hydration.include_evidence ? pack.evidence : undefined,
        full_graph: fullGraph,
        score_explanation: scoreExplanation
    }

    return {
        ...itemWithoutMetrics,
        metrics: memoryRecallMetrics(pack, itemWithoutMetrics, compressedPackBytes)
    }
}

function memoryPackMetrics(pack: AgentMemoryPack, compressedPackBytes: number): MemoryPackMetrics {
    const rawEvidenceChars = jsonCharLength(pack.evidence)
    const packJsonChars = jsonCharLength(pack)

    return {
        raw_evidence_chars: rawEvidenceChars,
        pack_json_chars: packJsonChars,
        compressed_pack_bytes: compressedPackBytes,
        estimated_raw_tokens: estimateTokens(rawEvidenceChars),
        estimated_pack_json_tokens: estimateTokens(packJsonChars),
        json_to_compressed_ratio: ratio(packJsonChars, compressedPackBytes)
    }
}

function memoryRecallMetrics(
    pack: AgentMemoryPack,
    item: Omit<MemoryRecallItem, "metrics">,
    compressedPackBytes: number
): MemoryRecallMetrics {
    // Baseline = the full pack JSON the card distills (what an agent would
    // otherwise have to read), not just the evidence slice. recall_chars = the
    // rendered text card actually emitted. Guarantees an honest, positive ratio.
    const rawEvidenceChars = jsonCharLength(pack)
    const recallChars = renderRecallCardChars(item)
    const estimatedRawTokens = estimateTokens(rawEvidenceChars)
    const estimatedRecallTokens = estimateTokens(recallChars)

    return {
        raw_evidence_chars: rawEvidenceChars,
        compressed_pack_bytes: compressedPackBytes,
        recall_chars: recallChars,
        estimated_raw_tokens: estimatedRawTokens,
        estimated_recall_tokens: estimatedRecallTokens,
        estimated_context_tokens_saved: Math.max(0, estimatedRawTokens - estimatedRecallTokens),
        estimated_context_savings_ratio: savingsRatio(rawEvidenceChars, recallChars),
        json_to_compressed_ratio: ratio(jsonCharLength(pack), compressedPackBytes)
    }
}

function memoryRecallMetricsFromIndex(
    entry: AgentMemoryIndexEntry,
    item: Omit<MemoryRecallItem, "metrics">
): MemoryRecallMetrics {
    const sourceChars = entry.pack_json_chars ?? entry.raw_evidence_chars ?? 0
    const recallChars = renderRecallCardChars(item)
    const estimatedRawTokens = estimateTokens(sourceChars)
    const estimatedRecallTokens = estimateTokens(recallChars)

    return {
        raw_evidence_chars: sourceChars,
        compressed_pack_bytes: 0,
        recall_chars: recallChars,
        estimated_raw_tokens: estimatedRawTokens,
        estimated_recall_tokens: estimatedRecallTokens,
        estimated_context_tokens_saved: Math.max(0, estimatedRawTokens - estimatedRecallTokens),
        estimated_context_savings_ratio: savingsRatio(sourceChars, recallChars),
        json_to_compressed_ratio: 0
    }
}

function aggregateRecallMetrics(results: MemoryRecallItem[]): MemoryRecallMetrics {
    const rawEvidenceChars = sum(results, (item) => item.metrics.raw_evidence_chars)
    const compressedPackBytes = sum(results, (item) => item.metrics.compressed_pack_bytes)
    const recallChars = sum(results, (item) => item.metrics.recall_chars)
    const estimatedRawTokens = estimateTokens(rawEvidenceChars)
    const estimatedRecallTokens = estimateTokens(recallChars)

    return {
        raw_evidence_chars: rawEvidenceChars,
        compressed_pack_bytes: compressedPackBytes,
        recall_chars: recallChars,
        estimated_raw_tokens: estimatedRawTokens,
        estimated_recall_tokens: estimatedRecallTokens,
        estimated_context_tokens_saved: Math.max(0, estimatedRawTokens - estimatedRecallTokens),
        estimated_context_savings_ratio: savingsRatio(rawEvidenceChars, recallChars),
        json_to_compressed_ratio: ratio(sum(results, (item) => item.metrics.compressed_pack_bytes * item.metrics.json_to_compressed_ratio), compressedPackBytes)
    }
}

function jsonCharLength(value: unknown): number {
    return JSON.stringify(value).length
}

function estimateTokens(chars: number): number {
    return Math.ceil(chars / 4)
}

function ratio(numerator: number, denominator: number): number {
    if (denominator <= 0) return 0
    return round2(numerator / denominator)
}

function savingsRatio(rawChars: number, recallChars: number): number {
    if (rawChars <= 0) return 0
    return round2(Math.max(0, 1 - recallChars / rawChars))
}

function round4(value: number): number {
    return Math.round(value * 10000) / 10000
}

function round2(value: number): number {
    return Math.round(value * 100) / 100
}

function sum<T>(values: T[], valueOf: (value: T) => number): number {
    return values.reduce((total, value) => total + valueOf(value), 0)
}

function resolveActiveSessionId(cwd: string, sessionId: string | undefined, now: string): string {
    if (sessionId) return normalizeSessionId(sessionId)
    const current = readCurrentSession(cwd)
    if (current?.active_session_id) return normalizeSessionId(current.active_session_id)
    return makeSessionId(new Date(now))
}

function resolveExistingSessionId(cwd: string, sessionId?: string): string | undefined {
    if (sessionId) return normalizeSessionId(sessionId)
    const current = readCurrentSession(cwd)
    if (current?.active_session_id) return normalizeSessionId(current.active_session_id)
    return listSessionMemory({ cwd }).sessions[0]?.session_id
}

function makeSessionId(date: Date): string {
    return normalizeSessionId(`codex-${date.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`)
}

function normalizeSessionId(sessionId: string): string {
    const normalized = sessionId.trim().replace(/[^A-Za-z0-9_.-]/g, "_")
    if (!normalized) {
        throw new Error("memory session: --session must not be empty")
    }
    return normalized
}

function readCurrentSession(cwd: string): SessionMemoryCurrent | undefined {
    const filePath = path.join(cwd, axiomDir, memoryDir, sessionMemoryDir, currentSessionFileName)
    if (!fs.existsSync(filePath)) return undefined
    try {
        const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as SessionMemoryCurrent
        if (parsed.schema !== "axiom.agent_session_memory_current.v0" || parsed.version !== 1 || !parsed.active_session_id) {
            throw new Error("unsupported or invalid current session schema")
        }
        return parsed
    } catch (error) {
        throw new Error(`axmem session: unable to read current session (${error instanceof Error ? error.message : String(error)})`)
    }
}

function writeCurrentSession(cwd: string, sessionId: string): void {
    const filePath = path.join(cwd, axiomDir, memoryDir, sessionMemoryDir, currentSessionFileName)
    const current: SessionMemoryCurrent = {
        schema: "axiom.agent_session_memory_current.v0",
        version: 1,
        active_session_id: sessionId,
        updated_at: new Date().toISOString()
    }
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, `${JSON.stringify(current, null, 2)}\n`, "utf8")
}

function readSessionMemoryIndexFile(filePath: string): SessionMemoryIndex {
    try {
        const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as SessionMemoryIndex
        if (parsed.schema !== "axiom.agent_session_memory_index.v0" || parsed.version !== 1 || !parsed.session_id || !Array.isArray(parsed.entries)) {
            throw new Error("unsupported or invalid session index schema")
        }
        return {
            ...parsed,
            recent_messages: Array.isArray(parsed.recent_messages) ? parsed.recent_messages : []
        }
    } catch (error) {
        throw new Error(`axmem session: unable to read session index ${normalizePath(filePath)} (${error instanceof Error ? error.message : String(error)})`)
    }
}

function emptySessionMemoryIndex(cwd: string, sessionId: string): SessionMemoryIndex {
    const now = new Date().toISOString()
    return {
        schema: "axiom.agent_session_memory_index.v0",
        version: 1,
        session_id: sessionId,
        created_at: now,
        updated_at: now,
        workspace_path: normalizePath(path.resolve(cwd)),
        last_sequence: 0,
        entries: [],
        recent_messages: []
    }
}

function writeSessionMemoryIndex(cwd: string, index: SessionMemoryIndex): void {
    const filePath = path.join(cwd, axiomDir, memoryDir, sessionMemoryDir, index.session_id, sessionIndexFileName)
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, `${JSON.stringify(index, null, 2)}\n`, "utf8")
}

function upsertSessionEntry(index: SessionMemoryIndex, entry: SessionMemoryIndexEntry, explicitRole: SessionMemoryRecentMessage["role"] | undefined): SessionMemoryIndex {
    const recent = isRecentMessageKind(entry.kind)
        ? uniqueRecentMessages([
            ...index.recent_messages,
            {
                event_id: entry.event_id,
                role: explicitRole ?? sessionRoleFromKind(entry.kind),
                summary: entry.summary,
                created_at: entry.created_at
            }
        ])
        : index.recent_messages
    return {
        ...index,
        updated_at: entry.created_at,
        last_sequence: Math.max(index.last_sequence, entry.sequence),
        entries: [
            ...index.entries.filter((item) => item.event_id !== entry.event_id),
            entry
        ].sort((left, right) => left.sequence - right.sequence),
        recent_messages: recent.slice(-24)
    }
}

function uniqueRecentMessages(messages: SessionMemoryRecentMessage[]): SessionMemoryRecentMessage[] {
    return uniqueBy(messages, (message) => message.event_id)
}

function isRecentMessageKind(kind: string): boolean {
    return kind === "assistant_update" || kind === "user_message" || kind === "note" || kind === "decision" || kind === "risk" || kind === "next_action"
}

function sessionRoleFromKind(kind: string): SessionMemoryRecentMessage["role"] {
    if (kind === "assistant_update") return "assistant"
    if (kind === "user_message") return "user"
    if (kind === "command_result" || kind === "grep_result" || kind === "test_result") return "tool"
    return "unknown"
}

function sessionEventTitle(kind: string, summary: string): string {
    return `${kind}: ${compactSessionSummary(summary, 80)}`
}

function compactSessionSummary(value: string, maxLength = 220): string {
    const compact = value.replace(/\s+/g, " ").trim()
    return compact.length > maxLength ? `${compact.slice(0, maxLength - 3)}...` : compact
}

function compactSessionEvidence(value: string): string {
    return compactSessionSummary(value, 360)
}

function sanitizeSessionCaptureText(value: string | undefined): string {
    if (!value) return ""
    let text = value.replace(/\r\n/g, "\n")
    text = text.replace(/\bAXMEM PRIORITY CARDS[\s\S]*$/i, "")
    text = text.replace(/\bAXMEM_NO_STRONG_MATCH[\s\S]*$/i, "")
    text = text.replace(/\bAXMEM_RECALL_ERROR[\s\S]*$/i, "")
    text = text.replace(/These are external memory records[\s\S]*?(?:\n\s*\n|$)/gi, "")
    text = text.replace(/Global AXMEM (?:recall is READ-ONLY|is DISABLED)[\s\S]*?(?:\n|$)/gi, "")
    return text.replace(/\s+/g, " ").trim()
}

function extractSessionProfileFacts(input: {
    text: string
    kind: SessionMemoryEventKind
    role?: SessionMemoryRecentMessage["role"]
    recordedAt: string
    sourceEventId: string
}): SessionProfileFact[] {
    if (input.kind !== "user_message" && input.role !== "user") return []
    const text = sanitizeSessionCaptureText(input.text)
    if (!text || profileTextIsNegatedOrIncidental(text)) return []
    const facts: SessionProfileFact[] = []
    const name = extractExplicitUserName(text)
    if (name) {
        facts.push(makeSessionProfileFact("user.name", name, input))
    }
    for (const fact of extractExplicitPreferenceFacts(text)) {
        facts.push(makeSessionProfileFact(fact.key, fact.value, input))
    }
    for (const fact of extractExplicitRelationFacts(text)) {
        facts.push(makeSessionProfileFact(fact.key, fact.value, input))
    }
    const role = extractExplicitRole(text)
    if (role) {
        facts.push(makeSessionProfileFact("user.role", role, input))
    }
    const currentWork = extractExplicitCurrentWork(text)
    if (currentWork) {
        facts.push(makeSessionProfileFact("user.work.current", currentWork, input))
    }
    return facts
}

function makeSessionProfileFact(
    key: string,
    value: string,
    input: { recordedAt: string; sourceEventId: string }
): SessionProfileFact {
    return {
        key,
        value,
        recorded_at: input.recordedAt,
        source_event: input.sourceEventId,
        confidence: "explicit_user_statement",
        status: "active"
    }
}

function profileTextIsNegatedOrIncidental(text: string): boolean {
    const normalized = text.toLowerCase()
    return /\b(blague|joke|roman|personnage|character)\b/.test(normalized)
        || /\b(pas moi|not me|ce n['’]est pas mon nom|is not my name|isn't my name)\b/.test(normalized)
        || /\bje\s+ne\s+m['’ ]?appell?e?\s+pas\b/.test(normalized)
        || /\bje\s+pr[ée]f[èe]re\s+(?:ne\s+pas|pas)\b/.test(normalized)
        || /\bi\s+prefer\s+not\b/.test(normalized)
}

function extractExplicitUserName(text: string): string | undefined {
    const valuePattern = "([A-ZÀ-ÖØ-Þ][\\p{L}'’.-]{1,39})"
    const patterns = [
        new RegExp(`\\bje\\s+m(?:['’]|\\s)?appell?e?\\s+${valuePattern}`, "iu"),
        new RegExp(`\\bappelle[-\\s]?moi\\s+${valuePattern}`, "iu"),
        new RegExp(`\\bmon\\s+(?:nom|pr[ée]nom)\\s+(?:est|c['’]est)\\s+${valuePattern}`, "iu"),
        new RegExp(`\\bmoi\\s+c['’]est\\s+${valuePattern}`, "iu"),
        new RegExp(`\\bmy\\s+name\\s+is\\s+${valuePattern}`, "iu"),
        new RegExp(`\\bcall\\s+me\\s+${valuePattern}`, "iu")
    ]
    for (const pattern of patterns) {
        const match = pattern.exec(text)
        const value = cleanProfileFactValue(match?.[1])
        if (value) return value
    }
    return undefined
}

function extractExplicitPreferenceFacts(text: string): Array<{ key: string; value: string }> {
    const facts: Array<{ key: string; value: string }> = []
    const patterns = [
        /\bje\s+pr[ée]f[èe]re\s+([^.!?\n]+)/giu,
        /\bj['’]aime\s+mieux\s+([^.!?\n]+)/giu,
        /\bi\s+prefer\s+([^.!?\n]+)/giu,
        /\bmy\s+preferred\s+([a-z][a-z -]{1,40})\s+is\s+([^.!?\n]+)/giu,
        /\bma\s+pr[ée]f[ée]rence\s+(?:est|c['’]est)\s+([^.!?\n]+)/giu
    ]
    for (const pattern of patterns) {
        for (const match of text.matchAll(pattern)) {
            const raw = match.length >= 3 && match[2] ? `${match[1]} ${match[2]}` : match[1]
            const value = cleanPreferenceValue(raw)
            if (!value) continue
            facts.push({
                key: classifyPreferenceKey(raw, value),
                value
            })
        }
    }
    return uniqueProfileFactDrafts(facts)
}

function extractExplicitRelationFacts(text: string): Array<{ key: string; value: string }> {
    const valuePattern = "([A-ZÀ-ÖØ-Þ][\\p{L}'’.-]{1,39})"
    const relationPatterns: Array<{ key: string; pattern: RegExp }> = [
        { key: "user.relation.spouse.name", pattern: new RegExp(`\\bma\\s+femme\\s+s['’]?appelle\\s+${valuePattern}`, "iu") },
        { key: "user.relation.spouse.name", pattern: new RegExp(`\\bmon\\s+mari\\s+s['’]?appelle\\s+${valuePattern}`, "iu") },
        { key: "user.relation.partner.name", pattern: new RegExp(`\\bma\\s+compagne\\s+s['’]?appelle\\s+${valuePattern}`, "iu") },
        { key: "user.relation.partner.name", pattern: new RegExp(`\\bmon\\s+compagnon\\s+s['’]?appelle\\s+${valuePattern}`, "iu") },
        { key: "user.relation.spouse.name", pattern: new RegExp(`\\bmy\\s+wife(?:'s)?\\s+(?:name\\s+is|is\\s+named|is\\s+called)\\s+${valuePattern}`, "iu") },
        { key: "user.relation.spouse.name", pattern: new RegExp(`\\bmy\\s+husband(?:'s)?\\s+(?:name\\s+is|is\\s+named|is\\s+called)\\s+${valuePattern}`, "iu") },
        { key: "user.relation.partner.name", pattern: new RegExp(`\\bmy\\s+partner(?:'s)?\\s+(?:name\\s+is|is\\s+named|is\\s+called)\\s+${valuePattern}`, "iu") }
    ]
    const facts: Array<{ key: string; value: string }> = []
    for (const { key, pattern } of relationPatterns) {
        const value = cleanProfileFactValue(pattern.exec(text)?.[1])
        if (value) facts.push({ key, value })
    }
    return uniqueProfileFactDrafts(facts)
}

function extractExplicitRole(text: string): string | undefined {
    const patterns = [
        /\bmon\s+r[ôo]le\s+(?:est|c['’]est)\s+([^.!?\n]+)/iu,
        /\bmy\s+role\s+is\s+([^.!?\n]+)/iu,
        /\bje\s+travaille\s+comme\s+([^.!?\n]+)/iu,
        /\bi\s+work\s+as\s+(?:a|an)?\s*([^.!?\n]+)/iu
    ]
    for (const pattern of patterns) {
        const value = cleanStableProfilePhrase(pattern.exec(text)?.[1])
        if (value) return value
    }
    return undefined
}

function extractExplicitCurrentWork(text: string): string | undefined {
    const patterns = [
        /\bje\s+travaille\s+sur\s+([^.!?\n]+)/iu,
        /\bi(?:'m| am)\s+working\s+on\s+([^.!?\n]+)/iu
    ]
    for (const pattern of patterns) {
        const value = cleanStableProfilePhrase(pattern.exec(text)?.[1])
        if (value) return value
    }
    return undefined
}

function uniqueProfileFactDrafts(facts: Array<{ key: string; value: string }>): Array<{ key: string; value: string }> {
    const seen = new Set<string>()
    return facts.filter((fact) => {
        const id = `${fact.key}\n${fact.value.toLowerCase()}`
        if (seen.has(id)) return false
        seen.add(id)
        return true
    })
}

function cleanPreferenceValue(value: string | undefined): string | undefined {
    let cleaned = (value ?? "").replace(/\s+/g, " ").trim()
    if (!cleaned || /^(?:ne\s+pas|pas|not\b|not\s+to\b)/i.test(cleaned)) return undefined
    const language = normalizedNaturalLanguagePreference(cleaned)
    if (language) return language
    cleaned = cleaned.replace(/^(?:maintenant|now|d[ée]sormais|finalement|plut[ôo]t)\s+/i, "")
    cleaned = cleaned.split(/\s+(?:à|a|over|than|rather than|plut[ôo]t que)\s+/iu)[0] ?? cleaned
    cleaned = cleaned.replace(/\s+(?:pour|for|dans|in|sur|on)\s+.+$/iu, "")
    cleaned = cleaned.replace(/^(?:le|la|les|un|une|du|de la|the|a|an)\s+/iu, "")
    return cleanStableProfilePhrase(cleaned)
}

function normalizedNaturalLanguagePreference(value: string): string | undefined {
    const normalized = value.toLowerCase()
    if (/\b(fran[çc]ais|french)\b/.test(normalized)) return "français"
    if (/\b(anglais|english)\b/.test(normalized)) return "anglais"
    return undefined
}

function classifyPreferenceKey(raw: string, value: string): string {
    const normalized = `${raw} ${value}`.toLowerCase()
    if (normalizedNaturalLanguagePreference(normalized) || /\b(langue|natural language|speak|parler|r[ée]pondre)\b/.test(normalized)) {
        return "user.preference.language"
    }
    if (looksLikeProgrammingLanguage(value) || /\b(programming|programmation|langage)\b/.test(normalized)) {
        return "user.preference.programming_language"
    }
    return "user.preference.general"
}

function looksLikeProgrammingLanguage(value: string): boolean {
    return /^(?:typescript|javascript|rust|python|go|golang|java|c|c\+\+|c#|cs|swift|kotlin|ruby|php|scala|haskell|ocaml|zig|lua|dart|r|julia)$/i.test(value.trim())
}

function cleanStableProfilePhrase(value: string | undefined): string | undefined {
    const cleaned = (value ?? "").replace(/^[\s"'’`]+|[\s"'’`.,;:!?]+$/g, "").replace(/\s+/g, " ").trim()
    if (cleaned.length < 2 || cleaned.length > 80) return undefined
    if (/\b(?:quel|quelle|what|who|where|when|why|how)\b/i.test(cleaned)) return undefined
    if (/^(?:pas|not|ne\s+pas|rien|nothing|en parler)$/i.test(cleaned)) return undefined
    return cleaned
}

function cleanProfileFactValue(value: string | undefined): string | undefined {
    const cleaned = (value ?? "").replace(/^[\s"'’`]+|[\s"'’`.,;:!?]+$/g, "")
    if (cleaned.length < 2 || cleaned.length > 40) return undefined
    if (!/^[A-ZÀ-ÖØ-Þ][\p{L}'’.-]*$/u.test(cleaned)) return undefined
    if (/^(pas|not|moi|me|nom|name)$/i.test(cleaned)) return undefined
    return cleaned
}

function appendSessionProfileFacts(input: {
    cwd: string
    sessionId: string
    index: SessionMemoryIndex
    source: SessionMemoryIndexEntry
    facts: SessionProfileFact[]
}): SessionMemoryIndex {
    let index = input.index
    for (const fact of input.facts) {
        const sequence = index.last_sequence + 1
        const eventId = `e${String(sequence).padStart(6, "0")}-${shortHash(`${input.sessionId}\nprofile_fact\n${fact.key}\n${fact.value}\n${fact.recorded_at}`)}`
        const activeFact: SessionProfileFact = {
            ...fact,
            status: "active"
        }
        index = supersedeSessionProfileFact(index, activeFact.key, eventId, activeFact.recorded_at)
        const entry = writeSessionProfileFactEntry({
            cwd: input.cwd,
            sessionId: input.sessionId,
            sequence,
            eventId,
            fact: activeFact,
            source: input.source
        })
        index = upsertSessionEntry(index, entry, undefined)
    }
    return index
}

function supersedeSessionProfileFact(index: SessionMemoryIndex, key: string, supersededBy: string, supersededAt: string): SessionMemoryIndex {
    return {
        ...index,
        entries: index.entries.map((entry) => {
            if (entry.profile_fact?.key !== key || entry.profile_fact.status !== "active") return entry
            return {
                ...entry,
                status: "superseded",
                tags: uniqueStrings([...entry.tags.filter((tag) => tag !== "active"), "superseded"]),
                profile_fact: {
                    ...entry.profile_fact,
                    status: "superseded",
                    superseded_by: supersededBy,
                    superseded_at: supersededAt
                }
            }
        })
    }
}

function writeSessionProfileFactEntry(input: {
    cwd: string
    sessionId: string
    sequence: number
    eventId: string
    fact: SessionProfileFact
    source: SessionMemoryIndexEntry
}): SessionMemoryIndexEntry {
    const keyLabel = input.fact.key.replace(/^user\./, "user ")
    const title = `Profile fact ${input.fact.key}`
    const summary = `User profile fact: ${keyLabel} is ${input.fact.value}.`
    const tags = uniqueStrings([
        "session",
        "profile",
        "profile_fact",
        "identity",
        "user",
        ...profileFactKeyTags(input.fact.key),
        input.fact.status
    ])
    const chunkPath = normalizePath(path.join(axiomDir, memoryDir, sessionMemoryDir, input.sessionId, "chunks", `${String(input.sequence).padStart(6, "0")}-${input.eventId}.axmem`))
    const evidence: MemoryEvidence = {
        id: `profile_fact:${input.eventId}`,
        kind: "profile_fact",
        path: chunkPath,
        summary,
        data: {
            schema: "axiom.agent_session_profile_fact.v0",
            session_id: input.sessionId,
            event_id: input.eventId,
            sequence: input.sequence,
            ...input.fact
        }
    }
    const anchors: SessionMemoryAnchor[] = [{
        type: "derived_from",
        from: input.eventId,
        to: input.source.event_id,
        summary: `Profile fact derived from ${input.source.event_id}`,
        weight: 0.95
    }]
    const stratumId = `stratum:profile:${input.sessionId}`
    const nodeStatus: MemoryGraphNodeStatus = input.fact.status === "active" ? "active" : "stale"
    const pack: AgentMemoryPack = {
        schema: "axiom.agent_memory_pack.v0",
        version: 1,
        task: {
            id: normalizeTaskId(`session-${input.sessionId}-${String(input.sequence).padStart(6, "0")}-profile-${input.fact.key}`),
            title: `Session ${input.sessionId} #${input.sequence}: ${title}`,
            tags,
            canonical_tags: collectCanonicalTags(tags),
            agent_tags: tags,
            created_at: input.fact.recorded_at,
            updated_at: input.fact.recorded_at
        },
        summary: {
            goal: "Session profile fact",
            last_completed_step: summary,
            recent_message: summary,
            resume_command: `node dist/cli.js memory session recall --session ${input.sessionId} --event ${input.eventId} --profile focused`
        },
        semantic_refs: [
            { kind: "profile", name: input.fact.key },
            { kind: "session_event", name: input.fact.source_event }
        ],
        decisions: [{ kind: "profile_fact", summary }],
        commands: [],
        next_actions: [],
        invalidated_hypotheses: [],
        evidence: [evidence],
        strata: [{
            id: stratumId,
            part: "profile",
            name: input.fact.key,
            kind: "profile_fact",
            node_ids: [input.eventId, input.source.event_id],
            score_hints: profileFactScoreHints(input.fact)
        }],
        nodes: [
            {
                id: input.eventId,
                part: "profile",
                stratum: stratumId,
                kind: "profile_fact",
                title,
                summary,
                status: nodeStatus,
                tags,
                evidence_refs: [evidence.id],
                score_hints: profileFactScoreHints(input.fact)
            },
            {
                id: input.source.event_id,
                part: "session",
                stratum: stratumId,
                kind: input.source.kind,
                title: input.source.title,
                summary: input.source.summary,
                status: "active",
                evidence_refs: input.source.evidence_refs.map((ref) => ref.id),
                score_hints: [input.source.kind, input.source.title, input.source.summary]
            }
        ],
        anchors: anchors.map((anchor) => ({
            id: graphId("profile-anchor", input.sessionId, anchor.type, anchor.from, anchor.to),
            type: anchor.type,
            from: anchor.from,
            to: anchor.to,
            status: "active",
            summary: anchor.summary,
            evidence_refs: [evidence.id],
            score_hints: uniqueStrings([anchor.type, anchor.summary, anchor.from, anchor.to]),
            weight: anchor.weight
        }))
    }
    const packed = packMemoryPack(pack)
    const absoluteChunkPath = path.join(input.cwd, chunkPath)
    fs.mkdirSync(path.dirname(absoluteChunkPath), { recursive: true })
    fs.writeFileSync(absoluteChunkPath, packed)
    return {
        sequence: input.sequence,
        event_id: input.eventId,
        kind: "profile_fact",
        title,
        summary,
        created_at: input.fact.recorded_at,
        status: input.fact.status,
        profile_fact: input.fact,
        chunk_path: chunkPath,
        tags,
        files: [],
        evidence_preview: summary,
        evidence_chars: jsonCharLength(evidence.data),
        compressed_bytes: packed.length,
        score_hints: profileFactScoreHints(input.fact),
        evidence_refs: memoryEvidenceRefs([evidence]),
        anchors
    }
}

function profileFactKeyTags(key: string): string[] {
    if (key === "user.name") return ["name"]
    if (key === "user.language_preference") return ["preference", "language"]
    if (key.startsWith("user.preference.")) return ["preference", ...key.replace(/^user\.preference\./, "").split(/[._:-]+/).filter(Boolean)]
    if (key.startsWith("user.relation.")) return ["relation", ...key.replace(/^user\.relation\./, "").split(/[._:-]+/).filter(Boolean)]
    if (key === "user.role") return ["role", "identity"]
    if (key.startsWith("user.work.")) return ["work", ...key.replace(/^user\.work\./, "").split(/[._:-]+/).filter(Boolean)]
    return key.split(/[._:-]+/).filter(Boolean)
}

function profileFactScoreHints(fact: SessionProfileFact): string[] {
    const base = [
        fact.key,
        fact.value,
        fact.confidence,
        "profile",
        "profile fact",
        "user profile",
        ...profileFactKeyTags(fact.key)
    ]
    if (fact.key === "user.name") {
        base.push(
            "identity",
            "user identity",
            "user name",
            "my name",
            "what is my name",
            "quel est mon nom",
            "comment je m'appelle",
            "prénom",
            "prenom"
        )
    }
    if (isPreferenceProfileFact(fact)) {
        base.push(
            "preference",
            "user preference",
            "my preference",
            "preferred",
            "what is my preference",
            "quelle est ma préférence",
            "préférence",
            "prefere",
            "préfère"
        )
        if (fact.key === "user.language_preference" || fact.key === "user.preference.language") {
            base.push("language preference", "preferred language", "langue", "français", "anglais")
        }
        if (fact.key === "user.preference.programming_language") {
            base.push("programming language", "preferred programming language", "langage", "langage de programmation", "language")
        }
    }
    if (fact.key.startsWith("user.relation.")) {
        base.push(
            "relation",
            "user relation",
            "family",
            "spouse",
            "wife",
            "husband",
            "partner",
            "femme",
            "mari",
            "compagne",
            "compagnon",
            "wife name",
            "spouse name",
            "what is my wife's name",
            "comment s'appelle ma femme"
        )
    }
    if (fact.key === "user.role") {
        base.push("role", "user role", "my role", "what is my role", "travaille comme")
    }
    if (fact.key.startsWith("user.work.")) {
        base.push("work", "current work", "working on", "je travaille sur", "project")
    }
    return uniqueStrings(base).slice(-80)
}

function sessionAutoAnchors(input: {
    eventId: string
    previousEventId?: string
    files: string[]
    command?: string
    kind: string
    status?: string
}): SessionMemoryAnchor[] {
    const anchors: SessionMemoryAnchor[] = []
    if (input.previousEventId) {
        anchors.push({
            type: "resumes",
            from: input.previousEventId,
            to: input.eventId,
            summary: "Session timeline previous event",
            weight: 0.8
        })
    }
    for (const file of input.files.slice(0, 20)) {
        anchors.push({
            type: sessionFileAnchorType(input.kind),
            from: input.eventId,
            to: sessionFileNodeId(file),
            summary: file,
            weight: 0.75
        })
    }
    if (input.command) {
        anchors.push({
            type: "produced_by",
            from: input.eventId,
            to: sessionCommandNodeId(input.command),
            summary: compactSessionSummary(input.command, 160),
            weight: 0.85
        })
    }
    if (input.status) {
        anchors.push({
            type: "has_status",
            from: input.eventId,
            to: `status:${input.status}`,
            summary: input.status,
            weight: input.status === "ok" || input.status === "passed" ? 0.65 : 0.9
        })
    }
    return anchors
}

function sessionFileAnchorType(kind: string): string {
    if (kind === "grep_result") return "mentions_file"
    if (kind === "patch_applied") return "patches_file"
    if (kind === "file_touched") return "touches_file"
    return "relates_to_file"
}

function sessionFileNodeId(file: string): string {
    return `file:${normalizePath(file)}`
}

function sessionCommandNodeId(command: string): string {
    return `command:${shortHash(command)}`
}

function sessionMemoryGraph(input: {
    sessionId: string
    eventId: string
    kind: string
    title: string
    summary: string
    files: string[]
    evidenceId: string
    anchors: SessionMemoryAnchor[]
    previous?: SessionMemoryIndexEntry
}): { strata: MemoryStratum[]; nodes: MemoryGraphNode[]; anchors: MemoryAnchor[] } {
    const stratumId = `stratum:session:${input.sessionId}`
    const nodes = new Map<string, MemoryGraphNode>()
    const addNode = (node: MemoryGraphNode): void => {
        nodes.set(node.id, node)
    }
    addNode({
        id: input.eventId,
        part: "session",
        stratum: stratumId,
        kind: input.kind,
        title: input.title,
        summary: input.summary,
        status: "active",
        tags: ["session", input.kind],
        evidence_refs: [input.evidenceId],
        score_hints: [input.kind, input.title, input.summary, input.eventId]
    })
    if (input.previous) {
        addNode({
            id: input.previous.event_id,
            part: "session",
            stratum: stratumId,
            kind: input.previous.kind,
            title: input.previous.title,
            summary: input.previous.summary,
            status: "active",
            evidence_refs: input.previous.evidence_refs.map((ref) => ref.id),
            score_hints: [input.previous.kind, input.previous.title, input.previous.summary]
        })
    }
    for (const file of input.files.slice(0, 20)) {
        addNode({
            id: sessionFileNodeId(file),
            part: "session",
            stratum: stratumId,
            kind: "file",
            title: file,
            status: "active",
            score_hints: [file, path.basename(file)]
        })
    }
    for (const anchor of input.anchors) {
        if (anchor.to.startsWith("command:")) {
            addNode({
                id: anchor.to,
                part: "session",
                stratum: stratumId,
                kind: "command",
                title: anchor.summary ?? anchor.to,
                status: "active",
                score_hints: uniqueStrings([anchor.summary, anchor.to])
            })
        }
        if (anchor.to.startsWith("status:")) {
            addNode({
                id: anchor.to,
                part: "session",
                stratum: stratumId,
                kind: "status",
                title: anchor.to.replace(/^status:/, ""),
                status: "active",
                score_hints: [anchor.to]
            })
        }
    }
    const graphAnchors: MemoryAnchor[] = input.anchors.map((anchor) => ({
        id: graphId("session-anchor", input.sessionId, anchor.type, anchor.from, anchor.to, anchor.summary ?? ""),
        type: anchor.type,
        from: anchor.from,
        to: anchor.to,
        status: "active",
        summary: anchor.summary,
        evidence_refs: [input.evidenceId],
        score_hints: uniqueStrings([anchor.type, anchor.summary, anchor.from, anchor.to]),
        weight: anchor.weight
    }))
    return {
        strata: [{
            id: stratumId,
            part: "session",
            name: "timeline",
            kind: "session",
            node_ids: [...nodes.keys()],
            score_hints: ["session", input.sessionId, input.kind]
        }],
        nodes: [...nodes.values()],
        anchors: graphAnchors
    }
}

function sessionMemoryDecisions(kind: string, summary: string): MemoryDecision[] {
    if (kind !== "decision" && kind !== "risk" && kind !== "assistant_update") return []
    return [{
        kind,
        summary
    }]
}

function sessionScoreHints(input: {
    sessionId: string
    eventId: string
    kind: string
    title: string
    summary: string
    text: string
    command?: string
    status?: string
    files: string[]
    tags: string[]
    anchors: SessionMemoryAnchor[]
}): string[] {
    return uniqueStrings([
        input.sessionId,
        input.eventId,
        input.kind,
        input.title,
        input.summary,
        compactSessionEvidence(input.text),
        input.command,
        input.status,
        ...input.files,
        ...input.files.map((file) => path.basename(file)),
        ...input.tags,
        ...input.anchors.flatMap((anchor) => [anchor.type, anchor.summary, anchor.from, anchor.to])
    ]).slice(-160)
}

function extractSessionFileRefs(text: string): string[] {
    const matches = text.match(/(?:[A-Za-z]:[\\/][^\s"'`<>|]+|(?:\.{1,2}[\\/])?[A-Za-z0-9_.-]+(?:[\\/][A-Za-z0-9_.-]+)+)/g) ?? []
    return uniqueStrings(matches.map((item) => item.replace(/[),.;:\]]+$/g, ""))).slice(0, 40)
}

function sessionRecallLimits(profile: MemoryRecallProfile): { event_limit: number; recent_message_limit: number; anchor_limit: number } {
    if (profile === "full") {
        return { event_limit: 100, recent_message_limit: 24, anchor_limit: 100 }
    }
    if (profile === "focused") {
        return { event_limit: 20, recent_message_limit: 12, anchor_limit: 20 }
    }
    return { event_limit: 8, recent_message_limit: 6, anchor_limit: 6 }
}

function scoreSessionEntry(entry: SessionMemoryIndexEntry, input: { query?: string; eventId?: string }): number {
    if (input.eventId) {
        return entry.event_id === input.eventId ? 1000 : 0
    }
    const terms = queryTerms(input.query)
    if (terms.length === 0) {
        return entry.sequence
    }
    const identityQuery = isIdentityProfileQuery(input.query)
    const preferenceQuery = isPreferenceProfileQuery(input.query)
    const relationQuery = isRelationProfileQuery(input.query)
    const roleQuery = isRoleProfileQuery(input.query)
    const workQuery = isWorkProfileQuery(input.query)
    const profileQuery = identityQuery || preferenceQuery || relationQuery || roleQuery || workQuery
    const historyQuery = isProfileHistoryQuery(input.query)
    if (memoryMutationActive("ignore_profile_boost") && profileQuery && entry.profile_fact) {
        return 0
    }
    if (memoryMutationActive("ignore_preference_boost") && preferenceQuery && isPreferenceProfileFact(entry.profile_fact)) {
        return 0
    }
    const scoreHints = entry.score_hints
    const haystack = [
        entry.event_id,
        entry.kind,
        entry.title,
        entry.summary,
        entry.command,
        entry.status,
        entry.profile_fact?.key,
        entry.profile_fact?.value,
        entry.profile_fact?.status,
        entry.profile_fact?.confidence,
        entry.evidence_preview,
        ...entry.tags,
        ...entry.files,
        ...scoreHints,
        ...entry.anchors.flatMap((anchor) => [anchor.type, anchor.summary, anchor.from, anchor.to])
    ].join("\n").toLowerCase()
    let score = 0
    for (const term of terms) {
        if (entry.event_id.toLowerCase() === term) score += 50
        if (entry.kind.toLowerCase() === term) score += 20
        if (entry.tags.some((tag) => tag.toLowerCase() === term)) score += 12
        if (entry.files.some((file) => normalizePath(file).toLowerCase().includes(term))) score += 12
        if (haystack.includes(term)) score += 5
    }
    const activeProfileFact = entry.profile_fact?.status !== "superseded"
    const questionLike = isSessionQuestionLike(entry)

    if (questionLike) {
        if (memoryMutationActive("allow_question_echo") && identityQuery) {
            score += 500
        } else {
            score -= profileQuery ? 80 : 18
        }
    }

    if (entry.profile_fact) {
        if (entry.profile_fact.status === "superseded" && profileQuery && !historyQuery) {
            score -= 120
        }
        if (historyQuery && entry.profile_fact.status === "superseded") {
            score += 160
        }
        if (!memoryMutationActive("ignore_profile_boost") && activeProfileFact) {
            if (identityQuery && entry.profile_fact.key === "user.name" && (!historyQuery || profileFactValueMatchesQuery(input.query, entry.profile_fact.value))) score += 170
            if (preferenceQuery && !memoryMutationActive("ignore_preference_boost") && isPreferenceProfileFact(entry.profile_fact)) score += 170
            if (relationQuery && entry.profile_fact.key.startsWith("user.relation.")) score += 170
            if (roleQuery && entry.profile_fact.key === "user.role") score += 150
            if (workQuery && entry.profile_fact.key.startsWith("user.work.")) score += 150
            for (const term of terms) {
                if (entry.profile_fact.value.toLowerCase().includes(term)) score += 24
            }
        }
    } else if (!memoryMutationActive("ignore_profile_boost") && activeProfileFact && identityQuery && !historyQuery && declaresUserNameFact(entry)) {
        score += 110
    }

    if (entry.status === "superseded" && profileQuery && !historyQuery) {
        score -= 100
    }
    return score
}

function isIdentityProfileQuery(query: string | undefined): boolean {
    const normalized = (query ?? "").toLowerCase()
    return /\b(mon\s+nom|mon\s+pr[ée]nom|m['’]?appelle|nom\s*\?|pr[ée]nom\s*\?|my\s+name|call\s+me|who\s+am\s+i|identity|identit[ée]|user\.name|name)\b/.test(normalized)
}

function isPreferenceProfileQuery(query: string | undefined): boolean {
    const normalized = (query ?? "").toLowerCase()
    return /\b(pr[ée]f[ée]rence|preference|preferred|pr[ée]f[èe]re|langue|language|langage|programmation|programming|fran[çc]ais|anglais)\b/.test(normalized)
}

function isRelationProfileQuery(query: string | undefined): boolean {
    const normalized = (query ?? "").toLowerCase()
    return /\b(relation|spouse|wife|husband|partner|family|femme|mari|compagne|compagnon|conjoint|conjointe)\b/.test(normalized)
}

function isRoleProfileQuery(query: string | undefined): boolean {
    const normalized = (query ?? "").toLowerCase()
    return /\b(role|r[ôo]le|job|m[ée]tier|travaille\s+comme|work\s+as)\b/.test(normalized)
}

function isWorkProfileQuery(query: string | undefined): boolean {
    const normalized = (query ?? "").toLowerCase()
    return /\b(working on|travaille\s+sur|current work|projet courant|work\.current)\b/.test(normalized)
}

function isPreferenceProfileFact(fact: SessionProfileFact | undefined): boolean {
    return fact?.key === "user.language_preference" || fact?.key.startsWith("user.preference.") === true
}

function isProfileHistoryQuery(query: string | undefined): boolean {
    const normalized = (query ?? "").toLowerCase()
    return /\b(history|historique|ancien|ancienne|old|superseded|remplac[ée]|avant)\b/.test(normalized)
}

function profileFactValueMatchesQuery(query: string | undefined, value: string): boolean {
    return (query ?? "").toLowerCase().includes(value.toLowerCase())
}

function isSessionQuestionLike(entry: SessionMemoryIndexEntry): boolean {
    if (entry.profile_fact) return false
    const text = [entry.title, entry.summary, entry.evidence_preview].filter(Boolean).join(" ").toLowerCase()
    if (declaresUserNameFact(entry)) return false
    return text.includes("?")
        || /\b(quel|quelle|comment|pourquoi|quand|peux[-\s]?tu|est[-\s]?ce\s+que|what|who|where|when|how|can\s+you)\b/.test(text)
}

function declaresUserNameFact(entry: SessionMemoryIndexEntry): boolean {
    const text = [entry.summary, entry.evidence_preview, ...entry.score_hints].filter(Boolean).join(" ")
    return extractExplicitUserName(text) !== undefined
}

function sessionRecallItem(
    cwd: string,
    entry: SessionMemoryIndexEntry,
    score: number,
    hydration: MemoryRecallHydration,
    profile: MemoryRecallProfile
): SessionMemoryRecallItem {
    const limits = sessionRecallLimits(profile)
    const fullEvidence = hydration.include_evidence ? hydrateSessionEvidence(cwd, entry) : undefined
    const anchors = entry.anchors.slice(0, limits.anchor_limit)
    return {
        ...entry,
        anchors,
        evidence_preview: profile === "ultra" ? compactSessionEvidence(entry.evidence_preview ?? "") : entry.evidence_preview,
        score,
        truncated: entry.anchors.length > anchors.length || (!hydration.include_evidence && entry.evidence_chars > (entry.evidence_preview?.length ?? 0)),
        full_evidence: fullEvidence
    }
}

function hydrateSessionEvidence(cwd: string, entry: SessionMemoryIndexEntry): MemoryEvidence[] {
    const pack = unpackMemoryPack(fs.readFileSync(path.join(cwd, entry.chunk_path)))
    return pack.evidence
}

function aggregateSessionRecallMetrics(results: SessionMemoryRecallItem[]): MemoryRecallMetrics {
    const rawEvidenceChars = sum(results, (item) => item.evidence_chars)
    const compressedPackBytes = sum(results, (item) => item.compressed_bytes)
    const recallChars = jsonCharLength(results.map((item) => ({
        ...item,
        full_evidence: item.full_evidence ? item.full_evidence.map((evidence) => memoryEvidenceRefs([evidence])[0]) : undefined
    })))
    const estimatedRawTokens = estimateTokens(rawEvidenceChars)
    const estimatedRecallTokens = estimateTokens(recallChars)
    return {
        raw_evidence_chars: rawEvidenceChars,
        compressed_pack_bytes: compressedPackBytes,
        recall_chars: recallChars,
        estimated_raw_tokens: estimatedRawTokens,
        estimated_recall_tokens: estimatedRecallTokens,
        estimated_context_tokens_saved: Math.max(0, estimatedRawTokens - estimatedRecallTokens),
        estimated_context_savings_ratio: savingsRatio(rawEvidenceChars, recallChars),
        json_to_compressed_ratio: ratio(rawEvidenceChars, compressedPackBytes)
    }
}

export function validateMemoryPack(pack: AgentMemoryPack): void {
    validateMemoryPackSchema(pack)
    assertWritableMemoryPackBudget(pack, Buffer.byteLength(JSON.stringify(pack), "utf8"))
    validateMemoryTrustTiers(pack)
}

function validateMemoryPackSchema(pack: AgentMemoryPack): void {
    if (pack.schema !== "axiom.agent_memory_pack.v0" || pack.version !== 1 || !pack.task?.id) {
        throw new Error("axmem: unsupported or invalid memory pack schema")
    }
}

function validateMemoryTrustTiers(pack: AgentMemoryPack): void {
    for (const node of packGraphNodes(pack)) {
        const rawTier = node.trust_tier
        const tier = normalizeTrustTier(node.trust_tier, node.status ?? "active")
        if (node.status === "invalidated" && rawTier !== undefined && rawTier !== "invalidated") {
            throw new Error(`axmem trust: invalidated node '${node.id}' cannot be tier ${rawTier}`)
        }
        if (rawTier === "invalidated" && node.status !== "invalidated") {
            throw new Error(`axmem trust: tier invalidated node '${node.id}' must have invalidated status`)
        }
        if (tier === "proved" && (node.evidence_refs ?? []).length === 0) {
            throw new Error(`axmem trust: proved node '${node.id}' requires evidence_refs`)
        }
    }
}

function readExistingPack(cwd: string, packPath: string): AgentMemoryPack | undefined {
    const absolute = path.join(cwd, packPath)
    if (!fs.existsSync(absolute)) return undefined
    return readMemoryPackFileRepairing(absolute).pack
}

function writeMemoryPackFile(cwd: string, packPath: string, pack: AgentMemoryPack): Buffer {
    const absolutePath = memoryPackAbsolutePath(cwd, packPath)
    const packed = packMemoryPack(pack)
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true })
    fs.writeFileSync(absolutePath, packed)
    updateMemoryPackCacheAfterWrite(cwd, packPath, pack, packed)
    return packed
}

export function stageMemoryPackInHotTier(input: {
    cwd: string
    pack: AgentMemoryPack
    packPath?: string
    pinned?: boolean
    pinReason?: string
}): MemoryTierStageResult {
    const packPath = normalizePath(input.packPath ?? path.join(axiomDir, memoryDir, `${normalizeTaskId(input.pack.task.id)}.axmem`))
    const absolutePath = memoryPackAbsolutePath(input.cwd, packPath)
    const packed = packMemoryPack(input.pack)
    const key = memoryPackCacheKey(input.cwd, packPath)
    const previous = memoryPackCache.get(key)
    if (previous) {
        memoryPackCacheBytes -= previous.compressed_bytes
    }
    const entry: MemoryPackCacheEntry = {
        file_path: packPath,
        absolute_path: normalizePath(absolutePath),
        content_hash: shortBufferHash(packed),
        mtime_ms: 0,
        size: 0,
        compressed_bytes: packed.length,
        persisted: false,
        dirty: true,
        pinned: input.pinned ?? previous?.pinned ?? false,
        pin_reason: input.pinReason ?? previous?.pin_reason,
        access_count: (previous?.access_count ?? 0) + 1,
        last_accessed_ms: Date.now(),
        pack: input.pack
    }
    memoryPackCache.set(key, entry)
    memoryPackCacheBytes += entry.compressed_bytes
    return {
        schema: "axiom.agent_memory_tier_stage.v0",
        status: "ok",
        pack_path: packPath,
        compressed_bytes: packed.length,
        pinned: entry.pinned
    }
}

export function getMemoryTierCacheStats(): MemoryTierCacheStats {
    const entries = [...memoryPackCache.values()]
        .map((entry): MemoryTierCacheEntryStats => ({
            pack_path: entry.file_path,
            compressed_bytes: entry.compressed_bytes,
            persisted: entry.persisted,
            dirty: entry.dirty,
            pinned: entry.pinned,
            access_count: entry.access_count
        }))
        .sort((left, right) => left.pack_path.localeCompare(right.pack_path))
    return {
        schema: "axiom.agent_memory_tier_cache_stats.v0",
        pack_cache_entries: memoryPackCache.size,
        pack_cache_bytes: memoryPackCacheBytes,
        pack_cache_max_bytes: MEMORY_PACK_CACHE_MAX_COMPRESSED_BYTES,
        pinned_entries: entries.filter((entry) => entry.pinned).length,
        dirty_entries: entries.filter((entry) => entry.dirty).length,
        entries
    }
}

export function clearMemoryTierCaches(): void {
    memoryPackCache.clear()
    memoryPackCacheBytes = 0
}

export function pinMemoryPackTierEntry(input: { cwd: string; packPath: string; reason?: string }): boolean {
    const key = memoryPackCacheKey(input.cwd, input.packPath)
    const entry = memoryPackCache.get(key) ?? readMemoryPackCached(input.cwd, input.packPath).cache_entry
    entry.pinned = true
    entry.pin_reason = input.reason
    touchMemoryPackCacheEntry(key, entry)
    return true
}

export function unpinMemoryPackTierEntry(input: { cwd: string; packPath: string }): boolean {
    const key = memoryPackCacheKey(input.cwd, input.packPath)
    const entry = memoryPackCache.get(key)
    if (!entry) return false
    entry.pinned = false
    entry.pin_reason = undefined
    touchMemoryPackCacheEntry(key, entry)
    return true
}

export function promoteMemoryPackTierEntry(input: { cwd: string; packPath: string }): boolean {
    const key = memoryPackCacheKey(input.cwd, input.packPath)
    const entry = memoryPackCache.get(key)
    if (!entry) return false
    touchMemoryPackCacheEntry(key, entry)
    return true
}

export function evictMemoryTiers(input: { cwd?: string; maxCompressedBytes?: number } = {}): MemoryTierEvictionResult {
    return pruneMemoryPackCache(input.maxCompressedBytes ?? MEMORY_PACK_CACHE_MAX_COMPRESSED_BYTES, input.cwd)
}

function readMemoryPackCached(basePath: string, packPath: string): { pack: AgentMemoryPack; compressed_bytes: number; cache_entry: MemoryPackCacheEntry } {
    const absolutePath = path.join(basePath, packPath)
    const absoluteKey = normalizePath(path.resolve(absolutePath))
    let bytes: Buffer = fs.readFileSync(absolutePath)
    let contentHash = shortBufferHash(bytes)
    let stat = fs.statSync(absolutePath)
    const cached = memoryPackCache.get(absoluteKey)
    if (cached?.content_hash === contentHash) {
        touchMemoryPackCacheEntry(absoluteKey, cached)
        return {
            pack: cached.pack,
            compressed_bytes: cached.compressed_bytes,
            cache_entry: cached
        }
    }

    if (cached) {
        memoryPackCacheBytes -= cached.compressed_bytes
        memoryPackCache.delete(absoluteKey)
    }

    const repaired = unpackMemoryPackRepairing(bytes)
    const pack = repaired.pack
    if (repaired.repaired) {
        bytes = packMemoryPack(pack)
        fs.writeFileSync(absolutePath, bytes)
        contentHash = shortBufferHash(bytes)
        stat = fs.statSync(absolutePath)
    }
    const entry: MemoryPackCacheEntry = {
        file_path: normalizePath(packPath),
        absolute_path: normalizePath(path.resolve(absolutePath)),
        content_hash: contentHash,
        mtime_ms: stat.mtimeMs,
        size: stat.size,
        compressed_bytes: bytes.length,
        persisted: true,
        dirty: false,
        pinned: cached?.pinned ?? false,
        pin_reason: cached?.pin_reason,
        access_count: (cached?.access_count ?? 0) + 1,
        last_accessed_ms: Date.now(),
        pack
    }
    memoryPackCache.set(absoluteKey, entry)
    memoryPackCacheBytes += entry.compressed_bytes
    pruneMemoryPackCache()
    return {
        pack,
        compressed_bytes: bytes.length,
        cache_entry: entry
    }
}

function memoryPackAbsolutePath(cwd: string, packPath: string): string {
    return path.resolve(path.join(cwd, packPath))
}

function memoryPackCacheKey(cwd: string, packPath: string): string {
    return normalizePath(memoryPackAbsolutePath(cwd, packPath))
}

function removeMemoryPackCacheEntry(cwd: string, packPath: string): void {
    const key = memoryPackCacheKey(cwd, packPath)
    const entry = memoryPackCache.get(key)
    if (!entry) return
    memoryPackCacheBytes -= entry.compressed_bytes
    memoryPackCache.delete(key)
}

function updateMemoryPackCacheAfterWrite(cwd: string, packPath: string, pack: AgentMemoryPack, packed: Buffer): void {
    const absolutePath = memoryPackAbsolutePath(cwd, packPath)
    const key = normalizePath(absolutePath)
    const previous = memoryPackCache.get(key)
    if (previous) {
        memoryPackCacheBytes -= previous.compressed_bytes
    }
    const stat = fs.statSync(absolutePath)
    const entry: MemoryPackCacheEntry = {
        file_path: normalizePath(packPath),
        absolute_path: normalizePath(absolutePath),
        content_hash: shortBufferHash(packed),
        mtime_ms: stat.mtimeMs,
        size: stat.size,
        compressed_bytes: packed.length,
        persisted: true,
        dirty: false,
        pinned: previous?.pinned ?? false,
        pin_reason: previous?.pin_reason,
        access_count: (previous?.access_count ?? 0) + 1,
        last_accessed_ms: Date.now(),
        pack
    }
    memoryPackCache.set(key, entry)
    memoryPackCacheBytes += entry.compressed_bytes
    pruneMemoryPackCache()
}

function touchMemoryPackCacheEntry(key: string, entry: MemoryPackCacheEntry): void {
    entry.access_count += 1
    entry.last_accessed_ms = Date.now()
    memoryPackCache.delete(key)
    memoryPackCache.set(key, entry)
}

function readMemoryPackFileRepairing(absolutePath: string): { pack: AgentMemoryPack; compressed_bytes: number; repaired: boolean } {
    const bytes = fs.readFileSync(absolutePath)
    const result = unpackMemoryPackRepairing(bytes)
    if (!result.repaired) {
        return { pack: result.pack, compressed_bytes: bytes.length, repaired: false }
    }

    const repairedBytes = packMemoryPack(result.pack)
    fs.writeFileSync(absolutePath, repairedBytes)
    return { pack: result.pack, compressed_bytes: repairedBytes.length, repaired: true }
}

function unpackMemoryPackRepairing(bytes: Buffer | Uint8Array): { pack: AgentMemoryPack; repaired: boolean } {
    try {
        return { pack: unpackMemoryPack(bytes), repaired: false }
    } catch (error) {
        if (!isMemoryPackBudgetError(error)) throw error
        const decoded = decodeMemoryPack(bytes)
        validateMemoryPackSchema(decoded)
        validateMemoryTrustTiers(decoded)
        return { pack: repairLegacyMemoryPackBudget(decoded), repaired: true }
    }
}

function isMemoryPackBudgetError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error)
    return message.includes("evidence count") && message.includes("exceeds budget")
        || message.includes("pack JSON size") && message.includes("exceeds budget")
}

function repairLegacyMemoryPackBudget(pack: AgentMemoryPack): AgentMemoryPack {
    let repaired: AgentMemoryPack = {
        ...pack,
        semantic_refs: pack.semantic_refs.slice(-120),
        decisions: pack.decisions.slice(-100),
        commands: pack.commands.slice(-100),
        next_actions: pack.next_actions.slice(-100),
        invalidated_hypotheses: pack.invalidated_hypotheses?.slice(-100),
        evidence: boundMemoryEvidence(pack.evidence),
        strata: pack.strata?.slice(-400),
        nodes: pack.nodes?.slice(-600),
        anchors: pack.anchors?.slice(-800)
    }

    while (Buffer.byteLength(JSON.stringify(repaired), "utf8") > MEMORY_PACK_JSON_CHAR_LIMIT && repaired.evidence.length > 0) {
        repaired = {
            ...repaired,
            evidence: repaired.evidence.slice(1)
        }
    }

    if (Buffer.byteLength(JSON.stringify(repaired), "utf8") <= MEMORY_PACK_JSON_CHAR_LIMIT) {
        validateMemoryPack(repaired)
        return repaired
    }

    const compacted: AgentMemoryPack = {
        ...repaired,
        summary: compactMemorySummaryPreview(repaired.summary),
        semantic_refs: repaired.semantic_refs.slice(-40),
        decisions: repaired.decisions.slice(-20).map(compactMemoryDecisionPreview),
        commands: repaired.commands.slice(-20).map(compactMemoryCommandPreview),
        next_actions: repaired.next_actions.slice(-20).map((action) => compactMemoryText(action, MEMORY_INDEX_TEXT_PREVIEW_CHAR_LIMIT)),
        invalidated_hypotheses: repaired.invalidated_hypotheses?.slice(-20).map(compactMemoryInvalidatedPreview),
        evidence: [{
            id: "legacy_budget_repair",
            kind: "legacy_budget_repair",
            summary: "Legacy over-budget pack was compacted during AXMEM repair",
            data: {
                schema: "axiom.agent_memory_legacy_budget_repair.v0",
                original_pack_json_chars: Buffer.byteLength(JSON.stringify(pack), "utf8"),
                original_evidence_count: pack.evidence.length
            }
        }],
        strata: undefined,
        nodes: undefined,
        anchors: undefined
    }
    validateMemoryPack(compacted)
    return compacted
}

function pruneMemoryPackCache(maxCompressedBytes = MEMORY_PACK_CACHE_MAX_COMPRESSED_BYTES, cwd?: string): MemoryTierEvictionResult {
    const cwdPrefix = cwd ? `${normalizePath(path.resolve(cwd)).toLowerCase()}/` : undefined
    const evictedPackPaths: string[] = []
    const blockedPackPaths: string[] = []
    let skippedPinnedCount = 0
    let persistedBeforeEvictCount = 0

    while (scopedMemoryPackCacheBytes(cwdPrefix) > maxCompressedBytes && memoryPackCache.size > 0) {
        const scopedEntries = [...memoryPackCache.entries()].filter(([, entry]) => {
            if (!cwdPrefix) return true
            return entry.absolute_path.toLowerCase().startsWith(cwdPrefix)
        })
        if (scopedEntries.length === 0) break
        const candidates = scopedEntries
            .filter(([, entry]) => !entry.pinned)
            .sort((left, right) => compareMemoryPackEvictionCandidate(left[1], right[1]))
        skippedPinnedCount = scopedEntries.length - candidates.length
        const candidate = candidates[0]
        if (!candidate) break

        const [key, entry] = candidate
        const needsPersist = entry.dirty || !entry.persisted || !fs.existsSync(entry.absolute_path)
        if (needsPersist) {
            const persisted = persistMemoryPackCacheEntryBeforeEvict(entry)
            if (!persisted || entry.dirty || !entry.persisted || !fs.existsSync(entry.absolute_path)) {
                blockedPackPaths.push(entry.file_path)
                break
            }
            persistedBeforeEvictCount += 1
        }

        memoryPackCacheBytes -= entry.compressed_bytes
        memoryPackCache.delete(key)
        evictedPackPaths.push(entry.file_path)
    }

    return {
        schema: "axiom.agent_memory_tier_eviction.v0",
        status: blockedPackPaths.length === 0 ? "ok" : "blocked",
        requested_max_bytes: maxCompressedBytes,
        evicted_count: evictedPackPaths.length,
        evicted_pack_paths: evictedPackPaths,
        skipped_pinned_count: skippedPinnedCount,
        persisted_before_evict_count: persistedBeforeEvictCount,
        blocked_pack_paths: blockedPackPaths,
        remaining_pack_cache_bytes: memoryPackCacheBytes,
        remaining_pack_cache_entries: memoryPackCache.size
    }
}

function scopedMemoryPackCacheBytes(cwdPrefix: string | undefined): number {
    if (!cwdPrefix) return memoryPackCacheBytes
    return sum([...memoryPackCache.values()].filter((entry) => entry.absolute_path.toLowerCase().startsWith(cwdPrefix)), (entry) => entry.compressed_bytes)
}

function compareMemoryPackEvictionCandidate(left: MemoryPackCacheEntry, right: MemoryPackCacheEntry): number {
    const leftScore = memoryPackEvictionScore(left)
    const rightScore = memoryPackEvictionScore(right)
    return leftScore - rightScore || left.last_accessed_ms - right.last_accessed_ms || left.file_path.localeCompare(right.file_path)
}

function memoryPackEvictionScore(entry: MemoryPackCacheEntry): number {
    return entry.access_count * 10 + entry.last_accessed_ms / 1_000_000
}

function persistMemoryPackCacheEntryBeforeEvict(entry: MemoryPackCacheEntry): boolean {
    if (memoryMutationActive("drop_write_before_evict")) {
        return false
    }
    const previousBytes = entry.compressed_bytes
    const packed = packMemoryPack(entry.pack)
    fs.mkdirSync(path.dirname(entry.absolute_path), { recursive: true })
    fs.writeFileSync(entry.absolute_path, packed)
    const stat = fs.statSync(entry.absolute_path)
    entry.content_hash = shortBufferHash(packed)
    entry.mtime_ms = stat.mtimeMs
    entry.size = stat.size
    entry.compressed_bytes = packed.length
    entry.persisted = true
    entry.dirty = false
    memoryPackCacheBytes += entry.compressed_bytes - previousBytes
    return true
}

function sessionEntryMatches(entry: SessionLogEntry, taskId: string, context: AgentContext | undefined): boolean {
    const text = [
        entry.kind,
        entry.module,
        entry.target,
        entry.out_dir,
        entry.status,
        entry.summary,
        entry.source,
        entry.old_source,
        ...(entry.commands ?? [])
    ].filter(Boolean).join("\n").toLowerCase()
    return text.includes(taskId.toLowerCase()) || (!!context?.module && entry.module === context.module)
}

function checkpointMatches(raw: string, taskId: string, context: AgentContext | undefined): boolean {
    const lower = raw.toLowerCase()
    return lower.includes(taskId.toLowerCase()) || (!!context?.module && lower.includes(context.module.toLowerCase()))
}

function normalizeTaskId(taskId: string): string {
    const normalized = taskId.trim().replace(/[^A-Za-z0-9_.-]/g, "_")
    if (!normalized) {
        throw new Error("memory: --task must not be empty")
    }
    return normalized
}

function normalizeProjectId(projectId: string): string {
    const normalized = projectId.trim().replace(/[^A-Za-z0-9_.-]/g, "_")
    if (!normalized) {
        throw new Error("memory: --project must not be empty")
    }
    return normalized
}

function normalizeTag(value: string): string | undefined {
    const normalized = value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_.-]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")
    return normalized || undefined
}

function uniqueStrings(values: (string | undefined)[]): string[] {
    return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => !!value))]
}

function uniqueStringsByLastOccurrence(values: (string | undefined)[]): string[] {
    const seen = new Set<string>()
    const out: string[] = []
    const normalized = values.map((value) => value?.trim()).filter((value): value is string => !!value)

    for (let index = normalized.length - 1; index >= 0; index -= 1) {
        const value = normalized[index]
        if (seen.has(value)) continue
        seen.add(value)
        out.push(value)
    }

    return out.reverse()
}

function uniqueBy<T>(values: T[], keyOf: (value: T) => string): T[] {
    const seen = new Set<string>()
    const out: T[] = []

    for (const value of values) {
        const key = keyOf(value)
        if (seen.has(key)) continue
        seen.add(key)
        out.push(value)
    }

    return out
}

function normalizePath(value: string): string {
    return value.replace(/\\/g, "/")
}
