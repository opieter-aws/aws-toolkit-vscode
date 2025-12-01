/*!
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import * as os from 'os'
import * as path from 'path'
import * as vscode from 'vscode'
import * as pathutil from '../../../../shared/utilities/pathUtils'
import * as lambdaModel from '../../../../lambda/models/samLambdaRuntime'
import { SamLaunchRequestArgs } from '../../../../shared/sam/debugger/awsSamDebugger'
import { AWS_SAM_DEBUG_TYPE } from '../../../../shared/sam/debugger/awsSamDebugConfiguration'
import { Credentials } from '@aws-sdk/types'

export interface BaseExpectedConfigParams {
    appDir: string
    input: any
    actual: SamLaunchRequestArgs
    fakeCredentials: Credentials
    codeRoot: string
    handler: string
}

export interface CodeTargetExpectedConfigParams extends BaseExpectedConfigParams {
    projectRoot: string
}

export interface TemplateTargetExpectedConfigParams extends BaseExpectedConfigParams {
    templatePath: string
    resourceName: string
}

/**
 * Create base expected configuration shared by all runtimes
 */
function createBaseExpectedConfig(params: BaseExpectedConfigParams): Partial<SamLaunchRequestArgs> {
    return {
        type: AWS_SAM_DEBUG_TYPE,
        awsCredentials: params.fakeCredentials,
        request: 'attach',
        workspaceFolder: {
            index: 0,
            name: 'test-workspace-folder',
            uri: vscode.Uri.file(params.appDir),
        },
        baseBuildDir: params.actual.baseBuildDir,
        debugPort: params.actual.debugPort,
        documentUri: vscode.Uri.file(''),
        handlerName: params.handler,
        invokeTarget: { ...params.input.invokeTarget },
        lambda: params.input.lambda,
        name: params.input.name,
        parameterOverrides: undefined,
        architecture: undefined,
        region: 'us-west-2',
        codeRoot: params.codeRoot,
    }
}

/**
 * Create expected Node.js configuration for CODE target
 */
export function createExpectedNodeJsCodeConfig(params: CodeTargetExpectedConfigParams): SamLaunchRequestArgs {
    const base = createBaseExpectedConfig(params)
    return {
        ...base,
        runtime: params.input.lambda.runtime,
        runtimeFamily: lambdaModel.RuntimeFamily.NodeJS,
        envFile: `${params.actual.baseBuildDir}/env-vars.json`,
        eventPayloadFile: `${params.actual.baseBuildDir}/event.json`,
        apiPort: undefined,
        localRoot: params.codeRoot,
        templatePath: pathutil.normalize(path.join(params.actual.baseBuildDir!, 'app___vsctk___template.yaml')),
        address: 'localhost',
        port: params.actual.debugPort,
        preLaunchTask: undefined,
        protocol: 'inspector',
        remoteRoot: '/var/task',
        skipFiles: ['/var/runtime/node_modules/**/*.js', '<node_internals>/**/*.js'],
        continueOnAttach: true,
        stopOnEntry: false,
    } as SamLaunchRequestArgs
}

/**
 * Create expected Node.js configuration for TEMPLATE target
 */
export function createExpectedNodeJsTemplateConfig(params: TemplateTargetExpectedConfigParams): SamLaunchRequestArgs {
    const base = createBaseExpectedConfig(params)
    return {
        ...base,
        runtime: params.input.lambda.runtime,
        runtimeFamily: lambdaModel.RuntimeFamily.NodeJS,
        envFile: `${params.actual.baseBuildDir}/env-vars.json`,
        eventPayloadFile: `${params.actual.baseBuildDir}/event.json`,
        apiPort: undefined,
        localRoot: params.codeRoot,
        templatePath: params.templatePath,
        address: 'localhost',
        port: params.actual.debugPort,
        preLaunchTask: undefined,
        protocol: 'inspector',
        remoteRoot: '/var/task',
        skipFiles: ['/var/runtime/node_modules/**/*.js', '<node_internals>/**/*.js'],
        continueOnAttach: true,
        stopOnEntry: false,
    } as SamLaunchRequestArgs
}

/**
 * Create expected Node.js configuration for API target
 */
export function createExpectedNodeJsApiConfig(params: TemplateTargetExpectedConfigParams): SamLaunchRequestArgs {
    const templateConfig = createExpectedNodeJsTemplateConfig(params)
    return {
        ...templateConfig,
        apiPort: params.actual.apiPort,
        api: params.input.api,
    } as SamLaunchRequestArgs
}

/**
 * Create expected Python configuration for CODE target
 */
export function createExpectedPythonCodeConfig(params: CodeTargetExpectedConfigParams): SamLaunchRequestArgs {
    const base = createBaseExpectedConfig(params)
    const pathMappings = [
        {
            localRoot: params.codeRoot,
            remoteRoot: '/var/task',
        },
    ]

    // Windows: pathMappings has uppercase and lowercase variants
    if (os.platform() === 'win32') {
        const localRoot: string = pathMappings[0].localRoot
        pathMappings.unshift({
            localRoot: localRoot.substring(0, 1).toLowerCase() + localRoot.substring(1),
            remoteRoot: '/var/task',
        })
    }

    return {
        ...base,
        runtime: params.input.lambda.runtime,
        runtimeFamily: lambdaModel.RuntimeFamily.Python,
        envFile: undefined,
        eventPayloadFile: `${params.actual.baseBuildDir}/event.json`,
        apiPort: undefined,
        templatePath: pathutil.normalize(path.join(params.actual.baseBuildDir!, 'app___vsctk___template.yaml')),
        port: params.actual.debugPort,
        debugArgs: [
            `/tmp/lambci_debug_files/py_debug_wrapper.py --listen 0.0.0.0:${params.actual.debugPort} --wait-for-client --log-to-stderr --debug`,
        ],
        host: 'localhost',
        pathMappings,
        redirectOutput: false,
    } as SamLaunchRequestArgs
}

/**
 * Create expected Python configuration for TEMPLATE target
 */
export function createExpectedPythonTemplateConfig(params: TemplateTargetExpectedConfigParams): SamLaunchRequestArgs {
    const base = createBaseExpectedConfig(params)
    const pathMappings = [
        {
            localRoot: params.codeRoot,
            remoteRoot: '/var/task',
        },
    ]

    // Windows: pathMappings has uppercase and lowercase variants
    if (os.platform() === 'win32') {
        const localRoot: string = pathMappings[0].localRoot
        pathMappings.unshift({
            localRoot: localRoot.substring(0, 1).toLowerCase() + localRoot.substring(1),
            remoteRoot: '/var/task',
        })
    }

    return {
        ...base,
        runtime: params.input.lambda.runtime,
        runtimeFamily: lambdaModel.RuntimeFamily.Python,
        envFile: `${params.actual.baseBuildDir}/env-vars.json`,
        eventPayloadFile: `${params.actual.baseBuildDir}/event.json`,
        apiPort: undefined,
        templatePath: params.templatePath,
        port: params.actual.debugPort,
        debugArgs: [
            `/tmp/lambci_debug_files/py_debug_wrapper.py --listen 0.0.0.0:${params.actual.debugPort} --wait-for-client --log-to-stderr --debug`,
        ],
        host: 'localhost',
        pathMappings,
        redirectOutput: false,
    } as SamLaunchRequestArgs
}

/**
 * Create expected Python configuration for API target
 */
export function createExpectedPythonApiConfig(params: TemplateTargetExpectedConfigParams): SamLaunchRequestArgs {
    const templateConfig = createExpectedPythonTemplateConfig(params)
    return {
        ...templateConfig,
        apiPort: params.actual.apiPort,
        api: params.input.api,
    } as SamLaunchRequestArgs
}

/**
 * Create expected Java configuration for CODE target
 */
export function createExpectedJavaCodeConfig(params: CodeTargetExpectedConfigParams): SamLaunchRequestArgs {
    const base = createBaseExpectedConfig(params)
    return {
        ...base,
        runtime: params.input.lambda.runtime,
        runtimeFamily: lambdaModel.RuntimeFamily.Java,
        envFile: `${params.actual.baseBuildDir}/env-vars.json`,
        eventPayloadFile: `${params.actual.baseBuildDir}/event.json`,
        apiPort: undefined,
        templatePath: pathutil.normalize(path.join(params.actual.baseBuildDir!, 'app___vsctk___template.yaml')),
        port: params.actual.debugPort,
        hostName: 'localhost',
    } as SamLaunchRequestArgs
}

/**
 * Create expected Java configuration for TEMPLATE target
 */
export function createExpectedJavaTemplateConfig(params: TemplateTargetExpectedConfigParams): SamLaunchRequestArgs {
    const base = createBaseExpectedConfig(params)
    return {
        ...base,
        runtime: params.input.lambda.runtime,
        runtimeFamily: lambdaModel.RuntimeFamily.Java,
        envFile: `${params.actual.baseBuildDir}/env-vars.json`,
        eventPayloadFile: `${params.actual.baseBuildDir}/event.json`,
        apiPort: undefined,
        templatePath: params.templatePath,
        port: params.actual.debugPort,
        hostName: 'localhost',
    } as SamLaunchRequestArgs
}

/**
 * Create expected .NET configuration for CODE target
 */
export function createExpectedDotnetCodeConfig(params: CodeTargetExpectedConfigParams): SamLaunchRequestArgs {
    const base = createBaseExpectedConfig(params)
    return {
        ...base,
        runtime: params.input.lambda.runtime,
        runtimeFamily: lambdaModel.RuntimeFamily.DotNet,
        envFile: `${params.actual.baseBuildDir}/env-vars.json`,
        eventPayloadFile: `${params.actual.baseBuildDir}/event.json`,
        apiPort: undefined,
        templatePath: pathutil.normalize(path.join(params.actual.baseBuildDir!, 'app___vsctk___template.yaml')),
        port: params.actual.debugPort,
        debuggerPath: params.actual.debuggerPath,
        pipeTransport: {
            debuggerPath: params.actual.debuggerPath,
            pipeProgram: 'sh',
            pipeArgs: [
                '-c',
                `docker exec -i $(docker ps -q -f publish=${params.actual.debugPort}) \${debuggerCommand}`,
            ],
            pipeCwd: params.codeRoot,
        },
        processName: 'dotnet',
        sourceFileMap: {
            '/var/task': params.codeRoot,
        },
        windows: {
            pipeTransport: {
                debuggerPath: params.actual.debuggerPath,
                pipeProgram: 'powershell',
                pipeArgs: [
                    '-c',
                    `docker exec -i $(docker ps -q -f publish=${params.actual.debugPort}) \${debuggerCommand}`,
                ],
                pipeCwd: params.codeRoot,
            },
        },
    } as SamLaunchRequestArgs
}

/**
 * Create expected .NET configuration for TEMPLATE target
 */
export function createExpectedDotnetTemplateConfig(params: TemplateTargetExpectedConfigParams): SamLaunchRequestArgs {
    const base = createBaseExpectedConfig(params)
    return {
        ...base,
        runtime: params.input.lambda.runtime,
        runtimeFamily: lambdaModel.RuntimeFamily.DotNet,
        envFile: `${params.actual.baseBuildDir}/env-vars.json`,
        eventPayloadFile: `${params.actual.baseBuildDir}/event.json`,
        apiPort: undefined,
        templatePath: params.templatePath,
        port: params.actual.debugPort,
        debuggerPath: params.actual.debuggerPath,
        pipeTransport: {
            debuggerPath: params.actual.debuggerPath,
            pipeProgram: 'sh',
            pipeArgs: [
                '-c',
                `docker exec -i $(docker ps -q -f publish=${params.actual.debugPort}) \${debuggerCommand}`,
            ],
            pipeCwd: params.codeRoot,
        },
        processName: 'dotnet',
        sourceFileMap: {
            '/var/task': params.codeRoot,
        },
        windows: {
            pipeTransport: {
                debuggerPath: params.actual.debuggerPath,
                pipeProgram: 'powershell',
                pipeArgs: [
                    '-c',
                    `docker exec -i $(docker ps -q -f publish=${params.actual.debugPort}) \${debuggerCommand}`,
                ],
                pipeCwd: params.codeRoot,
            },
        },
    } as SamLaunchRequestArgs
}

/**
 * Create expected Go configuration for CODE target
 */
export function createExpectedGoCodeConfig(params: CodeTargetExpectedConfigParams): SamLaunchRequestArgs {
    const base = createBaseExpectedConfig(params)
    return {
        ...base,
        runtime: params.input.lambda.runtime,
        runtimeFamily: lambdaModel.RuntimeFamily.Go,
        envFile: `${params.actual.baseBuildDir}/env-vars.json`,
        eventPayloadFile: `${params.actual.baseBuildDir}/event.json`,
        apiPort: undefined,
        templatePath: pathutil.normalize(path.join(params.actual.baseBuildDir!, 'app___vsctk___template.yaml')),
        port: params.actual.debugPort,
        host: 'localhost',
        mode: 'remote',
    } as SamLaunchRequestArgs
}

/**
 * Create expected Go configuration for TEMPLATE target
 */
export function createExpectedGoTemplateConfig(params: TemplateTargetExpectedConfigParams): SamLaunchRequestArgs {
    const base = createBaseExpectedConfig(params)
    return {
        ...base,
        runtime: params.input.lambda.runtime,
        runtimeFamily: lambdaModel.RuntimeFamily.Go,
        envFile: `${params.actual.baseBuildDir}/env-vars.json`,
        eventPayloadFile: `${params.actual.baseBuildDir}/event.json`,
        apiPort: undefined,
        templatePath: params.templatePath,
        port: params.actual.debugPort,
        host: 'localhost',
        mode: 'remote',
    } as SamLaunchRequestArgs
}
