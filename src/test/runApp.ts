// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for details.

"use strict";

import "should";

import * as net from "net";
import * as Q from "q";
import {IosAppRunnerHelper} from "../runApp";

interface IMockDebuggerProxy extends net.Server {
    protocolState?: number;
};

// Tests for lib/darwin/darwinAppRunner.js functionality
describe("Device functionality", function(): void {
    // Check that when the debugger behaves nicely, we do as well
    const port: number = 12345;
    const appPath: string = "/private/var/mobile/Applications/042F57CA-9717-4655-8349-532093FFCF44/BlankCordovaApp1.app";

    const encodedAppPath: string = "2F707269766174652F7661722F6D6F62696C652F4170706C69636174696F6E732F30343246353743412D393731372D343635352D383334392D3533323039334646434634342F426C616E6B436F72646F7661417070312E617070";

    it("should encode paths correctly", function(): void {
        encodedAppPath.should.equal(IosAppRunnerHelper.encodePath(appPath));
    });

    it("should complete the startup sequence when the debugger is well behaved", function(done: MochaDone): void {
        const mockDebuggerProxy: IMockDebuggerProxy = net.createServer(function(client: net.Socket): void {
            mockDebuggerProxy.close();
            client.on("data", function(data: Buffer): void {
                let dataString: string = data.toString();
                if (mockDebuggerProxy.protocolState % 2 === 1) {
                    // Every second message should be an acknowledgement of a send of ours
                    dataString[0].should.equal("+");
                    mockDebuggerProxy.protocolState++;
                    dataString = dataString.substring(1);
                    if (dataString === "") {
                        return;
                    }
                }

                dataString[0].should.equal("$");
                let expectedResponse: string = "";
                switch (mockDebuggerProxy.protocolState) {
                    case 0:
                        expectedResponse = "A" + encodedAppPath.length + ",0," + encodedAppPath;
                        let checksum: number = 0;
                        for (let i: number = 0; i < expectedResponse.length; ++i) {
                            checksum += expectedResponse.charCodeAt(i);
                        };
                        checksum = checksum % 256;
                        let checkstring: string = checksum.toString(16).toUpperCase();
                        if (checkstring.length === 1) {
                            checkstring = "0" + checkstring;
                        }

                        expectedResponse = "$" + expectedResponse + "#" + checkstring;
                        dataString.should.equal(expectedResponse);
                        mockDebuggerProxy.protocolState++;
                        client.write("+");
                        client.write("$OK#9A");
                        break;
                    case 2:
                        expectedResponse = "$Hc0#DB";
                        dataString.should.equal(expectedResponse);
                        mockDebuggerProxy.protocolState++;
                        client.write("+");
                        client.write("$OK#9A");
                        break;
                    case 4:
                        expectedResponse = "$c#63";
                        dataString.should.equal(expectedResponse);
                        mockDebuggerProxy.protocolState++;
                        client.write("+");
                        // Respond with empty output
                        client.write("$O#4F");
                        client.end();
                }
            });
        });
        mockDebuggerProxy.protocolState = 0;
        mockDebuggerProxy.on("error", done);

        mockDebuggerProxy.listen(port, function(): void {
            console.log("MockDebuggerProxy listening");
        });

        Q.timeout(IosAppRunnerHelper.startAppViaDebugger(port, appPath, 5000), 1000).done(() => done(), done);
    });

    // Check that when the debugger reports an error, we notice it
    it("should report an error if the debugger fails for some reason", function(done: MochaDone): void {
        const mockDebuggerProxy: IMockDebuggerProxy = net.createServer(function(client: net.Socket): void {
            mockDebuggerProxy.close();
            client.on("data", function(data: Buffer): void {
                let dataString: string = data.toString();
                if (mockDebuggerProxy.protocolState % 2 === 1) {
                    // Every second message should be an acknowledgement of a send of ours
                    dataString[0].should.equal("+");
                    mockDebuggerProxy.protocolState++;
                    dataString = dataString.substring(1);
                    if (dataString === "") {
                        return;
                    }
                }

                dataString[0].should.equal("$");

                let expectedResponse: string = "";
                switch (mockDebuggerProxy.protocolState) {
                    case 0:
                        expectedResponse = "A" + encodedAppPath.length + ",0," + encodedAppPath;
                        let checksum: number = 0;
                        for (let i: number = 0; i < expectedResponse.length; ++i) {
                            checksum += expectedResponse.charCodeAt(i);
                        };
                        checksum = checksum % 256;
                        let checkstring: string = checksum.toString(16).toUpperCase();
                        if (checkstring.length === 1) {
                            checkstring = "0" + checkstring;
                        }

                        expectedResponse = "$" + expectedResponse + "#" + checkstring;
                        dataString.should.equal(expectedResponse);
                        mockDebuggerProxy.protocolState++;
                        client.write("+");
                        client.write("$OK#9A");
                        break;
                    case 2:
                        expectedResponse = "$Hc0#DB";
                        dataString.should.equal(expectedResponse);
                        mockDebuggerProxy.protocolState++;
                        client.write("+");
                        client.write("$OK#9A");
                        break;
                    case 4:
                        expectedResponse = "$c#63";
                        dataString.should.equal(expectedResponse);
                        mockDebuggerProxy.protocolState++;
                        client.write("+");
                        client.write("$E23#AA"); // Report an error
                        client.end();
                }
            });
        });
        mockDebuggerProxy.protocolState = 0;
        mockDebuggerProxy.on("error", done);

        mockDebuggerProxy.listen(port, function(): void {
            console.log("MockDebuggerProxy listening");
        });

        Q.timeout(IosAppRunnerHelper.startAppViaDebugger(port, appPath, 5000), 1000).then(function(): void {
            throw new Error("Starting the app should have failed!");
        }, function(err: any): void {
            err.should.equal("UnableToLaunchApp");
        }).done(() => done(), done);
    });

    // Check that when the app breaks in the debugger, we stop the app
    it("should drop the connection when the app breaks in the debugger", function(done: MochaDone): void {
        let clientSocket: net.Socket;
        const mockDebuggerProxy: IMockDebuggerProxy = net.createServer(function(client: net.Socket): void {
            clientSocket = client;
            mockDebuggerProxy.close();
            client.on("data", function(data: Buffer): void {
                let dataString: string = data.toString();
                if (mockDebuggerProxy.protocolState % 2 === 1 || mockDebuggerProxy.protocolState > 4) {
                    // Every second message should be an acknowledgement of a send of ours,
                    // until the 3 message handshake is completed and then every response should be an acknowledgement of messages we send.
                    dataString[0].should.equal("+");
                    mockDebuggerProxy.protocolState++;
                    dataString = dataString.substring(1);
                    if (dataString === "") {
                        return;
                    }
                }

                dataString[0].should.equal("$");

                let expectedResponse: string = "";
                switch (mockDebuggerProxy.protocolState) {
                    case 0:
                        expectedResponse = "A" + encodedAppPath.length + ",0," + encodedAppPath;
                        let checksum: number = 0;
                        for (let i: number = 0; i < expectedResponse.length; ++i) {
                            checksum += expectedResponse.charCodeAt(i);
                        };
                        checksum = checksum % 256;
                        let checkstring: string = checksum.toString(16).toUpperCase();
                        if (checkstring.length === 1) {
                            checkstring = "0" + checkstring;
                        }

                        expectedResponse = "$" + expectedResponse + "#" + checkstring;
                        dataString.should.equal(expectedResponse);
                        mockDebuggerProxy.protocolState++;
                        client.write("+");
                        client.write("$OK#9A");
                        break;
                    case 2:
                        expectedResponse = "$Hc0#DB";
                        dataString.should.equal(expectedResponse);
                        mockDebuggerProxy.protocolState++;
                        client.write("+");
                        client.write("$OK#9A");
                        break;
                    case 4:
                        expectedResponse = "$c#63";
                        dataString.should.equal(expectedResponse);
                        mockDebuggerProxy.protocolState++;
                        client.write("+");
                        client.write("$O#4F"); // print some output
                        break;
                }
            });
        });
        mockDebuggerProxy.protocolState = 0;
        mockDebuggerProxy.on("error", done);

        mockDebuggerProxy.listen(port, function(): void {
            console.log("MockDebuggerProxy listening");
        });

        Q.timeout(IosAppRunnerHelper.startAppViaDebugger(port, appPath, 5000), 1000).then(function(): Q.Promise<void> {
            const deferred = Q.defer<void>();

            clientSocket.on("end", () => {
                deferred.resolve();
            });
            setTimeout(() => deferred.reject(new Error("Expected the socket connection to terminate")), 100);
            setTimeout(() => clientSocket.write("$T91#00"), 10);
            return deferred.promise;
        }).done(() => done(), done);
    });
});
