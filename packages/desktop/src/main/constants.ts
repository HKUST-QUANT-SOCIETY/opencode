import { app } from "electron"
import { isQuantCodeUpdaterEnabled } from "../../update-mode"

export type Channel = "dev" | "beta" | "prod" | "quantcode"
const raw = import.meta.env.OPENCODE_CHANNEL
export const CHANNEL: Channel =
  raw === "dev" || raw === "beta" || raw === "prod" || raw === "quantcode" ? raw : "quantcode"

const updateMode = import.meta.env.QUANTCODE_UPDATE_MODE
export const QUANTCODE_UPDATE_MODE =
  CHANNEL === "quantcode" && (updateMode === "signed" || updateMode === "unsigned" || updateMode === "disabled")
    ? updateMode
    : CHANNEL === "quantcode"
      ? "disabled"
      : "signed"

const updateFeed = import.meta.env.QUANTCODE_UPDATE_FEED
export const QUANTCODE_UPDATE_FEED =
  CHANNEL === "quantcode" && (updateFeed === "public" || updateFeed === "disabled")
    ? updateFeed
    : CHANNEL === "quantcode"
      ? "disabled"
      : "public"

export const UPDATER_ENABLED =
  app.isPackaged &&
  CHANNEL !== "dev" &&
  (CHANNEL !== "quantcode" || isQuantCodeUpdaterEnabled(QUANTCODE_UPDATE_MODE, QUANTCODE_UPDATE_FEED))
export const PROTOCOL = CHANNEL === "quantcode" ? "quantcode" : "opencode"
