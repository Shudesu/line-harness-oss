import { runCli } from "./cli.js";

runCli().then((exitCode) => {
  process.exitCode = exitCode;
}).catch((error) => {
  console.error("Error:", error.message);
  process.exitCode = 1;
});
