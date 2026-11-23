/**
 * WorkBuddy channel for the aggregate lane.
 *
 * WHY THIS MODULE EXISTS
 *
 * `dsh-connect-workbuddy` (a separate plugin, MIT, by dingminhua) already
 * integrates WorkBuddy — but as its own provider with its own settings page.
 * That makes two plugins to install for one experience. This module reimplements
 * the WorkBuddy channel *inside* our-free-model so a single package carries it.
 *
 * It is a reimplementation, not a vendored copy: only the wire contract is
 * reused (two HTTP endpoints and an OpenAI-shaped SSE stream), which we verified
 * against the live upstream. No WorkBuddy code ships in this bundle.
 *
 * WHAT THE UPSTREAM ACTUALLY IS (measured 2026-11-24)
 *
 *   GET  {chatBase}/v2/enterprises/personal/models      -> catalog + credit multipliers
 *   POST {chatBase}/v2/chat/completions                 -> standard OpenAI SSE chunks
 *
 * CN:      chatBase = https://copilot.tencent.com   (billing: www.codebuddy.cn)
 * Global:  chatBase = https://www.workbuddy.ai
 *
 * Credentials live in the same on-disk vault the other plugin writes
 * (`$DSH_HOME/workbuddy-vault/<region>/<accountId>.json`): an OAuth access token
 * (a JWT, ~1.7 kB), a refresh token, an expiry, and the account's display name.
 * Reading that vault is what lets a user who already signed in through either
 * plugin use the channel here with no second login.
 *
 * A model's `credits` string ("x0.29 credits", "x0.00") is the account-credit
 * multiplier. It is surfaced as the row's description rather than as a price:
 * the upstream bills in credits, not in currency, so inventing a money cost
 * would be a lie the dashboard would then repeat.
 *
 * @module src/workbuddy.js
 */

import fs from 'node:fs'
import path from 'node:path'

/** Regions this channel serves, in the order the settings page lists them. */
export const WORKBUDDY_REGIONS = Object.freeze(['cn', 'global'])

/** Per-region endpoints. `chat` answers both the catalog and the turns. */
export const WORKBUDDY_ENDPOINTS = Object.freeze({
  cn: Object.freeze({
    chat: 'https://copilot.tencent.com',
    billing: 'https://www.codebuddy.cn',
    label: 'WorkBuddy 国内版',
  }),
  global: Object.freeze({
    chat: 'https://www.workbuddy.ai',
    billing: 'https://www.workbuddy.ai',
    label: 'WorkBuddy 国际版',
  }),
})

export const CATALOG_PATH = '/v2/enterprises/personal/models'
export const CHAT_PATH = '/v2/chat/completions'

/**
 * The base URL a registry row should carry.
 *
 * The aggregate lane composes `baseUrl + CHAT_PATHS[format]`, i.e. `+ /chat/completions`,
 * while the upstream lives at `/v2/chat/completions`. Folding the `/v2` into the
 * base is what makes the generic composition land on the real endpoint — the
 * alternative (special-casing this provider inside aggregate.js) would put a
 * vendor detail in the lane's generic path.
 */
export const CHAT_BASE_WITH_VERSION = '/v2'

/** Where the other plugin keeps its vault, relative to $DSH_HOME. */
const VAULT_DIR = 'workbuddy-vault'

/**
 * The DSH home the vault lives under.
 *
 * Mirrors how the rest of this plugin resolves it: `DSH_HOME` wins, else the
 * conventional `~/.dsh`. Kept local instead of importing a host helper because
 * this module must stay loadable in contexts that do not expose one.
 */
function dshHome(env = process.env) {
  const override = typeof env.DSH_HOME === 'string' ? env.DSH_HOME.trim() : ''
  if (override !== '') return override
  const home = typeof env.USERPROFILE === 'string' && env.USERPROFILE !== ''
    ? env.USERPROFILE
    : (typeof env.HOME === 'string' ? env.HOME : '')
  return home === '' ? '' : path.join(home, '.dsh')
}

/**
 * Every credential file a region has, newest first.
 *
 * A region may hold several signed-in accounts. We do not maintain our own
 * selection UI here: the aggregate lane is one-key-per-provider by design, so
 * the honest choice is the account this machine used most recently — which is
 * what a single-user workstation expects and what an expired-token rotation
 * will have touched last.
 *
 * @returns {Array<{ file: string, credential: object }>}
 */
export function readWorkbuddyCredentials(region, env = process.env) {
  if (!WORKBUDDY_REGIONS.includes(region)) return []
  const home = dshHome(env)
  if (home === '') return []
  const dir = path.join(home, VAULT_DIR, region)
  let names
  try {
    names = fs.readdirSync(dir)
  } catch {
    return []
  }
  const rows = []
  for (const name of names) {
    if (!name.endsWith('.json')) continue
    const file = path.join(dir, name)
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
      const auth = parsed?.auth
      if (typeof auth?.accessToken !== 'string' || auth.accessToken === '') continue
      rows.push({ file, credential: parsed })
    } catch {
      // A half-written or foreign file is simply not a credential we can use;
      // the settings page reports "尚未登录" instead of surfacing a parse error.
    }
  }
  rows.sort((left, right) => {
    const a = Number(left.credential?.auth?.refreshedAtMs ?? 0)
    const b = Number(right.credential?.auth?.refreshedAtMs ?? 0)
    return b - a
  })
  return rows
}

/**
 * The credential the channel should use for a region, or null.
 *
 * Expiry is NOT enforced here. The upstream is the authority on whether a token
 * still works, and refusing locally on a clock we cannot verify would lock a
 * user out of a channel that actually answers. An expired token produces a clean
 * 401 from upstream, which the poster already classifies as INVALID_CREDENTIAL
 * and the settings page renders as "登录已过期，请重新登录".
 */
export function resolveWorkbuddyCredential(region, env = process.env) {
  const [first] = readWorkbuddyCredentials(region, env)
  return first ?? null
}

/** Trim a credits string ("x0.29 credits" / "x0.00") into "x0.29" or "". */
export function creditLabel(value) {
  if (typeof value !== 'string') return ''
  const match = /^\s*(x\s*[\d.]+)/i.exec(value)
  return match === null ? value.trim() : match[1].replace(/\s+/g, '')
}

/**
 * Map one upstream model record onto the fields this plugin's catalog rows and
 * stream shaper already understand.
 *
 * `maxInputTokens`/`maxOutputTokens` are the upstream's own names; the plugin
 * speaks `contextWindow`/`maxOutput`. Fields the upstream omits (the image and
 * video models carry no token budget at all) become null rather than 0, so a
 * consumer can tell "not applicable" from "zero budget".
 */
export function normalizeModel(record) {
  const id = typeof record?.id === 'string' ? record.id.trim() : ''
  if (id === '') return null
  const contextWindow = Number(record?.maxInputTokens)
  const maxOutputTokens = Number(record?.maxOutputTokens)
  return {
    id,
    name: typeof record?.name === 'string' && record.name !== '' ? record.name : id,
    description: typeof record?.descriptionZh === 'string' && record.descriptionZh !== ''
      ? record.descriptionZh
      : (typeof record?.descriptionEn === 'string' ? record.descriptionEn : ''),
    contextWindow: Number.isFinite(contextWindow) && contextWindow > 0 ? contextWindow : null,
    maxOutputTokens: Number.isFinite(maxOutputTokens) && maxOutputTokens > 0 ? maxOutputTokens : null,
    credits: creditLabel(record?.credits),
    vision: record?.supportsImages === true,
    reasoning: record?.supportsReasoning === true,
    tools: record?.supportsToolCall === true,
    isDefault: record?.isDefault === true,
  }
}

/**
 * Fetch and normalise a region's catalog.
 *
 * Returns the models grouped by kind so the caller can decide what to offer:
 * chat models are the ones with a token budget and a tool/image story; the
 * image and video generators share the catalog but not the chat endpoint, and
 * offering them on this lane would produce a row that always fails.
 *
 * @returns {Promise<{ models: Array<object>, account: object|null, endpoint: string }>}
 */
export async function fetchWorkbuddyCatalog(region, options = {}) {
  const endpoints = WORKBUDDY_ENDPOINTS[region]
  if (endpoints === undefined) throw new Error(`unknown WorkBuddy region: ${region}`)
  const resolved = options.credential !== undefined ? options.credential : resolveWorkbuddyCredential(region, options.env)
  if (resolved === null) throw new Error('WorkBuddy 尚未登录：请先在「WorkBuddy」页面完成扫码登录')

  const token = resolved.credential.auth.accessToken
  const base = typeof resolved.credential.auth.domain === 'string' && resolved.credential.auth.domain !== ''
    ? `https://${resolved.credential.auth.domain}`
    : endpoints.chat

  const doFetch = options.fetchImpl ?? fetch
  const controller = new AbortController()
  const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 30_000
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  timer.unref?.()
  try {
    const url = `${base}${CATALOG_PATH}`
    const response = await doFetch(url, {
      method: 'GET',
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
      signal: controller.signal,
    })
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new Error(`WorkBuddy 模型目录请求失败（HTTP ${response.status}）${detail === '' ? '' : `：${detail.slice(0, 180)}`}`)
    }
    const payload = await response.json()
    const rows = Array.isArray(payload?.data?.models) ? payload.data.models : []
    const models = rows.map(normalizeModel).filter(model => model !== null)
    const account = resolved.credential?.account ?? null
    return {
      models,
      account: account === null ? null : {
        nickname: typeof account.nickname === 'string' ? account.nickname : '',
        uid: typeof account.uid === 'string' ? account.uid : '',
      },
      endpoint: typeof payload?.data?.endpoint === 'string' ? payload.data.endpoint : base,
    }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Decide whether a catalog row can serve a chat turn on this lane.
 *
 * The catalog mixes chat models with image and video generators. A generator has
 * no token budget and does not answer `/v2/chat/completions`, so offering it
 * would give the user a model that fails every time. Vision and reasoning are
 * capabilities, not exclusions — they travel as row metadata.
 */
export function isChatModel(model) {
  return Number.isFinite(model?.contextWindow) && model.contextWindow > 0
}

/**
 * The headers an upstream chat request needs.
 *
 * `accept: text/event-stream` is what selects the streaming answer; without it
 * the upstream may answer one JSON document, which the poster already knows how
 * to synthesise frames from.
 */
export function chatHeaders(token) {
  return {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
    accept: 'text/event-stream',
  }
}

/**
 * The models this channel offers for a region, as registry-shaped rows.
 *
 * Used by the settings page and by the catalog builder. Returns [] (never
 * throws) when the region is not signed in, because "not signed in" is a normal
 * state the page renders, not an error.
 */
export async function workbuddyModels(region, options = {}) {
  try {
    const { models } = await fetchWorkbuddyCatalog(region, options)
    return models.filter(isChatModel)
  } catch {
    return []
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Sign-in
//
// WorkBuddy signs in with a three-step browser handshake, and this module
// implements it so the channel needs no other plugin to stay signed in:
//
//   1. POST {billing}/v2/plugin/auth/state?platform=workbuddy
//        -> { state, authUrl }             open authUrl, the user scans/confirms
//   2. GET  {billing}/v2/plugin/auth/token?state={state}
//        -> { accessToken, refreshToken, expiresIn, ... }   polled until it answers
//   3. GET  {api}/v2/plugin/account        -> identity (nickname, uid, uin)
//
// The session lives in this process only: a state that is never completed is
// worthless after a restart, and persisting it would leave a half-finished
// handshake on disk. Credentials, once obtained, are written to the same vault
// path the channel already reads, so signing in here immediately makes the
// models available without a reload.
// ─────────────────────────────────────────────────────────────────────────────

/** Upstream paths for the sign-in handshake, relative to the billing base. */
export const AUTH_STATE_PATH = '/v2/plugin/auth/state'
export const AUTH_TOKEN_PATH = '/v2/plugin/auth/token'
export const ACCOUNT_PATH = '/v2/plugin/account'

/** How long an unfinished handshake stays pollable. Mirrors the upstream window. */
export const LOGIN_TTL_MS = 600_000

/**
 * In-process handshake sessions, keyed by the id this module mints.
 *
 * A Map on the module (not on a class instance) because the settings page and
 * the poller reach it through separate calls; there is exactly one plugin host
 * per process, so one map is the whole truth.
 */
const loginSessions = new Map()

/** Where a region's credential file goes, creating the directory if needed. */
function vaultTarget(region, accountId, env = process.env) {
  const home = dshHome(env)
  if (home === '') throw new Error('cannot locate $DSH_HOME to store the credential')
  const dir = path.join(home, VAULT_DIR, region)
  fs.mkdirSync(dir, { recursive: true })
  const safe = String(accountId).replace(/[^0-9a-zA-Z_-]/g, '')
  if (safe === '') throw new Error('the sign-in returned no account id')
  return path.join(dir, `${safe}.json`)
}

/** Decode a JWT payload without verifying it — display metadata only. */
function jwtPayload(token) {
  if (typeof token !== 'string') return {}
  const parts = token.split('.')
  if (parts.length < 2) return {}
  try {
    const parsed = JSON.parse(Buffer.from(parts[1] ?? '', 'base64url').toString('utf8'))
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

/** First non-empty string among `keys` of `record`. */
function firstString(record, keys) {
  if (record === null || typeof record !== 'object') return ''
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value !== '') return value
  }
  return ''
}

/** The `data` envelope upstream wraps most answers in, or the document itself. */
function envelope(document) {
  if (document !== null && typeof document === 'object' && document.data !== null && typeof document.data === 'object') {
    return document.data
  }
  return document
}

/**
 * Step 1 — start a sign-in.
 *
 * Returns the URL the user opens. Nothing is written yet: the credential only
 * exists after a successful poll, so abandoning the flow leaves no trace.
 */
export async function startWorkbuddyLogin(region, options = {}) {
  const endpoints = WORKBUDDY_ENDPOINTS[region]
  if (endpoints === undefined) throw new Error(`unknown WorkBuddy region: ${region}`)
  const base = String(options.base ?? endpoints.billing).replace(/\/+$/, '')
  const doFetch = options.fetchImpl ?? fetch

  const response = await doFetch(`${base}${AUTH_STATE_PATH}?platform=workbuddy`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: '{}',
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) {
    throw new Error(`无法开始登录：${base} 返回 HTTP ${response.status}`)
  }
  let document
  try {
    document = await response.json()
  } catch {
    throw new Error('登录服务返回了非 JSON 响应')
  }
  const data = envelope(document)
  const state = firstString(data, ['state', 'State'])
  if (state === '') throw new Error('登录服务没有下发 state')
  const authUrl = firstString(data, ['authUrl', 'auth_url', 'url', 'Url'])
    || `${base}/login?state=${encodeURIComponent(state)}`

  const loginId = `ofm_wb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
  loginSessions.set(loginId, {
    region,
    base,
    state,
    expiresAt: Date.now() + LOGIN_TTL_MS,
    done: false,
  })
  return { loginId, verificationUri: authUrl, expiresIn: Math.round(LOGIN_TTL_MS / 1000) }
}

/**
 * Step 2 — poll once.
 *
 * Returns `{ done:false }` while the user has not finished, and
 * `{ done:true, account }` once the credential is stored. A poll that arrives
 * for an unknown or expired session is terminal with an error rather than
 * silently looping, so the page can stop its timer.
 */
export async function pollWorkbuddyLogin(loginId, region, options = {}) {
  const session = loginSessions.get(loginId)
  if (session === undefined) return { done: true, error: '登录会话不存在，请重新发起' }
  if (session.region !== region) return { done: true, error: '登录会话属于另一个区域' }
  if (session.done) return { done: true, error: '登录会话已结束' }
  if (Date.now() > session.expiresAt) {
    loginSessions.delete(loginId)
    return { done: true, error: '登录超时，请重新发起' }
  }

  const doFetch = options.fetchImpl ?? fetch
  let response
  try {
    response = await doFetch(`${session.base}${AUTH_TOKEN_PATH}?state=${encodeURIComponent(session.state)}`, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(30_000),
    })
  } catch {
    return { done: false }
  }
  let document
  try {
    document = await response.json()
  } catch {
    return { done: false }
  }
  const code = typeof document?.code === 'number' ? document.code : -1
  if (code !== 0 && code !== 200) return { done: false }
  const data = envelope(document)
  const accessToken = firstString(data, ['accessToken', 'access_token', 'AccessToken'])
  if (accessToken === '') return { done: false }

  // The token is in hand; pull the identity, then persist. A failed identity
  // fetch is not fatal — the JWT carries a nickname and sub we can fall back to,
  // and refusing to store a working token over a cosmetic label would be wrong.
  let identity = null
  try {
    const accountResponse = await doFetch(`${session.base}${ACCOUNT_PATH}`, {
      method: 'GET',
      headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
      signal: AbortSignal.timeout(20_000),
    })
    if (accountResponse.ok) {
      const accountDocument = await accountResponse.json()
      identity = envelope(accountDocument)
    }
  } catch {
    // handled by the fallback below
  }

  const claims = jwtPayload(accessToken)
  const uid = firstString(identity, ['uid', 'Uid']) || firstString(claims, ['sub', 'Sub'])
  const nickname = firstString(identity, ['nickname', 'NickName'])
    || firstString(claims, ['nickname', 'NickName', 'preferred_username'])
  const uin = firstString(identity, ['uin', 'Uin']) || firstString(claims, ['uin', 'Uin'])
  if (uid === '') {
    loginSessions.delete(loginId)
    return { done: true, error: '登录成功但无法确定账号标识' }
  }

  const refreshToken = firstString(data, ['refreshToken', 'refresh_token', 'RefreshToken'])
  const expiresIn = Number(data?.expiresIn ?? data?.expires_in ?? 0)
  const refreshExpiresIn = Number(data?.refreshExpiresIn ?? data?.refresh_expires_in ?? 0)
  const now = Math.floor(Date.now() / 1000)
  const credential = {
    version: 1,
    accountId: uid,
    refreshedAtMs: Date.now(),
    auth: {
      accessToken,
      refreshToken,
      expiresAt: Number.isFinite(expiresIn) && expiresIn > 0 ? now + expiresIn : 0,
      refreshExpiresAt: Number.isFinite(refreshExpiresIn) && refreshExpiresIn > 0 ? now + refreshExpiresIn : 0,
      domain: session.base.replace(/^https?:\/\//, ''),
    },
    account: { uid, nickname, uin },
  }

  const file = vaultTarget(region, uid, options.env)
  const temporary = `${file}.${process.pid}.tmp`
  fs.writeFileSync(temporary, JSON.stringify(credential, null, 2), { mode: 0o600 })
  fs.renameSync(temporary, file)

  loginSessions.delete(loginId)
  return { done: true, account: { nickname, uid }, region }
}

/** Forget every handshake this process is still holding (used on shutdown). */
export function clearWorkbuddyLogins() {
  loginSessions.clear()
}
