import { useSync } from "@tui/context/sync"
import { createMemo, createResource, For, Show, Switch, Match, onCleanup, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { useTheme } from "../../context/theme"
import type { AssistantMessage, VcsStatus } from "@opencode-ai/sdk/v2"
import { Installation } from "@/installation"
import { useDirectory } from "../../context/directory"
import { useKV } from "../../context/kv"
import { TodoItem } from "../../component/todo-item"
import { useSDK } from "../../context/sdk"

export function Sidebar(props: { sessionID: string; overlay?: boolean }) {
  const sync = useSync()
  const sdk = useSDK()
  const { theme } = useTheme()
  const session = createMemo(() => sync.session.get(props.sessionID)!)
  const todo = createMemo(() => sync.data.todo[props.sessionID] ?? [])
  const messages = createMemo(() => sync.data.message[props.sessionID] ?? [])
  const [git, { refetch }] = createResource<VcsStatus>(async () => {
    const result = await sdk.client.vcs.status()
    return result.data ?? { changes: [], commits: [] }
  })

  const [expanded, setExpanded] = createStore({
    mcp: true,
    change: true,
    commit: true,
    todo: true,
    lsp: true,
    tool: {} as Record<string, boolean>,
  })

  onMount(() => {
    const timer = setInterval(() => {
      refetch()
    }, 5000)
    onCleanup(() => clearInterval(timer))
  })

  const changes = createMemo(() => git()?.changes ?? [])
  const commits = createMemo(() => git()?.commits ?? [])

  // Sort MCP servers alphabetically for consistent display order
  const mcpEntries = createMemo(() => Object.entries(sync.data.mcp).sort(([a], [b]) => a.localeCompare(b)))
  const connectedMcp = createMemo(() =>
    mcpEntries()
      .filter(([_, item]) => item.status === "connected")
      .map(([key]) => key)
      .join("\0"),
  )
  const [mcpTools] = createResource(
    () => connectedMcp(),
    async (source) => {
      if (!source) return {}
      const result = await sdk.client.mcp.tools()
      const data = result.data ?? {}
      return Object.fromEntries(
        source
          .split("\0")
          .filter(Boolean)
          .map((name) => [name, data[name] ?? []]),
      )
    },
  )

  // Count connected and error MCP servers for collapsed header display
  const connectedMcpCount = createMemo(() => mcpEntries().filter(([_, item]) => item.status === "connected").length)
  const errorMcpCount = createMemo(
    () =>
      mcpEntries().filter(
        ([_, item]) =>
          item.status === "failed" || item.status === "needs_auth" || item.status === "needs_client_registration",
      ).length,
  )

  const cost = createMemo(() => {
    const total = messages().reduce((sum, x) => sum + (x.role === "assistant" ? x.cost : 0), 0)
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(total)
  })

  const context = createMemo(() => {
    const last = messages().findLast((x) => x.role === "assistant" && x.tokens.output > 0) as AssistantMessage
    if (!last) return
    const total =
      last.tokens.input + last.tokens.output + last.tokens.reasoning + last.tokens.cache.read + last.tokens.cache.write
    const model = sync.data.provider.find((x) => x.id === last.providerID)?.models[last.modelID]
    return {
      tokens: total.toLocaleString(),
      percentage: model?.limit.context ? Math.round((total / model.limit.context) * 100) : null,
    }
  })

  const directory = useDirectory()
  const kv = useKV()

  const hasProviders = createMemo(() =>
    sync.data.provider.some((x) => x.id !== "opencode" || Object.values(x.models).some((y) => y.cost?.input !== 0)),
  )
  const gettingStartedDismissed = createMemo(() => kv.get("dismissed_getting_started", false))

  return (
    <Show when={session()}>
      <box
        backgroundColor={theme.backgroundPanel}
        width={42}
        height="100%"
        paddingTop={1}
        paddingBottom={1}
        paddingLeft={2}
        paddingRight={2}
        position={props.overlay ? "absolute" : "relative"}
      >
        <scrollbox
          flexGrow={1}
          verticalScrollbarOptions={{
            trackOptions: {
              backgroundColor: theme.background,
              foregroundColor: theme.borderActive,
            },
          }}
        >
          <box flexShrink={0} gap={1} paddingRight={1}>
            <box paddingRight={1}>
              <text fg={theme.text}>
                <b>{session().title}</b>
              </text>
              <Show when={session().share?.url}>
                <text fg={theme.textMuted}>{session().share!.url}</text>
              </Show>
            </box>
            <box>
              <text fg={theme.text}>
                <b>Context</b>
              </text>
              <text fg={theme.textMuted}>{context()?.tokens ?? 0} tokens</text>
              <text fg={theme.textMuted}>{context()?.percentage ?? 0}% used</text>
              <text fg={theme.textMuted}>{cost()} spent</text>
            </box>
            <Show when={mcpEntries().length > 0}>
              <box>
                <box
                  flexDirection="row"
                  gap={1}
                  onMouseDown={() => mcpEntries().length > 2 && setExpanded("mcp", !expanded.mcp)}
                >
                  <text fg={theme.text}>
                    <Show when={mcpEntries().length > 2}>{expanded.mcp ? "▼ " : "▶ "}</Show>
                    <b>MCP</b>
                    <Show when={!expanded.mcp}>
                      <span style={{ fg: theme.textMuted }}>
                        {" "}
                        ({connectedMcpCount()} active
                        {errorMcpCount() > 0 ? `, ${errorMcpCount()} error${errorMcpCount() > 1 ? "s" : ""}` : ""})
                      </span>
                    </Show>
                  </text>
                </box>
                <Show when={mcpEntries().length <= 2 || expanded.mcp}>
                  <For each={mcpEntries()}>
                    {([key, item]) => {
                      const count = createMemo(() => (mcpTools()?.[key] ?? []).length)
                      const open = createMemo(() => item.status === "connected" && count() > 0)

                      return (
                        <box>
                          <box
                            flexDirection="row"
                            gap={1}
                            onMouseDown={() => {
                              if (!open()) return
                              setExpanded("tool", key, !(expanded.tool[key] ?? false))
                            }}
                          >
                            <text fg={theme.text} wrapMode="word">
                              <Show when={open()} fallback={"  "}>
                                {expanded.tool[key] ? "▼ " : "▶ "}
                              </Show>
                              {key}{" "}
                              <span style={{ fg: theme.textMuted }}>
                                <Switch fallback={item.status}>
                                  <Match when={item.status === "connected" && count() > 0}>
                                    {count()} tool{count() !== 1 ? "s" : ""}
                                  </Match>
                                  <Match when={item.status === "connected"}>ready</Match>
                                  <Match when={item.status === "failed"}>error</Match>
                                  <Match when={item.status === "disabled"}>off</Match>
                                  <Match when={(item.status as string) === "needs_auth"}>auth</Match>
                                  <Match when={(item.status as string) === "needs_client_registration"}>
                                    client ID
                                  </Match>
                                </Switch>
                              </span>
                            </text>
                          </box>
                          <Show when={open() && expanded.tool[key]}>
                            <box paddingLeft={2}>
                              <For each={mcpTools()?.[key] ?? []}>
                                {(tool) => (
                                  <text fg={theme.textMuted} wrapMode="word">
                                    {tool.name}
                                  </text>
                                )}
                              </For>
                            </box>
                          </Show>
                        </box>
                      )
                    }}
                  </For>
                </Show>
              </box>
            </Show>
            <box>
              <box
                flexDirection="row"
                gap={1}
                onMouseDown={() => sync.data.lsp.length > 2 && setExpanded("lsp", !expanded.lsp)}
              >
                <text fg={theme.text}>
                  <Show when={sync.data.lsp.length > 2}>{expanded.lsp ? "▼ " : "▶ "}</Show>
                  <b>LSP</b>
                </text>
              </box>
              <Show when={sync.data.lsp.length <= 2 || expanded.lsp}>
                <Show when={sync.data.lsp.length === 0}>
                  <text fg={theme.textMuted}>
                    {sync.data.config.lsp === false
                      ? "LSPs have been disabled in settings"
                      : "LSPs will activate as files are read"}
                  </text>
                </Show>
                <For each={sync.data.lsp}>
                  {(item) => (
                    <box flexDirection="row" gap={1}>
                      <text
                        flexShrink={0}
                        style={{
                          fg: {
                            connected: theme.success,
                            error: theme.error,
                          }[item.status],
                        }}
                      >
                        •
                      </text>
                      <text fg={theme.textMuted}>
                        {item.id} {item.root}
                      </text>
                    </box>
                  )}
                </For>
              </Show>
            </box>
            <Show when={todo().length > 0 && todo().some((t) => t.status !== "completed")}>
              <box>
                <box
                  flexDirection="row"
                  gap={1}
                  onMouseDown={() => todo().length > 2 && setExpanded("todo", !expanded.todo)}
                >
                  <text fg={theme.text}>
                    <Show when={todo().length > 2}>{expanded.todo ? "▼ " : "▶ "}</Show>
                    <b>Todo</b>
                  </text>
                </box>
                <Show when={todo().length <= 2 || expanded.todo}>
                  <For each={todo()}>{(todo) => <TodoItem status={todo.status} content={todo.content} />}</For>
                </Show>
              </box>
            </Show>
            <Show when={changes().length > 0}>
              <box>
                <box
                  flexDirection="row"
                  gap={1}
                  onMouseDown={() => changes().length > 2 && setExpanded("change", !expanded.change)}
                >
                  <text fg={theme.text}>
                    <Show when={changes().length > 2}>{expanded.change ? "▼ " : "▶ "}</Show>
                    <b>Uncommitted Changes</b>
                  </text>
                </box>
                <Show when={changes().length <= 2 || expanded.change}>
                  <For each={changes()}>
                    {(item) => (
                      <box flexDirection="row" gap={1} justifyContent="space-between">
                        <text fg={theme.textMuted} wrapMode="none">
                          {item.path}
                        </text>
                        <box flexDirection="row" gap={1} flexShrink={0}>
                          <text
                            fg={
                              {
                                added: theme.diffAdded,
                                deleted: theme.diffRemoved,
                                modified: theme.textMuted,
                              }[item.status]
                            }
                          >
                            {item.status === "added" ? "new" : item.status === "deleted" ? "del" : "mod"}
                          </text>
                          <Show when={item.added}>
                            <text fg={theme.diffAdded}>+{item.added}</text>
                          </Show>
                          <Show when={item.removed}>
                            <text fg={theme.diffRemoved}>-{item.removed}</text>
                          </Show>
                        </box>
                      </box>
                    )}
                  </For>
                </Show>
              </box>
            </Show>
            <Show when={commits().length > 0}>
              <box>
                <box
                  flexDirection="row"
                  gap={1}
                  onMouseDown={() => commits().length > 2 && setExpanded("commit", !expanded.commit)}
                >
                  <text fg={theme.text}>
                    <Show when={commits().length > 2}>{expanded.commit ? "▼ " : "▶ "}</Show>
                    <b>Unpushed Commits</b>
                  </text>
                </box>
                <Show when={commits().length <= 2 || expanded.commit}>
                  <For each={commits()}>
                    {(item) => (
                      <box flexDirection="row" gap={1}>
                        <text fg={theme.textMuted} flexShrink={0}>
                          •
                        </text>
                        <text fg={theme.textMuted} wrapMode="word">
                          {item.hash.slice(0, 7)} {item.title}
                        </text>
                      </box>
                    )}
                  </For>
                </Show>
              </box>
            </Show>
          </box>
        </scrollbox>

        <box flexShrink={0} gap={1} paddingTop={1}>
          <Show when={!hasProviders() && !gettingStartedDismissed()}>
            <box
              backgroundColor={theme.backgroundElement}
              paddingTop={1}
              paddingBottom={1}
              paddingLeft={2}
              paddingRight={2}
              flexDirection="row"
              gap={1}
            >
              <text flexShrink={0} fg={theme.text}>
                ⬖
              </text>
              <box flexGrow={1} gap={1}>
                <box flexDirection="row" justifyContent="space-between">
                  <text fg={theme.text}>
                    <b>Getting started</b>
                  </text>
                  <text fg={theme.textMuted} onMouseDown={() => kv.set("dismissed_getting_started", true)}>
                    ✕
                  </text>
                </box>
                <text fg={theme.textMuted}>OpenCode includes free models so you can start immediately.</text>
                <text fg={theme.textMuted}>
                  Connect from 75+ providers to use other models, including Claude, GPT, Gemini etc
                </text>
                <box flexDirection="row" gap={1} justifyContent="space-between">
                  <text fg={theme.text}>Connect provider</text>
                  <text fg={theme.textMuted}>/connect</text>
                </box>
              </box>
            </box>
          </Show>
          <text>
            <span style={{ fg: theme.textMuted }}>{directory().split("/").slice(0, -1).join("/")}/</span>
            <span style={{ fg: theme.text }}>{directory().split("/").at(-1)}</span>
          </text>
          <text fg={theme.textMuted}>
            <span style={{ fg: theme.success }}>•</span> <b>Open</b>
            <span style={{ fg: theme.text }}>
              <b>Code</b>
            </span>{" "}
            <span>{Installation.VERSION}</span>
          </text>
        </box>
      </box>
    </Show>
  )
}
