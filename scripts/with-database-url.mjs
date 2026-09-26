import { spawn } from "node:child_process";

const [command, ...args] = process.argv.slice(2);

if (!command) {
  console.error(
    "Usage: node scripts/with-database-url.mjs <command> [...args]",
  );
  process.exit(1);
}

const executable =
  process.platform === "win32" && ["npm", "npx"].includes(command)
    ? `${command}.cmd`
    : command;

const quoteWindowsArgument = (argument) => {
  if (!/[\s"]/u.test(argument)) return argument;

  return `"${argument
    .replace(/(\\*)"/gu, '$1$1\\"')
    .replace(/(\\*)$/u, "$1$1")}"`;
};

const commandLine = [executable, ...args].map(quoteWindowsArgument).join(" ");

const child = spawn(
  process.platform === "win32"
    ? (process.env.ComSpec ?? "cmd.exe")
    : executable,
  process.platform === "win32" ? ["/d", "/c", commandLine] : args,
  {
    env: {
      ...process.env,
      // Keep existing local development working without putting non-secret
      // configuration into the user's ignored .env file.
      DATABASE_URL: process.env.DATABASE_URL ?? "file:dev.sqlite",
    },
    stdio: "inherit",
  },
);

child.once("error", (error) => {
  console.error(error);
  process.exit(1);
});

child.once("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});
