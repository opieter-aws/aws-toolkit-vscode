/*!
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { VSCODE_EXTENSION_ID } from '../extensions'
import { getLogger, Logger } from '../logger'
import { ResourceFetcher } from './resourcefetcher'
import { Timeout, CancelEvent } from '../utilities/timeoutUtils'
import request, { RequestError } from '../request'
import { withRetries } from '../utilities/functionUtils'

type RequestHeaders = { eTag?: string; gZip?: boolean }

export class HttpResourceFetcher implements ResourceFetcher<Response> {
    private readonly logger: Logger = getLogger()

    /**
     *
     * @param url URL to fetch a response body from via the `get` call
     * @param params Additional params for the fetcher
     * @param {boolean} params.showUrl Whether or not to the URL in log statements.
     * @param {string} params.friendlyName If URL is not shown, replaces the URL with this text.
     * @param {Timeout} params.timeout Timeout token to abort/cancel the request. Similar to `AbortSignal`.
     * @param {number} params.retries The number of retries a get request should make if one fails
     */
    public constructor(
        private readonly url: string,
        private readonly params: {
            showUrl: boolean
            friendlyName?: string
            timeout?: Timeout
            retries?: number
        }
    ) {}

    /**
     * Returns the response of the resource, or undefined if the response failed could not be retrieved.
     */
    public get(): Promise<Response | undefined> {
        this.logger.verbose(`downloading: ${this.logText()}`)
        return withRetries(() => this.downloadRequest(), {
            maxRetries: this.params.retries ?? 1,
        })
    }

    /**
     * Requests for new content but additionally uses the given E-Tag.
     * If no E-Tag is given it behaves as a normal request.
     *
     * @param eTag
     * @returns object with optional content. If content is undefined it implies the provided
     *          E-Tag matched the server's, so no content was in response. E-Tag is the E-Tag
     *          of the latest content
     */
    public async getNewETagContent(eTag?: string): Promise<{ content?: string; eTag: string }> {
        const response = await this.getResponseFromGetRequest(this.params.timeout, { eTag, gZip: true })

        const eTagResponse = response.headers.get('etag')
        if (!eTagResponse) {
            throw new Error(`This URL does not support E-Tags. Cannot use this function for: ${this.url.toString()}`)
        }

        // NOTE: Even with use of `gzip` encoding header, the response content is uncompressed.
        // Most likely due to the http request library uncompressing it for us.
        let contents: string | undefined = await response.text()
        if (response.status === 304) {
            // Explanation: https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/If-None-Match
            contents = undefined
            this.logger.verbose(`E-Tag, ${eTagResponse}, matched. No content downloaded from: ${this.url}`)
        } else {
            this.logger.verbose(`No E-Tag match. Downloaded content from: ${this.logText()}`)
        }

        return { content: contents, eTag: eTagResponse }
    }

    private async downloadRequest(): Promise<Response | undefined> {
        try {
            const resp = await this.getResponseFromGetRequest(this.params.timeout)
            this.logger.verbose(`downloaded: ${this.logText()}`)
            return resp
        } catch (err) {
            const error = err as RequestError
            this.logger.verbose(
                `Error downloading ${this.logText()}: %s`,
                error.message ?? error.code ?? error.response.statusText ?? error.response.status
            )
            return undefined
        }
    }

    private logText(): string {
        return this.params.showUrl ? this.url : (this.params.friendlyName ?? 'resource from URL')
    }

    private logCancellation(event: CancelEvent) {
        getLogger().debug(`Download for "${this.logText()}" ${event.agent === 'user' ? 'cancelled' : 'timed out'}`)
    }

    private async getResponseFromGetRequest(timeout?: Timeout, headers?: RequestHeaders): Promise<Response> {
        const req = request.fetch('GET', this.url, {
            headers: this.buildRequestHeaders(headers),
        })

        const cancelListener = timeout?.token.onCancellationRequested((event) => {
            this.logCancellation(event)
            req.cancel()
        })

        return req.response.finally(() => cancelListener?.dispose())
    }

    private buildRequestHeaders(requestHeaders?: RequestHeaders): Headers {
        const headers = new Headers()

        headers.set('User-Agent', VSCODE_EXTENSION_ID.awstoolkit)

        if (requestHeaders?.eTag !== undefined) {
            headers.set('If-None-Match', requestHeaders.eTag)
        }

        if (requestHeaders?.gZip) {
            headers.set('Accept-Encoding', 'gzip')
        }

        return headers
    }
}

export class RetryableResourceFetcher extends HttpResourceFetcher {
    private readonly retryNumber: number
    private readonly retryIntervalMs: number
    private readonly resource: string

    constructor({
        resource,
        params: { retryNumber = 5, retryIntervalMs = 3000, showUrl = true, timeout = new Timeout(5000) },
    }: {
        resource: string
        params: {
            retryNumber?: number
            retryIntervalMs?: number
            showUrl?: boolean
            timeout?: Timeout
        }
    }) {
        super(resource, {
            showUrl,
            timeout,
        })
        this.retryNumber = retryNumber
        this.retryIntervalMs = retryIntervalMs
        this.resource = resource
    }

    fetch(versionTag?: string) {
        return withRetries(
            async () => {
                try {
                    return await this.getNewETagContent(versionTag)
                } catch (err) {
                    getLogger('lsp').error('Failed to fetch at endpoint: %s, err: %s', this.resource, err)
                    throw err
                }
            },
            {
                maxRetries: this.retryNumber,
                delay: this.retryIntervalMs,
            }
        )
    }
}

/**
 * Retrieves JSON property value from a remote resource
 * @param property property to retrieve
 * @param url url of JSON resource
 * @param fetcher optional HTTP resource fetcher to use
 * @returns property value if available or undefined
 */
export async function getPropertyFromJsonUrl(
    url: string,
    property: string,
    fetcher?: HttpResourceFetcher
): Promise<any | undefined> {
    const resourceFetcher = fetcher ?? new HttpResourceFetcher(url, { showUrl: true })
    const resp = await resourceFetcher.get()
    const result = await resp?.text()
    if (result) {
        try {
            const json = JSON.parse(result)
            if (json[property]) {
                return json[property]
            }
        } catch (err) {
            getLogger().error(`JSON parsing failed for "${url}": ${(err as Error).message}`)
        }
    }
}
