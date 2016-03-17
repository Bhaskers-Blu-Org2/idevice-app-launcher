// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for details.

import {IosAppRunnerHelper} from "./runApp";

// This file provides a mapping from localizable error IDs to english messages, intended for use when full localization is not desired.
const errorMap: { [key: string]: string } = {
    "IDeviceInstallerNotFound": "Unable to find ideviceinstaller. Please 'brew install ideviceinstaller' and try again.",
    "WrongInstalledAppsFile": "Unable to list installed applications on device.",
    "PackageNotInstalled": "Application not installed on device.",
    "UnableToLaunchApp": "Unable to launch application on device due to a communication error.",
    "DeviceLaunchTimeout": "Timed out launching application. Is the device locked?",
    "NoDeviceAttached": "Unable to find device. Is the device plugged in?",
    "ErrorMountingDiskImage": "Unable to mount developer disk image",
    "FailedGetDeviceInfo": "Unable to get device OS version",
    "FailedFindDeveloperDiskImage": "Unable to find developer disk image"
};

function defaultError(err: Error) {
    if (errorMap[err.message]) {
        err.message = errorMap[err.message];
    }
    throw err;
}

export function startApp(packageId: string, proxyPort: number, appLaunchStepTimeout: number = 5000, sessionEndCallback?: (isCrash: boolean) => void) {
    return IosAppRunnerHelper.startApp(packageId, proxyPort, appLaunchStepTimeout, sessionEndCallback).catch(defaultError);
}

export function startAppViaDebugger(portNumber: number, packagePath: string, appLaunchStepTimeout: number = 5000, sessionEndCallback?: (isCrash: boolean) => void) {
    return IosAppRunnerHelper.startAppViaDebugger(portNumber, packagePath, appLaunchStepTimeout, sessionEndCallback).catch(defaultError);
}

export function startDebugProxy(proxyPort: number) {
    return IosAppRunnerHelper.startDebugProxy(proxyPort);
}