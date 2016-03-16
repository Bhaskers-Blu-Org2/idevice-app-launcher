// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for details.

"use strict";

import {ChildProcess} from "child_process";

declare interface SharedStateGlobal {
    // We use the global.tacoRemoteLib namespace here for backwards compatibility with taco-remote-lib
    // where this code was originally authored
    tacoRemoteLib?: {
        nativeDebuggerProxyInstance?: ChildProcess
    }
}

declare var global: SharedStateGlobal;

// We store some process handles in the global namespace to enable multiple different instances of this package to 
// share access. The primary use case of this is for taco-remote-lib packages existing either side-by-side, or 
// persisting between updates of the package. 
export class SharedState {
    public static get nativeDebuggerProxyInstance(): ChildProcess {
        if (global.tacoRemoteLib) {
            return global.tacoRemoteLib.nativeDebuggerProxyInstance;
        }
        return null;
    }

    public static set nativeDebuggerProxyInstance(instance: ChildProcess) {
        if (global.tacoRemoteLib) {
            global.tacoRemoteLib.nativeDebuggerProxyInstance = instance;
        } else {
            global.tacoRemoteLib = {
                nativeDebuggerProxyInstance: instance
            };
        }
    }
}