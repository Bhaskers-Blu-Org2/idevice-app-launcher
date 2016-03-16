// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for details.

import {IosAppRunnerHelper} from "./runApp";
import * as simpleWrapper from "./simpleWrapper";

export var raw = IosAppRunnerHelper;

export var startApp = simpleWrapper.startApp;
export var startAppViaDebugger = simpleWrapper.startAppViaDebugger;
export var startDebugProxy = simpleWrapper.startDebugProxy;