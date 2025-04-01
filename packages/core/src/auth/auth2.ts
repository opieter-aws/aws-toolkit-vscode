/*!
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import * as vscode from 'vscode'
import * as jose from 'jose'
import {
    GetSsoTokenParams,
    getSsoTokenRequestType,
    GetSsoTokenResult,
    IamIdentityCenterSsoTokenSource,
    InvalidateSsoTokenParams,
    invalidateSsoTokenRequestType,
    ProfileKind,
    UpdateProfileParams,
    updateProfileRequestType,
    SsoTokenChangedParams,
    ssoTokenChangedRequestType,
    AwsBuilderIdSsoTokenSource,
    ConnectionMetadata,
    NotificationType,
    RequestType,
    ResponseMessage,
    UpdateCredentialsParams,
    AwsErrorCodes,
    SsoTokenSourceKind,
    listProfilesRequestType,
    ListProfilesResult,
    UpdateProfileResult,
    InvalidateSsoTokenResult,
    AuthorizationFlowKind,
    CancellationToken,
    CancellationTokenSource,
} from '@aws/language-server-runtimes/protocol'
import { LanguageClient } from 'vscode-languageclient'
import { getLogger } from '../shared/logger/logger'
import { ToolkitError } from '../shared/errors'

export const notificationTypes = {
    updateBearerToken: new RequestType<UpdateCredentialsRequest, ResponseMessage, Error>(
        'aws/credentials/token/update'
    ),
    deleteBearerToken: new NotificationType('aws/credentials/token/delete'),
    getConnectionMetadata: new RequestType<undefined, ConnectionMetadata, Error>(
        'aws/credentials/getConnectionMetadata'
    ),
}

export interface UpdateCredentialsRequest {
    /**
     * Encrypted token (JWT or PASETO)
     * The token's contents differ whether IAM or Bearer token is sent
     */
    data: string
    /**
     * Used by the runtime based language servers.
     * Signals that this client will encrypt its credentials payloads.
     */
    encrypted: boolean
}

export type TokenSource = IamIdentityCenterSsoTokenSource | AwsBuilderIdSsoTokenSource

/**
 * Handles auth requests to the Identity Server in the Amazon Q LSP.
 */
export class LanguageClientAuth {
    constructor(
        private readonly client: LanguageClient,
        private readonly clientName: string,
        public readonly encryptionKey: Buffer
    ) {}

    getSsoToken(
        tokenSource: TokenSource,
        login: boolean = false,
        cancellationToken?: CancellationToken
    ): Promise<GetSsoTokenResult> {
        return this.client.sendRequest(
            getSsoTokenRequestType.method,
            {
                clientName: this.clientName,
                source: tokenSource,
                options: {
                    loginOnInvalidToken: login,
                    authorizationFlow: AuthorizationFlowKind.DeviceCode,
                },
            } satisfies GetSsoTokenParams,
            cancellationToken
        )
    }

    updateProfile(
        profileName: string,
        startUrl: string,
        region: string,
        scopes: string[]
    ): Promise<UpdateProfileResult> {
        return this.client.sendRequest(updateProfileRequestType.method, {
            profile: {
                kinds: [ProfileKind.SsoTokenProfile],
                name: profileName,
                settings: {
                    region,
                    sso_session: profileName,
                },
            },
            ssoSession: {
                name: profileName,
                settings: {
                    sso_region: region,
                    sso_start_url: startUrl,
                    sso_registration_scopes: scopes,
                },
            },
        } satisfies UpdateProfileParams)
    }

    listProfiles() {
        return this.client.sendRequest(listProfilesRequestType.method, {}) as Promise<ListProfilesResult>
    }

    /**
     * Returns a profile by name along with its linked sso_session.
     * Does not currently exist as an API in the Identity Service.
     */
    async getProfile(profileName: string) {
        const result = await this.listProfiles()
        const profile = result.profiles.find((p) => p.name === profileName)
        const ssoSession = profile?.settings?.sso_session
            ? result.ssoSessions.find((s) => s.name === profile!.settings!.sso_session)
            : undefined

        return { profile, ssoSession }
    }

    /**
     * Update the bearer token used by inline suggestions.
     */
    updateBearerToken(request: UpdateCredentialsParams) {
        this.client.info(`UpdateBearerToken: ${JSON.stringify(request)}`)
        return this.client.sendRequest(notificationTypes.updateBearerToken.method, request)
    }

    /**
     * Delete the bearer token used by inline suggestions.
     */
    deleteBearerToken() {
        return this.client.sendNotification(notificationTypes.deleteBearerToken.method)
    }

    invalidateSsoToken(tokenId: string) {
        return this.client.sendRequest(invalidateSsoTokenRequestType.method, {
            ssoTokenId: tokenId,
        } satisfies InvalidateSsoTokenParams) as Promise<InvalidateSsoTokenResult>
    }

    registerSsoTokenChangedHandler(ssoTokenChangedHandler: (params: SsoTokenChangedParams) => any) {
        this.client.onNotification(ssoTokenChangedRequestType.method, ssoTokenChangedHandler)
    }
}

export type AuthStateEvent = { id: string; state: AuthState | 'refreshed' }

interface BaseLogin {
    readonly type: string
}

export type Login = IamLogin | SsoLogin

/**
 * TODO: Manages an IAM Credentials connection.
 */
export class IamLogin implements BaseLogin {
    readonly type = 'iam'

    constructor() {}
}

/**
 * Manages an SSO connection.
 */
export class SsoLogin implements BaseLogin {
    readonly type = 'sso'
    private readonly eventEmitter = new vscode.EventEmitter<AuthStateEvent>()

    // Cached information for easy reference. All can be easily retrieved or deduced
    // from the identity server.
    private ssoTokenId: string | undefined
    private connectionState: AuthState = 'notConnected'
    private _data: { startUrl: string; region: string } | undefined

    private cancellationToken: CancellationTokenSource | undefined

    constructor(
        public readonly profileName: string,
        private readonly lspAuth: LanguageClientAuth
    ) {
        lspAuth.registerSsoTokenChangedHandler((params: SsoTokenChangedParams) => this.ssoTokenChangedHandler(params))
    }

    get data() {
        return this._data
    }

    async login(opts: { startUrl: string; region: string; scopes: string[] }) {
        await this.updateProfile(opts)
        return this._getSsoToken(true)
    }

    async reauthenticate() {
        if (this.connectionState === 'notConnected') {
            throw new ToolkitError('Cannot reauthenticate a non-existant SSO connection.')
        }
        return this._getSsoToken(true)
    }

    /**
     * Restore the connection state and connection details to memory, if they exist.
     */
    async logout() {
        if (this.ssoTokenId) {
            await this.lspAuth.invalidateSsoToken(this.ssoTokenId)
        }
        this.updateConnectionState('notConnected')
        this._data = undefined
        // TODO: DeleteProfile api in Identity Service (this doesn't exist yet)
    }

    // For migrations
    async updateProfile(opts: { startUrl: string; region: string; scopes: string[] }) {
        await this.lspAuth.updateProfile(this.profileName, opts.startUrl, opts.region, opts.scopes)
        this._data = {
            startUrl: opts.startUrl,
            region: opts.region,
        }
    }

    /**
     * Restore the connection state and connection details to memory, if they exist.
     */
    async restore() {
        const sessionData = await this.lspAuth.getProfile(this.profileName)
        const ssoSession = sessionData?.ssoSession?.settings
        if (ssoSession?.sso_region && ssoSession?.sso_start_url) {
            this._data = {
                startUrl: ssoSession.sso_start_url,
                region: ssoSession.sso_region,
            }
        }

        try {
            await this._getSsoToken(false)
        } catch (err) {
            getLogger().error('Restoring connection failed: %s', err)
        }
    }

    /**
     * Cancels the active login flow, if one is running.
     */
    cancelLogin() {
        this.cancellationToken?.cancel()
        this.cancellationToken?.dispose()
        this.cancellationToken = undefined
    }

    /**
     * Returns a decrypted access token and a payload to send to the `updateCredentials` API provided by
     * the Amazon Q LSP.
     */
    async getToken() {
        const response = await this._getSsoToken(false)
        const decryptedKey = await jose.compactDecrypt(response.ssoToken.accessToken, this.lspAuth.encryptionKey)
        return {
            token: decryptedKey.plaintext.toString().replaceAll('"', ''),
            updateCredentialsParams: response.updateCredentialsParams,
        }
    }

    /**
     * Returns the response from `getToken` LSP API and sets the connection state based on the errors/result
     * of the call.
     */
    private async _getSsoToken(login: boolean) {
        let response: GetSsoTokenResult
        this.cancellationToken = new CancellationTokenSource()

        try {
            response = await this.lspAuth.getSsoToken(
                {
                    /**
                     * Note that we do not use SsoTokenSourceKind.AwsBuilderId here.
                     * This is because it does not leave any state behind on disk, so
                     * we cannot infer that a builder ID connection exists via the
                     * Identity Server alone.
                     */
                    kind: SsoTokenSourceKind.IamIdentityCenter,
                    profileName: this.profileName,
                } satisfies IamIdentityCenterSsoTokenSource,
                login,
                this.cancellationToken.token
            )
        } catch (err: any) {
            switch (err.data?.awsErrorCode) {
                case AwsErrorCodes.E_CANCELLED:
                case AwsErrorCodes.E_SSO_SESSION_NOT_FOUND:
                case AwsErrorCodes.E_PROFILE_NOT_FOUND:
                    this.updateConnectionState('notConnected')
                    break
                case AwsErrorCodes.E_CANNOT_REFRESH_SSO_TOKEN:
                    this.updateConnectionState('expired')
                    break
                case AwsErrorCodes.E_INVALID_SSO_TOKEN:
                    this.updateConnectionState('notConnected')
                    break
                // Uncomment once identity server emits E_NETWORK_ERROR, E_FILESYSTEM_ERROR
                // case AwsErrorCodes.E_NETWORK_ERROR:
                // case AwsErrorCodes.E_FILESYSTEM_ERROR:
                //     // do stuff, probably nothing at all actually
                //     break
                default:
                    getLogger().error('SsoLogin: unknown error when requesting token: %s', err)
                    break
            }
            throw err
        } finally {
            this.cancellationToken?.dispose()
            this.cancellationToken = undefined
        }

        this.ssoTokenId = response.ssoToken.id
        this.updateConnectionState('connected')
        return response
    }

    getConnectionState() {
        return this.connectionState
    }

    onDidChangeConnectionState(handler: (e: AuthStateEvent) => any) {
        return this.eventEmitter.event(handler)
    }

    private updateConnectionState(state: AuthState) {
        if (this.connectionState !== state) {
            this.eventEmitter.fire({ id: this.profileName, state })
        }
        this.connectionState = state
    }

    private ssoTokenChangedHandler(params: SsoTokenChangedParams) {
        if (params.ssoTokenId === this.ssoTokenId) {
            switch (params.kind) {
                case 'Expired':
                    // Not currently implemented on the Identity Server, but handle it
                    // if it does exist one day.
                    this.updateConnectionState('expired')
                    return
                case 'Refreshed': {
                    this.eventEmitter.fire({ id: this.profileName, state: 'refreshed' })
                    break
                }
            }
        }
    }
}

export const AuthStates = ['notConnected', 'connected', 'expired'] as const
export type AuthState = (typeof AuthStates)[number]
