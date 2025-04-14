/*!
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { AuthUtil } from 'aws-core-vscode/codewhisperer'

export async function loginToIdC() {
    const authState = AuthUtil.instance.getAuthState()
    if (process.env['AWS_TOOLKIT_AUTOMATION'] === 'local') {
        if (authState !== 'connected') {
            throw new Error('You will need to login manually before running tests.')
        }
        return
    }

    const startUrl = process.env['TEST_SSO_STARTURL']
    const region = process.env['TEST_SSO_REGION']

    if (!startUrl || !region) {
        throw new Error(
            'TEST_SSO_STARTURL and TEST_SSO_REGION are required environment variables when running Amazon Q E2E tests'
        )
    }

    await AuthUtil.instance.login(startUrl, region)
}
