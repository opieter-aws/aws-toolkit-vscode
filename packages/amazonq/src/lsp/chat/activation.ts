/*!
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { window } from 'vscode'
import { LanguageClient } from 'vscode-languageclient'
import { AmazonQChatViewProvider } from './webviewProvider'
import { registerCommands } from './commands'
import { registerLanguageServerEventListener, registerMessageListeners } from './messages'
import { Commands, getLogger, globals, undefinedIfEmpty } from 'aws-core-vscode/shared'
import { activate as registerLegacyChatListeners } from '../../app/chat/activation'
import { DefaultAmazonQAppInitContext } from 'aws-core-vscode/amazonq'
import { AuthUtil, getSelectedCustomization } from 'aws-core-vscode/codewhisperer'
import {
    DidChangeConfigurationNotification,
    updateConfigurationRequestType,
} from '@aws/language-server-runtimes/protocol'

export async function activate(
    languageClient: LanguageClient,
    encryptionKey: Buffer,
    mynahUIPath: string,
    injectedProvider?: AmazonQChatViewProvider
) {
    const disposables = globals.context.subscriptions

    // Make sure we've sent an auth profile to the language server before even initializing the UI
    await pushConfigUpdate(languageClient, {
        type: 'profile',
        profileArn: AuthUtil.instance.regionProfileManager.activeRegionProfile?.arn,
    })

    const provider = injectedProvider ?? new AmazonQChatViewProvider(mynahUIPath)

    try {
        disposables.push(
            window.registerWebviewViewProvider(AmazonQChatViewProvider.viewType, provider, {
                webviewOptions: {
                    retainContextWhenHidden: true,
                },
            })
        )
    } catch (err) {
        getLogger().debug('Webview provider already registered: %O', err)
    }

    /**
     * Commands are registered independent of the webview being open because when they're executed
     * they focus the webview
     **/
    try {
        registerCommands(provider)
    } catch (err) {
        getLogger().debug('Webview provider already registered: %O', err)
    }

    registerLanguageServerEventListener(languageClient, provider)

    provider.onDidResolveWebview(() => {
        const disposable = DefaultAmazonQAppInitContext.instance.getAppsToWebViewMessageListener().onMessage((msg) => {
            /**
             * codewhispers app handler is still registered because the activation flow hasn't been refactored.
             * We need to explicitly deny events like restoreTabMessage, otherwise they will be forwarded to the frontend
             *
             */
            if (msg.sender === 'CWChat' && ['restoreTabMessage', 'contextCommandData'].includes(msg.type)) {
                return
            }
            provider.webview?.postMessage(msg).then(undefined, (e) => {
                getLogger().error('webView.postMessage failed: %s', (e as Error).message)
            })
        })

        if (provider.webviewView) {
            disposables.push(
                provider.webviewView.onDidDispose(() => {
                    disposable.dispose()
                })
            )
        }

        registerMessageListeners(languageClient, provider, encryptionKey)
    })

    // register event listeners from the legacy agent flow
    try {
        // register event listeners from the legacy agent flow
        await registerLegacyChatListeners(globals.context)
    } catch (err) {
        getLogger().info('Legacy chat listeners already registered: %O', err)
    }

    try {
        disposables.push(
            AuthUtil.instance.regionProfileManager.onDidChangeRegionProfile(async () => {
                void pushConfigUpdate(languageClient, {
                    type: 'profile',
                    profileArn: AuthUtil.instance.regionProfileManager.activeRegionProfile?.arn,
                })
                await provider.refreshWebview()
            }),
            Commands.register('aws.amazonq.updateCustomizations', () => {
                void pushConfigUpdate(languageClient, {
                    type: 'customization',
                    customization: undefinedIfEmpty(getSelectedCustomization().arn),
                })
            })
        )
    } catch (err) {
        getLogger().info('Event listeners already registered: %O', err)
    }

    return provider
}

/**
 * Push a config value to the language server, effectively updating it with the
 * latest configuration from the client.
 *
 * The issue is we need to push certain configs to different places, since there are
 * different handlers for specific configs. So this determines the correct place to
 * push the given config.
 */
async function pushConfigUpdate(client: LanguageClient, config: QConfigs) {
    if (config.type === 'profile') {
        await client.sendRequest(updateConfigurationRequestType.method, {
            section: 'aws.q',
            settings: { profileArn: config.profileArn },
        })
    } else if (config.type === 'customization') {
        client.sendNotification(DidChangeConfigurationNotification.type.method, {
            section: 'aws.q',
            settings: { customization: config.customization },
        })
    }
}
type ProfileConfig = {
    type: 'profile'
    profileArn: string | undefined
}
type CustomizationConfig = {
    type: 'customization'
    customization: string | undefined
}
type QConfigs = ProfileConfig | CustomizationConfig
