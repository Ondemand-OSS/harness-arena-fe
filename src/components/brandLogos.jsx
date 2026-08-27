// Real brand marks, supplied by the user as source PNGs under
// src/images/{claude,codex,ondemand}.png and preprocessed once (white-fill,
// transparent background, tightly cropped) into the *-mark.png files
// imported below  -  see the git history for the preprocessing script if
// these ever need to be regenerated from fresh source art. Rendered as
// plain <img>s (not currentColor SVGs) since these are the vendors' actual
// marks, not redraws  -  HarnessAvatar supplies each one a solid background
// matching that vendor's real app-icon treatment (see BRAND_BG in ui.jsx).

import claudeMark from '../images/claude-mark.png'
import codexMark from '../images/codex-mark.png'
import ondemandMark from '../images/ondemand-mark.png'
// White-on-transparent, cropped from the "HERMES AGENT" wordmark the user
// supplied (their source export had the transparency checkerboard baked
// into opaque pixels, not real alpha — rekeyed by brightness before
// cropping). It's a text lockup, not an icon like the marks above, so at
// HarnessAvatar's small tile sizes it reads as a wordmark crest rather than
// a glyph — matches what was actually supplied; swap for an icon-only mark
// if Nous ever publishes one.
import hermesMark from '../images/hermes-mark.png'
// Full-color mascot (red creature, cyan eyes), not a white silhouette like
// the marks above — same baked-in-checkerboard problem as hermesMark, but
// rekeyed by saturation instead of brightness since the source background
// was a light gray/white checker rather than black (a brightness key would
// have eaten the mascot's own white highlights). Rendered as-is like
// deepseek.png/kimi.png rather than forced white, since the color IS the
// brand mark here.
import openclawMark from '../images/openclaw-mark.png'
// White card with a dark inset rectangle — same baked-in-checkerboard fix
// as the two marks above (rekeyed by brightness), colors kept as supplied
// rather than forced to solid white since the icon itself is two-tone
// (white card, dark/gray inset), not a single-color silhouette.
import opencodeMark from '../images/opencode-mark.png'
// Not pre-cropped/white-filled like the marks above  -  this is the raw
// source art, used as-is at small sizes next to a model name rather than
// inside a solid-tile avatar.
import deepseekLogo from '../images/deepseek.png'
// Cropped down to just the app-icon tile from the supplied full KIMI
// lockup (icon + wordmark) — the wordmark text is redundant right next to
// ModelBadge's own model-id text, same reasoning DeepSeek's mark is
// icon-only. Unlike deepseek.png, this one's canvas and icon-tile
// background are the same near-black, so there's no color-keyable edge
// between them to cut a transparent corner cutout from — it renders as a
// plain opaque square, which matches how this icon is actually used
// elsewhere (a solid dark app-icon tile), not a compromise specific to
// this asset.
import kimiLogo from '../images/kimi.png'
// Icon-only app-icon tile, used as-is like kimi.png.
import glmLogo from '../images/glm.png'
// Icon-only mark on a transparent background, used as-is like deepseek.png.
import qwenLogo from '../images/qwen.png'
// Unlike every mark above, this is the full wide lockup (waveform icon +
// "MINIMAX" wordmark on a gradient banner), not an icon-only tile — no
// square app-icon version was supplied. Rendered as-is with objectFit
// "contain" like the others, so it letterboxes rather than distorts; swap
// in a cropped icon-only asset here if one becomes available.
import minimaxLogo from '../images/minimax.png'

function Mark({ src, ...props }) {
  return <img src={src} alt="" draggable="false" style={{ objectFit: 'contain' }} {...props} />
}

export function AnthropicMark(props) {
  return <Mark src={claudeMark} {...props} />
}

export function OpenAIMark(props) {
  return <Mark src={codexMark} {...props} />
}

export function OnDemandMark(props) {
  return <Mark src={ondemandMark} {...props} />
}

export function HermesMark(props) {
  return <Mark src={hermesMark} {...props} />
}

export function OpenClawMark(props) {
  return <Mark src={openclawMark} {...props} />
}

export function OpenCodeMark(props) {
  return <Mark src={opencodeMark} {...props} />
}

export function DeepSeekMark(props) {
  return <Mark src={deepseekLogo} {...props} />
}

export function KimiMark(props) {
  return <Mark src={kimiLogo} {...props} />
}

export function GLMMark(props) {
  return <Mark src={glmLogo} {...props} />
}

export function QwenMark(props) {
  return <Mark src={qwenLogo} {...props} />
}

export function MiniMaxMark(props) {
  return <Mark src={minimaxLogo} {...props} />
}

export const BRAND_MARKS = {
  'claude-code': AnthropicMark,
  codex: OpenAIMark,
  ondemand: OnDemandMark,
  hermes: HermesMark,
  openclaw: OpenClawMark,
  opencode: OpenCodeMark,
}

// Keyed by a lowercase substring of the model id (checked with .includes),
// not an exact key, since model ids get typed by hand ("deepseek-v4",
// "DeepSeek V4 Flash", "moonshotai/kimi-k3", "Kimi-K3", ...) and vary in
// spelling/vendor-prefixing.
export const MODEL_MARKS = {
  deepseek: DeepSeekMark,
  kimi: KimiMark,
  glm: GLMMark,
  qwen: QwenMark,
  minimax: MiniMaxMark,
}

export function markForModel(model) {
  const key = (model || '').toLowerCase()
  return Object.entries(MODEL_MARKS).find(([needle]) => key.includes(needle))?.[1]
}

// Keyed by the controlled `family` value on a provider profile (see
// backend routers/config.py's FREE_MODEL_FAMILIES) rather than a
// substring of the model string — family is a fixed enum, so an exact
// key lookup is both simpler and more precise than markForModel's fuzzy
// match. Used by ModelPickerModal to badge each family group's heading.
export const FAMILY_MARKS = {
  deepseek: DeepSeekMark,
  kimi: KimiMark,
  glm: GLMMark,
  qwen: QwenMark,
  minimax: MiniMaxMark,
}
