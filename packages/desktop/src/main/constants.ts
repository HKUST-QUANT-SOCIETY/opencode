import { app } from "electron"

type Channel = "dev" | "beta" | "prod" | "quantcode"
const raw = import.meta.env.OPENCODE_CHANNEL
export const CHANNEL: Channel = raw === "dev" || raw === "beta" || raw === "prod" || raw === "quantcode" ? raw : "dev"

export const UPDATER_ENABLED = app.isPackaged && CHANNEL !== "dev"
export const PROTOCOL = CHANNEL === "quantcode" ? "quantcode" : "opencode"
