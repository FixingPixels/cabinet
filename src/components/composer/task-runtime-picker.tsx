"use client";

import { useEffect, useMemo, useState } from "react";
import { Bot, BrainCircuit, Check, Sparkles } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getDefaultAdapterTypeForProviderInfo } from "@/lib/agents/adapter-options";
import type { ConversationRuntimeOverride } from "@/types/conversations";
import type {
  ProviderEffortLevel,
  ProviderInfo,
  ProviderModel,
} from "@/types/agents";

export type TaskRuntimeSelection = ConversationRuntimeOverride;

interface ProvidersResponse {
  providers?: ProviderInfo[];
  defaultProvider?: string | null;
  defaultModel?: string | null;
  defaultEffort?: string | null;
}

function isProviderReady(provider: ProviderInfo): boolean {
  return (
    (provider.enabled ?? true) &&
    provider.available &&
    (provider.authenticated ?? true)
  );
}

function getSelectableProviders(providers: ProviderInfo[]): ProviderInfo[] {
  const enabled = providers.filter((provider) => provider.enabled ?? true);
  const ready = enabled.filter(isProviderReady);
  if (ready.length > 0) return ready;
  if (enabled.length > 0) return enabled;
  return providers;
}

function resolveSelectedProvider(
  providers: ProviderInfo[],
  providerId?: string,
  fallbackProviderId?: string | null
): ProviderInfo | undefined {
  const selectable = getSelectableProviders(providers);
  return (
    selectable.find((provider) => provider.id === providerId) ||
    selectable.find((provider) => provider.id === fallbackProviderId) ||
    selectable[0] ||
    providers.find((provider) => provider.id === providerId) ||
    providers.find((provider) => provider.id === fallbackProviderId)
  );
}

function resolveSelectedModel(
  provider: ProviderInfo | undefined,
  requestedModel?: string,
  fallbackModel?: string | null
): ProviderModel | undefined {
  const models = provider?.models || [];
  if (models.length === 0) return undefined;

  return (
    models.find((model) => model.id === requestedModel) ||
    models.find((model) => model.id === fallbackModel) ||
    models[0]
  );
}

function resolveSelectedEffort(
  provider: ProviderInfo | undefined,
  requestedEffort?: string,
  fallbackEffort?: string | null
): ProviderEffortLevel | undefined {
  const effortLevels = provider?.effortLevels || [];
  if (effortLevels.length === 0) return undefined;

  return (
    effortLevels.find((effort) => effort.id === requestedEffort) ||
    effortLevels.find((effort) => effort.id === fallbackEffort) ||
    undefined
  );
}

function getSuggestedEffort(
  provider: ProviderInfo | undefined
): ProviderEffortLevel | undefined {
  const effortLevels = provider?.effortLevels || [];
  if (effortLevels.length === 0) return undefined;

  return (
    effortLevels.find((effort) => effort.id === "medium") ||
    effortLevels.find((effort) => effort.id === "high") ||
    effortLevels[Math.floor((effortLevels.length - 1) / 2)] ||
    effortLevels[0]
  );
}

function normalizeSelection(
  value: TaskRuntimeSelection,
  providers: ProviderInfo[],
  defaultProviderId?: string | null,
  defaultModel?: string | null,
  defaultEffort?: string | null
): TaskRuntimeSelection {
  const selectedProvider = resolveSelectedProvider(
    providers,
    value.providerId,
    defaultProviderId
  );
  const selectedModel = resolveSelectedModel(
    selectedProvider,
    value.model,
    selectedProvider?.id === defaultProviderId ? defaultModel : undefined
  );
  const selectedEffort = resolveSelectedEffort(
    selectedProvider,
    value.effort,
    selectedProvider?.id === defaultProviderId ? defaultEffort : undefined
  );

  return {
    providerId: selectedProvider?.id,
    adapterType: getDefaultAdapterTypeForProviderInfo(
      providers,
      selectedProvider?.id,
      defaultProviderId
    ),
    model: selectedModel?.id,
    effort: selectedEffort?.id,
  };
}

function sameSelection(
  left: TaskRuntimeSelection,
  right: TaskRuntimeSelection
): boolean {
  return (
    (left.providerId || "") === (right.providerId || "") &&
    (left.adapterType || "") === (right.adapterType || "") &&
    (left.model || "") === (right.model || "") &&
    (left.effort || "") === (right.effort || "")
  );
}

function ProviderGlyph({
  icon,
  className,
}: {
  icon?: string;
  className?: string;
}) {
  if (icon === "sparkles") {
    return <Sparkles className={className} />;
  }
  return <Bot className={className} />;
}

export function TaskRuntimePicker({
  value,
  onChange,
  align = "start",
  className,
}: {
  value: TaskRuntimeSelection;
  onChange: (value: TaskRuntimeSelection) => void;
  align?: "start" | "center" | "end";
  className?: string;
}) {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [defaultProviderId, setDefaultProviderId] = useState<string | null>(null);
  const [defaultModel, setDefaultModel] = useState<string | null>(null);
  const [defaultEffort, setDefaultEffort] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch("/api/agents/providers");
        if (!response.ok) return;
        const data = (await response.json()) as ProvidersResponse;
        if (cancelled) return;
        setProviders((data.providers || []) as ProviderInfo[]);
        setDefaultProviderId(
          typeof data.defaultProvider === "string" ? data.defaultProvider : null
        );
        setDefaultModel(
          typeof data.defaultModel === "string" ? data.defaultModel : null
        );
        setDefaultEffort(
          typeof data.defaultEffort === "string" ? data.defaultEffort : null
        );
      } catch {
        if (!cancelled) {
          setProviders([]);
          setDefaultProviderId(null);
          setDefaultModel(null);
          setDefaultEffort(null);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const normalizedValue = useMemo(
    () =>
      providers.length > 0
        ? normalizeSelection(
            value,
            providers,
            defaultProviderId,
            defaultModel,
            defaultEffort
          )
        : value,
    [defaultEffort, defaultModel, defaultProviderId, providers, value]
  );

  useEffect(() => {
    if (providers.length === 0) return;
    if (!sameSelection(value, normalizedValue)) {
      onChange(normalizedValue);
    }
  }, [normalizedValue, onChange, providers.length, value]);

  const selectableProviders = useMemo(
    () => getSelectableProviders(providers),
    [providers]
  );
  const selectedProvider = useMemo(
    () =>
      resolveSelectedProvider(
        providers,
        normalizedValue.providerId,
        defaultProviderId
      ),
    [defaultProviderId, normalizedValue.providerId, providers]
  );
  const selectedModel = useMemo(
    () =>
      resolveSelectedModel(
        selectedProvider,
        normalizedValue.model,
        selectedProvider?.id === defaultProviderId ? defaultModel : undefined
      ),
    [defaultModel, defaultProviderId, normalizedValue.model, selectedProvider]
  );
  const selectedEffort = useMemo(
    () =>
      resolveSelectedEffort(
        selectedProvider,
        normalizedValue.effort,
        selectedProvider?.id === defaultProviderId ? defaultEffort : undefined
      ),
    [defaultEffort, defaultProviderId, normalizedValue.effort, selectedProvider]
  );

  const selectedEffortLevels = selectedProvider?.effortLevels || [];
  const displayEffort = selectedEffort || getSuggestedEffort(selectedProvider);

  function applySelection(providerId: string, modelId?: string) {
    onChange(
      normalizeSelection(
        {
          providerId,
          model: modelId,
          effort: normalizedValue.effort,
        },
        providers,
        defaultProviderId,
        defaultModel,
        defaultEffort
      )
    );
  }

  function applyEffort(effortId?: string) {
    onChange(
      normalizeSelection(
        {
          ...normalizedValue,
          effort: effortId,
        },
        providers,
        defaultProviderId,
        defaultModel,
        defaultEffort
      )
    );
  }

  function resetToDefault() {
    onChange(
      normalizeSelection(
        {
          providerId: defaultProviderId || undefined,
          model: defaultModel || undefined,
          effort: defaultEffort || undefined,
        },
        providers,
        defaultProviderId,
        defaultModel,
        defaultEffort
      )
    );
  }

  const selectionSummary = selectedProvider
    ? [selectedProvider.name, selectedModel?.name, selectedEffort?.name]
        .filter(Boolean)
        .join(" · ")
    : loading
      ? "Loading providers..."
      : "No providers available";

  const triggerTitle = selectedProvider
    ? `Task model: ${selectionSummary}`
    : "Task model";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "inline-flex h-8 w-8 items-center justify-center rounded-md border border-border/70 bg-background text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50",
          className
        )}
        aria-label={triggerTitle}
        title={triggerTitle}
        disabled={loading && providers.length === 0}
      >
        <BrainCircuit className="h-4 w-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="w-72 min-w-[18rem]">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Task Model</DropdownMenuLabel>
          <div className="px-1.5 pb-2 text-[11px] text-muted-foreground">
            {selectionSummary}
          </div>
        </DropdownMenuGroup>

        <DropdownMenuItem onClick={resetToDefault} disabled={providers.length === 0}>
          Use app default
        </DropdownMenuItem>

        {selectedProvider && selectedEffortLevels.length > 0 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <div className="flex items-center justify-between gap-2 px-1.5 pb-1">
                <DropdownMenuLabel className="px-0 py-0">
                  Reasoning Effort
                </DropdownMenuLabel>
                <button
                  type="button"
                  className="text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    applyEffort(undefined);
                  }}
                >
                  {selectedProvider.id === defaultProviderId && defaultEffort
                    ? "App default"
                    : "Provider default"}
                </button>
              </div>

              <div className="px-1.5 pb-1 text-[11px] text-muted-foreground">
                {selectedEffort
                  ? selectedEffort.description || selectedEffort.name
                  : selectedProvider.id === defaultProviderId && defaultEffort
                    ? `Using app default · ${displayEffort?.name || defaultEffort}`
                    : "Using provider default"}
              </div>

              {displayEffort ? (
                <div
                  className="px-1.5 pb-2"
                  onClick={(event) => event.stopPropagation()}
                  onPointerDown={(event) => event.stopPropagation()}
                >
                  <Slider
                    value={[
                      Math.max(
                        selectedEffortLevels.findIndex(
                          (effort) => effort.id === displayEffort.id
                        ),
                        0
                      ),
                    ]}
                    min={0}
                    max={Math.max(selectedEffortLevels.length - 1, 0)}
                    step={1}
                    onValueChange={(nextValue) => {
                      const rawValue = Array.isArray(nextValue)
                        ? nextValue[0] ?? 0
                        : nextValue;
                      const nextIndex = Math.max(
                        0,
                        Math.min(
                          selectedEffortLevels.length - 1,
                          Math.round(rawValue)
                        )
                      );
                      const nextEffort = selectedEffortLevels[nextIndex];
                      if (nextEffort) {
                        applyEffort(nextEffort.id);
                      }
                    }}
                  />
                  <div className="mt-2 flex items-start justify-between gap-2 text-[10px] text-muted-foreground">
                    {selectedEffortLevels.map((effort) => (
                      <button
                        key={effort.id}
                        type="button"
                        className={cn(
                          "min-w-0 flex-1 truncate text-center transition-colors",
                          displayEffort.id === effort.id
                            ? "font-medium text-foreground"
                            : "hover:text-foreground"
                        )}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          applyEffort(effort.id);
                        }}
                      >
                        {effort.name}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </DropdownMenuGroup>
          </>
        ) : null}

        <DropdownMenuSeparator />

        {selectableProviders.length > 0 ? (
          selectableProviders.map((provider) => {
            const providerSelection = normalizeSelection(
              { providerId: provider.id },
              providers,
              defaultProviderId,
              defaultModel,
              defaultEffort
            );
            const providerDefaultModel = resolveSelectedModel(
              provider,
              undefined,
              provider.id === defaultProviderId ? defaultModel : undefined
            );

            return (
              <DropdownMenuSub key={provider.id}>
                <DropdownMenuSubTrigger className="gap-2">
                  <ProviderGlyph
                    icon={provider.icon}
                    className="h-4 w-4 text-muted-foreground"
                  />
                  <span>{provider.name}</span>
                  <DropdownMenuShortcut>
                    {normalizedValue.providerId === provider.id
                      ? selectedModel?.name || "Default"
                      : providerDefaultModel?.name || "Default"}
                  </DropdownMenuShortcut>
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-72 min-w-[18rem]">
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>{provider.name}</DropdownMenuLabel>
                  </DropdownMenuGroup>
                  <DropdownMenuItem
                    onClick={() =>
                      applySelection(provider.id, providerSelection.model)
                    }
                  >
                    <span>Use provider default</span>
                    {normalizedValue.providerId === provider.id &&
                    (normalizedValue.model || "") === (providerSelection.model || "") ? (
                      <Check className="ml-auto h-4 w-4" />
                    ) : null}
                  </DropdownMenuItem>
                  {(provider.models || []).length > 0 ? (
                    <>
                      <DropdownMenuSeparator />
                      {(provider.models || []).map((model) => (
                        <DropdownMenuItem
                          key={model.id}
                          onClick={() => applySelection(provider.id, model.id)}
                          className="items-start"
                        >
                          <div className="flex min-w-0 flex-1 flex-col">
                            <span>{model.name}</span>
                            {model.description ? (
                              <span className="text-xs text-muted-foreground">
                                {model.description}
                              </span>
                            ) : null}
                          </div>
                          {normalizedValue.providerId === provider.id &&
                          normalizedValue.model === model.id ? (
                            <Check className="ml-2 h-4 w-4 shrink-0" />
                          ) : null}
                        </DropdownMenuItem>
                      ))}
                    </>
                  ) : null}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            );
          })
        ) : (
          <DropdownMenuItem disabled>No providers available</DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
