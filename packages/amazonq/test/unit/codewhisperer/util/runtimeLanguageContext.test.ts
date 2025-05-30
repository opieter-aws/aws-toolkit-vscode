/*!
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'assert'
import { resetCodeWhispererGlobalVariables, TestFolder, toTextDocument } from 'aws-core-vscode/test'
import { runtimeLanguageContext, RuntimeLanguageContext, PlatformLanguageId } from 'aws-core-vscode/codewhisperer'
import * as codewhispererClient from 'aws-core-vscode/codewhisperer'
import { CodewhispererLanguage } from 'aws-core-vscode/shared'

describe('runtimeLanguageContext', function () {
    const languageContext = new RuntimeLanguageContext()
    let tempFolder: TestFolder

    before(async function () {
        tempFolder = await TestFolder.create()
    })

    describe('test isLanguageSupported', function () {
        const cases: [string, boolean][] = [
            ['java', true],
            ['javascript', true],
            ['typescript', true],
            ['jsx', true],
            ['javascriptreact', true],
            ['typescriptreact', true],
            ['tsx', true],
            ['csharp', true],
            ['python', true],
            ['c', true],
            ['cpp', true],
            ['go', true],
            ['kotlin', true],
            ['php', true],
            ['ruby', true],
            ['rust', true],
            ['scala', true],
            ['shellscript', true],
            ['sql', true],
            ['json', true],
            ['yaml', true],
            ['tf', true],
            ['dart', true],
            ['lua', true],
            ['powershell', true],
            ['r', true],
            ['swift', true],
            ['systemVerilog', true],
            ['vue', true],
            ['plaintext', false],
            ['html', false],
            ['vb', false],
        ]

        beforeEach(async function () {
            await resetCodeWhispererGlobalVariables()
        })

        for (const tuple of cases) {
            const languageId = tuple[0]
            const expected = tuple[1]

            it(`should ${expected ? '' : 'not'} support ${languageId}`, function () {
                const actual = languageContext.isLanguageSupported(languageId)
                assert.strictEqual(actual, expected)
            })
        }

        describe('test isLanguageSupported with document as the argument', function () {
            const cases: [string, boolean][] = [
                ['helloJava.java', true],
                ['helloPython.py', true],
                ['helloJavascript.js', true],
                ['helloJsx.jsx', true],
                ['helloTypescript.ts', true],
                ['helloTsx.tsx', true],
                ['helloCsharp.cs', true],
                ['helloC.c', true],
                ['helloC.h', true],
                ['helloCpp.cpp', true],
                ['helloCpp.cc', true],
                ['helloGo.go', true],
                ['helloKotlin.kt', true],
                ['helloPhp.php', true],
                ['helloRuby.rb', true],
                ['helloRust.rs', true],
                ['helloScala.scala', true],
                ['helloShellscript.sh', true],
                ['helloSql.sql', true],
                ['helloSystemVerilog.svh', true],
                ['helloSystemVerilog.sv', true],
                ['helloSystemVerilog.vh', true],
                ['helloDart.dart', true],
                ['helloLua.lua', true],
                ['helloLua.wlua', true],
                ['helloSwift.swift', true],
                ['helloVue.vue', true],
                ['helloPowerShell.ps1', true],
                ['helloPowerShell.psm1', true],
                ['helloR.r', true],
                ['helloJson.json', true],
                ['helloYaml.yaml', true],
                ['helloYaml.yml', true],
                ['helloTf.tf', true],
                ['helloPlaintext.txt', false],
                ['helloHtml.html', false],
                ['helloCss.css', false],
                ['helloUnknown', false],
                ['helloFoo.foo', false],
            ]
            for (const tuple of cases) {
                const fileName = tuple[0]
                const expected = tuple[1]

                it(`pass document ${fileName} as argument should first try determine by languageId then file extensions`, async function () {
                    const doc = await toTextDocument('', fileName, tempFolder.path)
                    const actual = languageContext.isLanguageSupported(doc)
                    assert.strictEqual(actual, expected)
                })
            }
        })
    })

    describe('test getLanguageContext', function () {
        const cases = [
            ['java', 'java'],
            ['python', 'python'],
            ['javascript', 'javascript'],
            ['typescript', 'typescript'],
            ['javascriptreact', 'jsx'],
            ['typescriptreact', 'tsx'],
            ['csharp', 'csharp'],
            ['c', 'c'],
            ['cpp', 'cpp'],
            ['go', 'go'],
            ['kotlin', 'kotlin'],
            ['php', 'php'],
            ['powershell', 'powershell'],
            ['ruby', 'ruby'],
            ['rust', 'rust'],
            ['scala', 'scala'],
            ['shellscript', 'shell'],
            ['sql', 'sql'],
            ['r', 'r'],
            ['swift', 'swift'],
            ['lua', 'lua'],
            ['vue', 'vue'],
            ['plaintext', 'plaintext'],
            ['html', 'plaintext'],
            ['vb', 'plaintext'],
            [undefined, 'plaintext'],
        ]

        for (const tuple of cases) {
            const vscLanguageId = tuple[0]
            const expectedCwsprLanguageId = tuple[1]
            it(`given vscLanguage ${vscLanguageId} should return ${expectedCwsprLanguageId}`, function () {
                const result = runtimeLanguageContext.getLanguageContext(vscLanguageId)
                assert.strictEqual(result.language as string, expectedCwsprLanguageId)
            })
        }
    })

    describe('normalizeLanguage', function () {
        beforeEach(async function () {
            await resetCodeWhispererGlobalVariables()
        })

        const codewhispererLanguageIds: CodewhispererLanguage[] = [
            'c',
            'cpp',
            'csharp',
            'go',
            'java',
            'javascript',
            'jsx',
            'kotlin',
            'php',
            'plaintext',
            'python',
            'ruby',
            'rust',
            'scala',
            'sql',
            'shell',
            'tsx',
            'typescript',
        ]

        for (const inputCwsprLanguageId of codewhispererLanguageIds) {
            it(`should return itself if input language is codewhispererLanguageId - ${inputCwsprLanguageId}`, function () {
                const actual = languageContext.normalizeLanguage(inputCwsprLanguageId)
                assert.strictEqual(actual, inputCwsprLanguageId)
            })
        }

        const platformLanguageIds: [PlatformLanguageId, CodewhispererLanguage][] = [
            ['cpp', 'cpp'],
            ['c_cpp', 'cpp'],
            ['cpp', 'cpp'],
            ['csharp', 'csharp'],
            ['go', 'go'],
            ['golang', 'go'],
            ['java', 'java'],
            ['javascript', 'javascript'],
            ['javascriptreact', 'jsx'],
            ['kotlin', 'kotlin'],
            ['php', 'php'],
            ['python', 'python'],
            ['ruby', 'ruby'],
            ['rust', 'rust'],
            ['scala', 'scala'],
            ['sh', 'shell'],
            ['shellscript', 'shell'],
            ['sql', 'sql'],
            ['typescript', 'typescript'],
            ['typescriptreact', 'tsx'],
        ]

        for (const [platformLanguageId, expectedCwsprLanguageId] of platformLanguageIds) {
            it(`should return mapped codewhispererLanguageId ${expectedCwsprLanguageId} if input language is platformLanguageId - ${platformLanguageId}`, function () {
                const actual = languageContext.normalizeLanguage(platformLanguageId)
                assert.strictEqual(actual, expectedCwsprLanguageId)
            })
        }

        const arbitraryIds: [string | undefined, CodewhispererLanguage | undefined][] = [
            [undefined, undefined],
            ['r', undefined],
            ['fooo', undefined],
            ['bar', undefined],
        ]

        for (const [arbitraryId, _] of arbitraryIds) {
            it(`should return undefined if languageId is undefined or not neither is type of codewhispererLanguageId or platformLanguageId - ${arbitraryId}`, function () {
                const actual = languageContext.normalizeLanguage(undefined)
                assert.strictEqual(actual, undefined)
            })
        }
    })

    describe('toRuntimeLanguage', function () {
        const codewhispererLanguageIds: [CodewhispererLanguage, string][] = [
            ['c', 'c'],
            ['cpp', 'cpp'],
            ['csharp', 'csharp'],
            ['go', 'go'],
            ['java', 'java'],
            ['javascript', 'javascript'],
            ['jsx', 'javascript'],
            ['kotlin', 'kotlin'],
            ['php', 'php'],
            ['plaintext', 'plaintext'],
            ['python', 'python'],
            ['ruby', 'ruby'],
            ['rust', 'rust'],
            ['scala', 'scala'],
            ['shell', 'shell'],
            ['sql', 'sql'],
            ['tsx', 'typescript'],
            ['typescript', 'typescript'],
            ['dart', 'dart'],
            ['lua', 'lua'],
            ['powershell', 'powershell'],
            ['r', 'r'],
            ['swift', 'swift'],
            ['systemVerilog', 'systemverilog'],
            ['vue', 'vue'],
        ]

        for (const [inputCwsprLanguageId, expectedCwsprLanguageId] of codewhispererLanguageIds) {
            it(`should return ${expectedCwsprLanguageId} if input codewhispererLanguageId is - ${inputCwsprLanguageId}`, function () {
                const actual = languageContext.toRuntimeLanguage(inputCwsprLanguageId)
                assert.strictEqual(actual, expectedCwsprLanguageId)
            })
        }
    })

    describe('getLanguageExtensionForNotebook', function () {
        const codewhispererLanguageIds: [CodewhispererLanguage, string][] = [
            ['c', 'c'],
            ['cpp', 'cpp'],
            ['csharp', 'cs'],
            ['go', 'go'],
            ['java', 'java'],
            ['javascript', 'js'],
            ['jsx', 'jsx'],
            ['kotlin', 'kt'],
            ['php', 'php'],
            ['plaintext', 'txt'],
            ['python', 'py'],
            ['ruby', 'rb'],
            ['rust', 'rs'],
            ['scala', 'scala'],
            ['shell', 'sh'],
            ['sql', 'sql'],
            ['tsx', 'tsx'],
            ['typescript', 'ts'],
        ]

        for (const [inputCwsprLanguageId, expectedExt] of codewhispererLanguageIds) {
            it(`should return file extension ${expectedExt} given codewhipsererLanguageId - ${inputCwsprLanguageId}`, function () {
                const actual = languageContext.getLanguageExtensionForNotebook(inputCwsprLanguageId)
                assert.strictEqual(actual, expectedExt)
            })
        }

        const platformLanguageIds: [PlatformLanguageId, string][] = [
            ['c_cpp', 'cpp'],
            ['cpp', 'cpp'],
            ['golang', 'go'],
            ['javascriptreact', 'jsx'],
            ['sh', 'sh'],
            ['shellscript', 'sh'],
            ['sql', 'sql'],
            ['typescriptreact', 'tsx'],
        ]

        for (const [inputPlatformLanguageId, expectedExt] of platformLanguageIds) {
            it(`should return file extension ${expectedExt} given platformLanguageId - ${inputPlatformLanguageId}`, function () {
                const actual = languageContext.getLanguageExtensionForNotebook(inputPlatformLanguageId)
                assert.strictEqual(actual, expectedExt)
            })
        }

        const arbitraryStrs: (string | undefined)[] = ['foo', undefined, 'bar', 'unknown']
        for (const inputStr of arbitraryStrs) {
            it(`should return undefined when input str is ${inputStr}`, function () {
                const actual = languageContext.getLanguageExtensionForNotebook(inputStr)
                assert.strictEqual(actual, undefined)
            })
        }
    })

    // for now we will only jsx mapped to javascript, tsx mapped to typescript, all other language should remain the same
    describe('test covertCwsprRequest', function () {
        const leftFileContent = 'left'
        const rightFileContent = 'right'
        const filename = 'test'
        const cases: [originalLanguage: string, mappedLanguage: string][] = [
            ['java', 'java'],
            ['python', 'python'],
            ['javascript', 'javascript'],
            ['jsx', 'javascript'],
            ['typescript', 'typescript'],
            ['tsx', 'typescript'],
            ['csharp', 'csharp'],
            ['c', 'c'],
            ['cpp', 'cpp'],
            ['go', 'go'],
            ['kotlin', 'kotlin'],
            ['php', 'php'],
            ['ruby', 'ruby'],
            ['rust', 'rust'],
            ['scala', 'scala'],
            ['shell', 'shell'],
            ['sql', 'sql'],
            ['tf', 'tf'],
            ['hcl', 'tf'],
            ['json', 'json'],
            ['yaml', 'yaml'],
            ['yml', 'yaml'],
            ['plaintext', 'plaintext'],
            // ['arbitrary string', 'arbitrary string'],
        ]

        this.beforeEach(async function () {
            await resetCodeWhispererGlobalVariables()
        })

        for (const [originalLanguage, mappedLanguage] of cases) {
            it(`convert ListRecommendationRequest - ${originalLanguage} should map to ${mappedLanguage}`, function () {
                const originalRequest: codewhispererClient.ListRecommendationsRequest = {
                    fileContext: {
                        leftFileContent: leftFileContent,
                        rightFileContent: rightFileContent,
                        filename: filename,
                        programmingLanguage: { languageName: originalLanguage },
                    },
                    maxResults: 1,
                    nextToken: 'token',
                }
                const actual = languageContext.mapToRuntimeLanguage(originalRequest)
                const expected: codewhispererClient.ListRecommendationsRequest = {
                    ...originalRequest,
                    fileContext: {
                        ...originalRequest.fileContext,
                        programmingLanguage: { languageName: mappedLanguage },
                    },
                }
                assert.deepStrictEqual(actual, expected)
            })

            it(`convert GenerateRecommendationsRequest - ${originalLanguage} should map to ${mappedLanguage}`, function () {
                const originalRequest: codewhispererClient.GenerateRecommendationsRequest = {
                    fileContext: {
                        leftFileContent: leftFileContent,
                        rightFileContent: rightFileContent,
                        filename: filename,
                        programmingLanguage: { languageName: originalLanguage },
                    },
                    maxResults: 1,
                }
                const actual = languageContext.mapToRuntimeLanguage(originalRequest)
                const expected: codewhispererClient.GenerateRecommendationsRequest = {
                    ...originalRequest,
                    fileContext: {
                        ...originalRequest.fileContext,
                        programmingLanguage: { languageName: mappedLanguage },
                    },
                }
                assert.deepStrictEqual(actual, expected)
            })
        }
    })
})
