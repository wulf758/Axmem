export type AgentContext = {
    schema: "axiom.context.v0"
    module: string
    target?: string
    out_dir?: string
    current_goal: string
    last_completed_step: string
    next_recommended_step: string
    active_semantic_nodes: { kind: string; name: string }[]
    last_changes: { kind: string; node?: string; summary: string; reason?: string }[]
    open_questions: { id: string; question: string; status: string }[]
    diagnostic_summary: { errors: number; warnings: number; invariants_preserved: number; invariants_blocked: number }
    test_runs?: TestRunRecord[]
    resume_prompt: string
}

export type TestRunRecord = {
    schema: "axiom.test_run.v0"
    module: string
    target: string
    out_dir: string
    command: string
    status: "ok" | "failed"
    exit_code: number | null
    passed?: number
    failed?: number
    duration_ms: number
    updated_at: string
    summary: string
}

export type ContextHistory = { schema: "axiom.context_history.v0"; entries: ContextHistoryEntry[] }

export type ContextHistoryEntry = {
    module: string
    target?: string
    out_dir?: string
    status: "ok" | "blocked"
    updated_at: string
    current_goal: string
    last_completed_step: string
    next_recommended_step: string
    diagnostic_summary: AgentContext["diagnostic_summary"]
    test_result?: TestRunRecord
}

export type SessionLogEntry = {
    schema: "axiom.session_log.v0"
    time: string
    kind: string
    module?: string
    target?: string
    out_dir?: string
    status?: string
    summary?: string
    source?: string
    old_source?: string
    commands?: string[]
    result?: Record<string, unknown>
}

export type AxmemContextProvider = {
    readContext?: (cwd: string) => AgentContext | undefined
    readContextHistory?: (cwd: string) => ContextHistory
    readSessionLog?: (cwd: string) => SessionLogEntry[]
}

let provider: AxmemContextProvider = {}

export function setAxmemContextProvider(nextProvider: AxmemContextProvider): void {
    provider = nextProvider
}

export function clearAxmemContextProvider(): void {
    provider = {}
}

export function readContext(cwd: string): AgentContext | undefined {
    return provider.readContext?.(cwd)
}

export function readContextHistory(cwd: string): ContextHistory {
    return provider.readContextHistory?.(cwd) ?? { schema: "axiom.context_history.v0", entries: [] }
}

export function readSessionLog(cwd: string): SessionLogEntry[] {
    return provider.readSessionLog?.(cwd) ?? []
}
