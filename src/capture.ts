import type {
    ConsoleEvent,
    ConsoleLevel,
    Event,
    NetworkEvent,
} from './types.ts'
import { safeSerialize } from './serialize.ts'

;(() => {
    if ((globalThis as any).__clocBridgeInstalled) return
    ;(globalThis as any).__clocBridgeInstalled = true

    const script = document.currentScript as HTMLScriptElement | null
    const dataset = script?.dataset ?? ({} as DOMStringMap)
    const src = script?.src ?? ''
    const origin = (() => {
        try {
            return new URL(src).origin
        } catch {
            return 'http://127.0.0.1:3737'
        }
    })()
    const endpoint =
        dataset.endpoint ??
        new URLSearchParams(src.split('?')[1] ?? '').get('endpoint') ??
        `${origin}/ingest`
    const session =
        dataset.session ??
        new URLSearchParams(src.split('?')[1] ?? '').get('session') ??
        'default'
    const levelsParam =
        dataset.levels ??
        new URLSearchParams(src.split('?')[1] ?? '').get('levels') ??
        ''
    const levelFilter: Set<ConsoleLevel> | null = levelsParam
        ? new Set(
              levelsParam
                  .split(',')
                  .map((s) => s.trim())
                  .filter((s): s is ConsoleLevel =>
                      ['log', 'info', 'warn', 'error', 'debug'].includes(s),
                  ),
          )
        : null

    const BATCH_MS = 200
    const BATCH_MAX = 20
    const buffer: Event[] = []
    let flushTimer: number | null = null

    function schedule(): void {
        if (flushTimer != null) return
        flushTimer = window.setTimeout(() => {
            flushTimer = null
            flush()
        }, BATCH_MS)
    }

    function flush(): void {
        if (buffer.length === 0) return
        const payload = JSON.stringify({
            events: buffer.splice(0, buffer.length),
        })
        try {
            const blob = new Blob([payload], { type: 'application/json' })
            const sent = navigator.sendBeacon?.(endpoint, blob)
            if (sent) return
        } catch {
            /* fall through */
        }
        try {
            fetch(endpoint, {
                method: 'POST',
                body: payload,
                headers: { 'Content-Type': 'application/json' },
                keepalive: true,
                mode: 'cors',
            }).catch(() => {})
        } catch {
            /* swallow */
        }
    }

    function emit(ev: Event): void {
        try {
            ev.session = session
            buffer.push(ev)
            if (buffer.length >= BATCH_MAX) flush()
            else schedule()
        } catch {
            /* never throw into host app */
        }
    }

    const LEVELS: ConsoleLevel[] = ['log', 'info', 'warn', 'error', 'debug']
    const originals: Partial<
        Record<ConsoleLevel, (...args: unknown[]) => void>
    > = {}
    for (const level of LEVELS) {
        const original = console[level]?.bind(console)
        if (!original) continue
        originals[level] = original
        console[level] = (...args: unknown[]) => {
            try {
                original(...args)
            } finally {
                if (levelFilter && !levelFilter.has(level)) return
                try {
                    const stackTop =
                        level === 'error' || level === 'warn'
                            ? (new Error().stack ?? '')
                                  .split('\n')
                                  .slice(2, 3)
                                  .join('')
                                  .trim() || undefined
                            : undefined
                    const ev: ConsoleEvent = {
                        kind: 'console',
                        level,
                        args: safeSerialize(args),
                        ts: Date.now(),
                        url: location.href,
                        stackTop,
                    }
                    emit(ev)
                } catch {
                    /* swallow */
                }
            }
        }
    }

    const origFetch = window.fetch?.bind(window)
    if (origFetch) {
        window.fetch = async function (
            input: RequestInfo | URL,
            init?: RequestInit,
        ): Promise<Response> {
            const start = performance.now()
            const method = (
                init?.method ??
                (input instanceof Request ? input.method : 'GET')
            ).toUpperCase()
            const url =
                typeof input === 'string'
                    ? input
                    : input instanceof URL
                      ? input.toString()
                      : input.url
            let status = 0
            let error: string | undefined
            let res: Response | undefined
            try {
                res = await origFetch(input, init)
                status = res.status
                return res
            } catch (e: unknown) {
                error =
                    e instanceof Error ? `${e.name}: ${e.message}` : String(e)
                throw e
            } finally {
                if (url !== endpoint) {
                    const durationMs = Math.round(performance.now() - start)
                    const ev: NetworkEvent = {
                        kind: 'network',
                        api: 'fetch',
                        method,
                        url,
                        status,
                        durationMs,
                        reqHeaders: init?.headers
                            ? headersToRecord(init.headers)
                            : undefined,
                        resHeaders: res
                            ? headersToRecord(res.headers)
                            : undefined,
                        error,
                        ts: Date.now(),
                    }
                    emit(ev)
                }
            }
        } as typeof fetch
    }

    const XHR = window.XMLHttpRequest?.prototype
    if (XHR) {
        const origOpen = XHR.open
        const origSend = XHR.send
        const origSetHeader = XHR.setRequestHeader
        type XhrMeta = {
            method: string
            url: string
            start: number
            reqHeaders: Record<string, string>
        }
        const META = new WeakMap<XMLHttpRequest, XhrMeta>()
        XHR.open = function (
            this: XMLHttpRequest,
            method: string,
            url: string | URL,
            async?: boolean,
            user?: string | null,
            password?: string | null,
        ) {
            META.set(this, {
                method: String(method).toUpperCase(),
                url: String(url),
                start: 0,
                reqHeaders: {},
            })
            return origOpen.call(
                this,
                method,
                url,
                async ?? true,
                user,
                password,
            )
        }
        XHR.setRequestHeader = function (
            this: XMLHttpRequest,
            name: string,
            value: string,
        ) {
            const meta = META.get(this)
            if (meta) meta.reqHeaders[name] = value
            return origSetHeader.call(this, name, value)
        }
        XHR.send = function (
            this: XMLHttpRequest,
            body?: Document | XMLHttpRequestBodyInit | null,
        ) {
            const meta = META.get(this)
            if (meta) meta.start = performance.now()
            const finish = () => {
                if (!meta) return
                if (meta.url === endpoint) return
                const durationMs = Math.round(performance.now() - meta.start)
                const resHeaders = parseHeaders(this.getAllResponseHeaders())
                const ev: NetworkEvent = {
                    kind: 'network',
                    api: 'xhr',
                    method: meta.method,
                    url: meta.url,
                    status: this.status,
                    durationMs,
                    reqHeaders: meta.reqHeaders,
                    resHeaders,
                    error:
                        this.status === 0
                            ? 'network error or aborted'
                            : undefined,
                    ts: Date.now(),
                }
                emit(ev)
            }
            this.addEventListener('loadend', finish, { once: true })
            return origSend.call(this, body ?? null)
        }
    }

    function headersToRecord(h: HeadersInit): Record<string, string> {
        const out: Record<string, string> = {}
        if (h instanceof Headers) {
            h.forEach((v, k) => (out[k] = v))
        } else if (Array.isArray(h)) {
            for (const [k, v] of h) out[String(k)] = String(v)
        } else {
            for (const k of Object.keys(h))
                out[k] = String((h as Record<string, unknown>)[k])
        }
        return out
    }

    function parseHeaders(raw: string): Record<string, string> {
        const out: Record<string, string> = {}
        for (const line of raw.split(/\r?\n/)) {
            const idx = line.indexOf(':')
            if (idx < 0) continue
            const k = line.slice(0, idx).trim().toLowerCase()
            const v = line.slice(idx + 1).trim()
            if (k) out[k] = v
        }
        return out
    }

    window.addEventListener('pagehide', flush)
    window.addEventListener('beforeunload', flush)

    ;(originals.log ?? console.log)(
        `[cloc] capture installed — session="${session}" endpoint="${endpoint}"` +
            (levelFilter ? ` levels=${[...levelFilter].join(',')}` : ''),
    )
})()
