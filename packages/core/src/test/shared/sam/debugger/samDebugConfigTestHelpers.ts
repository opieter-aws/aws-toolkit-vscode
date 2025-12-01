/*!
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'assert'
import * as path from 'path'
import * as vscode from 'vscode'
import * as pathutil from '../../../../shared/utilities/pathUtils'
import * as testutil from '../../../testUtil'
import { SamLaunchRequestArgs, SamDebugConfigProvider } from '../../../../shared/sam/debugger/awsSamDebugger'
import { AwsSamDebuggerConfiguration } from '../../../../shared/sam/debugger/awsSamDebugConfiguration'

/**
 * Asserts the contents of a "launch config" (the result of `makeConfig()` or
 * `resolveDebugConfiguration()` invoked on a user-provided "debug config").
 */
export function assertEqualLaunchConfigs(actual: SamLaunchRequestArgs, expected: SamLaunchRequestArgs) {
    // Deep copy, do not modify the original variables.
    actual = { ...actual }
    expected = { ...expected }

    assert.strictEqual(actual.workspaceFolder.name, expected.workspaceFolder.name)

    // Compare filepaths (before removing them for deep-compare).
    testutil.assertEqualPaths(actual.workspaceFolder.uri.fsPath, expected.workspaceFolder.uri.fsPath)

    // Port number is unstable; check that it looks reasonable.
    assert.ok(!actual.apiPort || actual.apiPort > 5000)
    assert.ok(!actual.debugPort || actual.debugPort > 5000)
    assert.strictEqual(actual.port, expected.port)

    // Build dir is randomly-generated; check that it looks reasonable.
    assert.ok(actual.baseBuildDir && actual.baseBuildDir.length > 9)
    if (expected.type === 'python') {
        // manifestPath is randomly-generated; check that it looks reasonable.
        assert.ok(actual.manifestPath && actual.manifestPath.length > 9)
    }

    // should never be defined if we're not debugging
    if (expected.noDebug) {
        delete expected.debugArgs
        delete expected.containerEnvFile
        delete expected.containerEnvVars
    }

    // Normalize path fields before comparing.
    for (const o of [actual, expected]) {
        o.codeRoot = pathutil.normalize(o.codeRoot)
        o.containerEnvFile = o.containerEnvFile ? pathutil.normalize(o.containerEnvFile) : o.containerEnvFile
        o.envFile = o.envFile ? pathutil.normalize(o.envFile) : undefined
        o.eventPayloadFile = o.eventPayloadFile ? pathutil.normalize(o.eventPayloadFile) : undefined
        o.debuggerPath = o.debuggerPath ? pathutil.normalize(o.debuggerPath) : o.debuggerPath
        o.localRoot = o.localRoot ? pathutil.normalize(o.localRoot) : o.localRoot
    }

    // Remove noisy properties before doing a deep-compare.
    for (const o of [actual, expected]) {
        delete o.manifestPath
        delete (o as any).documentUri
        delete (o as any).templatePath
        delete (o as any).workspaceFolder
        delete (o as any).codeRoot
        delete (o as any).localRoot // Node-only
        delete (o as any).debuggerPath // Dotnet-only
    }
    assert.deepStrictEqual(actual, expected)
}

/**
 * Tests `noDebug=true` for the given `input` and fixes up the given `expected`
 * result, for a `target=template` config.
 */
export async function assertEqualNoDebugTemplateTarget(
    input: any,
    expected: SamLaunchRequestArgs,
    folder: vscode.WorkspaceFolder,
    debugConfigProvider: SamDebugConfigProvider,
    noFiles?: boolean
) {
    ;(input as any).noDebug = true
    const actualNoDebug = (await debugConfigProvider.makeConfig(folder, input))!
    const expectedNoDebug: SamLaunchRequestArgs = {
        ...expected,
        noDebug: true,
        request: 'launch',
        debugPort: undefined,
        port: -1,
        baseBuildDir: actualNoDebug.baseBuildDir,
        envFile: noFiles ? undefined : `${actualNoDebug.baseBuildDir}/env-vars.json`,
        eventPayloadFile: noFiles ? undefined : `${actualNoDebug.baseBuildDir}/event.json`,
    }
    assertEqualLaunchConfigs(actualNoDebug, expectedNoDebug)
}

/**
 * Tests `noDebug=true` for code targets
 */
export async function testCodeTargetNoDebug(
    input: AwsSamDebuggerConfiguration,
    expected: SamLaunchRequestArgs,
    folder: vscode.WorkspaceFolder,
    debugConfigProvider: SamDebugConfigProvider
) {
    ;(input as any).noDebug = true
    const actualNoDebug = (await debugConfigProvider.makeConfig(folder, input))!
    const expectedNoDebug: SamLaunchRequestArgs = {
        ...expected,
        noDebug: true,
        request: 'launch',
        debugPort: undefined,
        port: -1,
        baseBuildDir: actualNoDebug.baseBuildDir,
        envFile: `${actualNoDebug.baseBuildDir}/env-vars.json`,
        eventPayloadFile: `${actualNoDebug.baseBuildDir}/event.json`,
    }
    assertEqualLaunchConfigs(actualNoDebug, expectedNoDebug)
}

/**
 * Tests pathMapping configuration
 */
export async function testPathMapping(
    input: AwsSamDebuggerConfiguration,
    expected: SamLaunchRequestArgs,
    folder: vscode.WorkspaceFolder,
    debugConfigProvider: SamDebugConfigProvider,
    pathMappings: any[]
) {
    const inputWithPathMapping = {
        ...input,
        lambda: {
            ...input.lambda,
            pathMappings,
        },
    }
    const actualWithPathMapping = (await debugConfigProvider.makeConfig(folder, inputWithPathMapping))!
    const expectedWithPathMapping: SamLaunchRequestArgs = {
        ...expected,
        lambda: {
            ...expected.lambda,
            pathMappings,
        },
        localRoot: pathMappings[0].localRoot,
        remoteRoot: pathMappings[0].remoteRoot,
        baseBuildDir: actualWithPathMapping.baseBuildDir,
        envFile: `${actualWithPathMapping.baseBuildDir}/env-vars.json`,
        eventPayloadFile: `${actualWithPathMapping.baseBuildDir}/event.json`,
    }
    assertEqualLaunchConfigs(actualWithPathMapping, expectedWithPathMapping)
}

/**
 * Tests pathMapping configuration for Python (no envFile)
 */
export async function testPythonPathMapping(
    input: AwsSamDebuggerConfiguration,
    expected: SamLaunchRequestArgs,
    folder: vscode.WorkspaceFolder,
    debugConfigProvider: SamDebugConfigProvider,
    pathMappings: any[]
) {
    const inputWithPathMapping = {
        ...input,
        lambda: {
            ...input.lambda,
            pathMappings,
        },
    }
    const actualWithPathMapping = (await debugConfigProvider.makeConfig(folder, inputWithPathMapping))!
    const expectedWithPathMapping: SamLaunchRequestArgs = {
        ...expected,
        lambda: {
            ...expected.lambda,
            pathMappings,
        },
        pathMappings,
        baseBuildDir: actualWithPathMapping.baseBuildDir,
        envFile: undefined,
        eventPayloadFile: `${actualWithPathMapping.baseBuildDir}/event.json`,
    }
    assertEqualLaunchConfigs(actualWithPathMapping, expectedWithPathMapping)
}

/**
 * Helper to get app directory from test fixtures
 */
export function getAppDir(relativePath: string): string {
    return pathutil.normalize(path.join(testutil.getProjectDir(), relativePath))
}

/**
 * Helper to get workspace folder
 */
export function getFolder(appDir: string): vscode.WorkspaceFolder {
    return testutil.getWorkspaceFolder(appDir)
}
