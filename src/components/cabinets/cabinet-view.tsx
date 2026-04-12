"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Bot,
  CheckCircle2,
  Clock3,
  FolderOpen,
  FolderTree,
  HeartPulse,
  Loader2,
  MessageSquare,
  Send,
  Users,
  XCircle,
} from "lucide-react";
import type { ConversationMeta } from "@/types/conversations";
import { KBEditor } from "@/components/editor/editor";
import { HeaderActions } from "@/components/layout/header-actions";
import { VersionHistory } from "@/components/editor/version-history";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { cronToHuman, cronToShortLabel } from "@/lib/agents/cron-utils";
import { CABINET_VISIBILITY_OPTIONS } from "@/lib/cabinets/visibility";
import { useEditorStore } from "@/stores/editor-store";
import { useTreeStore } from "@/stores/tree-store";
import { useAppStore } from "@/stores/app-store";
import { cn } from "@/lib/utils";
import type {
  CabinetAgentSummary,
  CabinetJobSummary,
  CabinetOverview,
} from "@/types/cabinets";

function startCase(value: string | undefined, fallback = "General"): string {
  if (!value) return fallback;
  const words = value.trim().split(/[\s_-]+/).filter(Boolean);
  if (words.length === 0) return fallback;
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

function rankAgentType(type?: string): number {
  if (type === "lead") return 0;
  if (type === "specialist") return 1;
  if (type === "support") return 2;
  return 3;
}

function sortOrgAgents(a: CabinetAgentSummary, b: CabinetAgentSummary): number {
  if (a.cabinetDepth !== b.cabinetDepth) return a.cabinetDepth - b.cabinetDepth;
  const typeRank = rankAgentType(a.type) - rankAgentType(b.type);
  if (typeRank !== 0) return typeRank;
  if ((b.active ? 1 : 0) !== (a.active ? 1 : 0)) return (b.active ? 1 : 0) - (a.active ? 1 : 0);
  return a.name.localeCompare(b.name);
}

/* ─── Inline Metric ─── */
function StatPill({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div className="min-w-[84px]">
      <p
        className={cn(
          "font-body-serif text-[1.9rem] leading-none tracking-tight text-foreground",
          highlight && "text-primary"
        )}
      >
        {value}
      </p>
      <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/65">
        {label}
      </p>
    </div>
  );
}

/* ─── Agents List ─── */
function CompactOrgChart({
  cabinetName,
  agents,
  jobs,
  children,
  onAgentClick,
  onAgentSend,
  onChildCabinetClick,
}: {
  cabinetName: string;
  agents: CabinetAgentSummary[];
  jobs: CabinetJobSummary[];
  children: CabinetOverview["children"];
  onAgentClick?: (agent: CabinetAgentSummary) => void;
  onAgentSend?: (agent: CabinetAgentSummary) => void;
  onChildCabinetClick?: (cabinet: CabinetOverview["children"][number]) => void;
}) {
  const allAgents = [...agents].sort(sortOrgAgents);
  const grouped = Object.entries(
    allAgents.reduce<Record<string, CabinetAgentSummary[]>>((acc, agent) => {
      const dept = agent.department || "general";
      if (!acc[dept]) acc[dept] = [];
      acc[dept].push(agent);
      return acc;
    }, {})
  )
    .sort(([l], [r]) => {
      if (l === "executive") return -1;
      if (r === "executive") return 1;
      if (l === "general") return 1;
      if (r === "general") return -1;
      return startCase(l).localeCompare(startCase(r));
    })
    .map(([dept, deptAgents]) => ({
      dept,
      label: startCase(dept),
      agents: deptAgents.sort(sortOrgAgents),
    }));
  const groupedRows = grouped.reduce<typeof grouped[]>((rows, group, index) => {
    const rowIndex = Math.floor(index / 4);
    if (!rows[rowIndex]) rows[rowIndex] = [];
    rows[rowIndex].push(group);
    return rows;
  }, []);

  const connectorColor = "rgba(139, 94, 60, 0.26)";
  const rootFill = "rgba(139, 94, 60, 0.1)";
  const rootBorder = "rgba(139, 94, 60, 0.2)";

  function jobsForAgent(agent: CabinetAgentSummary) {
    return jobs.filter((job) => {
      if (job.ownerScopedId) return job.ownerScopedId === agent.scopedId;
      return job.ownerAgent === agent.slug && job.cabinetPath === agent.cabinetPath;
    });
  }

  function VerticalConnector({ height = 18 }: { height?: number }) {
    return (
      <div
        className="mx-auto w-px"
        style={{ height, backgroundColor: connectorColor }}
      />
    );
  }

  function HorizontalBranch({ count }: { count: number }) {
    if (count <= 1) return <VerticalConnector height={14} />;

    const edgeInset = count <= 2 ? 25 : count <= 3 ? 16.67 : 12.5;
    const spacing = count <= 1 ? 0 : (100 - edgeInset * 2) / (count - 1);

    return (
      <div className="relative mx-5 h-4">
        <div
          className="absolute top-0 h-px"
          style={{
            left: `${edgeInset}%`,
            right: `${edgeInset}%`,
            backgroundColor: connectorColor,
          }}
        />
        {Array.from({ length: count }).map((_, index) => (
          <div
            key={index}
            className="absolute top-0 w-px"
            style={{
              left: `${edgeInset + index * spacing}%`,
              height: 16,
              backgroundColor: connectorColor,
            }}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto pb-2">
      {allAgents.length === 0 ? (
        <p className="py-8 text-sm text-muted-foreground">No agents configured for this cabinet yet.</p>
      ) : (
        <div className="min-w-[720px] px-2">
          <div className="flex justify-center">
            <div
              className="inline-flex items-center gap-2 rounded-xl border px-4 py-2.5"
              style={{ backgroundColor: rootFill, borderColor: rootBorder }}
            >
              <FolderTree className="h-4 w-4 shrink-0 text-[rgb(139,94,60)]" />
              <div>
                <p className="text-sm font-semibold text-foreground">{cabinetName}</p>
                <p className="text-[10px] text-muted-foreground">
                  {agents.length} visible agent{agents.length === 1 ? "" : "s"}
                </p>
              </div>
            </div>
          </div>

          {groupedRows.map((row, rowIndex) => (
            <div key={`row-${rowIndex}`}>
              <VerticalConnector height={20} />
              <HorizontalBranch count={row.length} />
              <div
                className="grid gap-4"
                style={{ gridTemplateColumns: `repeat(${row.length}, minmax(0, 1fr))` }}
              >
                {row.map((group) => (
                  <div key={group.dept} className="flex flex-col items-center">
                    <div
                      className="inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5"
                      style={{
                        backgroundColor: "rgba(139, 94, 60, 0.05)",
                        borderColor: "rgba(139, 94, 60, 0.16)",
                      }}
                    >
                      <FolderOpen className="h-3.5 w-3.5 shrink-0 text-[rgb(139,94,60)]" />
                      <span className="text-xs font-medium text-foreground">{group.label}</span>
                    </div>
                    <VerticalConnector height={10} />
                    <div className="flex w-full flex-col items-center gap-2">
                      {group.agents.map((agent) => {
                        const agentJobs = jobsForAgent(agent);

                        return (
                          <div key={agent.scopedId} className="flex w-full flex-col items-center gap-1.5">
                            <div className="flex w-full max-w-[220px] items-stretch gap-1.5">
                              <button
                                type="button"
                                onClick={() => onAgentClick?.(agent)}
                                className={cn(
                                  "flex min-w-0 flex-1 items-center gap-2 rounded-xl border bg-background px-3 py-2 text-left transition-colors",
                                  onAgentClick && "hover:bg-muted/30"
                                )}
                                style={{ borderColor: "rgba(139, 94, 60, 0.14)" }}
                              >
                                <span className="text-base leading-none">{agent.emoji || "🤖"}</span>
                                <div className="min-w-0 flex-1">
                                  <p className="truncate text-[12px] font-medium text-foreground">
                                    {agent.name}
                                  </p>
                                  <p className="truncate text-[10px] text-muted-foreground">
                                    {agent.role}
                                    {agent.inherited ? ` · ${agent.cabinetName}` : ""}
                                  </p>
                                </div>
                                <span
                                  className={cn(
                                    "h-1.5 w-1.5 rounded-full shrink-0",
                                    agent.active ? "bg-emerald-500" : "bg-muted-foreground/30"
                                  )}
                                />
                              </button>

                              {onAgentSend ? (
                                <button
                                  type="button"
                                  onClick={() => onAgentSend(agent)}
                                  className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border bg-background text-foreground transition-colors hover:bg-muted/30"
                                  style={{ borderColor: "rgba(139, 94, 60, 0.14)" }}
                                  aria-label={`Open chat with ${agent.name}`}
                                  title={`Open chat with ${agent.name}`}
                                >
                                  <Send className="h-3.5 w-3.5" />
                                </button>
                              ) : null}
                            </div>

                            {agentJobs.length > 0 ? (
                              <div className="flex w-full flex-col items-center gap-1">
                                {agentJobs.map((job) => (
                                  <div
                                    key={job.scopedId}
                                    className="flex w-full max-w-[182px] items-center gap-1.5 rounded-lg border bg-muted/15 px-2.5 py-1.5"
                                    style={{ borderColor: "rgba(139, 94, 60, 0.12)" }}
                                  >
                                    <Clock3 className="h-3 w-3 shrink-0 text-[rgb(139,94,60)]" />
                                    <div className="min-w-0 flex-1">
                                      <p className="truncate text-[10px] font-medium text-foreground">
                                        {job.name}
                                      </p>
                                      <p className="truncate text-[9px] text-muted-foreground">
                                        {cronToShortLabel(job.schedule)}
                                      </p>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}

          {children.length > 0 ? (
            <div className="mt-8">
              <div className="flex flex-wrap gap-3">
                {children.map((child) => (
                  <button
                    key={child.path}
                    type="button"
                    onClick={() => onChildCabinetClick?.(child)}
                    className={cn(
                      "inline-flex items-center gap-2 rounded-xl border bg-background px-3 py-2 text-left transition-colors",
                      onChildCabinetClick && "hover:bg-muted/30"
                    )}
                    style={{ borderColor: "rgba(139, 94, 60, 0.14)" }}
                  >
                    <FolderTree className="h-3.5 w-3.5 shrink-0 text-[rgb(139,94,60)]" />
                    <div>
                      <p className="text-[12px] font-medium text-foreground">{child.name}</p>
                      <p className="text-[10px] text-muted-foreground">
                        depth {child.cabinetDepth ?? 1}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

/* ─── Schedules Panel ─── */
function SchedulesPanel({
  agents,
  jobs,
}: {
  agents: CabinetAgentSummary[];
  jobs: CabinetJobSummary[];
}) {
  const agentNameBySlug = useMemo(
    () => new Map(agents.map((a) => [a.scopedId, a.name])),
    [agents]
  );
  const heartbeatAgents = agents
    .filter((a) => a.heartbeat)
    .sort((l, r) => l.name.localeCompare(r.name));
  const jobsWithOwners = jobs.map((job) => ({
    ...job,
    ownerName: job.ownerScopedId
      ? agentNameBySlug.get(job.ownerScopedId) || job.ownerAgent || null
      : job.ownerAgent || null,
  }));

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-[1.65rem] font-semibold tracking-tight text-foreground">
          Jobs and heartbeats
        </h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {jobsWithOwners.length} scheduled jobs and {heartbeatAgents.length} active heartbeats in this scope.
        </p>
      </div>

      <div>
        <h3 className="text-sm font-medium text-foreground">Scheduled jobs</h3>
        <div className="mt-3 border-t border-border/70">
          {jobsWithOwners.length > 0 ? (
            jobsWithOwners.map((job) => (
              <div key={job.scopedId} className="flex items-start gap-3 border-b border-border/60 py-3">
                <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted/40">
                  <Clock3 className="h-3.5 w-3.5 text-muted-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{job.name}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {job.ownerName ? `${job.ownerName} · ` : ""}
                    {cronToHuman(job.schedule)}
                  </p>
                </div>
                <span
                  className={cn(
                    "mt-0.5 shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
                    job.enabled
                      ? "bg-emerald-500/12 text-emerald-500"
                      : "bg-muted text-muted-foreground"
                  )}
                >
                  {job.enabled ? "On" : "Off"}
                </span>
              </div>
            ))
          ) : (
            <p className="py-4 text-sm text-muted-foreground">No cabinet jobs configured yet.</p>
          )}
        </div>
      </div>

      <div>
        <h3 className="text-sm font-medium text-foreground">Heartbeats</h3>
        <div className="mt-3 border-t border-border/70">
          {heartbeatAgents.length > 0 ? (
            heartbeatAgents.map((agent) => (
              <div key={agent.scopedId} className="flex items-center gap-3 border-b border-border/60 py-3">
                <span className="text-lg leading-none shrink-0">{agent.emoji || "🤖"}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{agent.name}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {cronToHuman(agent.heartbeat || "")}
                  </p>
                </div>
                <span className="shrink-0 rounded-full bg-primary/8 px-2.5 py-0.5 text-[10px] font-medium text-primary">
                  {cronToShortLabel(agent.heartbeat || "")}
                </span>
              </div>
            ))
          ) : (
            <p className="py-4 text-sm text-muted-foreground">No heartbeats configured yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Conversations helpers ─── */

function formatRelative(iso: string): string {
  const delta = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(delta / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

const TRIGGER_STYLES: Record<ConversationMeta["trigger"], string> = {
  manual: "bg-sky-500/12 text-sky-400 ring-1 ring-sky-500/20",
  job: "bg-emerald-500/12 text-emerald-400 ring-1 ring-emerald-500/20",
  heartbeat: "bg-pink-500/12 text-pink-400 ring-1 ring-pink-500/20",
};

const TRIGGER_LABELS: Record<ConversationMeta["trigger"], string> = {
  manual: "Manual",
  job: "Job",
  heartbeat: "Heartbeat",
};

function TriggerIcon({ trigger }: { trigger: ConversationMeta["trigger"] }) {
  if (trigger === "job") return <Clock3 className="h-2.5 w-2.5" />;
  if (trigger === "heartbeat") return <HeartPulse className="h-2.5 w-2.5" />;
  return <Bot className="h-2.5 w-2.5" />;
}

function StatusIcon({ status }: { status: ConversationMeta["status"] }) {
  if (status === "running") return <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />;
  if (status === "completed") return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />;
  if (status === "failed") return <XCircle className="h-3.5 w-3.5 text-destructive" />;
  return <XCircle className="h-3.5 w-3.5 text-muted-foreground/40" />;
}

/* ─── Task Composer ─── */
function CabinetTaskComposer({
  cabinetPath,
  agents,
  displayName,
  requestedAgent,
  focusRequest,
  onNavigate,
}: {
  cabinetPath: string;
  agents: CabinetAgentSummary[];
  displayName: string;
  requestedAgent?: CabinetAgentSummary | null;
  focusRequest?: number;
  onNavigate: (agentSlug: string, agentCabinetPath: string, conversationId: string) => void;
}) {
  const [selectedAgent, setSelectedAgent] = useState<CabinetAgentSummary | null>(null);
  const [prompt, setPrompt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [agentQuery, setAgentQuery] = useState<string | null>(null);
  const [agentIndex, setAgentIndex] = useState(0);
  const [agentMentionStart, setAgentMentionStart] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-select first active own-cabinet agent on load
  useEffect(() => {
    if (agents.length > 0 && !selectedAgent) {
      const first =
        agents.find((a) => a.cabinetDepth === 0 && a.active) ||
        agents.find((a) => a.active) ||
        agents[0];
      setSelectedAgent(first);
    }
  }, [agents, selectedAgent]);

  useEffect(() => {
    if (!requestedAgent) return;
    setSelectedAgent(requestedAgent);
  }, [requestedAgent]);

  useEffect(() => {
    if (!focusRequest) return;
    rootRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    window.setTimeout(() => {
      textareaRef.current?.focus();
    }, 120);
  }, [focusRequest]);

  // Auto-grow textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.max(el.scrollHeight, 72)}px`;
  }, [prompt]);

  const greeting = getGreeting();
  const activeAgents = agents.filter((a) => a.active);
  const assignableAgents = activeAgents.length > 0 ? activeAgents : agents;
  const filteredAgents =
    agentQuery === null
      ? []
      : assignableAgents.filter((agent) => {
          const query = agentQuery.toLowerCase();
          return (
            agent.name.toLowerCase().includes(query) ||
            agent.slug.toLowerCase().includes(query) ||
            agent.role.toLowerCase().includes(query)
          );
        });

  function handlePromptChange(value: string, cursorPosition: number) {
    setPrompt(value);
    const textBefore = value.slice(0, cursorPosition);
    const atIndex = textBefore.lastIndexOf("@");

    if (atIndex === -1) {
      setAgentQuery(null);
      return;
    }

    const charBefore = atIndex > 0 ? textBefore[atIndex - 1] : " ";
    if (charBefore !== " " && charBefore !== "\n" && atIndex !== 0) {
      setAgentQuery(null);
      return;
    }

    const query = textBefore.slice(atIndex + 1);
    if (query.includes(" ") || query.includes("\n")) {
      setAgentQuery(null);
      return;
    }

    setAgentMentionStart(atIndex);
    setAgentQuery(query);
    setAgentIndex(0);
  }

  function assignAgent(agent: CabinetAgentSummary) {
    setSelectedAgent(agent);
    setAgentQuery(null);
    setPrompt((current) => {
      const before = current.slice(0, agentMentionStart);
      const after = current.slice(agentMentionStart + (agentQuery?.length ?? 0) + 1);
      return `${before}${after}`.replace(/\s{2,}/g, " ").trimStart();
    });
    window.setTimeout(() => textareaRef.current?.focus(), 0);
  }

  async function submit(text: string) {
    if (!text.trim() || submitting || !selectedAgent) return;
    setSubmitting(true);
    try {
      const agentCabinetPath = selectedAgent.cabinetPath || cabinetPath;
      const res = await fetch("/api/agents/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentSlug: selectedAgent.slug,
          userMessage: text.trim(),
          mentionedPaths: [],
          cabinetPath: agentCabinetPath,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setPrompt("");
        onNavigate(selectedAgent.slug, agentCabinetPath, data.conversation?.id);
      }
    } catch {
      // ignore
    } finally {
      setSubmitting(false);
    }
  }

  const placeholder = selectedAgent
    ? `What should ${selectedAgent.name} work on?`
    : "Choose an agent and describe the next task.";

  return (
    <div ref={rootRef} className="space-y-5">
      <div className="space-y-3">
        <h1 className="font-body-serif text-[1.45rem] leading-tight tracking-tight text-foreground sm:text-[1.85rem]">
          {greeting}, {displayName}. What are we working on today?
        </h1>
      </div>

      <div className="space-y-3">
        <div className="relative w-full">
          <textarea
            ref={textareaRef}
            value={prompt}
            onChange={(e) =>
              handlePromptChange(e.target.value, e.target.selectionStart || e.target.value.length)
            }
            onKeyDown={(e) => {
              if (agentQuery !== null && filteredAgents.length > 0) {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setAgentIndex((current) => (current + 1) % filteredAgents.length);
                  return;
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setAgentIndex((current) =>
                    current === 0 ? filteredAgents.length - 1 : current - 1
                  );
                  return;
                }
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  const agent = filteredAgents[agentIndex];
                  if (agent) assignAgent(agent);
                  return;
                }
                if (e.key === "Escape") {
                  setAgentQuery(null);
                  return;
                }
              }

              if (e.key === "Enter" && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
                e.preventDefault();
                void submit(prompt);
              } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                setPrompt((p) => p + "\n");
              }
            }}
            placeholder={placeholder}
            disabled={submitting || !selectedAgent}
            rows={1}
            className={cn(
              "min-h-[72px] w-full rounded-xl border border-border bg-card px-4 py-4 pr-16",
              "text-sm text-foreground placeholder:text-muted-foreground",
              "focus:outline-none focus:ring-2 focus:ring-ring",
              "shadow-sm resize-none",
              (!selectedAgent || submitting) && "opacity-60"
            )}
          />

          {agentQuery !== null ? (
            <div className="absolute inset-x-0 top-[calc(100%+0.5rem)] z-20 rounded-2xl border border-border bg-popover shadow-lg">
              {filteredAgents.length > 0 ? (
                <div className="py-1.5">
                  {filteredAgents.slice(0, 6).map((agent, index) => (
                    <button
                      key={agent.scopedId}
                      type="button"
                      onClick={() => assignAgent(agent)}
                      className={cn(
                        "flex w-full items-center gap-3 px-3 py-2 text-left transition-colors",
                        index === agentIndex ? "bg-muted/70" : "hover:bg-muted/40"
                      )}
                    >
                      <span className="text-base leading-none">{agent.emoji || "🤖"}</span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-foreground">{agent.name}</p>
                        <p className="truncate text-[11px] text-muted-foreground">
                          {agent.role}
                          {agent.inherited ? ` · ${agent.cabinetName}` : ""}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="px-3 py-2 text-xs text-muted-foreground">
                  No visible agents match that name yet.
                </p>
              )}
            </div>
          ) : null}

          <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center">
            <button
              type="button"
              onClick={() => void submit(prompt)}
              disabled={!prompt.trim() || submitting || !selectedAgent}
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-lg transition-colors",
                prompt.trim() && !submitting
                  ? "bg-primary text-primary-foreground hover:bg-primary/90"
                  : "bg-muted text-muted-foreground"
              )}
              aria-label="Start conversation"
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-end justify-between gap-3">
          <Select
            items={assignableAgents.map((agent) => ({
              label: agent.name,
              value: agent.scopedId,
            }))}
            value={selectedAgent?.scopedId || null}
            onValueChange={(value) => {
              const agent = assignableAgents.find((entry) => entry.scopedId === value) || null;
              setSelectedAgent(agent);
            }}
            disabled={assignableAgents.length === 0}
          >
            <SelectTrigger className="min-w-[220px] rounded-full bg-background px-3">
              <SelectValue placeholder="No visible agents" />
            </SelectTrigger>
            <SelectContent align="start">
              <SelectGroup>
                {assignableAgents.map((agent) => (
                  <SelectItem key={agent.scopedId} value={agent.scopedId}>
                    <span className="text-sm leading-none">{agent.emoji || "🤖"}</span>
                    <span className="truncate">
                      {agent.name}
                      {agent.inherited ? ` · ${agent.cabinetName}` : ""}
                    </span>
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>

          <div className="ml-auto flex items-center gap-1 text-[11px] text-muted-foreground/65">
            <kbd className="rounded border border-border bg-muted/55 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
              ⌘
            </kbd>
            <span>+</span>
            <kbd className="rounded border border-border bg-muted/55 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
              ↵
            </kbd>
            <span className="ml-1">new line</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Recent Conversations ─── */
function RecentConversations({
  cabinetPath,
  visibilityMode,
  agents,
  onOpen,
  onOpenWorkspace,
}: {
  cabinetPath: string;
  visibilityMode: string;
  agents: { slug: string; emoji: string; name: string; cabinetPath?: string }[];
  onOpen: (conv: ConversationMeta) => void;
  onOpenWorkspace: () => void;
}) {
  const [conversations, setConversations] = useState<ConversationMeta[]>([]);
  const [loading, setLoading] = useState(true);

  const agentBySlug = useMemo(() => {
    const map = new Map<string, { emoji: string; name: string }>();
    for (const a of agents) map.set(a.slug, { emoji: a.emoji, name: a.name });
    return map;
  }, [agents]);

  const refresh = useCallback(async () => {
    try {
      const params = new URLSearchParams({ cabinetPath, limit: "20" });
      if (visibilityMode !== "own") params.set("visibilityMode", visibilityMode);
      const res = await fetch(`/api/agents/conversations?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setConversations((data.conversations || []) as ConversationMeta[]);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [cabinetPath, visibilityMode]);

  useEffect(() => {
    void refresh();
    const iv = setInterval(() => void refresh(), 6000);
    return () => clearInterval(iv);
  }, [refresh]);

  const hasRunning = conversations.some((c) => c.status === "running");

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <MessageSquare className="h-4 w-4 text-muted-foreground" />
            <div>
              <h2 className="text-[1.65rem] font-semibold tracking-tight text-foreground">
                Last conversations
              </h2>
              <p className="text-sm text-muted-foreground">
                {loading ? "Loading…" : `${conversations.length} conversations`}
                {hasRunning ? (
                  <span className="ml-2 inline-flex items-center gap-1 text-primary">
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                    {conversations.filter((c) => c.status === "running").length} running
                  </span>
                ) : null}
              </p>
            </div>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 gap-2 text-xs"
          onClick={onOpenWorkspace}
        >
          <Users className="h-3.5 w-3.5" />
          Open conversations
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 border-t border-border/70 py-4 text-sm text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading conversations…
        </div>
      ) : conversations.length === 0 ? (
        <p className="border-t border-border/70 py-4 text-sm text-muted-foreground">
          No conversations yet. Run a heartbeat or send a task to an agent.
        </p>
      ) : (
        <div className="border-t border-border/70">
          {conversations.map((conv) => {
            const agent = agentBySlug.get(conv.agentSlug);
            return (
              <button
                key={conv.id}
                onClick={() => onOpen(conv)}
                className="flex w-full items-center gap-3 border-b border-border/60 py-3 text-left transition-colors hover:bg-muted/20"
              >
                <StatusIcon status={conv.status} />
                <span className="shrink-0 text-base leading-none" title={agent?.name || conv.agentSlug}>
                  {agent?.emoji || "🤖"}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium leading-snug">{conv.title}</p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {agent?.name || conv.agentSlug}
                    {conv.summary ? ` · ${conv.summary}` : ""}
                  </p>
                </div>
                <span
                  className={cn(
                    "shrink-0 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium",
                    TRIGGER_STYLES[conv.trigger]
                  )}
                  title={TRIGGER_LABELS[conv.trigger]}
                >
                  <TriggerIcon trigger={conv.trigger} />
                  {TRIGGER_LABELS[conv.trigger]}
                </span>
                <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
                  {formatRelative(conv.startedAt)}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ─── Main View ─── */
export function CabinetView({ cabinetPath }: { cabinetPath: string }) {
  const [overview, setOverview] = useState<CabinetOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [requestedAgent, setRequestedAgent] = useState<CabinetAgentSummary | null>(null);
  const [composerFocusRequest, setComposerFocusRequest] = useState(0);
  const [showCompactTitle, setShowCompactTitle] = useState(false);
  const scrollAreaHostRef = useRef<HTMLDivElement>(null);
  const titleSectionRef = useRef<HTMLDivElement>(null);
  const selectPage = useTreeStore((state) => state.selectPage);
  const loadPage = useEditorStore((state) => state.loadPage);
  const setSection = useAppStore((state) => state.setSection);
  const cabinetVisibilityModes = useAppStore((state) => state.cabinetVisibilityModes);
  const setCabinetVisibilityMode = useAppStore((state) => state.setCabinetVisibilityMode);
  const cabinetVisibilityMode = cabinetVisibilityModes[cabinetPath] || "own";

  const openCabinet = useCallback(
    (path: string) => {
      selectPage(path);
      void loadPage(path);
      setSection({
        type: "cabinet",
        mode: "cabinet",
        cabinetPath: path,
      });
    },
    [loadPage, selectPage, setSection]
  );

  const openCabinetAgent = useCallback(
    (agent: CabinetAgentSummary) => {
      const targetCabinetPath = agent.cabinetPath || cabinetPath;
      setSection({
        type: "agent",
        mode: "cabinet",
        slug: agent.slug,
        cabinetPath: targetCabinetPath,
        agentScopedId: agent.scopedId || `${targetCabinetPath}::agent::${agent.slug}`,
      });
    },
    [cabinetPath, setSection]
  );

  const openCabinetAgentsWorkspace = useCallback(() => {
    setSection({
      type: "agents",
      mode: "cabinet",
      cabinetPath,
    });
  }, [cabinetPath, setSection]);

  const openConversation = useCallback(
    (conversation: ConversationMeta) => {
      const targetCabinetPath = conversation.cabinetPath || cabinetPath;
      setSection({
        type: "agent",
        mode: "cabinet",
        slug: conversation.agentSlug,
        cabinetPath: targetCabinetPath,
        agentScopedId: `${targetCabinetPath}::agent::${conversation.agentSlug}`,
        conversationId: conversation.id,
      });
    },
    [cabinetPath, setSection]
  );

  const primeTaskComposer = useCallback((agent: CabinetAgentSummary) => {
    setRequestedAgent(agent);
    setComposerFocusRequest((current) => current + 1);
  }, []);

  const loadOverview = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ path: cabinetPath, visibility: cabinetVisibilityMode });
      const response = await fetch(`/api/cabinets/overview?${params.toString()}`, { cache: "no-store" });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error || "Failed to load cabinet overview");
      }
      const data = (await response.json()) as CabinetOverview;
      setOverview(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [cabinetPath, cabinetVisibilityMode]);

  useEffect(() => {
    void loadOverview();
    const interval = window.setInterval(() => void loadOverview(), 15000);
    const onFocus = () => void loadOverview();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [loadOverview]);

  useEffect(() => {
    fetch("/api/agents/config")
      .then((response) => response.json())
      .then((data) => {
        const nextName = [
          data?.person?.name,
          data?.user?.name,
          data?.owner?.name,
          data?.company?.name,
          typeof data?.company === "string" ? data.company : null,
        ].find((value): value is string => typeof value === "string" && value.trim().length > 0);

        if (nextName) setDisplayName(nextName);
      })
      .catch(() => {});
  }, []);

  const cabinetName =
    overview?.cabinet.name ||
    cabinetPath.split("/").filter(Boolean).pop()?.replace(/-/g, " ") ||
    "Cabinet";
  const cabinetDescription =
    overview?.cabinet.description ||
    "Portable software layer for agents, jobs, and knowledge.";
  const visibleAgentCount = overview?.agents.length ?? 0;
  const activeAgents = overview?.agents.filter((a) => a.active).length ?? 0;
  const totalTaskCount = overview?.agents.reduce((sum, agent) => sum + agent.taskCount, 0) ?? 0;
  const totalJobCount = overview?.jobs.length ?? 0;
  const heartbeatCount = overview?.agents.filter((a) => Boolean(a.heartbeat)).length ?? 0;
  const childCabinetCount = overview?.children.length ?? 0;
  const visibleCabinetCount = overview?.visibleCabinets.length ?? 0;
  const cabinetPathLabel = cabinetPath === "." ? "/" : `/${cabinetPath}`;
  const boardName = displayName || "there";
  const scopeLabel =
    CABINET_VISIBILITY_OPTIONS.find((option) => option.value === cabinetVisibilityMode)?.label ||
    "Own agents only";
  const sectionSurfaces = {
    overview: "color-mix(in oklch, var(--background) 95%, var(--muted) 5%)",
    activity: "color-mix(in oklch, var(--background) 97%, var(--secondary) 3%)",
    graph: "color-mix(in oklch, var(--background) 96%, var(--muted) 4%)",
    operations: "color-mix(in oklch, var(--background) 94%, var(--secondary) 6%)",
  } as const;

  useEffect(() => {
    const viewport = scrollAreaHostRef.current?.querySelector<HTMLElement>(
      '[data-slot="scroll-area-viewport"]'
    );
    const titleEl = titleSectionRef.current;

    if (!viewport || !titleEl) return;

    const updateCompactTitle = () => {
      const viewportRect = viewport.getBoundingClientRect();
      const titleRect = titleEl.getBoundingClientRect();
      const shouldShow = titleRect.bottom <= viewportRect.top + 24;
      setShowCompactTitle((current) => (current === shouldShow ? current : shouldShow));
    };

    updateCompactTitle();
    viewport.addEventListener("scroll", updateCompactTitle, { passive: true });
    window.addEventListener("resize", updateCompactTitle);

    return () => {
      viewport.removeEventListener("scroll", updateCompactTitle);
      window.removeEventListener("resize", updateCompactTitle);
    };
  }, [cabinetName, cabinetDescription]);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="border-b border-border/70 bg-background/95 px-4 py-3 sm:px-6">
        <div className="flex items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            {overview?.parent ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => openCabinet(overview.parent!.path)}
                className="h-8 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Back to {overview.parent.name}
              </Button>
            ) : null}
            {showCompactTitle ? (
              <>
                <div
                  className={cn(
                    "hidden h-5 w-px bg-border/80 sm:block",
                    !overview?.parent && "sm:hidden"
                  )}
                />
                <div className="min-w-0">
                  <p className="truncate font-body-serif text-[1.1rem] leading-none text-foreground">
                    {cabinetName}
                  </p>
                  <p className="truncate pt-1 text-[11px] text-muted-foreground">
                    {cabinetDescription}
                  </p>
                </div>
              </>
            ) : null}
          </div>

          <div className="flex items-center gap-1">
            <VersionHistory />
            <HeaderActions />
          </div>
        </div>
      </div>

      <div ref={scrollAreaHostRef} className="min-h-0 flex-1">
        <ScrollArea className="h-full">
          <div className="mx-auto w-full max-w-7xl px-4 pb-12 pt-8 sm:px-6 lg:px-8">
            {error ? (
              <div className="mb-8 border-b border-destructive/20 pb-4 text-sm text-destructive">
                {error}
              </div>
            ) : null}

            <section
              className="-mx-4 border-b border-border/70 px-4 pb-10 pt-2 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8"
              style={{ backgroundColor: sectionSurfaces.overview }}
            >
              <div className="space-y-10">
                <div className="grid gap-10 xl:grid-cols-[minmax(0,1fr)_280px] xl:items-end xl:gap-12">
                  <div className="space-y-8">
                    <div ref={titleSectionRef}>
                      <h2 className="font-body-serif text-[2.2rem] leading-none tracking-tight text-foreground">
                        {cabinetName}
                      </h2>
                      <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">
                        {cabinetDescription}
                      </p>
                    </div>

                    <div className="flex flex-wrap gap-x-8 gap-y-4">
                      <StatPill value={visibleAgentCount} label="visible agents" />
                      <StatPill value={activeAgents} label="active" highlight />
                      <StatPill value={totalTaskCount} label="tasks" />
                      <StatPill value={totalJobCount} label="jobs" />
                      <StatPill value={heartbeatCount} label="heartbeats" />
                      <StatPill value={visibleCabinetCount} label="cabinets in view" />
                    </div>
                  </div>

                  <div className="space-y-3 xl:justify-self-end xl:pb-1">
                    <div className="flex flex-wrap gap-2">
                      {CABINET_VISIBILITY_OPTIONS.map((option) => (
                        <button
                          key={option.value}
                          onClick={() => setCabinetVisibilityMode(cabinetPath, option.value)}
                          className={cn(
                            "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                            cabinetVisibilityMode === option.value
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-border bg-background text-muted-foreground hover:text-foreground"
                          )}
                        >
                          {option.shortLabel}
                        </button>
                      ))}
                    </div>
                    <p className="max-w-[280px] text-sm text-muted-foreground">
                      {scopeLabel}. {childCabinetCount} child cabinet{childCabinetCount === 1 ? "" : "s"} beneath this one.
                    </p>
                  </div>
                </div>

                <div className="border-t border-border/70 pt-10">
                  <CabinetTaskComposer
                    cabinetPath={cabinetPath}
                    agents={overview?.agents || []}
                    displayName={boardName}
                    requestedAgent={requestedAgent}
                    focusRequest={composerFocusRequest}
                    onNavigate={(agentSlug, agentCabinetPath, conversationId) =>
                      setSection({
                        type: "agent",
                        mode: "cabinet",
                        slug: agentSlug,
                        cabinetPath: agentCabinetPath,
                        agentScopedId: `${agentCabinetPath}::agent::${agentSlug}`,
                        conversationId,
                      })
                    }
                  />
                </div>
              </div>
            </section>

            <section
              className="-mx-4 border-b border-border/70 px-4 py-8 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8"
              style={{ backgroundColor: sectionSurfaces.activity }}
            >
            <RecentConversations
              cabinetPath={cabinetPath}
              visibilityMode={cabinetVisibilityMode}
              agents={(overview?.agents || []).map((agent) => ({
                slug: agent.slug,
                emoji: agent.emoji,
                name: agent.name,
                cabinetPath: agent.cabinetPath,
              }))}
              onOpen={openConversation}
              onOpenWorkspace={openCabinetAgentsWorkspace}
            />
            </section>

            <section
              className="-mx-4 border-b border-border/70 px-4 py-10 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8"
              style={{ backgroundColor: sectionSurfaces.graph }}
            >
            <div className="mb-6 flex items-end justify-between gap-4">
              <div>
                <h2 className="text-[1.8rem] font-semibold tracking-tight text-foreground">
                  Cabinet team
                </h2>
              </div>

              <Button
                variant="ghost"
                size="sm"
                className="h-8 gap-2 text-xs"
                onClick={openCabinetAgentsWorkspace}
              >
                <Users className="h-3.5 w-3.5" />
                Open agents workspace
              </Button>
            </div>

            {loading && !overview ? (
              <div className="flex items-center gap-2 py-12 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading mission board…
              </div>
            ) : overview ? (
              <CompactOrgChart
                cabinetName={cabinetName}
                agents={overview.agents}
                jobs={overview.jobs}
                children={overview.children}
                onAgentClick={openCabinetAgent}
                onAgentSend={primeTaskComposer}
                onChildCabinetClick={(child) => openCabinet(child.path)}
              />
            ) : null}
            </section>

            <section
              className="-mx-4 grid gap-10 px-4 py-10 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8 xl:grid-cols-[320px_minmax(0,1fr)]"
              style={{ backgroundColor: sectionSurfaces.operations }}
            >
            <SchedulesPanel
              agents={overview?.agents || []}
              jobs={overview?.jobs || []}
            />

            <div className="min-w-0">
              <div className="min-h-[680px]">
                <KBEditor />
              </div>
            </div>
            </section>
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
