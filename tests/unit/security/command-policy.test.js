import test from "node:test";
import assert from "node:assert/strict";
import { classifyCommand } from "../../../src/security/command-policy.js";

test("classifyCommand normalizes basename, case and executable suffixes", () => {
  assert.equal(classifyCommand(["C:\\Windows\\System32\\cmd.EXE", "/c", "echo", "hi"]), "dangerous");
  assert.equal(classifyCommand(["/usr/bin/bash", "-c", "ls"]), "dangerous");
  assert.equal(classifyCommand(["Git.exe", "push", "--force"]), "dangerous");
  assert.equal(classifyCommand(["rm.exe", "-rf", "x"]), "dangerous");
  assert.equal(classifyCommand(["FORMAT.COM", "c:"]), "forbidden");
});

test("classifyCommand strips the trailing dots Win32 drops when resolving a binary", () => {
  assert.equal(classifyCommand(["cmd.", "/c", "whoami"]), "dangerous");
  assert.equal(classifyCommand(["cmd.exe.", "/c", "whoami"]), "dangerous");
  assert.equal(classifyCommand(["powershell...", "-c", "ls"]), "dangerous");
  assert.equal(classifyCommand(["C:\\Windows\\System32\\cmd.EXE.", "/c", "whoami"]), "dangerous");
  assert.equal(classifyCommand(["rm.", "-rf", "x"]), "dangerous");
  assert.equal(classifyCommand(["format.", "c:"]), "forbidden");
  assert.equal(classifyCommand(["diskpart."]), "forbidden");
  assert.equal(classifyCommand(["bcdedit.exe.", "/set"]), "forbidden");
});

test("classifyCommand flags forbidden commands", () => {
  assert.equal(classifyCommand(["format", "c:"]), "forbidden");
  assert.equal(classifyCommand(["mkfs.ext4", "/dev/sda1"]), "forbidden");
  assert.equal(classifyCommand(["diskpart"]), "forbidden");
  assert.equal(classifyCommand(["bcdedit", "/set"]), "forbidden");
  assert.equal(classifyCommand(["dd", "if=/dev/zero", "of=/dev/sda"]), "forbidden");
});

test("classifyCommand flags deletion and system-level commands as dangerous", () => {
  assert.equal(classifyCommand(["rm", "-rf", "node_modules"]), "dangerous");
  assert.equal(classifyCommand(["rmdir", "/s", "build"]), "dangerous");
  assert.equal(classifyCommand(["rd", "/s", "build"]), "dangerous");
  assert.equal(classifyCommand(["del", "file.txt"]), "dangerous");
  assert.equal(classifyCommand(["shutdown", "/r"]), "dangerous");
  assert.equal(classifyCommand(["reg", "add", "HKCU\\x"]), "dangerous");
  assert.equal(classifyCommand(["sc", "stop", "spooler"]), "dangerous");
  assert.equal(classifyCommand(["schtasks", "/create"]), "dangerous");
  assert.equal(classifyCommand(["taskkill", "/im", "node.exe"]), "dangerous");
  assert.equal(classifyCommand(["curl", "https://example.com"]), "dangerous");
  assert.equal(classifyCommand(["wget", "https://example.com"]), "dangerous");
});

test("classifyCommand flags every wrapper shell as dangerous", () => {
  for (const shell of ["bash", "sh", "zsh", "dash", "cmd", "powershell", "pwsh"]) {
    assert.equal(classifyCommand([shell, "--version"]), "dangerous", shell);
  }
});

test("classifyCommand flags interpreters only when carrying eval flags", () => {
  assert.equal(classifyCommand(["node", "-e", "process.exit(0)"]), "dangerous");
  assert.equal(classifyCommand(["node", "--eval", "process.exit(0)"]), "dangerous");
  assert.equal(classifyCommand(["node", "--version"]), "safe");
  assert.equal(classifyCommand(["node", "script.js"]), "safe");
  assert.equal(classifyCommand(["python", "-c", "print(1)"]), "dangerous");
  assert.equal(classifyCommand(["python3", "-c", "print(1)"]), "dangerous");
  assert.equal(classifyCommand(["python", "script.py"]), "safe");
  assert.equal(classifyCommand(["ruby", "-e", "puts 1"]), "dangerous");
  assert.equal(classifyCommand(["perl", "-e", "print 1"]), "dangerous");
  assert.equal(classifyCommand(["ruby", "script.rb"]), "safe");
});

test("classifyCommand matches eval flags in their equals and print spellings", () => {
  assert.equal(classifyCommand(["node", "--eval=console.log(1)"]), "dangerous");
  assert.equal(classifyCommand(["node", "-e=console.log(1)"]), "dangerous");
  assert.equal(classifyCommand(["node", "-p", "require('os').type()"]), "dangerous");
  assert.equal(classifyCommand(["node", "--print=1"]), "dangerous");
  assert.equal(classifyCommand(["python", "-c=print(1)"]), "dangerous");
  assert.equal(classifyCommand(["node", "--experimental-vm-modules", "script.js"]), "safe");
  assert.equal(classifyCommand(["node", "--enable-source-maps", "script.js"]), "safe");
});

test("classifyCommand applies argv rules for npm publish and git push", () => {
  assert.equal(classifyCommand(["npm", "install"]), "safe");
  assert.equal(classifyCommand(["npm", "test"]), "safe");
  assert.equal(classifyCommand(["npm", "publish"]), "dangerous");
  assert.equal(classifyCommand(["git", "status"]), "safe");
  assert.equal(classifyCommand(["git", "push", "origin", "main"]), "safe");
  assert.equal(classifyCommand(["git", "push", "--force", "origin", "main"]), "dangerous");
  assert.equal(classifyCommand(["git", "push", "--force-with-lease"]), "dangerous");
  assert.equal(classifyCommand(["git", "push", "--delete", "origin", "branch"]), "dangerous");
  assert.equal(classifyCommand(["git", "log", "--oneline"]), "safe");
});

test("classifyCommand covers the short, bundled and equals spellings of git push force/delete", () => {
  assert.equal(classifyCommand(["git", "push", "-f", "origin", "main"]), "dangerous");
  assert.equal(classifyCommand(["git", "push", "-d", "origin", "topic"]), "dangerous");
  assert.equal(classifyCommand(["git", "push", "-fu", "origin", "main"]), "dangerous");
  assert.equal(classifyCommand(["git", "push", "--force-with-lease=main"]), "dangerous");
  assert.equal(classifyCommand(["git", "push", "-u", "origin", "main"]), "safe");
  assert.equal(classifyCommand(["git", "push", "--dry-run", "origin", "main"]), "safe");
  assert.equal(classifyCommand(["git", "push", "-q", "origin", "main"]), "safe");
});

test("classifyCommand treats unknown commands as safe", () => {
  assert.equal(classifyCommand(["cargo", "test"]), "safe");
  assert.equal(classifyCommand(["go", "build", "./..."]), "safe");
  assert.equal(classifyCommand(["definitely-not-a-command-xyz"]), "safe");
});

test("classifyCommand never throws and returns dangerous for malformed argv", () => {
  assert.equal(classifyCommand([]), "dangerous");
  assert.equal(classifyCommand(null), "dangerous");
  assert.equal(classifyCommand(undefined), "dangerous");
  assert.equal(classifyCommand("rm -rf"), "dangerous");
  assert.equal(classifyCommand([42, "x"]), "dangerous");
});
