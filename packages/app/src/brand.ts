export const isQuantCode = import.meta.env.VITE_OPENCODE_CHANNEL === "quantcode"
export const PRODUCT_NAME = isQuantCode ? "QuantCode" : "OpenCode"
export const PRODUCT_ICON = isQuantCode ? "/quantcode-icon.png" : "https://opencode.ai/favicon-96x96-v3.png"
export const PRODUCT_FEEDBACK_URL = isQuantCode
  ? "https://github.com/HKUST-QUANT-SOCIETY/quantcode/issues"
  : "https://opencode.ai/desktop-feedback"
