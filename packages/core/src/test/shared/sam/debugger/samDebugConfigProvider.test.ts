/*!
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'assert'
import * as os from 'os'
import * as path from 'path'
import * as sinon from 'sinon'
import * as vscode from 'vscode'
import * as lambdaModel from '../../../../lambda/models/samLambdaRuntime'
import { CloudFormationTemplateRegistry } from '../../../../shared/fs/templateRegistry'
import { makeTemporaryToolkitFolder } from '../../../../shared/filesystemUtilities'
import {
    TemplateTargetProperties,
    AwsSamDebuggerConfiguration,
    API_TARGET_TYPE,
    AWS_SAM_DEBUG_TYPE,
    CODE_TARGET_TYPE,
    DIRECT_INVOKE_TYPE,
    TEMPLATE_TARGET_TYPE,
    createTemplateAwsSamDebugConfig,
    ensureRelativePaths,
    createCodeAwsSamDebugConfig,
    CodeTargetProperties,
    createApiAwsSamDebugConfig,
    APIGatewayProperties,
    PathMapping,
} from '../../../../shared/sam/debugger/awsSamDebugConfiguration'
import { SamDebugConfigProvider, SamLaunchRequestArgs } from '../../../../shared/sam/debugger/awsSamDebugger'
import * as debugConfiguration from '../../../../lambda/local/debugConfiguration'
import * as pathutil from '../../../../shared/utilities/pathUtils'
import { FakeExtensionContext } from '../../../fakeExtensionContext'
import * as testutil from '../../../testUtil'
import { assertFileText } from '../../../testUtil'
import {
    makeSampleSamTemplateYaml,
    makeSampleYamlResource,
    makeSampleYamlParameters,
} from '../../cloudformation/cloudformationTestUtils'
import { CredentialsStore } from '../../../../auth/credentials/store'
import { CredentialsProviderManager } from '../../../../auth/providers/credentialsProviderManager'
import { Credentials } from '@aws-sdk/types'
import { ExtContext } from '../../../../shared/extensions'
import { getLogger } from '../../../../shared/logger/logger'
import { CredentialsProvider } from '../../../../auth/providers/credentials'
import globals from '../../../../shared/extensionGlobals'
import { isCI } from '../../../../shared/vscode/env'
import { fs } from '../../../../shared'
// Import refactored helper modules
import {
    assertEqualLaunchConfigs,
    assertEqualNoDebugTemplateTarget,
    testCodeTargetNoDebug,
    testPathMapping,
    testPythonPathMapping,
    getAppDir,
    getFolder,
} from './samDebugConfigTestHelpers'
import {
    CodeTargetDebugConfigBuilder,
    TemplateTargetDebugConfigBuilder,
    ApiTargetDebugConfigBuilder,
} from './debugConfigBuilders'
import {
    createExpectedNodeJsCodeConfig,
    createExpectedNodeJsTemplateConfig,
    createExpectedNodeJsApiConfig,
    createExpectedPythonCodeConfig,
    createExpectedPythonTemplateConfig,
    createExpectedPythonApiConfig,
    createExpectedJavaCodeConfig,
    createExpectedJavaTemplateConfig,
    createExpectedDotnetCodeConfig,
    createExpectedDotnetTemplateConfig,
    createExpectedGoCodeConfig,
    createExpectedGoTemplateConfig,
} from './expectedLaunchConfigs'
describe('SamDebugConfigurationProvider', async function () {
    let debugConfigProvider: SamDebugConfigProvider
    let tempFolder: string
    let tempFolderSimilarName: string | undefined
    let tempFile: vscode.Uri
    let fakeWorkspaceFolder: vscode.WorkspaceFolder
    let fakeContext: ExtContext
    let sandbox: sinon.SinonSandbox
    const resourceName = 'myResource'
    const fakeCredentials: Credentials = {
        accessKeyId: 'fake-access-id',
        secretAccessKey: 'fake-secret',
        sessionToken: 'fake-session',
    }

    beforeEach(async function () {
        fakeContext = await FakeExtensionContext.getFakeExtContext()
        await fakeContext.awsContext.setCredentials({
            accountId: '9888888',
            credentials: fakeCredentials,
            credentialsId: 'profile:fake',
            defaultRegion: 'us-west-2',
        })
        debugConfigProvider = new SamDebugConfigProvider(fakeContext)
        sandbox = sinon.createSandbox()

        fakeWorkspaceFolder = await testutil.createTestWorkspaceFolder()
        tempFolder = fakeWorkspaceFolder.uri.fsPath
        tempFile = vscode.Uri.file(path.join(tempFolder, 'test.yaml'))
        tempFolderSimilarName = undefined
    })

    afterEach(async function () {
        await fs.delete(tempFolder, { recursive: true })
        if (tempFolderSimilarName) {
            await fs.delete(tempFolderSimilarName, { recursive: true })
        }
        ;(await globals.templateRegistry).reset()
        sandbox.restore()
    })

    describe('provideDebugConfig', async function () {
        it('failure modes', async function () {
            // No workspace folder:
            assert.deepStrictEqual(await debugConfigProvider.provideDebugConfigurations(undefined), [])
            // Workspace with no templates:
            assert.deepStrictEqual(await debugConfigProvider.provideDebugConfigurations(fakeWorkspaceFolder), [])

            // Malformed template.yaml:
            await testutil.toFile('bogus', tempFile.fsPath)
            await (await globals.templateRegistry).addItem(tempFile)
            assert.deepStrictEqual(await debugConfigProvider.provideDebugConfigurations(fakeWorkspaceFolder), [])
        })

        it('Ignores non function type resources', async function () {
            const bigYamlStr = `${makeSampleSamTemplateYaml(true)}\nTestResource2:\n .   Type: AWS::Serverless::Api`

            await testutil.toFile(bigYamlStr, tempFile.fsPath)
            await (await globals.templateRegistry).addItem(tempFile)
            const provided = await debugConfigProvider.provideDebugConfigurations(fakeWorkspaceFolder)
            assert.strictEqual(provided!.length, 1)
        })

        it('returns one item if a template with one resource is in the workspace', async function () {
            await testutil.toFile(makeSampleSamTemplateYaml(true), tempFile.fsPath)
            await (await globals.templateRegistry).addItem(tempFile)
            const provided = await debugConfigProvider.provideDebugConfigurations(fakeWorkspaceFolder)
            assert.notStrictEqual(provided, undefined)
            assert.strictEqual(provided!.length, 1)
            assert.strictEqual(
                provided![0].name,
                `${path.basename(fakeWorkspaceFolder.uri.fsPath)}:TestResource (nodejs12.x)`
            )
        })

        it('returns multiple items if a template with multiple resources is in the workspace', async function () {
            const resources = ['resource1', 'resource2']
            const bigYamlStr = `${makeSampleSamTemplateYaml(true, {
                resourceName: resources[0],
            })}\n${makeSampleYamlResource({ resourceName: resources[1] })}`
            await testutil.toFile(bigYamlStr, tempFile.fsPath)
            await (await globals.templateRegistry).addItem(tempFile)
            const provided = await debugConfigProvider.provideDebugConfigurations(fakeWorkspaceFolder)
            assert.notStrictEqual(provided, undefined)
            if (provided) {
                assert.strictEqual(provided.length, 2)
                assert.ok(resources.includes((provided[0].invokeTarget as TemplateTargetProperties).logicalId))
                assert.ok(resources.includes((provided[1].invokeTarget as TemplateTargetProperties).logicalId))
            }
        })

        it('only detects the specifically targeted workspace folder (and its subfolders)', async function () {
            const resources = ['resource1', 'resource2']
            const badResourceName = 'notIt'

            const nestedDir = path.join(tempFolder, 'nested')
            const nestedYaml = vscode.Uri.file(path.join(nestedDir, 'test.yaml'))
            tempFolderSimilarName = tempFolder + 'SimilarName'
            const similarNameYaml = vscode.Uri.file(path.join(tempFolderSimilarName, 'test.yaml'))

            await fs.mkdir(nestedDir)
            await fs.mkdir(tempFolderSimilarName)

            await testutil.toFile(makeSampleSamTemplateYaml(true, { resourceName: resources[0] }), tempFile.fsPath)
            await testutil.toFile(makeSampleSamTemplateYaml(true, { resourceName: resources[1] }), nestedYaml.fsPath)
            await testutil.toFile(
                makeSampleSamTemplateYaml(true, { resourceName: badResourceName }),
                similarNameYaml.fsPath
            )

            await (await globals.templateRegistry).addItem(tempFile)
            await (await globals.templateRegistry).addItem(nestedYaml)
            await (await globals.templateRegistry).addItem(similarNameYaml)

            const provided = await debugConfigProvider.provideDebugConfigurations(fakeWorkspaceFolder)
            assert.notStrictEqual(provided, undefined)
            if (provided) {
                assert.strictEqual(provided.length, 2)
                assert.ok(resources.includes((provided[0].invokeTarget as TemplateTargetProperties).logicalId))
                assert.ok(resources.includes((provided[1].invokeTarget as TemplateTargetProperties).logicalId))
                assert.ok(!resources.includes(badResourceName))
            }
        })

        it('Returns api function type resources as additional api configurations', async function () {
            const bigYamlStr = `${makeSampleSamTemplateYaml(true)}
            Events:
                HelloWorld2:
                    Type: Api
                    Properties:
                        Path: /hello
                        Method: get`

            await testutil.toFile(bigYamlStr, tempFile.fsPath)
            await (await globals.templateRegistry).addItem(tempFile)
            const provided = await debugConfigProvider.provideDebugConfigurations(fakeWorkspaceFolder)
            assert.strictEqual(provided!.length, 2)
            assert.strictEqual(provided![1].invokeTarget.target, API_TARGET_TYPE)
            assert.strictEqual(provided![1].api?.path, '/hello')
            assert.strictEqual(provided![1].api?.httpMethod, 'get')
        })

        it('Ignores HttpApi events', async function () {
            const bigYamlStr = `${makeSampleSamTemplateYaml(true)}
            Events:
                HelloWorld2:
                    Type: HttpApi`

            await testutil.toFile(bigYamlStr, tempFile.fsPath)
            await (await globals.templateRegistry).addItem(tempFile)
            const provided = await debugConfigProvider.provideDebugConfigurations(fakeWorkspaceFolder)
            assert.strictEqual(provided!.length, 1)
        })
    })

    describe('makeConfig', async function () {
        describe('buildDir', function () {
            it('uses `buildDir` as `baseBuildDir` when provided', async function () {
                const buildDir = (await testutil.createTestWorkspaceFolder('my-build-dir')).uri.fsPath
                const folder = testutil.getWorkspaceFolder(testutil.getProjectDir())
                const launchConfig = await getConfig(
                    debugConfigProvider,
                    await globals.templateRegistry,
                    'testFixtures/workspaceFolder/js-plain-sam-app/'
                )
                const config = launchConfig.config as AwsSamDebuggerConfiguration & {
                    invokeTarget: { target: 'template' }
                }
                config.sam = Object.assign(launchConfig.config.sam ?? {}, { buildDir })
                config.invokeTarget.templatePath = config.invokeTarget.templatePath.replace(
                    '${workspaceFolder}',
                    launchConfig.folder.uri.fsPath
                )

                const actual = await debugConfigProvider.makeConfig(folder, config)
                testutil.assertEqualPaths(actual?.baseBuildDir ?? '', buildDir)
            })
        })

        it('failure modes', async function () {
            const config = await getConfig(
                debugConfigProvider,
                await globals.templateRegistry,
                'testFixtures/workspaceFolder/csharp6-zip/'
            )

            // No workspace folder:
            await assert.rejects(() => debugConfigProvider.makeConfig(undefined, config.config))

            // No launch.json (vscode will pass an empty config.request):
            await assert.rejects(() => debugConfigProvider.makeConfig(undefined, { ...config.config, request: '' }))

            // Unknown runtime:
            config.config.lambda = {
                runtime: 'happy-runtime-42',
            }
            await assert.rejects(() => debugConfigProvider.makeConfig(config.folder, config.config))

            // bad credentials
            const mockCredentialsStore: CredentialsStore = new CredentialsStore()

            const credentialsProvider: CredentialsProvider = {
                getCredentials: sandbox.stub().resolves({} as any as AWS.Credentials),
                getProviderType: sandbox.stub().resolves('profile'),
                getTelemetryType: sandbox.stub().resolves('staticProfile'),
                getCredentialsId: sandbox.stub().returns({
                    credentialSource: 'sharedCredentials',
                    credentialTypeId: 'someId',
                }),
                getDefaultRegion: sandbox.stub().returns('someRegion'),
                getHashCode: sandbox.stub().returns('1234'),
                canAutoConnect: sandbox.stub().returns(true),
                isAvailable: sandbox.stub().returns(Promise.resolve(true)),
            }
            const getCredentialsProviderStub = sandbox.stub(
                CredentialsProviderManager.getInstance(),
                'getCredentialsProvider'
            )
            getCredentialsProviderStub.resolves(credentialsProvider)
            sandbox.stub(mockCredentialsStore, 'upsertCredentials').throws()
            const debugConfigProviderMockCredentials = new SamDebugConfigProvider({
                ...fakeContext,
                credentialsStore: mockCredentialsStore,
            })

            await assert.rejects(() =>
                debugConfigProviderMockCredentials.makeConfig(config.folder, {
                    ...config.config,
                    aws: {
                        credentials: 'profile:error',
                    },
                })
            )
        })

        it('generates a valid resource name based on the projectDir #1685', async function () {
            const appDir = pathutil.normalize(
                path.join(testutil.getProjectDir(), 'testFixtures/workspaceFolder/go1-plain-sam-app')
            )
            const folder = testutil.getWorkspaceFolder(appDir)
            const input = {
                type: AWS_SAM_DEBUG_TYPE,
                name: 'test-go-code-logicalid',
                request: DIRECT_INVOKE_TYPE,
                invokeTarget: {
                    target: CODE_TARGET_TYPE,
                    lambdaHandler: 'hello-world',
                    projectRoot: '.', // Issue #1685
                },
                lambda: {
                    runtime: 'go1.x',
                },
            }
            const config = (await debugConfigProvider.makeConfig(folder, input))!

            await assertFileText(
                config.templatePath,
                `Resources:
  go1plainsamapp:
    Type: AWS::Serverless::Function
    Properties:
      Handler: hello-world
      CodeUri: >-
        ${config.codeRoot}
      Runtime: go1.x
`
            )
        })

        it('rejects when resolving debug configurations with an invalid request type', async function () {
            await assert.rejects(() =>
                debugConfigProvider.makeConfig(undefined, {
                    type: AWS_SAM_DEBUG_TYPE,
                    name: 'whats in a name',
                    request: 'not-direct-invoke',
                    invokeTarget: {
                        target: CODE_TARGET_TYPE,
                        lambdaHandler: 'sick handles',
                        projectRoot: 'root as in beer',
                    },
                })
            )
        })

        it('rejects when resolving debug configurations with an invalid target type', async function () {
            const tgt = 'not-code' as 'code'
            await assert.rejects(() =>
                debugConfigProvider.makeConfig(undefined, {
                    type: AWS_SAM_DEBUG_TYPE,
                    name: 'whats in a name',
                    request: DIRECT_INVOKE_TYPE,
                    invokeTarget: {
                        target: tgt,
                        lambdaHandler: 'sick handles',
                        projectRoot: 'root as in beer',
                    },
                })
            )
        })

        it("rejects when resolving template debug configurations with a template that isn't in the registry", async () => {
            await assert.rejects(() => debugConfigProvider.makeConfig(undefined, createFakeConfig({})))
        })

        it("rejects when resolving template debug configurations with a template that doesn't have the set resource", async () => {
            await createAndRegisterYaml({}, tempFile, await globals.templateRegistry)
            await assert.rejects(() =>
                debugConfigProvider.makeConfig(undefined, createFakeConfig({ templatePath: tempFile.fsPath }))
            )
        })

        it('rejects when resolving template debug configurations with a resource that has an invalid runtime in template', async function () {
            await createAndRegisterYaml(
                { resourceName, runtime: 'moreLikeRanOutOfTime' },
                tempFile,
                await globals.templateRegistry
            )
            await assert.rejects(
                () =>
                    debugConfigProvider.makeConfig(
                        undefined,
                        createFakeConfig({
                            templatePath: tempFile.fsPath,
                            logicalId: resourceName,
                        })
                    ),
                /runtime/i
            )
        })

        it('rejects when resolving template debug configurations with a resource that has an invalid runtime in template', async function () {
            await testutil.toFile(
                makeSampleSamTemplateYaml(true, { resourceName, runtime: 'moreLikeRanOutOfTime' }),
                tempFile.fsPath
            )
            await assert.rejects(() =>
                debugConfigProvider.makeConfig(undefined, {
                    type: AWS_SAM_DEBUG_TYPE,
                    name: 'whats in a name',
                    request: DIRECT_INVOKE_TYPE,
                    invokeTarget: {
                        target: TEMPLATE_TARGET_TYPE,
                        templatePath: tempFile.fsPath,
                        logicalId: resourceName,
                    },
                })
            )
        })

        it('rejects when resolving code debug configurations with invalid runtimes', async function () {
            await assert.rejects(() =>
                debugConfigProvider.makeConfig(undefined, {
                    ...createBaseCodeConfig({}),
                    lambda: {
                        runtime: 'COBOL',
                    },
                })
            )
        })

        it('supports workspace-relative template path ("./foo.yaml")', async function () {
            await testutil.toFile(makeSampleSamTemplateYaml(true, { runtime: 'nodejs18.x' }), tempFile.fsPath)
            // Register with *full* path.
            await (await globals.templateRegistry).addItem(tempFile)
            // Simulates launch.json:
            //     "invokeTarget": {
            //         "target": "./test.yaml",
            //     },
            const relPath = './' + path.relative(fakeWorkspaceFolder.uri.path, tempFile.path)

            // Assert that the relative path correctly maps to the full path in the registry.
            const name = 'Test rel path'
            const resolved = await debugConfigProvider.makeConfig(fakeWorkspaceFolder, {
                type: AWS_SAM_DEBUG_TYPE,
                name: name,
                request: 'direct-invoke',
                invokeTarget: {
                    target: TEMPLATE_TARGET_TYPE,
                    templatePath: relPath,
                    logicalId: 'TestResource',
                    // lambdaHandler: 'sick handles',
                    // projectRoot: 'root as in beer'
                },
            })
            assert.strictEqual(resolved!.name, name)
        })


        // ====================================================================
        // REFACTORED RUNTIME TESTS - Using builder pattern and helper functions
        // ====================================================================

        // Node.js tests
        describe('Node.js runtime', function () {
            describe('target=code', function () {
                it('should create debug config for javascript', async function () {
                    const appDir = getAppDir('testFixtures/workspaceFolder/js-manifest-in-root/')
                    const folder = getFolder(appDir)
                    
                    const input = new CodeTargetDebugConfigBuilder('nodejs18.x', 'my.test.handler', 'src')
                        .withName('whats in a name')
                        .withEnvVars({
                            'test-envvar-1': 'test value 1',
                            'test-envvar-2': 'test value 2',
                        })
                        .withPayloadJson({
                            'test-payload-key-1': 'test payload value 1',
                            'test-payload-key-2': 'test payload value 2',
                        })
                        .withMemoryMb(1.2)
                        .withTimeoutSec(9000)
                        .build()

                    const actual = (await debugConfigProvider.makeConfig(folder, input))!
                    const codeRoot = pathutil.normalize(path.join(appDir, 'src'))
                    const expected = createExpectedNodeJsCodeConfig({
                        appDir,
                        input,
                        actual,
                        fakeCredentials,
                        codeRoot,
                        handler: 'my.test.handler',
                        projectRoot: 'src',
                    })

                    assertEqualLaunchConfigs(actual, expected)
                    await assertFileText(
                        expected.envFile!,
                        '{"src":{"test-envvar-1":"test value 1","test-envvar-2":"test value 2"}}'
                    )
                    await assertFileText(
                        expected.eventPayloadFile!,
                        '{"test-payload-key-1":"test payload value 1","test-payload-key-2":"test payload value 2"}'
                    )
                    await assertFileText(
                        expected.templatePath,
                        `Resources:
  src:
    Type: AWS::Serverless::Function
    Properties:
      Handler: my.test.handler
      CodeUri: >-
        ${expected.codeRoot}
      Runtime: nodejs18.x
      Environment:
        Variables:
          test-envvar-1: test value 1
          test-envvar-2: test value 2
      MemorySize: 1.2
      Timeout: 9000
`
                    )

                    // Test pathMapping
                    await testPathMapping(input, expected, folder, debugConfigProvider, [
                        { localRoot: 'somethingLocal', remoteRoot: 'somethingRemote' },
                        { localRoot: 'ignoredLocal', remoteRoot: 'ignoredRemote' },
                    ])

                    // Test noDebug=true
                    await testCodeTargetNoDebug(input, expected, folder, debugConfigProvider)
                })

                it('should create debug config for typescript', async function () {
                    if (os.platform() === 'darwin' && isCI()) {
                        this.skip()
                    }

                    const appDir = getAppDir('testFixtures/workspaceFolder/ts-plain-sam-app/')
                    const folder = getFolder(appDir)
                    
                    const input = new CodeTargetDebugConfigBuilder('nodejs18.x', 'my.test.handler', 'src')
                        .withName('Test debugconfig')
                        .build()

                    const actual = (await debugConfigProvider.makeConfig(folder, input))!
                    const codeRoot = pathutil.normalize(path.join(appDir, 'src'))
                    const expected = createExpectedNodeJsCodeConfig({
                        appDir,
                        input,
                        actual,
                        fakeCredentials,
                        codeRoot,
                        handler: 'my.test.handler',
                        projectRoot: 'src',
                    })

                    assertEqualLaunchConfigs(actual, expected)
                })
            })

            describe('target=template', function () {
                it('should create debug config for javascript', async function () {
                    const appDir = getAppDir('testFixtures/workspaceFolder/js-plain-sam-app/')
                    const folder = getFolder(appDir)
                    const templatePath = pathutil.normalize(path.join(appDir, 'template.yaml'))
                    await (await globals.templateRegistry).addItem(vscode.Uri.file(templatePath))

                    const input = new TemplateTargetDebugConfigBuilder('nodejs18.x', templatePath, 'HelloWorldFunction')
                        .withName('Test Node.js SAM app')
                        .withEnvVars({ 'test-envvar-1': 'test value 1' })
                        .withPayloadJson({ 'test-payload-key-1': 'test payload value 1' })
                        .build()

                    const actual = (await debugConfigProvider.makeConfig(folder, input))!
                    const codeRoot = pathutil.normalize(path.join(appDir, 'hello-world'))
                    const expected = createExpectedNodeJsTemplateConfig({
                        appDir,
                        input,
                        actual,
                        fakeCredentials,
                        codeRoot,
                        handler: 'app.lambdaHandler',
                        templatePath,
                        resourceName: 'hello-world',
                    })

                    assertEqualLaunchConfigs(actual, expected)
                    await assertEqualNoDebugTemplateTarget(input, expected, folder, debugConfigProvider)
                })

                it('should create debug config for Image javascript', async function () {
                    const appDir = getAppDir('testFixtures/workspaceFolder/js-image-sam-app/')
                    const folder = getFolder(appDir)
                    const templatePath = pathutil.normalize(path.join(appDir, 'template.yaml'))
                    await (await globals.templateRegistry).addItem(vscode.Uri.file(templatePath))

                    const input = new TemplateTargetDebugConfigBuilder('nodejs18.x', templatePath, 'HelloWorldFunction')
                        .withName('Test debugconfig')
                        .build()

                    const actual = (await debugConfigProvider.makeConfig(folder, input))!
                    const codeRoot = pathutil.normalize(path.join(appDir, 'hello-world'))
                    const expected = createExpectedNodeJsTemplateConfig({
                        appDir,
                        input,
                        actual,
                        fakeCredentials,
                        codeRoot,
                        handler: 'app.lambdaHandler',
                        templatePath,
                        resourceName: 'hello-world',
                    })

                    assertEqualLaunchConfigs(actual, expected)
                    await assertEqualNoDebugTemplateTarget(input, expected, folder, debugConfigProvider, true)
                })
            })

            describe('target=api', function () {
                it('should create debug config for javascript', async function () {
                    const appDir = getAppDir('testFixtures/workspaceFolder/js-plain-sam-app/')
                    const folder = getFolder(appDir)
                    const templatePath = pathutil.normalize(path.join(appDir, 'template.yaml'))
                    await (await globals.templateRegistry).addItem(vscode.Uri.file(templatePath))

                    const input = new ApiTargetDebugConfigBuilder(
                        'nodejs18.x',
                        templatePath,
                        'HelloWorldFunction',
                        '/hello',
                        'get'
                    )
                        .withName('Test Node.js SAM app')
                        .withPayloadJson({ 'test-payload-key-1': 'test payload value 1' })
                        .build()

                    const actual = (await debugConfigProvider.makeConfig(folder, input))!
                    const codeRoot = pathutil.normalize(path.join(appDir, 'hello-world'))
                    const expected = createExpectedNodeJsApiConfig({
                        appDir,
                        input,
                        actual,
                        fakeCredentials,
                        codeRoot,
                        handler: 'app.lambdaHandler',
                        templatePath,
                        resourceName: 'hello-world',
                    })

                    assertEqualLaunchConfigs(actual, expected)
                })
            })
        })

        // Python tests
        describe('Python runtime', function () {
            describe('target=code', function () {
                it('should create debug config for python 3.7', async function () {
                    const appDir = getAppDir('testFixtures/workspaceFolder/python3.7-plain-sam-app')
                    const relPayloadPath = `events/event.json`
                    const absPayloadPath = `${appDir}/${relPayloadPath}`
                    const folder = getFolder(appDir)
                    
                    const input = new CodeTargetDebugConfigBuilder('python3.7', 'app.lambda_handler', 'hello_world')
                        .withName('Test debugconfig')
                        .withPayloadPath(relPayloadPath)
                        .build()

                    const actual = (await debugConfigProvider.makeConfig(folder, input))!
                    const codeRoot = pathutil.normalize(path.join(appDir, 'hello_world'))
                    const expected = createExpectedPythonCodeConfig({
                        appDir,
                        input,
                        actual,
                        fakeCredentials,
                        codeRoot,
                        handler: 'app.lambda_handler',
                        projectRoot: 'hello_world',
                    })

                    assertEqualLaunchConfigs(actual, expected)
                    assert.strictEqual(await fs.readFileText(actual.eventPayloadFile!), await fs.readFileText(absPayloadPath))
                    await assertFileText(
                        expected.templatePath,
                        `Resources:
  helloworld:
    Type: AWS::Serverless::Function
    Properties:
      Handler: ${expected.handlerName}
      CodeUri: >-
        ${expected.codeRoot}
      Runtime: python3.7
`
                    )

                    // Test pathMapping
                    await testPythonPathMapping(input, expected, folder, debugConfigProvider, [
                        { localRoot: 'somethingLocal', remoteRoot: 'somethingRemote' },
                        { localRoot: 'anotherLocal', remoteRoot: 'anotherRemote' },
                    ])

                    // Test noDebug=true
                    ;(input as any).noDebug = true
                    const actualNoDebug = (await debugConfigProvider.makeConfig(folder, input))! as SamLaunchRequestArgs
                    const expectedNoDebug: SamLaunchRequestArgs = {
                        ...expected,
                        noDebug: true,
                        request: 'launch',
                        debugPort: undefined,
                        port: -1,
                        handlerName: 'app.lambda_handler',
                        baseBuildDir: actualNoDebug.baseBuildDir,
                        envFile: undefined,
                        eventPayloadFile: `${actualNoDebug.baseBuildDir}/event.json`,
                    }
                    assertEqualLaunchConfigs(actualNoDebug, expectedNoDebug)
                })
            })

            describe('target=template', function () {
                it('should create debug config for python 3.7 (deep project tree)', async function () {
                    const appDir = getAppDir('testFixtures/workspaceFolder/python3.7-deep-project-tree')
                    const relPayloadPath = `events/event.json`
                    const folder = getFolder(appDir)
                    const templatePath = pathutil.normalize(path.join(appDir, 'template.yaml'))
                    await (await globals.templateRegistry).addItem(vscode.Uri.file(templatePath))

                    const input = new TemplateTargetDebugConfigBuilder('python3.7', templatePath, 'HelloWorldFunction')
                        .withName('Test Python SAM app')
                        .withPayloadPath(relPayloadPath)
                        .build()

                    const actual = (await debugConfigProvider.makeConfig(folder, input))!
                    const codeRoot = pathutil.normalize(path.join(appDir, 'hello_world'))
                    const expected = createExpectedPythonTemplateConfig({
                        appDir,
                        input,
                        actual,
                        fakeCredentials,
                        codeRoot,
                        handler: 'app.lambda_handler',
                        templatePath,
                        resourceName: 'hello-world',
                    })

                    assertEqualLaunchConfigs(actual, expected)
                    await assertEqualNoDebugTemplateTarget(input, expected, folder, debugConfigProvider)
                })

                it('should create debug config for Image python 3.7', async function () {
                    const appDir = getAppDir('testFixtures/workspaceFolder/python3.7-image-sam-app/')
                    const folder = getFolder(appDir)
                    const templatePath = pathutil.normalize(path.join(appDir, 'template.yaml'))
                    await (await globals.templateRegistry).addItem(vscode.Uri.file(templatePath))

                    const input = new TemplateTargetDebugConfigBuilder('python3.7', templatePath, 'HelloWorldFunction')
                        .withName('Test debugconfig')
                        .build()

                    const actual = (await debugConfigProvider.makeConfig(folder, input))!
                    const codeRoot = pathutil.normalize(path.join(appDir, 'hello_world'))
                    const expected = createExpectedPythonTemplateConfig({
                        appDir,
                        input,
                        actual,
                        fakeCredentials,
                        codeRoot,
                        handler: 'app.lambda_handler',
                        templatePath,
                        resourceName: 'hello-world',
                    })

                    assertEqualLaunchConfigs(actual, expected)
                    await assertEqualNoDebugTemplateTarget(input, expected, folder, debugConfigProvider, true)
                })
            })

            describe('target=api', function () {
                it('should create debug config for python 3.7 (deep project tree)', async function () {
                    const appDir = getAppDir('testFixtures/workspaceFolder/python3.7-deep-project-tree')
                    const folder = getFolder(appDir)
                    const templatePath = pathutil.normalize(path.join(appDir, 'template.yaml'))
                    await (await globals.templateRegistry).addItem(vscode.Uri.file(templatePath))

                    const input = new ApiTargetDebugConfigBuilder(
                        'python3.7',
                        templatePath,
                        'HelloWorldFunction',
                        '/hello',
                        'get'
                    )
                        .withName('Test Python SAM app')
                        .build()

                    const actual = (await debugConfigProvider.makeConfig(folder, input))!
                    const codeRoot = pathutil.normalize(path.join(appDir, 'hello_world'))
                    const expected = createExpectedPythonApiConfig({
                        appDir,
                        input,
                        actual,
                        fakeCredentials,
                        codeRoot,
                        handler: 'app.lambda_handler',
                        templatePath,
                        resourceName: 'hello-world',
                    })

                    assertEqualLaunchConfigs(actual, expected)
                })
            })

            it('verify python debug option not set for non-debug log level', async function () {
                const appDir = getAppDir('testFixtures/workspaceFolder/python3.7-plain-sam-app')
                const folder = getFolder(appDir)
                
                const input = new CodeTargetDebugConfigBuilder('python3.7', 'app.lambda_handler', 'hello_world')
                    .withName('Test debugconfig')
                    .build()

                sandbox.stub(getLogger(), 'logLevelEnabled').returns(false)
                const actual = (await debugConfigProvider.makeConfig(folder, input))!
                assert.ok(!actual.debugArgs || actual.debugArgs.length === 0 || !actual.debugArgs[0].includes('--debug'))
            })
        })

        // Java tests
        describe('Java runtime', function () {
            describe('target=code', function () {
                it('should create debug config for java17 maven', async function () {
                    const appDir = getAppDir('testFixtures/workspaceFolder/java17-plain-maven-sam-app/')
                    const folder = getFolder(appDir)
                    
                    const input = new CodeTargetDebugConfigBuilder('java17', 'helloworld.App::handleRequest', 'HelloWorldFunction')
                        .withName('Test debugconfig')
                        .build()

                    const actual = (await debugConfigProvider.makeConfig(folder, input))!
                    const codeRoot = pathutil.normalize(path.join(appDir, 'HelloWorldFunction'))
                    const expected = createExpectedJavaCodeConfig({
                        appDir,
                        input,
                        actual,
                        fakeCredentials,
                        codeRoot,
                        handler: 'helloworld.App::handleRequest',
                        projectRoot: 'HelloWorldFunction',
                    })

                    assertEqualLaunchConfigs(actual, expected)
                })

                it('should create debug config for java 17 gradle', async function () {
                    const appDir = getAppDir('testFixtures/workspaceFolder/java17-plain-gradle-sam-app/')
                    const folder = getFolder(appDir)
                    
                    const input = new CodeTargetDebugConfigBuilder('java17', 'helloworld.App::handleRequest', 'HelloWorldFunction')
                        .withName('Test debugconfig')
                        .build()

                    const actual = (await debugConfigProvider.makeConfig(folder, input))!
                    const codeRoot = pathutil.normalize(path.join(appDir, 'HelloWorldFunction'))
                    const expected = createExpectedJavaCodeConfig({
                        appDir,
                        input,
                        actual,
                        fakeCredentials,
                        codeRoot,
                        handler: 'helloworld.App::handleRequest',
                        projectRoot: 'HelloWorldFunction',
                    })

                    assertEqualLaunchConfigs(actual, expected)
                })
            })

            describe('target=template', function () {
                it('should create debug config for java maven', async function () {
                    const appDir = getAppDir('testFixtures/workspaceFolder/java17-plain-maven-sam-app/')
                    const folder = getFolder(appDir)
                    const templatePath = pathutil.normalize(path.join(appDir, 'template.yaml'))
                    await (await globals.templateRegistry).addItem(vscode.Uri.file(templatePath))

                    const input = new TemplateTargetDebugConfigBuilder('java17', templatePath, 'HelloWorldFunction')
                        .withName('Test debugconfig')
                        .build()

                    const actual = (await debugConfigProvider.makeConfig(folder, input))!
                    const codeRoot = pathutil.normalize(path.join(appDir, 'HelloWorldFunction'))
                    const expected = createExpectedJavaTemplateConfig({
                        appDir,
                        input,
                        actual,
                        fakeCredentials,
                        codeRoot,
                        handler: 'helloworld.App::handleRequest',
                        templatePath,
                        resourceName: 'HelloWorldFunction',
                    })

                    assertEqualLaunchConfigs(actual, expected)
                    await assertEqualNoDebugTemplateTarget(input, expected, folder, debugConfigProvider)
                })

                it('should create debug config for Image java', async function () {
                    const appDir = getAppDir('testFixtures/workspaceFolder/java17-image-sam-app/')
                    const folder = getFolder(appDir)
                    const templatePath = pathutil.normalize(path.join(appDir, 'template.yaml'))
                    await (await globals.templateRegistry).addItem(vscode.Uri.file(templatePath))

                    const input = new TemplateTargetDebugConfigBuilder('java17', templatePath, 'HelloWorldFunction')
                        .withName('Test debugconfig')
                        .build()

                    const actual = (await debugConfigProvider.makeConfig(folder, input))!
                    const codeRoot = pathutil.normalize(path.join(appDir, 'HelloWorldFunction'))
                    const expected = createExpectedJavaTemplateConfig({
                        appDir,
                        input,
                        actual,
                        fakeCredentials,
                        codeRoot,
                        handler: 'helloworld.App',
                        templatePath,
                        resourceName: 'HelloWorldFunction',
                    })

                    assertEqualLaunchConfigs(actual, expected)
                    await assertEqualNoDebugTemplateTarget(input, expected, folder, debugConfigProvider, true)
                })
            })
        })

        // .NET tests
        describe('.NET runtime', function () {
            describe('target=code', function () {
                it('should create debug config for dotnet/csharp', async function () {
                    const appDir = getAppDir('testFixtures/workspaceFolder/csharp6-plain-sam-app/')
                    const folder = getFolder(appDir)
                    
                    const input = new CodeTargetDebugConfigBuilder('dotnet6', 'HelloWorld::HelloWorld.Function::FunctionHandler', 'src/HelloWorld')
                        .withName('Test debugconfig')
                        .build()

                    const actual = (await debugConfigProvider.makeConfig(folder, input))!
                    const codeRoot = pathutil.normalize(path.join(appDir, 'src/HelloWorld'))
                    const expected = createExpectedDotnetCodeConfig({
                        appDir,
                        input,
                        actual,
                        fakeCredentials,
                        codeRoot,
                        handler: 'HelloWorld::HelloWorld.Function::FunctionHandler',
                        projectRoot: 'src/HelloWorld',
                    })

                    assertEqualLaunchConfigs(actual, expected)
                })
            })

            describe('target=template', function () {
                it('should create debug config for dotnet/csharp', async function () {
                    const appDir = getAppDir('testFixtures/workspaceFolder/csharp6-plain-sam-app/')
                    const folder = getFolder(appDir)
                    const templatePath = pathutil.normalize(path.join(appDir, 'template.yaml'))
                    await (await globals.templateRegistry).addItem(vscode.Uri.file(templatePath))

                    const input = new TemplateTargetDebugConfigBuilder('dotnet6', templatePath, 'HelloWorldFunction')
                        .withName('Test debugconfig')
                        .build()

                    const actual = (await debugConfigProvider.makeConfig(folder, input))!
                    const codeRoot = pathutil.normalize(path.join(appDir, 'src/HelloWorld'))
                    const expected = createExpectedDotnetTemplateConfig({
                        appDir,
                        input,
                        actual,
                        fakeCredentials,
                        codeRoot,
                        handler: 'HelloWorld::HelloWorld.Function::FunctionHandler',
                        templatePath,
                        resourceName: 'src',
                    })

                    assertEqualLaunchConfigs(actual, expected)
                    await assertEqualNoDebugTemplateTarget(input, expected, folder, debugConfigProvider)
                })

                it('should create debug config for Image dotnet/csharp', async function () {
                    const appDir = getAppDir('testFixtures/workspaceFolder/csharp6-image-sam-app/')
                    const folder = getFolder(appDir)
                    const templatePath = pathutil.normalize(path.join(appDir, 'template.yaml'))
                    await (await globals.templateRegistry).addItem(vscode.Uri.file(templatePath))

                    const input = new TemplateTargetDebugConfigBuilder('dotnet6', templatePath, 'HelloWorldFunction')
                        .withName('Test debugconfig')
                        .build()

                    const actual = (await debugConfigProvider.makeConfig(folder, input))!
                    const codeRoot = pathutil.normalize(path.join(appDir, 'src/HelloWorld'))
                    const expected = createExpectedDotnetTemplateConfig({
                        appDir,
                        input,
                        actual,
                        fakeCredentials,
                        codeRoot,
                        handler: 'HelloWorld::HelloWorld.Function::FunctionHandler',
                        templatePath,
                        resourceName: 'src',
                    })

                    assertEqualLaunchConfigs(actual, expected)
                    await assertEqualNoDebugTemplateTarget(input, expected, folder, debugConfigProvider, true)
                })
            })
        })

        // Go tests
        describe('Go runtime', function () {
            describe('target=code', function () {
                it('should create debug config for go', async function () {
                    const appDir = getAppDir('testFixtures/workspaceFolder/go1-plain-sam-app/')
                    const folder = getFolder(appDir)
                    
                    const input = new CodeTargetDebugConfigBuilder('go1.x', 'hello-world', 'hello-world')
                        .withName('Test debugconfig')
                        .build()

                    const actual = (await debugConfigProvider.makeConfig(folder, input))!
                    const codeRoot = pathutil.normalize(path.join(appDir, 'hello-world'))
                    const expected = createExpectedGoCodeConfig({
                        appDir,
                        input,
                        actual,
                        fakeCredentials,
                        codeRoot,
                        handler: 'hello-world',
                        projectRoot: 'hello-world',
                    })

                    assertEqualLaunchConfigs(actual, expected)
                })
            })

            describe('target=template', function () {
                it('should create debug config for go', async function () {
                    const appDir = getAppDir('testFixtures/workspaceFolder/go1-plain-sam-app/')
                    const folder = getFolder(appDir)
                    const templatePath = pathutil.normalize(path.join(appDir, 'template.yaml'))
                    await (await globals.templateRegistry).addItem(vscode.Uri.file(templatePath))

                    const input = new TemplateTargetDebugConfigBuilder('go1.x', templatePath, 'HelloWorldFunction')
                        .withName('Test debugconfig')
                        .build()

                    const actual = (await debugConfigProvider.makeConfig(folder, input))!
                    const codeRoot = pathutil.normalize(path.join(appDir, 'hello-world'))
                    const expected = createExpectedGoTemplateConfig({
                        appDir,
                        input,
                        actual,
                        fakeCredentials,
                        codeRoot,
                        handler: 'hello-world',
                        templatePath,
                        resourceName: 'hello-world',
                    })

                    assertEqualLaunchConfigs(actual, expected)
                    await assertEqualNoDebugTemplateTarget(input, expected, folder, debugConfigProvider)
                })
            })
        })

        it('debugconfig with "aws" section', async function () {
            const appDir = getAppDir('testFixtures/workspaceFolder/js-manifest-in-root/')
            const folder = getFolder(appDir)
            
            const input = {
                type: AWS_SAM_DEBUG_TYPE,
                name: 'test-with-aws-section',
                request: DIRECT_INVOKE_TYPE,
                invokeTarget: {
                    target: CODE_TARGET_TYPE,
                    lambdaHandler: 'my.test.handler',
                    projectRoot: 'src',
                },
                lambda: {
                    runtime: 'nodejs18.x',
                },
                aws: {
                    credentials: 'profile:someprofile',
                    region: 'us-weast-1',
                },
            }

            const actual = (await debugConfigProvider.makeConfig(folder, input))!
            assert.strictEqual(actual.awsCredentials, fakeCredentials)
            assert.strictEqual(actual.region, 'us-weast-1')
        })
    })
})

describe('ensureRelativePaths', function () {
    it('ensures paths are relative', function () {
        const workspace: vscode.WorkspaceFolder = {
            uri: vscode.Uri.file('/test1/'),
            name: 'test workspace',
            index: 0,
        }
        const templateConfig = createTemplateAwsSamDebugConfig(
            undefined,
            undefined,
            false,
            'test name 1',
            '/test1/template.yaml'
        )
        assert.strictEqual(
            (templateConfig.invokeTarget as TemplateTargetProperties).templatePath,
            '/test1/template.yaml'
        )
        ensureRelativePaths(workspace, templateConfig)
        assert.strictEqual((templateConfig.invokeTarget as TemplateTargetProperties).templatePath, 'template.yaml')

        const codeConfig = createCodeAwsSamDebugConfig(
            undefined,
            'testName1',
            '/test1/project',
            lambdaModel.getDefaultRuntime(lambdaModel.RuntimeFamily.NodeJS) ?? ''
        )
        assert.strictEqual((codeConfig.invokeTarget as CodeTargetProperties).projectRoot, '/test1/project')
        ensureRelativePaths(workspace, codeConfig)
        assert.strictEqual((codeConfig.invokeTarget as CodeTargetProperties).projectRoot, 'project')
    })
})

function createBaseCodeConfig(params: {
    name?: string
    lambdaHandler?: string
    projectRoot?: string
}): AwsSamDebuggerConfiguration {
    return {
        type: AWS_SAM_DEBUG_TYPE,
        name: params.name ?? 'whats in a name',
        request: DIRECT_INVOKE_TYPE,
        invokeTarget: {
            target: CODE_TARGET_TYPE,
            lambdaHandler: params.lambdaHandler ?? 'sick handles',
            projectRoot: params.projectRoot ?? 'root as in beer',
        },
    }
}

/**
 * Gets a basic launch.json config for testing purposes, by generating the
 * config from a sample project located at `rootFolder`.
 */
async function getConfig(
    debugConfigProvider: SamDebugConfigProvider,
    registry: CloudFormationTemplateRegistry,
    rootFolder: string
): Promise<{ config: AwsSamDebuggerConfiguration; folder: vscode.WorkspaceFolder }> {
    const appDir = pathutil.normalize(path.join(testutil.getProjectDir(), rootFolder))
    const folder = testutil.getWorkspaceFolder(appDir)
    const templateFile = pathutil.normalize(path.join(appDir, 'template.yaml'))
    await registry.addItem(vscode.Uri.file(templateFile))

    // Generate config(s) from a sample project.
    const configs = await debugConfigProvider.provideDebugConfigurations(folder)
    if (!configs || configs.length === 0) {
        throw Error(`failed to generate config from: ${rootFolder}`)
    }
    return {
        config: configs[0],
        folder: folder,
    }
}

function createFakeConfig(params: {
    name?: string
    target?: string
    templatePath?: string
    logicalId?: string
}): AwsSamDebuggerConfiguration {
    return {
        type: AWS_SAM_DEBUG_TYPE,
        name: params.name ?? 'whats in a name',
        request: DIRECT_INVOKE_TYPE,
        invokeTarget:
            !params.target || params.target === TEMPLATE_TARGET_TYPE
                ? {
                      target: TEMPLATE_TARGET_TYPE,
                      templatePath: params.templatePath ?? 'somewhere else',
                      logicalId: params.logicalId ?? 'you lack resources',
                  }
                : {
                      target: CODE_TARGET_TYPE,
                      lambdaHandler: 'test-handler',
                      projectRoot: 'test-project-root',
                  },
    }
}

async function createAndRegisterYaml(
    subValues: {
        resourceName?: string
        resourceType?: string
        runtime?: string
        handler?: string
    },
    file: vscode.Uri,
    registry: CloudFormationTemplateRegistry
) {
    await testutil.toFile(makeSampleSamTemplateYaml(true, subValues), file.fsPath)
    await registry.addItem(file)
}

describe('createTemplateAwsSamDebugConfig', function () {
    const name = 'my body is a template'
    const templatePath = path.join('two', 'roads', 'diverged', 'in', 'a', 'yellow', 'wood')

    it('creates a template-type SAM debugger configuration with minimal configurations', function () {
        const config = createTemplateAwsSamDebugConfig(undefined, undefined, false, name, templatePath)
        assert.deepStrictEqual(config, {
            name: `yellow:${name}`,
            type: AWS_SAM_DEBUG_TYPE,
            request: DIRECT_INVOKE_TYPE,
            invokeTarget: {
                target: TEMPLATE_TARGET_TYPE,
                logicalId: name,
                templatePath: templatePath,
            },
            lambda: {
                payload: {},
                environmentVariables: {},
            },
        })
    })

    it('creates a template-type SAM debugger configuration with additional params', function () {
        const params = {
            eventJson: {
                payload: 'uneventufl',
            },
            environmentVariables: {
                varial: 'invert to fakie',
            },
            dockerNetwork: 'rockerFretwork',
        }
        const config = createTemplateAwsSamDebugConfig(undefined, undefined, false, name, templatePath, params)
        assert.deepStrictEqual(config.lambda?.payload?.json, params.eventJson)
        assert.deepStrictEqual(config.lambda?.environmentVariables, params.environmentVariables)
        assert.strictEqual(config.sam?.dockerNetwork, params.dockerNetwork)
        assert.strictEqual(config.sam?.containerBuild, undefined)
    })

    it('creates a template-type SAM debugger configuration with a runtime', function () {
        const config = createTemplateAwsSamDebugConfig(undefined, 'runtime', true, name, templatePath, undefined)
        assert.deepStrictEqual(config.lambda?.runtime, 'runtime')
    })
})

describe('createApiAwsSamDebugConfig', function () {
    const name = 'my body is a template'
    const templatePath = path.join('two', 'roads', 'diverged', 'in', 'a', 'yellow', 'wood')
    const runtime = 'timeToRun'

    it('creates a API-type SAM debugger configuration with minimal configurations', function () {
        const config = createApiAwsSamDebugConfig(undefined, undefined, name, templatePath)
        assert.deepStrictEqual(config, {
            name: `API yellow:${name}`,
            type: AWS_SAM_DEBUG_TYPE,
            request: DIRECT_INVOKE_TYPE,
            invokeTarget: {
                target: API_TARGET_TYPE,
                logicalId: name,
                templatePath: templatePath,
            },
            api: {
                path: '/',
                httpMethod: 'get',
                payload: {
                    json: {},
                },
            },
        })
    })

    it('creates a API-type SAM debugger configuration with additional params', function () {
        const config = createApiAwsSamDebugConfig(undefined, runtime, name, templatePath, {
            payload: { json: { key: 'value' } },
            httpMethod: 'OPTIONS',
            path: '/api',
        })
        assert.deepStrictEqual(config, {
            name: `API yellow:${name} (${runtime})`,
            type: AWS_SAM_DEBUG_TYPE,
            request: DIRECT_INVOKE_TYPE,
            invokeTarget: {
                target: API_TARGET_TYPE,
                logicalId: name,
                templatePath: templatePath,
            },
            api: {
                path: '/api',
                httpMethod: 'OPTIONS',
                payload: {
                    json: { key: 'value' },
                },
            },
            lambda: {
                runtime,
            },
        })
    })
})

describe('debugConfiguration', function () {
    let tempFolder: string
    let tempFile: vscode.Uri

    beforeEach(async function () {
        tempFolder = await makeTemporaryToolkitFolder()
        tempFile = vscode.Uri.file(path.join(tempFolder, 'test.yaml'))
    })

    afterEach(async function () {
        await fs.delete(tempFolder, { recursive: true })
        const r = await globals.templateRegistry
        r.reset()
    })

    it('getCodeRoot(), getHandlerName() with invokeTarget=code', async function () {
        const folder = testutil.getWorkspaceFolder(tempFolder)
        const relativePath = 'src'
        const fullPath = pathutil.normalize(path.join(tempFolder, relativePath))

        const config = {
            type: AWS_SAM_DEBUG_TYPE,
            name: 'test debugconfig',
            request: DIRECT_INVOKE_TYPE,
            invokeTarget: {
                target: CODE_TARGET_TYPE,
                lambdaHandler: 'my.test.handler',
                projectRoot: '',
            },
            lambda: {
                runtime: [...lambdaModel.nodeJsRuntimes.values()][0],
            },
        }

        assert.strictEqual(await debugConfiguration.getHandlerName(folder, config), 'my.test.handler')

        // Config with relative path:
        config.invokeTarget.projectRoot = relativePath
        assert.strictEqual(await debugConfiguration.getCodeRoot(folder, config), fullPath)

        // Config with absolute path:
        config.invokeTarget.projectRoot = fullPath
        assert.strictEqual(await debugConfiguration.getCodeRoot(folder, config), fullPath)
    })

    it('getCodeRoot(), getHandlerName() with invokeTarget=template', async function () {
        const folder = testutil.getWorkspaceFolder(tempFolder)
        const relativePath = 'src'
        const fullPath = pathutil.normalize(path.join(tempFolder, relativePath))

        const config = {
            type: AWS_SAM_DEBUG_TYPE,
            name: 'test debugconfig',
            request: DIRECT_INVOKE_TYPE,
            invokeTarget: {
                target: TEMPLATE_TARGET_TYPE,
                templatePath: tempFile.fsPath,
                logicalId: 'TestResource',
            },
            lambda: {
                runtime: [...lambdaModel.nodeJsRuntimes.values()][0],
            },
            sam: {
                template: {
                    parameters: {
                        override: 'override',
                    },
                },
            },
        }

        // Template with relative path:
        await testutil.toFile(
            makeSampleSamTemplateYaml(true, { codeUri: relativePath, handler: 'handler' }),
            tempFile.fsPath
        )
        await (await globals.templateRegistry).addItem(tempFile)
        assert.strictEqual(await debugConfiguration.getCodeRoot(folder, config), fullPath)
        assert.strictEqual(await debugConfiguration.getHandlerName(folder, config), 'handler')

        // Template with absolute path:
        await testutil.toFile(makeSampleSamTemplateYaml(true, { codeUri: fullPath }), tempFile.fsPath)
        await (await globals.templateRegistry).addItem(tempFile)
        assert.strictEqual(await debugConfiguration.getCodeRoot(folder, config), fullPath)

        // Template with refs that don't override:
        const tempFileRefs = vscode.Uri.file(path.join(tempFolder, 'testRefs.yaml'))
        const fileRefsConfig = {
            ...config,
            invokeTarget: {
                ...config.invokeTarget,
                templatePath: tempFileRefs.fsPath,
            },
        }
        const paramStr = makeSampleYamlParameters({
            notOverride: {
                Type: 'String',
                Default: 'notDoingAnything',
            },
        })
        await testutil.toFile(
            makeSampleSamTemplateYaml(true, { codeUri: fullPath, handler: 'handler' }, paramStr),
            tempFileRefs.fsPath
        )
        await (await globals.templateRegistry).addItem(tempFileRefs)
        assert.strictEqual(await debugConfiguration.getCodeRoot(folder, fileRefsConfig), fullPath)
        assert.strictEqual(await debugConfiguration.getHandlerName(folder, fileRefsConfig), 'handler')

        // Template with refs that overrides handler via default parameter value in YAML template
        const tempFileDefaultRefs = vscode.Uri.file(path.join(tempFolder, 'testDefaultRefs.yaml'))
        const fileDefaultRefsConfig = {
            ...config,
            invokeTarget: {
                ...config.invokeTarget,
                templatePath: tempFileDefaultRefs.fsPath,
            },
        }
        const paramStrDefaultOverride = makeSampleYamlParameters({
            defaultOverride: {
                Type: 'String',
                Default: 'thisWillOverride',
            },
        })
        await testutil.toFile(
            makeSampleSamTemplateYaml(
                true,
                { codeUri: fullPath, handler: '!Ref defaultOverride' },
                paramStrDefaultOverride
            ),
            tempFileDefaultRefs.fsPath
        )
        await (await globals.templateRegistry).addItem(tempFileDefaultRefs)
        assert.strictEqual(await debugConfiguration.getCodeRoot(folder, fileDefaultRefsConfig), fullPath)
        assert.strictEqual(await debugConfiguration.getHandlerName(folder, fileDefaultRefsConfig), 'thisWillOverride')

        // Template with refs that overrides handler via override value in launch config
        const tempFileOverrideRef = vscode.Uri.file(path.join(tempFolder, 'testOverrideRefs.yaml'))
        const fileOverrideRefConfig = {
            ...config,
            invokeTarget: {
                ...config.invokeTarget,
                templatePath: tempFileOverrideRef.fsPath,
            },
        }
        const paramStrNoDefaultOverride = makeSampleYamlParameters({
            override: {
                Type: 'String',
            },
        })
        await testutil.toFile(
            makeSampleSamTemplateYaml(true, { codeUri: fullPath, handler: '!Ref override' }, paramStrNoDefaultOverride),
            tempFileOverrideRef.fsPath
        )
        await (await globals.templateRegistry).addItem(tempFileOverrideRef)
        assert.strictEqual(await debugConfiguration.getCodeRoot(folder, fileOverrideRefConfig), fullPath)
        assert.strictEqual(await debugConfiguration.getHandlerName(folder, fileOverrideRefConfig), 'override')
    })
})
