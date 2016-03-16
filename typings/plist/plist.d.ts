// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for details.

// Ad-hoc typings for "plist" package

declare module Plist {
    function parse(s: string): any;
}

declare module "plist" {
    export = Plist;
}