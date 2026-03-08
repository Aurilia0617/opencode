import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { $ } from "bun"
import z from "zod"
import { Log } from "@/util/log"
import { Instance } from "./instance"
import { FileWatcher } from "@/file/watcher"
import { File } from "@/file"

const log = Log.create({ service: "vcs" })

export namespace Vcs {
  export const Event = {
    BranchUpdated: BusEvent.define(
      "vcs.branch.updated",
      z.object({
        branch: z.string().optional(),
      }),
    ),
  }

  export const Info = z
    .object({
      branch: z.string(),
    })
    .meta({
      ref: "VcsInfo",
    })
  export type Info = z.infer<typeof Info>

  export const Change = z
    .object({
      path: z.string(),
      status: z.enum(["added", "deleted", "modified"]),
      added: z.number().int(),
      removed: z.number().int(),
    })
    .meta({
      ref: "VcsChange",
    })
  export type Change = z.infer<typeof Change>

  export const Commit = z
    .object({
      hash: z.string(),
      title: z.string(),
    })
    .meta({
      ref: "VcsCommit",
    })
  export type Commit = z.infer<typeof Commit>

  export const Status = z
    .object({
      changes: Change.array(),
      commits: Commit.array(),
      upstream: z.string().optional(),
    })
    .meta({
      ref: "VcsStatus",
    })
  export type Status = z.infer<typeof Status>

  async function currentBranch() {
    return $`git rev-parse --abbrev-ref HEAD`
      .quiet()
      .nothrow()
      .cwd(Instance.worktree)
      .text()
      .then((x) => x.trim())
      .catch(() => undefined)
  }

  const state = Instance.state(
    async () => {
      if (Instance.project.vcs !== "git") {
        return { branch: async () => undefined, unsubscribe: undefined }
      }
      let current = await currentBranch()
      log.info("initialized", { branch: current })

      const unsubscribe = Bus.subscribe(FileWatcher.Event.Updated, async (evt) => {
        if (evt.properties.file.endsWith("HEAD")) return
        const next = await currentBranch()
        if (next !== current) {
          log.info("branch changed", { from: current, to: next })
          current = next
          Bus.publish(Event.BranchUpdated, { branch: next })
        }
      })

      return {
        branch: async () => current,
        unsubscribe,
      }
    },
    async (state) => {
      state.unsubscribe?.()
    },
  )

  export async function init() {
    return state()
  }

  export async function branch() {
    return await state().then((s) => s.branch())
  }

  export async function status(): Promise<Status> {
    if (Instance.project.vcs !== "git") {
      return {
        changes: [],
        commits: [],
      }
    }

    const changes = await File.status()
    const upstream = await $`git rev-parse --abbrev-ref --symbolic-full-name @{upstream}`
      .quiet()
      .nothrow()
      .cwd(Instance.worktree)
      .text()
      .then((x) => x.trim())

    if (!upstream) {
      return {
        changes,
        commits: [],
      }
    }

    const out = await $`git log --format=%H%x09%s ${upstream}..HEAD`
      .quiet()
      .nothrow()
      .cwd(Instance.worktree)
      .text()

    const commits = out
      .split("\n")
      .map((x) => x.trim())
      .filter(Boolean)
      .map((x) => {
        const [hash, title = ""] = x.split("\t")
        return { hash, title }
      })

    return {
      changes,
      commits,
      upstream,
    }
  }
}
