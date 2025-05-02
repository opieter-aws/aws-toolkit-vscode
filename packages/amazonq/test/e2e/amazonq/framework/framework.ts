/*!
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { injectJSDOM } from './jsdomInjector'

// This needs to be ran before all other imports so that mynah ui gets loaded inside of jsdom
injectJSDOM()

import assert from 'assert'
import * as vscode from 'vscode'
import * as path from 'path'
import * as fs from 'fs'
import { MynahUI, MynahUIProps } from '@aws/mynah-ui'
import { DefaultAmazonQAppInitContext, LspConfig, TabType } from 'aws-core-vscode/amazonq'
import { Messenger, MessengerOptions } from './messenger'
import { FeatureContext, globals, isSageMaker } from 'aws-core-vscode/shared'
import { AmazonQLspInstaller } from '../../../../src/lsp/lspInstaller'
import { TestFolder } from 'aws-core-vscode/test'
import { defaultAmazonQLspConfig } from '../../../../src/lsp/config'
import { activate as activateLspChat } from '../../../../src/lsp/chat/activation'

async function installLsp(lspConfig: LspConfig, createInstaller: (lspConfig?: LspConfig) => AmazonQLspInstaller) {
    const installer = createInstaller()
    const result = await installer.resolve()
    return result
}

function loadScript(scriptPath: string): string {
    return fs.readFileSync(path.resolve(scriptPath), 'utf-8')
}

// Add this near the top of your file, after the imports
declare global {
    interface Window {
        qChat: any
        init: Function
        acquireVsCodeApi: Function
        amazonQChat: any
        HybridChatAdapter: any
    }
}

import * as esbuild from 'esbuild'
import { startLanguageServer } from '../../../../src/lsp/client'
import { encryptionKey } from '../../../../src/lsp/auth'

async function bundle(inputPath: string, outputPath: string) {
    await esbuild.build({
        entryPoints: [inputPath],
        bundle: true,
        outfile: outputPath,
        format: 'iife',
        globalName: 'Connector',
        platform: 'browser',
        footer: {
            js: `window.HybridChatAdapter = Connector.HybridChatAdapter;`,
        },
        external: [],
        sourcemap: true,
    })
}

/**
 * Abstraction over Amazon Q to make e2e testing easier
 */
export class qTestingFramework {
    private readonly mynahUI: MynahUI
    private readonly mynahUIProps: MynahUIProps
    private disposables: vscode.Disposable[] = []
    lastEventId: string = ''

    constructor(
        featureName: TabType,
        amazonQEnabled: boolean,
        featureConfigsSerialized: [string, FeatureContext][],
        welcomeCount = Number.MAX_VALUE // by default don't show the welcome page
    ) {
        if (window.qChat) {
            this.mynahUI = window.qChat as unknown as MynahUI
            this.mynahUIProps = (window.qChat as any).props
        } else {
            throw new Error('window.qChat not available')
        }
        /**
         * In order to successfully remove tabs we need the last event id
         */
        const originalOnTabAdd = this.mynahUIProps.onTabAdd
        this.mynahUIProps.onTabAdd = (tabId, eventId) => {
            this.lastEventId = eventId ?? this.lastEventId
            window.qChat.lastEventId = eventId
            originalOnTabAdd && originalOnTabAdd(tabId)
        }

        /**
         * Listen to incoming events coming from VSCode and redirect them to MynahUI
         *
         * This implements the VSCode -> Mynah UI flow
         */
        this.disposables.push(
            DefaultAmazonQAppInitContext.instance.getAppsToWebViewMessageListener().onMessage(async (message) => {
                // Emulate the json format of postMessage
                const event = {
                    data: JSON.stringify(message),
                } as any
                await window.qChat.messageReceiver(event)
            })
        )
        // this.disposables.push(
        //     const appMessagePublisher = DefaultAmazonQAppInitContext.instance
        //         .getWebViewToAppsMessagePublishers()
        //         .get(featureName)
        //     if (appMessagePublisher === undefined) {
        //         return
        //     }
        //     appMessagePublisher.publish(message)
        // )

        // postMessage: (message: string) => {
        //     const appMessagePublisher = DefaultAmazonQAppInitContext.instance
        //         .getWebViewToAppsMessagePublishers()
        //         .get(featureName)
        //     if (appMessagePublisher === undefined) {
        //         return
        //     }
        //     appMessagePublisher.publish(message)
        // },

        /**
         * We need to manually indicate that the UI is ready since we are using a custom mynah UI event routing
         * implementation instead of routing events through the real webview
         **/
        DefaultAmazonQAppInitContext.instance.getAppsToWebViewMessagePublisher().setUiReady()
    }

    public static async create(
        featureName: TabType,
        amazonQEnabled: boolean,
        featureConfigsSerialized: [string, FeatureContext][]
    ): Promise<qTestingFramework> {
        const tempDir = await (await TestFolder.create()).mkdir()
        const lsp = await installLsp(
            { ...defaultAmazonQLspConfig, path: tempDir },
            (lspConfig?: LspConfig) => new AmazonQLspInstaller(lspConfig)
        )
        const uiPath = lsp.resourcePaths.ui
        const connectorPath = `/Users/opieter/Documents/repos/aws-toolkit-vscode/packages/core/dist/src/amazonq/webview/ui/connectorAdapter.js`
        const bundlePath = path.join(tempDir, 'connectorAdapter.js')
        if (!fs.existsSync(bundlePath)) {
            await bundle(connectorPath, bundlePath)
        }

        const langaugeClient = await startLanguageServer(globals.context, lsp.resourcePaths)

        const provider = await activateLspChat(langaugeClient, encryptionKey, uiPath)
        provider.uiPath = uiPath
        provider.connectorAdapterPath = connectorPath

        // const provider = new AmazonQChatViewProvider(uiPath)
        // provider.uiPath = uiPath
        // provider.connectorAdapterPath = connectorPath

        const uiScript = loadScript(uiPath)

        if (typeof window.ResizeObserver === 'undefined') {
            window.ResizeObserver = class ResizeObserver {
                callback: any
                constructor(callback: any) {
                    this.callback = callback
                }
                observe() {}
                unobserve() {}
                disconnect() {}
            }
        }
        if (typeof window.IntersectionObserver === 'undefined') {
            window.IntersectionObserver = class IntersectionObserver {
                observe() {}
                unobserve() {}
                disconnect() {}
                takeRecords() {
                    return []
                }
                // eslint-disable-next-line unicorn/no-null
                root = null
                rootMargin = ''
                thresholds = []
            }
        }

        window.eval(uiScript)

        const connectorContent = fs.readFileSync(bundlePath, 'utf8')
        const connectorScript = document.createElement('script')
        connectorScript.textContent = connectorContent
        document.body.appendChild(connectorScript)

        const vscodeApi = {
            postMessage: (message: any) => {
                console.log('VSCode postMessage:', message)
                const appMessagePublisher = DefaultAmazonQAppInitContext.instance
                    .getWebViewToAppsMessagePublishers()
                    .get(featureName)
                if (appMessagePublisher === undefined) {
                    console.log('appMessagePublisher undefined')
                    return
                }
                appMessagePublisher.publish(message)
                console.log('appMessagePublisher published')
            },
            getState: () => ({}),
            setState: (state: any) => console.log('setState:', state),
        } as any
        window.acquireVsCodeApi = () => vscodeApi

        const isSM = isSageMaker('SMAI')
        const isSMUS = isSageMaker('SMUS')
        const disabledCommands = isSM ? ['/dev', '/transform', '/test', '/review', '/doc'] : []
        const disclaimerAcknowledged = true
        const pairProgrammingAcknowledged = true
        const welcomeCount = Number.MAX_VALUE // by default don't show the welcome page

        const hybridChatConnector = new window.HybridChatAdapter(
            true, // enableAgents
            [], // featureConfigsSerialized
            welcomeCount, // welcomeCount
            disclaimerAcknowledged, // disclaimerAcknowledged
            undefined, // regionProfile
            disabledCommands, // disabledCommands
            isSMUS, // isSMUS
            isSM, // isSM
            vscodeApi.postMessage // ideApiPostMessage
        )

        window.qChat = window.amazonQChat.createChat(
            vscodeApi,
            {
                disclaimerAcknowledged,
                pairProgrammingAcknowledged,
                quickActionCommands: [hybridChatConnector.initialQuickActions[0]],
            },
            hybridChatConnector,
            '[]'
        )
        //registerMessageListeners(languageClient, provider, encryptionKey)

        const framework = new qTestingFramework(featureName, amazonQEnabled, featureConfigsSerialized)

        return framework
    }

    /**
     * Create a new tab and then return a new encapsulated tab messenger that makes it easier to directly call
     * functionality against a specific tab
     */
    public createTab(options?: MessengerOptions) {
        const oldTabs = Object.keys(this.mynahUI.getAllTabs())

        // simulate pressing the new tab button
        ;(document.querySelectorAll('.mynah-nav-tabs-wrapper > button.mynah-button')[0] as HTMLButtonElement).click()
        const newTabs = Object.keys(this.mynahUI.getAllTabs())
        const newTabID = newTabs.find((tab) => !oldTabs.includes(tab))
        if (!newTabID) {
            assert.fail('Could not find new tab')
        }

        return new Messenger(newTabID, this.mynahUIProps, this.mynahUI, options)
    }

    public getTabs() {
        const tabs = this.mynahUI.getAllTabs()
        return Object.entries(tabs).map(([tabId]) => new Messenger(tabId, this.mynahUIProps, this.mynahUI))
    }

    public getSelectedTab() {
        const selectedTabId = this.mynahUI.getSelectedTabId()
        const selectedTab = this.getTabs().find((tab) => tab.tabID === selectedTabId)

        if (!selectedTab) {
            assert.fail('Selected tab not found')
        }
        return selectedTab
    }

    public findTab(title: string) {
        return Object.values(this.getTabs()).find((tab) => tab.getStore().tabTitle === title)
    }

    public removeTab(tabId: string) {
        this.mynahUI.removeTab(tabId, this.lastEventId)
    }

    public removeAllTabs() {
        Object.keys(this.mynahUI.getAllTabs()).forEach((tabId) => {
            const eventId = this.lastEventId || `mock-${Date.now()}`
            this.mynahUI.removeTab(tabId, eventId)
        })
    }

    public dispose() {
        vscode.Disposable.from(...this.disposables).dispose()
        this.mynahUI.destroy()
    }
}
