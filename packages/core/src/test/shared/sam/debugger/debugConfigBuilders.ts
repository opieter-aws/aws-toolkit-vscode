/*!
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import * as path from 'path'
import * as pathutil from '../../../../shared/utilities/pathUtils'
import * as testutil from '../../../testUtil'
import {
    AwsSamDebuggerConfiguration,
    API_TARGET_TYPE,
    AWS_SAM_DEBUG_TYPE,
    CODE_TARGET_TYPE,
    DIRECT_INVOKE_TYPE,
    TEMPLATE_TARGET_TYPE,
    PathMapping,
} from '../../../../shared/sam/debugger/awsSamDebugConfiguration'

/**
 * Base builder class for creating SAM debug configurations with fluent API
 */
abstract class BaseDebugConfigBuilder<T extends BaseDebugConfigBuilder<T>> {
    protected config: Partial<AwsSamDebuggerConfiguration> = {
        type: AWS_SAM_DEBUG_TYPE,
        name: 'test-config',
        request: DIRECT_INVOKE_TYPE,
    }

    withName(name: string): T {
        this.config.name = name
        return this as unknown as T
    }

    withNoDebug(noDebug: boolean): T {
        ;(this.config as any).noDebug = noDebug
        return this as unknown as T
    }

    withEnvVars(envVars: Record<string, string>): T {
        this.config.lambda = {
            ...this.config.lambda,
            environmentVariables: envVars,
        }
        return this as unknown as T
    }

    withPayloadJson(payload: Record<string, any>): T {
        this.config.lambda = {
            ...this.config.lambda,
            payload: { json: payload },
        }
        return this as unknown as T
    }

    withPayloadPath(payloadPath: string): T {
        this.config.lambda = {
            ...this.config.lambda,
            payload: { path: payloadPath },
        }
        return this as unknown as T
    }

    withMemoryMb(memoryMb: number): T {
        this.config.lambda = {
            ...this.config.lambda,
            memoryMb,
        }
        return this as unknown as T
    }

    withTimeoutSec(timeoutSec: number): T {
        this.config.lambda = {
            ...this.config.lambda,
            timeoutSec,
        }
        return this as unknown as T
    }

    withPathMappings(pathMappings: PathMapping[]): T {
        this.config.lambda = {
            ...this.config.lambda,
            pathMappings,
        }
        return this as unknown as T
    }

    abstract build(): AwsSamDebuggerConfiguration
}

/**
 * Builder for CODE target debug configurations
 */
export class CodeTargetDebugConfigBuilder extends BaseDebugConfigBuilder<CodeTargetDebugConfigBuilder> {
    constructor(runtime: string, handler: string, projectRoot: string) {
        super()
        this.config.invokeTarget = {
            target: CODE_TARGET_TYPE,
            lambdaHandler: handler,
            projectRoot,
        }
        this.config.lambda = {
            runtime,
            environmentVariables: {},
        }
    }

    withHandler(handler: string): this {
        if (this.config.invokeTarget && 'lambdaHandler' in this.config.invokeTarget) {
            this.config.invokeTarget.lambdaHandler = handler
        }
        return this
    }

    withProjectRoot(projectRoot: string): this {
        if (this.config.invokeTarget && 'projectRoot' in this.config.invokeTarget) {
            this.config.invokeTarget.projectRoot = projectRoot
        }
        return this
    }

    build(): AwsSamDebuggerConfiguration {
        return this.config as AwsSamDebuggerConfiguration
    }
}

/**
 * Builder for TEMPLATE target debug configurations
 */
export class TemplateTargetDebugConfigBuilder extends BaseDebugConfigBuilder<TemplateTargetDebugConfigBuilder> {
    constructor(runtime: string, templatePath: string, logicalId: string) {
        super()
        this.config.invokeTarget = {
            target: TEMPLATE_TARGET_TYPE,
            templatePath,
            logicalId,
        }
        this.config.lambda = {
            runtime,
            environmentVariables: {},
        }
    }

    withTemplatePath(templatePath: string): this {
        if (this.config.invokeTarget && 'templatePath' in this.config.invokeTarget) {
            this.config.invokeTarget.templatePath = templatePath
        }
        return this
    }

    withLogicalId(logicalId: string): this {
        if (this.config.invokeTarget && 'logicalId' in this.config.invokeTarget) {
            this.config.invokeTarget.logicalId = logicalId
        }
        return this
    }

    build(): AwsSamDebuggerConfiguration {
        return this.config as AwsSamDebuggerConfiguration
    }
}

/**
 * Builder for API target debug configurations
 */
export class ApiTargetDebugConfigBuilder extends BaseDebugConfigBuilder<ApiTargetDebugConfigBuilder> {
    constructor(runtime: string, templatePath: string, logicalId: string, path: string, httpMethod: string) {
        super()
        this.config.invokeTarget = {
            target: TEMPLATE_TARGET_TYPE,
            templatePath,
            logicalId,
        }
        this.config.lambda = {
            runtime,
            environmentVariables: {},
        }
        this.config.api = {
            path,
            httpMethod,
        }
    }

    withPath(path: string): this {
        if (this.config.api) {
            this.config.api.path = path
        }
        return this
    }

    withHttpMethod(httpMethod: string): this {
        if (this.config.api) {
            this.config.api.httpMethod = httpMethod
        }
        return this
    }

    withQuerystring(querystring: string): this {
        this.config.api = {
            ...this.config.api,
            querystring,
        } as any
        return this
    }

    withHeaders(headers: Record<string, string>): this {
        this.config.api = {
            ...this.config.api,
            headers,
        } as any
        return this
    }

    build(): AwsSamDebuggerConfiguration {
        // For API targets, we need to set the target type correctly
        if (this.config.invokeTarget) {
            ;(this.config.invokeTarget as any).target = API_TARGET_TYPE
        }
        return this.config as AwsSamDebuggerConfiguration
    }
}

/**
 * Runtime-specific helper functions to create common configurations
 */
export function createNodeJsCodeConfig(appDir: string, handler: string, projectRoot: string): CodeTargetDebugConfigBuilder {
    return new CodeTargetDebugConfigBuilder('nodejs18.x', handler, projectRoot)
}

export function createPythonCodeConfig(appDir: string, handler: string, projectRoot: string): CodeTargetDebugConfigBuilder {
    return new CodeTargetDebugConfigBuilder('python3.7', handler, projectRoot)
}

export function createJavaMavenCodeConfig(appDir: string, handler: string, projectRoot: string): CodeTargetDebugConfigBuilder {
    return new CodeTargetDebugConfigBuilder('java17', handler, projectRoot)
}

export function createJavaGradleCodeConfig(appDir: string, handler: string, projectRoot: string): CodeTargetDebugConfigBuilder {
    return new CodeTargetDebugConfigBuilder('java17', handler, projectRoot)
}

export function createDotnetCodeConfig(appDir: string, handler: string, projectRoot: string): CodeTargetDebugConfigBuilder {
    return new CodeTargetDebugConfigBuilder('dotnet6', handler, projectRoot)
}

export function createGoCodeConfig(appDir: string, handler: string, projectRoot: string): CodeTargetDebugConfigBuilder {
    return new CodeTargetDebugConfigBuilder('go1.x', handler, projectRoot)
}

export function createNodeJsTemplateConfig(
    templatePath: string,
    logicalId: string
): TemplateTargetDebugConfigBuilder {
    return new TemplateTargetDebugConfigBuilder('nodejs18.x', templatePath, logicalId)
}

export function createPythonTemplateConfig(
    templatePath: string,
    logicalId: string
): TemplateTargetDebugConfigBuilder {
    return new TemplateTargetDebugConfigBuilder('python3.7', templatePath, logicalId)
}

export function createJavaTemplateConfig(
    templatePath: string,
    logicalId: string
): TemplateTargetDebugConfigBuilder {
    return new TemplateTargetDebugConfigBuilder('java17', templatePath, logicalId)
}

export function createDotnetTemplateConfig(
    templatePath: string,
    logicalId: string
): TemplateTargetDebugConfigBuilder {
    return new TemplateTargetDebugConfigBuilder('dotnet6', templatePath, logicalId)
}

export function createGoTemplateConfig(
    templatePath: string,
    logicalId: string
): TemplateTargetDebugConfigBuilder {
    return new TemplateTargetDebugConfigBuilder('go1.x', templatePath, logicalId)
}
