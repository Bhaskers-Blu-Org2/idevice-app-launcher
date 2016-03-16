// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for details.

"use strict";

import * as child_process from "child_process";
import * as fs from "fs";
import * as net from "net";
import * as Q from "q";

import * as pl from "plist";

import {SharedState} from "./SharedState";

const promiseExec = Q.denodeify(child_process.exec);

export class IosAppRunnerHelper {
    public static startDebugProxy(proxyPort: number): Q.Promise<child_process.ChildProcess> {
        if (SharedState.nativeDebuggerProxyInstance) {
            SharedState.nativeDebuggerProxyInstance.kill("SIGHUP"); // idevicedebugserver does not exit from SIGTERM
            SharedState.nativeDebuggerProxyInstance = null;
        }

        return IosAppRunnerHelper.mountDeveloperImage().then(function(): Q.Promise<child_process.ChildProcess> {
            const deferred = Q.defer<child_process.ChildProcess>();
            SharedState.nativeDebuggerProxyInstance = child_process.spawn("idevicedebugserverproxy", [proxyPort.toString()]);
            SharedState.nativeDebuggerProxyInstance.once("error", function(err: any): void {
                deferred.reject(err);
            });
            // Allow 200ms for the spawn to error out, ~125ms isn't uncommon for some failures
            Q.delay(200).then(() => deferred.resolve(SharedState.nativeDebuggerProxyInstance));

            return deferred.promise;
        });
    }

    // Attempt to start the app on the device, using the debug server proxy on a given port.
    // Returns a socket speaking remote gdb protocol with the debug server proxy.
    public static startApp(packageId: string, proxyPort: number, appLaunchStepTimeout: number): Q.Promise<net.Socket> {
        // When a user has many apps installed on their device, the response from ideviceinstaller may be large (500k or more)
        // This exceeds the maximum stdout size that exec allows, so we redirect to a temp file.
        return promiseExec("ideviceinstaller -l -o xml > /tmp/$$.ideviceinstaller && echo /tmp/$$.ideviceinstaller")
            .catch(function(err: any): any {
                if (err.code === "ENOENT") {
                    throw new Error("IDeviceInstallerNotFound");
                }
                throw err;
            }).spread<string>(function(stdout: string, stderr: string): string {
                // First find the path of the app on the device
                const filename: string = stdout.trim();
                if (!/^\/tmp\/[0-9]+\.ideviceinstaller$/.test(filename)) {
                    throw new Error("WrongInstalledAppsFile");
                }

                const list: any[] = pl.parse(fs.readFileSync(filename, 'utf8'));
                fs.unlink(filename);
                for (let i: number = 0; i < list.length; ++i) {
                    if (list[i].CFBundleIdentifier === packageId) {
                        return list[i].Path;
                    }
                }

                throw new Error("PackageNotInstalled");
            }).then(function(path: string): Q.Promise<net.Socket> {
                return IosAppRunnerHelper.startAppViaDebugger(proxyPort, path, appLaunchStepTimeout);
            });
    }

    public static startAppViaDebugger(portNumber: number, packagePath: string, appLaunchStepTimeout: number): Q.Promise<net.Socket> {
        const encodedPath: string = IosAppRunnerHelper.encodePath(packagePath);

        // We need to send 3 messages to the proxy, waiting for responses between each message:
        // A(length of encoded path),0,(encoded path)
        // Hc0
        // c
        // We expect a '+' for each message sent, followed by a $OK#9a to indicate that everything has worked.
        // For more info, see http://www.opensource.apple.com/source/lldb/lldb-167.2/docs/lldb-gdb-remote.txt
        const socket: net.Socket = new net.Socket();
        let initState: number = 0;
        let endStatus: number = null;
        let endSignal: number = null;

        const deferred1: Q.Deferred<net.Socket> = Q.defer<net.Socket>();
        const deferred2: Q.Deferred<net.Socket> = Q.defer<net.Socket>();
        const deferred3: Q.Deferred<net.Socket> = Q.defer<net.Socket>();

        socket.on("data", function(data: any): void {
            data = data.toString();
            while (data[0] === "+") { data = data.substring(1); }
            // Acknowledge any packets sent our way
            if (data[0] === "$") {
                socket.write("+");
                if (data[1] === "W") {
                    // The app process has exited, with hex status given by data[2-3] 
                    const status: number = parseInt(data.substring(2, 4), 16);
                    endStatus = status;
                    socket.end();
                } else if (data[1] === "X") {
                    // The app process exited because of signal given by data[2-3]
                    const signal: number = parseInt(data.substring(2, 4), 16);
                    endSignal = signal;
                    socket.end();
                } else if (data[1] === "T") {
                    // The debugger has stopped the process for some reason.
                    // The message includes register contents and stop signal and other data,
                    // but for our purposes it is opaque
                    socket.end();
                } else if (data.substring(1, 3) === "OK") {
                    // last command was received OK;
                    if (initState === 1) {
                        deferred1.resolve(socket);
                    } else if (initState === 2) {
                        deferred2.resolve(socket);
                    }
                } else if (data[1] === "O") {
                    // STDOUT was written to, and the rest of the input until reaching a '#' is a hex-encoded string of that output
                    if (initState === 3) {
                        deferred3.resolve(socket);
                        initState++;
                    }
                } else if (data[1] === "E") {
                    // An error has occurred, with error code given by data[2-3]: parseInt(data.substring(2, 4), 16)
                    deferred1.reject("UnableToLaunchApp");
                    deferred2.reject("UnableToLaunchApp");
                    deferred3.reject("UnableToLaunchApp");
                }
            }
        });

        socket.on("end", function(): void {
            deferred1.reject("UnableToLaunchApp");
            deferred2.reject("UnableToLaunchApp");
            deferred3.reject("UnableToLaunchApp");
        });

        socket.on("error", function(err: Error): void {
            deferred1.reject(err);
            deferred2.reject(err);
            deferred3.reject(err);
        });

        socket.connect(portNumber, "localhost", function(): void {
            // set argument 0 to the (encoded) path of the app
            const cmd: string = IosAppRunnerHelper.makeGdbCommand("A" + encodedPath.length + ",0," + encodedPath);
            initState++;
            socket.write(cmd);
            setTimeout(function(): void {
                deferred1.reject("DeviceLaunchTimeout");
            }, appLaunchStepTimeout);
        });

        return deferred1.promise.then(function(sock: net.Socket): Q.Promise<net.Socket> {
            // Set the step and continue thread to any thread
            const cmd: string = IosAppRunnerHelper.makeGdbCommand("Hc0");
            initState++;
            sock.write(cmd);
            setTimeout(function(): void {
                deferred2.reject("DeviceLaunchTimeout");
            }, appLaunchStepTimeout);
            return deferred2.promise;
        }).then(function(sock: net.Socket): Q.Promise<net.Socket> {
            // Continue execution; actually start the app running.
            const cmd: string = IosAppRunnerHelper.makeGdbCommand("c");
            initState++;
            sock.write(cmd);
            setTimeout(function(): void {
                deferred3.reject("DeviceLaunchTimeout");
            }, appLaunchStepTimeout);
            return deferred3.promise;
        });
    }

    public static encodePath(packagePath: string): string {
        // Encode the path by converting each character value to hex
        return packagePath.replace(/./g, (char: string) => char.charCodeAt(0).toString(16).toUpperCase());
    }

    private static mountDeveloperImage(): Q.Promise<any> {
        return IosAppRunnerHelper.getDiskImage()
            .then(function(path: string): Q.Promise<any> {
                const imagemounter: child_process.ChildProcess = child_process.spawn("ideviceimagemounter", [path]);
                const deferred: Q.Deferred<any> = Q.defer();
                let stdout: string = "";
                imagemounter.stdout.on("data", function(data: any): void {
                    stdout += data.toString();
                });
                imagemounter.on("close", function(code: number): void {
                    if (code !== 0) {
                        if (stdout.indexOf("Error:") !== -1) {
                            deferred.resolve({}); // Technically failed, but likely caused by the image already being mounted.
                        } else if (stdout.indexOf("No device found, is it plugged in?") !== -1) {
                            deferred.reject(new Error("NoDeviceAttached"));
                        }

                        deferred.reject(new Error("ErrorMountingDiskImage"));
                    } else {
                        deferred.resolve({});
                    }
                });
                imagemounter.on("error", function(err: any): void {
                    deferred.reject(err);
                });
                return deferred.promise;
            });
    }

    private static getDiskImage(): Q.Promise<string> {
        // Attempt to find the OS version of the iDevice, e.g. 7.1
        const versionInfo: Q.Promise<any> = promiseExec("ideviceinfo -s -k ProductVersion").spread<string>(function(stdout: string, stderr: string): string {
            return stdout.trim().substring(0, 3); // Versions for DeveloperDiskImage seem to be X.Y, while some device versions are X.Y.Z
            // NOTE: This will almost certainly be wrong in the next few years, once we hit version 10.0 
        }, function(): string {
            throw new Error("FailedGetDeviceInfo");
        });

        // Attempt to find the path where developer resources exist.
        const pathInfo: Q.Promise<any> = promiseExec("xcrun -sdk iphoneos --show-sdk-platform-path").spread<string>(function(stdout: string, stderr: string): string {
            const sdkpath: string = stdout.trim();
            return sdkpath;
        });

        // Attempt to find the developer disk image for the appropriate 
        return Q.all([versionInfo, pathInfo]).spread<string>(function(version: string, sdkpath: string): Q.Promise<string> {
            const find: child_process.ChildProcess = child_process.spawn("find", [sdkpath, "-path", "*" + version + "*", "-name", "DeveloperDiskImage.dmg"]);
            const deferred: Q.Deferred<string> = Q.defer<string>();

            find.stdout.on("data", function(data: any): void {
                const dataStr: string = data.toString();
                const path: string = dataStr.split("\n")[0].trim();
                if (!path) {
                    deferred.reject(new Error("FailedFindDeveloperDiskImage"));
                } else {
                    deferred.resolve(path);
                }
            });
            find.on("close", function(code: number): void {
                deferred.reject(new Error("FailedFindDeveloperDiskImage"));
            });

            return deferred.promise;
        });
    }

    private static makeGdbCommand(command: string): string {
        let stringSum: number = 0;
        for (let i: number = 0; i < command.length; i++) {
            stringSum += command.charCodeAt(i);
        }

        stringSum = stringSum % 256;

        let checksum: string = stringSum.toString(16).toUpperCase();
        if (checksum.length < 2) {
            checksum = "0" + checksum;
        }

        return `$${command}#${checksum}`;
    }
}