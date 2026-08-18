import { app } from "electron"

type Channel = "dev" | "beta" | "prod" | "quantcode"
const raw = import.meta.env.OPENCODE_CHANNEL
export const CHANNEL: Channel = raw === "dev" || raw === "beta" || raw === "prod" || raw === "quantcode" ? raw : "dev"

const updateMode = import.meta.env.QUANTCODE_UPDATE_MODE
export const QUANTCODE_UPDATE_MODE =
  CHANNEL === "quantcode" && (updateMode === "signed" || updateMode === "unsigned" || updateMode === "disabled")
    ? updateMode
    : CHANNEL === "quantcode"
      ? "disabled"
      : "signed"

export const UPDATER_ENABLED =
  app.isPackaged && CHANNEL !== "dev" && (CHANNEL !== "quantcode" || QUANTCODE_UPDATE_MODE !== "disabled")
export const PROTOCOL = CHANNEL === "quantcode" ? "quantcode" : "opencode"
